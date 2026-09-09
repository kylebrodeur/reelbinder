import type { Project } from "./types";
import { productionItemMetadata } from "./production-catalog";
import { parseFramePlanReviewFingerprint } from "./production-gates";
import { validateScriptCommentThreads } from "./script-comments";
import { applyPublicDemoMediaPolicy } from "./demo-media-provenance";
import { pictureAudioGain, validateTimelineAudioClips } from "./timeline-audio";
import { BINDER_TABS, CAMERA_ANGLES, CAMERA_MOVEMENTS, COVERAGE_SIZES, EVENT_KINDS, FLOOR_KINDS, LINE_COLORS, MARK_TAGS, SCREEN_DIRECTIONS, SCRIPT_KINDS, TARGETS, TIMELINE_TRACKS, TIMES_OF_DAY } from "./types";

export const MAX_PROJECT_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_ITEMS = 50_000;
type JsonRecord = Record<string, unknown>;

function invalid(path: string): never {
  throw new Error(`Invalid project snapshot at ${path}.`);
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path);
  return value as JsonRecord;
}

function text(value: unknown, path: string) {
  if (typeof value !== "string") invalid(path);
}

function number(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path);
}

function fields(value: JsonRecord, keys: string[], path: string) {
  for (const key of keys) text(value[key], `${path}.${key}`);
}

function numeric(value: JsonRecord, keys: string[], path: string) {
  for (const key of keys) number(value[key], `${path}.${key}`);
}

function choice(value: unknown, choices: readonly string[], path: string) {
  if (typeof value !== "string" || !choices.includes(value)) invalid(path);
}

function exact(value: JsonRecord, keys: readonly string[], path: string) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid(path);
}

function digest(value: unknown, path: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(path);
}

function identifier(value: unknown, path: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(path);
}

function list(value: unknown, path: string, check: (item: unknown, path: string) => void) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) invalid(path);
  value.forEach((item, index) => check(item, `${path}[${index}]`));
}

function nullableText(value: unknown, path: string) {
  if (value !== null && value !== undefined) text(value, path);
}

function point(value: unknown, path: string) {
  numeric(record(value, path), ["x", "y"], path);
}

function figure(value: unknown, path: string) {
  const item = record(value, path);
  fields(item, ["id", "name"], path);
  numeric(item, ["x", "y", "facing"], path);
}

