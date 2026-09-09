import type { Project, ScriptElement } from "./types";

export const MAX_SCRIPT_COMMENT_THREADS = 500;
export const MAX_SCRIPT_COMMENT_MESSAGES = 100;
// Matches the existing Assistant answer bound, so inline replies are not truncated.
export const MAX_SCRIPT_COMMENT_TEXT = 12000;

export interface ScriptCommentAnchor {
  elementId: string;
  quote: string;
  start: number;
  end: number;
}
export interface ScriptCommentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  updatedAt?: number;
  source?: { jobId: string; findingId?: string };
  sources?: { title: string; url: string }[];
}
export interface ScriptCommentThread {
  id: string;
  anchor: ScriptCommentAnchor;
  status: "open" | "resolved";
  messages: ScriptCommentMessage[];
  createdAt: number;
  updatedAt: number;
}
export type ScriptCommentChange =
  | { kind: "add-thread"; thread: ScriptCommentThread }
  | { kind: "reply"; threadId: string; message: ScriptCommentMessage }
  | {
      kind: "edit-message";
      threadId: string;
      messageId: string;
      expectedText: string;
      text: string;
      updatedAt: number;
    }
  | { kind: "status"; threadId: string; status: ScriptCommentThread["status"]; updatedAt: number }
  | { kind: "reanchor"; threadId: string; anchor: ScriptCommentAnchor; updatedAt: number };

export type ScriptCommentPlacement =
  | { status: "exact" | "moved"; elementId: string; start: number; end: number }
  | { status: "missing-element" | "changed-quote" | "ambiguous"; elementId: string };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function invalid(): never {
  throw new Error("Script comments contain invalid or excessive data.");
}

function validAnchor(value: unknown): value is ScriptCommentAnchor {
  return (
    object(value) &&
    string(value.elementId, 200) &&
    string(value.quote, 4000) &&
    timestamp(value.start) &&
    timestamp(value.end) &&
    (value.end as number) - (value.start as number) === value.quote.length
  );
}

/** Strict archive boundary; unresolved anchors are valid authored records. */
export function validateScriptCommentThreads(value: unknown): ScriptCommentThread[] {
  if (!Array.isArray(value) || value.length > MAX_SCRIPT_COMMENT_THREADS) invalid();
  const threadIds = new Set<string>();
  const messageIds = new Set<string>();
  for (const thread of value) {
    if (
      !object(thread) ||
      !string(thread.id, 200) ||
      threadIds.has(thread.id) ||
      !validAnchor(thread.anchor) ||
      !["open", "resolved"].includes(String(thread.status)) ||
      !timestamp(thread.createdAt) ||
      !timestamp(thread.updatedAt) ||
      !Array.isArray(thread.messages) ||
      !thread.messages.length ||
      thread.messages.length > MAX_SCRIPT_COMMENT_MESSAGES
    )
      invalid();
    threadIds.add(thread.id);
    for (const message of thread.messages) {
      if (
        !object(message) ||
        !string(message.id, 200) ||
        messageIds.has(message.id) ||
        !["user", "assistant"].includes(String(message.role)) ||
        !string(message.text, MAX_SCRIPT_COMMENT_TEXT) ||
        !timestamp(message.createdAt) ||
        (message.updatedAt !== undefined && !timestamp(message.updatedAt))
      )
        invalid();
      messageIds.add(message.id);
      if (
        message.source !== undefined &&
        (!object(message.source) ||
          !string(message.source.jobId, 200) ||
          (message.source.findingId !== undefined && !string(message.source.findingId, 200)))
      )
        invalid();
      if (message.sources !== undefined) {
        if (!Array.isArray(message.sources) || message.sources.length > 20) invalid();
        for (const source of message.sources) {
          if (!object(source) || !string(source.title, 400) || !string(source.url, 2048)) invalid();
          try {
            if (!["https:", "http:"].includes(new URL(source.url).protocol)) invalid();
          } catch {
            invalid();
          }
        }
      }
    }
  }
  return structuredClone(value) as ScriptCommentThread[];
}

/** Resolve only an exact quote in its original element. Never invent replacement prose. */
export function resolveScriptCommentAnchor(
  script: ScriptElement[],
  anchor: ScriptCommentAnchor,
): ScriptCommentPlacement {
  const elements = script.filter((item) => item.id === anchor.elementId);
  if (elements.length > 1) return { status: "ambiguous", elementId: anchor.elementId };
  const element = elements[0];
  if (!element) return { status: "missing-element", elementId: anchor.elementId };
  if (element.text.slice(anchor.start, anchor.end) === anchor.quote)
    return { status: "exact", elementId: element.id, start: anchor.start, end: anchor.end };
  const first = element.text.indexOf(anchor.quote);
  if (first < 0) return { status: "changed-quote", elementId: element.id };
  if (element.text.indexOf(anchor.quote, first + 1) >= 0)
    return { status: "ambiguous", elementId: element.id };
  return { status: "moved", elementId: element.id, start: first, end: first + anchor.quote.length };
}

