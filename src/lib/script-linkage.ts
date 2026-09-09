import { reconcileMarks } from "./marks";
import { coverageRole, effectiveScriptElementIds } from "./coverage-edit";
import { sizeFromCamera } from "./lining";
import type {
  CameraAngle,
  CoverageSize,
  Project,
  ScriptElement,
  ScriptProductionDirection,
  Shot,
} from "./types";
import { syncCoreEvents } from "./world";

export type NarrativeKind = "action" | "dialogue";
export type ScriptTextEdit = {
  elementId: string;
  kind: NarrativeKind;
  character?: string;
  before: string;
  after: string;
};
export type ScriptReview = {
  projectId: string;
  shotId: string;
  kind: NarrativeKind;
  sourceSignature: string;
  edits: ScriptTextEdit[];
};
export type ScriptReviewResult = { ok: true; project: Project } | { ok: false; error: string };

const FRAMING_CAMERAS = new Set<CameraAngle>([
  "extreme-wide",
  "wide",
  "full",
  "medium",
  "close-up",
  "extreme-close-up",
  "insert",
]);
export const CAMERA_FOR_FRAMING: Partial<Record<CoverageSize, CameraAngle>> = {
  WS: "full",
  LS: "wide",
  MS: "medium",
  MCU: "close-up",
  CU: "close-up",
  ECU: "extreme-close-up",
  OTS: "over-the-shoulder",
  "2S": "medium",
  Insert: "insert",
};

export function synchronizeShotFraming(shot: Shot, partial: Partial<Shot>): Shot {
  const next = { ...shot, ...partial };
  if (partial.coverageRole === "master" && coverageRole(shot) === "angle") {
    next.angleElementIds = [...shot.elementIds];
  } else if (
    partial.coverageRole === "angle" &&
    coverageRole(shot) === "master" &&
    shot.angleElementIds !== undefined &&
    partial.elementIds === undefined
  ) {
    next.elementIds = [...shot.angleElementIds];
  }
  if (partial.coverageSize !== undefined && FRAMING_CAMERAS.has(next.camera)) {
    next.camera = CAMERA_FOR_FRAMING[partial.coverageSize] ?? next.camera;
  } else if (partial.camera !== undefined && FRAMING_CAMERAS.has(partial.camera)) {
    next.coverageSize = sizeFromCamera(partial.camera);
  }
  return next;
}

/** Match coverage spans while retaining authored non-narrative links and unresolved IDs. */
function linkedScriptElementIds(script: ScriptElement[], shot: Shot): string[] {
  const ids = new Set(effectiveScriptElementIds({ script, shots: [shot] }, shot));
  const elements = new Map(script.map((element) => [element.id, element]));
  for (const id of shot.elementIds) {
    const element = elements.get(id);
    if (!element || (element.kind !== "action" && element.kind !== "dialogue")) ids.add(id);
  }
  return [
    ...script.filter((element) => ids.has(element.id)).map((element) => element.id),
    ...[...ids].filter((id) => !elements.has(id)),
  ];
}

export function narrativeForShot(script: ScriptElement[], shot: Shot) {
  const ids = new Set(linkedScriptElementIds(script, shot));
  const linked = script.filter((element) => ids.has(element.id));
  return {
    action: linked
      .filter((element) => element.kind === "action")
      .map((element) => element.text)
      .join("\n\n"),
    dialogue: linked
      .filter((element) => element.kind === "dialogue")
      .map((element) => element.text)
      .join("\n\n"),
  };
}

/** Production fields belong to their setup, including when several setups share a beat. */
export function synchronizeProductionDirections(project: Project): Project {
  const shots = project.shots.map((shot) => ({
    ...shot,
    elementIds: linkedScriptElementIds(project.script, shot),
  }));
  const script = project.script.map((element) => {
    const productionDirections: ScriptProductionDirection[] = shots
      .filter((shot) => shot.elementIds.includes(element.id))
      .map(
        ({
          id,
          coverageSize,
          camera,
          movement,
          screenDirection,
          timeOfDay,
          lighting,
          location,
        }) => ({
          shotId: id,
          coverageSize,
          camera,
          movement,
          screenDirection,
          timeOfDay,
          lighting,
          location,
        }),
      );
    if (JSON.stringify(element.productionDirections ?? []) === JSON.stringify(productionDirections))
      return element;
    return {
      ...element,
      productionDirections: productionDirections.length ? productionDirections : undefined,
    };
  });
  return { ...project, script, shots };
}

