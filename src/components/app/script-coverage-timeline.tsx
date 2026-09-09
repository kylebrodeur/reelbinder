import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TimelineTransport, TimelinePlayhead, type TimelineTransportProps } from "@/components/app/timeline-transport";
import { ScriptCoverageGrid } from "@/components/app/script-coverage-grid";
import type { EditTimeline, Project, TimelineClip, Shot } from "@/lib/types";
import { coverageBeats, pictureClips, pictureDuration } from "@/lib/coverage-edit";
import { AudioMixPanel } from "@/components/app/audio-mix-panel";
import { AudioTimelineLanes } from "@/components/app/audio-timeline-lanes";
import { coverageLabel, LINE_COLOR_BG } from "@/lib/lining";
import { cn } from "@/lib/utils";
import { ensureTimeline } from "@/lib/timeline";

function pictureClipLabel(clip: TimelineClip, shot?: Shot): string {
  if (!shot) return clip.label || "Missing setup";
  if (!clip.label) return coverageLabel(shot);
  const generated = /^(.*?) (?:· Master )?\[(WS|LS|MS|Medium|MCU|CU|ECU|OTS|2S|Insert)\]$/.exec(
    clip.label,
  );
  const setup = shot.setup?.trim() || String(shot.number);
  return generated && (generated[1] === setup || generated[1] === String(shot.number))
    ? coverageLabel(shot)
    : clip.label;
}

export type CoverageTimelineLane = "coverage" | "cut" | "audio";

export interface ScriptCoverageTimelineProps {
  project: Project;
  timeline?: EditTimeline;
  transport?: TimelineTransportProps & {
    uncoveredBeats?: number;
    onPrimeLane?: (lane: CoverageTimelineLane) => void;
  };
  selectedClip?: TimelineClip;
  playheadClip?: TimelineClip | null;
  playingClip?: TimelineClip | null;
  navigationOnly?: boolean;
  compact?: boolean;
  defaultOpen?: boolean;
  onChoose: (elementId: string, shotId: string, targetClipId?: string) => void;
  onSelectClip?: (clip: TimelineClip) => void;
  onSeekBeat: (elementId: string) => void;
  onShotSettings: (shotId: string) => void;
  /** Optional camera movement & rehearsal controls */
  cameraControls?: React.ReactNode;
}

