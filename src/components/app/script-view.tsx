import {
  Clapperboard,
  Code2,
  Eye,
  EyeOff,
  GripVertical,
  Highlighter,
  MessageSquare,
  MousePointer2,
  PanelRight,
  PencilLine,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BreakdownIndex } from "@/components/app/breakdown-index";
import { CoverageDesk, type DeskTab } from "@/components/app/coverage-desk";
import { Inspector } from "@/components/app/inspector";
import { MarkPopover, type MarkDraft } from "@/components/app/mark-popover";
import { ScriptMarkFloatingPopover } from "@/components/app/script-mark-popover";
import { EditorSaveButton } from "@/components/app/save-control";
import { SidebarDock, type SidebarDockTab } from "@/components/app/sidebar-dock";
import {
  ScriptCommentComposer,
  ScriptCommentFloatingPopover,
  ScriptCommentsIndex,
  ScriptCommentsList,
  SCRIPT_COMMENT_REANCHOR_EVENT,
} from "@/components/app/script-comments-panel";
import { SetupPicker } from "@/components/app/setup-picker";
import { ShotStill } from "@/components/app/shot-still";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  colWidth,
  columnCount,
  coverageLabel,
  estimateLiningGeom,
  framingLabel,
  gutterWidth,
  labelSpace,
  LINE_COLOR_BG,
  LINE_COLOR_CLASS,
  LINE_COLOR_VAR,
  linedShots,
  marginNumber,
  nearestElementId,
  shotsCovering,
  tightestCovering,
} from "@/lib/lining";
import { departmentFor, markColor, markMeta, sceneIdOf } from "@/lib/marks";

import { flushSave } from "@/lib/save";
import { toLiningJsonl, toSlateMd } from "@/lib/slate-md";
import { useSlate } from "@/lib/store";
import {
  resolveScriptCommentAnchor,
  type ScriptCommentAnchor,
  type ScriptCommentThread,
} from "@/lib/script-comments";
import type { ScriptElement, ScriptKind, ScriptMark, Shot } from "@/lib/types";
import { isBoardable } from "@/lib/types";
import { cn } from "@/lib/utils";

type DragEdge = { shotId: string; edge: "start" | "end" };
type DrawDraft = { startId: string; hoverId: string };
type PageMode = "select" | "line" | "mark" | "comment";
type ScriptSidebarTab = "coverage" | "breakdown" | "comments";
const SCRIPT_SIDEBAR_TABS: SidebarDockTab<ScriptSidebarTab>[] = [
  { id: "coverage", label: "Coverage", icon: Clapperboard },
  {
    id: "breakdown",
    label: "Breakdown",
    icon: (props) => <Highlighter className={cn(props?.className, "text-warn")} />,
  },
  { id: "comments", label: "Notes", icon: MessageSquare },
];
const EMPTY_IDS: string[] = [];

interface ScriptTextSegment {
  text: string;
  start: number;
  end: number;
  mark?: ScriptMark;
  threads: ScriptCommentThread[];
}

function buildScriptSegments(
  text: string,
  marks: ScriptMark[],
  resolvedThreads: { thread: ScriptCommentThread; start: number; end: number }[],
): ScriptTextSegment[] {
  if (!text) return [];

  const usableMarks = marks.filter(
    (m) => !m.anchorStatus && m.start >= 0 && m.end <= text.length && m.start < m.end,
  );

  const usableThreads = resolvedThreads.filter(
    (t) => t.start >= 0 && t.end <= text.length && t.start < t.end,
  );

  if (!usableMarks.length && !usableThreads.length) {
    return [{ text, start: 0, end: text.length, threads: [] }];
  }

  const points = new Set<number>([0, text.length]);
  for (const m of usableMarks) {
    points.add(m.start);
    points.add(m.end);
  }
  for (const t of usableThreads) {
    points.add(t.start);
    points.add(t.end);
  }

  const sorted = Array.from(points).sort((a, b) => a - b);
  const segments: ScriptTextSegment[] = [];

  for (let idx = 0; idx < sorted.length - 1; idx++) {
    const s = sorted[idx];
    const e = sorted[idx + 1];
    if (s >= e) continue;

    const slice = text.slice(s, e);
    const mark = usableMarks.find((m) => m.start <= s && m.end >= e);
    const ths = usableThreads.filter((t) => t.start <= s && t.end >= e).map((t) => t.thread);

    segments.push({
      text: slice,
      start: s,
      end: e,
      mark,
      threads: ths,
    });
  }

  return segments;
}

