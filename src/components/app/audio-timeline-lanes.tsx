import type { EditTimeline, Project } from "@/lib/types";

type Track = "source" | "voiceover" | "sfx" | "music";
type LaneClip = {
  id: string;
  label: string;
  start: number;
  duration: number;
  sourceInSec: number;
  gain: number | null;
  muted: boolean;
  left: number;
  width: number;
};
const tracks: { id: Track; label: string; color: string }[] = [
  { id: "source", label: "Source audio", color: "border-sky-500/50 bg-sky-500/20" },
  { id: "voiceover", label: "Voice-over", color: "border-violet-500/50 bg-violet-500/20" },
  { id: "sfx", label: "Sound effects", color: "border-amber-500/50 bg-amber-500/20" },
  { id: "music", label: "Music", color: "border-emerald-500/50 bg-emerald-500/20" },
];
const seconds = (value: number) => Number(value.toFixed(3)).toString();
const validGain = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4 ? value : null;

/** Geometry shares the picture lane's zero origin; no label gutter or minimum clip width. */
export function audioTimelineLaneGeometry(
  project: Project,
  timeline: EditTimeline,
  pixelsPerSecond: number,
) {
  const lanes: Record<Track, LaneClip[]> = { source: [], voiceover: [], sfx: [], music: [] };
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return lanes;
  const add = (track: Track, value: Omit<LaneClip, "left" | "width">) => {
    if (
      !Number.isFinite(value.start) ||
      value.start < 0 ||
      !Number.isFinite(value.duration) ||
      value.duration <= 0
    )
      return;
    lanes[track].push({
      ...value,
      left: value.start * pixelsPerSecond,
      width: value.duration * pixelsPerSecond,
    });
  };
  for (const clip of timeline.clips) {
    if (clip.track !== "picture") continue;
    const shot = project.shots.find((item) => item.id === clip.shotId);
    // A captured still deliberately shadows the setup's current video.
    const videoUrl = clip.sourceVideoUrl || (!clip.sourceFrameUrl ? shot?.videoUrl : null);
    if (typeof videoUrl !== "string" || !videoUrl.trim()) continue;
    add("source", {
      id: clip.id,
      label: clip.label || shot?.title || "Picture excerpt",
      start: clip.start,
      duration: clip.duration,
      sourceInSec: clip.sourceInSec ?? 0,
      gain: validGain(clip.audioGain ?? 1),
      muted: clip.audioMuted === true,
    });
  }
  for (const clip of Array.isArray(project.audioClips) ? project.audioClips : []) {
    if (!clip || !["voiceover", "sfx", "music"].includes(clip.track)) continue;
    add(clip.track, {
      id: clip.id,
      label: clip.label || "Audio clip",
      start: clip.start,
      duration: clip.duration,
      sourceInSec: clip.sourceInSec,
      gain: validGain(clip.gain),
      muted: clip.muted === true,
    });
  }
  return lanes;
}

/** Mount directly in the existing horizontal timeline grid, below its picture lane. */
export function AudioTimelineLanes({
  project,
  timeline,
  pixelsPerSecond,
  onSeek,
  onEditMix,
}: {
  project: Project;
  timeline: EditTimeline;
  pixelsPerSecond: number;
  onSeek: (start: number) => void;
  onEditMix: () => void;
}) {
  const lanes = audioTimelineLaneGeometry(project, timeline, pixelsPerSecond);
  return (
    <div className="mt-1" role="group" aria-label="Audio timeline tracks">
      {tracks.map((track) => {
        const clips = lanes[track.id];
        return (
          <div
            key={track.id}
            className="relative h-8 border-t border-border/50 bg-secondary/15"
            role="group"
            aria-label={`${track.label} timeline`}
          >
            <div className="sticky left-0 z-20 flex h-3.5 w-fit max-w-full items-center gap-2 rounded-br bg-background/95 pr-2 text-[10px] leading-none">
              <span className="font-medium text-muted-foreground">{track.label}</span>
              <button
                type="button"
                className="rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`Edit ${track.label.toLowerCase()} mix`}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditMix();
                }}
              >
                Mix
              </button>
              {!clips.length && <span className="text-muted-foreground/60">No clips</span>}
            </div>
            {clips.map((clip, index) => {
              const mix = clip.muted
                ? "muted"
                : clip.gain === null
                  ? "check mix"
                  : `${seconds(clip.gain)}× gain`;
              const description = `${clip.label} · ${track.label} · edit ${seconds(clip.start)}–${seconds(clip.start + clip.duration)} s · duration ${seconds(clip.duration)} s · source in ${Number.isFinite(clip.sourceInSec) ? seconds(clip.sourceInSec) : "unknown"} s · ${mix}`;
              return (
                <button
                  key={`${clip.id}:${index}`}
                  type="button"
                  className={`absolute top-4 flex h-3.5 min-w-0 items-center gap-1 overflow-hidden rounded-sm border px-1 text-left text-[9px] leading-none hover:z-30 hover:brightness-125 focus-visible:z-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${track.color} ${clip.muted || clip.gain === 0 ? "border-dashed opacity-45" : ""}`}
                  style={{ left: clip.left, width: clip.width }}
                  title={description}
                  aria-label={`Seek to ${seconds(clip.start)} seconds: ${description}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(clip.start);
                  }}
                >
                  <span className="min-w-0 truncate">{clip.label}</span>
                  <span className="ml-auto shrink-0 opacity-75">
                    {clip.muted ? "muted" : clip.gain === null ? "?" : `${seconds(clip.gain)}×`}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
