import type { EditTimeline, Project, Shot, TimelineClip } from "./types.ts";

export interface CoverageCandidate {
  shotId: string;
  sourceInSec: number;
  sourceOutSec: number;
}

export interface CoverageBeat {
  elementId: string;
  scriptIndex: number;
  text: string;
  candidates: CoverageCandidate[];
}

export interface CoverageLane {
  shotId: string;
  role: "master" | "angle";
  firstBeat: number;
  lastBeat: number;
  elementIds: string[];
}

const MIN_EXCERPT = 0.05;
const sizeOrder = ["WS", "LS", "2S", "MS", "OTS", "MCU", "CU", "ECU", "Insert"];

function shotDuration(shot: Shot): number {
  return Number.isFinite(shot.durationSec) && shot.durationSec > 0 ? shot.durationSec : 6;
}

function label(shot: Shot): string {
  const size =
    shot.coverageSize === "MS"
      ? "Medium"
      : shot.coverageSize;
  return `${shot.setup?.trim() || shot.number} [${size}]`;
}

/** Explicit roles govern coverage; only the documented historical 1A has a legacy default. */
export function coverageRole(
  shot: Pick<Shot, "id" | "setup" | "title" | "notes" | "coverageRole">,
): "master" | "angle" {
  if (shot.coverageRole) return shot.coverageRole;
  return shot.id === "bh_1a" ? "master" : "angle";
}

function coveredScriptIndices(project: Pick<Project, "script" | "shots">, shot: Shot): number[] {
  const ids = new Set(shot.elementIds);
  const indices = project.script.flatMap((element, i) => (ids.has(element.id) ? [i] : []));
  const boardable = project.script.flatMap((element, i) =>
    element.kind === "action" || element.kind === "dialogue" ? [i] : [],
  );
  if (coverageRole(shot) === "master") {
    const explicitScene = project.script.findIndex(
      (element) => element.id === shot.sceneId && element.kind === "scene",
    );
    const anchor = explicitScene >= 0 ? explicitScene : indices[0];
    if (anchor === undefined) return boardable;
    let sceneStart = anchor;
    while (sceneStart > 0 && project.script[sceneStart].kind !== "scene") sceneStart--;
    let sceneEnd = anchor + 1;
    while (sceneEnd < project.script.length && project.script[sceneEnd].kind !== "scene")
      sceneEnd++;
    return boardable.filter((index) => index >= sceneStart && index < sceneEnd);
  }
  const first = indices[0],
    last = indices.at(-1);
  return first === undefined || last === undefined
    ? []
    : boardable.filter((index) => index >= first && index <= last);
}

export function effectiveScriptElementIds(
  project: Pick<Project, "script" | "shots">,
  shot: Shot,
): string[] {
  return coveredScriptIndices(project, shot).map((index) => project.script[index].id);
}

/** Lining endpoints describe a script span, not successive positions in a cut. */
export function coverageBeats(project: Pick<Project, "script" | "shots">): CoverageBeat[] {
  const beats: CoverageBeat[] = project.script.flatMap((element, scriptIndex) =>
    element.kind === "action" || element.kind === "dialogue"
      ? [{ elementId: element.id, scriptIndex, text: element.text, candidates: [] }]
      : [],
  );
  const spans = project.shots
    .map((shot, order) => {
      const indices = new Set(coveredScriptIndices(project, shot));
      const covered = beats.filter((beat) => indices.has(beat.scriptIndex));
      return { shot, order, covered };
    })
    .sort(
      (a, b) =>
        Number(coverageRole(b.shot) === "master") - Number(coverageRole(a.shot) === "master") ||
        b.covered.length - a.covered.length ||
        sizeOrder.indexOf(a.shot.coverageSize) - sizeOrder.indexOf(b.shot.coverageSize) ||
        a.order - b.order,
    );

  for (const { shot, covered } of spans) {
    covered.forEach((beat, index) => {
      // Proportional timing is only a draft. No shared action clock is inferred.
      const sourceInSec = (shotDuration(shot) * index) / covered.length;
      const sourceOutSec = (shotDuration(shot) * (index + 1)) / covered.length;
      beat.candidates.push({ shotId: shot.id, sourceInSec, sourceOutSec });
    });
  }
  return beats;
}

