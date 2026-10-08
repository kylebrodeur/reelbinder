/** Browser contract for the same-origin cinema service. Keys never enter Project state. */
export type ConnectionMode = "express" | "operator" | "standard";

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
  /**
   * /assistant/chat only: top-level bounded context refs. Attached alongside
   * the same refs inside `input` so a stored pending replays them.
   */
  contextRefs?: string[];
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
  generationCredits: GenerationCredits | null;
}

export type GenerationCreditKind =
  | "photoreal"
  | "storyboard"
  | "video"
  | "music"
  | "assistant"
  | "parallel";

export interface GenerationCreditCount {
  used: number;
  limit: number;
  remaining: number;
}

interface AdminGenerationCreditCount {
  used: number;
  limit: null;
  remaining: null;
}

export type GenerationCredits =
  | {
      month: string;
      admin: false;
      byType: Record<GenerationCreditKind, GenerationCreditCount>;
    }
  | {
      month: string;
      admin: true;
      byType: Record<GenerationCreditKind, AdminGenerationCreditCount>;
    };

const GENERATION_CREDIT_KINDS: readonly GenerationCreditKind[] = [
  "photoreal",
  "storyboard",
  "video",
  "music",
  "assistant",
  "parallel",
];

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

function parseGenerationCredits(value: unknown): GenerationCredits | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) throw new Error("Cinema job usage generationCredits is not an object.");
  const month = value.month;
  if (typeof month !== "string" || !month)
    throw new Error("Cinema job usage generationCredits month is missing or invalid.");
  const admin = value.admin === true;
  const byTypeRaw = isPlainObject(value.byType) ? value.byType : {};
  if (admin) {
    const byType = Object.fromEntries(
      GENERATION_CREDIT_KINDS.map((kind) => {
        const item = byTypeRaw[kind];
        if (!isPlainObject(item) || item.limit !== null || item.remaining !== null)
          throw new Error("Cinema admin generation credit count is missing or invalid.");
        return [kind, { used: nonNegativeInteger(item.used, "used count"), limit: null, remaining: null }];
      }),
    ) as Record<GenerationCreditKind, AdminGenerationCreditCount>;
    return { month, admin: true, byType };
  }
  const byType = Object.fromEntries(
    GENERATION_CREDIT_KINDS.map((kind) => {
      const item = byTypeRaw[kind];
      if (!isPlainObject(item))
        throw new Error("Cinema job usage generation credit count is not an object.");
      return [
        kind,
        {
          used: nonNegativeInteger(item.used, "used count"),
          limit: nonNegativeInteger(item.limit, "limit"),
          remaining: nonNegativeInteger(item.remaining, "remaining count"),
        },
      ];
    }),
  ) as Record<GenerationCreditKind, GenerationCreditCount>;
  return { month, admin: false, byType };
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

  const generationCredits = parseGenerationCredits(value.generationCredits);

  return {
    jobs: { total, queued, running, succeeded, failed, byKind },
    admission: { pending, pendingLimit },
    generationCredits,
  };
}

export async function getCinemaJobUsage(): Promise<CinemaJobUsage> {
  const raw = await cinemaRequest<unknown>("/jobs/usage");
  return parseCinemaJobUsage(raw);
}

export async function cinemaRequest<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  // Ask-adjacent long calls pass explicit timeouts; the 20s default covers the
  // fast reads and submissions the gateway and edge bounds comfortably.
  const { timeoutMs = 20_000, ...fetchOptions } = options;
  const response = await fetch(`/api/cinema${path}`, {
    ...fetchOptions,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...fetchOptions.headers },
    signal: fetchOptions.signal ?? AbortSignal.timeout(timeoutMs),
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
  /** "verified" or "failed" prove access; "inconclusive" means the model route returned 404, so the location could not confirm the model. */
  status: "verified" | "failed" | "inconclusive";
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
    // One probe may call several provider routes; the backend bounds each
    // probe's HTTP call at 30s, giving up to ~2min worst case.
    { method: "POST", body: JSON.stringify({}), timeoutMs: 120_000 },
  );
  connectionProbes.set(connectionId, result);
  publishConnectionProbeChange();
  return result;
}

/** One redacted reports-list row (spec: never credentials or tokens, bounded excerpts). */
export interface CinemaReportRow {
  id: string;
  kind: "report" | "research";
  projectId: string;
  revision: number;
  sourceRevision: number | null;
  question: string;
  status: "ok" | "failed";
  error: string | null;
  createdAt: number;
  answerExcerpt: string;
  findingsCount: number;
  sourcesCount: number;
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Cinema reports list ${name} is invalid.`);
  return value.slice(0, max);
}

function parseCinemaReportRow(value: unknown): CinemaReportRow {
  if (!isPlainObject(value)) throw new Error("Cinema returned an unreadable reports row.");
  const id = boundedText(value.id, "id", 200);
  if (!id.trim()) throw new Error("Cinema returned an unreadable reports row.");
  const kind = value.kind;
  if (kind !== "report" && kind !== "research")
    throw new Error("Cinema returned an unreadable reports kind.");
  const status = value.status;
  if (status !== "ok" && status !== "failed")
    throw new Error("Cinema returned an unreadable reports status.");
  const revision = value.revision;
  const sourceRevision = value.sourceRevision;
  const createdAt = value.createdAt;
  if (
    typeof revision !== "number" ||
    !Number.isFinite(revision) ||
    !(sourceRevision === null || (typeof sourceRevision === "number" && Number.isFinite(sourceRevision))) ||
    typeof createdAt !== "number" ||
    !Number.isFinite(createdAt)
  )
    throw new Error("Cinema returned an unreadable reports row.");
  return {
    id,
    kind,
    projectId: boundedText(value.projectId, "projectId", 200),
    revision,
    sourceRevision: typeof sourceRevision === "number" ? sourceRevision : null,
    question: boundedText(value.question, "question", 160),
    status,
    error: typeof value.error === "string" ? value.error.slice(0, 200) : null,
    createdAt,
    answerExcerpt: boundedText(value.answerExcerpt, "answerExcerpt", 200),
    findingsCount:
      typeof value.findingsCount === "number" && Number.isFinite(value.findingsCount) && value.findingsCount >= 0
        ? value.findingsCount
        : 0,
    sourcesCount:
      typeof value.sourcesCount === "number" && Number.isFinite(value.sourcesCount) && value.sourcesCount >= 0
        ? value.sourcesCount
        : 0,
  };
}

/** Newest-first, this-session-only reports summary for the Activity "Reports" section. */
export async function getReports(projectId: string, limit = 50): Promise<CinemaReportRow[]> {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const value = await cinemaRequest<{ reports?: unknown }>(
    `/reports?projectId=${encodeURIComponent(projectId)}&limit=${bounded}`,
  );
  if (!isPlainObject(value) || !Array.isArray(value.reports))
    throw new Error("Cinema returned an unreadable reports list.");
  return value.reports.map(parseCinemaReportRow);
}

