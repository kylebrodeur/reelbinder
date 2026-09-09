import { MARK_TAGS, type ContinuityIssue, type MarkTag, type PreflightFinding } from "./types.ts";
import type { CinemaConnection, CinemaJobRequest } from "./cinema-client";
import {
  guardPreflightFinding,
  projectFingerprint,
  type PreflightReviewSource,
} from "./preflight-guard.ts";
import type { ReviewedFinding } from "./preflight-store";
import type { Project } from "./types";
import { scriptCommentContext } from "./script-comments.ts";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: { title: string; url: string }[];
  threadId?: string;
  jobId?: string;
  inlineDelivered?: boolean;
}
export interface AssistantPending {
  phase: "preparing" | "ready";
  request: CinemaJobRequest;
  source: PreflightReviewSource;
  jobId: string | null;
  threadId?: string;
}
export interface AssistantReport {
  source: PreflightReviewSource;
  findings: ReviewedFinding[];
  jobId: string | null;
  rebases?: AssistantRebaseRecord[];
  savedReview?: {
    importedAt: number;
    comparisonRequired: boolean;
    /** Imported evidence is retained as data, never treated as provider verification. */
    evidence: Record<string, unknown>;
  };
}
export interface AssistantRebaseRecord {
  id: string;
  at: number;
  jobId: string;
  fromReviewHash: string;
  toReviewHash: string;
  summary: string[];
  validFindingIds: string[];
  unresolved: { findingId: string; reason: string }[];
}
export interface AssistantRebasePreview {
  projectFingerprint: string;
  reportFingerprint: string;
  summary: string[];
  validFindingIds: string[];
  unresolved: { findingId: string; reason: string }[];
}
export interface AssistantSession {
  version: 1;
  projectId: string;
  draft: string;
  messages: AssistantMessage[];
  dismissed: string[];
  pending: AssistantPending | null;
  report: AssistantReport | null;
  error: string | null;
  canRestart: boolean;
  focusThreadId?: string;
}
export interface ProductionIssue extends PreflightFinding {
  key: string;
  shotId?: string;
  origin: "local" | "agentic";
  sources: { title: string; url: string }[];
}

export interface AssistantConsent {
  scope: string;
  expiresAt: number;
}

/** Consent is specific to the exact selected credential records, including their expiry. */
export function assistantConsentScope(
  connections: CinemaConnection[],
  connectionId: string,
  research: boolean,
  parallelConnectionId?: string,
  now = Date.now(),
): AssistantConsent | null {
  const google = connections.find(
    (item) => item.connectionId === connectionId && item.provider === "google-cloud",
  );
  const parallel = research
    ? connections.find(
        (item) => item.connectionId === parallelConnectionId && item.provider === "parallel",
      )
    : undefined;
  if (!google || (research && !parallel)) return null;
  const selected = parallel ? [google, parallel] : [google];
  if (
    selected.some(
      (item) =>
        item.status !== "configured" ||
        !Number.isFinite(item.expiresAt) ||
        item.expiresAt * 1000 <= now,
    )
  )
    return null;
  return {
    scope: JSON.stringify(
      selected.map(({ provider, connectionId, expiresAt }) => [provider, connectionId, expiresAt]),
    ),
    expiresAt: Math.min(...selected.map((item) => item.expiresAt * 1000)),
  };
}

export function assistantConsentMatches(
  consent: AssistantConsent | null,
  selected: AssistantConsent | null,
  now = Date.now(),
): boolean {
  return (
    !!consent &&
    !!selected &&
    consent.scope === selected.scope &&
    consent.expiresAt === selected.expiresAt &&
    consent.expiresAt > now
  );
}