export function ScriptView() {
  const project = useSlate((s) => s.project);
  const selectedElementId = useSlate((s) => s.selectedElementId);
  const selectedElementIds = useSlate((s) => s.selectedElementIds) ?? EMPTY_IDS;
  const selectedId = useSlate((s) => s.selectedId);
  const selectElement = useSlate((s) => s.selectElement);
  const selectShot = useSlate((s) => s.selectShot);
  const addElement = useSlate((s) => s.addElement);
  const lineRange = useSlate((s) => s.lineRange);
  const [source, setSource] = useState<"page" | "md" | "jsonl">("page");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<PageMode>("select");
  const [sidebarTab, setSidebarTab] = useState<ScriptSidebarTab>("coverage");
  const [deskTab, setDeskTab] = useState<DeskTab>("beat");
  const [showSidebar, setShowSidebar] = useState(true);
  const [liningOn, setLiningOn] = useState(true);
  const [drawStart, setDrawStart] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragEdge | null>(null);
  const [gutterDraft, setGutterDraft] = useState<DrawDraft | null>(null);
  const [markDraft, setMarkDraft] = useState<MarkDraft | null>(null);
  const [commentDraft, setCommentDraft] = useState<ScriptCommentAnchor | null>(null);
  const [reanchorThreadId, setReanchorThreadId] = useState<string | undefined>();
  const [commentPopover, setCommentPopover] = useState<{
    threadId: string;
    x: number;
    y: number;
  } | null>(null);
  const [markPopover, setMarkPopover] = useState<{
    projectId: string;
    markId: string;
    x: number;
    y: number;
  } | null>(null);
  const importSlate = useSlate((s) => s.importSlate);
  const moveElement = useSlate((s) => s.moveElement);
  const drawing = mode === "line";
  const appliedSource = useRef("");

  const handleSelectShot = (shotId: string) => {
    selectShot(shotId);
    setDeskTab("controls");
    setSidebarTab("coverage");
    setShowSidebar(true);
  };

  const handleSelectStoryboard = (shotId: string) => {
    selectShot(shotId);
    setDeskTab("visuals");
    setSidebarTab("coverage");
    setShowSidebar(true);
  };

  useEffect(() => {
    setCommentDraft(null);
    setReanchorThreadId(undefined);
    setCommentPopover(null);
    setMarkPopover(null);
  }, [project.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCommentPopover(null);
        setMarkPopover(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const reattach = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        event.detail?.projectId !== project.id ||
        !(project.scriptCommentThreads ?? []).some((thread) => thread.id === event.detail.threadId)
      )
        return;
      setSource("page");
      setMode("comment");
      setMarkDraft(null);
      setCommentDraft(null);
      setReanchorThreadId(event.detail.threadId);
      toast.info("Select the exact script passage to reattach this thread.");
    };
    window.addEventListener(SCRIPT_COMMENT_REANCHOR_EVENT, reattach);
    return () => window.removeEventListener(SCRIPT_COMMENT_REANCHOR_EVENT, reattach);
  }, [project.id, project.scriptCommentThreads]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMarkDraft(null);
        setCommentDraft(null);
        setReanchorThreadId(undefined);
        setMode("select");
        setDrawStart(null);
        setGutterDraft(null);
      }
      if (!(e.altKey || e.metaKey)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const id = useSlate.getState().selectedElementId;
      if (!id) return;
      e.preventDefault();
      moveElement(id, e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveElement]);

  useEffect(() => {
    const current = useSlate.getState().project;
    if (source === "md") {
      const next = toSlateMd(current);
      setDraft(next);
      appliedSource.current = next;
    }
    if (source === "jsonl") {
      const next = toLiningJsonl(current);
      setDraft(next);
      appliedSource.current = next;
    }
  }, [source]);

  const applySource = (leave: boolean) => {
    if (!leave && draft === appliedSource.current) return true;
    const res =
      source === "jsonl"
        ? importSlate(toSlateMd(project), draft)
        : importSlate(draft, toLiningJsonl(project));
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    appliedSource.current = draft;
    flushSave();
    if (leave) {
      toast.success(`Saved. ${res.shots} lines.`);
      setSource("page");
    }
    return true;
  };

  useEffect(() => {
    if (source === "page") return;
    const t = window.setTimeout(() => {
      const current =
        source === "md"
          ? toSlateMd(useSlate.getState().project)
          : toLiningJsonl(useSlate.getState().project);
      if (draft === current) return;
      applySource(false);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [draft, source]);

  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(null);
    window.addEventListener("mouseup", up);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  const finishRange = (startId: string, endId: string, shotId?: string | null) => {
    lineRange(startId, endId, shotId);
    setDrawStart(null);
    setMode("select");
    setGutterDraft(null);
    if (!shotId) toast.success("Coverage lined");
  };

  const onBlockPointer = (
    id: string,
    e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  ) => {
    if (drag) {
      const shot = project.shots.find((s) => s.id === drag.shotId);
      if (!shot) return;
      const ids = shot.elementIds;
      const start = drag.edge === "start" ? id : (ids[0] ?? id);
      const end = drag.edge === "end" ? id : (ids[ids.length - 1] ?? id);
      finishRange(start, end, shot.id);
      return;
    }
    if (drawing || gutterDraft) {
      if (!drawStart) {
        setDrawStart(id);
        selectElement(id);
        return;
      }
      finishRange(drawStart, id, null);
      return;
    }
    if (mode === "mark" || mode === "comment") {
      selectElement(id);
      setDeskTab("beat");
      setSidebarTab("coverage");
      setShowSidebar(true);
      return;
    }
    const selMode = e?.shiftKey ? "range" : e?.metaKey || e?.ctrlKey ? "toggle" : "replace";
    selectElement(id, selMode);
    setDeskTab("beat");
    setSidebarTab("coverage");
    setShowSidebar(true);
  };

  if (project.script.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-3xl">No pages yet.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Import a Fountain or plain screenplay, or start a blank script.
        </p>
        <ScriptCommentsIndex />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div className="flex min-h-0 min-w-0 shrink-0 flex-col md:flex-1">
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 sm:px-4">
          {/* Left: Stats & Setup selection */}
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border/40 bg-secondary/80 px-2 py-1 font-mono text-xs text-muted-foreground">
              {project.script.filter((e) => e.kind === "scene").length} scenes · {project.shots.length} lines
              {selectedElementIds.length > 1 ? ` · ${selectedElementIds.length} sel` : ""}
            </span>
            <SetupPicker selectedId={selectedId} onSelect={handleSelectShot} />
          </div>

          {/* Center: Tool mode switcher */}
          <div className="flex items-center rounded-lg border border-border/50 bg-secondary/80 p-0.5" role="toolbar" aria-label="Script tools">
            <button
              type="button"
              onClick={() => {
                setMode("select");
                setDrawStart(null);
                setGutterDraft(null);
                setMarkDraft(null);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                mode === "select"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              )}
              title="Select & edit beats"
            >
              <MousePointer2 className="size-3.5" />
              <span>Select</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = mode === "line" ? "select" : "line";
                setMode(next);
                setDrawStart(null);
                setGutterDraft(null);
                setMarkDraft(null);
                if (next === "line") {
                  setSidebarTab("coverage");
                  setShowSidebar(true);
                }
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                mode === "line"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              )}
              title="Line coverage down margin"
            >
              <PencilLine className="size-3.5 text-steel" />
              <span>Line</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = mode === "mark" ? "select" : "mark";
                setMode(next);
                setDrawStart(null);
                setGutterDraft(null);
                if (next === "mark") {
                  setSidebarTab("breakdown");
                  setShowSidebar(true);
                }
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                mode === "mark"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              )}
              title="Mark props, cast, or direction"
            >
              <Highlighter className="size-3.5 text-warn" />
              <span>Mark</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = mode === "comment" ? "select" : "comment";
                setMode(next);
                setDrawStart(null);
                setGutterDraft(null);
                setMarkDraft(null);
                setReanchorThreadId(undefined);
                if (next === "comment") {
                  setSidebarTab("comments");
                  setShowSidebar(true);
                }
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                mode === "comment"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/40"
              )}
              title="Anchor comments to text"
            >
              <MessageSquare className="size-3.5" />
              <span>Comment</span>
            </button>
          </div>

          {/* Right: View toggles & Add Beat menu */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={liningOn ? "ghost" : "secondary"}
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setLiningOn((v) => !v)}
              aria-pressed={liningOn}
              title={liningOn ? "Hide lining lines" : "Show lining lines"}
            >
              {liningOn ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              <span className="hidden md:inline">{liningOn ? "Lining" : "Hidden"}</span>
            </Button>
            <Button
              size="sm"
              variant={source !== "page" ? "secondary" : "ghost"}
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setSource((v) => (v === "page" ? "md" : "page"))}
              title={source === "page" ? "View source Markdown/JSONL" : "Return to formatted screenplay"}
            >
              <Code2 className="size-3.5" />
              <span className="hidden md:inline">{source === "page" ? "Source" : "Page"}</span>
            </Button>
            <AddMenu onAdd={(kind) => addElement(selectedElementId, kind)} />

            {source === "page" && (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                <Button
                  size="icon-sm"
                  variant={showSidebar ? "secondary" : "ghost"}
                  className="size-8"
                  onClick={() => setShowSidebar((v) => !v)}
                  aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
                  title={showSidebar ? "Hide sidebar" : "Show sidebar"}
                >
                  <PanelRight className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        {source !== "page" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 sm:p-6">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={source === "md" ? "secondary" : "ghost"}
                onClick={() => setSource("md")}
              >
                script.slate.md
              </Button>
              <Button
                size="sm"
                variant={source === "jsonl" ? "secondary" : "ghost"}
                onClick={() => setSource("jsonl")}
              >
                lining.jsonl
              </Button>
            </div>
            <Textarea
              rows={22}
              className="min-h-80 flex-1 font-mono text-sm leading-snug"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <EditorSaveButton label="Save source" onSave={() => applySource(false)} />
              <Button variant="ghost" onClick={() => applySource(true)}>
                Save and show page
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-auto bg-secondary/40 p-3 sm:p-6">
            <LinedPage
              drawing={drawing}
              drawStart={drawStart}
              gutterDraft={gutterDraft}
              hoverId={hoverId}
              selectedId={selectedId}
              selectedElementId={selectedElementId}
              selectedElementIds={selectedElementIds}
              liningOn={liningOn}
              markMode={mode === "mark"}
              commentMode={mode === "comment"}
              markDraft={markDraft}
              commentPopover={commentPopover}
              markPopover={markPopover}
              onHover={setHoverId}
              onBlock={onBlockPointer}
              onSelectShot={handleSelectShot}
              onSelectStoryboard={handleSelectStoryboard}
              onDragStart={setDrag}
              onGutterDraft={setGutterDraft}
              onGutterCommit={(start, end) => finishRange(start, end, null)}
              onMarkDraft={setMarkDraft}
              onComment={setCommentDraft}
              onOpenCommentPopover={setCommentPopover}
              onCloseCommentPopover={() => setCommentPopover(null)}
              onOpenMarkPopover={setMarkPopover}
              onCloseMarkPopover={() => setMarkPopover(null)}
              onOpenBreakdownFromMark={() => {
                setSidebarTab("breakdown");
                setShowSidebar(true);
                setMarkPopover(null);
              }}
              onOpenBeatDetailsFromMark={(elementId) => {
                selectElement(elementId);
                setDeskTab("beat");
                setSidebarTab("coverage");
                setShowSidebar(true);
                setMarkPopover(null);
              }}
              onOpenInNotes={() => {
                setSidebarTab("comments");
                setShowSidebar(true);
                setCommentPopover(null);
              }}
            />

            {/* Active Mode Guidance Pill */}
            {mode !== "select" && (
              <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-xs">
                  <span className="flex size-2 rounded-full bg-steel animate-pulse" />
                  <span>
                    {mode === "line"
                      ? drawStart
                        ? "Click end beat to finish line"
                        : "Click start beat or drag down margin to line"
                      : mode === "mark"
                        ? "Select text in the script to mark"
                        : "Select text to anchor comment"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("select");
                      setDrawStart(null);
                      setGutterDraft(null);
                      setMarkDraft(null);
                      setCommentDraft(null);
                    }}
                    className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Cancel mode"
                    title="Cancel (Esc)"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unified 3-Tab Right Sidebar Dock */}
      {source === "page" && showSidebar ? (
        <SidebarDock
          id="script-sidebar-dock"
          ariaLabel="Script sidebar dock"
          tablistAriaLabel="Script sidebar tabs"
          tabs={SCRIPT_SIDEBAR_TABS}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          onClose={() => setShowSidebar(false)}
        >
          {sidebarTab === "coverage" && (
            <CoverageDesk
              tab={deskTab}
              onTabChange={setDeskTab}
              onOpenBreakdown={() => setSidebarTab("breakdown")}
              onOpenNotes={() => setSidebarTab("comments")}
              onMarkMode={() => setMode("mark")}
            />
          )}
          {sidebarTab === "breakdown" && (
            <BreakdownIndex
              onJump={(mark) => {
                selectElement(mark.elementId);
                setMode("mark");
                setMarkDraft({
                  elementId: mark.elementId,
                  text: mark.text,
                  start: mark.start,
                  end: mark.end,
                  x: 24,
                  y: 24,
                  existingId: mark.id,
                  tag: mark.tag,
                  note: mark.note,
                });
              }}
            />
          )}
          {sidebarTab === "comments" && (
            <div className="h-full overflow-y-auto">
              <ScriptCommentsList />
            </div>
          )}
        </SidebarDock>
      ) : null}

      {commentDraft && (
        <ScriptCommentComposer
          anchor={commentDraft}
          reanchorThreadId={reanchorThreadId}
          onClose={() => {
            setCommentDraft(null);
            setReanchorThreadId(undefined);
          }}
        />
      )}
    </div>
  );
}

function AddMenu({ onAdd }: { onAdd: (kind: ScriptKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          <Plus />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(
          [
            ["scene", "Scene heading"],
            ["action", "Action"],
            ["character", "Character"],
            ["dialogue", "Dialogue"],
            ["transition", "Transition"],
          ] as const
        ).map(([kind, label]) => (
          <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinedPage({
  drawing,
  drawStart,
  gutterDraft,
  hoverId,
  selectedId,
  selectedElementId,
  selectedElementIds,
  liningOn,
  markMode,
  commentMode,
  markDraft,
  commentPopover,
  markPopover,
  onHover,
  onBlock,
  onSelectShot,
  onSelectStoryboard,
  onDragStart,
  onGutterDraft,
  onGutterCommit,
  onMarkDraft,
  onComment,
  onOpenCommentPopover,
  onCloseCommentPopover,
  onOpenMarkPopover,
  onCloseMarkPopover,
  onOpenBreakdownFromMark,
  onOpenBeatDetailsFromMark,
  onOpenInNotes,
}: {
  drawing: boolean;
  drawStart: string | null;
  gutterDraft: DrawDraft | null;
  hoverId: string | null;
  selectedId: string | null;
  selectedElementId: string | null;
  selectedElementIds: string[];
  liningOn: boolean;
  markMode: boolean;
  commentMode: boolean;
  markDraft: MarkDraft | null;
  commentPopover: { threadId: string; x: number; y: number } | null;
  markPopover: { projectId: string; markId: string; x: number; y: number } | null;
  onHover: (id: string | null) => void;
  onBlock: (id: string, e?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  onSelectShot: (id: string) => void;
  onSelectStoryboard?: (id: string) => void;
  onDragStart: (drag: DragEdge) => void;
  onGutterDraft: (draft: DrawDraft | null) => void;
  onGutterCommit: (startId: string, endId: string) => void;
  onMarkDraft: (draft: MarkDraft | null) => void;
  onComment: (anchor: ScriptCommentAnchor) => void;
  onOpenCommentPopover: (popover: { threadId: string; x: number; y: number } | null) => void;
  onCloseCommentPopover: () => void;
  onOpenMarkPopover: (popover: { projectId: string; markId: string; x: number; y: number } | null) => void;
  onCloseMarkPopover: () => void;
  onOpenBreakdownFromMark?: () => void;
  onOpenBeatDetailsFromMark?: (elementId: string) => void;
  onOpenInNotes?: () => void;
}) {
  const project = useSlate((s) => s.project);
  const lineRange = useSlate((s) => s.lineRange);
  const articleRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{
    rects: Record<string, { top: number; height: number }>;
    width: number;
    height: number;
  }>({ rects: {}, width: 0, height: 0 });
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const [arrowDrag, setArrowDrag] = useState<DragEdge | null>(null);
  const [blockDrag, setBlockDrag] = useState<number | null>(null);
  const arrowHoverRef = useRef<string | null>(null);
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false,
  );

  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const measure = () => {
    const body = bodyRef.current;
    const gutter = gutterRef.current;
    if (!body || !gutter) return;
    const origin = gutter.getBoundingClientRect();
    const next: Record<string, { top: number; height: number }> = {};
    body.querySelectorAll<HTMLElement>("[data-el-id]").forEach((node) => {
      const id = node.dataset.elId;
      if (!id) return;
      const r = node.getBoundingClientRect();
      next[id] = { top: r.top - origin.top, height: r.height };
    });
    setGeom((prev) => {
      const width = gutter.offsetWidth;
      const height = Math.max(gutter.offsetHeight, body.offsetHeight);
      const keys = Object.keys(next);
      const same =
        prev.width === width &&
        prev.height === height &&
        prev.rects &&
        keys.length === Object.keys(prev.rects).length &&
        keys.every((k) => {
          const a = prev.rects[k];
          const b = next[k];
          return a && b && a.top === b.top && a.height === b.height;
        });
      if (same) return prev;
      return { rects: next, width, height };
    });
  };

  const cols = compact ? 1 : columnCount(project);
  const gutterCols = compact ? Math.max(1, Math.min(columnCount(project), 6)) : cols;
  const fallbackGeom = useMemo(
    () => estimateLiningGeom(project.script, gutterWidth(gutterCols, compact)),
    [project.script, gutterCols, compact],
  );
  const paintGeom =
    project.script.length > 0 &&
    project.script.every((el) => geom.rects[el.id]) &&
    geom.width > 0 &&
    geom.height > 0
      ? geom
      : fallbackGeom;

  const allLined = useMemo(() => linedShots(project), [project]);

  useLayoutEffect(() => {
    measure();
    const body = bodyRef.current;
    const gutter = gutterRef.current;
    const article = articleRef.current;
    if (!body || !gutter) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(body);
    ro.observe(gutter);
    if (article) ro.observe(article);
    window.addEventListener("resize", measure);
    const raf = window.requestAnimationFrame(() => measure());
    void document.fonts?.ready.then(() => measure());
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.cancelAnimationFrame(raf);
    };
  }, [project.script, project.shots, cols, compact, liningOn]);

  useEffect(() => {
    if (!arrowDrag) return;
    const move = (e: PointerEvent) => {
      const gutter = gutterRef.current;
      if (!gutter) return;
      const y = e.clientY - gutter.getBoundingClientRect().top;
      const id = nearestElementId(project.script, geomRef.current.rects, y);
      if (id) arrowHoverRef.current = id;
    };
    const up = () => {
      const hoverId = arrowHoverRef.current;
      const shot = project.shots.find((s) => s.id === arrowDrag.shotId);
      if (shot && hoverId) {
        const ids = shot.elementIds;
        const start = arrowDrag.edge === "start" ? hoverId : (ids[0] ?? hoverId);
        const end = arrowDrag.edge === "end" ? hoverId : (ids[ids.length - 1] ?? hoverId);
        lineRange(start, end, shot.id);
      }
      arrowHoverRef.current = null;
      setArrowDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [arrowDrag, lineRange, project.script, project.shots]);

  useEffect(() => {
    if (blockDrag === null) return;
    const up = () => setBlockDrag(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [blockDrag]);

  const previewIds = (() => {
    const start = gutterDraft?.startId ?? (drawing ? drawStart : null);
    const hover = gutterDraft?.hoverId ?? hoverId;
    if (!start || !hover) return new Set<string>();
    const a = project.script.findIndex((e) => e.id === start);
    const b = project.script.findIndex((e) => e.id === hover);
    if (a < 0 || b < 0) return new Set<string>();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return new Set(project.script.slice(lo, hi + 1).map((e) => e.id));
  })();

  const onGutterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const gutter = gutterRef.current;
    if (!gutter) return;
    const y = e.clientY - gutter.getBoundingClientRect().top;
    const startId = nearestElementId(project.script, paintGeom.rects, y);
    if (!startId) return;
    gutter.setPointerCapture(e.pointerId);
    onGutterDraft({ startId, hoverId: startId });
  };

  const onGutterPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const gutter = gutterRef.current;
    if (!gutter) return;
    const y = e.clientY - gutter.getBoundingClientRect().top;
    const id = nearestElementId(project.script, geom.rects, y);
    if (gutterDraft && id) {
      onGutterDraft({ ...gutterDraft, hoverId: id });
      return;
    }
    if (id) onHover(id);
  };

  const onGutterPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const gutter = gutterRef.current;
    if (gutter?.hasPointerCapture(e.pointerId)) gutter.releasePointerCapture(e.pointerId);
    if (!gutterDraft) return;
    const same = gutterDraft.startId === gutterDraft.hoverId;
    if (same) {
      const pick =
        shotsCovering(project, gutterDraft.startId).find((s) => s.id === selectedId) ??
        tightestCovering(project, gutterDraft.startId);
      if (pick) onSelectShot(pick.id);
      onGutterDraft(null);
      return;
    }
    onGutterCommit(gutterDraft.startId, gutterDraft.hoverId);
  };

  const handleOpenCommentThread = (threadId: string, event: React.MouseEvent) => {
    const article = articleRef.current?.getBoundingClientRect();
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = article ? Math.max(16, Math.min(target.left - article.left, article.width - 390)) : 24;
    const y = article ? Math.max(16, target.bottom - article.top + 8) : 24;
    onOpenCommentPopover({ threadId, x, y });
  };

  const handleOpenMark = (mark: ScriptMark, event: React.MouseEvent) => {
    const article = articleRef.current?.getBoundingClientRect();
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = article ? Math.max(16, Math.min(target.left - article.left, article.width - 390)) : 24;
    const y = article ? Math.max(16, target.bottom - article.top + 8) : 24;
    onOpenMarkPopover({ projectId: project.id, markId: mark.id, x, y });
  };

  return (
    <article
      ref={articleRef}
      className={cn(
        "script-page script-page-lined relative mx-auto min-h-[70vh] w-full max-w-5xl overflow-visible rounded-sm py-8 shadow-sm sm:py-12",
        drawing && "cursor-crosshair",
        markMode && "script-page-mark",
      )}
    >
      <header className="mb-8 px-8 text-center sm:px-10">
        <h1 className="font-script text-base uppercase tracking-wide">{project.name}</h1>
        {project.logline ? (
          <p className="mt-3 text-xs text-script-muted">{project.logline}</p>
        ) : null}
        {markMode ? (
          <p className="mt-2 text-xs text-script-muted">
            Select words, then tag them. Steer is AI direction. Catalog is the breakdown.
          </p>
        ) : null}
        {commentMode && (
          <p className="mt-2 text-xs text-script-muted">
            Select an exact passage to start or reattach a comment thread.
          </p>
        )}
      </header>
      <div className="flex min-h-0 overflow-visible">
        {liningOn ? (
          <div
            ref={gutterRef}
            data-lining-gutter="true"
            className={cn(
              "lining-gutter relative z-10 shrink-0 border-r border-script-ink/10",
              (drawing || gutterDraft) && "cursor-crosshair",
            )}
            style={{
              width: gutterWidth(gutterCols, compact),
              minHeight: paintGeom.height || undefined,
            }}
            onPointerDown={onGutterPointerDown}
            onPointerMove={onGutterPointerMove}
            onPointerUp={onGutterPointerUp}
            onPointerCancel={() => onGutterDraft(null)}
          >
            <LiningOverlay
              geom={paintGeom}
              selectedId={selectedId}
              draft={gutterDraft}
              compact={compact}
              onSelectShot={onSelectShot}
              onDragStart={(d) => {
                setArrowDrag(d);
                onDragStart(d);
              }}
            />
          </div>
        ) : (
          <div ref={gutterRef} className="w-3 shrink-0 sm:w-4" />
        )}
        <div ref={bodyRef} className="min-w-0 flex-1 pl-10 pr-4 sm:pl-12 sm:pr-6">
          {project.script.map((el, i) => {
            const covering = shotsCovering(project, el.id);
            const selectedShot = covering.find((s) => s.id === selectedId);
            const startingShots = allLined.filter((l) => l.start === i).map((l) => l.shot);
            return (
              <ScriptBlock
                key={el.id}
                el={el}
                index={i}
                selected={el.id === selectedElementId}
                inSelection={selectedElementIds.includes(el.id)}
                preview={previewIds.has(el.id)}
                covering={covering}
                selectedShot={selectedShot}
                startingShots={startingShots}
                margin={marginNumber(project.script, i)}
                dragging={blockDrag === i}
                markMode={markMode}
                commentMode={commentMode}
                onEnter={() => {
                  onHover(el.id);
                  if (blockDrag !== null && blockDrag !== i) {
                    const ids = selectedElementIds.includes(el.id)
                      ? selectedElementIds
                      : ([project.script[blockDrag]?.id].filter(Boolean) as string[]);
                    if (ids.length > 1) useSlate.getState().moveElements(ids, i);
                    else useSlate.getState().reorderElements(blockDrag, i);
                    setBlockDrag(i);
                  }
                }}
                onLeave={() => onHover(null)}
                onPointer={(e) => onBlock(el.id, e)}
                onChange={(text) => useSlate.getState().patchElement(el.id, { text })}
                onGrip={(e) => {
                  e.stopPropagation();
                  setBlockDrag(i);
                }}
                onMark={(draft) => onMarkDraft(draft)}
                onComment={onComment}
                onOpenCommentThread={handleOpenCommentThread}
                onOpenMarkPopover={handleOpenMark}
                onSelectShot={onSelectShot}
                onSelectStoryboard={onSelectStoryboard}
              />
            );
          })}
        </div>
      </div>
      {markDraft ? (
        <MarkPopover
          draft={markDraft}
          onTag={(tag, note) => {
            if (markDraft.existingId) useSlate.getState().removeMark(markDraft.existingId);
            useSlate.getState().addMark({
              tag,
              text: markDraft.text,
              note,
              elementId: markDraft.elementId,
              start: markDraft.start,
              end: markDraft.end,
              sceneId: sceneIdOf(project.script, markDraft.elementId),
            });
            onMarkDraft(null);
          }}
          onClose={() => onMarkDraft(null)}
          onRemove={
            markDraft.existingId
              ? () => {
                  useSlate.getState().removeMark(markDraft.existingId!);
                  onMarkDraft(null);
                }
              : undefined
          }
        />
      ) : null}
      {commentPopover && (() => {
        const thread = (project.scriptCommentThreads ?? []).find(
          (t) => t.id === commentPopover.threadId,
        );
        if (!thread) return null;
        return (
          <ScriptCommentFloatingPopover
            thread={thread}
            x={commentPopover.x}
            y={commentPopover.y}
            onClose={onCloseCommentPopover}
            onOpenInNotes={onOpenInNotes}
          />
        );
      })()}
      {markPopover && (() => {
        const mark = project.id === markPopover.projectId
          ? project.marks.find((item) => item.id === markPopover.markId)
          : undefined;
        if (!mark) return null;
        const currentMark = () => {
          const current = useSlate.getState().project;
          return current.id === markPopover.projectId
            ? current.marks.find((item) => item.id === markPopover.markId)
            : undefined;
        };
        return <ScriptMarkFloatingPopover
          mark={mark}
          x={markPopover.x}
          y={markPopover.y}
          onClose={onCloseMarkPopover}
          onEdit={() => {
            const m = currentMark();
            if (!m) { onCloseMarkPopover(); return; }
            onMarkDraft({
              elementId: m.elementId,
              text: m.text,
              start: m.start,
              end: m.end,
              x: markPopover.x,
              y: markPopover.y,
              existingId: m.id,
              tag: m.tag,
              note: m.note,
            });
            onCloseMarkPopover();
          }}
          onOpenBreakdown={() => {
            if (!currentMark()) { onCloseMarkPopover(); return; }
            onOpenBreakdownFromMark?.();
          }}
          onOpenBeatDetails={() => {
            const m = currentMark();
            if (!m) { onCloseMarkPopover(); return; }
            onOpenBeatDetailsFromMark?.(m.elementId);
          }}
          onRemove={() => {
            const m = currentMark();
            if (!m) { onCloseMarkPopover(); return; }
            useSlate.getState().removeMark(m.id);
            onCloseMarkPopover();
            toast.success("Mark removed");
          }}
        />;
      })()}
    </article>
  );
}

function ScriptBlock({
  el,
  selected,
  inSelection,
  preview,
  covering,
  selectedShot,
  startingShots = [],
  margin,
  dragging,
  markMode,
  commentMode,
  onEnter,
  onLeave,
  onPointer,
  onChange,
  onGrip,
  onMark,
  onComment,
  onOpenCommentThread,
  onOpenMarkPopover,
  onSelectShot,
  onSelectStoryboard,
}: {
  el: ScriptElement;
  index: number;
  selected: boolean;
  inSelection: boolean;
  preview: boolean;
  covering: Shot[];
  selectedShot?: Shot;
  startingShots?: Shot[];
  margin: string | null;
  dragging: boolean;
  markMode: boolean;
  commentMode: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPointer: (e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  onChange: (text: string) => void;
  onGrip: (e: React.PointerEvent) => void;
  onMark: (draft: MarkDraft) => void;
  onComment: (anchor: ScriptCommentAnchor) => void;
  onOpenCommentThread: (threadId: string, event: React.MouseEvent) => void;
  onOpenMarkPopover?: (mark: ScriptMark, event: React.MouseEvent) => void;
  onSelectShot?: (id: string) => void;
  onSelectStoryboard?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [productionOpen, setProductionOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const allMarks = useSlate((s) => s.project.marks);
  const marks = (allMarks ?? []).filter((m) => m.elementId === el.id);
  const script = useSlate((s) => s.project.script);
  const allThreads = useSlate((s) => s.project.scriptCommentThreads) ?? [];
  const attachedThreads = allThreads.filter((t) => t.anchor.elementId === el.id);
  const resolvedThreads = attachedThreads.map((thread) => {
    const placement = resolveScriptCommentAnchor(script, thread.anchor);
    if (placement.status === "exact" || placement.status === "moved") {
      return { thread, start: placement.start, end: placement.end };
    }
    return { thread, start: -1, end: -1 };
  });

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const cls =
    el.kind === "scene"
      ? "script-slug mt-8 mb-3"
      : el.kind === "character"
        ? "script-character mt-5"
        : el.kind === "dialogue"
          ? "script-dialogue"
          : el.kind === "parenthetical"
            ? "script-paren"
            : el.kind === "transition"
              ? "script-transition mt-6"
              : "mt-4";

  const onMouseUp = (e: React.MouseEvent) => {
    if (!markMode && !commentMode) return;
    const root = textRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const picked = range.toString();
    if (!picked.trim()) return;
    if (el.text.slice(start, start + picked.length) !== picked) return;
    if (commentMode) {
      onComment({ elementId: el.id, quote: picked, start, end: start + picked.length });
      e.stopPropagation();
      return;
    }
    const origin = root.closest("article")?.getBoundingClientRect();
    onMark({
      elementId: el.id,
      text: picked,
      start,
      end: start + picked.length,
      x: origin ? e.clientX - origin.left - 20 : 24,
      y: origin ? e.clientY - origin.top + 12 : 24,
    });
    e.stopPropagation();
  };

  const segments = buildScriptSegments(el.text, marks, resolvedThreads);

  return (
    <div
      data-el-id={el.id}
      className={cn(
        "group relative -mx-2 rounded-sm px-2 py-0.5",
        selected && "bg-script-ink/6 outline outline-1 outline-script-ink/20",
        inSelection &&
          !selected &&
          "bg-script-ink/4 outline outline-1 outline-dashed outline-script-ink/15",
        preview && "bg-script-ink/8",
        selectedShot && "border-l-2",
        dragging && "bg-script-ink/10",
      )}
      style={selectedShot ? { borderColor: LINE_COLOR_VAR[selectedShot.lineColor] } : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {margin ? (
        <span className="absolute -left-6 top-1 w-5 text-right font-script text-xs text-script-muted">
          {margin}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Reorder beat"
        className="absolute -left-10 top-1 hidden size-7 items-center justify-center rounded-sm text-script-muted opacity-0 hover:bg-script-ink/8 group-hover:opacity-100 sm:flex"
        onPointerDown={onGrip}
      >
        <GripVertical className="size-3.5" />
      </button>
      {attachedThreads.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCommentThread(attachedThreads[0].id, e);
          }}
          title={`${attachedThreads.length} note${attachedThreads.length === 1 ? "" : "s"} on this beat · Click to view`}
          className={cn(
            "absolute right-2 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-sans font-medium transition-all shadow-2xs cursor-pointer z-10",
            attachedThreads.some((t) => t.status === "open")
              ? "bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200 hover:text-amber-950"
              : "bg-emerald-100 text-emerald-950 border border-emerald-300 hover:bg-emerald-200 hover:text-emerald-950",
          )}
        >
          <MessageSquare className="size-3 shrink-0 text-amber-700" />
          <span>{attachedThreads.length}</span>
        </button>
      )}
      {editing ? (
        <textarea
          ref={ref}
          className={cn(
            "w-full resize-none bg-transparent font-script text-sm leading-snug text-script-ink outline-none",
            cls,
          )}
          rows={Math.max(2, Math.ceil(el.text.length / 56))}
          value={el.text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          ref={textRef}
          role="button"
          tabIndex={0}
          className={cn(
            "script-block-text block w-full text-left font-script text-sm leading-snug text-script-ink",
            cls,
            (markMode || commentMode) && "cursor-text",
          )}
          onClick={(e) => {
            if ((markMode || commentMode) && window.getSelection()?.toString()) return;
            onPointer(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPointer(e);
            }
          }}
          onDoubleClick={() => {
            if (!markMode && !commentMode) setEditing(true);
          }}
          onMouseUp={onMouseUp}
        >
          {el.text ? (
            segments.map((part, i) => {
              const hasMark = !!part.mark;
              const hasComment = part.threads.length > 0;
              const isResolved = hasComment && part.threads.every((t) => t.status === "resolved");

              if (!hasMark && !hasComment) {
                return <span key={`t${i}`}>{part.text}</span>;
              }

              const markStyle = hasMark ? { color: markColor(part.mark!.tag) } : undefined;
              const meta = hasMark ? markMeta(part.mark!.tag) : null;
              const dept = hasMark ? departmentFor(part.mark!.tag) : null;
              const markTitle = hasMark
                ? `[${meta?.label} · ${dept}] “${part.mark!.text}”${part.mark!.note ? `: ${part.mark!.note}` : ""} · Click to view details or edit`
                : undefined;

              return (
                <span
                  key={`seg-${i}-${part.start}`}
                  className={cn(
                    hasMark &&
                      "script-mark cursor-pointer transition-all hover:ring-1 hover:ring-primary/40 hover:bg-primary/5 rounded-xs px-0.5",
                    hasComment && "script-comment-highlight",
                    hasComment && (isResolved ? "script-comment-resolved" : "script-comment-open"),
                  )}
                  style={markStyle}
                  data-status={isResolved ? "resolved" : "open"}
                  title={
                    hasComment
                      ? `${part.threads.length} note${part.threads.length === 1 ? "" : "s"}${markTitle ? ` · ${markTitle}` : ""}`
                      : markTitle
                  }
                  onClick={(e) => {
                    if (commentMode && hasComment) {
                      e.stopPropagation();
                      const targetThreadId = part.threads[0]?.id ?? attachedThreads[0]?.id;
                      if (targetThreadId) {
                        onOpenCommentThread(targetThreadId, e);
                      }
                      return;
                    }
                    if (hasMark) {
                      e.stopPropagation();
                      if (onOpenMarkPopover) {
                        onOpenMarkPopover(part.mark!, e);
                      } else {
                        const origin = textRef.current?.closest("article")?.getBoundingClientRect();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        onMark({
                          elementId: el.id,
                          text: part.mark!.text,
                          start: part.mark!.start,
                          end: part.mark!.end,
                          x: origin ? r.left - origin.left : 24,
                          y: origin ? r.bottom - origin.top + 8 : 24,
                          existingId: part.mark!.id,
                          tag: part.mark!.tag,
                          note: part.mark!.note,
                        });
                      }
                      return;
                    }
                    if (hasComment) {
                      e.stopPropagation();
                      const targetThreadId = part.threads[0]?.id ?? attachedThreads[0]?.id;
                      if (targetThreadId) {
                        onOpenCommentThread(targetThreadId, e);
                      }
                      return;
                    }
                  }}
                >
                  {part.text}
                </span>
              );
            })
          ) : (
            <span className="text-script-muted">Write this beat…</span>
          )}
        </div>
      )}
      {(() => {
        // Collect all shots with visuals on this beat: starters + production directions
        const directIds = new Set(el.productionDirections?.map((d) => d.shotId) ?? []);
        const unrenderedStarters = startingShots.filter((s) => !directIds.has(s.id));
        const directionSetups = (el.productionDirections ?? [])
          .map((d) => covering.find((s) => s.id === d.shotId))
          .filter((s): s is Shot => !!s);
        const allThumbs = [...unrenderedStarters, ...directionSetups];
        if (!allThumbs.length) return null;
        // Deduplicate by shot id
        const seen = new Set<string>();
        const unique = allThumbs.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        return (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5" aria-label="Coverage thumbnails">
            {unique.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Open ${coverageLabel(s)} setup controls`}
                title={`${coverageLabel(s)} · ${framingLabel(s.coverageSize)} (${s.camera}) · Click to open controls`}
                className="group relative h-7 w-12 shrink-0 overflow-hidden rounded border border-border/60 bg-paper shadow-2xs hover:border-steel hover:shadow-xs transition-all cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectStoryboard) onSelectStoryboard(s.id);
                  else onSelectShot?.(s.id);
                }}
              >
                <ShotStill sketch={s.sketch} frameUrl={s.frameUrl} alt={s.title} />
                <span
                  className={cn(
                    "absolute bottom-0 inset-x-0 bg-script text-[8px] font-mono font-bold leading-tight px-0.5 text-center truncate",
                    LINE_COLOR_CLASS[s.lineColor],
                  )}
                >
                  {s.setup || String(s.number)}
                </span>
              </button>
            ))}
          </div>
        );
      })()}
      <Dialog open={productionOpen} onOpenChange={setProductionOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Linked production direction</DialogTitle>
            <DialogDescription>Edit the setup linked to this screenplay beat.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Inspector embedded />
          </div>
        </DialogContent>
      </Dialog>
      {selected && isBoardable(el.kind) && !markMode ? (
        <div className="mb-1 mt-1 flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-paper-ink/80 hover:text-paper-ink"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          {covering.length > 0 && onSelectShot && (
            <button
              type="button"
              className="text-xs font-medium text-paper-ink hover:underline"
              onClick={() => onSelectShot(covering[0].id)}
            >
              Setup {covering.map((s) => coverageLabel(s)).join(", ")} controls →
            </button>
          )}
        </div>
      ) : null}
      {covering.length > 0 && covering[0] ? (
        <span
          className={cn(
            "absolute -right-1 top-1 size-1.5 rounded-full sm:hidden",
            LINE_COLOR_BG[covering[0].lineColor],
          )}
        />
      ) : null}
    </div>
  );
}

function LiningOverlay({
  geom,
  selectedId,
  draft,
  compact,
  onSelectShot,
  onDragStart,
}: {
  geom: { rects: Record<string, { top: number; height: number }>; width: number; height: number };
  selectedId: string | null;
  draft: DrawDraft | null;
  compact: boolean;
  onSelectShot: (id: string) => void;
  onDragStart: (drag: DragEdge) => void;
}) {
  const project = useSlate((s) => s.project);
  const lines = linedShots(project);
  const { rects, width, height } = geom;
  if (!width || !height || !Object.keys(rects).length) return null;

  const label = labelSpace(compact);
  const cw = colWidth(compact);
  const xFor = (column: number) => label + column * cw + cw / 2;

  const draftGeom = (() => {
    if (!draft) return null;
    const a = rects[draft.startId];
    const b = rects[draft.hoverId];
    if (!a || !b) return null;
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.top + a.height, b.top + b.height);
    const col = compact ? 0 : Math.max(0, columnCount(project) - 1);
    return {
      y0: top + 5,
      y1: bottom - 5,
      x: xFor(col),
    };
  })();

  return (
    <svg
      className="block overflow-visible"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Script lining"
    >
      {lines.map((line) => {
        const startEl = project.script[line.start];
        const endEl = project.script[line.end];
        const a = startEl ? rects[startEl.id] : null;
        const b = endEl ? rects[endEl.id] : null;
        if (!a || !b) return null;
        const x = xFor(compact ? Math.min(line.column, 2) : line.column);
        const y0 = a.top + 6;
        const y1 = Math.max(y0 + 16, b.top + b.height - 6);
        const active = line.shot.id === selectedId;
        const color = LINE_COLOR_VAR[line.shot.lineColor];
        const sw = active ? 3.2 : 2.4;
        const note = line.shot.notes.trim();
        return (
          <g
            key={line.shot.id}
            data-lining-line={line.shot.setup || line.shot.id}
            stroke={color}
            fill={color}
          >
            <line x1={x} y1={y0} x2={x} y2={y1} strokeWidth={sw} />
            <line x1={x} y1={y0} x2={x + 12} y2={y0} strokeWidth={sw} />
            <polygon
              points={`${x},${y0 + 8} ${x - 3.6},${y0} ${x + 3.6},${y0}`}
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectShot(line.shot.id);
              }}
            />
            <polygon
              points={`${x},${y1 + 7} ${x - 3.6},${y1} ${x + 3.6},${y1}`}
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectShot(line.shot.id);
              }}
            />
            {(() => {
              /* --- label collision avoidance --- */
              const concise = line.shot.setup || String(line.shot.number);
              const labelText = active ? coverageLabel(line.shot) : concise;

              // Check if an adjacent column starts at the same beat (within 16px)
              const hasAdjacentStart = lines.some(
                (other) =>
                  other.shot.id !== line.shot.id &&
                  Math.abs(other.column - line.column) === 1 &&
                  (() => {
                    const oEl = project.script[other.start];
                    const oRect = oEl ? rects[oEl.id] : null;
                    return oRect && Math.abs(oRect.top + 6 - y0) < 16;
                  })(),
              );

              // Check if this line starts exactly where another line in the same column ends
              const startsAtPreviousEnd = lines.some(
                (other) =>
                  other.shot.id !== line.shot.id &&
                  other.column === line.column &&
                  (() => {
                    const oEndEl = project.script[other.end];
                    const oEndRect = oEndEl ? rects[oEndEl.id] : null;
                    if (!oEndRect) return false;
                    const otherY1 = oEndRect.top + oEndRect.height - 6;
                    return Math.abs(y0 - otherY1) < 18;
                  })(),
              );

              let labelX: number;
              let labelY: number;
              let anchor: "start" | "middle" | "end";

              if (startsAtPreviousEnd) {
                // Place below the start bracket to clear the previous arrow chevron
                labelX = x + 5;
                labelY = y0 + 13;
                anchor = "start";
              } else if (line.column === 0) {
                // Column 0: left of line
                labelX = x - 6;
                labelY = hasAdjacentStart && line.column % 2 === 1 ? y0 - 17 : y0 - 4;
                anchor = "end";
              } else {
                // Inner columns: centered above column
                labelX = x;
                labelY = hasAdjacentStart && line.column % 2 === 1 ? y0 - 17 : y0 - 4;
                anchor = "middle";
              }

              return (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor={anchor}
                  fill={color}
                  stroke="var(--color-script, #f3efe6)"
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                  paintOrder="stroke fill"
                  fontSize={active ? 10 : 9}
                  fontWeight={active ? 700 : 400}
                  className="cursor-pointer select-none"
                  style={{ fontFamily: "var(--font-script)" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectShot(line.shot.id);
                  }}
                >
                  {labelText}
                </text>
              );
            })()}
            {note ? <circle cx={x} cy={(y0 + y1) / 2} r={2.4} stroke="none" /> : null}
            <line
              x1={x}
              y1={y0}
              x2={x}
              y2={y1}
              stroke="transparent"
              strokeWidth={20}
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectShot(line.shot.id);
              }}
            />
            <circle
              cx={x}
              cy={y0}
              r={8}
              fill="transparent"
              stroke="none"
              className="cursor-ns-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectShot(line.shot.id);
                onDragStart({ shotId: line.shot.id, edge: "start" });
              }}
            />
            <circle
              cx={x}
              cy={y1}
              r={8}
              fill="transparent"
              stroke="none"
              className="cursor-ns-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectShot(line.shot.id);
                onDragStart({ shotId: line.shot.id, edge: "end" });
              }}
            />
          </g>
        );
      })}
      {draftGeom ? (
        <g stroke="var(--color-line-ink)" fill="var(--color-line-ink)" opacity={0.55}>
          <line
            x1={draftGeom.x}
            y1={draftGeom.y0}
            x2={draftGeom.x}
            y2={draftGeom.y1}
            strokeWidth={1.8}
          />
          <line
            x1={draftGeom.x}
            y1={draftGeom.y0}
            x2={draftGeom.x + 12}
            y2={draftGeom.y0}
            strokeWidth={1.8}
          />
          <polygon
            points={`${draftGeom.x},${draftGeom.y0 + 8} ${draftGeom.x - 3.6},${draftGeom.y0} ${draftGeom.x + 3.6},${draftGeom.y0}`}
          />
          <polygon
            points={`${draftGeom.x},${draftGeom.y1 + 7} ${draftGeom.x - 3.6},${draftGeom.y1} ${draftGeom.x + 3.6},${draftGeom.y1}`}
          />
        </g>
      ) : null}
    </svg>
  );
}
