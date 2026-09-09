import { ChevronDown, Columns2, Image, Layers, Map, RectangleHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { poseAt, poseCameraAt } from "@/lib/blocking-playback";
import { BlockingCanvas } from "@/components/app/blocking-canvas";
import { COVERAGE_DOCK_TOGGLE_EVENT } from "@/components/app/coverage-dock";
import { ImagineActions } from "@/components/app/frame-studio";
import { OverheadPlan } from "@/components/app/overhead-plan";
import { OriginalInset } from "@/components/app/original-inset";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cameraForShot, figuresForShot, projectFrameToFloor, applyFrameToBlocking, frameMarksToItems, sketchFromBlocking } from "@/lib/floor";
import { originalBoardFor, originalOverheadFor } from "@/lib/originals";
import { useSlate } from "@/lib/store";
import { useStagePlayback } from "@/lib/stage-playback";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DEFAULT_FRAME_LAYERS } from "@/lib/frame-renderer";

export type StudioPane = "plan" | "split" | "frame";

const PANES: { id: StudioPane; label: string; icon: typeof Map }[] = [
  { id: "plan", label: "Floor", icon: Map },
  { id: "split", label: "Split", icon: Columns2 },
  { id: "frame", label: "Frame", icon: RectangleHorizontal },
];

export interface BlockingStudioProps {
  shot: Shot;
  shots: Shot[];
  pane?: StudioPane;
  onPaneChange?: (pane: StudioPane) => void;
  embedded?: boolean;
  onFrameLayersChange?: (layers: typeof DEFAULT_FRAME_LAYERS) => void;
}

