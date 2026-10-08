import { create } from "zustand";
import {
  CinemaJobFailure,
  CinemaRequestFailure,
  cinemaRequest,
  formatCinemaRequestFailure,
  getReports,
  waitForCinemaJob,
  type CinemaReportRow,
} from "./cinema-client";
import { guardPreflightFinding, projectFingerprint } from "./preflight-guard";
import { useSlate } from "./store";
import {
  ASSISTANT_CONTEXT_REFS_MAX,
  assistantInput,
  emptyAssistantSession,
  isContextRefId,
  normalizeContextRefs,
  parallelResearchResult,
  researchContextNote,
  researchNoteMessageId,
  parseAssistantSession,
  record,
  type AssistantSession,
  type AssistantMessage,
  type AssistantResearchPending,
  type ProductionIssue,
} from "./production-assistant";
import { executeStudioTool, type StudioToolExecution } from "./webmcp/studio-tools.ts";
import { usePageAgentRuns } from "./page-agent/page-agent-runs";
import type { MarkTag } from "./types";
import {
  newScriptCommentThread,
  scriptCommentAnchorForQuote,
  scriptCommentQuestion,
} from "./script-comments";

export const PRODUCTION_ASSISTANT_OPEN_EVENT = "slate:open-production-assistant";

if (typeof window !== "undefined") {
  window.addEventListener("slate:stage-assistant-question", (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail;
    if (
      !record(detail) ||
      typeof detail.projectId !== "string" ||
      typeof detail.question !== "string"
    )
      return;
    setAssistantDraft(detail.projectId, detail.question);
    window.dispatchEvent(
      new CustomEvent(PRODUCTION_ASSISTANT_OPEN_EVENT, {
        detail: { projectId: detail.projectId },
      }),
    );
  });
}

const storageKey = (id: string) => `slate:production-assistant:${id}`;
/** Activity "Reports" listing for one project: server-held, so never persisted here. */
interface AssistantReportsState {
  items: CinemaReportRow[] | null;
  loading: boolean;
  error: string | null;
}
interface AssistantState {
  sessions: Record<string, AssistantSession>;
  running: Record<string, boolean>;
  /** Standalone Parallel research polling; independent from the main request's running flag. */
  researchRunning: Record<string, boolean>;
  /** Ephemeral streamed answer deltas for the in-flight ask; display-only until `done`. */
  streaming: Record<string, string | null>;
  /** Lazily loaded reports listing per project, for the Activity tab. */
  reports: Record<string, AssistantReportsState>;
  /**
   * Composer Research toggle, per project (ephemeral, not part of the
   * persisted session). The Checks↔Research wiring (spec section 3) sets it
   * when composing a check's research question; the composer chip reads and
   * flips the same value.
   */
  composerResearch: Record<string, boolean>;
}
export const useProductionAssistant = create<AssistantState>(() => ({
  sessions: {},
  running: {},
  researchRunning: {},
  streaming: {},
  reports: {},
  composerResearch: {},
}));

function session(id: string): AssistantSession {
  return useProductionAssistant.getState().sessions[id] ?? hydrateAssistant(id);
}
function publish(value: AssistantSession, required = false, storageError?: string) {
  try {
    localStorage.setItem(storageKey(value.projectId), JSON.stringify(value));
  } catch {
    if (required)
      throw new Error(
        storageError ??
          "This browser cannot save request recovery. Free browser storage before starting a paid request.",
      );
  }
  useProductionAssistant.setState((state) => ({
    sessions: { ...state.sessions, [value.projectId]: value },
  }));
}
export function hydrateAssistant(id: string): AssistantSession {
  const existing = useProductionAssistant.getState().sessions[id];
  if (existing) return existing;
  let restored: AssistantSession | null = null;
  try {
    restored = parseAssistantSession(localStorage.getItem(storageKey(id)), id);
  } catch {
    /* Storage can be disabled. */
  }
  const value = restored ?? emptyAssistantSession(id);
  if (value.pending?.phase === "preparing") {
    value.error =
      "Snapshot preparation stopped before a provider job could be submitted. Start a new question when ready.";
    value.canRestart = true;
  }
  useProductionAssistant.setState((state) => ({ sessions: { ...state.sessions, [id]: value } }));
  return value;
}
export function setAssistantDraft(id: string, draft: string) {
  publish({ ...session(id), draft: draft.slice(0, 4000) });
}

