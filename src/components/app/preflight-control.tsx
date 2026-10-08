import { Loader2, MessageSquare, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HistoryControl } from "@/components/app/history-control";
import { SaveControl } from "@/components/app/save-control";
import {
  ProductionAssistantDialog,
  useProductionAssistantContext,
} from "@/components/app/production-assistant-sidebar";
import { usePreflight } from "@/lib/preflight-store";
import {
  PRODUCTION_ASSISTANT_OPEN_EVENT,
} from "@/lib/production-assistant-store";
import { useSlate } from "@/lib/store";

/**
 * Workspace/compact toolbar for the global Production Assistant.
 *
 * The unified co-pilot toggles the persistent sidebar when one is wired up;
 * the modal stays as the fallback surface (thread questions, review checks in
 * presentations without a sidebar). Session state comes solely from
 * `ProductionAssistantProvider` and the production-assistant store.
 */
export function PreflightControl({
  presentation = "compact",
  copilotOpen = false,
  onToggleCopilot,
  onOpenCopilotChecks,
}: {
  presentation?: "compact" | "workspace";
  /** Whether the unified co-pilot sidebar is expanded. */
  copilotOpen?: boolean;
  /** Toggle the global Production Assistant sidebar; surfaces without a sidebar fall back to the dialog. */
  onToggleCopilot?: () => void;
  /** Open the co-pilot sidebar directly on the production checks tab. */
  onOpenCopilotChecks?: () => void;
}) {
  const project = useSlate((s) => s.project);
  const { session, issues, running } = useProductionAssistantContext();
  const reportOpen = usePreflight((s) => s.reportOpen);
  const setReportOpen = usePreflight((s) => s.setReportOpen);
  const [activeTab, setActiveTab] = useState("ask");
  useEffect(() => {
    const showThreadQuestion = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.projectId !== project.id) return;
      setActiveTab("ask");
      // A staged assistant question (thread question or a WebMCP studio tool)
      // must open the wired-up sidebar when one exists, never the modal
      // fallback. The staged draft is already in the sidebar composer.
      if (onToggleCopilot) {
        if (!copilotOpen) onToggleCopilot();
        return;
      }
      setReportOpen(true);
    };
    window.addEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, showThreadQuestion);
    return () => window.removeEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, showThreadQuestion);
  }, [project.id, setReportOpen, onToggleCopilot, copilotOpen]);
  const openAssistant = (tab = "ask") => {
    setActiveTab(tab);
    setReportOpen(true);
  };
  const toggleAssistant = () => {
    if (onToggleCopilot) {
      onToggleCopilot();
      return;
    }
    openAssistant("ask");
  };
  const openChecks = () => {
    if (onOpenCopilotChecks) {
      onOpenCopilotChecks();
      return;
    }
    openAssistant("checks");
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
            onClick={toggleAssistant}
            className="h-8 gap-2 px-2 text-sm font-semibold text-foreground hover:bg-secondary/60 shrink-0"
            aria-label="Toggle Production Assistant"
            aria-expanded={copilotOpen}
            title="Toggle Production Assistant"
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
            <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={openChecks}>
              <ScanSearch className="size-3.5" />
              <span>Review checks</span>
            </Button>
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            <HistoryControl />
            <SaveControl />
          </div>
        </section>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAssistant}
          aria-busy={running}
          aria-expanded={copilotOpen}
        >
          {running ? <Loader2 className="animate-spin" /> : <MessageSquare />}
          <span>Production Assistant</span>
          {issues.length ? <Badge variant="steel">{issues.length}</Badge> : null}
        </Button>
      )}
      <ProductionAssistantDialog
        key={project.id}
        open={reportOpen}
        onOpenChange={setReportOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}