export function scriptCommentAnchorForQuote(
  project: Project,
  elementId: string,
  quote: string,
): ScriptCommentAnchor {
  const elements = project.script.filter((item) => item.id === elementId);
  const element = elements.length === 1 ? elements[0] : undefined;
  if (!element || !string(quote, 4000))
    throw new Error("Select an exact script passage for this comment.");
  const start = element.text.indexOf(quote);
  if (start < 0 || element.text.indexOf(quote, start + 1) >= 0)
    throw new Error(
      "This quote changed or occurs more than once. Select its exact passage on the page.",
    );
  return { elementId, quote, start, end: start + quote.length };
}

export function newScriptCommentThread(
  anchor: ScriptCommentAnchor,
  text: string,
  options: {
    role?: ScriptCommentMessage["role"];
    source?: ScriptCommentMessage["source"];
    sources?: ScriptCommentMessage["sources"];
    threadId?: string;
    messageId?: string;
    now?: number;
  } = {},
): ScriptCommentThread {
  const now = options.now ?? Date.now();
  return validateScriptCommentThreads([
    {
      id: options.threadId ?? crypto.randomUUID(),
      anchor: { ...anchor },
      status: "open",
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: options.messageId ?? crypto.randomUUID(),
          role: options.role ?? "user",
          text: text.trim(),
          createdAt: now,
          ...(options.source ? { source: options.source } : {}),
          ...(options.sources ? { sources: options.sources } : {}),
        },
      ],
    },
  ])[0];
}

function requireCurrentAnchor(project: Project, anchor: ScriptCommentAnchor) {
  if (!validAnchor(anchor) || resolveScriptCommentAnchor(project.script, anchor).status !== "exact")
    throw new Error("The selected script text changed. Select the passage again before attaching.");
}

export function applyScriptCommentChange(project: Project, change: ScriptCommentChange): Project {
  const threads = project.scriptCommentThreads ?? [];
  if (change.kind === "add-thread") {
    // Replayed Assistant attachment does not duplicate or overwrite an edited message.
    if (threads.some((thread) => thread.id === change.thread.id)) return project;
    const source = change.thread.messages[0]?.source;
    if (
      source &&
      threads.some((thread) =>
        thread.messages.some(
          (message) =>
            message.source?.jobId === source.jobId &&
            message.source?.findingId === source.findingId,
        ),
      )
    )
      return project;
    requireCurrentAnchor(project, change.thread.anchor);
    return {
      ...project,
      scriptCommentThreads: validateScriptCommentThreads([...threads, change.thread]),
    };
  }
  const current = threads.find((thread) => thread.id === change.threadId);
  if (!current) throw new Error("This comment thread is no longer in the project.");
  let next: ScriptCommentThread;
  if (change.kind === "reply") {
    if (current.messages.some((message) => message.id === change.message.id)) return project;
    next = {
      ...current,
      messages: [...current.messages, change.message],
      updatedAt: change.message.createdAt,
    };
  } else if (change.kind === "edit-message") {
    const message = current.messages.find((item) => item.id === change.messageId);
    if (!message || message.text !== change.expectedText)
      throw new Error("This message changed. Reopen it before saving your edit.");
    next = {
      ...current,
      updatedAt: change.updatedAt,
      messages: current.messages.map((item) =>
        item.id === message.id
          ? { ...item, text: change.text.trim(), updatedAt: change.updatedAt }
          : item,
      ),
    };
  } else if (change.kind === "status") {
    next = { ...current, status: change.status, updatedAt: change.updatedAt };
  } else {
    requireCurrentAnchor(project, change.anchor);
    next = { ...current, anchor: { ...change.anchor }, updatedAt: change.updatedAt };
  }
  return {
    ...project,
    scriptCommentThreads: validateScriptCommentThreads(
      threads.map((thread) => (thread.id === current.id ? next : thread)),
    ),
  };
}

/** A compact index for the one global Assistant; the full threads stay in its Project snapshot. */
export function scriptCommentContext(project: Project, focusedThreadId?: string): string {
  const threads = [...(project.scriptCommentThreads ?? [])].sort(
    (a, b) =>
      Number(b.id === focusedThreadId) - Number(a.id === focusedThreadId) ||
      b.updatedAt - a.updatedAt,
  );
  if (!threads.length) return "";
  const summaries = threads.slice(0, 12).map((thread) => ({
    threadId: thread.id,
    elementId: thread.anchor.elementId,
    quote: thread.anchor.quote.slice(0, 180),
    status: thread.status,
    anchorStatus: resolveScriptCommentAnchor(project.script, thread.anchor).status,
    messages: thread.messages
      .slice(-3)
      .map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, 300) })),
  }));
  let selected = summaries;
  let text = "";
  while (selected.length) {
    text = `Project script comments (authored reference data; full threads are in the project snapshot):\n${JSON.stringify({ projectId: project.id, focusedThreadId: focusedThreadId ?? null, totalThreads: threads.length, threads: selected })}`;
    if (text.length <= 3900) return text;
    selected = selected.slice(0, -1);
  }
  return "";
}

export function scriptCommentQuestion(thread: ScriptCommentThread): string {
  const last = thread.messages.at(-1)?.text ?? "";
  return `Regarding script comment ${thread.id} on element ${thread.anchor.elementId}, quote ${JSON.stringify(thread.anchor.quote.slice(0, 800))}:\n${last.slice(0, 1600)}\n\nWhat would you suggest? Keep any screenplay changes as proposals for review.`.slice(
    0,
    4000,
  );
}