export function assistantInput(
  question: string,
  messages: AssistantMessage[],
  research: boolean,
  officialDocsOrProject: boolean | Project = false,
  projectOrThreadId?: Project | string,
  threadId?: string,
) {
  const officialDocs =
    typeof officialDocsOrProject === "boolean" ? officialDocsOrProject : false;
  const project =
    typeof officialDocsOrProject === "boolean"
      ? projectOrThreadId && typeof projectOrThreadId !== "string"
        ? projectOrThreadId
        : undefined
      : officialDocsOrProject;
  const focusedThreadId =
    typeof officialDocsOrProject === "boolean"
      ? threadId
      : typeof projectOrThreadId === "string"
        ? projectOrThreadId
        : threadId;
  const text = question.trim();
  if (!text || text.length > 4000) throw new Error("Ask a question of up to 4,000 characters.");
  const commentContext = project ? scriptCommentContext(project, focusedThreadId) : "";
  const conversation = messages
    .slice(commentContext ? -7 : -8)
    .map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
  if (commentContext) conversation.push({ role: "user", text: commentContext });
  return {
    question: text,
    research,
    officialDocs,
    conversation,
  };
}

export function productionIssueKey(
  issue: Pick<ProductionIssue, "title" | "detail" | "elementId" | "suggest" | "shotId">,
): string {
  return JSON.stringify([
    issue.title,
    issue.detail,
    issue.elementId ?? "",
    issue.shotId ?? "",
    issue.suggest?.tag ?? "",
    issue.suggest?.text ?? "",
  ]);
}

export function productionIssues(
  local: PreflightFinding[],
  continuity: ContinuityIssue[],
  remote: ReviewedFinding[],
  dismissed: string[],
): ProductionIssue[] {
  const seen = new Set(dismissed);
  const candidates: Omit<ProductionIssue, "key">[] = [
    ...continuity.map((issue) => ({
      ...issue,
      elementId: null,
      origin: "local" as const,
      sources: [],
    })),
    ...local.map((issue) => ({ ...issue, origin: "local" as const, sources: [] })),
    ...remote.filter((issue) => issue.origin === "agentic"),
  ];
  const result: ProductionIssue[] = [];
  for (const issue of candidates) {
    const key = productionIssueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...issue, key });
  }
  const priority = { error: 0, warn: 1, info: 2 };
  return result.sort((a, b) => priority[a.severity] - priority[b.severity]);
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeSources = (value: unknown): { title: string; url: string }[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is { title: string; url: string } => {
          if (!record(item) || typeof item.title !== "string" || typeof item.url !== "string")
            return false;
          try {
            return ["https:", "http:"].includes(new URL(item.url).protocol);
          } catch {
            return false;
          }
        })
        .slice(0, 20)
    : [];

export function assistantResult(
  value: unknown,
  revision: number,
): { answer: string; sources: { title: string; url: string }[]; findings: ReviewedFinding[] } {
  if (
    !record(value) ||
    value.sourceRevision !== revision ||
    typeof value.answer !== "string" ||
    !value.answer.trim() ||
    value.answer.length > 12000 ||
    !Array.isArray(value.findings) ||
    value.findings.length > 40
  )
    throw new Error("The assistant response does not match this saved review. Keep its job ID.");
  const findings = value.findings.map((item, index): ReviewedFinding => {
    if (!record(item) || typeof item.title !== "string" || typeof item.explanation !== "string")
      throw new Error("The assistant returned an unreadable proposal.");
    const tag = item.tag === "continuity" ? "cont" : item.tag;
    return {
      id: `assistant_${index}_${String(item.id ?? index)}`,
      title: item.title,
      detail: item.explanation,
      elementId: typeof item.elementId === "string" ? item.elementId : null,
      severity: "info",
      origin: "agentic",
      sources: safeSources(item.sources),
      ...(typeof tag === "string" &&
      (MARK_TAGS as readonly string[]).includes(tag) &&
      typeof item.text === "string"
        ? {
            suggest: {
              tag: tag as MarkTag,
              text: item.text,
              note: typeof item.note === "string" ? item.note : "",
            },
          }
        : {}),
    };
  });
  return { answer: value.answer, sources: safeSources(value.sources), findings };
}

