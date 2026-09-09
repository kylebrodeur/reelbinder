import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Images,
  Play,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { BlockingStudio, type StudioPane } from "@/components/app/blocking-studio";
import { ImagineActions } from "@/components/app/frame-studio";
import { Inspector } from "@/components/app/inspector";
import { ProductionAssistantDock } from "@/components/app/production-assistant-dock";
import { ProductionDrawer } from "@/components/app/production-drawer";
import { SetupPicker } from "@/components/app/setup-picker";
import { ShotStill } from "@/components/app/shot-still";
import { SidebarDock, type SidebarDockTab } from "@/components/app/sidebar-dock";
import { Button } from "@/components/ui/button";
import { slugForScene } from "@/lib/fountain";
import { coverageLabel, LINE_COLOR_BG } from "@/lib/lining";
import { markColor, markSegments } from "@/lib/marks";
import { DEFAULT_FRAME_LAYERS, type FrameLayerSettings } from "@/lib/frame-renderer";
import { useSlate } from "@/lib/store";
import { useStagePlayback } from "@/lib/stage-playback";
import type { ScriptElement, ScriptMark, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export type StageDockTab = "frame" | "inspector" | "copilot" | "book" | "script";
export const STAGE_OPEN_DOCK_EVENT = "slate:stage-open-dock";

const STAGE_DOCK_TABS: SidebarDockTab<StageDockTab>[] = [
  { id: "frame", label: "Frame", icon: Sparkles },
  { id: "inspector", label: "Shot", icon: SlidersHorizontal },
  { id: "copilot", label: "Co-Pilot", icon: Bot },
  { id: "book", label: "Book", icon: BookOpen },
  { id: "script", label: "Script", icon: FileText },
];

export function StageView() {
  const [showStrip, setShowStrip] = useState(false);
  const [dockTab, setDockTab] = useState<StageDockTab | null>(null);
  const [studioPane, setStudioPane] = useState<StudioPane>("split");
  const [frameLayers, setFrameLayers] = useState<FrameLayerSettings>(DEFAULT_FRAME_LAYERS);
  const project = useSlate((s) => s.project);
  const selectedId = useSlate((s) => s.selectedId);
  const compositionPreview = useStagePlayback((s) => s.shotId === selectedId && (s.playing || s.shotClock > 0));
  const selectShot = useSlate((s) => s.selectShot);
  const setView = useSlate((s) => s.setView);
  const shot = project.shots.find((s) => s.id === selectedId) ?? project.shots[0];

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<StageDockTab>;
      if (ce.detail) setDockTab(ce.detail);
    };
    window.addEventListener(STAGE_OPEN_DOCK_EVENT, handler);
    return () => window.removeEventListener(STAGE_OPEN_DOCK_EVENT, handler);
  }, []);

  if (!shot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-3xl">No setup selected.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Line a beat on the script, then stage people, moves, and changes on that coverage.
        </p>
        <Button variant="secondary" onClick={() => setView("script")}>
          Back to script
        </Button>
      </div>
    );
  }

  const sceneShots = project.shots.filter((s) => s.sceneId === shot.sceneId);
  const list = sceneShots.length ? sceneShots : project.shots;
  const idx = list.findIndex((s) => s.id === shot.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const slug = slugForScene(project.script, shot.sceneId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!prev}
            aria-label="Previous setup"
            onClick={() => prev && selectShot(prev.id)}
          >
            <ChevronLeft />
          </Button>
          <SetupPicker selectedId={shot.id} onSelect={selectShot} />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!next}
            aria-label="Next setup"
            onClick={() => next && selectShot(next.id)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-xs text-muted-foreground">
          <span className="truncate font-semibold text-foreground max-w-[200px] sm:max-w-none">
            {shot.title || `Setup ${shot.setup}`}
          </span>
          <span className="opacity-40">·</span>
          <span className="shrink-0">{idx + 1} of {list.length}</span>
          {slug ? (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate">{slug}</span>
            </>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" aria-expanded={showStrip} onClick={() => setShowStrip(!showStrip)}>
          <Images />
          <span className="hidden sm:inline">Setups</span>
        </Button>
        <Button
          size="sm"
          variant={dockTab === "frame" ? "secondary" : "ghost"}
          aria-label="Frame generation & prompts"
          title="Frame generation & prompt synthesis"
          aria-controls="stage-shot-inspector"
          aria-expanded={dockTab === "frame"}
          onClick={() => {
            if (dockTab === "frame") {
              setDockTab(null);
            } else {
              setStudioPane("frame");
              setDockTab("frame");
            }
          }}
        >
          <Sparkles />
          <span className="hidden sm:inline">Frame</span>
        </Button>
        <Button
          size="sm"
          variant={dockTab === "inspector" ? "secondary" : "ghost"}
          aria-label="Shot details"
          title="Shot & camera setup details: framing, movement, lens, angle"
          aria-controls="stage-shot-inspector"
          aria-expanded={dockTab === "inspector"}
          onClick={() => {
            if (dockTab === "inspector") {
              setDockTab(null);
            } else {
              if (selectedId !== shot.id) selectShot(shot.id);
              setDockTab("inspector");
            }
          }}
        >
          <SlidersHorizontal />
          <span className="hidden sm:inline">Shot</span>
        </Button>
        <Button
          size="sm"
          variant={dockTab === "copilot" ? "secondary" : "ghost"}
          aria-label="Stage Director Co-Pilot"
          title="Directorial checks: 180° line-of-action, eyelines, and prompt synthesizer"
          aria-expanded={dockTab === "copilot"}
          onClick={() => setDockTab(dockTab === "copilot" ? null : "copilot")}
        >
          <Bot />
          <span className="hidden sm:inline">Stage Co-Pilot</span>
        </Button>
        <Button
          size="sm"
          variant={dockTab === "book" ? "secondary" : "ghost"}
          aria-label="Production Book"
          aria-expanded={dockTab === "book"}
          onClick={() => setDockTab(dockTab === "book" ? null : "book")}
        >
          <BookOpen />
          <span className="hidden sm:inline">Book</span>
        </Button>
        <Button
          size="sm"
          variant={dockTab === "script" ? "secondary" : "ghost"}
          aria-label="Linked Script"
          aria-expanded={dockTab === "script"}
          onClick={() => setDockTab(dockTab === "script" ? null : "script")}
        >
          <FileText />
          <span className="hidden sm:inline">Script</span>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setView("edit")}>
          <Play />
          <span className="hidden sm:inline">Edit cut</span>
        </Button>
      </div>

      {showStrip ? <SetupStrip shots={list} selectedId={shot.id} onSelect={selectShot} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <div className="flex min-h-[22rem] flex-1 flex-col">
            <BlockingStudio
              key={`${project.id}:${shot.id}`}
              shot={shot}
              shots={list}
              pane={studioPane}
              onPaneChange={(newPane) => {
                setStudioPane(newPane);
                if (newPane === "frame") {
                  setDockTab("frame");
                }
              }}
              embedded
              onFrameLayersChange={setFrameLayers}
            />
          </div>
        </div>

        {dockTab ? (
          <SidebarDock
            id="stage-shot-inspector"
            ariaLabel="Stage sidebar dock"
            tablistAriaLabel="Stage sidebar tabs"
            tabs={STAGE_DOCK_TABS}
            activeTab={dockTab}
            onTabChange={setDockTab}
            onClose={() => setDockTab(null)}
          >
            {dockTab === "frame" ? (
              <div className="h-full overflow-y-auto p-3">
                <ImagineActions shot={shot} frameLayers={frameLayers} compositionPreview={compositionPreview} compact />
              </div>
            ) : null}
            {dockTab === "inspector" ? (
              <div className="h-full overflow-y-auto px-3 pt-3">
                <Inspector embedded />
              </div>
            ) : null}
            {dockTab === "copilot" ? <ProductionAssistantDock shot={shot} /> : null}
            {dockTab === "book" ? <ProductionDrawer embedded /> : null}
            {dockTab === "script" ? (
              <div className="h-full overflow-y-auto px-3 pt-3">
                <LinedExcerpt shot={shot} />
              </div>
            ) : null}
          </SidebarDock>
        ) : null}
      </div>
    </div>
  );
}

function SetupStrip({
  shots,
  selectedId,
  onSelect,
}: {
  shots: Shot[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (shots.length < 2) return null;
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-border px-3 py-2 sm:px-4">
      {shots.map((shot) => {
        const active = shot.id === selectedId;
        return (
          <button
            key={shot.id}
            type="button"
            onClick={() => onSelect(shot.id)}
            aria-current={active ? "true" : undefined}
            aria-label={`Stage ${coverageLabel(shot)}`}
            className={cn(
              "w-[7.25rem] shrink-0 overflow-hidden rounded-md border text-left",
              active ? "border-steel bg-card" : "border-border bg-secondary/40 hover:border-steel/50",
            )}
          >
            <div className="aspect-video bg-paper">
              <ShotStill sketch={shot.sketch} frameUrl={shot.frameUrl} alt={shot.title} />
            </div>
            <span className="flex items-center gap-1.5 px-1.5 py-1">
              <span className={cn("size-1.5 shrink-0 rounded-full", LINE_COLOR_BG[shot.lineColor])} />
              <span className="truncate font-script text-xs">{coverageLabel(shot)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LinedExcerpt({ shot }: { shot: Shot }) {
  const project = useSlate((s) => s.project);
  const setView = useSlate((s) => s.setView);
  const selectElement = useSlate((s) => s.selectElement);
  const linked = project.script.filter((e) => shot.elementIds.includes(e.id));
  const marks = (project.marks ?? []).filter((m) => shot.elementIds.includes(m.elementId));

  const openBeat = (id: string) => {
    selectElement(id);
    setView("script");
  };

  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">On this line</p>
          <p className="text-xs text-muted-foreground">
            {linked.length ? `${linked.length} beats` : "Not lined"}
            {marks.length ? ` · ${marks.length} marks` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setView("script")}
          title="Open screenplay in Script view"
        >
          <span>Full script</span>
          <ExternalLink className="size-3" />
        </Button>
      </div>
      {linked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This setup is not lined. Draw the coverage on the script, then come back to stage it.
        </p>
      ) : (
        <div className="script-page rounded-sm px-6 py-5 sm:px-10">
          {linked.map((el) => (
            <ExcerptBeat
              key={el.id}
              el={el}
              marks={marks.filter((m) => m.elementId === el.id)}
              onOpen={() => openBeat(el.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ExcerptBeat({
  el,
  marks,
  onOpen,
}: {
  el: ScriptElement;
  marks: ScriptMark[];
  onOpen: () => void;
}) {
  const cls =
    el.kind === "scene"
      ? "script-slug mt-2 mb-2"
      : el.kind === "character"
        ? "script-character mt-4"
        : el.kind === "dialogue"
          ? "script-dialogue"
          : el.kind === "parenthetical"
            ? "script-paren"
            : el.kind === "transition"
              ? "script-transition mt-4"
              : "mt-3";
  const segments = markSegments(el.text, marks);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "block w-full rounded-sm px-1 text-left font-script text-sm leading-snug text-script-ink hover:bg-script-ink/6",
        cls,
      )}
    >
      {el.text ? (
        segments.map((part, i) =>
          part.mark ? (
            <span key={part.mark.id} className="script-mark" style={{ color: markColor(part.mark.tag) }}>
              {part.text}
            </span>
          ) : (
            <span key={`t${i}`}>{part.text}</span>
          ),
        )
      ) : (
        <span className="text-script-muted">Empty beat</span>
      )}
    </button>
  );
}