function validateJsonTree(value: unknown) {
  let count = 0;
  const visit = (item: unknown, depth: number) => {
    if (++count > 250_000 || depth > 40) invalid("document complexity");
    if (Array.isArray(item)) {
      if (item.length > MAX_ITEMS) invalid("array length");
      item.forEach((entry) => visit(entry, depth + 1));
    } else if (item && typeof item === "object") {
      for (const [key, entry] of Object.entries(item)) {
        const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
        if (["apikey", "accesstoken", "refreshtoken", "authorization", "credentials", "password", "secret", "privatekey"].includes(normalizedKey)) {
          throw new Error("Project snapshots must not contain credential fields.");
        }
        if (["__proto__", "constructor", "prototype"].includes(key)) invalid("object key");
        if (/url$/i.test(key) && typeof entry === "string" && /^(?:javascript|vbscript|data:text\/html):?/i.test(entry.trim())) invalid("media URL");
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
}

/** Validate complete Project JSON without dropping optional revision or media metadata. */
export function validateSnapshotProject(value: unknown): Project {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return invalid("JSON"); }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_PROJECT_SNAPSHOT_BYTES) invalid("document size");
  const input: unknown = JSON.parse(serialized);
  validateJsonTree(input);
  const project = record(input, "project");
  fields(project, ["id", "name", "logline", "style"], "project");
  if (!project.id) invalid("project.id");
  number(project.updatedAt, "project.updatedAt");
  choice(project.target, TARGETS, "project.target");
  nullableText(project.cutUrl, "project.cutUrl");
  if (project.retiredDemoMedia !== undefined) list(project.retiredDemoMedia, "project.retiredDemoMedia", (value, path) => {
    fields(record(value, path), ["originalUrl", "sha256", "path", "reason"], path);
  });
  const world = record(project.world, "project.world");
  fields(world, ["place", "lighting", "ambience", "laws"], "project.world");
  nullableText(world.genesisUrl, "project.world.genesisUrl");
  list(project.characters, "project.characters", (value, path) => {
    const item = record(value, path);
    fields(item, ["name", "look"], path);
    for (const key of ["voice", "start"]) nullableText(item[key], `${path}.${key}`);
    if (item.aliases !== undefined) list(item.aliases, `${path}.aliases`, text);
  });
  list(project.script, "project.script", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "text"], path);
    choice(item.kind, SCRIPT_KINDS, `${path}.kind`);
    nullableText(item.character, `${path}.character`);
  });
  list(project.shots, "project.shots", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "title", "action", "dialogue", "location", "lighting", "notes", "setup", "veoPrompt", "runwayPrompt", "imaginePrompt", "rawSource"], path);
    numeric(item, ["number", "durationSec"], path);
    if ((item.durationSec as number) <= 0) invalid(`${path}.durationSec`);
    choice(item.camera, CAMERA_ANGLES, `${path}.camera`);
    choice(item.movement, CAMERA_MOVEMENTS, `${path}.movement`);
    choice(item.screenDirection, SCREEN_DIRECTIONS, `${path}.screenDirection`);
    choice(item.timeOfDay, TIMES_OF_DAY, `${path}.timeOfDay`);
    choice(item.coverageSize, COVERAGE_SIZES, `${path}.coverageSize`);
    choice(item.lineColor, LINE_COLORS, `${path}.lineColor`);
    choice(item.frameKind, ["storyboard", "still"], `${path}.frameKind`);
    choice(item.videoStatus, ["idle", "pending", "done", "failed"], `${path}.videoStatus`);
    for (const key of ["frameUrl", "videoUrl", "videoRequestId", "sceneId"]) nullableText(item[key], `${path}.${key}`);
    if (item.frameHistory !== undefined) list(item.frameHistory, `${path}.frameHistory`, (value, versionPath) => {
      const version = record(value, versionPath);
      if (version.composition === undefined) return;
      const composition = record(version.composition, `${versionPath}.composition`);
      let layers: JsonRecord | undefined;
      if (composition.layers !== undefined) {
        layers = record(composition.layers, `${versionPath}.composition.layers`);
        for (const key of ["guides", "wireframe", "markup", "image"]) if (typeof layers[key] !== "boolean") invalid(`${versionPath}.composition.layers.${key}`);
        number(layers.onionSkinOpacity, `${versionPath}.composition.layers.onionSkinOpacity`);
        if ((layers.onionSkinOpacity as number) < 0 || (layers.onionSkinOpacity as number) > 1) invalid(`${versionPath}.composition.layers.onionSkinOpacity`);
      }
      if (composition.reviewedPlan !== undefined) {
        if (!layers || version.kind !== "storyboard" || composition.sourceFrameUrl !== "") invalid(`${versionPath}.composition.reviewedPlan`);
        const reviewedPath = `${versionPath}.composition.reviewedPlan`;
        const reviewed = record(composition.reviewedPlan, reviewedPath);
        exact(reviewed, ["version", "projectId", "shotId", "setup", "planAssetId", "planSha256", "sourceProjectSha256", "approvalFingerprint"], reviewedPath);
        if (reviewed.version !== 1) invalid(`${reviewedPath}.version`);
        for (const key of ["projectId", "shotId", "planAssetId"]) identifier(reviewed[key], `${reviewedPath}.${key}`);
        text(reviewed.setup, `${reviewedPath}.setup`);
        if (!(reviewed.setup as string).trim()) invalid(`${reviewedPath}.setup`);
        for (const key of ["planSha256", "sourceProjectSha256"]) digest(reviewed[key], `${reviewedPath}.${key}`);
        if (composition.sourceShotId !== reviewed.shotId || composition.sourceProjectSha256 !== reviewed.sourceProjectSha256 ||
            composition.guideSha256 !== reviewed.planSha256) invalid(reviewedPath);
        if (!Array.isArray(version.references) || version.references.length !== 1) invalid(`${versionPath}.references`);
        const plan = record(version.references[0], `${versionPath}.references[0]`);
        identifier(plan.assetId, `${versionPath}.references[0].assetId`);
        digest(plan.sha256, `${versionPath}.references[0].sha256`);
        if (plan.sha256 !== reviewed.planSha256) invalid(`${reviewedPath}.planSha256`);
        const asset = record(version.asset, `${versionPath}.asset`);
        const provenance = record(asset.provenance, `${versionPath}.asset.provenance`);
        if (!Array.isArray(provenance.referenceAssetIds) || provenance.referenceAssetIds.length !== 1 ||
            provenance.referenceAssetIds[0] !== reviewed.planAssetId) invalid(`${reviewedPath}.planAssetId`);
        text(reviewed.approvalFingerprint, `${reviewedPath}.approvalFingerprint`);
        const approval = parseFramePlanReviewFingerprint(reviewed.approvalFingerprint as string);
        if (!approval || approval.projectId !== reviewed.projectId || approval.shotId !== reviewed.shotId ||
            approval.setup !== reviewed.setup || JSON.stringify(approval.layers) !== JSON.stringify(layers))
          invalid(`${reviewedPath}.approvalFingerprint`);
      }
    });
    if (item.videoHistory !== undefined) list(item.videoHistory, `${path}.videoHistory`, (value, versionPath) => {
      const version = record(value, versionPath);
      fields(version, ["id", "url"], versionPath);
      // Legacy URL-only takes need no generated-asset metadata or timestamp.
      if (version.createdAt !== undefined) number(version.createdAt, `${versionPath}.createdAt`);
      if (version.asset !== undefined) {
        const asset = record(version.asset, `${versionPath}.asset`);
        number(asset.durationSec, `${versionPath}.asset.durationSec`);
      }
    });
    list(item.characters, `${path}.characters`, text);
    list(item.elementIds, `${path}.elementIds`, text);
    list(record(item.blocking, `${path}.blocking`).figures, `${path}.blocking.figures`, figure);
    const sketch = record(item.sketch, `${path}.sketch`);
    list(sketch.strokes, `${path}.sketch.strokes`, (value, path) => {
      const stroke = record(value, path);
      fields(stroke, ["id", "color"], path);
      choice(stroke.tool, ["pencil", "eraser", "figure", "box"], `${path}.tool`);
      number(stroke.width, `${path}.width`);
      list(stroke.points, `${path}.points`, point);
    });
    list(sketch.stamps, `${path}.sketch.stamps`, (value, path) => {
      const stamp = record(value, path);
      text(stamp.id, `${path}.id`);
      choice(stamp.kind, ["figure", "box"], `${path}.kind`);
      numeric(stamp, ["x", "y", "scale"], path);
    });
    list(item.annotations, `${path}.annotations`, (value, path) => {
      const annotation = record(value, path);
      fields(annotation, ["id", "label", "color"], path);
      choice(annotation.kind, ["arrow", "box", "note"], `${path}.kind`);
      list(annotation.points, `${path}.points`, point);
    });
    list(item.events, `${path}.events`, (value, path) => {
      const event = record(value, path);
      fields(event, ["id", "target", "text"], path);
      choice(event.kind, EVENT_KINDS, `${path}.kind`);
      numeric(event, ["startSec", "endSec"], path);
    });
  });
  list(project.skills, "project.skills", (value, path) => fields(record(value, path), ["id", "title", "body"], path));
  list(project.chain, "project.chain", text);
  list(project.binder, "project.binder", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "title"], path);
    choice(item.tab, BINDER_TABS, `${path}.tab`);
    nullableText(item.url, `${path}.url`);
  });
  list(project.breakdown, "project.breakdown", (value, path) => {
    const item = record(value, path); fields(item, ["id", "department", "item"], path);
    nullableText(item.notes, `${path}.notes`); nullableText(item.sceneId, `${path}.sceneId`);
    productionItemMetadata(item);
  });
  list(project.marks, "project.marks", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "text", "note", "elementId"], path);
    choice(item.tag, MARK_TAGS, `${path}.tag`);
    numeric(item, ["start", "end"], path);
    nullableText(item.sceneId, `${path}.sceneId`);
    nullableText(item.productionItemId, `${path}.productionItemId`);
    if (item.anchorStatus !== undefined) choice(item.anchorStatus, ["missing", "ambiguous"], `${path}.anchorStatus`);
  });
  if (project.scriptCommentThreads !== undefined) validateScriptCommentThreads(project.scriptCommentThreads);
  if (project.musicAssets !== undefined) list(project.musicAssets, "project.musicAssets", (value, assetPath) => { record(value, assetPath); });
  if (project.audioClips !== undefined) validateTimelineAudioClips(project.audioClips);
  const floor = record(project.floor, "project.floor");
  text(floor.label, "project.floor.label");
  list(floor.homes, "project.floor.homes", figure);
  list(floor.path, "project.floor.path", point);
  list(floor.items, "project.floor.items", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "label"], path);
    choice(item.kind, FLOOR_KINDS, `${path}.kind`);
    if (item.locked !== undefined && typeof item.locked !== "boolean") invalid(`${path}.locked`);
    for (const key of ["productionItemId", "markId"]) if (item[key] !== undefined) {
      text(item[key], `${path}.${key}`); if (!(item[key] as string).trim()) invalid(`${path}.${key}`);
    }
    // Missing historical references remain authored data; Stage reports repair diagnostics.

    numeric(item, ["x", "y", "w", "h", "rotation"], path);
  });
  list(floor.cameras, "project.floor.cameras", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "shotId", "setup"], path);
    numeric(item, ["x", "y", "angle", "fov"], path);
    if (item.path !== undefined) list(item.path, `${path}.path`, point);
    if (item.rotationMode !== undefined) choice(item.rotationMode, ["over-time", "static", "target"], `${path}.rotationMode`);
    if (item.targetId !== undefined && item.targetId !== null) text(item.targetId, `${path}.targetId`);
  });
  list(record(project.timeline, "project.timeline").clips, "project.timeline.clips", (value, path) => {
    const item = record(value, path);
    fields(item, ["id", "shotId"], path);
    choice(item.track, TIMELINE_TRACKS, `${path}.track`);
    numeric(item, ["start", "duration"], path);
    if ((item.start as number) < 0 || (item.duration as number) <= 0) invalid(path);
    if (item.audioGain !== undefined) number(item.audioGain, `${path}.audioGain`);
    pictureAudioGain({
      audioGain: item.audioGain as number | undefined,
      audioMuted: item.audioMuted as boolean | undefined,
    });
  });
  return input as Project;
}

export function serializeProjectSnapshot(project: Project): string {
  const source = JSON.stringify({ format: "slate-project", version: 1, project: validateSnapshotProject(project) });
  if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_SNAPSHOT_BYTES) invalid("document size");
  return source;
}

function decodeProjectJson(source: string, snapshotOnly: boolean): Project {
  if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_SNAPSHOT_BYTES) invalid("document size");
  let value: unknown;
  try { value = JSON.parse(source); } catch { return invalid("JSON"); }
  const document = record(value, snapshotOnly ? "snapshot" : "project");
  if (snapshotOnly || Object.hasOwn(document, "format")) {
    if (document.format !== "slate-project" || document.version !== 1) invalid("snapshot version");
    return validateSnapshotProject(document.project);
  }
  return validateSnapshotProject(document);
}

/** Validate a complete bare Project or versioned snapshot without migrating its contents. */
export function parseProjectJson(source: string): Project {
  return decodeProjectJson(source, false);
}

export function parseProjectSnapshot(source: string): Project {
  return applyPublicDemoMediaPolicy(decodeProjectJson(source, true));
}