export function restoreReviewedFindings(current: ReviewedFinding[], fetched: ReviewedFinding[]) {
  // Restore missing provider fields without reviving applied findings or erasing local edits.
  return current.map((finding) => {
    const original = fetched.find((candidate) => candidate.id === finding.id);
    return original && !finding.suggest ? { ...finding, suggest: original.suggest } : finding;
  });
}

export function previewAssistantRebase(
  project: Project,
  report: AssistantReport,
): AssistantRebasePreview {
  if (
    !report.jobId ||
    report.source.projectId !== project.id ||
    report.source.sourceRevision === null ||
    report.source.resultRevision !== report.source.sourceRevision
  )
    throw new Error(
      "Only a completed review for this project can be checked against the current script.",
    );
  const saved: unknown = JSON.parse(report.source.fingerprint);
  if (!record(saved) || !Array.isArray(saved.script))
    throw new Error("The saved review snapshot cannot be read.");
  const oldScript = saved.script.filter(
    (element): element is Record<string, unknown> =>
      record(element) && typeof element.id === "string",
  );
  const added = project.script.filter(
    (element) => !oldScript.some((old) => old.id === element.id),
  ).length;
  const removed = oldScript.filter(
    (old) => !project.script.some((element) => element.id === old.id),
  ).length;
  const changed = project.script.filter((element) => {
    const old = oldScript.find((item) => item.id === element.id);
    return (
      old &&
      (old.text !== element.text ||
        old.kind !== element.kind ||
        old.character !== element.character)
    );
  }).length;
  const summary = [
    added || removed || changed
      ? `Screenplay: ${added} passages added, ${removed} removed, ${changed} changed.`
      : "Screenplay wording and passage identities are unchanged.",
  ];
  const groups = [
    ["shots", "Coverage"],
    ["marks", "Script marks"],
    ["breakdown", "Production catalog"],
    ["characters", "Cast"],
    ["world", "World"],
    ["timeline", "Timeline"],
    ["binder", "References"],
    ["scriptCommentThreads", "Script comments"],
  ] as const;
  for (const [key, label] of groups)
    if (JSON.stringify(saved[key]) !== JSON.stringify(project[key]))
      summary.push(`${label} changed since the source review.`);
  if (summary.length === 1 && report.source.fingerprint !== projectFingerprint(project))
    summary.push("Other project or save metadata changed.");
  const current = projectFingerprint(project);
  const preview: AssistantRebasePreview = {
    projectFingerprint: current,
    reportFingerprint: JSON.stringify(report),
    summary,
    validFindingIds: [],
    unresolved: [],
  };
  for (const finding of report.findings) {
    const guard = finding.suggest
      ? guardPreflightFinding(
          project,
          { ...report.source, reviewFingerprint: current },
          { elementId: finding.elementId, ...finding.suggest },
        )
      : {
          ok: false as const,
          error: "No editable exact-quote proposal is attached to this finding.",
        };
    if (guard.ok) preview.validFindingIds.push(finding.id);
    else preview.unresolved.push({ findingId: finding.id, reason: guard.error });
  }
  return preview;
}

// Compact history labels only. Approval uses the complete JSON comparison tokens above.
function reviewHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export function applyAssistantRebase(
  project: Project,
  report: AssistantReport,
  preview: AssistantRebasePreview,
  now = Date.now(),
): AssistantReport {
  if (
    projectFingerprint(project) !== preview.projectFingerprint ||
    JSON.stringify(report) !== preview.reportFingerprint
  )
    throw new Error(
      "The project or review changed while you were checking it. Review the comparison again.",
    );
  // Recompute rather than trusting mutable UI preview contents.
  const checked = previewAssistantRebase(project, report);
  const entry: AssistantRebaseRecord = {
    id: crypto.randomUUID(),
    at: now,
    jobId: report.jobId!,
    fromReviewHash: reviewHash(report.source.reviewFingerprint),
    toReviewHash: reviewHash(checked.projectFingerprint),
    summary: checked.summary,
    validFindingIds: checked.validFindingIds,
    unresolved: checked.unresolved,
  };
  return {
    ...report,
    source: { ...report.source, reviewFingerprint: checked.projectFingerprint },
    rebases: [...(report.rebases ?? []), entry].slice(-10),
    ...(report.savedReview
      ? { savedReview: { ...report.savedReview, comparisonRequired: false } }
      : {}),
  };
}

