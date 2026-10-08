import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Loader2,
  MessageSquare,
  ScanSearch,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PageAgentCore,
  type AgentActivity,
  type AgentStatus,
  type HistoricalEvent,
  type ToolConfirmationRequest,
} from "@kylebrodeur/page-agent-core";
import type { PageController } from "@kylebrodeur/page-agent-page-controller";
import { openSettingsTab } from "@/components/app/cinema-connections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssistantMarkdown } from "@/components/app/assistant-markdown";
import { SidebarDock, type SidebarDockTab } from "@/components/app/sidebar-dock";
import {
  recordRunFinished,
  recordRunStarted,
  usePageAgentRuns,
  type PageAgentRun,
} from "@/lib/page-agent/page-agent-runs";
import {
  createPageAgentChatFetch,
  PAGE_AGENT_MODEL,
  type PageAgentConfirmationHandler,
  type SavedProjectBinding,
} from "@/lib/page-agent/page-agent-runtime";
import { buildStudioPageAgentTools } from "@/lib/page-agent/studio-tool-adapter";
import { executeStudioTool } from "@/lib/webmcp/studio-tools";
import { checkStageContinuity, synthesizeStagePrompt } from "@/lib/stage-copilot";
import { toast } from "sonner";
import {
  cinemaRequest,
  getCinemaConnections,
  getCinemaHealth,
  type CinemaConnection,
} from "@/lib/cinema-client";
import { useGenerationCredits } from "@/lib/use-generation-credits";
import { localPreflight } from "@/lib/preflight";
import { guardPreflightFinding, projectFingerprint } from "@/lib/preflight-guard";
import { usePreflight } from "@/lib/preflight-store";
import {
  acceptAssistantIssue,
  addAssistantMention,
  addResearchContext,
  appendAssistantUserMessage,
  appendCopilotMessage,
  attachAssistantComment,
  clearAssistantCommentContext,
  dismissAssistantIssue,
  dismissAssistantResearch,
  editAssistantProposal,
  hydrateAssistant,
  newAssistantSession,
  removeAssistantMention,
  restoreAssistantIssues,
  resumeAssistantResearch,
  retryAssistantResearch,
  runParallelSearchTool,
  setAssistantComposerResearch,
  setAssistantDraft,
  submitResearchSuggestion,
  syncAssistantCommentReplies,
  useProductionAssistant,
} from "@/lib/production-assistant-store";
import {
  ASSISTANT_CONTEXT_REFS_MAX,
  assistantMentionPicker,
  CHECK_RESEARCH_DOMAIN_LABELS,
  checkResearchQuestion,
  checkResearchSources,
  effectiveContextRefs,
  emptyAssistantSession,
  contextRefLabels,
  mentionPickedDraft,
  mentionQuery,
  newestMatchingCheckResearch,
  productionIssues,
  researchDurationLabel,
  researchNoteMessageId,
  reportRelativeTime,
  type AssistantMessage,
  type AssistantSession,
  type ProductionIssue,
  PARALLEL_RESEARCH_NOTE,
  redactUrlQuery,
} from "@/lib/production-assistant";
import { useSlate } from "@/lib/store";
import { cn } from "@/lib/utils";
import { MARK_TAGS, type MarkTag, type Project, type Shot, type View } from "@/lib/types";

/**
 * Single source of truth for Production Assistant session state across the
 * workspace bar, the modal fallback, and the co-pilot sidebar. The store
 * (`@/lib/production-assistant-store`) keeps every provider/research action and
 * its localStorage recovery; this context only shares the derived view state.
 */
interface ProductionAssistantContextValue {
  project: Project;
  session: AssistantSession;
  issues: ProductionIssue[];
  running: boolean;
  researchRunning: boolean;
}

const EMPTY_RUNS: PageAgentRun[] = [];

/**
 * The shot a director-continuity surface focuses on: the selected shot, else
 * the first shot, matching the retired co-pilot dock's selection fallback.
 */
function useFocusedShot(): Shot | null {
  return useSlate(
    (state) => state.project.shots.find((item) => item.id === state.selectedId) ?? state.project.shots[0] ?? null,
  );
}

/**
 * One-line composer context label: the current studio surface (view) plus the
 * current selection. Pure projection of store state — it rederives on every
 * view/selection change and never mirrors state locally.
 */
function assistantContextLabel(view: View, shot: Shot | null, scriptLines: number): string {
  switch (view) {
    case "script":
      return `Script · ${scriptLines} lines`;
    case "stage":
      return shot ? `Stage · ${shot.setup}${shot.title ? ` ${shot.title}` : ""}` : "Stage";
    case "edit":
      return shot ? `Edit · shot ${shot.number}` : "Edit";
    case "render":
      return "Render";
  }
}

/** Per-surface quick prompts: tap fills the draft only; sending stays with the filmmaker. */
const VIEW_QUICK_PROMPTS: Record<View, string[]> = {
  script: ["Summarize this scene", "Find continuity issues"],
  stage: ["Check this setup's blocking", "Suggest framing"],
  edit: ["Review cut timing", "Suggest trims"],
  render: ["QC the current render"],
};

/**
 * Director continuity for the focused shot, using the same pure checks the
 * Stage Co-Pilot dock surfaces. Cards are advisory: warn in amber, info neutral.
 */