/**
 * Append the filmmaker's typed task as an ordinary chat message so the Copilot
 * work reads as one chat stream: the typed request sits in the conversation
 * beside the Copilot's own entries.
 */
export function appendAssistantUserMessage(id: string, text: string) {
  if (!text) return;
  const value = session(id);
  publish(
    {
      ...value,
      messages: [
        ...value.messages,
        { id: crypto.randomUUID(), role: "user" as const, text, createdAt: Date.now() },
      ].slice(-24),
    },
  );
}

/**
 * Append one Copilot narration entry (a step, observation, retry, error, or the
 * finished answer) as an ordinary assistant message so the Copilot and the
 * assistant are one stream — the same feed, the same "Assistant" label.
 */
export function appendCopilotMessage(id: string, text: string) {
  if (!text) return;
  const value = session(id);
  publish(
    {
      ...value,
      messages: [
        ...value.messages,
        { id: crypto.randomUUID(), role: "assistant" as const, text, createdAt: Date.now() },
      ].slice(-24),
    },
  );
}

/**
 * Flip the composer's Research toggle for a project (Checks↔Research wiring,
 * spec section 3). Ephemeral top-level state: the chip composes the draft and
 * turns the toggle on, but nothing is sent until the filmmaker presses Send.
 */
export function setAssistantComposerResearch(id: string, research: boolean) {
  useProductionAssistant.setState((state) => ({
    composerResearch: { ...state.composerResearch, [id]: research },
  }));
}

/**
 * Record one mention pick (contextRef) from the composer's pickers. Bounded,
 * deduped and silent on invalid overflows exactly like the ask-side validator:
 * picks beyond the 12-ref ceiling are refused, never truncated after the fact.
 */
export function addAssistantMention(id: string, ref: string) {
  const value = session(id);
  if (!isContextRefId(ref) || value.mentions.includes(ref) || value.mentions.length >= ASSISTANT_CONTEXT_REFS_MAX)
    return;
  publish({ ...value, mentions: [...value.mentions, ref] });
}

export function removeAssistantMention(id: string, ref: string) {
  const value = session(id);
  if (!value.mentions.includes(ref)) return;
  publish({ ...value, mentions: value.mentions.filter((item) => item !== ref) });
}
export function clearAssistantCommentContext(id: string) {
  publish({ ...session(id), focusThreadId: undefined });
}
export function prepareAssistantComment(id: string, threadId: string) {
  const project = useSlate.getState().project;
  if (project.id !== id) return;
  const thread = project.scriptCommentThreads?.find((item) => item.id === threadId);
  if (!thread) return;
  publish({ ...session(id), draft: scriptCommentQuestion(thread), focusThreadId: threadId });
  window.dispatchEvent(
    new CustomEvent(PRODUCTION_ASSISTANT_OPEN_EVENT, { detail: { projectId: id } }),
  );
}

function advanceReviewForComment(id: string, before: string) {
  const value = session(id);
  if (value.report?.source.reviewFingerprint !== before) return;
  publish({
    ...value,
    report: {
      ...value.report,
      source: {
        ...value.report.source,
        reviewFingerprint: projectFingerprint(useSlate.getState().project),
      },
    },
  });
}

/** Deliver recovered replies only to their original project/thread; IDs prevent replay duplicates. */
export function syncAssistantCommentReplies(id: string) {
  const value = session(id);
  for (const message of value.messages) {
    if (
      !message.threadId ||
      message.role !== "assistant" ||
      !message.jobId ||
      message.inlineDelivered
    )
      continue;
    const project = useSlate.getState().project;
    if (project.id !== id) return;
    const thread = project.scriptCommentThreads?.find((item) => item.id === message.threadId);
    if (!thread) continue;
    if (thread.messages.some((item) => item.id === message.id)) {
      publish({
        ...session(id),
        messages: session(id).messages.map((item) =>
          item.id === message.id ? { ...item, inlineDelivered: true } : item,
        ),
      });
      continue;
    }
    const before = projectFingerprint(project);
    const result = useSlate.getState().applyScriptCommentChange(id, {
      kind: "reply",
      threadId: thread.id,
      message: {
        id: message.id,
        role: "assistant",
        text: message.text,
        createdAt: Date.now(),
        source: { jobId: message.jobId },
        sources: message.sources,
      },
    });
    if (!result.ok) {
      publish({
        ...session(id),
        error: `Answer saved in the Assistant. Inline reply needs attention: ${result.error}`,
      });
      return;
    }
    advanceReviewForComment(id, before);
    publish({
      ...session(id),
      messages: session(id).messages.map((item) =>
        item.id === message.id ? { ...item, inlineDelivered: true } : item,
      ),
    });
  }
}