export function BlockingStudio({
  shot,
  shots,
  pane: paneProp,
  onPaneChange,
  embedded = false,
  onFrameLayersChange,
}: BlockingStudioProps) {
  const project = useSlate((s) => s.project);
  const selectShot = useSlate((s) => s.selectShot);
  const patchFloor = useSlate((s) => s.patchFloor);
  const setBlocking = useSlate((s) => s.setBlocking);
  const setSketch = useSlate((s) => s.setSketch);
  const setAnnotations = useSlate((s) => s.setAnnotations);

  const [internalPane, setInternalPane] = useState<StudioPane>("split");
  const pane = paneProp ?? internalPane;
  const setPane = (next: StudioPane) => {
    setInternalPane(next);
    onPaneChange?.(next);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [placeOnFrame, setPlaceOnFrame] = useState<string | null>(null);
  const [frameLayers, setFrameLayers] = useState(DEFAULT_FRAME_LAYERS);
  useEffect(() => {
    onFrameLayersChange?.(frameLayers);
  }, [frameLayers, onFrameLayersChange]);
  const [showReferences, setShowReferences] = useState(false);
  const [solo, setSolo] = useState(false);
  const [hiddenShotIds, setHiddenShotIds] = useState<string[]>([]);

  // Stage playback driven by the Script Coverage timeline
  const stagePlaying = useStagePlayback((s) => s.playing);
  const stageClock = useStagePlayback((s) => s.shotClock);
  const stageProgress = useStagePlayback((s) => s.shotProgress);
  const stageShotId = useStagePlayback((s) => s.shotId);

  const figures = figuresForShot(project.floor, shot);
  const frameCast = figures.filter((figure) => figure.name.trim() && shot.characters.includes(figure.name));
  const frameCastIds = new Set(frameCast.map((figure) => figure.id));
  const cam = cameraForShot(project.floor, shot);
  const originalOverhead = originalOverheadFor(project);
  const originalBoard = originalBoardFor(project, shot);
  const idx = shots.findIndex((s) => s.id === shot.id);
  const next = idx >= 0 ? shots[idx + 1] ?? null : null;

  // Rehearsal poses for live animation during timeline playback
  const isPlaying = stagePlaying && stageShotId === shot.id;
  const isScrubbing = stageClock > 0 && stageShotId === shot.id;
  const activeProgress = isPlaying || isScrubbing ? stageProgress : null;

  const preview = activeProgress !== null
    ? poseAt(project.floor, shot, next, activeProgress)
    : null;
  const previewCam = activeProgress !== null
    ? poseCameraAt(project.floor, shot, next, activeProgress)
    : null;

  const syncToFrame = () => {
    const live = preview ?? figures;
    setSketch(
      shot.id,
      sketchFromBlocking(live.filter((figure) => frameCastIds.has(figure.id)), previewCam ?? cam, shot.sketch),
    );
    useStagePlayback.getState().reset();
    setPlaceOnFrame(null);
    if (pane === "plan") setPane("frame");
  };

  const syncFromFrame = () => {
    const nextCast = applyFrameToBlocking(frameCast, cam, shot.sketch, shot.annotations);
    const nextFigures = figures.map(
      (figure) => nextCast.find((candidate) => candidate.id === figure.id) ?? figure,
    );
    setBlocking(shot.id, { figures: nextFigures }, { syncSketch: false });
    if (cam) {
      const extras = frameMarksToItems(shot.sketch, shot.annotations, cam, shot.id);
      const seen = new Set(project.floor.items.map((i) => i.id));
      const add = extras.filter((i) => !seen.has(i.id));
      if (add.length) patchFloor({ items: [...project.floor.items, ...add] });
    }
    if (pane === "frame") setPane("plan");
  };

  const pickCast = (id: string | null) => {
    const linkedId = id && frameCastIds.has(id) ? id : null;
    setSelected(linkedId);
    const alreadyInFrame = linkedId ? shot.sketch.stamps.some((stamp) => stamp.figureId === linkedId) : false;
    setPlaceOnFrame(pane !== "plan" && !alreadyInFrame ? linkedId : null);
  };

  const plan = (
    <OverheadPlan
      key={`${shot.id}-plan`}
      shot={shot}
      editable
      fill={pane !== "split"}
      playing={isPlaying}
      previewFigures={preview}
      previewCam={previewCam}
      selectedFigureId={selected}
      layerShots={shots}
      solo={solo}
      hiddenShotIds={hiddenShotIds}
      onSolo={setSolo}
      onToggleLayer={(id) =>
        setHiddenShotIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
      }
      onSelectShot={selectShot}
      onSelectFigure={(id) => {
        setSelected(id);
        setPlaceOnFrame(null);
      }}
      originalUrl={showReferences ? originalOverhead?.url ?? null : null}
      className="rounded-none border-0"
    />
  );

  const frame = (
    <OriginalInset
      originalUrl={showReferences ? originalBoard?.url ?? null : null}
      originalAlt="Original storyboard reference"
    >
      <BlockingCanvas
        key={`${shot.id}-frame`}
        layers={frameLayers}
        onLayersChange={setFrameLayers}
        sketch={shot.sketch}
        annotations={shot.annotations}
        frameUrl={shot.frameUrl}
        cast={frameCast}
        selectedFigureId={selected && frameCastIds.has(selected) ? selected : null}
        placeFigureId={placeOnFrame && frameCastIds.has(placeOnFrame) ? placeOnFrame : null}
        overlayFigures={preview ?? undefined}
        overlayCam={previewCam ?? undefined}
        onSelectFigure={pickCast}
        onSketch={(sk) => setSketch(shot.id, sk)}
        onAnnotations={(a) => setAnnotations(shot.id, a)}
        onLinkedMove={(id, p) => {
          if (!cam || !frameCastIds.has(id)) return;
          const pos = projectFrameToFloor(p, cam);
          setBlocking(
            shot.id,
            { figures: figures.map((f) => (f.id === id ? { ...f, x: pos.x, y: pos.y } : f)) },
            { syncSketch: false },
          );
        }}
      />
    </OriginalInset>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Clean Stage Toolbar — Camera controls & Play Move unified in Script Coverage Timeline */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 font-medium"
          onClick={() => window.dispatchEvent(new CustomEvent(COVERAGE_DOCK_TOGGLE_EVENT))}
          title="Open script coverage timeline and camera rehearsal controls"
        >
          <Layers className="size-3.5 text-primary" />
          <span>Script Coverage</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>

        {/* Right side controls: Sync views, References, and Pane Switcher */}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1">
                <span>Sync views</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={syncToFrame}>Compose frame from current plan</DropdownMenuItem>
              <DropdownMenuItem onSelect={syncFromFrame}>Update plan from frame positions</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {originalOverhead || originalBoard ? (
            <Button
              size="sm"
              variant={showReferences ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs gap-1"
              aria-pressed={showReferences}
              onClick={() => setShowReferences(!showReferences)}
            >
              <Image className="size-3.5" />
              <span>References</span>
            </Button>
          ) : null}

          <div className="flex rounded-md bg-secondary p-1" role="tablist" aria-label="Stage editor">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                onClick={() => { setPane(p.id); setPlaceOnFrame(null); }}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs",
                  pane === p.id ? "bg-card text-foreground" : "text-muted-foreground",
                )}
              >
                <p.icon className="size-3.5" />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {pane === "plan" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-script">
            {plan}
          </section>
        ) : null}

        {pane === "frame" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Frame editor</p>
              <div className="flex min-h-0 flex-1 items-center justify-center">{frame}</div>
            </section>
            {!embedded ? (
              <aside className="flex min-h-0 min-w-0 w-full flex-col overflow-y-auto border-t border-border p-3 md:w-80 md:border-l md:border-t-0 lg:w-96">
                <ImagineActions frameLayers={frameLayers} shot={shot} compact compositionPreview={!!preview} />
              </aside>
            ) : null}
          </div>
        ) : null}

        {pane === "split" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-script">
              {plan}
            </section>
            <aside className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto border-t border-border p-3 md:border-l md:border-t-0">
              <p className="mb-1.5 font-script text-xs uppercase tracking-wide text-muted-foreground">Viewfinder & Storyboard</p>
              {frame}
              {!embedded ? (
                <div className="mt-3">
                  <ImagineActions frameLayers={frameLayers} shot={shot} compact compositionPreview={!!preview} />
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
