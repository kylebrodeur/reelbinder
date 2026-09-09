import { coverageLabel } from "./lining";
import type { EditTimeline, Shot, TimelineClip } from "./types";
import { uid } from "./utils";

export {
  buildCoverageTimeline as buildTimeline,
  ensureCoverageTimeline as ensureTimeline,
} from "./coverage-edit";

/** Coverage uses script positions, so legacy coverage lanes do not extend output duration. */
export function timelineDuration(tl: EditTimeline): number {
  return tl.clips
    .filter((clip) => clip.track !== "coverage")
    .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

export function clipAtTime(
  tl: EditTimeline,
  time: number,
  track: TimelineClip["track"] = "picture",
): TimelineClip | null {
  const hits = tl.clips.filter(
    (c) => c.track === track && time >= c.start && time < c.start + c.duration,
  );
  return hits.sort((a, b) => a.start - b.start)[0] ?? null;
}

export function newClip(shot: Shot, track: TimelineClip["track"], start: number): TimelineClip {
  const duration = Math.max(0.05, shot.durationSec || 6);
  return {
    id: uid("clip"),
    shotId: shot.id,
    track,
    start,
    duration,
    label: coverageLabel(shot),
    sourceInSec: 0,
    sourceOutSec: duration,
    alignment: "manual",
    sourceVideoUrl: shot.videoUrl || undefined,
    sourceFrameUrl: shot.frameUrl || undefined,
  };
}
