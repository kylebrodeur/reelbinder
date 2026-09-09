import { ChevronDown, ChevronUp, Layers, RotateCw, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScriptCoverageTimeline } from "@/components/app/script-coverage-timeline";
import { pictureClips, pictureDuration } from "@/lib/coverage-edit";
import { Button } from "@/components/ui/button";
import { clipAtTime, ensureTimeline } from "@/lib/timeline";
import { useSlate } from "@/lib/store";
import { useStagePlayback } from "@/lib/stage-playback";
import { cameraForShot, figuresForShot } from "@/lib/floor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CAMERA_MOVEMENTS,
  type CameraMovement,
  type FloorCamera,
  type FloorFigure,
  type FloorItem,
  type FloorPlan,
  type Shot,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const COVERAGE_DOCK_OPEN_EVENT = "slate:coverage-dock-open";
export const COVERAGE_DOCK_TOGGLE_EVENT = "slate:coverage-dock-toggle";

const MOVEMENT_LABELS: Record<CameraMovement, string> = {
  "static": "Static (Hold)",
  "pan-left": "Pan Left",
  "pan-right": "Pan Right",
  "tilt-up": "Tilt Up",
  "tilt-down": "Tilt Down",
  "dolly-in": "Dolly In",
  "dolly-out": "Dolly Out",
  "tracking": "Tracking",
  "handheld": "Handheld",
  "crane": "Crane",
  "orbit": "Orbit",
};

