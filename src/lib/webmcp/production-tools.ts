import { appendFrameVersions, localRasterUpload } from "../cinema-images.ts";
import { cameraForShot, clampFloorItemPosition, defaultItemSize, SET_KINDS } from "../floor.ts";
import { projectFingerprint } from "../preflight-guard.ts";
import { useSlate } from "../store.ts";
import { FLOOR_KINDS, type Annotation, type EditTimeline, type FloorItem, type Point, type Project, type Shot, type SketchData, type Stroke } from "../types.ts";
import { uid } from "../utils.ts";

export type ProductionToolExecution =
  | { ok: true; content: { type: "text"; text: string }[] }
  | { ok: false; error: string };
type ToolFailure = { ok: false; error: string };

const MAX_OPERATIONS = 50;
const MAX_POINTS = 500;
const ANNOTATION_KINDS = new Set(["arrow", "box", "note", "continuity"]);
const STROKE_TOOLS = new Set(["pencil", "eraser"]);

function result(value: unknown): ProductionToolExecution {
  return { ok: true, content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function fail(error: string): ToolFailure { return { ok: false, error }; }
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFailure(value: unknown): value is ToolFailure {
  return isObject(value) && value.ok === false && typeof value.error === "string";
}
function object(value: unknown, field: string): Record<string, unknown> | ToolFailure {
  return isObject(value) ? value : fail(`${field} must be an object.`);
}
function finite(value: unknown, field: string): number | ToolFailure {
  return typeof value === "number" && Number.isFinite(value) ? value : fail(`${field} must be a finite number.`);
}
function normalized(value: unknown, field: string): number | ToolFailure {
  const number = finite(value, field);
  if (typeof number !== "number") return number;
  return number >= 0 && number <= 1 ? number : fail(`${field} must be between 0 and 1.`);
}
function text(value: unknown, field: string, max = 500): string | ToolFailure {
  if (typeof value !== "string") return fail(`${field} must be a string.`);
  return value.length <= max ? value : fail(`${field} must be at most ${max} characters.`);
}
function selectedShot(args: Record<string, unknown>): { project: Project; shot: Shot; shotId: string } | ToolFailure {
  const state = useSlate.getState();
  const shotId = args.shotId === undefined ? state.selectedId : args.shotId;
  if (typeof shotId !== "string" || !shotId) return fail("shotId is required, or select a setup first.");
  const shot = state.project.shots.find((candidate) => candidate.id === shotId);
  return shot ? { project: state.project, shot, shotId } : fail(`No setup found with id "${shotId}".`);
}
function parsePoints(value: unknown, field: string): Point[] | ToolFailure {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_POINTS) return fail(`${field} must contain 1..${MAX_POINTS} points.`);
  const output: Point[] = [];
  for (const [index, raw] of value.entries()) {
    const point = object(raw, `${field}[${index}]`);
    if (isFailure(point)) return point;
    const x = normalized(point.x, `${field}[${index}].x`);
    const y = normalized(point.y, `${field}[${index}].y`);
    if (typeof x !== "number") return x;
    if (typeof y !== "number") return y;
    output.push({ x, y });
  }
  return output;
}
function readOverhead(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  return result({
    version: 1,
    projectId: project.id,
    shotId,
    floor: { label: project.floor.label, items: project.floor.items.slice(0, 500), cameras: project.floor.cameras.slice(0, 200) },
    blocking: { figures: (shot.blocking?.figures ?? []).slice(0, 100) },
    camera: cameraForShot(project.floor, shot) ?? null,
  });
}
function readFrame(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  const history = (shot.frameHistory ?? []).slice(0, 500).map((version) => ({
    id: version.id,
    kind: version.kind,
    createdAt: version.createdAt,
    active: version.url === shot.frameUrl,
    urlPresent: Boolean(version.url),
    urlLength: version.url.length,
    asset: version.asset
      ? {
          assetId: version.asset.assetId,
          mimeType: version.asset.mimeType,
          width: version.asset.width,
          height: version.asset.height,
          byteSize: version.asset.byteSize,
          sha256: version.asset.sha256,
        }
      : null,
  }));
  return result({
    version: 1,
    projectId: project.id,
    shotId,
    revision: projectFingerprint(project),
    frame: {
      frameUrlPresent: Boolean(shot.frameUrl),
      frameKind: shot.frameKind,
      frameHistoryCount: shot.frameHistory?.length ?? 0,
      history,
    },
    cast: (shot.blocking?.figures ?? []).filter((figure) => shot.characters.includes(figure.name)),
    sketch: shot.sketch,
    annotations: shot.annotations,
  });
}
function parseOperations(args: Record<string, unknown>): Record<string, unknown>[] | ToolFailure {
  if (!Array.isArray(args.operations) || args.operations.length < 1 || args.operations.length > MAX_OPERATIONS) return fail(`operations must contain 1..${MAX_OPERATIONS} items.`);
  const operations: Record<string, unknown>[] = [];
  for (const [index, raw] of args.operations.entries()) {
    const operation = object(raw, `operations[${index}]`);
    if (isFailure(operation)) return operation;
    if (typeof operation.op !== "string") return fail(`operations[${index}].op must be a string.`);
    operations.push(operation);
  }
  return operations;
}
function patchOverhead(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  const parsed = parseOperations(args);
  if (!Array.isArray(parsed)) return parsed;
  const floor = structuredClone(project.floor);
  const figures = structuredClone(shot.blocking?.figures ?? []);
  const created: string[] = [];
  const clamped: string[] = [];
  let floorChanged = false;
  let figuresChanged = false;
  for (const [index, operation] of parsed.entries()) {
    const prefix = `operations[${index}]`;
    if (operation.op === "add_item") {
      if (typeof operation.kind !== "string" || !(FLOOR_KINDS as readonly string[]).includes(operation.kind)) return fail(`${prefix}.kind is not a supported floor kind.`);
      const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
      if (typeof x !== "number") return x;
      if (typeof y !== "number") return y;
      const label = operation.label === undefined ? "" : text(operation.label, `${prefix}.label`);
      if (typeof label !== "string") return label;
      const size = defaultItemSize(operation.kind as FloorItem["kind"]);
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("fl");
      if (floor.items.some((item) => item.id === id)) return fail(`An overhead item with id "${id}" already exists.`);
      const kind = operation.kind as FloorItem["kind"];
      const position = clampFloorItemPosition({ kind, x, y, ...size });
      floor.items.push({ id, kind, ...position, ...size, rotation: 0, label, shotId: SET_KINDS.has(kind) ? null : shotId });
      if (position.x !== x || position.y !== y) clamped.push(id);
      created.push(id); floorChanged = true; continue;
    }
    if (operation.op === "remove_item") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      const item = floor.items.find((candidate) => candidate.id === operation.id);
      if (!item) return fail(`No overhead item found with id "${operation.id}".`);
      if (item.locked) return fail(`Overhead item "${operation.id}" is locked.`);
      floor.items = floor.items.filter((candidate) => candidate.id !== item.id); floorChanged = true; continue;
    }
    if (operation.op === "add_camera") {
      if (floor.cameras.some((camera) => camera.shotId === shotId)) return fail(`Setup "${shotId}" already has an overhead camera.`);
      const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
      if (typeof x !== "number") return x;
      if (typeof y !== "number") return y;
      const id = typeof operation.id === "string" && operation.id ? operation.id : `cam_${shot.setup}_${uid("c")}`;
      if (floor.cameras.some((camera) => camera.id === id)) return fail(`An overhead camera with id "${id}" already exists.`);
      floor.cameras.push({ id, shotId, setup: shot.setup, x, y, angle: -90, fov: 34 });
      created.push(id); floorChanged = true; continue;
    }
    if (operation.op === "remove_camera") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      if (!floor.cameras.some((camera) => camera.id === operation.id)) return fail(`No overhead camera found with id "${operation.id}".`);
      floor.cameras = floor.cameras.filter((camera) => camera.id !== operation.id); floorChanged = true; continue;
    }
    if (operation.op === "add_figure") {
      const name = text(operation.name, `${prefix}.name`);
      if (typeof name !== "string") return name;
      if (!shot.characters.includes(name)) return fail(`Figure name "${name}" is not in setup "${shotId}" cast.`);
      const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
      if (typeof x !== "number") return x;
      if (typeof y !== "number") return y;
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("fig");
      if (figures.some((figure) => figure.id === id)) return fail(`A figure with id "${id}" already exists.`);
      figures.push({ id, name, x, y, facing: 90 }); created.push(id); figuresChanged = true; continue;
    }
    if (operation.op === "remove_figure") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      if (!figures.some((figure) => figure.id === operation.id)) return fail(`No blocking figure found with id "${operation.id}".`);
      figures.splice(figures.findIndex((figure) => figure.id === operation.id), 1); figuresChanged = true; continue;
    }
    return fail(`Unknown overhead operation "${String(operation.op)}".`);
  }
  if (floorChanged) useSlate.getState().patchFloor(floor);
  if (figuresChanged) useSlate.getState().setBlocking(shotId, { figures });
  const readback = readOverhead({ shotId });
  if (!readback.ok) return readback;
  return result({ shotId, created, clamped, state: JSON.parse(readback.content[0].text) });
}
function patchFrame(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  const parsed = parseOperations(args);
  if (!Array.isArray(parsed)) return parsed;
  const sketch: SketchData = structuredClone(shot.sketch);
  const annotations: Annotation[] = structuredClone(shot.annotations);
  const created: string[] = [];
  const placedIds: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  let sketchChanged = false;
  let annotationsChanged = false;
  for (const [index, operation] of parsed.entries()) {
    const prefix = `operations[${index}]`;
    if (operation.op === "place_item") {
      if (operation.kind !== "cast" && operation.kind !== "prop" && operation.kind !== "architecture") {
        return fail(`${prefix}.kind must be cast, prop, or architecture.`);
      }
      if (operation.kind === "cast") {
        const figureId = text(operation.figureId, `${prefix}.figureId`);
        if (typeof figureId !== "string") return figureId;
        const figure = (shot.blocking?.figures ?? []).find((candidate) => candidate.id === figureId);
        if (!figure || !shot.characters.includes(figure.name)) {
          return fail(`No frame-cast figure found with id "${figureId}".`);
        }
        const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
        if (typeof x !== "number") return x;
        if (typeof y !== "number") return y;
        const existing = sketch.stamps.find((stamp) => stamp.figureId === figureId);
        const id = existing?.id ?? `st_${figureId}`;
        const placed = {
          id,
          kind: "figure" as const,
          figureId,
          x,
          y,
          scale: existing?.scale ?? 1,
          ...(existing?.label ? { label: existing.label } : {}),
        };
        if (existing) {
          sketch.stamps = sketch.stamps.map((stamp) => (stamp.id === existing.id ? placed : stamp));
          updated.push(id);
        } else {
          sketch.stamps.push(placed);
          created.push(id);
        }
        placedIds.push(id); sketchChanged = true; continue;
      }
      if (operation.kind === "prop") {
        const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
        if (typeof x !== "number") return x;
        if (typeof y !== "number") return y;
        const label = operation.label === undefined ? "" : text(operation.label, `${prefix}.label`);
        if (typeof label !== "string") return label;
        const id = typeof operation.id === "string" && operation.id ? operation.id : uid("st");
        if (sketch.stamps.some((stamp) => stamp.id === id)) return fail(`A frame stamp with id "${id}" already exists.`);
        sketch.stamps.push({ id, kind: "box", x, y, scale: 1, ...(label ? { label } : {}) });
        created.push(id); sketchChanged = true; continue;
      }
      const architecturePoints = parsePoints(operation.points, `${prefix}.points`);
      if (!Array.isArray(architecturePoints)) return architecturePoints;
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("sk");
      if (sketch.strokes.some((stroke) => stroke.id === id)) return fail(`A frame stroke with id "${id}" already exists.`);
      sketch.strokes.push({ id, tool: "pencil", points: architecturePoints, color: "#2a2722", width: 2.4 });
      created.push(id); sketchChanged = true; continue;
    }
    if (operation.op === "remove_item") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      const stamp = sketch.stamps.find((candidate) => candidate.id === operation.id);
      const stroke = sketch.strokes.find((candidate) => candidate.id === operation.id);
      const annotation = annotations.find((candidate) => candidate.id === operation.id);
      if (!stamp && !stroke && !annotation) return fail(`No frame item found with id "${operation.id}".`);
      if (stamp) sketch.stamps = sketch.stamps.filter((candidate) => candidate.id !== stamp.id);
      if (stroke) sketch.strokes = sketch.strokes.filter((candidate) => candidate.id !== stroke.id);
      if (annotation) annotations.splice(annotations.findIndex((candidate) => candidate.id === annotation.id), 1);
      removed.push(operation.id); sketchChanged ||= Boolean(stamp || stroke); annotationsChanged ||= Boolean(annotation); continue;
    }
    if (operation.op === "add_stamp") {
      if (operation.kind !== "figure" && operation.kind !== "box") return fail(`${prefix}.kind must be figure or box.`);
      const x = normalized(operation.x, `${prefix}.x`), y = normalized(operation.y, `${prefix}.y`);
      if (typeof x !== "number") return x;
      if (typeof y !== "number") return y;
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("st");
      if (sketch.stamps.some((stamp) => stamp.id === id)) return fail(`A frame stamp with id "${id}" already exists.`);
      const figureId = operation.figureId === undefined ? undefined : text(operation.figureId, `${prefix}.figureId`);
      if (typeof figureId !== "undefined" && typeof figureId !== "string") return figureId;
      if (operation.kind === "figure" && figureId && !(shot.blocking?.figures ?? []).some((figure) => figure.id === figureId)) return fail(`No blocking figure found with id "${figureId}".`);
      sketch.stamps.push({ id, kind: operation.kind, x, y, scale: 1, ...(figureId ? { figureId } : {}) }); created.push(id); sketchChanged = true; continue;
    }
    if (operation.op === "remove_stamp") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      if (!sketch.stamps.some((stamp) => stamp.id === operation.id)) return fail(`No frame stamp found with id "${operation.id}".`);
      sketch.stamps = sketch.stamps.filter((stamp) => stamp.id !== operation.id); sketchChanged = true; continue;
    }
    if (operation.op === "add_stroke") {
      const strokePoints = parsePoints(operation.points, `${prefix}.points`);
      if (!Array.isArray(strokePoints)) return strokePoints;
      if (typeof operation.tool !== "string" || !STROKE_TOOLS.has(operation.tool)) return fail(`${prefix}.tool must be pencil or eraser.`);
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("sk");
      sketch.strokes.push({ id, tool: operation.tool as Stroke["tool"], points: strokePoints, color: operation.tool === "eraser" ? "rgba(0,0,0,1)" : "#2a2722", width: operation.tool === "eraser" ? 22 : 2.4 });
      created.push(id); sketchChanged = true; continue;
    }
    if (operation.op === "remove_stroke") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      if (!sketch.strokes.some((stroke) => stroke.id === operation.id)) return fail(`No frame stroke found with id "${operation.id}".`);
      sketch.strokes = sketch.strokes.filter((stroke) => stroke.id !== operation.id); sketchChanged = true; continue;
    }
    if (operation.op === "add_annotation") {
      if (typeof operation.kind !== "string" || !ANNOTATION_KINDS.has(operation.kind)) return fail(`${prefix}.kind is not a supported annotation kind.`);
      const annotationPoints = parsePoints(operation.points, `${prefix}.points`);
      if (!Array.isArray(annotationPoints)) return annotationPoints;
      const id = typeof operation.id === "string" && operation.id ? operation.id : uid("ann");
      annotations.push({ id, kind: operation.kind as Annotation["kind"], points: annotationPoints, label: typeof operation.label === "string" ? operation.label : "", color: typeof operation.color === "string" ? operation.color : "#c45c4e" });
      created.push(id); annotationsChanged = true; continue;
    }
    if (operation.op === "remove_annotation") {
      if (typeof operation.id !== "string" || !operation.id) return fail(`${prefix}.id must be a string.`);
      if (!annotations.some((annotation) => annotation.id === operation.id)) return fail(`No frame annotation found with id "${operation.id}".`);
      annotations.splice(annotations.findIndex((annotation) => annotation.id === operation.id), 1); annotationsChanged = true; continue;
    }
    return fail(`Unknown frame operation "${String(operation.op)}".`);
  }
  if (sketchChanged) useSlate.getState().setSketch(shotId, sketch);
  if (annotationsChanged) useSlate.getState().setAnnotations(shotId, annotations);
  const readback = readFrame({ shotId });
  if (!readback.ok) return readback;
  return result({ shotId, created, placed: placedIds, updated, removed, state: JSON.parse(readback.content[0].text) });
}
function stringArray(value: unknown, field: string, max = 500, allowEmpty = true): string[] | ToolFailure {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > max || !value.every((item) => typeof item === "string" && item.length > 0)) {
    return fail(`${field} must contain ${allowEmpty ? "0" : "1"}..${max} non-empty strings.`);
  }
  if (new Set(value).size !== value.length) return fail(`${field} must not contain duplicate ids.`);
  return value;
}