export function attachAssistantComment(id: string, issue: ProductionIssue) {
  const value = session(id);
  const project = useSlate.getState().project;
  if (
    project.id !== id ||
    issue.origin !== "agentic" ||
    !issue.elementId ||
    !value.report ||
    useProductionAssistant.getState().running[id]
  )
    return;
  try {
    const snapshot = JSON.parse(value.report.source.fingerprint);
    const original = snapshot?.script?.find(
      (element: { id?: string; text?: string }) => element.id === issue.elementId,
    );
    const quote = issue.suggest?.text ?? original?.text;
    if (typeof quote !== "string")
      throw new Error("Select an exact passage on the script to attach this note.");
    const anchor = scriptCommentAnchorForQuote(project, issue.elementId, quote);
    const thread = newScriptCommentThread(
      anchor,
      [issue.title, issue.detail, issue.suggest?.note].filter(Boolean).join("\n\n"),
      {
        role: "assistant",
        // The finding id is the thread's provenance; per-finding ids also make
        // a repeated attach of the same finding a no-op at the store boundary.
        source: { jobId: issue.id, findingId: issue.id },
        sources: issue.sources,
      },
    );
    const before = projectFingerprint(project);
    const result = useSlate.getState().applyScriptCommentChange(id, { kind: "add-thread", thread });
    if (!result.ok) throw new Error(result.error);
    advanceReviewForComment(id, before);
    publish({ ...session(id), error: null });
  } catch (error) {
    publish({
      ...session(id),
      error: error instanceof Error ? error.message : "Could not attach this finding.",
    });
  }
}
export function dismissAssistantIssue(id: string, issue: ProductionIssue) {
  const value = session(id);
  publish({ ...value, dismissed: [...new Set([...value.dismissed, issue.key])].slice(-500) });
}
export function restoreAssistantIssues(id: string) {
  publish({ ...session(id), dismissed: [] });
}
export function editAssistantProposal(
  id: string,
  findingId: string,
  change: { text?: string; note?: string; tag?: MarkTag },
) {
  const value = session(id);
  if (!value.report || useProductionAssistant.getState().running[id]) return;
  publish({
    ...value,
    report: {
      ...value.report,
      findings: value.report.findings.map((finding) =>
        finding.id === findingId && finding.suggest
          ? { ...finding, suggest: { ...finding.suggest, ...change } }
          : finding,
      ),
    },
  });
}
export function acceptAssistantIssue(id: string, issue: ProductionIssue) {
  if (useProductionAssistant.getState().running[id] || !issue.suggest) return;
  const value = session(id);
  const project = useSlate.getState().project;
  if (project.id !== id) return;
  const fingerprint = projectFingerprint(project);
  const source =
    issue.origin === "agentic"
      ? (value.report?.source ?? null)
      : {
          projectId: id,
          fingerprint,
          reviewFingerprint: fingerprint,
          backendProjectId: null,
          sourceRevision: null,
          resultRevision: null,
        };
  const guard = guardPreflightFinding(project, source, {
    elementId: issue.elementId,
    ...issue.suggest,
  });
  if (!guard.ok) {
    publish({ ...value, error: guard.error });
    return;
  }
  useSlate.getState().addMark(guard.mark);
  const reviewFingerprint = projectFingerprint(useSlate.getState().project);
  publish({
    ...value,
    error: null,
    dismissed: [...new Set([...value.dismissed, issue.key])].slice(-500),
    report: value.report
      ? {
          ...value.report,
          source: {
            ...value.report.source,
            reviewFingerprint:
              value.report.source.reviewFingerprint === fingerprint
                ? reviewFingerprint
                : value.report.source.reviewFingerprint,
          },
          findings: value.report.findings.filter((finding) => finding.id !== issue.id),
        }
      : null,
  });
}