export function ScriptCoverageTimeline({
  project,
  timeline: timelineProp,
  transport,
  selectedClip,
  playheadClip,
  playingClip,
  navigationOnly = false,
  compact = false,
  defaultOpen = true,
  onChoose,
  onSelectClip,
  onSeekBeat,
  onShotSettings,
  cameraControls,
}: ScriptCoverageTimelineProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [lane, setLane] = useState<CoverageTimelineLane>("coverage");
  const [panelHeight, setPanelHeight] = useState(120);
  const [maximumHeight, setMaximumHeight] = useState(240);
  const drag = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    const resize = () => {
      const maximum = Math.max(120, Math.min(360, Math.floor(window.innerHeight * 0.3)));
      setMaximumHeight(maximum);
      setPanelHeight((height) => Math.min(height, maximum));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const resizePanel = (height: number) => setPanelHeight(Math.max(120, Math.min(maximumHeight, height)));
  const beats = coverageBeats(project);
  const timeline = timelineProp ?? ensureTimeline(project);
  const clips = pictureClips(timeline);
  const duration = pictureDuration(timeline);
  const zoomFactor = transport ? Math.round(transport.zoom ?? 100) : 100;
  const px = zoomFactor;
  const displayDuration = Math.max(duration, 30);
  const gridWidth = Math.max(100, displayDuration * px + 40);

  return (
    <section className="relative min-w-0 shrink-0 border-t border-border bg-card">
      {open && (
        <div
          role="separator"
          aria-label="Timeline height"
          aria-orientation="horizontal"
          aria-valuemin={120}
          aria-valuemax={maximumHeight}
          aria-valuenow={panelHeight}
          tabIndex={0}
          className="absolute inset-x-0 top-0 z-50 h-2 -translate-y-1/2 cursor-row-resize touch-none bg-border hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
          onPointerDown={(event) => {
            event.preventDefault();
            drag.current = { y: event.clientY, height: panelHeight };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) resizePanel(drag.current.height + drag.current.y - event.clientY);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}
          onKeyDown={(event) => {
            const next = event.key === "ArrowUp" ? panelHeight + 20
              : event.key === "ArrowDown" ? panelHeight - 20
              : event.key === "Home" ? 120
              : event.key === "End" ? maximumHeight : null;
            if (next === null) return;
            event.preventDefault();
            resizePanel(next);
          }}
        />
      )}
      {!compact && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
          <Button
            size="sm"
            variant={lane === "coverage" ? "secondary" : "ghost"}
            onClick={() => { setLane("coverage"); setOpen(true); }}
            title="Choose which camera setup covers each script beat"
          >
            Coverage · {beats.length} beats
          </Button>
          {!navigationOnly && (
            <>
              <Button
                size="sm"
                variant={lane === "cut" ? "secondary" : "ghost"}
                onClick={() => { setLane("cut"); setOpen(true); }}
                title="Arrange and trim the clips that play in your exported film"
              >
                Edit timeline · {clips.length} clips
              </Button>
              <Button
                size="sm"
                variant={lane === "audio" ? "secondary" : "ghost"}
                onClick={() => { setLane("audio"); setOpen(true); }}
                title="Mix dialogue, voice-over, sound effects and music for preview and export"
              >
                Sound mix
              </Button>
            </>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label={open ? "Collapse timeline" : "Expand timeline"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </div>
      )}

      {transport && (
        <div className="border-b border-border">
          <TimelineTransport
            {...transport}
            cameraControls={cameraControls ?? transport.cameraControls}
            navigationOnly={navigationOnly}
          />
          {open && (
            <TimelinePlayhead
              duration={transport.duration}
              time={transport.time}
              onSeek={transport.onSeek}
              uncoveredBeats={transport.uncoveredBeats}
            />
          )}
        </div>
      )}

            {open ? lane === "audio" && !navigationOnly ? (
          <div className="overflow-auto p-3" style={{ height: panelHeight }}><AudioMixPanel timeline={timeline} /></div>
        ) : lane === "cut" && !navigationOnly ? (
          <>
            <div className="overflow-auto px-4 pb-3" style={{ height: panelHeight }}>
              <div className="relative" style={{ width: gridWidth }}>
                <div className="relative h-5">
                  {Array.from({ length: Math.floor(displayDuration / 2) + 1 }, (_, i) => i * 2).map(
                    (mark) => (
                      <button
                        type="button"
                        key={mark}
                        onClick={() => transport?.onSeek(mark)}
                        className="absolute font-mono text-[10px] text-muted-foreground"
                        style={{ left: mark * px }}
                      >
                        {mark}s
                      </button>
                    ),
                  )}
                </div>
                <div className="relative h-16 rounded-sm bg-secondary/60">
                  {clips.map((clip) => {
                    const source = project.shots.find((s) => s.id === clip.shotId);
                    return (
                      <button
                        type="button"
                        key={clip.id}
                        onClick={() => {
                          if (onSelectClip) onSelectClip(clip);
                          else transport?.onSeek(clip.start);
                        }}
                        title={`${pictureClipLabel(clip, source)} · source ${(clip.sourceInSec ?? 0).toFixed(2)}–${(clip.sourceOutSec ?? (clip.sourceInSec ?? 0) + clip.duration).toFixed(2)}s`}
                        className={cn(
                          "absolute top-1 flex h-14 items-start gap-1.5 overflow-hidden rounded-sm border px-2 py-2 text-left text-xs",
                          selectedClip?.id === clip.id
                            ? "border-steel bg-card"
                            : "border-border bg-background/90 hover:bg-secondary",
                        )}
                        style={{ left: clip.start * px, width: Math.max(4, clip.duration * px) }}
                      >
                        {source ? (
                          <span
                            className={cn(
                              "mt-1 size-1.5 shrink-0 rounded-full",
                              LINE_COLOR_BG[source.lineColor],
                            )}
                          />
                        ) : null}
                        <span className="min-w-0 truncate">
                          <span className="block truncate font-script">
                            {pictureClipLabel(clip, source)}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {clip.duration.toFixed(2)}s · src {(clip.sourceInSec ?? 0).toFixed(1)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {transport && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground"
                      style={{ left: Math.min(transport.time, duration) * px }}
                    />
                  )}
                </div>
                <AudioTimelineLanes project={project} timeline={timeline} pixelsPerSecond={px} onSeek={(start) => transport?.onSeek(start)} onEditMix={() => setLane("audio")} />
              </div>
            </div>
          </>
      ) : (
        <ScriptCoverageGrid
          height={panelHeight}
          project={project}
          zoom={transport ? Math.round((transport.zoom ?? 100)) : 100}
          timeline={timeline}
          navigationOnly={navigationOnly}
          selectedClip={selectedClip}
          playheadClip={playheadClip}
          playingClip={playingClip}
          onChoose={onChoose}
          onSeekBeat={onSeekBeat}
          onShotSettings={onShotSettings}
        />
      ) : null}
    </section>
  );
}