function guardProject(args: Record<string, unknown>, project: Project): ToolFailure | null {
  if (args.expectedProjectId !== project.id) return fail("expectedProjectId does not match the current project.");
  if (args.expectedRevision !== projectFingerprint(project)) return fail("The project changed since this operation was prepared. Read the current state and retry.");
  return null;
}

function readCut(): ProductionToolExecution {
  const project = useSlate.getState().project;
  const pictureClips = project.timeline.clips
    .filter((clip) => clip.track === "picture")
    .slice()
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return result({
    version: 1,
    projectId: project.id,
    revision: projectFingerprint(project),
    timelineInitialized: Boolean(project.timeline.initialized),
    shots: project.shots.slice(0, 500).map((shot) => ({
      id: shot.id,
      number: shot.number,
      setup: shot.setup,
      title: shot.title,
      durationSec: shot.durationSec,
    })),
    pictureClipIds: pictureClips.map((clip) => clip.id),
    pictureClips: pictureClips.slice(0, 500),
    nonPictureClipCount: project.timeline.clips.filter((clip) => clip.track !== "picture").length,
  });
}

function syncShotTimeline(args: Record<string, unknown>): ProductionToolExecution {
  const project = useSlate.getState().project;
  const guard = guardProject(args, project);
  if (guard) return guard;
  const expected = stringArray(args.expectedPictureClipIds, "expectedPictureClipIds", 500, false);
  if (!Array.isArray(expected)) return expected;
  const ordered = stringArray(args.orderedPictureClipIds, "orderedPictureClipIds");
  if (!Array.isArray(ordered)) return ordered;
  const picture = project.timeline.clips
    .filter((clip) => clip.track === "picture")
    .slice()
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const currentIds = picture.map((clip) => clip.id);
  if (JSON.stringify(currentIds) !== JSON.stringify(expected)) {
    return fail("The picture timeline changed since it was read. Read get_cut_state again and retry.");
  }
  const byId = new Map(picture.map((clip) => [clip.id, clip]));
  if (ordered.some((id) => !byId.has(id))) return fail("orderedPictureClipIds must reference current picture clips only.");
  const duration = ordered.reduce((total, id) => total + Math.max(0, byId.get(id)!.duration), 0);
  let start = 0;
  const nextPicture = ordered.map((id) => {
    const clip = byId.get(id)!;
    const next = { ...clip, start };
    start += Math.max(0, clip.duration);
    return next;
  });
  const nextClips: typeof project.timeline.clips = [];
  let pictureIndex = 0;
  for (const clip of project.timeline.clips) {
    if (clip.track !== "picture") nextClips.push(clip);
    else if (pictureIndex < nextPicture.length) nextClips.push(nextPicture[pictureIndex++]);
  }
  const removedClipIds = currentIds.filter((id) => !ordered.includes(id));
  useSlate.getState().syncTimeline({ ...project.timeline, clips: nextClips, initialized: true });
  const readback = readCut();
  if (!readback.ok) return readback;
  return result({ changed: JSON.stringify(currentIds) !== JSON.stringify(ordered), removedClipIds, duration, state: JSON.parse(readback.content[0].text) });
}