export function emptyAssistantSession(projectId: string): AssistantSession {
  return {
    version: 1,
    projectId,
    draft: "",
    messages: [],
    dismissed: [],
    pending: null,
    report: null,
    error: null,
    canRestart: false,
  };
}

export function parseAssistantSession(
  raw: string | null,
  projectId: string,
): AssistantSession | null {
  if (!raw || raw.length > 4_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      value.version !== 1 ||
      value.projectId !== projectId ||
      typeof value.draft !== "string" ||
      value.draft.length > 4000 ||
      (value.focusThreadId !== undefined &&
        (typeof value.focusThreadId !== "string" ||
          !value.focusThreadId ||
          value.focusThreadId.length > 200)) ||
      !Array.isArray(value.messages) ||
      value.messages.length > 24 ||
      !value.messages.every(
        (m) =>
          record(m) &&
          typeof m.id === "string" &&
          ["user", "assistant"].includes(String(m.role)) &&
          typeof m.text === "string" &&
          m.text.length <= 12000 &&
          (m.threadId === undefined ||
            (typeof m.threadId === "string" && !!m.threadId && m.threadId.length <= 200)) &&
          (m.jobId === undefined ||
            (typeof m.jobId === "string" && !!m.jobId && m.jobId.length <= 200)) &&
          (m.inlineDelivered === undefined || typeof m.inlineDelivered === "boolean"),
      ) ||
      !Array.isArray(value.dismissed) ||
      value.dismissed.length > 500 ||
      !value.dismissed.every((key) => typeof key === "string")
    )
      return null;
    const validSource = (source: unknown) =>
      record(source) &&
      source.projectId === projectId &&
      typeof source.fingerprint === "string" &&
      typeof source.reviewFingerprint === "string";
    if (value.pending !== null) {
      const p = value.pending;
      if (
        !record(p) ||
        !["preparing", "ready"].includes(String(p.phase)) ||
        (p.threadId !== undefined &&
          (typeof p.threadId !== "string" || !p.threadId || p.threadId.length > 200)) ||
        !validSource(p.source) ||
        !record(p.request) ||
        p.request.kind !== "preflight" ||
        typeof p.request.connectionId !== "string" ||
        typeof p.request.idempotencyKey !== "string" ||
        !record(p.request.input) ||
        typeof p.request.input.question !== "string" ||
        !Array.isArray(p.request.input.conversation) ||
        !p.request.input.question.trim() ||
        p.request.input.question.length > 4000 ||
        p.request.input.conversation.length > 8 ||
        !p.request.input.conversation.every(
          (turn) =>
            record(turn) &&
            ["user", "assistant"].includes(String(turn.role)) &&
            typeof turn.text === "string" &&
            !!turn.text.trim() &&
            turn.text.length <= 4000,
        ) ||
        (p.jobId !== null && typeof p.jobId !== "string")
      )
        return null;
      const source = p.source as unknown as PreflightReviewSource;
      if (
        p.phase === "ready" &&
        (typeof p.request.projectId !== "string" ||
          p.request.projectId !== source.backendProjectId ||
          p.request.expectedRevision !== source.sourceRevision ||
          typeof source.sourceRevision !== "number" ||
          source.sourceRevision < 1)
      )
        return null;
      if (p.phase === "preparing" && p.jobId !== null) return null;
    }
    const validFinding = (finding: unknown): boolean => {
      if (
        !record(finding) ||
        typeof finding.id !== "string" ||
        typeof finding.title !== "string" ||
        typeof finding.detail !== "string" ||
        finding.origin !== "agentic" ||
        !["error", "warn", "info"].includes(String(finding.severity)) ||
        (finding.elementId !== null && typeof finding.elementId !== "string")
      )
        return false;
      const proposal = finding.suggest;
      return (
        proposal === undefined ||
        (record(proposal) &&
          (MARK_TAGS as readonly unknown[]).includes(proposal.tag) &&
          typeof proposal.text === "string" &&
          (proposal.note === undefined || typeof proposal.note === "string"))
      );
    };
    if (
      value.report !== null &&
      (!record(value.report) ||
        !validSource(value.report.source) ||
        !Array.isArray(value.report.findings) ||
        value.report.findings.length > 40 ||
        !value.report.findings.every(validFinding))
    )
      return null;
    if (record(value.report) && value.report.rebases !== undefined) {
      if (
        !Array.isArray(value.report.rebases) ||
        value.report.rebases.length > 10 ||
        !value.report.rebases.every(
          (entry) =>
            record(entry) &&
            typeof entry.id === "string" &&
            typeof entry.at === "number" &&
            Number.isFinite(entry.at) &&
            typeof entry.jobId === "string" &&
            typeof entry.fromReviewHash === "string" &&
            typeof entry.toReviewHash === "string" &&
            Array.isArray(entry.summary) &&
            entry.summary.length <= 20 &&
            entry.summary.every((line) => typeof line === "string" && line.length <= 500) &&
            Array.isArray(entry.validFindingIds) &&
            entry.validFindingIds.length <= 40 &&
            entry.validFindingIds.every((id) => typeof id === "string") &&
            Array.isArray(entry.unresolved) &&
            entry.unresolved.length <= 40 &&
            entry.unresolved.every(
              (item) =>
                record(item) &&
                typeof item.findingId === "string" &&
                typeof item.reason === "string",
            ),
        )
      )
        return null;
    }
    const restored = value as unknown as AssistantSession;
    if (restored.report?.savedReview) {
      const saved = restored.report.savedReview;
      if (
        !record(saved) ||
        !Number.isFinite(saved.importedAt) ||
        typeof saved.comparisonRequired !== "boolean" ||
        !record(saved.evidence)
      )
        return null;
      assertReviewDataSafe(saved.evidence);
    }
    restored.messages = restored.messages.map((message) => ({
      ...message,
      ...(message.sources ? { sources: safeSources(message.sources) } : {}),
    }));
    if (restored.report)
      restored.report.findings = restored.report.findings.map((finding) => ({
        ...finding,
        sources: safeSources(finding.sources),
      }));
    return restored;
  } catch {
    return null;
  }
}

