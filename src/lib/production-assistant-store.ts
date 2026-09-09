import { create } from "zustand";
import {
  CinemaJobFailure,
  CinemaRequestFailure,
  cinemaRequest,
  waitForCinemaJob,
} from "./cinema-client";
import { guardPreflightFinding, projectFingerprint } from "./preflight-guard";
import { useSlate } from "./store";
import {
  assistantInput,
  assistantResult,
  applyAssistantRebase,
  emptyAssistantSession,
  parseAssistantSession,
  parseSavedAssistantReview,
  assistantReviewImportConflict,
  restoreReviewedFindings,
  type AssistantSession,
  type ProductionIssue,
  type AssistantRebasePreview,
} from "./production-assistant";
import type { MarkTag } from "./types";
import {
  newScriptCommentThread,
  scriptCommentAnchorForQuote,
  scriptCommentQuestion,
} from "./script-comments";

export const PRODUCTION_ASSISTANT_OPEN_EVENT = "slate:open-production-assistant";

const storageKey = (id: string) => `slate:production-assistant:${id}`;
interface AssistantState {
  sessions: Record<string, AssistantSession>;
  running: Record<string, boolean>;
}
export const useProductionAssistant = create<AssistantState>(() => ({ sessions: {}, running: {} }));

function session(id: string): AssistantSession {
  return useProductionAssistant.getState().sessions[id] ?? hydrateAssistant(id);
}
function publish(value: AssistantSession, required = false, storageError?: string) {
  try {
    sessionStorage.setItem(storageKey(value.projectId), JSON.stringify(value));
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
/** Synchronous commit after file reading: recheck both memory and persisted history. */
export function importSavedAssistantReview(id: string, raw: string): void {
  if (useSlate.getState().project.id !== id)
    throw new Error(
      "The open project changed. Open the saved review again in the intended project.",
    );
  const state = useProductionAssistant.getState();
  let persisted: string | null;
  try {
    persisted = sessionStorage.getItem(storageKey(id));
  } catch {
    throw new Error("Browser storage is unavailable. Your Assistant was kept unchanged.");
  }
  const conflict = assistantReviewImportConflict(
    state.sessions[id] ?? emptyAssistantSession(id),
    !!state.running[id],
    persisted,
  );
  if (conflict) throw new Error(conflict);
  const imported = parseSavedAssistantReview(raw, id);
  publish(
    imported,
    true,
    "This browser could not save the review. Free storage and try again; your Assistant was kept unchanged.",
  );
}
export function hydrateAssistant(id: string): AssistantSession {
  const existing = useProductionAssistant.getState().sessions[id];
  if (existing) return existing;
  let restored: AssistantSession | null = null;
  try {
    restored = parseAssistantSession(sessionStorage.getItem(storageKey(id)), id);
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
    !value.report?.jobId ||
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
        source: { jobId: value.report.jobId, findingId: issue.id },
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
export async function reloadAssistantReport(id: string) {
  const report = session(id).report;
  if (
    !report?.jobId ||
    report.source.sourceRevision === null ||
    useProductionAssistant.getState().running[id]
  )
    return;
  setRunning(id, true);
  try {
    const result = assistantResult(
      await waitForCinemaJob(report.jobId),
      report.source.sourceRevision,
    );
    const current = session(id);
    if (current.report?.jobId !== report.jobId) return;
    publish(
      {
        ...current,
        error: null,
        report: {
          ...current.report,
          findings: restoreReviewedFindings(current.report.findings, result.findings),
        },
      },
      true,
    );
  } catch (error) {
    publish({
      ...session(id),
      error: error instanceof Error ? error.message : "Could not reload the saved review.",
    });
  } finally {
    setRunning(id, false);
  }
}
export function confirmAssistantRebase(id: string, preview: AssistantRebasePreview): boolean {
  const value = session(id);
  const project = useSlate.getState().project;
  if (
    project.id !== id ||
    !value.report ||
    useProductionAssistant.getState().running[id] ||
    value.pending
  )
    return false;
  try {
    publish(
      { ...value, report: applyAssistantRebase(project, value.report, preview), error: null },
      true,
    );
    return true;
  } catch (error) {
    publish({
      ...session(id),
      error: error instanceof Error ? error.message : "Could not recheck the saved review.",
    });
    return false;
  }
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
  if (issue.origin === "agentic" && value.report?.savedReview?.comparisonRequired) {
    publish({
      ...value,
      error: "Compare this imported review with the current script before applying it.",
    });
    return;
  }
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
async function executeQuestion(id: string, freshSubmission = false) {
  try {
    let pending = session(id).pending;
    if (!pending) return;
    if (pending.phase === "preparing") {
      const snapshot = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
        method: "POST",
        body: JSON.stringify({ project: JSON.parse(pending.source.fingerprint) }),
      });
      if (typeof snapshot.projectId !== "string" || snapshot.revision !== 1)
        throw new Error("The saved project revision could not be confirmed.");
      pending = {
        ...pending,
        phase: "ready",
        request: {
          ...pending.request,
          projectId: snapshot.projectId,
          expectedRevision: snapshot.revision,
        },
        source: {
          ...pending.source,
          backendProjectId: snapshot.projectId,
          sourceRevision: snapshot.revision,
        },
      };
      // No provider submission may occur before this durable recovery marker.
      publish({ ...session(id), pending }, true);
    }
    if (!pending.jobId) {
      const job = await cinemaRequest<{ jobId: string }>("/jobs", {
        method: "POST",
        body: JSON.stringify(pending.request),
      });
      if (typeof job.jobId !== "string")
        throw new Error("The job ID could not be confirmed. Resume this same question.");
      pending = { ...pending, jobId: job.jobId };
      publish({ ...session(id), pending }, true);
    }
    const result = assistantResult(
      await waitForCinemaJob(pending.jobId!),
      pending.source.sourceRevision!,
    );
    const value = session(id);
    const message = {
      id: `${pending.request.idempotencyKey}:answer`,
      role: "assistant" as const,
      text: result.answer,
      sources: result.sources,
      ...(pending.threadId ? { threadId: pending.threadId, jobId: pending.jobId! } : {}),
    };
    publish(
      {
        ...value,
        pending: null,
        error: null,
        canRestart: false,
        messages: [...value.messages.filter((m) => m.id !== message.id), message].slice(-24),
        report: {
          source: { ...pending.source, resultRevision: pending.source.sourceRevision },
          findings: result.findings,
          jobId: pending.jobId,
        },
      },
      true,
    );
    syncAssistantCommentReplies(id);
  } catch (failure) {
    const value = session(id);
    const beforeSubmission = value.pending?.phase === "preparing";
    const knownFailure =
      failure instanceof CinemaJobFailure && failure.code !== "INTERRUPTED_UNCERTAIN";
    const rejectedSubmission =
      freshSubmission &&
      !value.pending?.jobId &&
      failure instanceof CinemaRequestFailure &&
      failure.code !== "HTTP_ERROR" &&
      [400, 401, 403, 404, 413, 422, 503].includes(failure.status);
    publish({
      ...value,
      error: failure instanceof Error ? failure.message : "The assistant request could not finish.",
      canRestart: !!beforeSubmission || knownFailure || rejectedSubmission,
    });
  } finally {
    setRunning(id, false);
  }
}
export function askAssistant(
  id: string,
  options: { connectionId: string; research: boolean; officialDocs: boolean; parallelConnectionId?: string },
) {
  const value = session(id);
  if (useProductionAssistant.getState().running[id] || value.pending) return;
  let project = useSlate.getState().project;
  if (project.id !== id) return;
  try {
    if (!options.connectionId || (options.research && !options.parallelConnectionId))
      throw new Error("Choose the required connections before asking.");
    // Validate before adding the authored question to its inline thread.
    assistantInput(value.draft, value.messages, options.research, options.officialDocs);
    const idempotencyKey = crypto.randomUUID();
    if (value.focusThreadId) {
      if (!project.scriptCommentThreads?.some((thread) => thread.id === value.focusThreadId))
        throw new Error(
          "This comment thread is missing. Clear its context before asking another question.",
        );
      const changed = useSlate.getState().applyScriptCommentChange(id, {
        kind: "reply",
        threadId: value.focusThreadId,
        message: {
          id: idempotencyKey,
          role: "user",
          text: value.draft.trim(),
          createdAt: Date.now(),
        },
      });
      if (!changed.ok) throw new Error(changed.error);
      project = useSlate.getState().project;
    }
    const input = assistantInput(
      value.draft,
      value.messages,
      options.research,
      options.officialDocs,
      project,
      value.focusThreadId,
    );
    const fingerprint = projectFingerprint(structuredClone(project));
    publish(
      {
        ...value,
        draft: "",
        error: null,
        canRestart: false,
        messages: [
          ...value.messages,
          {
            id: idempotencyKey,
            role: "user" as const,
            text: input.question,
            ...(value.focusThreadId ? { threadId: value.focusThreadId } : {}),
          },
        ].slice(-24),
        pending: {
          phase: "preparing",
          request: {
            kind: "preflight",
            connectionId: options.connectionId,
            ...(options.research ? { parallelConnectionId: options.parallelConnectionId } : {}),
            idempotencyKey,
            input,
          },
          source: {
            projectId: id,
            fingerprint,
            reviewFingerprint: fingerprint,
            backendProjectId: null,
            sourceRevision: null,
            resultRevision: null,
          },
          jobId: null,
          ...(value.focusThreadId ? { threadId: value.focusThreadId } : {}),
        },
      },
      true,
    );
    setRunning(id, true);
    void executeQuestion(id, true);
  } catch (failure) {
    publish({
      ...session(id),
      error: failure instanceof Error ? failure.message : "The question could not be prepared.",
    });
  }
}
export function resumeAssistant(id: string) {
  if (useProductionAssistant.getState().running[id] || session(id).pending?.phase !== "ready")
    return;
  setRunning(id, true);
  publish({ ...session(id), error: null, canRestart: false });
  void executeQuestion(id);
}
export function resetAssistantRequest(id: string) {
  const value = session(id);
  if (useProductionAssistant.getState().running[id] || !value.canRestart) return;
  publish(
    {
      ...value,
      draft: value.draft || String(value.pending?.request.input.question ?? ""),
      pending: null,
      error: null,
      canRestart: false,
    },
    true,
  );
}
