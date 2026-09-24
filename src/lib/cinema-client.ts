/** Browser contract for the same-origin cinema service. Keys never enter Project state. */
export type ConnectionMode = "express" | "standard" | "gemini";

export const CINEMA_JOB_KINDS = ["script", "preflight", "image", "video", "music", "render"] as const;
export type CinemaJobKind = typeof CINEMA_JOB_KINDS[number];

export interface CinemaConnection {
  connectionId: string;
  provider: "google-cloud" | "parallel";
  status: "configured";
  expiresAt: number;
  mode?: ConnectionMode;
  projectId?: string;
  location?: string;
}

export interface CinemaHealth {
  liveVerified: boolean;
  capabilities: Record<string, { status: string; model?: string | null; reason?: string }>;
}

export interface CinemaJobRequest {
  kind: CinemaJobKind;
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

export function formatCinemaRequestFailure(error: CinemaRequestFailure): string {
  return `${error.message} (${error.code})`;
}

export interface CinemaJobUsageCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  byKind: Record<CinemaJobKind, number>;
}

export interface CinemaJobUsage {
  jobs: CinemaJobUsageCounts;
  admission: { pending: number; pendingLimit: number };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Math.floor(value) === value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!isNonNegativeInteger(value)) throw new Error(`Cinema job usage ${name} is missing or invalid.`);
  return value;
}

export function parseCinemaJobUsage(value: unknown): CinemaJobUsage {
  if (!isPlainObject(value)) throw new Error("Cinema job usage response is not an object.");
  const jobs = value.jobs;
  const admission = value.admission;
  if (!isPlainObject(jobs)) throw new Error("Cinema job usage is missing a valid jobs object.");
  if (!isPlainObject(admission)) throw new Error("Cinema job usage is missing a valid admission object.");

  const total = nonNegativeInteger(jobs.total, "total count");
  const queued = nonNegativeInteger(jobs.queued, "queued count");
  const running = nonNegativeInteger(jobs.running, "running count");
  const succeeded = nonNegativeInteger(jobs.succeeded, "succeeded count");
  const failed = nonNegativeInteger(jobs.failed, "failed count");

  const byKindRaw = isPlainObject(jobs.byKind) ? jobs.byKind : {};
  const kindCount = (val: unknown) => (isNonNegativeInteger(val) ? val : 0);
  const byKind = {
    script: kindCount(byKindRaw.script),
    preflight: kindCount(byKindRaw.preflight),
    image: kindCount(byKindRaw.image),
    video: kindCount(byKindRaw.video),
    music: kindCount(byKindRaw.music),
    render: kindCount(byKindRaw.render),
  } satisfies Record<CinemaJobKind, number>;

  const pending = nonNegativeInteger(admission.pending, "pending count");
  const pendingLimit = nonNegativeInteger(admission.pendingLimit, "pending limit");

  return {
    jobs: { total, queued, running, succeeded, failed, byKind },
    admission: { pending, pendingLimit },
  };
}

export async function getCinemaJobUsage(): Promise<CinemaJobUsage> {
  const raw = await cinemaRequest<unknown>("/jobs/usage");
  return parseCinemaJobUsage(raw);
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
export interface ConnectionProbeResult {
  tool: "script" | "image" | "video" | "music";
  model: string;
  status: "verified" | "failed";
  code: string;
  message: string;
}

export interface ConnectionTestResponse {
  connectionId: string;
  provider: string;
  mode: string;
  projectId?: string;
  location?: string;
  results: ConnectionProbeResult[];
}

const connectionProbes = new Map<string, ConnectionTestResponse>();
const connectionProbeSubscribers = new Set<() => void>();

function publishConnectionProbeChange() {
  for (const listener of connectionProbeSubscribers) listener();
}

export function getConnectionProbe(connectionId: string): ConnectionTestResponse | undefined {
  return connectionProbes.get(connectionId);
}

export function subscribeConnectionProbes(listener: () => void): () => void {
  connectionProbeSubscribers.add(listener);
  return () => connectionProbeSubscribers.delete(listener);
}

export function clearConnectionProbe(connectionId: string) {
  if (connectionProbes.delete(connectionId)) publishConnectionProbeChange();
}

export type ImageProbeReadiness = "unknown" | "verified" | "reauthenticate" | "unsupported" | "failed";

/** Interpret the server-issued image probe code without turning access tests into paid jobs. */
export function imageProbeReadiness(probe?: ConnectionTestResponse): ImageProbeReadiness {
  const image = probe?.results.find((result) => result.tool === "image");
  if (!image) return "unknown";
  if (image.status === "verified") return "verified";
  if (image.code === "401" || image.code === "403" || image.code === "TOKEN_EXPIRED") return "reauthenticate";
  return image.code === "UNSUPPORTED_MODE" ? "unsupported" : "failed";
}

/** A failed explicit access test blocks paid image submission until the connection is repaired. */
export function imageGenerationAvailable(imageModelConfigured: boolean, probe?: ConnectionTestResponse): boolean {
  return imageModelConfigured && !["reauthenticate", "unsupported", "failed"].includes(imageProbeReadiness(probe));
}

export async function testConnection(connectionId: string): Promise<ConnectionTestResponse> {
  const result = await cinemaRequest<ConnectionTestResponse>(
    `/connections/${encodeURIComponent(connectionId)}/test`,
    { method: "POST", body: JSON.stringify({}) },
  );
  connectionProbes.set(connectionId, result);
  publishConnectionProbeChange();
  return result;
}
