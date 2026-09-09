/** Browser contract for the same-origin cinema service. Keys never enter Project state. */
export interface CinemaConnection {
  connectionId: string;
  provider: "google-cloud" | "parallel";
  status: "configured";
  expiresAt: number;
  mode?: "express" | "standard";
  projectId?: string;
  location?: string;
}

export interface CinemaHealth {
  liveVerified: boolean;
  capabilities: Record<string, { status: string; model?: string | null; reason?: string }>;
}

export interface CinemaJobRequest {
  kind: "script" | "preflight" | "image" | "video" | "music" | "render";
  connectionId?: string;
  parallelConnectionId?: string;
  projectId?: string;
  expectedRevision?: number;
  idempotencyKey: string;
  input: Record<string, unknown>;
}

export class CinemaJobFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly jobId: string,
  ) {
    super(message);
    this.name = "CinemaJobFailure";
  }
}

export class CinemaRequestFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "CinemaRequestFailure";
  }
}

export async function cinemaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/cinema${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new Error("Cinema service is unavailable. Try again when the connection is restored.");
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CinemaRequestFailure(
      data?.error?.message ?? `Cinema request failed (${response.status}).`,
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
    );
  }
  if (!data || typeof data !== "object") throw new Error("Cinema returned an unreadable response.");
  return data as T;
}

export async function getCinemaConnections(): Promise<CinemaConnection[]> {
  const result = await cinemaRequest<{ connections: CinemaConnection[] }>("/connections");
  return result.connections
    .filter((connection) => connection.expiresAt * 1000 > Date.now())
    .sort((a, b) => b.expiresAt - a.expiresAt);
}

export function getCinemaHealth(): Promise<CinemaHealth> {
  return cinemaRequest<CinemaHealth>("/health");
}

export async function submitCinemaJob<T>(
  request: CinemaJobRequest,
  onJob?: (id: string) => void,
): Promise<T> {
  const job = await cinemaRequest<{ jobId: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify(request),
  });
  assertCinemaJobId(job.jobId);
  onJob?.(job.jobId);
  return waitForCinemaJob<T>(job.jobId);
}

export function assertCinemaJobId(jobId: unknown): asserts jobId is string {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(jobId))
    throw new Error("Cinema returned no valid job ID. Keep this request for review before submitting again.");
}

export async function waitForCinemaJob<T>(jobId: string): Promise<T> {
  assertCinemaJobId(jobId);
  const deadline = Date.now() + 210_000;
  while (Date.now() < deadline) {
    const job = await cinemaRequest<{
      jobId: string;
      status: string;
      result?: T;
      error?: { code?: string; message?: string };
    }>(`/jobs/${encodeURIComponent(jobId)}`);
    if (job.jobId !== jobId)
      throw new Error("The polling response does not match this job. Keep its ID and pending request for recovery.");
    if (job.status === "succeeded" && job.result !== undefined) return job.result;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new CinemaJobFailure(
        job.error?.message ??
          "The generation did not complete. Review the job before trying again.",
        job.error?.code ?? "JOB_FAILED",
        jobId,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(
    "This job is still unresolved. Keep its job ID; do not submit another paid generation yet.",
  );
}