export const SAVED_ASSISTANT_REVIEW_MAX_BYTES = 4_000_000;
const savedReviewFormat = "slate-assistant-review-recovery";
const reviewEvidenceKeys = [
  "recoveredAt",
  "exportedAt",
  "sourceEvidence",
  "rawProviderResult",
  "recordedCoordinatorEdit",
  "creativeAcceptance",
  "validation",
  "recordedRebases",
  "recordedThreadBindings",
] as const;

/** Reject credential-shaped data, including data hidden in serialized snapshots. */
function assertReviewDataSafe(value: unknown, depth = 0, budget = { left: 100_000 }): void {
  if (depth > 40 || --budget.left < 0) throw new Error("This saved review is too complex.");
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("This saved review contains an invalid number.");
  if (typeof value === "string") {
    if (
      /\bBearer\s+[\w.+/=-]+|\bAIza[\w-]{30,}|\bsk-[\w-]{24,}|-----BEGIN [\w ]*PRIVATE KEY-----/i.test(
        value,
      )
    )
      throw new Error("Saved reviews must not contain credentials or session secrets.");
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      let nested: unknown;
      try {
        nested = JSON.parse(trimmed);
      } catch {
        return;
      }
      assertReviewDataSafe(nested, depth + 1, budget);
    }
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        if (
          url.username ||
          url.password ||
          [...url.searchParams.keys()].some((key) =>
            /^(key|token|api_?key|access_?token|signature|x-goog-signature|x-amz-signature)$/i.test(
              key,
            ),
          )
        )
          throw new Error("Saved reviews must not contain authenticated or signed URLs.");
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Saved reviews")) throw error;
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) assertReviewDataSafe(item, depth + 1, budget);
  } else if (record(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(apikey|apitoken|token|accesstoken|refreshtoken|idtoken|authorization|cookie|cookies|sessionid|sessiontoken|secret|secretkey|clientsecret|password|credentials?|connectionid|parallelconnectionid|privatekey|proto|constructor|prototype)$/.test(
          key.toLowerCase().replace(/[-_\s]/g, ""),
        )
      )
        throw new Error("Saved reviews must not contain credentials or session secrets.");
      assertReviewDataSafe(item, depth + 1, budget);
    }
  }
}