function patchFrameHistory(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  const guard = guardProject(args, project);
  if (guard) return guard;
  const expected = stringArray(args.expectedHistoryIds, "expectedHistoryIds");
  if (!Array.isArray(expected)) return expected;
  const currentHistory = shot.frameHistory ?? [];
  if (JSON.stringify(currentHistory.map((version) => version.id)) !== JSON.stringify(expected)) {
    return fail("Frame history changed since it was read. Read get_frame_state again and retry.");
  }
  const removeIds = stringArray(args.removeIds, "removeIds", 500, false);
  if (!Array.isArray(removeIds)) return removeIds;
  const removeSet = new Set(removeIds);
  const missing = removeIds.filter((id) => !currentHistory.some((version) => version.id === id));
  if (missing.length) return fail(`Unknown frame history ids: ${missing.join(", ")}.`);
  if (currentHistory.some((version) => removeSet.has(version.id) && version.url === shot.frameUrl)) {
    return fail("The active frame cannot be removed from history.");
  }
  const nextHistory = currentHistory.filter((version) => !removeSet.has(version.id));
  useSlate.getState().setFrameWithHistory(shotId, shot.frameUrl, shot.frameKind, nextHistory);
  const readback = readFrame({ shotId });
  if (!readback.ok) return readback;
  return result({ shotId, removedIds: removeIds, state: JSON.parse(readback.content[0].text) });
}