/** Every row uses the same story coordinates; a master occupies its complete scene. */
export function coverageLanes(project: Pick<Project, "script" | "shots">): CoverageLane[] {
  const beats = coverageBeats(project);
  return project.shots
    .flatMap((shot) => {
      const covered = beats.flatMap((beat, index) =>
        beat.candidates.some((candidate) => candidate.shotId === shot.id) ? [index] : [],
      );
      return covered.length
        ? [
            {
              shotId: shot.id,
              role: coverageRole(shot),
              firstBeat: covered[0],
              lastBeat: covered.at(-1)!,
              elementIds: covered.map((index) => beats[index].elementId),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        Number(b.role === "master") - Number(a.role === "master") || a.firstBeat - b.firstBeat,
    );
}

/** Restore missing legacy linkage only; keep timing, order, media and explicit links untouched. */
export function repairTimelineStoryLinks(
  project: Pick<Project, "script" | "shots">,
  timeline: EditTimeline,
): EditTimeline {
  let changed = false;
  const beats = coverageBeats(project);
  const clips = timeline.clips.map((clip) => {
    if (clip.track !== "picture" || clip.storyElementIds !== undefined) return clip;
    const linked = beats.filter((beat) =>
      beat.candidates.some((candidate) => candidate.shotId === clip.shotId),
    );
    if (!linked.length) return clip;
    changed = true;
    return { ...clip, storyElementIds: linked.map((beat) => beat.elementId) };
  });
  return changed ? { ...timeline, clips } : timeline;
}

export function coverageChoices(project: Project, elementIds: string[]): CoverageCandidate[] {
  if (!elementIds.length) return [];
  const beats = coverageBeats(project).filter((beat) => elementIds.includes(beat.elementId));
  if (beats.length !== new Set(elementIds).size) return [];
  return beats[0].candidates.flatMap((candidate) => {
    const spans = beats.map((beat) => beat.candidates.find((c) => c.shotId === candidate.shotId));
    if (spans.some((span) => !span)) return [];
    return [
      {
        shotId: candidate.shotId,
        sourceInSec: Math.min(...spans.map((span) => span!.sourceInSec)),
        sourceOutSec: Math.max(...spans.map((span) => span!.sourceOutSec)),
      },
    ];
  });
}

function pictureFromCandidate(
  shot: Shot,
  candidate: CoverageCandidate,
  id: string,
  start: number,
  elementIds: string[],
): TimelineClip {
  return {
    id,
    shotId: shot.id,
    track: "picture",
    start,
    duration: candidate.sourceOutSec - candidate.sourceInSec,
    label: label(shot),
    sourceInSec: candidate.sourceInSec,
    sourceOutSec: candidate.sourceOutSec,
    storyElementIds: [...elementIds],
    alignment: "estimated",
    sourceVideoUrl: shot.videoUrl || undefined,
    sourceFrameUrl: shot.frameUrl || undefined,
  };
}

export function buildCoverageTimeline(project: Project): EditTimeline {
  let start = 0;
  const clips: TimelineClip[] = [];
  for (const beat of coverageBeats(project)) {
    const candidate = beat.candidates[0];
    const shot = project.shots.find((s) => s.id === candidate?.shotId);
    if (!candidate || !shot) continue;
    const clip = pictureFromCandidate(shot, candidate, `pic_${beat.elementId}`, start, [
      beat.elementId,
    ]);
    clips.push(clip);
    start += clip.duration;
  }
  return { clips, initialized: true };
}

export function ensureCoverageTimeline(project: Project): EditTimeline {
  if (project.timeline?.initialized || project.timeline?.clips?.length)
    return repairTimelineStoryLinks(project, project.timeline);
  return buildCoverageTimeline(project);
}

export function pictureClips(timeline: EditTimeline): TimelineClip[] {
  return timeline.clips
    .filter((clip) => clip.track === "picture")
    .sort((a, b) => a.start - b.start);
}

export function pictureDuration(timeline: EditTimeline): number {
  return pictureClips(timeline).reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
}

function requirePicture(timeline: EditTimeline, id: string): TimelineClip {
  const clip = timeline.clips.find((c) => c.id === id && c.track === "picture");
  if (!clip) throw new Error("Select a picture clip first.");
  return clip;
}

function replaceAndRipple(
  timeline: EditTimeline,
  original: TimelineClip,
  replacement: TimelineClip,
): EditTimeline {
  const ordered = pictureClips(timeline);
  const after = new Set(
    ordered.slice(ordered.findIndex((c) => c.id === original.id) + 1).map((c) => c.id),
  );
  const delta = replacement.duration - original.duration;
  return {
    ...timeline,
    initialized: true,
    clips: timeline.clips.map((clip) =>
      clip.id === original.id
        ? replacement
        : after.has(clip.id)
          ? { ...clip, start: Math.max(0, clip.start + delta) }
          : clip,
    ),
  };
}

export function selectCoverage(
  project: Project,
  timeline: EditTimeline,
  clipId: string,
  shotId: string,
): EditTimeline {
  const clip = requirePicture(timeline, clipId);
  const elements = clip.storyElementIds ?? [];
  const candidate = coverageChoices(project, elements).find((choice) => choice.shotId === shotId);
  const shot = project.shots.find((s) => s.id === shotId);
  if (!candidate || !shot)
    throw new Error(
      "This setup does not cover the selected script span. Assign a script beat first.",
    );
  const replacement = {
    ...clip,
    ...pictureFromCandidate(shot, candidate, clip.id, clip.start, elements),
  };
  return replaceAndRipple(timeline, clip, replacement);
}

/** A target selects one occurrence; without one, retain the first-occurrence/append behavior. */
export function selectCoverageAtBeat(
  project: Project,
  timeline: EditTimeline,
  elementId: string,
  shotId: string,
  targetClipId?: string,
): EditTimeline {
  const targets =
    targetClipId === undefined
      ? []
      : timeline.clips.filter((candidate) => candidate.id === targetClipId);
  if (
    targetClipId !== undefined &&
    (targets.length !== 1 ||
      targets[0].track !== "picture" ||
      !targets[0].storyElementIds?.includes(elementId))
  )
    throw new Error("The target must be a picture clip covering the selected beat.");
  const clip =
    targetClipId === undefined
      ? pictureClips(timeline).find((candidate) => candidate.storyElementIds?.includes(elementId))
      : targets[0];
  if (!clip) {
    const appended = appendCoverageBeat(project, timeline, elementId);
    return selectCoverage(project, appended, appended.clips.at(-1)!.id, shotId);
  }
  if (clip.shotId === shotId) return timeline;
  const ids = project.script
    .filter((element) => clip.storyElementIds?.includes(element.id))
    .map((element) => element.id);
  if (ids.length <= 1) return selectCoverage(project, timeline, clip.id, shotId);
  if (!coverageChoices(project, [elementId]).some((choice) => choice.shotId === shotId))
    throw new Error("This angle does not cover the selected beat.");
  const index = ids.indexOf(elementId);
  const beatDuration = clip.duration / ids.length;
  const splitId = `pic_${crypto.randomUUID()}`;
  let next = timeline;
  let targetId = clip.id;
  if (index > 0) {
    targetId = `${splitId}_beat`;
    next = splitPictureClip(next, clip.id, clip.start + index * beatDuration, targetId);
    next = {
      ...next,
      clips: next.clips.map((part) =>
        part.id === clip.id ? { ...part, storyElementIds: ids.slice(0, index) } : part,
      ),
    };
  }
  if (index < ids.length - 1) {
    const afterId = `${splitId}_after`;
    next = splitPictureClip(next, targetId, clip.start + (index + 1) * beatDuration, afterId);
    next = {
      ...next,
      clips: next.clips.map((part) =>
        part.id === afterId ? { ...part, storyElementIds: ids.slice(index + 1) } : part,
      ),
    };
  }
  next = {
    ...next,
    clips: next.clips.map((part) =>
      part.id === targetId ? { ...part, storyElementIds: [elementId] } : part,
    ),
  };
  return selectCoverage(project, next, targetId, shotId);
}

export function setPictureSourceRange(
  timeline: EditTimeline,
  id: string,
  sourceInSec: number,
  sourceOutSec: number,
  sourceDuration?: number,
): EditTimeline {
  if (
    !Number.isFinite(sourceInSec) ||
    !Number.isFinite(sourceOutSec) ||
    sourceInSec < 0 ||
    sourceOutSec - sourceInSec < MIN_EXCERPT
  ) {
    throw new Error("Enter a valid source range with out after in (at least 0.05 seconds).");
  }
  if (sourceDuration !== undefined && sourceOutSec > sourceDuration + 0.001) {
    throw new Error(`The source ends at ${sourceDuration.toFixed(2)} seconds.`);
  }
  const clip = requirePicture(timeline, id);
  return replaceAndRipple(timeline, clip, {
    ...clip,
    sourceInSec,
    sourceOutSec,
    duration: sourceOutSec - sourceInSec,
    alignment: "manual",
  });
}

/** Preview runs at normal source speed. End is exclusive to avoid showing the next excerpt. */
export function sourceTimeAt(clip: TimelineClip, outputTime: number): number {
  const sourceIn = clip.sourceInSec ?? 0;
  const sourceOut = clip.sourceOutSec ?? sourceIn + clip.duration;
  return Math.min(
    Math.max(sourceIn, sourceOut - 0.001),
    sourceIn + Math.max(0, outputTime - clip.start),
  );
}

export function splitPictureClip(
  timeline: EditTimeline,
  id: string,
  outputTime: number,
  newId = `pic_${crypto.randomUUID()}`,
): EditTimeline {
  const clip = requirePicture(timeline, id);
  const offset = outputTime - clip.start;
  if (offset < MIN_EXCERPT || offset > clip.duration - MIN_EXCERPT)
    throw new Error("Place the playhead inside the clip to split it.");
  const sourceIn = clip.sourceInSec ?? 0;
  const sourceOut = clip.sourceOutSec ?? sourceIn + clip.duration;
  const splitAt = sourceIn + offset;
  if (splitAt >= sourceOut) throw new Error("Split position exceeds the source range.");
  return {
    ...timeline,
    initialized: true,
    clips: timeline.clips.flatMap((c) =>
      c.id !== id
        ? [c]
        : [
            { ...c, sourceInSec: sourceIn, sourceOutSec: splitAt, duration: offset },
            {
              ...c,
              id: newId,
              start: c.start + offset,
              duration: c.duration - offset,
              sourceInSec: splitAt,
              sourceOutSec: sourceOut,
            },
          ],
    ),
  };
}

/** Explicit sequencing packs picture clips; source spans and non-picture planning cues stay intact. */
export function movePictureClip(
  timeline: EditTimeline,
  id: string,
  direction: -1 | 1,
): EditTimeline {
  const clips = pictureClips(timeline);
  const from = clips.findIndex((c) => c.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= clips.length) return timeline;
  [clips[from], clips[to]] = [clips[to], clips[from]];
  let start = 0;
  const packed = clips.map((clip) => {
    const next = { ...clip, start };
    start += clip.duration;
    return next;
  });
  return {
    ...timeline,
    initialized: true,
    clips: [...packed, ...timeline.clips.filter((c) => c.track !== "picture")],
  };
}

export function appendCoverageBeat(
  project: Project,
  timeline: EditTimeline,
  elementId: string,
): EditTimeline {
  const candidate = coverageChoices(project, [elementId])[0];
  const shot = project.shots.find((s) => s.id === candidate?.shotId);
  if (!candidate || !shot)
    throw new Error("Line a setup over this script beat before adding it to the cut.");
  return {
    ...timeline,
    initialized: true,
    clips: [
      ...timeline.clips,
      pictureFromCandidate(
        shot,
        candidate,
        `pic_${crypto.randomUUID()}`,
        pictureDuration(timeline),
        [elementId],
      ),
    ],
  };
}