const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const boundedId = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 200;
const validReviewSources = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= 20 &&
    value.every((source) => {
      if (
        !record(source) ||
        !onlyKeys(source, ["title", "url"]) ||
        typeof source.title !== "string" ||
        source.title.length > 1000 ||
        typeof source.url !== "string" ||
        source.url.length > 4000
      )
        return false;
      try {
        return ["http:", "https:"].includes(new URL(source.url).protocol);
      } catch {
        return false;
      }
    }));

export function assistantReviewImportConflict(
  current: AssistantSession,
  running = false,
  persistedRaw: string | null = null,
): string | null {
  const occupied = (session: AssistantSession) =>
    !!(
      session.report ||
      session.pending ||
      session.messages.length ||
      session.draft ||
      session.dismissed.length ||
      session.focusThreadId ||
      session.error ||
      session.canRestart
    );
  if (running || occupied(current))
    return "Open saved reviews only in an empty Assistant. Your current conversation and review were kept.";
  if (persistedRaw !== null) {
    const persisted = parseAssistantSession(persistedRaw, current.projectId);
    if (!persisted || occupied(persisted))
      return "This project already has saved Assistant history. It was kept unchanged.";
  }
  return null;
}

/** A separate import boundary: session recovery itself permits executable pending requests. */
export function parseSavedAssistantReview(
  raw: string,
  projectId: string,
  now = Date.now(),
): AssistantSession {
  if (new TextEncoder().encode(raw).byteLength > SAVED_ASSISTANT_REVIEW_MAX_BYTES)
    throw new Error("Saved reviews must be smaller than 4 MB.");
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("Choose or paste a saved review JSON file.");
  }
  if (
    !record(envelope) ||
    envelope.format !== savedReviewFormat ||
    envelope.version !== 1 ||
    !onlyKeys(envelope, ["format", "version", "assistantSession", ...reviewEvidenceKeys])
  )
    throw new Error("This is not a supported saved review file.");
  assertReviewDataSafe(envelope);
  const value = envelope.assistantSession;
  if (
    !record(value) ||
    !onlyKeys(value, [
      "version",
      "projectId",
      "draft",
      "messages",
      "dismissed",
      "pending",
      "report",
      "error",
      "canRestart",
    ]) ||
    value.pending !== null ||
    value.canRestart !== false ||
    value.draft !== "" ||
    value.error !== null ||
    !Array.isArray(value.dismissed) ||
    value.dismissed.length !== 0 ||
    !Array.isArray(value.messages) ||
    !value.messages.every(
      (m) =>
        record(m) &&
        onlyKeys(m, ["id", "role", "text", "sources", "jobId"]) &&
        boundedId(m.id) &&
        validReviewSources(m.sources) &&
        (m.jobId === undefined || boundedId(m.jobId)),
    ) ||
    new Set(value.messages.map((m) => (m as Record<string, unknown>).id)).size !==
      value.messages.length
  )
    throw new Error(
      "Import a completed review only, without pending requests, conversation actions or acceptance state.",
    );
  const report = value.report;
  if (
    !record(report) ||
    !onlyKeys(report, ["source", "findings", "jobId", "rebases"]) ||
    (report.rebases !== undefined &&
      (!Array.isArray(report.rebases) || report.rebases.length !== 0)) ||
    !boundedId(report.jobId) ||
    !record(report.source) ||
    !onlyKeys(report.source, [
      "projectId",
      "fingerprint",
      "reviewFingerprint",
      "backendProjectId",
      "sourceRevision",
      "resultRevision",
    ]) ||
    !boundedId(report.source.backendProjectId) ||
    !Number.isInteger(report.source.sourceRevision) ||
    Number(report.source.sourceRevision) < 1 ||
    report.source.resultRevision !== report.source.sourceRevision ||
    !Array.isArray(report.findings) ||
    !report.findings.every(
      (f) =>
        record(f) &&
        onlyKeys(f, [
          "id",
          "title",
          "detail",
          "elementId",
          "severity",
          "origin",
          "sources",
          "suggest",
        ]) &&
        boundedId(f.id) &&
        validReviewSources(f.sources) &&
        (f.suggest === undefined ||
          (record(f.suggest) && onlyKeys(f.suggest, ["tag", "text", "note"]))),
    ) ||
    new Set(report.findings.map((f) => (f as Record<string, unknown>).id)).size !==
      report.findings.length
  )
    throw new Error("The saved review has invalid identity, findings or approval history.");
  const session = parseAssistantSession(JSON.stringify(value), projectId);
  if (!session?.report)
    throw new Error("This saved review does not match the current project or is malformed.");
  for (const fingerprint of [
    session.report.source.fingerprint,
    session.report.source.reviewFingerprint,
  ]) {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(fingerprint);
    } catch {
      throw new Error("The saved review snapshot cannot be read.");
    }
    if (
      !record(snapshot) ||
      snapshot.id !== projectId ||
      !Array.isArray(snapshot.script) ||
      !snapshot.script.every(
        (element) => record(element) && boundedId(element.id) && typeof element.text === "string",
      )
    )
      throw new Error("The saved review snapshot does not match this project.");
  }
  const evidence = Object.fromEntries(
    reviewEvidenceKeys
      .filter((key) => envelope[key] !== undefined)
      .map((key) => [key, envelope[key]]),
  );
  const identity = evidence.sourceEvidence;
  if (
    record(identity) &&
    ((identity.jobId !== undefined && identity.jobId !== report.jobId) ||
      (identity.localProjectId !== undefined && identity.localProjectId !== projectId) ||
      (identity.backendProjectId !== undefined &&
        identity.backendProjectId !== report.source.backendProjectId) ||
      (identity.sourceRevision !== undefined &&
        identity.sourceRevision !== report.source.sourceRevision))
  )
    throw new Error("The saved review evidence belongs to a different job or project.");
  if (evidence.rawProviderResult !== undefined)
    assistantResult(evidence.rawProviderResult, Number(report.source.sourceRevision));
  session.report.savedReview = { importedAt: now, comparisonRequired: true, evidence };
  return session;
}

/** Export only inert review data; no request, credential, delivery or approval capabilities. */
export function serializeSavedAssistantReview(session: AssistantSession, now = Date.now()): string {
  if (!session.report?.jobId || session.pending)
    throw new Error("Download a completed review after its request finishes.");
  const report = session.report;
  const evidence: Record<string, unknown> = {
    ...(report.savedReview?.evidence ?? {}),
    exportedAt: new Date(now).toISOString(),
  };
  const previousRebases = Array.isArray(evidence.recordedRebases) ? evidence.recordedRebases : [];
  const rebases = [...previousRebases, ...(report.rebases ?? [])].slice(-20);
  const portable = {
    ...emptyAssistantSession(session.projectId),
    messages: session.messages.map(({ id, role, text, sources, jobId }) => ({
      id,
      role,
      text,
      sources,
      jobId,
    })),
    report: { source: report.source, findings: report.findings, jobId: report.jobId },
  };
  const raw = JSON.stringify(
    {
      ...evidence,
      ...(rebases.length ? { recordedRebases: rebases } : {}),
      format: savedReviewFormat,
      version: 1,
      assistantSession: portable,
    },
    null,
    2,
  );
  parseSavedAssistantReview(raw, session.projectId, now);
  return raw;
}