function CameraMovementControls({
  shot,
  next,
  cam,
  figures,
  items,
  onPatchShot,
  onPatchFloor,
  cameras,
}: {
  shot: Shot;
  next: Shot | null;
  cam: FloorCamera | null;
  figures: FloorFigure[];
  items: FloorItem[];
  onPatchShot: (id: string, partial: Partial<Shot>) => void;
  onPatchFloor: (partial: Partial<FloorPlan>) => void;
  cameras: FloorCamera[];
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-xs">
      {/* Movement mode */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-6 px-1.5 text-xs gap-1 font-medium",
              shot.movement === "static" ? "text-muted-foreground" : "text-primary font-semibold"
            )}
            title="Camera movement across this setup"
          >
            <Video className="size-3.5" />
            <span>{MOVEMENT_LABELS[shot.movement] ?? "Static"}</span>
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Camera Movement
          </div>
          {CAMERA_MOVEMENTS.map((m) => (
            <DropdownMenuItem
              key={m}
              className={cn("text-xs flex items-center justify-between", shot.movement === m && "font-semibold bg-accent")}
              onSelect={() => onPatchShot(shot.id, { movement: m })}
            >
              <span>{MOVEMENT_LABELS[m]}</span>
              {shot.movement === m ? <span className="text-primary text-xs">✓</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tracking rotation */}
      {shot.movement !== "static" && cam ? (
        <>
          <span className="h-3.5 w-px bg-border/60 mx-0.5" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs gap-1 font-medium text-muted-foreground hover:text-foreground"
                title="Camera tracking rotation behavior during movement"
              >
                <RotateCw className="size-3 text-primary" />
                <span>
                  {cam.rotationMode === "target"
                    ? `Aim: ${figures.find((f) => f.id === cam.targetId)?.name || items.find((i) => i.id === cam.targetId)?.label || "Target"}`
                    : cam.rotationMode === "static"
                      ? "Rot: Static"
                      : "Rot: Over time"}
                </span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tracking Rotation
              </div>
              <DropdownMenuItem
                className={cn(
                  "text-xs flex items-center justify-between",
                  (!cam.rotationMode || cam.rotationMode === "over-time") && "font-semibold bg-accent"
                )}
                onSelect={() => {
                  onPatchFloor({
                    cameras: cameras.map((c) =>
                      c.id === cam.id ? { ...c, rotationMode: "over-time" } : c
                    ),
                  });
                }}
              >
                <span>Over time (smooth turn)</span>
                {(!cam.rotationMode || cam.rotationMode === "over-time") ? (
                  <span className="text-primary text-xs">✓</span>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={cn(
                  "text-xs flex items-center justify-between",
                  cam.rotationMode === "static" && "font-semibold bg-accent"
                )}
                onSelect={() => {
                  onPatchFloor({
                    cameras: cameras.map((c) =>
                      c.id === cam.id ? { ...c, rotationMode: "static" } : c
                    ),
                  });
                }}
              >
                <span>Static (fixed angle)</span>
                {cam.rotationMode === "static" ? (
                  <span className="text-primary text-xs">✓</span>
                ) : null}
              </DropdownMenuItem>

              {figures.length > 0 || items.length > 0 ? (
                <>
                  <div className="my-1 border-t border-border/60" />
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Aim at Target
                  </div>
                  {figures.map((fig) => (
                    <DropdownMenuItem
                      key={fig.id}
                      className={cn(
                        "text-xs flex items-center justify-between",
                        cam.rotationMode === "target" && cam.targetId === fig.id && "font-semibold bg-accent"
                      )}
                      onSelect={() => {
                        onPatchFloor({
                          cameras: cameras.map((c) =>
                            c.id === cam.id ? { ...c, rotationMode: "target", targetId: fig.id } : c
                          ),
                        });
                      }}
                    >
                      <span>Actor: {fig.name}</span>
                      {cam.rotationMode === "target" && cam.targetId === fig.id ? (
                        <span className="text-primary text-xs">✓</span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {items
                    .filter((it) => it.kind === "mark" || it.label)
                    .map((it) => (
                      <DropdownMenuItem
                        key={it.id}
                        className={cn(
                          "text-xs flex items-center justify-between",
                          cam.rotationMode === "target" && cam.targetId === it.id && "font-semibold bg-accent"
                        )}
                        onSelect={() => {
                          onPatchFloor({
                            cameras: cameras.map((c) =>
                              c.id === cam.id ? { ...c, rotationMode: "target", targetId: it.id } : c
                            ),
                          });
                        }}
                      >
                        <span>Item: {it.label || it.kind}</span>
                        {cam.rotationMode === "target" && cam.targetId === it.id ? (
                          <span className="text-primary text-xs">✓</span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      {/* Setup transition */}
      <span className="text-[10px] text-muted-foreground/70 hidden md:inline border-l border-border/60 pl-1.5 font-mono">
        {shot.setup} → {next ? next.setup : "Hold"}
      </span>

      {shot.movement === "static" ? (
        <span className="hidden xl:inline-flex items-center text-[10px] text-amber-500/90 bg-amber-500/10 rounded px-1.5 py-0.5 border border-amber-500/20">
          Static
        </span>
      ) : null}
    </div>
  );
}

/** Navigate and rehearse the same script coverage from any workspace. */
export function CoverageDock() {
  const project = useSlate((s) => s.project);
  const view = useSlate((s) => s.view);
  const selectShot = useSlate((s) => s.selectShot);
  const selectElement = useSlate((s) => s.selectElement);
  const patchShot = useSlate((s) => s.patchShot);
  const patchFloor = useSlate((s) => s.patchFloor);
  const selectedId = useSlate((s) => s.selectedId);

  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [time, setTime] = useState(0);
  const playing = useStagePlayback((state) => state.playing);
  const setPlaying = useStagePlayback((state) => state.setPlaying);

  const timeline = useMemo(() => ensureTimeline(project), [project]);
  const ordered = pictureClips(timeline);
  const duration = pictureDuration(timeline);
  const picture = clipAtTime(timeline, Math.min(time, Math.max(0, duration - 0.001)));

  const timeRef = useRef(time);
  timeRef.current = time;

  // Selected shot for camera movement controls
  const currentShot = project.shots.find((s) => s.id === selectedId) ?? (picture ? project.shots.find((s) => s.id === picture.shotId) : project.shots[0]) ?? null;
  const cam = currentShot ? cameraForShot(project.floor, currentShot) : null;
  const figures = currentShot ? figuresForShot(project.floor, currentShot) : [];
  const shotIdx = project.shots.findIndex((s) => s.id === currentShot?.id);
  const nextShot = shotIdx >= 0 ? project.shots[shotIdx + 1] ?? null : null;

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    useStagePlayback.getState().reset();
  }, [project.id]);

  useEffect(() => {
    setTime((current) => Math.min(current, duration));
  }, [duration]);

  const seek = useCallback((next: number) => {
    const position = Math.max(0, Math.min(duration, next));
    timeRef.current = position;
    setTime(position);
    const clip = clipAtTime(timeline, Math.min(position, Math.max(0, duration - 0.001)));
    if (!clip) {
      useStagePlayback.getState().reset();
      return;
    }
    const shotClock = Math.max(0, position - clip.start);
    const shotProgress = Math.min(1, shotClock / Math.max(0.1, clip.duration));
    if (view === "stage") useStagePlayback.getState().setTime(position, shotClock, shotProgress, clip.shotId);
    const current = useSlate.getState();
    if (clip.shotId !== current.selectedId) selectShot(clip.shotId);
    const elementId = clip.storyElementIds?.[0];
    if (elementId && elementId !== current.selectedElementId) selectElement(elementId);
  }, [duration, timeline, view, selectShot, selectElement]);

  useEffect(() => {
    if (view !== "stage" || !open) {
      setPlaying(false);
      useStagePlayback.getState().reset();
    }
  }, [view, open]);

  useEffect(() => {
    const rehearsal = useStagePlayback.getState();
    if (rehearsal.shotId && rehearsal.shotId !== selectedId) {
      setPlaying(false);
      rehearsal.reset();
    }
  }, [selectedId]);

  useEffect(() => {
    if (!playing || view !== "stage" || !open) {
      useStagePlayback.getState().setPlaying(false);
      return;
    }
    useStagePlayback.getState().setPlaying(true);
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, now - last) / 1000;
      last = now;
      const nextTime = Math.min(duration, timeRef.current + delta);
      seek(nextTime);
      if (nextTime >= duration) {
        setPlaying(false);
        useStagePlayback.getState().setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      useStagePlayback.getState().setPlaying(false);
    };
  }, [playing, view, open, duration, seek]);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleToggle = () => setOpen((prev) => !prev);
    window.addEventListener(COVERAGE_DOCK_OPEN_EVENT, handleOpen);
    window.addEventListener(COVERAGE_DOCK_TOGGLE_EVENT, handleToggle);
    return () => {
      window.removeEventListener(COVERAGE_DOCK_OPEN_EVENT, handleOpen);
      window.removeEventListener(COVERAGE_DOCK_TOGGLE_EVENT, handleToggle);
    };
  }, []);

  if (view === "edit") return null;

  const isStage = view === "stage";

  return (
    <section className="min-w-0 shrink-0 border-t border-border bg-card" aria-label="Shared script coverage">
      {!open && (
        <div className="flex items-center gap-2 px-3 py-1">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(true)}>
            <Layers className="size-3.5" /> Script coverage <ChevronUp className="size-3.5" />
          </Button>
        </div>
      )}
      {open && (
        <div className="relative">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close script coverage"
            className="absolute right-3 top-2 z-10"
            onClick={() => {
              setOpen(false);
              setPlaying(false);
            }}
          >
            <ChevronDown />
          </Button>
          <ScriptCoverageTimeline
            project={project}
            timeline={timeline}
            selectedClip={picture ?? undefined}
            playheadClip={picture}
            playingClip={playing ? picture : undefined}
            navigationOnly
            defaultOpen={true}
            cameraControls={
              isStage && currentShot ? (
                <CameraMovementControls
                  shot={currentShot}
                  next={nextShot}
                  cam={cam ?? null}
                  figures={figures}
                  items={project.floor.items}
                  onPatchShot={patchShot}
                  onPatchFloor={patchFloor}
                  cameras={project.floor.cameras}
                />
              ) : null
            }
            transport={{
              duration,
              time,
              playing,
              zoom,
              rehearsal: isStage,
              onPlay: () => {
                const selected = ordered.find((clip) => clip.shotId === selectedId);
                seek(time >= duration ? 0 : picture?.shotId === selectedId ? time : selected?.start ?? time);
                setPlaying(true);
              },
              onPause: () => {
                setPlaying(false);
              },
              onSeek: (position) => { setPlaying(false); seek(position); },
              onPrevClip: () => seek([...ordered].reverse().find((clip) => clip.start < time - 0.01)?.start ?? 0),
              onNextClip: () => seek(ordered.find((clip) => clip.start > time + 0.01)?.start ?? duration),
              onZoom: setZoom,
            }}
            onChoose={(elementId, shotId, targetClipId) => {
              const clip = targetClipId
                ? ordered.find((candidate) => candidate.id === targetClipId)
                : ordered.find((candidate) => candidate.shotId === shotId && candidate.storyElementIds?.includes(elementId));
              if (clip) seek(clip.start);
              selectElement(elementId);
              selectShot(shotId);
            }}
            onSeekBeat={(elementId) => {
              const clip = ordered.find((candidate) => candidate.storyElementIds?.includes(elementId));
              if (clip) seek(clip.start);
              selectElement(elementId);
              if (!clip) {
                const shot = project.shots.find((candidate) => candidate.elementIds.includes(elementId));
                if (shot) selectShot(shot.id);
              }
            }}
            onShotSettings={(shotId) => {
              const clip = ordered.find((candidate) => candidate.shotId === shotId);
              if (clip) seek(clip.start);
              selectShot(shotId);
              const first = project.shots.find((shot) => shot.id === shotId)?.elementIds[0];
              if (first) selectElement(first);
            }}
          />
        </div>
      )}
    </section>
  );
}
