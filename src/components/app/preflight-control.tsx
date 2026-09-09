import { Check, ExternalLink, Loader2, MessageSquare, ScanSearch, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectionsControl } from "./cinema-connections";
import { HistoryControl } from "@/components/app/history-control";
import { SaveControl } from "@/components/app/save-control";
import { getCinemaConnections, getCinemaHealth, type CinemaConnection } from "@/lib/cinema-client";
import { localPreflight } from "@/lib/preflight";
import { guardPreflightFinding, projectFingerprint } from "@/lib/preflight-guard";
import { usePreflight } from "@/lib/preflight-store";
import {
  emptyAssistantSession,
  assistantConsentScope,
  assistantConsentMatches,
  productionIssues,
  previewAssistantRebase,
  serializeSavedAssistantReview,
  SAVED_ASSISTANT_REVIEW_MAX_BYTES,
  type AssistantSession,
  type ProductionIssue,
  type AssistantRebasePreview,
  type AssistantConsent,
} from "@/lib/production-assistant";
import {
  acceptAssistantIssue,
  attachAssistantComment,
  askAssistant,
  clearAssistantCommentContext,
  confirmAssistantRebase,
  dismissAssistantIssue,
  editAssistantProposal,
  hydrateAssistant,
  importSavedAssistantReview,
  reloadAssistantReport,
  resetAssistantRequest,
  restoreAssistantIssues,
  resumeAssistant,
  setAssistantDraft,
  syncAssistantCommentReplies,
  PRODUCTION_ASSISTANT_OPEN_EVENT,
  useProductionAssistant,
} from "@/lib/production-assistant-store";
import { useSlate } from "@/lib/store";
import { MARK_TAGS, type MarkTag } from "@/lib/types";

export function PreflightControl({
  presentation = "compact",
}: {
  presentation?: "compact" | "workspace";
}) {
  const project = useSlate((s) => s.project);
  const view = useSlate((s) => s.view);
  const continuity = useSlate((s) => s.issues);
  const reportOpen = usePreflight((s) => s.reportOpen);
  const setReportOpen = usePreflight((s) => s.setReportOpen);
  const legacyFindings = usePreflight((s) => s.findings);
  const legacySource = usePreflight((s) => s.source);
  const saved = useProductionAssistant((s) => s.sessions[project.id]);
  const running = useProductionAssistant((s) => !!s.running[project.id]);
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
  const [activeTab, setActiveTab] = useState("ask");
  useEffect(() => {
    const showThreadQuestion = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.projectId !== project.id) return;
      setActiveTab("ask");
      setReportOpen(true);
    };
    window.addEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, showThreadQuestion);
    return () => window.removeEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, showThreadQuestion);
  }, [project.id, setReportOpen]);
  const openAssistant = (tab = "ask") => {
    setActiveTab(tab);
    setReportOpen(true);
  };
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return (
    <>
      {presentation === "workspace" ? (
        <section
          aria-label="Production Assistant"
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/70 px-4 py-2.5"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (view === "stage") {
                window.dispatchEvent(new CustomEvent("slate:stage-open-dock", { detail: "copilot" }));
              } else {
                openAssistant("ask");
              }
            }}
            className="h-8 gap-2 px-2 text-sm font-semibold text-foreground hover:bg-secondary/60 shrink-0"
            aria-label="Open Production Assistant"
            title={view === "stage" ? "Open Stage Co-Pilot" : "Ask Production Assistant"}
          >
            {running ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <MessageSquare className="size-4 text-primary" />
            )}
            <span>Production Assistant</span>
          </Button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {issues.length > 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {errors ? `${errors} to fix · ` : ""}
                {warnings ? `${warnings} to review · ` : ""}
                {issues.length} {issues.length === 1 ? "check" : "checks"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Local checks clear</span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {running
                ? "Thinking with your saved project…"
                : session.pending
                  ? "An earlier question needs your attention."
                  : (issues[0]?.title ??
                    "Ask about story, coverage, style, or your next production step.")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={() => openAssistant("checks")}>
              <ScanSearch className="size-3.5" />
              <span>Review checks</span>
            </Button>
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            <HistoryControl />
            <SaveControl />
          </div>
        </section>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => openAssistant()} aria-busy={running}>
          {running ? <Loader2 className="animate-spin" /> : <MessageSquare />}
          <span>Production Assistant</span>
          {issues.length ? <Badge variant="steel">{issues.length}</Badge> : null}
        </Button>
      )}
      <AssistantDialog
        key={project.id}
        open={reportOpen}
        onOpenChange={setReportOpen}
        session={session}
        issues={issues}
        running={running}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}