function importStill(args: Record<string, unknown>): ProductionToolExecution {
  const selected = selectedShot(args);
  if (isFailure(selected)) return selected;
  const { project, shot, shotId } = selected;
  const guard = guardProject(args, project);
  if (guard) return guard;
  const setup = text(args.setup, "setup");
  if (typeof setup !== "string") return setup;
  if (setup !== shot.setup) return fail(`setup must match shot "${shotId}" exactly.`);
  const dataUrl = text(args.dataUrl, "dataUrl", 1_500_000);
  if (typeof dataUrl !== "string") return dataUrl;
  try {
    localRasterUpload(dataUrl);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "dataUrl is not a supported local raster image.");
  }
  const expectedFrameUrl = args.expectedFrameUrl;
  if (expectedFrameUrl !== shot.frameUrl) return fail("expectedFrameUrl does not match the current frame.");
  const expectedHistory = stringArray(args.expectedHistoryIds, "expectedHistoryIds");
  if (!Array.isArray(expectedHistory)) return expectedHistory;
  const currentHistory = shot.frameHistory ?? [];
  if (JSON.stringify(currentHistory.map((version) => version.id)) !== JSON.stringify(expectedHistory)) {
    return fail("Frame history changed since it was read. Read get_frame_state again and retry.");
  }
  const now = Date.now();
  const history = appendFrameVersions(shot, [], "still", now);
  history.push({ id: uid("frame"), url: dataUrl, kind: "still", createdAt: now });
  useSlate.getState().setFrameWithHistory(shotId, dataUrl, "still", history);
  const readback = readFrame({ shotId });
  if (!readback.ok) return readback;
  return result({ shotId, imported: true, state: JSON.parse(readback.content[0].text) });
}

export function executeProductionTool(name: string, args: Record<string, unknown>): ProductionToolExecution {
  switch (name) {
    case "get_overhead_state": return readOverhead(args);
    case "patch_overhead": return patchOverhead(args);
    case "get_frame_state": return readFrame(args);
    case "patch_frame": return patchFrame(args);
    case "get_cut_state": return readCut();
    case "sync_shot_timeline": return syncShotTimeline(args);
    case "patch_frame_history": return patchFrameHistory(args);
    case "import_still": return importStill(args);
    default: return fail(`Unknown production tool "${name}".`);
  }
}
