import type { ToolConfirmationRequest } from "@kylebrodeur/page-agent-core";

/**
 * Page Agent runtime host policy and backend chat binding.
 *
 * The only LLM endpoint allowed from the browser is the same-origin cinema
 * gateway. No API key lives in the browser: the backend maps the advisory
 * model name to its provider configuration under the visitor's session.
 */

export const PAGE_AGENT_CHAT_ENDPOINT = "/api/cinema/assistant/chat/completions";

/** Confirmed backend contract: the agent loop is served under name "slate-production-assistant". */
export const PAGE_AGENT_MODEL = "slate-production-assistant";

/**
 * Confirmation callback passed to PageAgentCore as onConfirmTool.
 * @see ToolConfirmationRequest
 */
export type PageAgentConfirmationHandler = (
  request: ToolConfirmationRequest,
  options?: { signal: AbortSignal },
) => Promise<boolean>;

/**
 * Identity data every page-agent chat request body carries. The backend
 * contract binds requests to these identifiers; headers do not satisfy it.
 */
export interface PageAgentSessionBinding {
  /** projectId of the project snapshot saved before the run (integer revision below). */
  projectId(): string;
  /** Stable identity of the browser page for this panel instance. */
  pageId(): string;
  /** Current agent run id (PageAgentCore.taskId); set while a run is in flight. */
  runId(): string;
  /** Visitor-owned cinema connection selected for this run. */
  connectionId(): string;
  /** Positive integer revision returned by POST /api/cinema/projects for the saved snapshot. */
  expectedRevision(): number;
  /** Current studio view, scoping the macro tool catalog for fast completions. */
  view(): string;
  /** Parallel research toggled on: makes search_parallel available to the run. */
  researchEnabled(): boolean;
}

/** The panel's saved-snapshot binding state, reused while the local project is unchanged. */
export interface SavedProjectBinding {
  projectId: string;
  revision: number;
  /** Serialized fingerprint of the local project the snapshot was saved from; memory-only. */
  fingerprint: string;
}

/** Cinema gateway error envelope (error.{message,code}); OpenAI-style error.message also accepted. */
export class PageAgentChatFailure extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PageAgentChatFailure";
    this.status = status;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.constructor === Object;
}

function readErrorMessage(value: unknown, status: number): string {
  if (isPlainObject(value) && isPlainObject(value.error) && typeof value.error.message === "string" && value.error.message.trim()) {
    return value.error.message;
  }
  if (status === 401 || status === 403) {
    return `Page Agent chat is not authorized for this session (HTTP ${status}).`;
  }
  if (status === 404) {
    return "The Page Agent chat endpoint does not exist (HTTP 404). The backend page-agent service is not deployed for this session.";
  }
  return `Page Agent chat request failed (HTTP ${status}).`;
}

/**
 * Structural guard for the backend contract: a non-stream OpenAI-compatible
 * chat completion with at least one choice carrying an assistant message.
 */
export function isValidChatCompletion(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.choices) || value.choices.length < 1) return false;
  const first = value.choices[0];
  if (!isPlainObject(first) || !isPlainObject(first.message)) return false;
  const message = first.message;
  if (!(message.content === null || typeof message.content === "string")) return false;
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isPlainObject(call) || !/^[a-zA-Z0-9_-]+$/.test(String(call.id ?? ""))) return false;
    }
  } else if (message.tool_calls !== undefined) {
    return false;
  }
  return true;
}

/**
 * Same-origin chat fetch for LLMConfig.customFetch. Rewrites the destination to
 * {@link PAGE_AGENT_CHAT_ENDPOINT} and extends the request body with the
 * confirmed binding fields before the LLM runtime sees anything.
 */
export function createPageAgentChatFetch(binding: PageAgentSessionBinding): typeof globalThis.fetch {
  // Capture the studio origin ONCE when the fetch is created (the Assistant
  // panel mounts on the studio page). Reading window.location.origin at fetch
  // time breaks when the page navigates away (e.g. the Google OAuth consent
  // redirect), which made the Copilot's LLM calls fail with "Network request
  // failed" mid-run.
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return async (input, init) => {
    const rawBody = typeof init?.body === "string" ? init.body : null;
    if (rawBody === null) {
      throw new PageAgentChatFailure("The Page Agent chat request carried no JSON body.", 400);
    }
    let request: unknown;
    try {
      request = JSON.parse(rawBody);
    } catch {
      throw new PageAgentChatFailure("The Page Agent chat request body is not valid JSON.", 400);
    }
    if (!isPlainObject(request)) {
      throw new PageAgentChatFailure("The Page Agent chat request body must be a JSON object.", 400);
    }

    const projectId = binding.projectId();
    const connectionId = binding.connectionId();
    const runId = binding.runId();
    const expectedRevision = binding.expectedRevision();
    if (!projectId) throw new Error("The Page Agent chat request has no saved project snapshot to bind to.");
    if (!connectionId) throw new Error("A connected Google Cloud account is required for the Page Agent.");
    if (!runId) throw new Error("The Page Agent chat request has no active run to bind to.");
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("The Page Agent chat request has no saved project revision to bind to.");
    }

    // Backend-contract binding fields; tool_choice/parallel_tool_calls are
    // re-asserted because provider model patches may remove them upstream.
    const body = {
      ...request,
      model: PAGE_AGENT_MODEL,
      connectionId,
      projectId,
      pageId: binding.pageId(),
      runId,
      expectedRevision,
      view: binding.view(),
      researchEnabled: binding.researchEnabled(),
      parallel_tool_calls: false,
      tool_choice: request.tool_choice ?? "required",
    };
    const response = await globalThis.fetch(new URL(PAGE_AGENT_CHAT_ENDPOINT, origin).toString(), {
      ...init,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...init?.headers },
      credentials: "include",
    });

    const text = await response.text();
    let parsed: unknown = null;
    let unparsable = false;
    try {
      parsed = JSON.parse(text);
    } catch {
      unparsable = true;
    }
    if (!response.ok) {
      throw new PageAgentChatFailure(readErrorMessage(parsed, response.status), response.status);
    }
    if (unparsable || !isValidChatCompletion(parsed)) {
      throw new PageAgentChatFailure(
        "The Page Agent backend returned an unreadable chat completion.",
        response.status,
      );
    }
    // SAFETY: isValidChatCompletion established the response shape; the same
    // validated bytes are re-serialized so the runtime sees a fresh Response.
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}