function AssistantDialog({
  open,
  onOpenChange,
  session,
  issues,
  running,
  activeTab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AssistantSession;
  issues: ProductionIssue[];
  running: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const project = useSlate((s) => s.project);
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [parallelConnectionId, setParallelConnectionId] = useState("");
  const [research, setResearch] = useState(false);
  const [officialDocs, setOfficialDocs] = useState(false);
  const [consent, setConsent] = useState<AssistantConsent | null>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("slate:assistant-connection-consent") ?? "null",
      );
      return saved &&
        typeof saved.scope === "string" &&
        saved.scope.length <= 2000 &&
        typeof saved.expiresAt === "number" &&
        saved.expiresAt > Date.now()
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const [checkingRequest, setCheckingRequest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState("Model status unavailable");
  const [modelConfigured, setModelConfigured] = useState(false);
  const [rebasePreview, setRebasePreview] = useState<AssistantRebasePreview | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);
  const reviewFile = useRef<HTMLInputElement>(null);
  const [reviewJson, setReviewJson] = useState("");
  const [reviewTransferError, setReviewTransferError] = useState<string | null>(null);
  const [readingReview, setReadingReview] = useState(false);
  const readReview = (raw: string) => {
    try {
      importSavedAssistantReview(project.id, raw);
      setReviewJson("");
      setReviewTransferError(null);
      setRebasePreview(null);
      onTabChange("checks");
    } catch (error) {
      setReviewTransferError(
        error instanceof Error ? error.message : "Could not open this saved review.",
      );
    }
  };
  const downloadReview = () => {
    try {
      const raw = serializeSavedAssistantReview(session);
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `slate-review-${project.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReviewTransferError(null);
    } catch (error) {
      setReviewTransferError(
        error instanceof Error ? error.message : "Could not download this review.",
      );
    }
  };
  const rememberConsent = useCallback((value: AssistantConsent | null) => {
    setConsent(value);
    try {
      if (value)
        sessionStorage.setItem("slate:assistant-connection-consent", JSON.stringify(value));
      else sessionStorage.removeItem("slate:assistant-connection-consent");
    } catch {
      /* Consent remains in this mounted workspace when browser storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    if (!consent) return;
    const timer = window.setTimeout(
      () => rememberConsent(null),
      Math.max(0, consent.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [consent, rememberConsent]);
  const refresh = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    const [available, health] = await Promise.allSettled([
      getCinemaConnections(),
      getCinemaHealth(),
    ]);
    if (available.status === "fulfilled") {
      setConnections(available.value);
      // A disconnect invalidates the remembered credential record even before the next request.
      setConsent((current) => {
        if (!current) return current;
        try {
          const selected = JSON.parse(current.scope) as [string, string, number][];
          if (
            selected.every(([provider, id, expiry]) =>
              available.value.some(
                (item) =>
                  item.provider === provider &&
                  item.connectionId === id &&
                  item.expiresAt === expiry &&
                  expiry * 1000 > Date.now(),
              ),
            )
          )
            return current;
        } catch {
          /* Invalid saved approval cannot authorize a request. */
        }
        try {
          sessionStorage.removeItem("slate:assistant-connection-consent");
        } catch {
          /* Storage may be disabled. */
        }
        return null;
      });
      setConnectionId(
        (id) =>
          available.value.find(
            (item) => item.connectionId === id && item.provider === "google-cloud",
          )?.connectionId ??
          available.value.find((item) => item.provider === "google-cloud")?.connectionId ??
          "",
      );
      setParallelConnectionId(
        (id) =>
          available.value.find((item) => item.connectionId === id && item.provider === "parallel")
            ?.connectionId ??
          available.value.find((item) => item.provider === "parallel")?.connectionId ??
          "",
      );
    } else {
      rememberConsent(null);
      setConnections([]);
      setConnectionId("");
      setParallelConnectionId("");
      setConnectionError(
        available.reason instanceof Error ? available.reason.message : "Connections unavailable.",
      );
    }
    if (health.status === "fulfilled") {
      const capability = health.value.capabilities.preflight;
      setModelConfigured(capability?.status === "configured");
      setModelStatus(
        capability
          ? `${capability.model ?? "Google ADK"} · ${capability.status === "configured" ? "configured" : "unavailable"}`
          : "Assistant model unavailable",
      );
    } else {
      setModelConfigured(false);
      setModelStatus("Assistant model status unavailable");
    }
    setLoading(false);
  }, [rememberConsent]);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  const stale =
    session.report &&
    (session.report.savedReview?.comparisonRequired ||
      session.report.source.reviewFingerprint !== projectFingerprint(project));
  const locked = running || !!session.pending || checkingRequest;
  const selectedConsent = assistantConsentScope(
    connections,
    connectionId,
    research,
    parallelConnectionId,
  );
  const approved = assistantConsentMatches(consent, selectedConsent);
  const submitQuestion = async () => {
    if (locked || !approved) return;
    const draft = session.draft;
    setCheckingRequest(true);
    try {
      // Read-only validation catches a disconnected or expired credential before dispatch.
      const current = await getCinemaConnections();
      setConnections(current);
      const selected = assistantConsentScope(current, connectionId, research, parallelConnectionId);
      if (!assistantConsentMatches(consent, selected)) {
        rememberConsent(null);
        setConnectionError(
          "Your selected connection changed or expired. Reconnect and approve it before asking.",
        );
        return;
      }
      if (
        useSlate.getState().project.id !== project.id ||
        useProductionAssistant.getState().sessions[project.id]?.draft !== draft
      )
        return;
      askAssistant(project.id, { connectionId, research, officialDocs, parallelConnectionId });
    } catch (error) {
      rememberConsent(null);
      setConnectionError(
        error instanceof Error ? error.message : "Could not check this connection.",
      );
    } finally {
      setCheckingRequest(false);
    }
  };
  const compareReview = () => {
    if (!session.report) return;
    try {
      setRebasePreview(previewAssistantRebase(project, session.report));
      setRebaseError(null);
    } catch (error) {
      setRebaseError(
        error instanceof Error ? error.message : "Could not compare this saved review.",
      );
    }
  };
  const issueQuestion = (issue: ProductionIssue) => {
    clearAssistantCommentContext(project.id);
    setAssistantDraft(
      project.id,
      `Help me work through this production note: ${issue.title}. ${issue.detail}${issue.shotId ? ` Setup ID: ${issue.shotId}.` : ""}${issue.elementId ? ` Screenplay element: ${issue.elementId}.` : ""} Explain my options before proposing any changes.`,
    );
    onTabChange("ask");
  };
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
                Ask assistant{session.pending ? " · pending" : ""}
              </TabsTrigger>
              <TabsTrigger value="checks">Production checks · {issues.length}</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <details
              aria-label="Saved review files"
              className="mb-3 space-y-2 text-xs"
            >
              <summary className="cursor-pointer text-muted-foreground">Saved reviews</summary>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || readingReview}
                  onClick={() => reviewFile.current?.click()}
                >
                  {readingReview ? "Reading review…" : "Open saved review"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked || !session.report?.jobId}
                  onClick={downloadReview}
                >
                  Download review
                </Button>
                <input
                  ref={reviewFile}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  aria-label="Choose saved review JSON"
                  tabIndex={-1}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setReadingReview(true);
                    try {
                      if (file.size > SAVED_ASSISTANT_REVIEW_MAX_BYTES)
                        throw new Error("Saved reviews must be smaller than 4 MB.");
                      readReview(await file.text());
                    } catch (error) {
                      setReviewTransferError(
                        error instanceof Error ? error.message : "Could not read this file.",
                      );
                    } finally {
                      setReadingReview(false);
                    }
                  }}
                />
              </div>
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  Paste saved review JSON
                </summary>
                <label className="mt-2 block space-y-1">
                  Saved review JSON
                  <textarea
                    value={reviewJson}
                    maxLength={SAVED_ASSISTANT_REVIEW_MAX_BYTES}
                    className="min-h-20 w-full rounded border border-border bg-background p-2 font-mono"
                    onChange={(event) => setReviewJson(event.target.value)}
                    disabled={locked || readingReview}
                  />
                </label>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={locked || readingReview || !reviewJson.trim()}
                  onClick={() => readReview(reviewJson)}
                >
                  Open pasted review
                </Button>
              </details>
              <p className="text-muted-foreground">
                Open into an empty Assistant. Review files include saved script context and
                citations.
              </p>
              {reviewTransferError && (
                <p role="alert" className="text-warn">
                  {reviewTransferError}
                </p>
              )}
            </details>
            {session.report?.savedReview && (
              <p className="mb-3 text-xs text-muted-foreground" role="status">
                Imported review · source information comes from the saved file.
                {session.report.savedReview.comparisonRequired
                  ? " Compare its notes with this script before applying them."
                  : " Comparison recorded; choose which notes to apply."}
              </p>
            )}
            <TabsContent value="checks" forceMount className="mt-0 data-[state=inactive]:hidden">
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ScanSearch className="size-4" />
                  <h3 className="text-sm font-semibold">Production checks · {issues.length}</h3>
                  <span className="text-xs text-muted-foreground">
                    Local checks update as you edit.
                  </span>
                  {session.report?.jobId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={running}
                      onClick={() => void reloadAssistantReport(project.id)}
                      title="Retrieve the existing result without making a new model call"
                    >
                      Reload saved review
                    </Button>
                  ) : null}
                  {session.dismissed.length ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restoreAssistantIssues(project.id)}
                    >
                      Restore {session.dismissed.length} dismissed
                    </Button>
                  ) : null}
                </div>
                {stale ? (
                  <div className="space-y-2 rounded border border-warn/40 p-3 text-xs">
                    <p className="text-warn">
                      {session.report?.savedReview?.comparisonRequired
                        ? "This imported review needs a comparison with the current script before applying proposals."
                        : "The project changed after this review. Check its exact quotes against the current script before applying proposals."}
                    </p>
                    <Button size="sm" variant="outline" disabled={locked} onClick={compareReview}>
                      Review against current script
                    </Button>
                  </div>
                ) : null}
                {rebaseError && (
                  <p role="alert" className="text-xs text-warn">
                    {rebaseError}
                  </p>
                )}
                {session.error && (
                  <p role="alert" className="text-xs text-warn">
                    {session.error}
                  </p>
                )}
                {rebasePreview && (
                  <section
                    aria-label="Saved review comparison"
                    className="space-y-3 rounded-md border border-border bg-muted/20 p-3 text-xs"
                  >
                    <h4 className="font-semibold">
                      Source review compared with your current project
                    </h4>
                    <ul className="list-disc space-y-1 pl-4">
                      {rebasePreview.summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p>
                      {rebasePreview.validFindingIds.length} proposals still match an exact, unique
                      quote in the same script passage. {rebasePreview.unresolved.length} remain
                      unresolved.
                    </p>
                    {!!rebasePreview.unresolved.length && (
                      <details>
                        <summary className="cursor-pointer">Review unresolved findings</summary>
                        <ul className="mt-2 space-y-2">
                          {rebasePreview.unresolved.map((item) => (
                            <li key={item.findingId}>
                              <strong>
                                {session.report?.findings.find(
                                  (finding) => finding.id === item.findingId,
                                )?.title ?? item.findingId}
                              </strong>
                              : {item.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <p className="text-muted-foreground">
                      This keeps the original source snapshot, job and findings. It rechecks anchors
                      without a model call; each mark still needs your Apply action.
                    </p>
                    {(rebasePreview.projectFingerprint !== projectFingerprint(project) ||
                      rebasePreview.reportFingerprint !== JSON.stringify(session.report)) && (
                      <p className="text-warn">
                        The comparison changed. Review it again before continuing.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={
                          locked ||
                          rebasePreview.projectFingerprint !== projectFingerprint(project) ||
                          rebasePreview.reportFingerprint !== JSON.stringify(session.report)
                        }
                        onClick={() => {
                          if (confirmAssistantRebase(project.id, rebasePreview))
                            setRebasePreview(null);
                        }}
                      >
                        Use current script for this review
                      </Button>
                      <Button size="sm" variant="ghost" onClick={compareReview}>
                        Refresh comparison
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRebasePreview(null)}>
                        Cancel
                      </Button>
                    </div>
                  </section>
                )}
                {!stale && session.report?.rebases?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Saved review explicitly rechecked against the script ·{" "}
                    {session.report.rebases.at(-1)!.validFindingIds.length} matching proposals ·{" "}
                    {session.report.rebases.at(-1)!.unresolved.length} unresolved at that check.
                  </p>
                ) : null}
                {issues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No open local checks. Ask for a production review when you want a second look.
                  </p>
                ) : (
                  issues.map((issue) => (
                    <IssueCard
                      key={issue.key}
                      issue={issue}
                      session={session}
                      running={running}
                      onAsk={() => issueQuestion(issue)}
                      onClose={() => onOpenChange(false)}
                    />
                  ))
                )}
              </section>
            </TabsContent>
            <TabsContent
              value="ask"
              forceMount
              className="mt-0 space-y-4 data-[state=inactive]:hidden"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="steel">Complete project context</Badge>
                {!!project.scriptCommentThreads?.length && (
                  <Badge variant="steel">
                    {project.scriptCommentThreads.length} script threads
                  </Badge>
                )}
              </div>
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
              {session.messages.length > 0 ? (
                <div aria-label="Assistant conversation" className="space-y-3">
                  {session.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`rounded-md border border-border p-3 text-sm ${message.role === "user" ? "ml-6 bg-muted/40" : "mr-6 bg-card"}`}
                    >
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">
                        {message.role === "user" ? "You" : "Production Assistant"}
                        {message.threadId ? " · script thread" : ""}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{message.text}</p>
                      {message.sources?.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 mr-3 inline-flex items-center gap-1 text-xs text-primary underline"
                        >
                          {source.title}
                          <ExternalLink className="size-3" />
                        </a>
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Try “What should I work on next?”, “How can this scene feel more tense?”, or ask
                  about one of your production checks.
                </p>
              )}
              {session.pending ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <p className="font-medium">
                    {running
                      ? "Working on the saved question…"
                      : "Saved question awaiting recovery"}
                  </p>
                  <p className="whitespace-pre-wrap">
                    {String(session.pending.request.input.question ?? "")}
                  </p>
                  <p>
                    {session.pending.jobId
                      ? `Job: ${session.pending.jobId}`
                      : `Request: ${session.pending.request.idempotencyKey}`}
                  </p>
                  <p>
                    {session.pending.request.input.research
                      ? "Google + Parallel research"
                      : "Google only"}{" "}
                    · uses the project snapshot captured when you asked.
                  </p>
                  {!running && session.pending.phase === "ready" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resumeAssistant(project.id)}
                    >
                      Resume same request
                    </Button>
                  ) : null}
                  {!running && session.canRestart ? (
                    <Button
                      className="ml-2"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        try {
                          resetAssistantRequest(project.id);
                        } catch {
                          /* Existing recovery stays visible if storage is full. */
                        }
                      }}
                    >
                      Prepare a new question
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {session.error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
                >
                  {session.error}
                </p>
              ) : null}
              <label className="block space-y-1 text-sm font-medium">
                Your question
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-border bg-background p-3 text-sm font-normal"
                  maxLength={4000}
                  disabled={checkingRequest}
                  value={session.draft}
                  onChange={(event) => {
                    setAssistantDraft(project.id, event.target.value);
                  }}
                  placeholder="Ask about the whole film or a specific production choice…"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAssistantDraft(
                      project.id,
                      "Review this complete project for production readiness. Prioritize the next useful steps, explain any continuity or coverage issues, and propose only specific screenplay marks that would help.",
                    );
                  }}
                >
                  Draft production review
                </Button>
              </div>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Assistant settings · {connectionId ? "Google selected" : "connection needed"}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ConnectionsControl />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={loading || running}
                      onClick={() => void refresh()}
                    >
                      {loading ? "Checking…" : "Refresh connections"}
                    </Button>
                  </div>

                  <p className="break-words text-xs text-muted-foreground">{modelStatus}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="min-w-0 text-xs">
                      Google Cloud
                      <select
                        className="ml-2 max-w-full rounded border border-border bg-background px-2 py-1.5"
                        value={connectionId}
                        disabled={locked}
                        onChange={(event) => {
                          setConnectionId(event.target.value);
                          rememberConsent(null);
                        }}
                      >
                        <option value="">Choose a connection</option>
                        {connections
                          .filter((connection) => connection.provider === "google-cloud")
                          .map((connection, index) => (
                            <option key={connection.connectionId} value={connection.connectionId}>
                              Google {index + 1} · …{connection.connectionId.slice(-6)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={research}
                        disabled={locked}
                        onChange={(event) => {
                          setResearch(event.target.checked);
                          rememberConsent(null);
                        }}
                      />
                      Add Parallel research
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={officialDocs}
                        disabled={locked}
                        onChange={(event) => {
                          setOfficialDocs(event.target.checked);
                          rememberConsent(null);
                        }}
                      />
                      Official Gemini docs
                    </label>
                  </div>
                  {research ? (
                    <label className="block text-xs">
                      Parallel connection
                      <select
                        className="ml-2 rounded border border-border bg-background px-2 py-1.5"
                        value={parallelConnectionId}
                        disabled={locked}
                        onChange={(event) => {
                          setParallelConnectionId(event.target.value);
                          rememberConsent(null);
                        }}
                      >
                        <option value="">Choose a connection</option>
                        {connections
                          .filter((connection) => connection.provider === "parallel")
                          .map((connection, index) => (
                            <option key={connection.connectionId} value={connection.connectionId}>
                              Parallel {index + 1} · …{connection.connectionId.slice(-6)}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              </details>
              {connectionError ? (
                <p role="alert" className="text-xs text-destructive">
                  {connectionError}
                </p>
              ) : null}
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    className="mt-0.5"
                    type="checkbox"
                    checked={approved}
                    disabled={locked || loading || !selectedConsent}
                    onChange={(event) =>
                      rememberConsent(event.target.checked ? selectedConsent : null)
                    }
                  />
                  <span>
                    Allow Assistant requests using my selected connection{research ? "s" : ""} for
                    this browser session. Provider charges may apply; every request starts only when
                    I press Ask assistant.
                  </span>
                </label>
                <Button
                  size="sm"
                  disabled={
                    locked ||
                    loading ||
                    !approved ||
                    !session.draft.trim() ||
                    !connectionId ||
                    !modelConfigured ||
                    (research && !parallelConnectionId)
                  }
                  onClick={() => void submitQuestion()}
                >
                  {running || checkingRequest ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <MessageSquare />
                  )}
                  {checkingRequest ? "Checking connection…" : "Ask assistant"}
                </Button>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function IssueCard({
  issue,
  session,
  running,
  onAsk,
  onClose,
}: {
  issue: ProductionIssue;
  session: AssistantSession;
  running: boolean;
  onAsk: () => void;
  onClose: () => void;
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
  const guard =
    issue.origin === "agentic" && session.report?.savedReview?.comparisonRequired
      ? {
          ok: false as const,
          error: "Compare this imported review with the current script before applying it.",
        }
      : suggestion
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
      onClose();
    } else if (
      issue.elementId &&
      state.project.script.some((element) => element.id === issue.elementId)
    ) {
      state.selectElement(issue.elementId);
      state.setView("script");
      onClose();
    }
  };
  const attached =
    issue.origin === "agentic" &&
    (project.scriptCommentThreads ?? []).some((thread) =>
      thread.messages.some(
        (message) =>
          message.source?.jobId === session.report?.jobId && message.source?.findingId === issue.id,
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
        {issue.origin === "agentic" && issue.elementId && session.report?.jobId && (
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