export function DirectorContinuitySection() {
  const shot = useFocusedShot();
  const project = useSlate((s) => s.project);
  const checks = useMemo(
    () => (shot ? checkStageContinuity(shot, project.shots, project.floor) : []),
    [project, shot],
  );
  if (!shot) return null;
  return (
    <section aria-label="Director continuity" className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Director continuity · setup {shot.setup}
      </h4>
      {checks.map((check) => (
        <div
          key={check.id}
          className={cn(
            "rounded-md border p-2 text-xs",
            check.severity === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : "border-border bg-card text-foreground",
          )}
        >
          <div className="flex items-start gap-1.5">
            {check.severity === "warn" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="text-[11px] font-medium">{check.title}</p>
              <p
                className={cn(
                  "mt-0.5",
                  check.severity === "warn" ? "text-amber-700 dark:text-amber-300/80" : "text-muted-foreground",
                )}
              >
                {check.detail}
              </p>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * Stage prompt synthesizer for the focused shot: a copy-only suggestion. It
 * never writes the authored effective generation prompt.
 */
export function StagePromptCard() {
  const shot = useFocusedShot();
  if (!shot) return null;
  const prompt = synthesizeStagePrompt(shot);
  const copy = () => {
    const write = navigator.clipboard?.writeText?.(prompt);
    if (write) {
      void write.then(
        () => toast.success("Stage prompt copied"),
        () => toast.error("Clipboard blocked; select and copy the prompt text."),
      );
    } else {
      toast.error("Clipboard unavailable in this browser; select and copy the prompt text.");
    }
  };
  return (
    <div aria-label="Stage prompt synthesizer" className="space-y-2 rounded-md border border-border bg-secondary/20 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Stage prompt · setup {shot.setup}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={copy}
          title="Copy synthesized stage prompt"
          aria-label="Copy synthesized stage prompt"
        >
          <Copy />
        </Button>
      </div>
      <p className="select-all whitespace-pre-wrap break-words rounded border border-border/50 bg-background/80 p-2 font-mono text-xs leading-relaxed">
        {prompt}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Copy this suggestion to review it alongside the effective image prompt; the
        synthesized card never changes the authored prompt.
      </p>
    </div>
  );
}

/** Compact composer affordance for the synthesized stage prompt. */
export function StagePromptChip() {
  const shot = useFocusedShot();
  const { project } = useProductionAssistantContext();
  if (!shot) return null;
  const prompt = synthesizeStagePrompt(shot);
  return (
    <div
      aria-label="Stage prompt synthesizer"
      title="Copy-only suggestion; never changes the authored prompt."
      className="flex items-center gap-2 text-[10px] text-muted-foreground"
    >
      <span>Stage prompt · setup {shot.setup}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 rounded-full px-2 text-[10px]"
        onClick={() => {
          setAssistantDraft(project.id, prompt);
          toast.success("Stage prompt loaded into the composer");
        }}
        aria-label="Load stage prompt into the question composer"
        title="Loads the synthesized stage prompt into the composer; nothing is generated without you."
      >
        Use in question
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 rounded-full px-2 text-[10px]"
        onClick={() => {
          const write = navigator.clipboard?.writeText?.(prompt);
          if (write) {
            void write.then(
              () => toast.success("Stage prompt copied"),
              () => toast.error("Clipboard blocked; select and copy the prompt text."),
            );
          }
        }}
        aria-label="Copy synthesized stage prompt"
        title="Copy the synthesized stage prompt"
      >
        <Copy />
      </Button>
    </div>
  );
}

const ProductionAssistantContext =
  createContext<ProductionAssistantContextValue | null>(null);

export function useProductionAssistantContext(): ProductionAssistantContextValue {
  const value = useContext(ProductionAssistantContext);
  if (!value) throw new Error("Production Assistant context is missing; wrap the app in ProductionAssistantProvider.");
  return value;
}

export function ProductionAssistantProvider({ children }: { children: ReactNode }) {
  const project = useSlate((s) => s.project);
  const continuity = useSlate((s) => s.issues);
  const saved = useProductionAssistant((s) => s.sessions[project.id]);
  const running = useProductionAssistant((s) => !!s.running[project.id]);
  const researchRunning = useProductionAssistant((s) => !!s.researchRunning[project.id]);
  const legacyFindings = usePreflight((s) => s.findings);
  const legacySource = usePreflight((s) => s.source);
  const empty = useMemo(() => emptyAssistantSession(project.id), [project.id]);
  const session = saved ?? empty;
  useEffect(() => {
    hydrateAssistant(project.id);
  }, [project.id]);
  useEffect(() => {
    syncAssistantCommentReplies(project.id);
  }, [project.id, saved?.messages]);
  const local = useMemo(() => localPreflight(project), [project]);
  const remote =
    session.report?.findings ?? (legacySource?.projectId === project.id ? legacyFindings : []);
  const issues = useMemo(
    () => productionIssues(local, continuity, remote, session.dismissed).sort(
      (a, b) => Number(b.origin === "agentic") - Number(a.origin === "agentic"),
    ),
    [local, continuity, remote, session.dismissed],
  );
  const value = useMemo<ProductionAssistantContextValue>(
    () => ({ project, session, issues, running, researchRunning }),
    [project, session, issues, running, researchRunning],
  );
  return (
    <ProductionAssistantContext.Provider value={value}>
      {children}
    </ProductionAssistantContext.Provider>
  );
}

/** Shared "Ask about this" question text so both surfaces propose identical drafts. */
export function issueQuestionDraft(issue: ProductionIssue): string {
  return `Help me work through this production note: ${issue.title}. ${issue.detail}${issue.shotId ? ` Setup ID: ${issue.shotId}.` : ""}${issue.elementId ? ` Screenplay element: ${issue.elementId}.` : ""} Explain my options before proposing any changes.`;
}

/** Question excerpt used on research chips and Research tab rows. */
const RESEARCH_EXCERPT_CHARS = 120;
const researchExcerpt = (text: string) => (text.length > RESEARCH_EXCERPT_CHARS ? `${text.slice(0, RESEARCH_EXCERPT_CHARS)}…` : text);

function AssistantMessageList({
  messages,
  onOpenResearch,
}: {
  messages: AssistantMessage[];
  /** Research tab link seam: when present, job chips switch to the Research tab and highlight the row. */
  onOpenResearch?: (rowId?: string) => void;
}) {
  const { project, session, running, researchRunning } = useProductionAssistantContext();
  const researchPending = session.researchPending;
  const researchPendingQuestion = researchPending
    ? String(researchPending.request.input.question ?? "")
    : "";
  return (
    <div aria-label="Assistant conversation" className="space-y-3">
      {messages.map((message) => {
        const body = (
          <article
            className={`rounded-md border border-border p-3 text-sm ${message.role === "user" ? "ml-6 bg-muted/40" : "mr-6 bg-card"}`}
          >
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              {message.role === "user"
                ? "You"
                : message.provider === "parallel"
                  ? message.researchNoteJobId
                    ? "Parallel · research note"
                    : "Parallel"
                  : "Production Assistant"}
              {message.threadId ? " · script thread" : ""}
            </p>
            {message.role === "user" ? (
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            ) : (
              <AssistantMarkdown>{message.text}</AssistantMarkdown>
            )}
            {/* Context honesty (spec section 1): only a sliced answer — the
                backend set contextTrimmed because refs were sent — announces
                what it answered against. A trim-less answer renders nothing. */}
            {message.role === "assistant" && message.contextTrimmed ? (
              <div className="mt-2 space-y-1.5" aria-label="Answer context honesty">
                <p className="text-xs text-muted-foreground">
                  Answered against a bounded outline plus your mentions, not the full project.
                </p>
                {message.contextIncluded?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {message.contextIncluded.map((entry) => (
                      <span
                        key={`${entry.kind}:${entry.id}`}
                        className="inline-flex h-5 max-w-full items-center rounded-full border border-border px-2 text-[10px] text-muted-foreground"
                        title={`${entry.kind === "setup" ? "Setup" : "Script element"} ref ${entry.id} was included in the answer's context.`}
                      >
                        <span className="min-w-0 truncate">
                          {`${entry.kind === "setup" ? "Setup" : "Element"} · ${entry.label}`}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {message.contextUnresolved?.length ? (
                  <p
                    className="text-[10px] text-muted-foreground"
                    title="These mention refs matched nothing in the saved snapshot and were dropped before the answer ran."
                  >
                    {`not resolved: ${message.contextUnresolved.join(", ")}`}
                  </p>
                ) : null}
              </div>
            ) : null}
            {message.sources?.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 mr-3 inline-flex items-center gap-1 text-xs text-primary underline"
              >
                {message.provider === "parallel" ? `Parallel: ${source.title}` : source.title}
                <ExternalLink className="size-3" />
              </a>
            ))}
            {/* A completed research message offers its context honestly:
                disabled with a hint when the job recorded no job id in this
                conversation or returned no sources; "Added" once the note is
                in the conversation (idempotent per job, never re-charged). */}
            {message.provider === "parallel" && !message.researchNoteJobId ? (
              (() => {
                const jobId = message.jobId ?? null;
                const added = !!jobId && session.messages.some((m) => m.id === researchNoteMessageId(jobId));
                const sourceCount = message.sources?.length ?? 0;
                const hint = !jobId
                  ? "This job did not record its ID in this conversation, so its context note cannot be added."
                  : added
                    ? "The research context note is already in the conversation."
                    : sourceCount === 0
                      ? "This job has returned no sources yet; there is nothing to add."
                      : "Appends the job's question and cited sources into the conversation so the next answer can use them. Never re-charges credits.";
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 flex h-6 items-center gap-1 rounded-full px-2 text-[10px]"
                    aria-label="Add research as context"
                    title={hint}
                    disabled={!jobId || added || sourceCount === 0}
                    onClick={() => {
                      if (jobId) addResearchContext(project.id, jobId);
                    }}
                  >
                    {added ? "Added as context" : "Add research as context"}
                  </Button>
                );
              })()
            ) : null}
            {/* Assistant-proposed research (spec section 2): a chip under the
                answer. Until its job exists it runs the suggestion on a NEW
                idempotency key (credit charged only on this click); once the
                job exists it becomes the honest job link into the Research
                tab. The composer Research toggle is untouched. */}
            {(() => {
              const question = message.suggestion?.question;
              if (!question || message.role !== "assistant") return null;
              const pendingMatch =
                researchPending && researchPendingQuestion === question ? researchPending : null;
              const doneMatch = session.messages.find(
                (item) =>
                  item.provider === "parallel" &&
                  !item.researchNoteJobId &&
                  item.question === question &&
                  item.jobId,
              );
              if (pendingMatch || doneMatch) {
                const rowId = pendingMatch
                  ? (pendingMatch.jobId ?? `pending:${pendingMatch.request.idempotencyKey}`)
                  : doneMatch!.jobId!;
                const label =
                  pendingMatch && (researchRunning || !pendingMatch.jobId)
                    ? "Research running"
                    : "Research job";
                return (
                  <button
                    type="button"
                    className="mt-1 flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] text-foreground"
                    aria-label={`View the research job for: ${question}`}
                    title={
                      onOpenResearch
                        ? pendingMatch
                          ? "Research runs as its own job; the answer above is ready now. Opens the Research tab and highlights this job."
                          : "Opens the Research tab and highlights this completed research job."
                        : "The Research tab lives in the Production Assistant sidebar."
                    }
                    disabled={!onOpenResearch}
                    onClick={() => onOpenResearch?.(rowId)}
                  >
                    <Globe className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}: {researchExcerpt(question)}</span>
                    {onOpenResearch ? (
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  className="mt-1 flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  aria-label={`Run research: ${question}`}
                  title="Runs this suggestion as a standalone Parallel research job with a new idempotency key — one Parallel credit charged by this click. The answer above stays unchanged."
                  disabled={running || researchRunning || !!session.pending || !!session.researchPending}
                  onClick={() => void submitResearchSuggestion(project.id, question)}
                >
                  <Globe className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">Run research: {researchExcerpt(question)}</span>
                </button>
              );
            })()}
          </article>
        );
        return <Fragment key={message.id}>{body}</Fragment>;
      })}
    </div>
  );
}
function AssistantResearchCard({
  onOpenResearch,
}: {
  onOpenResearch?: (rowId?: string) => void;
}) {
  const project = useSlate((s) => s.project);
  const session = useProductionAssistant((s) => s.sessions[project.id]);
  const researchRunning = useProductionAssistant(
    (s) => !!s.researchRunning[project.id],
  );
  if (!session?.researchPending) return null;
  const pending = session.researchPending;
  const failed = !!session.researchError;
  const rowId = pending.jobId ?? `pending:${pending.request.idempotencyKey}`;
  return (
    <div
      aria-label="Parallel research status"
      className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs"
    >
      <p className="font-medium">
        {researchRunning
          ? "Running Parallel research…"
          : pending.jobId
            ? "Parallel research awaiting recovery"
            : "Parallel research ready to start"}
      </p>
      <p className="whitespace-pre-wrap">{String(pending.request.input.question ?? "")}</p>
      <p>
        {pending.jobId
          ? `Job: ${pending.jobId}`
          : `Request: ${pending.request.idempotencyKey}`}
      </p>
      <p className="text-muted-foreground">Runs as a separate, resumable job.</p>
      {session.researchError ? (
        <p role="alert" className="text-warn">
          {session.researchError}
        </p>
      ) : null}
      {!researchRunning && !failed ? (
        <Button size="sm" variant="secondary" onClick={() => resumeAssistantResearch(project.id)}>
          {pending.jobId ? "Resume" : "Start"} Parallel research
        </Button>
      ) : null}
      {/* A failed job is terminal on its key — "Resume" would replay the same
          failure — so the failed state offers Dismiss plus an explicit,
          separately-labelled "Run again" that composes a new idempotency key
          (and therefore one new Parallel credit). */}
      {!researchRunning && failed ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Run research again as a new job with a new idempotency key (one new Parallel credit)"
            onClick={() => retryAssistantResearch(project.id)}
          >
            Run again (new charge)
          </Button>
          <Button
            className="ml-2"
            size="sm"
            variant="ghost"
            aria-label="Dismiss failed research"
            onClick={() => dismissAssistantResearch(project.id)}
          >
            Dismiss failed research
          </Button>
        </>
      ) : null}
      {onOpenResearch && !failed ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-full px-2 text-[10px]"
          aria-label="View Parallel research in the Research tab"
          title="Opens the Research tab and highlights this job's row."
          onClick={() => onOpenResearch(rowId)}
        >
          View in Research tab
        </Button>
      ) : null}
    </div>
  );
}

/** Page Agent status labels for the composer footer chip. */
const PAGE_AGENT_STATUS_LABELS: Readonly<Record<AgentStatus, string>> = {
  idle: "Idle",
  running: "Running",
  completed: "Done",
  error: "Error",
  stopped: "Stopped",
};

const PAGE_AGENT_HISTORY_RENDER_LIMIT = 12;

/** Bounded view of one history event for rendering (mirrors the panel summarizers). */
interface PageAgentHistoryEntry {
  kind: PageAgentHistoryKind;
  label: string;
}

/** Inline chat-entry kind: failures and retries read as trouble in the narration. */
type PageAgentHistoryKind = "step" | "observation" | "error" | "retry" | "user_takeover";

function readPageAgentActivity(event: Event): AgentActivity | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail;
  if (
    typeof detail === "object" &&
    detail !== null &&
    "type" in detail &&
    typeof detail.type === "string"
  ) {
    // SAFETY: the fork emits AgentActivity payloads; the type field is the
    // discriminated union check, and the card renders them via known kinds only.
    return detail as AgentActivity;
  }
  return null;
}

function describePageAgentHistory(event: HistoricalEvent): PageAgentHistoryEntry | null {
  switch (event.type) {
    case "step": {
      const goal = event.reflection?.next_goal ?? event.reflection?.evaluation_previous_goal ?? "";
      const action = event.action.name;
      // Copilot narration is chat-facing: raw callback URLs (OAuth codes,
      // state, scope) from observations and action outputs never render.
      const output = redactUrlQuery(
        event.action.output.length > 220
          ? `${event.action.output.slice(0, 220)}…`
          : event.action.output,
      );
      return {
        kind: "step",
        label: goal
          ? `Step ${event.stepIndex + 1}: ${goal} → ${action} · ${output}`
          : `Step ${event.stepIndex + 1}: ${action} · ${output}`,
      };
    }
    case "observation":
      return {
        kind: "observation",
        label: redactUrlQuery(
          event.content.length > 220 ? `${event.content.slice(0, 220)}…` : event.content,
        ),
      };
    case "error":
      return {
        kind: "error",
        label: redactUrlQuery(
          event.message.length > 300 ? `${event.message.slice(0, 300)}…` : event.message,
        ),
      };
    case "retry":
      return { kind: "retry", label: redactUrlQuery(`Retry ${event.attempt} of ${event.maxAttempts}: ${event.message}`) };
    case "user_takeover":
      return { kind: "user_takeover", label: "The filmmaker took over the session." };
    default:
      return null;
  }
}

function describePageAgentActivity(activity: AgentActivity): string {
  switch (activity.type) {
    case "thinking":
      return "Thinking…";
    case "executing":
      return `Running ${activity.tool}…`;
    case "executed":
      return `Completed ${activity.tool} in ${(activity.duration / 1000).toFixed(1)}s.`;
    case "retrying":
      return `Model retry ${activity.attempt} of ${activity.maxAttempts}…`;
    case "error":
      return redactUrlQuery(activity.message);
    default:
      return "Working…";
  }
}

/**
 * One Page Agent lifecycle per Assistant chat panel: project/snapshot/Connection
 * binding, tool confirmations, and steering. Shared by the unified composer
 * (send = run/steer) and the narration-only Page Agent card — the port of the
 * wp-agent-os CollabPanel's runtime pause/resume/steer bridge to the installed
 * PageAgentCore fork.
 */
interface PageAgentSessionValue {
  projectId: string;
  /** Set after first mount; the agent is browser-only. */
  browserReady: boolean;
  status: AgentStatus;
  running: boolean;
  activity: AgentActivity | null;
  history: PageAgentHistoryEntry[];
  historyTotal: number;
  result: { success: boolean; data: string } | null;
  error: string | null;
  runId: string | null;
  connectionSummary: string | null;
  snapshotSummary: string | null;
  /** Operator steering messages queued for the in-flight run. */
  steers: string[];
  start(taskText: string): void;
  steer(message: string): void;
  stop(): void;
}

const PageAgentSessionContext = createContext<PageAgentSessionValue | null>(null);

function usePageAgentSession(): PageAgentSessionValue {
  const value = useContext(PageAgentSessionContext);
  if (!value)
    throw new Error(
      "Page Agent session context is missing; the Assistant chat panel must wrap its composer and cards in PageAgentSessionProvider.",
    );
  return value;
}

function PageAgentSessionProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const existing = useContext(PageAgentSessionContext);
  // One agent lifecycle per project: a sidebar wrapping its whole content
  // already owns the lifecycle, so a nested chat panel simply reuses it —
  // otherwise switching sidebar tabs could dispose a run mid-flight. A
  // standalone mount (the dialog fallback) creates its own lifecycle below.
  if (existing && existing.projectId === projectId) return <>{children}</>;
  const agentRef = useRef<PageAgentCore | null>(null);
  const controllerRef = useRef<PageController | null>(null);
  const pageIdRef = useRef<string>("");
  const connectionRef = useRef<string>("");
  const snapshotRef = useRef<SavedProjectBinding | null>(null);
  const steerQueueRef = useRef<string[]>([]);
  const mirroredHistoryRef = useRef(0);
  const [browserReady, setBrowserReady] = useState(false);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [history, setHistory] = useState<PageAgentHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [result, setResult] = useState<{ success: boolean; data: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [connectionSummary, setConnectionSummary] = useState<string | null>(null);
  const [snapshotSummary, setSnapshotSummary] = useState<string | null>(null);
  const [steers, setSteers] = useState<string[]>([]);

  const attach = useCallback((agent: PageAgentCore) => {
    agent.addEventListener("statuschange", () => {
      setStatus(agent.status);
      // Settled runs carry no live steering: queued messages can no longer
      // reach the loop, so both the display list and the drain queue reset.
      if (agent.status !== "running") {
        steerQueueRef.current = [];
        setSteers([]);
      }
    });
    agent.addEventListener("activity", (event) => {
      const detail = readPageAgentActivity(event);
      if (detail) setActivity(detail);
    });
    agent.addEventListener("historychange", () => {
      setRunId(agent.taskId || null);
      setHistory(
        agent.history
          .map(describePageAgentHistory)
          // The history array grows with every step; only entries the card
          // knows how to describe are rendered.
          .filter((entry): entry is PageAgentHistoryEntry => entry !== null)
          .slice(-PAGE_AGENT_HISTORY_RENDER_LIMIT),
      );
      setHistoryTotal(agent.history.length);
      // One assistant, one stream: mirror the newly narrated steps into the
      // session messages so the Copilot and the assistant render together.
      const start = mirroredHistoryRef.current;
      for (let index = start; index < agent.history.length; index += 1) {
        const entry = describePageAgentHistory(agent.history[index]);
        if (entry) appendCopilotMessage(projectId, entry.label);
      }
      mirroredHistoryRef.current = agent.history.length;
    });
    agent.addEventListener("dispose", () => setStatus("idle"));
  }, [projectId]);

  const resolveConnection = useCallback(async (): Promise<void> => {
    const connections = await getCinemaConnections();
    const selected = connections.find((candidate) => candidate.provider === "google-cloud");
    if (!selected) {
      connectionRef.current = "";
      setConnectionSummary(null);
      throw new Error(
        "Sign in to Google Cloud in Settings > App before running an Assistant task.",
      );
    }
    connectionRef.current = selected.connectionId;
    setConnectionSummary(selected.connectionId);
  }, []);

  // The backend chat contract binds every request to a saved project snapshot:
  // POST /projects with the current local project, then run against the returned
  // integer revision. The exact snapshot is reused while the local project is
  // unchanged; tool execution itself still targets the local store.
  const resolveSnapshot = useCallback(async (): Promise<void> => {
    const project = useSlate.getState().project;
    const fingerprint = projectFingerprint(project);
    // The backend snapshot id differs from the local one; identical local
    // content means the exact saved snapshot is still current.
    if (snapshotRef.current?.fingerprint === fingerprint) return;
    const saved = await cinemaRequest<SavedProjectBinding>("/projects", {
      method: "POST",
      body: JSON.stringify({ project }),
    });
    if (
      typeof saved?.projectId !== "string" ||
      !saved.projectId ||
      !Number.isInteger(saved.revision) ||
      saved.revision < 1
    ) {
      throw new Error(
        "The saved project revision could not be confirmed for the Assistant run.",
      );
    }
    snapshotRef.current = { projectId: saved.projectId, revision: saved.revision, fingerprint };
    setSnapshotSummary(`project ${saved.projectId} · revision ${saved.revision}`);
  }, []);

  const onConfirmTool = useCallback<PageAgentConfirmationHandler>(
    (request: ToolConfirmationRequest, _options?: { signal: AbortSignal }) =>
      Promise.resolve(
        window.confirm(
          `The assistant wants to run "${request.toolName}" against project ${projectId}.\n${request.label}\nApprove?`,
        ),
      ),
    [projectId],
  );

  const ensureAgent = useCallback(async (): Promise<PageAgentCore> => {
    if (agentRef.current) return agentRef.current;
    if (!pageIdRef.current) pageIdRef.current = `page_${crypto.randomUUID().slice(0, 12)}`;
    // PageController touches window at module evaluation time, so keep this
    // browser-only dependency out of the SSR graph.
    const { PageController: PageControllerImpl } = await import(
      "@kylebrodeur/page-agent-page-controller"
    );
    const controller = new PageControllerImpl();
    const agent = new PageAgentCore({
      pageController: controller,
      baseURL: window.location.origin,
      model: PAGE_AGENT_MODEL,
      // Same-origin LLM gateway; no API key is held by the browser.
      customFetch: createPageAgentChatFetch({
        projectId: () => snapshotRef.current?.projectId ?? "",
        pageId: () => pageIdRef.current,
        runId: () => agentRef.current?.taskId ?? "",
        connectionId: () => connectionRef.current,
        expectedRevision: () => snapshotRef.current?.revision ?? 0,
        view: () => useSlate.getState().view,
        researchEnabled: () => useProductionAssistant.getState().composerResearch[projectId] ?? false,
      }),
      // Creative studio tools are only offered because a host confirmation
      // handler is configured below.
      customTools: buildStudioPageAgentTools({
        runner: (name: string, args: Record<string, unknown>) =>
          name === "search_parallel"
            ? runParallelSearchTool(projectId, args)
            : executeStudioTool(name, args),
        onConfirmTool,
      }),
      onConfirmTool,
      // Steering bridge: composer messages queued while the run is in flight
      // drain as operator instructions before the agent's next step.
      instructions: {
        getPageInstructions: () => {
          const pending = steerQueueRef.current.splice(0);
          if (pending.length === 0) return undefined;
          return `Operator steering for the current task:\n${pending
            .map((message) => `- ${message}`)
            .join("\n")}`;
        },
      },
    });
    controllerRef.current = controller;
    agentRef.current = agent;
    attach(agent);
    return agent;
  }, [attach, onConfirmTool]);

  const disposeAgent = useCallback(() => {
    agentRef.current?.dispose();
    agentRef.current = null;
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    setBrowserReady(true);
    return () => disposeAgent();
  }, [disposeAgent]);

  // Rebinding on projectId change: an agent whose chat requests and revision
  // guard captured the old project id cannot be reused truthfully.
  useEffect(() => {
    if (agentRef.current) {
      disposeAgent();
      setStatus("idle");
      setHistory([]);
      setHistoryTotal(0);
      setResult(null);
      setActivity(null);
      setRunId(null);
      setSteers([]);
      steerQueueRef.current = [];
    }
    // Saved snapshots and connections belong to the previously bound project.
    snapshotRef.current = null;
    connectionRef.current = "";
    setConnectionSummary(null);
    setSnapshotSummary(null);
  }, [disposeAgent, projectId]);

  const start = useCallback(
    async (taskText: string): Promise<void> => {
      const trimmed = taskText.trim();
      if (!trimmed || !browserReady) return;
      setError(null);
      setResult(null);
      setActivity(null);
      try {
        await resolveConnection();
        await resolveSnapshot();
        const agent = await ensureAgent();
        // A queued steering message typed while resolving cannot reach a run
        // that has not started; it becomes part of nothing. Drain it.
        steerQueueRef.current = [];
        mirroredHistoryRef.current = 0;
        const run = agent.execute(trimmed);
        const runId = agent.taskId || crypto.randomUUID();
        recordRunStarted(projectId, { runId, task: trimmed.slice(0, 160) });
        setRunId(agent.taskId || null);
        const outcome = await run;
        steerQueueRef.current = [];
        setSteers([]);
        recordRunFinished(projectId, {
          runId,
          status: outcome.success ? "completed" : "failed",
          summary: outcome.data.slice(0, 160),
        });
        setResult({ success: outcome.success, data: outcome.data });
        // The finished answer lands in the same stream as its narration.
        appendCopilotMessage(
          projectId,
          outcome.success ? outcome.data : `The task ended without success: ${outcome.data}`,
        );
      } catch (thrown) {
        // External failures (endpoint absent, unauthorized, no connection) must
        // surface here as failures; the run never reports success without evidence.
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        setError(message);
        appendCopilotMessage(projectId, `The task ended without success: ${message}`);
      }
    },
    [browserReady, ensureAgent, projectId, resolveConnection, resolveSnapshot],
  );

  const steer = useCallback((message: string): void => {
    steerQueueRef.current.push(message);
    setSteers((entries) => [...entries, message]);
    appendAssistantUserMessage(projectId, message);
  }, [projectId]);

  const stop = useCallback(() => {
    void agentRef.current?.stop();
  }, []);

  const value = useMemo<PageAgentSessionValue>(
    () => ({
      projectId,
      browserReady,
      status,
      running: status === "running",
      activity,
      history,
      historyTotal,
      result,
      error,
      runId,
      connectionSummary,
      snapshotSummary,
      steers,
      start: (taskText) => void start(taskText),
      steer,
      stop,
    }),
    [
      projectId,
      browserReady,
      status,
      activity,
      history,
      historyTotal,
      result,
      error,
      runId,
      connectionSummary,
      snapshotSummary,
      steers,
      start,
      steer,
      stop,
    ],
  );

  return (
    <PageAgentSessionContext.Provider value={value}>
      {children}
    </PageAgentSessionContext.Provider>
  );
}

/**
 * Keeps the newest chat entry in view: scrolls the feed to the bottom on every
 * settled message, Copilot step, streaming delta, or run/status flip. Placed
 * inside the Page Agent provider so it observes both the ask messages and the
 * Copilot's live history.
 */
function FeedAutoscroll() {
  const pageAgent = usePageAgentSession();
  const { session, running, project } = useProductionAssistantContext();
  const streamText = useProductionAssistant((s) => s.streaming[project.id] ?? null);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "end" });
  }, [pageAgent.history.length, pageAgent.result, session.messages.length, streamText, running]);
  return <div ref={anchor} aria-hidden="true" className="h-px w-full shrink-0" />;
}

/**
 * Centered invite shown only when the assistant is genuinely idle and the
 * conversation is empty: any live or settled Copilot work replaces it, since
 * the Copilot's inline stream IS the assistant's chat, not a separate route.
 */
function AssistantEmptyState() {
  const pageAgent = usePageAgentSession();
  if (
    pageAgent.status !== "idle" ||
    pageAgent.activity !== null ||
    pageAgent.history.length > 0 ||
    pageAgent.result !== null
  )
    return null;
  return (
    <div
      aria-label="Start a conversation"
      className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center"
    >
      <p className="text-sm font-medium">Start a conversation</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Ask about your film — the assistant reviews, researches, and works in the studio with its
        tools.
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Try “What should I work on next?” or “How can this scene feel more tense?”
      </p>
    </div>
  );
}

/**
 * Compact Assistant run status pinned above the composer. The Assistant's full
 * stream lives inline in the feed above, so this chip is the always-visible
 * status while the feed is scrolled. Idle renders nothing.
 */
function AssistantRunFooterChip() {
  const pageAgent = usePageAgentSession();
  if (pageAgent.status === "idle") return null;
  const label = PAGE_AGENT_STATUS_LABELS[pageAgent.status];
  const detail =
    pageAgent.running && pageAgent.activity !== null
      ? describePageAgentActivity(pageAgent.activity)
      : pageAgent.running
        ? "Working in the studio…"
        : "";
  return (
    <div
      aria-label="Assistant run status"
      className="mb-2 flex h-6 items-center gap-2 overflow-hidden rounded-full border border-border bg-muted/30 px-2.5 text-[10px] text-foreground"
      title="The Assistant runs inside this chat; its full narration is in the feed above."
    >
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          pageAgent.running
            ? "bg-primary/10 text-primary"
            : pageAgent.status === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-secondary text-secondary-foreground",
        )}
      >
        {label}
      </span>
      <span className="min-w-0 truncate font-medium">
        Assistant{detail ? ` · ${detail}` : ""}
      </span>
    </div>
  );
}

