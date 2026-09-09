import { Check, Play } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  coverageBeats,
  coverageLanes,
  pictureClips,
} from "@/lib/coverage-edit";
import { coverageLabel, framingLabel, LINE_COLOR_BG } from "@/lib/lining";
import { formatTimecode } from "@/lib/timecode";
import type { EditTimeline, Project, TimelineClip } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ScriptCoverageGridProps {
  project: Project;
  height?: number;
  zoom?: number;
  navigationOnly?: boolean;
  timeline: EditTimeline;
  selectedClip?: TimelineClip;
  playingClip?: TimelineClip | null;
  playheadClip?: TimelineClip | null;
  onChoose: (elementId: string, shotId: string, targetClipId?: string) => void;
  onSeekBeat: (elementId: string) => void;
  onShotSettings: (shotId: string) => void;
}

export function ScriptCoverageGrid({
  project,
  height = 220,
  zoom = 100,
  navigationOnly = false,
  timeline,
  selectedClip,
  playingClip,
  playheadClip,
  onChoose,
  onSeekBeat,
  onShotSettings,
}: ScriptCoverageGridProps) {
  const beats = coverageBeats(project);
  const lanes = coverageLanes(project);
  const clips = pictureClips(timeline);
  const beatWidth = Math.round((72 * zoom) / 100);
  const columns = `108px repeat(${beats.length}, minmax(${beatWidth}px, 1fr))`;
  if (!beats.length)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Add action or dialogue to line your coverage.
      </p>
    );
  return (
    <div
      className="min-h-28 overflow-auto px-3 pb-3"
      style={{ height }}
      aria-label="Script coverage lanes"
    >
      <div
        className="relative"
        style={{ minWidth: Math.max(420, 108 + beats.length * beatWidth) }}
      >
        <div
          className="sticky top-0 z-20 grid bg-card"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="sticky left-0 z-30 flex items-end bg-card px-2 pb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Story position
          </div>
          {beats.map((beat, index) => (
            <button
              key={beat.elementId}
              type="button"
              title={beat.text}
              onClick={() => onSeekBeat(beat.elementId)}
              className="min-w-0 border-l border-border px-2 py-2 text-left hover:bg-secondary"
            >
              <span className="block font-mono text-[10px] text-muted-foreground">
                {index + 1}
              </span>
              <span className="line-clamp-2 text-[10px] leading-tight">
                {beat.text}
              </span>
            </button>
          ))}
        </div>
        {lanes.map((lane) => {
          const source = project.shots.find((shot) => shot.id === lane.shotId)!;
          return (
            <div
              key={lane.shotId}
              className="relative grid min-h-11 border-t border-border"
              style={{ gridTemplateColumns: columns }}
            >
              <button
                type="button"
                onClick={() => onShotSettings(lane.shotId)}
                title={`${source.title} · Open shot settings`}
                className="sticky left-0 z-10 min-w-0 bg-card px-2 py-1.5 text-left hover:bg-secondary"
              >
                <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      LINE_COLOR_BG[source.lineColor],
                    )}
                  />
                  {coverageLabel(source)}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {lane.role === "master" ? "Master" : "Angle"} ·{" "}
                  {framingLabel(source.coverageSize)} framing
                </span>
              </button>
              <div
                className={cn(
                  "my-1 grid min-w-0 rounded border",
                  lane.role === "master"
                    ? "border-steel/60 bg-steel/15"
                    : "border-border bg-secondary/70",
                )}
                style={{
                  gridColumn: `${lane.firstBeat + 2} / ${lane.lastBeat + 3}`,
                  gridTemplateColumns: `repeat(${lane.lastBeat - lane.firstBeat + 1}, minmax(0, 1fr))`,
                }}
              >
                {beats.slice(lane.firstBeat, lane.lastBeat + 1).map((beat) => {
                  const targets = clips.filter((clip) =>
                    clip.storyElementIds?.includes(beat.elementId),
                  );
                  const target =
                    targets.find((clip) => clip.id === selectedClip?.id) ??
                    targets.find((clip) => clip.id === playheadClip?.id) ??
                    (targets.length === 1 ? targets[0] : undefined);
                  const selectedHere =
                    selectedClip?.shotId === lane.shotId &&
                    selectedClip.storyElementIds?.includes(beat.elementId);
                  const playingHere =
                    playingClip?.shotId === lane.shotId &&
                    playingClip.storyElementIds?.includes(beat.elementId);
                  const currentSource = target?.shotId === lane.shotId;
                  const ambiguous = !navigationOnly && !target && targets.length > 1;
                  const action = navigationOnly
                    ? "View"
                    : currentSource
                      ? "Show excerpt"
                      : targets.length
                        ? "Cut to"
                        : "Add";
                  const accessible = `${ambiguous ? "Choose occurrence for" : action} ${source.setup || source.title} at script beat ${beats.indexOf(beat) + 1}${target ? ` · ${formatTimecode(target.start)}–${formatTimecode(target.start + target.duration)}` : ""}`;
                  const button = (
                    <button
                      type="button"
                      onClick={
                        ambiguous
                          ? undefined
                          : () => onChoose(beat.elementId, lane.shotId, target?.id)
                      }
                      aria-label={accessible}
                      aria-current={selectedHere ? "true" : undefined}
                      title={`${accessible} · ${beat.text}`}
                      className={cn(
                        "group flex min-w-0 items-center justify-center gap-1 border-l border-border/50 px-1 text-[10px] first:border-l-0 hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-steel",
                        selectedHere
                          ? "bg-steel/25 font-medium text-foreground ring-1 ring-inset ring-steel/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {playingHere ? (
                        <Play aria-hidden="true" className="size-3 fill-current" />
                      ) : selectedHere ? (
                        <Check aria-hidden="true" className="size-3" />
                      ) : (
                        <span>
                          {ambiguous
                            ? "Choose…"
                            : currentSource && !navigationOnly
                              ? "Show"
                              : action}
                        </span>
                      )}
                    </button>
                  );
                  return ambiguous ? (
                    <DropdownMenu key={beat.elementId}>
                      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Choose the excerpt to edit</DropdownMenuLabel>
                        {targets.map((occurrence) => {
                          const occurrenceShot = project.shots.find(
                            (candidate) => candidate.id === occurrence.shotId,
                          );
                          return (
                            <DropdownMenuItem
                              key={occurrence.id}
                              onSelect={() =>
                                onChoose(beat.elementId, lane.shotId, occurrence.id)
                              }
                            >
                              {occurrence.shotId === lane.shotId ? "Show" : "Replace"}{" "}
                              {occurrenceShot ? coverageLabel(occurrenceShot) : "excerpt"} ·{" "}
                              {formatTimecode(occurrence.start)}–
                              {formatTimecode(occurrence.start + occurrence.duration)}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span key={beat.elementId} className="grid min-w-0">
                      {button}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!lanes.length ? (
          <p className="p-3 text-xs text-muted-foreground">
            Line a master or angle over the script to begin.
          </p>
        ) : null}
      </div>
    </div>
  );
}
