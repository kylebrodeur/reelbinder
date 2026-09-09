import type { FrameLayerSettings } from "./frame-renderer";
import { sha256Hex } from "./sha256.ts";
import type { Project, Shot } from "./types";

export type ProductionGateCode =
  | "missing-shot"
  | "missing-overhead"
  | "missing-floor-label"
  | "missing-floor-items"
  | "invalid-floor-items"
  | "missing-floor-homes"
  | "missing-shot-camera"
  | "invalid-shot-camera"
  | "invalid-camera-target"
  | "invalid-camera-cone"
  | "missing-setup"
  | "missing-blocking"
  | "unnamed-blocking"
  | "unlinked-frame-plan"
  | "missing-plan-capture"
  | "stale-plan-capture"
  | "missing-selected-storyboard"
  | "missing-selected-photoreal"
  | "missing-plan-provenance"
  | "stale-plan-provenance"
  | "missing-storyboard-ancestor"
  | "missing-plan-review"
  | "missing-placement-review"
  | "missing-image-review"
  | "missing-video-review";

export interface ProductionGateIssue {
  code: ProductionGateCode;
  message: string;
}

export interface ProductionGateReport {
  ready: boolean;
  issues: ProductionGateIssue[];
}

function report(issues: ProductionGateIssue[]): ProductionGateReport {
  return { ready: issues.length === 0, issues };
}

function issue(code: ProductionGateCode, message: string): ProductionGateIssue {
  return { code, message };
}

function shotFor(project: Project, shotId: string): Shot | undefined {
  return project.shots.find((candidate) => candidate.id === shotId);
}