/** One ask request path shared by the modal fallback and the co-pilot sidebar: slim composer with chips and one status line. */
function AssistantAskForm() {
  const { project, session, running, researchRunning } = useProductionAssistantContext();
  const pageAgent = usePageAgentSession();
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  // The Research toggle lives in the store (ephemeral, per project), not in
  // this form's local state: a check row's "Research this check" chip composes
  // a draft and turns the toggle on while another tab is mounted, so the chip
  // must be visible the moment the composer re-mounts (spec section 3).
  const research = useProductionAssistant((s) => s.composerResearch[project.id] ?? false);
  const [officialDocs, setOfficialDocs] = useState(false);
  // Live composer context: derived from the studio store (never mirrored), so
  // switching surface or selecting another shot updates the chip immediately.
  const view = useSlate((state) => state.view);
  const focusedShot = useFocusedShot();
  const contextLabel = assistantContextLabel(view, focusedShot, project.script.length);
  // Mention-driven context (spec section 1): the focused shot rides as one
  // implicit ref by default, removable to keep an ask full-snapshot. The
  // picker's visibility derives from the draft itself (the token after the
  // last `@`/`#`), so a pick, a space or any edit closes it in sync with the
  // composer text. Explicit picks land in session.mentions and always stay
  // ahead of the implicit focus ref in the effective list.
  const [focusRefRides, setFocusRefRides] = useState(true);
  const mention = mentionQuery(session.draft);
  const mentionPicker = mention ? assistantMentionPicker(mention, view, project) : null;
  const focusLabel =
    focusedShot
      ? [focusedShot.setup, focusedShot.title].filter(Boolean).join(" ") || `shot ${focusedShot.number}`
      : "";
  const contextRefs = effectiveContextRefs(
    session.mentions,
    focusRefRides && focusedShot ? focusedShot.id : null,
  );
  // The composer is Copilot-first: it drives the studio through the Page
  // Agent tools. The Gemini ask engine remains the path behind explicit
  // Gemini actions (draft production review) and is not a selectable route.
  const [checkingRequest, setCheckingRequest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState("Assistant model status unavailable");
  const [modelConfigured, setModelConfigured] = useState(false);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const connectionId =
    connections.find(
      (connection) =>
        connection.provider === "google-cloud" &&
        connection.status === "configured" &&
        connection.expiresAt * 1000 > Date.now(),
    )?.connectionId ?? "";
  const credits = useGenerationCredits(
    connectionId ? `${connectionId}:${session.pending?.jobId ?? ""}` : undefined,
  );
  const assistantCredits = credits && !credits.admin ? credits.byType.assistant : null;
  const researchCredits = credits && !credits.admin ? credits.byType.parallel : null;
  const assistantCreditsOut = assistantCredits?.remaining === 0;
  const researchCreditsOut = research && researchCredits?.remaining === 0;
  const locked =
    running || researchRunning || !!session.pending || !!session.researchPending || checkingRequest;
  const refresh = async () => {
    setLoading(true);
    setConnectionError(null);
    const [available, health] = await Promise.allSettled([
      getCinemaConnections(),
      getCinemaHealth(),
    ]);
    if (available.status === "fulfilled") {
      setConnections(available.value);
    } else {
      setConnections([]);
      setConnectionError(
        available.reason instanceof Error
          ? available.reason.message
          : "Connections unavailable. Open Settings > App to connect Google Cloud.",
      );
    }
    if (health.status === "fulfilled") {
      const capability = health.value.capabilities.preflight;
      setModelConfigured(capability?.status === "configured");
      setModelStatus(
        capability
          ? `${capability.model ?? "Google ADK"} · ${capability.status === "configured" ? "running" : "paused"}`
          : "Assistant model paused",
      );
    } else {
      setModelConfigured(false);
      setModelStatus("Assistant model status unavailable");
    }
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
  }, []);
  // While a Page Agent run is in flight the composer becomes a steering
  // control: Send queues the typed text as operator steering for the run and
  // the live Stop control appears beside it.
  const steering = pageAgent.running;
  const send = () => {
    const text = session.draft.trim();
    if (steering) {
      if (!text) return;
      pageAgent.steer(text);
      setAssistantDraft(project.id, "");
      return;
    }
    if (!text || !pageAgent.browserReady) return;
    // The focused shot and @/# mentions ride into the assistant's task as an
    // explicit starting-point note; the agent still inspects the studio with
    // its tools for everything beyond that.
    const refLabels = contextRefLabels(project, contextRefs);
    const contextNote = refLabels.length
      ? `Focused context: ${refLabels.map((ref) => ref.label).join("; ")}. `
      : "";
    setAssistantDraft(project.id, "");
    // The typed task reads as a chat message in the feed; the assistant's own
    // entries stream beside it.
    appendAssistantUserMessage(project.id, text);
    pageAgent.start(contextNote + text);
  };
  const canSend = steering
    ? session.draft.trim().length > 0
    : pageAgent.browserReady && session.draft.trim().length > 0;
  return (
    <div className="space-y-1.5">
      {/* One bordered composer card, like the CollabPanel reference: context
          pills and the quick action on top, the single input in the middle,
          route chips/Options/Send on one footer row. No label, no second box. */}
      <form
        aria-label="Ask the assistant"
        className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span
              aria-label="Current composer context"
              title="Live context: the assistant follows the surface and shot you have open."
              className="inline-flex h-5 min-w-0 max-w-44 items-center rounded-full border border-border px-2"
            >
              <span className="min-w-0 truncate">{contextLabel}</span>
            </span>
            {focusedShot && focusRefRides ? (
              <button
                type="button"
                aria-label="Drop the focused shot mention from the next task"
                title="The focused shot bounds the next Assistant task's starting context (and the Gemini production review)."
                className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[10px] text-foreground/70 transition-colors hover:bg-muted/40"
                onClick={() => setFocusRefRides(false)}
              >
                <span className="min-w-0 truncate">{`Focus: ${focusLabel} +`}</span>
              </button>
            ) : null}
            <span
              className="inline-flex items-center gap-1"
              title="Mentions and the focus chip bound the Assistant task's starting context and the Gemini production review."
            >
              <Globe className="size-3" />
              Focused context
            </span>
            {!!project.scriptCommentThreads?.length && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" />
                {project.scriptCommentThreads.length} script threads
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => {
              const prompt =
                "Review this complete project for production readiness. Prioritize the next useful steps, explain any continuity or coverage issues, and propose only specific screenplay marks that would help.";
              setAssistantDraft(project.id, prompt);
              appendAssistantUserMessage(project.id, prompt);
              pageAgent.start(prompt);
            }}
            title="Runs a full production review through the assistant"
          >
            + Production review
          </Button>
        </div>
        {/* Contextual quick prompts, one compact always-on row keyed to the
            current surface. A tap only fills the draft and focuses the input:
            sending stays entirely the filmmaker's action. flex-wrap keeps the
            row clean at the narrow dock width. */}
        <div
          role="group"
          aria-label="Contextual quick prompts"
          className="mb-1.5 flex flex-wrap items-center gap-1"
        >
          {VIEW_QUICK_PROMPTS[view].map((prompt) => (
            <Button
              key={prompt}
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 rounded-full px-2 text-[10px] text-muted-foreground"
              title={`${prompt} — fills the composer draft; nothing is sent until you do`}
              onClick={() => {
                setAssistantDraft(project.id, prompt);
                draftInput.current?.focus();
              }}
            >
              {prompt}
            </Button>
          ))}
        </div>
        <textarea
          className="w-full resize-none border-0 bg-transparent p-0 text-sm focus:outline-none focus-visible:ring-0"
          maxLength={4000}
          disabled={checkingRequest}
          rows={2}
          ref={draftInput}
          value={session.draft}
          onChange={(event) => {
            setAssistantDraft(project.id, event.target.value);
          }}
          placeholder={
            steering
              ? "The assistant is working — your message steers the run…"
              : "Tell the assistant what to do in the studio; it can use the studio tools…"
          }
        />
        {/* Mention picker (spec section 1): visible while the draft's trailing
            token reads like an in-progress `@`/`#` mention. A pick appends the
            plain-text token to the draft and records the contextRef; the list
            is capped and the headline says so. Buttons stay keyboard-reachable
            (Tab + Enter) and disable exactly when the 12-ref ceiling is full. */}
        {mention && mentionPicker ? (
          <div
            aria-label={`Mention picker: ${mentionPicker.headline}`}
            className="mb-1.5 rounded-lg border border-border bg-muted/30 p-1.5"
          >
            <p className="px-1 pb-1 text-[10px] text-muted-foreground">
              {mentionPicker.headline}
              {mentionPicker.entries.length === 0
                ? " — keep typing, or press space to close the picker"
                : ""}
            </p>
            <div className="flex max-h-40 flex-col overflow-y-auto">
              {mentionPicker.entries.map((candidate) => (
                <Button
                  key={`${candidate.kind}:${candidate.ref}`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 max-w-full justify-start gap-1.5 rounded px-2 text-[10px] text-muted-foreground"
                  disabled={session.mentions.length >= ASSISTANT_CONTEXT_REFS_MAX}
                  aria-label={`Mention ${candidate.label}`}
                  title={`Adds ${candidate.token} to the draft and bounds the next answer's context to your mentions (ref: ${candidate.ref}).`}
                  onClick={() => {
                    addAssistantMention(project.id, candidate.ref);
                    setAssistantDraft(project.id, mentionPickedDraft(session.draft, candidate.token));
                    draftInput.current?.focus();
                  }}
                >
                  <span className="shrink-0 text-foreground/70">
                    {candidate.kind === "setup" ? "Setup" : "Element"}
                  </span>
                  <span className="min-w-0 truncate">{candidate.label}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {/* Slim composer footer row: one send control (Send → Steer during a
            run) shares the card row with the route chips and the tucked
            Options popover — no stacked config cards, no second task box. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" type="submit" aria-label={steering ? "Steer the running agent" : undefined} disabled={!canSend} onClick={send}>
            {running || checkingRequest || steering ? (
              <Loader2 className="animate-spin" />
            ) : (
              <MessageSquare />
            )}
            {checkingRequest ? "Checking connection…" : steering ? "Steer" : "Send"}
          </Button>
        {steering ? (
          <Button
            size="sm"
            variant="outline"
            aria-label="Stop the running assistant"
            onClick={pageAgent.stop}
          >
            Stop
          </Button>
        ) : null}
        {/* Composer is Copilot-first: no route toggle. The Gemini ask engine
            remains reachable through the explicit review and ask-about-this
            actions, never as a selectable composer route. */}
        <button
          type="button"
          aria-pressed={research}
          aria-label="Toggle Parallel research for the next ask"
          title="Parallel research — a separate, resumable job with cited sources after the answer (one Parallel credit)."
          disabled={locked}
          onClick={() => setAssistantComposerResearch(project.id, !research)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs",
            research ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Globe className="size-3.5" />
          Research
        </button>
        <button
          type="button"
          aria-pressed={officialDocs}
          aria-label="Toggle official Gemini docs grounding for the next ask"
          title="Official Gemini docs — ground the answer in Google's developer documentation."
          disabled={locked}
          onClick={() => setOfficialDocs((value) => !value)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs",
            officialDocs ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <FileText className="size-3.5" />
          Docs
        </button>
        <span className="flex-1" aria-hidden="true" />
        </div>
      </form>
      {/* Slim status line: model availability and connection state in one
          non-wrapping, truncating line — the affordance to connect lives here,
          not in a card; longer guidance stays in title tooltips. */}
      <p
        aria-label="Assistant connection status"
        className="flex items-center gap-x-2 overflow-hidden whitespace-nowrap pt-1 text-xs text-muted-foreground"
      >
        <span className="min-w-0 truncate text-foreground/80">{modelStatus}</span>
        {connectionId ? (
          <span className="min-w-0 truncate">Google Cloud connected</span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            aria-label="Connect to get started"
            className="h-5 shrink-0 rounded-full px-2 text-xs"
            disabled={checkingRequest}
            onClick={() => openSettingsTab("app")}
            title="Connect to get started: open Settings on the App connection tab"
          >
            Connect in Settings
          </Button>
        )}
        {research ? (
          <span
            className="min-w-0 truncate"
            title="Parallel research runs as a separate follow-up job after the answer; it uses managed service capacity when available."
          >
            Research runs after the answer
          </span>
        ) : null}
        {assistantCredits || researchCredits ? (
          <span className="min-w-0 truncate">
            {assistantCredits
              ? `${assistantCredits.remaining} assistant credits left this month`
              : "Assistant credits unavailable"}
            {research
              ? ` · ${researchCredits?.remaining ?? 0} Parallel research credits left this month`
              : ""}
          </span>
        ) : null}
      </p>
      {connectionError ? (
        <p role="alert" className="text-xs text-destructive">
          {connectionError}
        </p>
      ) : null}
    </div>
  );
}

/** Gemini surface: context badges, script-thread focus, chat feed, and a slim pinned composer with one status line. */
export function AssistantChatPanel({
  showResearch = true,
  onOpenResearch,
}: {
  showResearch?: boolean;
  /** Research tab link seam (the sidebar provides it; the dialog fallback has no Research tab). */
  onOpenResearch?: (rowId?: string) => void;
}) {
  const { project, session, running, researchRunning } = useProductionAssistantContext();
  // Streamed answer deltas are ephemeral in-flight text; they display through
  // the same store.
  const streamText = useProductionAssistant((s) => s.streaming[project.id] ?? null);
  // One Page Agent lifecycle serves the composer (send/steer) and its inline
  // chat stream inside this chat flow.
  return (
    <PageAgentSessionProvider projectId={project.id}>
      <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Panel header: the only session-level affordance sits above the feed,
          never inside the composer. Disabled while a run is in flight; the
          store also refuses to interrupt a live ask or research job. */}
      <div className="flex shrink-0 items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-5 rounded-full px-2 text-[10px]"
          aria-label="New session"
          disabled={running || researchRunning}
          onClick={() => {
            try {
              newAssistantSession(project.id);
            } catch {
              /* The current session stays visible if storage is full. */
            }
          }}
        >
          New session
        </Button>
      </div>
      {/* Scrollable copilot surface: conversation, cards — everything
          except the ask input, so the input stays pinned like a normal chat.
          Context pills live on the composer header like CollabPanel's. */}
      <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto">
      {session.focusThreadId && (
        <div className="rounded border border-border bg-muted/30 p-3 text-xs">
          <p className="font-semibold">Replying in script thread</p>
          <p className="mt-1 whitespace-pre-wrap break-words">
            {project.scriptCommentThreads?.find(
              (thread) => thread.id === session.focusThreadId,
            )?.anchor.quote ?? "This thread is no longer in the current project."}
          </p>
          <p className="mt-1 text-muted-foreground">
            Your question and the Assistant’s answer are saved in this thread and in the
            global conversation.
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => clearAssistantCommentContext(project.id)}
          >
            Ask globally instead
          </Button>
        </div>
      )}
      {(() => {
        // Research-tab visibility: standalone Parallel research messages stay
        // out of the sidebar chat feed (they live in the Research tab), but
        // the compact research-context notes ALWAYS stay in the conversation —
        // they are part of it, not activity chrome.
        const visibleMessages = session.messages.filter((message) =>
          showResearch || message.provider !== "parallel" || !!message.researchNoteJobId,
        );
        return visibleMessages.length > 0 ? (
          <AssistantMessageList messages={visibleMessages} onOpenResearch={onOpenResearch} />
        ) : (
          <AssistantEmptyState />
        );
      })()}
      {running && streamText !== null && streamText.trim() !== "" ? (
        <article
          aria-live="polite"
          aria-label="Assistant answer streaming"
          className="mr-6 rounded-md border border-border bg-card p-3 text-sm"
        >
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Production Assistant
          </p>
          <p className="whitespace-pre-wrap break-words">{streamText}</p>
          <span
            aria-label="Streaming answer"
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            streaming…
          </span>
        </article>
      ) : null}
      {showResearch ? <AssistantResearchCard onOpenResearch={onOpenResearch} /> : null}
      {session.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {session.error}
        </p>
      ) : null}
      {/* The full stage prompt card moved to the Stage view dock; the composer
          carries only the compact load affordance. */}
      <StagePromptChip />
      <FeedAutoscroll />
      </div>
      {/* The composer and its slim status line stay pinned below the feed:
          one chat surface, one scroll region, one compact bottom edge. */}
      <div className="shrink-0 border-t border-border pt-2">
        <AssistantRunFooterChip />
        <AssistantAskForm />
      </div>
    </div>
    </PageAgentSessionProvider>
  );
}

/**
 * Sidebar Research pane: Parallel research jobs only (running + completed
 * rows with honest per-row actions and the checks↔sources block). Copilot
 * work streams inline in the Assistant tab's feed; Reports are gone from this
 * tab.
 */
export function AssistantActivityPanel({
  highlightRowId,
}: {
  /** Local highlight state: the research row a job link pointed at (no url routing). */
  highlightRowId?: string | null;
}) {
  const { session, project, researchRunning, issues } = useProductionAssistantContext();
  const researchPending = session.researchPending;
  const researchFailed =
    researchPending !== null && session.researchError !== null;
  // "Add as context" is idempotent per job: the note's stable id is the marker.
  const completed = session.messages.filter(
    (message) => message.provider === "parallel" && !message.researchNoteJobId,
  );
  const pendingRowId = researchPending
    ? (researchPending.jobId ?? `pending:${researchPending.request.idempotencyKey}`)
    : null;
  const highlighted = (rowId: string | null | undefined) =>
    !!rowId && !!highlightRowId && highlightRowId === rowId;
  const doneHighlighted = (message: AssistantMessage) =>
    highlighted(message.jobId) ||
    (!!highlightRowId && message.id === highlightRowId) ||
    (!!highlightRowId &&
      message.id === `${String(highlightRowId).replace(/^pending:/, "")}:research`);
  const pendingQuestion = researchPending
    ? String(researchPending.request.input.question ?? "")
    : "";
  // Checks ↔ Research wiring (spec section 3): completed research rows that
  // share a domain with an open production check contribute their cited
  // sources to a per-check "Sources" block beneath the row list. No fake
  // data: without matches the block does not render at all.
  const checkSourceGroups = checkResearchSources(
    issues.map((issue) => ({ title: issue.title, detail: issue.detail })),
    completed.map((message) => ({
      id: message.id,
      question: message.question,
      sources: message.sources,
      jobId: message.jobId ?? null,
    })),
  );
  return (
    <div className="space-y-3" aria-label="Studio activity">
      <section aria-label="Parallel research activity" className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Research
        </h4>
        <div className="grid"><details className="w-full">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            How research works
          </summary>
          <div className="mt-1 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>Parallel research runs as a separate, resumable job.</p>
            <p className="mt-1">
              Parallel research is a separate web-research job from the Gemini answer. It keeps
              its own idempotency key and job ID, reuses the project snapshot you asked against, and
              charges Parallel research credits only.
            </p>
          </div>
        </details></div>
        {/* The running (or failed, or recoverable) research job row. A failed
            job is terminal on its key: Dismiss or an explicit "Run again"
            composes a NEW idempotency key — honestly labelled as a new
            Parallel charge. */}
        {researchPending ? (
          <article
            key="pending"
            aria-label={`Research job: ${researchExcerpt(pendingQuestion)}`}
            aria-current={highlighted(pendingRowId) ? "true" : undefined}
            className={cn(
              "rounded-md border p-3 text-xs",
              researchFailed ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
              highlighted(pendingRowId) && "ring-2 ring-primary/50",
            )}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {researchRunning ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : null}
              <Badge variant={researchFailed ? "error" : "steel"}>
                {researchFailed
                  ? "Failed"
                  : researchRunning
                    ? "Running"
                    : researchPending.jobId
                      ? "Resumable"
                      : "Ready to start"}
              </Badge>
              {researchFailed && session.researchFaultCode ? (
                <Badge variant="error">{session.researchFaultCode}</Badge>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{researchExcerpt(pendingQuestion)}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
              {researchPending.jobId ? <span>job {researchPending.jobId}</span> : null}
              {researchPending.startedAt ? (
                <span>{researchDurationLabel(Date.now() - researchPending.startedAt)} elapsed</span>
              ) : null}
              {researchFailed ? null : <span>sources pending</span>}
            </p>
            {researchFailed ? (
              <>
                <p role="alert" className="mt-1 break-words text-[11px] text-destructive">
                  {session.researchError}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Run research again as a new job with a new idempotency key (one new Parallel credit)"
                    title="Composes a new idempotency key against the same saved snapshot: one new Parallel credit, explicitly charged."
                    onClick={() => retryAssistantResearch(project.id)}
                  >
                    Run again (new charge)
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Dismiss failed research"
                    onClick={() => dismissAssistantResearch(project.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </>
            ) : !researchRunning ? (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => resumeAssistantResearch(project.id)}
                >
                  {researchPending.jobId ? "Resume" : "Start"} Parallel research
                </Button>
              </div>
            ) : null}
          </article>
        ) : null}
        {/* Completed research rows: question excerpt, done chip, sources
            count, elapsed, and the idempotent "Add research as context"
            action that appends the compact note into the conversation. */}
        {completed.length > 0 ? (
          <div className="space-y-3" aria-label="Completed Parallel research">
            {completed
              .slice()
              .reverse()
              .map((message) => {
                const jobId = message.jobId ?? null;
                const question = message.question ?? "";
                const sources = message.sources ?? [];
                const noteAdded =
                  !!jobId && session.messages.some((m) => m.id === researchNoteMessageId(jobId));
                const rowLabel = researchExcerpt(question || jobId || "completed research");
                return (
                  <article
                    key={message.id}
                    aria-label={`Research job: ${rowLabel}`}
                    aria-current={doneHighlighted(message) ? "true" : undefined}
                    className={cn(
                      "rounded-md border border-border bg-card p-3 text-xs",
                      doneHighlighted(message) && "ring-2 ring-primary/50",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="ok">Done</Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {question || "(question not recorded)"}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      {jobId ? <span>job {jobId}</span> : null}
                      <span>
                        {sources.length === 1 ? "1 source" : `${sources.length} sources`}
                      </span>
                      {message.researchDurationMs !== undefined && message.researchDurationMs >= 0 ? (
                        <span>
                          {researchDurationLabel(message.researchDurationMs)} elapsed
                        </span>
                      ) : null}
                    </p>
                    {sources.length > 0 || (message.text && message.text !== PARALLEL_RESEARCH_NOTE) ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted-foreground">
                          View answer & sources
                        </summary>
                        <div className="mt-1 space-y-1">
                          {message.text ? <AssistantMarkdown>{message.text}</AssistantMarkdown> : null}
                          {sources.map((source) => (
                            <a
                              key={source.url}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mr-3 inline-flex items-center gap-1 text-primary underline"
                            >
                              Parallel: {source.title}
                              <ExternalLink className="size-3" />
                            </a>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-6 rounded-full px-2 text-[10px]"
                      aria-label="Add research as context"
                      title={
                        noteAdded
                          ? "The research context note is already in the conversation."
                          : !jobId
                            ? "This job did not record its ID in this conversation, so its context note cannot be added."
                            : sources.length === 0
                              ? "This job has returned no sources yet; there is nothing to add."
                              : "Appends the job's question and cited sources into the conversation so the next answer can use them. Never re-charges credits."
                      }
                      disabled={!jobId || noteAdded || sources.length === 0}
                      onClick={() => {
                        if (jobId) addResearchContext(project.id, jobId);
                      }}
                    >
                      {noteAdded ? "Added as context" : "Add research as context"}
                    </Button>
                  </article>
                );
              })}
          </div>
        ) : null}
        {!researchPending && completed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No research jobs yet. Turn on “Research” in the composer before asking — or run a
            research suggestion under an answer — and the job appears here while it works, with
            its sources once it completes.
          </p>
        ) : null}
        {/* Checks ↔ Research wiring (spec section 3): the completed rows'
            cited sources, regrouped by the production check they answer.
            Renders only when at least one open check actually matches. */}
        {checkSourceGroups.length > 0 ? (
          <section aria-label="Sources by check" className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sources by check
            </h4>
            {checkSourceGroups.map((group) => (
              <article
                key={group.checkTitle}
                aria-label={`Sources for check: ${group.checkTitle}`}
                className="rounded-md border border-border bg-card p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 break-words font-medium">{group.checkTitle}</span>
                  <Badge variant="steel">{CHECK_RESEARCH_DOMAIN_LABELS[group.domain]}</Badge>
                </div>
                <ul aria-label={`Cited sources for ${group.checkTitle}`} className="mt-1 space-y-1">
                  {group.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 break-words text-primary underline"
                      >
                        Parallel: {source.title}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {group.sources.length === 1 ? "1 source" : `${group.sources.length} sources`}
                  {group.jobIds.length > 0
                    ? ` · research job${group.jobIds.length === 1 ? "" : "s"} ${group.jobIds.join(", ")}`
                    : ""}
                </p>
              </article>
            ))}
          </section>
        ) : null}
      </section>
    </div>
  );
}

function IssueCard({
  issue,
  session,
  running,
  onAsk,
  onClose,
  researchRowId,
  onViewSources,
  onResearchCheck,
}: {
  issue: ProductionIssue;
  session: AssistantSession;
  running: boolean;
  onAsk: () => void;
  onClose?: () => void;
  /** Completed research row (jobId or message id) with sources matching this check's domain; null when none. */
  researchRowId?: string | null;
  /** Switches to the Research tab and highlights the research row; absent when no Research tab exists. */
  onViewSources?: () => void;
  /** Composes the check's research draft and turns the Research toggle on (never sends). */
  onResearchCheck?: () => void;
}) {
  const project = useSlate((s) => s.project);
  const [localSuggestion, setLocalSuggestion] = useState(issue.suggest);
  const suggestion = issue.origin === "agentic" ? issue.suggest : localSuggestion;
  const fingerprint = projectFingerprint(project);
  const source =
    issue.origin === "agentic"
      ? (session.report?.source ?? null)
      : {
          projectId: project.id,
          fingerprint,
          reviewFingerprint: fingerprint,
          backendProjectId: null,
          sourceRevision: null,
          resultRevision: null,
        };
  const guard = suggestion
    ? guardPreflightFinding(project, source, { elementId: issue.elementId, ...suggestion })
    : null;
  const edit = (change: { text?: string; note?: string; tag?: MarkTag }) => {
    if (issue.origin === "agentic") editAssistantProposal(project.id, issue.id, change);
    else setLocalSuggestion((value) => (value ? { ...value, ...change } : value));
  };
  const show = () => {
    const state = useSlate.getState();
    if (issue.shotId && state.project.shots.some((shot) => shot.id === issue.shotId)) {
      state.selectShot(issue.shotId);
      state.setView("stage");
      onClose?.();
    } else if (
      issue.elementId &&
      state.project.script.some((element) => element.id === issue.elementId)
    ) {
      state.selectElement(issue.elementId);
      state.setView("script");
      onClose?.();
    }
  };
  const attached =
    issue.origin === "agentic" &&
    (project.scriptCommentThreads ?? []).some((thread) =>
      thread.messages.some(
        (message) => message.source?.findingId === issue.id,
      ),
    );
  return (
    <article className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <Badge
          variant={
            issue.severity === "error" ? "error" : issue.severity === "warn" ? "warn" : "steel"
          }
        >
          {issue.origin === "agentic" ? "Assistant" : "Local"}
        </Badge>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">{issue.title}</h4>
          {issue.origin === "agentic" && suggestion ? (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Original review reasoning</summary>
              <p className="mt-2">{issue.detail}</p>
            </details>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{issue.detail}</p>
          )}
        </div>
      </div>
      {suggestion ? (
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <label className="text-xs">
            Mark type
            <select
              aria-label="Suggested mark type"
              className="mt-1 block w-full rounded border border-border bg-background p-2"
              value={suggestion.tag}
              disabled={running}
              onChange={(event) => edit({ tag: event.target.value as MarkTag })}
            >
              {MARK_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Exact screenplay quote
            <input
              className="mt-1 block w-full rounded border border-border bg-background p-2"
              value={suggestion.text}
              disabled={running}
              onChange={(event) => edit({ text: event.target.value })}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Direction / note
            <textarea
              className="mt-1 min-h-16 w-full rounded border border-border bg-background p-2"
              value={suggestion.note ?? ""}
              disabled={running}
              onChange={(event) => edit({ note: event.target.value })}
            />
          </label>
        </div>
      ) : null}
      {guard && !guard.ok ? <p className="text-xs text-warn">{guard.error}</p> : null}
      {issue.sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          rel="noreferrer"
          target="_blank"
          className="mr-3 inline-flex items-center gap-1 text-xs text-primary underline"
        >
          {source.title}
          <ExternalLink className="size-3" />
        </a>
      ))}
      <div className="flex flex-wrap gap-2">
        {issue.origin === "agentic" && issue.elementId && session.report && (
          <Button
            size="sm"
            variant="outline"
            disabled={running || attached}
            onClick={() => attachAssistantComment(project.id, issue)}
          >
            <MessageSquare />
            {attached ? "Attached to script" : "Attach as comment"}
          </Button>
        )}
        {suggestion ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={running || !guard?.ok}
            onClick={() => acceptAssistantIssue(project.id, { ...issue, suggest: suggestion })}
          >
            <Check />
            Apply mark
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onAsk}>
          <MessageSquare />
          Ask about this
        </Button>
        {researchRowId ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label="View sources"
            title={
              onViewSources
                ? "Opens the Research tab and highlights the completed research job whose sources cite this check."
                : "The Research tab lives in the Production Assistant sidebar."
            }
            disabled={!onViewSources}
            onClick={onViewSources}
          >
            <ExternalLink />
            View sources
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Research this check"
          title="Composes a focused research question in the composer draft with the Research toggle on. Nothing is sent until you press Send."
          onClick={onResearchCheck}
        >
          <Globe />
          Research this check
        </Button>
        {issue.shotId || issue.elementId ? (
          <Button size="sm" variant="ghost" onClick={show}>
            {issue.shotId ? "Show setup" : "Show on page"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => dismissAssistantIssue(project.id, issue)}>
          <X />
          Dismiss
        </Button>
      </div>
    </article>
  );
}

/** Production checks: local + agentic findings, stale-review handling, editable proposals. */
export function AssistantChecksPanel({
  onAskIssue,
  onClose,
  onComposeResearch,
  onViewSources,
}: {
  onAskIssue: (issue: ProductionIssue) => void;
  onClose?: () => void;
  /** Tab switch for a composed research draft: brings its composer forward. */
  onComposeResearch?: () => void;
  /** Switches to the Research tab and highlights the matching research row; absent when no Research tab exists. */
  onViewSources?: (rowId: string) => void;
}) {
  const { project, session, running, issues } = useProductionAssistantContext();
  // Completed Parallel research rows (context notes excluded) the checks
  // domain-match against; no fake data — research that never ran matches nothing.
  const researchRows = session.messages
    .filter((message) => message.provider === "parallel" && !message.researchNoteJobId)
    .map((message) => ({
      id: message.id,
      question: message.question,
      sources: message.sources,
      jobId: message.jobId ?? null,
    }));
  const stale =
    session.report &&
    session.report.source.reviewFingerprint !== projectFingerprint(project);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ScanSearch className="size-4" />
        <h3 className="text-sm font-semibold">Production checks · {issues.length}</h3>
        <span className="text-xs text-muted-foreground">
          Local checks update as you edit.
        </span>
        {session.dismissed.length ? (
          <Button size="sm" variant="ghost" onClick={() => restoreAssistantIssues(project.id)}>
            Restore {session.dismissed.length} dismissed
          </Button>
        ) : null}
      </div>
      <DirectorContinuitySection />
      {stale ? (
        <p className="text-xs text-warn">
          The project changed after this review. Check its exact quotes against the current
          script before applying proposals.
        </p>
      ) : null}
      {session.error && (
        <p role="alert" className="text-xs text-warn">
          {session.error}
        </p>
      )}
      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No open local checks. Ask for a production review when you want a second look.
        </p>
      ) : (
        issues.map((issue) => {
          // Checks ↔ Research wiring (spec section 3): the check's domain is
          // matched against completed research rows only when this surface
          // can act on it; "View sources" then targets the newest matching row.
          const match = onComposeResearch || onViewSources
            ? newestMatchingCheckResearch(issue, researchRows)
            : null;
          const researchRow = match ? (match.jobId ?? match.id) : null;
          return (
            <IssueCard
              key={issue.key}
              issue={issue}
              session={session}
              running={running}
              onAsk={() => {
                clearAssistantCommentContext(project.id);
                setAssistantDraft(project.id, issueQuestionDraft(issue));
                onAskIssue(issue);
              }}
              onClose={onClose}
              researchRowId={researchRow}
              onViewSources={
                researchRow && onViewSources
                  ? () => onViewSources(researchRow)
                  : undefined
              }
              onResearchCheck={
                onComposeResearch
                  ? () => {
                      clearAssistantCommentContext(project.id);
                      setAssistantDraft(project.id, checkResearchQuestion(issue.title));
                      setAssistantComposerResearch(project.id, true);
                      onComposeResearch();
                    }
                  : undefined
              }
            />
          );
        })
      )}
    </section>
  );
}

export type AssistantSidebarTab = "gemini" | "activity" | "checks";

/**
 * Persistent, toggleable co-pilot sidebar beside the main phase view. The
 * Research tab carries the Parallel research jobs; the Assistant tab is the
 * single chat surface whose Copilot work streams inline beside the messages,
 * with the compact Copilot footer chip above the composer as status chrome.
 */
export function ProductionAssistantSidebar({
  open,
  onClose,
  tab: controlledTab,
  onTabChange: onControlledTabChange,
}: {
  /** Whether the dock is expanded beside the main phase view. */
  open: boolean;
  /** Collapse callback for the dock's close button. */
  onClose: () => void;
  /** Controlled tab (used when other surfaces open a specific tab). */
  tab?: AssistantSidebarTab;
  onTabChange?: (tab: AssistantSidebarTab) => void;
}) {
  const { issues, running, researchRunning, session, project } = useProductionAssistantContext();
  const [internalTab, setInternalTab] = useState<AssistantSidebarTab>("gemini");
  // Simple local highlight state for job links (spec section 2): the last
  // research row a chip/card pointed at, highlighted in the Research tab. No
  // url routing — it clears when another row is targeted.
  const [researchHighlight, setResearchHighlight] = useState<string | null>(null);
  // Hooks must run before the closed-pane early return below.
  const agentRuns = usePageAgentRuns((state) => state.runs[project.id] ?? EMPTY_RUNS);
  const activeTab = controlledTab ?? internalTab;
  if (!open) return null;
  const setTab = (next: AssistantSidebarTab) => {
    setInternalTab(next);
    onControlledTabChange?.(next);
  };
  // Job-link seam: switch to the Research tab and highlight the row (or just
  // switch with no row highlight when no row id is given).
  const openResearchRow = (rowId?: string) => {
    setResearchHighlight(rowId ?? null);
    setTab("activity");
  };
  // Research jobs counted for the tab pill: running/failed job plus completed
  // research messages (context notes don't count — they're conversation).
  const researchJobCount =
    session.messages.filter(
      (message) => message.provider === "parallel" && !message.researchNoteJobId,
    ).length +
    (session.researchPending ? 1 : 0) +
    agentRuns.length;
  const tabs: SidebarDockTab<AssistantSidebarTab>[] = [
    {
      id: "gemini",
      label: "Assistant",
      icon: MessageSquare,
      badge: running ? <Loader2 className="inline-block size-3 animate-spin text-primary" /> : null,
      ariaLabel: "Gemini assistant conversation",
      title: "Ask the Gemini production assistant",
    },
    {
      // Tab id stays "activity" (SlateApp holds the controlled tab union);
      // only the label and the pane's role changed.
      id: "activity",
      label: "Research",
      icon: Globe,
      count: researchJobCount > 0 ? researchJobCount : null,
      badge: researchRunning ? (
        <Loader2 className="inline-block size-3 animate-spin text-primary" />
      ) : null,
      ariaLabel: "Parallel research jobs",
      title: "Parallel research jobs",
    },
    {
      id: "checks",
      label: "Checks",
      icon: ScanSearch,
      count: issues.length,
      ariaLabel: "Production checks",
      title: "Production checks and applied review proposals",
    },
  ];
  return (
    <aside aria-label="Production Assistant co-pilot sidebar">
      <SidebarDock
        id="production-assistant-sidebar"
        ariaLabel="Production Assistant co-pilot panel"
        tablistAriaLabel="Production Assistant sidebar tabs"
        title="Production Assistant"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setTab}
        onClose={onClose}
        closeAriaLabel="Close Production Assistant sidebar"
        className="md:h-80 md:w-full md:max-h-[50%] md:border-l-0 lg:h-full lg:max-h-none lg:w-96 lg:border-l lg:border-t-0"
        contentClassName="[&>aside]:border-0"
      >
        {/* One agent lifecycle for the whole dock: the inline Copilot stream in
            the chat feed and the composer's send/steer share it, so the chat
            panel's own provider is a pass-through here. */}
        <PageAgentSessionProvider projectId={project.id}>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {activeTab === "gemini" && (
              <AssistantChatPanel showResearch={false} onOpenResearch={openResearchRow} />
            )}
            {activeTab === "activity" && (
              <AssistantActivityPanel highlightRowId={researchHighlight} />
            )}
            {activeTab === "checks" && (
              <AssistantChecksPanel
                onAskIssue={() => setTab("gemini")}
                onClose={onClose}
                onComposeResearch={() => setTab("gemini")}
                onViewSources={openResearchRow}
              />
            )}
          </div>
        </PageAgentSessionProvider>
      </SidebarDock>
    </aside>
  );
}

/** Existing modal/dialog fallback, unchanged in behavior, now sharing the panels above. */
export function ProductionAssistantDialog({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const { session, running, issues } = useProductionAssistantContext();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,880px)] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-5" />
            Production Assistant{running ? <Loader2 className="size-4 animate-spin" /> : null}
          </DialogTitle>
          <DialogDescription>
            Ask about your film, work through production checks, and edit suggested marks before
            applying them. You can always edit the project yourself.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={onTabChange} className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-border px-6 py-3">
            <TabsList aria-label="Production Assistant views">
              <TabsTrigger value="ask">
                Assistant{session.pending ? " · pending" : ""}
              </TabsTrigger>
              <TabsTrigger value="checks">Production checks · {issues.length}</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <TabsContent value="checks" forceMount className="mt-0 data-[state=inactive]:hidden">
              <AssistantChecksPanel
                onAskIssue={() => onTabChange("ask")}
                onClose={() => onOpenChange(false)}
                onComposeResearch={() => onTabChange("ask")}
              />
            </TabsContent>
            <TabsContent
              value="ask"
              forceMount
              className="mt-0 data-[state=inactive]:hidden"
            >
              <AssistantChatPanel showResearch />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}