/** Refresh every overlapping setup from the whole linked passage, never from just its last edit. */
export function refreshLinkedNarratives(project: Project, affectedIds?: string[], previousProject?: Project): Project {
  const shots = project.shots.map((shot) => {
    const ids = new Set(linkedScriptElementIds(project.script, shot));
    if (affectedIds && !affectedIds.some((id) => ids.has(id))) return shot;
    if (!project.script.some((element) => ids.has(element.id))) return shot;
    const narrative = narrativeForShot(project.script, shot);
    const previous = previousProject?.shots.find((item) => item.id === shot.id);
    const baseline = previous ? narrativeForShot(previousProject!.script, previous) : narrative;
    const next = { ...shot };
    for (const field of ["action", "dialogue"] as const) {
      const hasSavedDifference = previousProject && shot[field] !== baseline[field] && (previous || shot[field] !== "");
      if (!hasSavedDifference) next[field] = narrative[field];
    }
    return { ...next, events: syncCoreEvents(next) };
  });
  return { ...project, shots };
}

function sourceSignature(project: Project) {
  return JSON.stringify({
    projectId: project.id,
    script: project.script,
    coverage: project.shots.map(
      ({
        id,
        sceneId,
        elementIds,
        angleElementIds,
        coverageRole,
        coverageSize,
        camera,
        movement,
        screenDirection,
        timeOfDay,
        lighting,
        location,
      }) => ({
        id,
        sceneId,
        elementIds,
        angleElementIds,
        coverageRole,
        coverageSize,
        camera,
        movement,
        screenDirection,
        timeOfDay,
        lighting,
        location,
      }),
    ),
  });
}

export function createScriptReview(
  project: Project,
  shotId: string,
  kind: NarrativeKind,
): ScriptReview | null {
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot || new Set(project.script.map((element) => element.id)).size !== project.script.length)
    return null;
  if (shot.elementIds.some((id) => !project.script.some((element) => element.id === id)))
    return null;
  const ids = new Set(linkedScriptElementIds(project.script, shot));
  const edits = project.script
    .filter((element) => ids.has(element.id) && element.kind === kind)
    .map((element) => ({
      elementId: element.id,
      kind,
      character: element.character,
      before: element.text,
      after: element.text,
    }));
  if (!edits.length) return null;
  return { projectId: project.id, shotId, kind, sourceSignature: sourceSignature(project), edits };
}

export function applyScriptReview(project: Project, review: ScriptReview): ScriptReviewResult {
  if (project.id !== review.projectId || sourceSignature(project) !== review.sourceSignature) {
    return {
      ok: false,
      error: "The screenplay or its coverage changed. Reopen the review to edit the current beats.",
    };
  }
  const expected = createScriptReview(project, review.shotId, review.kind);
  if (
    !expected ||
    expected.edits.length !== review.edits.length ||
    new Set(review.edits.map((edit) => edit.elementId)).size !== review.edits.length
  ) {
    return { ok: false, error: "The reviewed beats no longer match this setup." };
  }
  for (const edit of review.edits) {
    const original = expected.edits.find((item) => item.elementId === edit.elementId);
    if (
      !original ||
      edit.before !== original.before ||
      edit.kind !== original.kind ||
      edit.character !== original.character ||
      typeof edit.after !== "string"
    ) {
      return { ok: false, error: "A reviewed beat does not match its exact screenplay source." };
    }
  }
  const changes = review.edits.filter((edit) => edit.before !== edit.after);
  let marks = project.marks;
  for (const edit of changes) {
    marks = reconcileMarks(
      edit.before,
      edit.after,
      marks.filter((mark) => mark.elementId === edit.elementId),
    ).concat(marks.filter((mark) => mark.elementId !== edit.elementId));
  }
  const script = project.script.map((element) => {
    const edit = changes.find((item) => item.elementId === element.id);
    return edit ? { ...element, text: edit.after } : element;
  });
  return {
    ok: true,
    project: refreshLinkedNarratives(
      { ...project, script, marks },
      changes.map((edit) => edit.elementId),
      project,
    ),
  };
}