const STRUCTURAL_FLOOR_KINDS = new Set(["wall", "bar", "door", "window", "well"]);
const CORNER_ORIGIN_FLOOR_KINDS = new Set(["wall", "bar", "door", "window"]);
const REVIEWED_PLAN_KEYS = [
  "version",
  "projectId",
  "shotId",
  "setup",
  "planAssetId",
  "planSha256",
  "sourceProjectSha256",
  "approvalFingerprint",
] as const;
const MEDIA_SHOT_KEYS = [
  "frameUrl",
  "frameKind",
  "frameHistory",
  "videoUrl",
  "videoHistory",
  "videoRequestId",
  "videoStatus",
] as const;
const EDIT_ONLY_PROJECT_KEYS = ["cutUrl", "musicAssets", "audioClips", "timeline"] as const;
const LEGACY_PLAN_FINGERPRINT_KEYS = ["kind", "project", "shotId", "extra"] as const;
const COMPACT_PLAN_FINGERPRINT_KEYS = [
  "kind",
  "version",
  "projectId",
  "shotId",
  "setup",
  "layers",
  "sha256",
] as const;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && actual.every((key) => allowed.has(key));
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function finiteNormalized(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function frameLayers(value: unknown): value is FrameLayerSettings {
  return object(value) && exactKeys(value, ["guides", "wireframe", "markup", "image", "onionSkinOpacity"]) &&
    ["guides", "wireframe", "markup", "image"].every((key) => typeof value[key] === "boolean") &&
    finiteNormalized(value.onionSkinOpacity);
}

function validFloorItem(value: Project["floor"]["items"][number]): boolean {
  if (!value.id.trim() || !value.label.trim() || !finiteNormalized(value.x) || !finiteNormalized(value.y) ||
      !Number.isFinite(value.w) || value.w <= 0 || !Number.isFinite(value.h) || value.h <= 0 ||
      !Number.isFinite(value.rotation)) return false;
  const cornerOrigin = CORNER_ORIGIN_FLOOR_KINDS.has(value.kind);
  const left = cornerOrigin ? value.x : value.x - value.w / 2;
  const right = cornerOrigin ? value.x + value.w : value.x + value.w / 2;
  const top = cornerOrigin ? value.y : value.y - value.h / 2;
  const bottom = cornerOrigin ? value.y + value.h : value.y + value.h / 2;
  return left >= 0 && right <= 1 && top >= 0 && bottom <= 1;
}

function relativeBearing(
  camera: Project["floor"]["cameras"][number],
  target: { x: number; y: number },
): number {
  const bearing = Math.atan2((target.y - camera.y) * 90, (target.x - camera.x) * 160) * 180 / Math.PI;
  let relative = ((bearing - camera.angle + 180) % 360) - 180;
  if (relative < -180) relative += 360;
  return relative;
}

function legacyPlanReviewProject(project: Project): Record<string, unknown> {
  const source = structuredClone(project) as unknown as Record<string, unknown>;
  Reflect.deleteProperty(source, "updatedAt");
  const shots = source.shots;
  if (Array.isArray(shots)) for (const value of shots) {
    if (!object(value)) continue;
    for (const key of MEDIA_SHOT_KEYS) Reflect.deleteProperty(value, key);
  }
  return source;
}

/** Keep Stage/script authorship while excluding downstream Edit, mix, render, and generated-media state. */
function planReviewProject(project: Project): unknown {
  const source = legacyPlanReviewProject(project);
  for (const key of EDIT_ONLY_PROJECT_KEYS) Reflect.deleteProperty(source, key);
  return source;
}

function planReviewPayload(project: Project, shotId: string, layers: FrameLayerSettings): string {
  return JSON.stringify({ kind: "overhead-plan-review", project: planReviewProject(project), shotId, extra: layers });
}

function legacyPlanReviewPayload(project: Project, shotId: string, layers: FrameLayerSettings): string {
  return JSON.stringify({ kind: "overhead-plan-review", project: legacyPlanReviewProject(project), shotId, extra: layers });
}

export interface ParsedFramePlanReviewFingerprint {
  version: 1 | 2 | 3;
  projectId: string;
  shotId: string;
  setup: string;
  layers: FrameLayerSettings;
}

/** Parse both compact approvals and version-1 snapshots that embedded the full authored Project. */
export function parseFramePlanReviewFingerprint(value: string): ParsedFramePlanReviewFingerprint | null {
  if (typeof value !== "string" || value.length > 8 * 1024 * 1024) return null;
  let approval: unknown;
  try { approval = JSON.parse(value); } catch { return null; }
  if (!object(approval) || JSON.stringify(approval) !== value || approval.kind !== "overhead-plan-review") return null;

  if (approval.version === 2 || approval.version === 3) {
    if (!exactKeys(approval, COMPACT_PLAN_FINGERPRINT_KEYS) || !identifier(approval.projectId) ||
        !identifier(approval.shotId) || typeof approval.setup !== "string" || !approval.setup.trim() ||
        !frameLayers(approval.layers) || !digest(approval.sha256)) return null;
    return {
      version: approval.version,
      projectId: approval.projectId,
      shotId: approval.shotId,
      setup: approval.setup,
      layers: approval.layers,
    };
  }

  if (!exactKeys(approval, LEGACY_PLAN_FINGERPRINT_KEYS) || !identifier(approval.shotId) ||
      !object(approval.project) || !identifier(approval.project.id) || !frameLayers(approval.extra)) return null;
  const approvedShots = approval.project.shots;
  const approvedShot = Array.isArray(approvedShots)
    ? approvedShots.find((candidate) => object(candidate) && candidate.id === approval.shotId)
    : undefined;
  if (!object(approvedShot) || typeof approvedShot.setup !== "string" || !approvedShot.setup.trim()) return null;
  return {
    version: 1,
    projectId: approval.project.id,
    shotId: approval.shotId,
    setup: approvedShot.setup,
    layers: approval.extra,
  };
}

/**
 * A Stage setup is generation-ready only when its authored room, camera,
 * blocking and Frame marks all point at the same named setup. This is generic:
 * no cast names, setup numbers, or project-specific geometry live here.
 */
export function stageReadiness(project: Project, shotId: string): ProductionGateReport {
  const issues: ProductionGateIssue[] = [];
  const shot = shotFor(project, shotId);
  if (!shot) return report([issue("missing-shot", "Select an existing setup before generation.")]);

  const hasOverhead = project.binder.some(
    (asset) => asset.tab === "diagrams" && typeof asset.url === "string" && asset.url.trim(),
  );
  if (!hasOverhead)
    issues.push(issue("missing-overhead", "Attach the source overhead diagram in the binder before reviewing this setup."));
  if (!project.floor.label.trim())
    issues.push(issue("missing-floor-label", "Name the Stage floor plan so its source setup is identifiable."));
  const structuralItems = project.floor.items.filter((item) => STRUCTURAL_FLOOR_KINDS.has(item.kind));
  if (!structuralItems.length)
    issues.push(issue("missing-floor-items", "Draw structural room geography on the Stage floor plan."));
  else if (project.floor.items.some((item) => !validFloorItem(item)))
    issues.push(issue("invalid-floor-items", "Give every Stage item a named, finite, positive-size position inside the floor plan."));
  if (!project.floor.homes.length || project.floor.homes.some((home) => !home.id.trim() || !home.name.trim() ||
      !finiteNormalized(home.x) || !finiteNormalized(home.y) || !Number.isFinite(home.facing)))
    issues.push(issue("missing-floor-homes", "Add named cast home positions to the Stage floor plan."));

  const camera = project.floor.cameras.find((candidate) => candidate.shotId === shot.id);
  if (!camera) {
    issues.push(issue("missing-shot-camera", "Place a camera for this setup on the Stage floor plan."));
  } else {
    const cameraValid = !!camera.id.trim() && camera.setup === shot.setup && finiteNormalized(camera.x) &&
      finiteNormalized(camera.y) && Number.isFinite(camera.angle) && Number.isFinite(camera.fov) &&
      camera.fov > 0 && camera.fov <= 180;
    if (!cameraValid)
      issues.push(issue("invalid-shot-camera", "Use a finite in-room camera linked to this exact setup with a valid view cone."));
    const targetId = typeof camera.targetId === "string" ? camera.targetId.trim() : "";
    const target = targetId
      ? shot.blocking?.figures.find((figure) => figure.id === targetId) ?? project.floor.items.find((item) => item.id === targetId)
      : undefined;
    const targetValid = !!target && finiteNormalized(target.x) && finiteNormalized(target.y) &&
      Math.hypot(target.x - camera.x, target.y - camera.y) > 1e-6;
    if (!targetId || !targetValid) {
      issues.push(issue("invalid-camera-target", "Aim this setup's camera at a resolved, non-coincident Stage figure or room item."));
    } else if (cameraValid && Math.abs(relativeBearing(camera, target)) > camera.fov / 2 + 1e-9) {
      issues.push(issue("invalid-camera-cone", "Keep the authored camera target inside this setup's view cone."));
    }
  }
  if (!shot.setup.trim())
    issues.push(issue("missing-setup", "Give this shot an authored setup identifier."));

  const blocking = shot.blocking?.figures ?? [];
  if (!blocking.length) {
    issues.push(issue("missing-blocking", "Place the setup's cast on the Stage floor plan."));
  } else if (blocking.some((figure) => !figure.id.trim() || !figure.name.trim() || !finiteNormalized(figure.x) ||
      !finiteNormalized(figure.y) || !Number.isFinite(figure.facing)) || new Set(blocking.map((figure) => figure.id)).size !== blocking.length) {
    issues.push(issue("unnamed-blocking", "Every blocked figure must have a stable ID and visible name."));
  }

  const blockingById = new Map(blocking.map((figure) => [figure.id, figure]));
  const visibleFigures = shot.sketch?.stamps?.filter((stamp) => stamp.kind === "figure") ?? [];
  if (!visibleFigures.length || visibleFigures.some((stamp) => {
    const figure = stamp.figureId ? blockingById.get(stamp.figureId) : undefined;
    return !figure?.name.trim() || !shot.characters.includes(figure.name);
  })) issues.push(issue("unlinked-frame-plan", "Link every visible Frame figure through named setup blocking and the shot's cast identity."));

  return report(issues);
}

function fingerprint(kind: string, project: Project, shotId: string, extra?: unknown): string {
  return JSON.stringify({ kind, project, shotId, extra });
}

/** Exact review identity; any authored Project, shot, or visible-layer edit changes it. */
export function framePlanReviewFingerprint(
  project: Project,
  shotId: string,
  layers: FrameLayerSettings,
): string {
  const shot = shotFor(project, shotId);
  const payload = planReviewPayload(project, shotId, layers);
  return JSON.stringify({
    kind: "overhead-plan-review",
    version: 3,
    projectId: project.id,
    shotId,
    setup: shot?.setup ?? "",
    layers,
    sha256: sha256Hex(payload),
  });
}

function legacyCompactPlanReviewFingerprint(
  project: Project,
  shotId: string,
  layers: FrameLayerSettings,
): string {
  const shot = shotFor(project, shotId);
  return JSON.stringify({
    kind: "overhead-plan-review",
    version: 2,
    projectId: project.id,
    shotId,
    setup: shot?.setup ?? "",
    layers,
    sha256: sha256Hex(legacyPlanReviewPayload(project, shotId, layers)),
  });
}

function legacyCompactPlanReviewFingerprintMatches(
  value: string,
  project: Project,
  shotId: string,
  layers: FrameLayerSettings,
): boolean {
  if (value === legacyCompactPlanReviewFingerprint(project, shotId, layers)) return true;
  const emptyEdit = structuredClone(project);
  emptyEdit.timeline = { initialized: false, clips: [] };
  if (value === legacyCompactPlanReviewFingerprint(emptyEdit, shotId, layers)) return true;
  emptyEdit.timeline = { clips: [] };
  return value === legacyCompactPlanReviewFingerprint(emptyEdit, shotId, layers);
}

/** Compare current authored state while retaining compatibility with legacy embedded approvals. */
export function framePlanReviewFingerprintMatches(
  value: string,
  project: Project,
  shotId: string,
  layers: FrameLayerSettings,
): boolean {
  const parsed = parseFramePlanReviewFingerprint(value);
  const shot = shotFor(project, shotId);
  if (!parsed || !shot || parsed.projectId !== project.id || parsed.shotId !== shotId ||
      parsed.setup !== shot.setup || JSON.stringify(parsed.layers) !== JSON.stringify(layers)) return false;
  if (parsed.version === 1) {
    const approval = JSON.parse(value) as { project: Project };
    return JSON.stringify(planReviewProject(approval.project)) === JSON.stringify(planReviewProject(project));
  }
  if (parsed.version === 2)
    return legacyCompactPlanReviewFingerprintMatches(value, project, shotId, layers);
  return value === framePlanReviewFingerprint(project, shotId, layers);
}

export interface PlanGuideIdentity {
  captureKind?: "plan" | "still-overlay";
  layers?: FrameLayerSettings;
  sourceFingerprint: string;
  sourceFrameUrl: string;
  shotId: string;
}

export function storyboardReadiness(
  project: Project,
  shotId: string,
  guide: PlanGuideIdentity | null,
  reviewedFingerprint: string | null,
): ProductionGateReport {
  const stage = stageReadiness(project, shotId);
  if (!stage.ready) return stage;
  if (!guide || guide.captureKind !== "plan" || !guide.layers)
    return report([issue("missing-plan-capture", "Capture the current Frame plan locally before creating a storyboard.")]);
  if (guide.shotId !== shotId || guide.sourceFrameUrl !== "" || guide.sourceFingerprint !== JSON.stringify(project))
    return report([issue("stale-plan-capture", "The Project or setup changed after plan capture. Capture and review it again.")]);
  const expected = framePlanReviewFingerprint(project, shotId, guide.layers);
  if (reviewedFingerprint !== expected)
    return report([issue("missing-plan-review", "Confirm that the captured Frame plan matches the source overhead before creating a storyboard.")]);
  return report([]);
}

function selectedVersion(shot: Shot) {
  return shot.frameHistory?.find((version) => version.url === shot.frameUrl);
}

function isGeneratedAsset(version: NonNullable<Shot["frameHistory"]>[number] | undefined): boolean {
  return version?.asset?.provenance.origin === "generated";
}

type FrameVersion = NonNullable<Shot["frameHistory"]>[number];
type ReviewedPlanState = "missing" | "stale" | "current";

function reviewedPlanState(version: FrameVersion | undefined, project?: Project): ReviewedPlanState {
  const composition = version?.composition;
  const reviewed = composition?.reviewedPlan;
  const references = version?.references;
  const referenceIds = version?.asset?.provenance.referenceAssetIds;
  if (!version || version.kind !== "storyboard" || !isGeneratedAsset(version) || !composition || !object(reviewed) ||
      !exactKeys(reviewed, REVIEWED_PLAN_KEYS) || reviewed.version !== 1 || !identifier(reviewed.projectId) ||
      !identifier(reviewed.shotId) || typeof reviewed.setup !== "string" || !reviewed.setup.trim() ||
      !identifier(reviewed.planAssetId) || !digest(reviewed.planSha256) || !digest(reviewed.sourceProjectSha256) ||
      typeof reviewed.approvalFingerprint !== "string" || reviewed.approvalFingerprint.length > 8 * 1024 * 1024 ||
      composition.sourceFrameUrl !== "" || composition.sourceShotId !== reviewed.shotId ||
      composition.sourceProjectSha256 !== reviewed.sourceProjectSha256 || composition.guideSha256 !== reviewed.planSha256 ||
      !composition.layers || !Array.isArray(references) || references.length !== 1 ||
      references[0]?.sha256 !== reviewed.planSha256 ||
      !Array.isArray(referenceIds) || referenceIds.length !== 1 || referenceIds[0] !== reviewed.planAssetId)
    return "missing";
  const approval = parseFramePlanReviewFingerprint(reviewed.approvalFingerprint);
  if (!approval || approval.projectId !== reviewed.projectId || approval.shotId !== reviewed.shotId ||
      approval.setup !== reviewed.setup || JSON.stringify(approval.layers) !== JSON.stringify(composition.layers)) return "missing";
  if (!project) return "current";
  return project.id === reviewed.projectId && shotFor(project, reviewed.shotId)?.setup === reviewed.setup &&
    framePlanReviewFingerprintMatches(reviewed.approvalFingerprint, project, reviewed.shotId, composition.layers)
    ? "current" : "stale";
}

function reviewedPlanIssue(state: ReviewedPlanState): ProductionGateIssue | null {
  if (state === "missing") return issue("missing-plan-provenance", "The selected storyboard is not descended from a persisted, reviewed Frame plan.");
  if (state === "stale") return issue("stale-plan-provenance", "The Stage or authored setup changed after this storyboard's plan approval. Capture and review a current plan.");
  return null;
}

/** Exact identity for the selected generated storyboard being approved for placement. */
export function photorealPlacementFingerprint(project: Project, shotId: string): string | null {
  const shot = shotFor(project, shotId);
  const selected = shot ? selectedVersion(shot) : undefined;
  if (
    !shot ||
    shot.frameKind !== "storyboard" ||
    selected?.kind !== "storyboard" ||
    !selected.asset?.assetId ||
    !isGeneratedAsset(selected) || reviewedPlanState(selected, project) !== "current"
  )
    return null;
  return fingerprint("storyboard-placement-review", project, shotId, selected.asset.assetId);
}

export function photorealReadiness(
  project: Project,
  shotId: string,
  reviewedFingerprint: string | null,
): ProductionGateReport {
  const stage = stageReadiness(project, shotId);
  if (!stage.ready) return stage;
  const shot = shotFor(project, shotId);
  const expected = photorealPlacementFingerprint(project, shotId);
  if (!shot || shot.frameKind !== "storyboard" || selectedVersion(shot)?.kind !== "storyboard" || !isGeneratedAsset(selectedVersion(shot)))
    return report([issue("missing-selected-storyboard", "Select a generated storyboard from Frame history before creating a photoreal still.")]);
  const planState = reviewedPlanState(selectedVersion(shot), project);
  const planIssue = reviewedPlanIssue(planState);
  if (planIssue) return report([planIssue]);
  if (!expected)
    return report([issue("missing-plan-provenance", "The selected storyboard is not descended from a persisted, reviewed Frame plan.")]);
  if (reviewedFingerprint !== expected)
    return report([issue("missing-placement-review", "Review the selected storyboard placement against the overhead before creating a photoreal still.")]);
  return report([]);
}

export function storyboardAncestry(shot: Shot, project?: Project): ProductionGateReport {
  const selected = selectedVersion(shot);
  if (
    !shot.frameUrl ||
    shot.frameKind !== "still" ||
    selected?.kind !== "still" ||
    !selected.asset?.assetId ||
    !isGeneratedAsset(selected)
  )
    return report([issue("missing-selected-photoreal", "Select a generated photoreal still before creating video.")]);

  const history = shot.frameHistory ?? [];
  const byAssetId = new Map(
    history
      .filter((version) => !!version.asset?.assetId)
      .map((version) => [version.asset!.assetId, version]),
  );
  const pending = Array.isArray(selected.asset.provenance.referenceAssetIds)
    ? selected.asset.provenance.referenceAssetIds.filter((value): value is string => typeof value === "string")
    : [];
  const visited = new Set<string>();
  let planState: ReviewedPlanState | null = null;
  while (pending.length && planState === null) {
    const assetId = pending.pop()!;
    if (visited.has(assetId)) continue;
    visited.add(assetId);
    const version = byAssetId.get(assetId);
    if (!version || !isGeneratedAsset(version)) continue;
    if (version.kind === "storyboard") {
      planState = reviewedPlanState(version, project);
      break;
    }
    const parents = version.asset?.provenance.referenceAssetIds;
    if (Array.isArray(parents))
      pending.push(...parents.filter((value): value is string => typeof value === "string"));
  }
  if (planState) {
    const planIssue = reviewedPlanIssue(planState);
    return planIssue ? report([planIssue]) : report([]);
  }
  return report([issue("missing-storyboard-ancestor", "The selected still has no verified storyboard ancestor in Frame history.")]);
}

/** Exact review identity for a paid edit using one currently selected still as its source. */
export function imageEditReviewFingerprint(project: Project, shotId: string, sourceShotId: string): string | null {
  const target = shotFor(project, shotId);
  const source = shotFor(project, sourceShotId);
  if (!target || !source?.frameUrl || !storyboardAncestry(source, project).ready) return null;
  const selected = selectedVersion(source);
  if (!selected?.asset?.assetId) return null;
  return fingerprint("image-edit-review", project, shotId, {
    sourceShotId,
    sourceFrameUrl: source.frameUrl,
    sourceAssetId: selected.asset.assetId,
  });
}

export function imageEditReadiness(
  project: Project,
  shotId: string,
  sourceShotId: string,
  reviewedFingerprint: string | null,
): ProductionGateReport {
  const stage = stageReadiness(project, shotId);
  const source = shotFor(project, sourceShotId);
  const ancestry = source
    ? storyboardAncestry(source, project)
    : report([issue("missing-selected-photoreal", "Select a generated photoreal still before editing from it.")]);
  const issues = [...stage.issues, ...ancestry.issues];
  const expected = imageEditReviewFingerprint(project, shotId, sourceShotId);
  if (!expected || reviewedFingerprint !== expected)
    issues.push(issue("missing-image-review", "Review the exact current source still and Stage setup before starting this paid image edit."));
  return report(issues);
}

export interface VideoReviewIntent {
  prompt: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16";
  generateAudio: boolean;
}

function stableVideoIntent(intent: VideoReviewIntent | undefined) {
  return intent
    ? {
        prompt: intent.prompt,
        durationSeconds: intent.durationSeconds,
        aspectRatio: intent.aspectRatio,
        generateAudio: intent.generateAudio,
      }
    : null;
}

export function videoReviewFingerprint(
  project: Project,
  shotId: string,
  intent?: VideoReviewIntent,
): string | null {
  const shot = shotFor(project, shotId);
  if (!shot || !storyboardAncestry(shot, project).ready) return null;
  return fingerprint("still-keyframe-cut-review", project, shotId, {
    frameUrl: shot.frameUrl,
    intent: stableVideoIntent(intent),
  });
}

export function videoReadiness(
  project: Project,
  shotId: string,
  reviewedFingerprint: string | null,
  intent?: VideoReviewIntent,
): ProductionGateReport {
  const stage = stageReadiness(project, shotId);
  const shot = shotFor(project, shotId);
  if (!shot) return stage;
  const ancestry = storyboardAncestry(shot, project);
  const issues = [...stage.issues, ...ancestry.issues];
  const expectedReview = videoReviewFingerprint(project, shotId, intent);
  if (ancestry.ready && (!expectedReview || reviewedFingerprint !== expectedReview))
    issues.push(issue("missing-video-review", "Review the selected still, its key-frame intent, and the planned cut before creating video."));
  return report(issues);
}

export function formatGateIssues(reportValue: ProductionGateReport): string {
  return reportValue.issues.map((item) => item.message).join(" ");
}