function setRunning(id: string, running: boolean) {
  useProductionAssistant.setState((state) => ({ running: { ...state.running, [id]: running } }));
}
function setResearchRunning(id: string, running: boolean) {
  useProductionAssistant.setState((state) => ({
    researchRunning: { ...state.researchRunning, [id]: running },
  }));
}
/** Separate job: never recharges the Gemini answer and never replaces it. */
async function executeResearch(id: string) {
  const start = session(id).researchPending;
  if (!start) return null;
  try {
    // Elapsed timing starts with this execution attempt; a resume keeps the
    // original started time so the Research tab's elapsed stays honest.
    const startedAt = start.startedAt ?? Date.now();
    if (start.startedAt === undefined) {
      const stamped = session(id);
      if (stamped.researchPending?.request.idempotencyKey === start.request.idempotencyKey)
        publish({ ...stamped, researchPending: { ...start, startedAt } });
    }
    let jobId = start.jobId;
    if (!jobId) {
      const job = await cinemaRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: JSON.stringify(start.request),
      });
      if (typeof job.jobId !== "string")
        throw new Error("The Parallel job ID could not be confirmed. Start research again.");
      jobId = job.jobId;
      const tracked = session(id);
      if (tracked.researchPending?.request.idempotencyKey === start.request.idempotencyKey)
        publish({ ...tracked, researchPending: { ...start, jobId, startedAt } }, true);
    }
    const result = parallelResearchResult(
      await waitForCinemaJob(jobId),
      start.source.sourceRevision!,
    );
    const current = session(id);
    if (current.researchPending?.request.idempotencyKey !== start.request.idempotencyKey) return null;
    const finishedAt = Date.now();
    // The delivered message carries the research linkage the Research tab and
    // the "Add research as context" note both need: question, job id, elapsed.
    const message: AssistantMessage = {
      id: `${start.request.idempotencyKey}:research`,
      role: "assistant" as const,
      provider: "parallel" as const,
      text: result.answer,
      sources: result.sources,
      jobId,
      question: String(start.request.input.question ?? ""),
      researchDurationMs: Math.max(0, finishedAt - startedAt),
      finishedAt,
      ...(start.threadId ? { threadId: start.threadId } : {}),
    };
    publish(
      {
        ...current,
        researchPending: null,
        researchError: null,
        researchFaultCode: null,
        messages: [...current.messages.filter((m) => m.id !== message.id), message].slice(-24),
      },
      true,
    );
    // The completed research job just stored a report server-side; refresh an open listing.
    refreshReportsIfLoaded(id);
    syncAssistantCommentReplies(id);
    return { answer: result.answer, sources: result.sources };
  } catch (failure) {
    const value = session(id);
    if (value.researchPending?.request.idempotencyKey !== start.request.idempotencyKey) return null;
    const message = failure instanceof Error ? failure.message : "The Parallel research job could not finish.";
    publish({
      ...value,
      researchError:
        failure instanceof CinemaRequestFailure
          ? formatCinemaRequestFailure(failure)
          : failure instanceof Error
            ? failure.message
            : "The Parallel research job could not finish.",
      // The named fault code backs the Research tab's failed row; plain errors
      // fall back to their formatted "(CODE)" tail when one is present.
      researchFaultCode:
        failure instanceof CinemaJobFailure || failure instanceof CinemaRequestFailure
          ? failure.code
          : (/\(([A-Z][A-Z0-9_]+)\)\s*$/.exec(message)?.[1] ?? null),
    });
    return null;
  } finally {
    setResearchRunning(id, false);
  }
}
export function resumeAssistantResearch(id: string) {
  if (useProductionAssistant.getState().researchRunning[id] || !session(id).researchPending) return;
  setResearchRunning(id, true);
  publish({ ...session(id), researchError: null });
  void executeResearch(id);
}
export function dismissAssistantResearch(id: string) {
  const value = session(id);
  if (useProductionAssistant.getState().researchRunning[id] || !value.researchPending) return;
  publish({ ...value, researchPending: null, researchError: null, researchFaultCode: null });
}

/**
 * Submit the assistant's research suggestion (spec section 2) as a standalone
 * Parallel job: a NEW idempotency key and a snapshot of the current project,
 * taken at the filmmaker's click — the only moment a Parallel credit is
 * charged. It never touches the delivered answer, the composer Research
 * toggle or the draft. The job lands in the Research tab immediately
 * (running state). Single in flight: an active ask or research job refuses
 * another submission.
 */
export async function submitResearchSuggestion(
  id: string,
  question: string,
): Promise<{ answer: string; sources: { title: string; url: string }[] } | null> {
  const state = useProductionAssistant.getState();
  if (state.running[id] || state.researchRunning[id]) return null;
  const value = session(id);
  // Single in flight, and a suggestion for a question whose job already ran
  // is consumed: the UI renders no Run chip for it, and re-running an
  // identical suggestion must never double-charge silently.
  if (
    value.pending ||
    value.researchPending ||
    value.messages.some(
      (message) =>
        message.provider === "parallel" &&
        !message.researchNoteJobId &&
        message.question === question.trim(),
    )
  )
    return null;
  if (useSlate.getState().project.id !== id) return null;
  try {
    // Validate the suggested question before any snapshot/connection work.
    const input = assistantInput(question, value.messages, false, false);
    // Parallel research runs on its own API key, so it never needs the Google
    // OAuth connection (whose access token has a short TTL). The backend
    // provisions the server-default Parallel credential for a parallelOnly job.
    // Re-check the single-in-flight guard after the async reads: the
    // filmmaker may have asked or started research meanwhile.
    const current = session(id);
    const fresh = useProductionAssistant.getState();
    if (fresh.running[id] || fresh.researchRunning[id] || current.pending || current.researchPending) return null;
    const project = useSlate.getState().project;
    if (project.id !== id) return null;
    const snapshot = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
      method: "POST",
      body: JSON.stringify({ project }),
    });
    if (typeof snapshot.projectId !== "string" || !Number.isInteger(snapshot.revision) || snapshot.revision < 1)
      throw new Error("The saved project revision could not be confirmed for this research job.");
    const fingerprint = projectFingerprint(structuredClone(project));
    const pending: AssistantResearchPending = {
      request: {
        kind: "preflight",
        projectId: snapshot.projectId,
        expectedRevision: snapshot.revision,
        idempotencyKey: crypto.randomUUID(),
        input: { ...input, research: true, parallelOnly: true, officialDocs: false },
      },
      source: {
        projectId: id,
        fingerprint,
        reviewFingerprint: fingerprint,
        backendProjectId: snapshot.projectId,
        sourceRevision: snapshot.revision,
        resultRevision: null,
      },
      startedAt: Date.now(),
      jobId: null,
    };
    setResearchRunning(id, true);
    publish({ ...session(id), researchPending: pending, researchError: null, researchFaultCode: null });
    return executeResearch(id);
  } catch (failure) {
    publish({
      ...session(id),
      error: failure instanceof Error ? failure.message : "The research job could not be submitted.",
    });
    return null;
  }
}

/**
 * The assistant's search_parallel tool: one Parallel web search delivered as
 * tool output so the reply can cite it. It rides the standalone research job
 * path, so the Research tab gets the row and the credit is charged once.
 */
export async function runParallelSearchTool(
  id: string,
  args: Record<string, unknown>,
): Promise<StudioToolExecution> {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return { ok: false, error: "search_parallel needs a question to search." };
  const outcome = await submitResearchSuggestion(id, question);
  if (!outcome) {
    const value = session(id);
    const message =
      value.researchError ??
      value.error ??
      "The Parallel research job could not finish. Check the Research tab.";
    return { ok: false, error: message };
  }
  const lines = outcome.sources.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`);
  return {
    ok: true,
    content: [
      {
        type: "text",
        text: `Parallel research for "${question}"${lines.length ? "" : " returned no usable sources."}${
          lines.length ? ` returned these cited sources:\n${lines.join("\n")}` : ""
        }`,
      },
    ],
  };
}

/**
 * "Run again" for a failed research job (spec section 2): the failed row is
 * terminal on its key — replaying it would fail the same way — so this
 * composes a NEW idempotency key against the same saved snapshot and
 * question. It is explicitly a new charge; the label carries that honesty.
 */
export function retryAssistantResearch(id: string) {
  const state = useProductionAssistant.getState();
  if (state.researchRunning[id] || state.running[id]) return;
  const value = session(id);
  const failed = value.researchPending;
  if (!failed) return;
  setResearchRunning(id, true);
  publish(
    {
      ...value,
      researchPending: {
        ...failed,
        request: { ...failed.request, idempotencyKey: crypto.randomUUID() },
        jobId: null,
        startedAt: Date.now(),
      },
      researchError: null,
      researchFaultCode: null,
    },
    true,
  );
  void executeResearch(id);
}

/**
 * "Add research as context" for a completed research job: appends one compact,
 * Parallel-labelled note message (job id, question, up to six cited sources)
 * into the conversation so the next ask carries it. Idempotent per job —
 * the note's stable per-job id makes repeat clicks no-ops — and it never
 * recharges credits or re-runs anything.
 */
export function addResearchContext(id: string, jobId: string): void {
  if (useProductionAssistant.getState().running[id]) return;
  if (useSlate.getState().project.id !== id) return;
  const value = session(id);
  const noteId = researchNoteMessageId(jobId);
  if (value.messages.some((message) => message.id === noteId)) return;
  const delivered = value.messages.find(
    (message) =>
      message.provider === "parallel" && !message.researchNoteJobId && message.jobId === jobId,
  );
  // A row without its delivered result (or without sources yet) has nothing
  // honest to add; the button is disabled before this point.
  if (!delivered) return;
  const sources = (delivered.sources ?? []).slice(0, 6);
  const message: AssistantMessage = {
    id: noteId,
    role: "assistant",
    provider: "parallel",
    researchNoteJobId: jobId,
    jobId,
    text: researchContextNote(jobId, delivered.question, sources),
    sources,
  };
  publish({ ...value, error: null, messages: [...value.messages, message].slice(-24) }, true);
}
/**
 * Start a fresh conversation without touching production data: keeps the
 * typed draft, issue-dismissal state and every reports/Activity surface;
 * clears the conversation feed, the composer's mention picks, saved recovery
 * state, ephemeral streaming text and the report/answer binding (report).
 * Idempotent, and never interrupts a live ask or research job.
 */
export function newAssistantSession(id: string) {
  const state = useProductionAssistant.getState();
  if (state.running[id] || state.researchRunning[id]) return;
  publish(
    {
      ...session(id),
      messages: [],
      pending: null,
      researchPending: null,
      researchError: null,
      researchFaultCode: null,
      report: null,
      error: null,
      canRestart: false,
      mentions: [],
    },
    true,
  );
  useProductionAssistant.setState((s) => ({
    streaming: { ...s.streaming, [id]: null },
  }));
  // The Copilot's run history lives beside the chat: New session clears it too.
  usePageAgentRuns.getState().clearRuns(id);
}

/** Append one streamed answer delta; display-only, capped, never persisted. */
/**
 * Reports live server-side: after a completed ask or research job lands, or
 * after a successful project save repairs the visitor session, refresh an
 * already-opened listing once. Projects that never opened the Activity tab
 * get no background fetches.
 */
function refreshReportsIfLoaded(id: string) {
  if (useProductionAssistant.getState().reports[id]) void loadReports(id);
}

if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
  // Lazy ./save: the store's synchronous import contract is asserted by
  // production-assistant-import.test.ts, so this dependency loads only in a
  // real browser (a save happening before this resolves is simply not seen).
  void import("./save").then(({ subscribeSave }) => {
    // A successful project save commits the data the cinema session depends
    // on: right after "saving" → "saved", retry any reports listing that
    // previously failed (e.g. the fresh-visitor first load that ran before
    // the session existed). Only errored listings are retried, so ordinary
    // saves stay free of extra requests.
    let previousStatus: string | null = null;
    subscribeSave((snapshot) => {
      const wasSaving = previousStatus === "saving";
      previousStatus = snapshot.status;
      if (!(snapshot.status === "saved" && wasSaving)) return;
      const reports = useProductionAssistant.getState().reports;
      for (const [projectId, listing] of Object.entries(reports)) {
        if (listing.error) void loadReports(projectId);
      }
    });
  });
}

/**
 * Load the Activity "Reports" listing for a project. Called when the Activity
 * tab opens; a backend without the reports endpoints degrades to an empty
 * "No reports yet." listing with the unavailability reason kept beside it.
 */
export async function loadReports(id: string) {
  const state = useProductionAssistant.getState();
  const current = state.reports[id];
  if (current?.loading) return;
  useProductionAssistant.setState((s) => ({
    reports: {
      ...s.reports,
      [id]: {
        ...(s.reports[id] ?? { items: null, error: null }),
        // A previous failure is never terminal: each Activity mount starts a
        // clean load (e.g. the visitor session is established by the first
        // project save after the tab was opened), and only an in-flight fetch
        // is guarded against re-entry.
        error: null,
        loading: true,
      },
    },
  }));
  try {
    const items = await getReports(id);
    useProductionAssistant.setState((s) => ({
      reports: {
        ...s.reports,
        [id]: {
          items,
          loading: false,
          error: null,
        },
      },
    }));
  } catch (failure) {
    useProductionAssistant.setState((s) => ({
      reports: {
        ...s.reports,
        [id]: {
          items: s.reports[id]?.items ?? null,
          loading: false,
          error:
            failure instanceof Error
              ? failure.message
              : "The reports list could not be loaded.",
        },
      },
    }));
  }
}
