import type { CinemaJobRequest } from "./cinema-client";
import { privateImageAssetId, validateCinemaImageResult, type CinemaImageAsset, type FrameCompositionRecord } from "./cinema-images";
import { framePlanReviewFingerprintMatches } from "./production-gates";
import type { FrameKind, Project } from "./types";

export interface ImageRecovery {
  version: 1;
  localProjectId: string;
  shotId: string;
  kind: FrameKind;
  sourceFingerprint: string;
  createdAt: number;
  request: CinemaJobRequest;
  jobId: string | null;
  status: "pending" | "succeeded" | "failed";
  assets?: CinemaImageAsset[];
  error?: string;
  frameContext?: { references: CinemaImageAsset[]; composition: FrameCompositionRecord };
}
const key = (projectId: string, shotId: string) => `slate:image:${projectId}:${shotId}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function invalid(): never {
  throw new Error("Saved image request cannot be verified. Keep its recovery data; do not repeat a paid generation.");
}
function parse(raw: string, projectId: string, shotId: string): ImageRecovery {
  try {
    if (raw.length > 8 * 1024 * 1024) return invalid();
    const value = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || value.localProjectId !== projectId || value.shotId !== shotId ||
        !["still", "storyboard"].includes(String(value.kind)) || !["pending", "succeeded", "failed"].includes(String(value.status)) ||
        typeof value.sourceFingerprint !== "string" || !Number.isFinite(value.createdAt) ||
        (value.jobId !== null && !identifier(value.jobId)) || !object(value.request)) return invalid();
    if (!only(value, ["version","localProjectId","shotId","kind","sourceFingerprint","createdAt","request","jobId","status","assets","error","frameContext"])) return invalid();
    const request = value.request;
    if (!only(request, ["kind","connectionId","projectId","expectedRevision","idempotencyKey","input"])) return invalid();
    if (request.kind !== "image" || !identifier(request.connectionId) || !identifier(request.projectId) || request.expectedRevision !== 1 ||
        !identifier(request.idempotencyKey) || !object(request.input)) return invalid();
    const input = request.input;
    if (!only(input, ["shotId","prompt","purpose","aspectRatio","referenceAssetIds"])) return invalid();
    if (input.shotId !== shotId || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 20_000 || input.aspectRatio !== "16:9" ||
        (input.purpose !== undefined && !["storyboard","photoreal"].includes(String(input.purpose))) ||
        !Array.isArray(input.referenceAssetIds) || input.referenceAssetIds.length > 4 || !input.referenceAssetIds.every(identifier)) return invalid();
    const source = JSON.parse(value.sourceFingerprint);
    if (!object(source) || source.id !== projectId || !Array.isArray(source.shots) || !source.shots.some(shot => object(shot) && shot.id === shotId)) return invalid();
    if (value.frameContext !== undefined) {
      const context = value.frameContext;
      const sourceShot = source.shots.find(shot => object(shot) && shot.id === shotId);
      if (!object(context) || !only(context, ["references","composition"]) || !Array.isArray(context.references) || context.references.length !== 1 ||
          !object(context.composition) || !object(sourceShot)) return invalid();
      const composition = context.composition, guide = context.references[0];
      if (!only(composition, ["layers","guideSha256","sourceFrameUrl","sourceProjectSha256","sourceShotId","sketch","annotations","reviewedPlan"]) ||
          composition.sourceShotId !== shotId ||
          !digest(composition.sourceProjectSha256) || !digest(composition.guideSha256) ||
          JSON.stringify(composition.sketch) !== JSON.stringify(sourceShot.sketch) ||
          JSON.stringify(composition.annotations) !== JSON.stringify(sourceShot.annotations) ||
          !object(guide) || !identifier(guide.assetId) || typeof guide.url !== "string" || privateImageAssetId(guide.url) !== guide.assetId ||
          guide.sha256 !== composition.guideSha256)
        return invalid();
      if (composition.layers !== undefined) {
        const layers = composition.layers;
        if (!object(layers) || !["guides","wireframe","markup","image"].every(key => typeof layers[key] === "boolean") ||
            typeof layers.onionSkinOpacity !== "number" || !Number.isFinite(layers.onionSkinOpacity) || layers.onionSkinOpacity < 0 || layers.onionSkinOpacity > 1) return invalid();
      }
      if (composition.reviewedPlan !== undefined) {
        const reviewed = composition.reviewedPlan;
        if (value.kind !== "storyboard" || composition.sourceFrameUrl !== "" || !object(composition.layers) || !object(reviewed) ||
            !only(reviewed, ["version","projectId","shotId","setup","planAssetId","planSha256","sourceProjectSha256","approvalFingerprint"]) ||
            reviewed.version !== 1 || reviewed.projectId !== projectId || reviewed.shotId !== shotId || reviewed.setup !== sourceShot.setup ||
            reviewed.planAssetId !== guide.assetId || reviewed.planSha256 !== guide.sha256 ||
            reviewed.sourceProjectSha256 !== composition.sourceProjectSha256 ||
            !framePlanReviewFingerprintMatches(reviewed.approvalFingerprint as string, source as unknown as Project, shotId, composition.layers as unknown as NonNullable<FrameCompositionRecord["layers"]>) ||
            input.referenceAssetIds.length !== 1 || input.referenceAssetIds[0] !== guide.assetId) return invalid();
      } else {
        if (composition.sourceFrameUrl !== sourceShot.frameUrl || input.referenceAssetIds.length !== 2 || input.referenceAssetIds[1] !== guide.assetId)
          return invalid();
        const cleanId = typeof sourceShot.frameUrl === "string" ? privateImageAssetId(sourceShot.frameUrl) : null;
        if (cleanId && input.referenceAssetIds[0] !== cleanId) return invalid();
      }
    }
    if (value.status === "succeeded") {
      if (!identifier(value.jobId)) return invalid();
      validateCinemaImageResult({ assets: value.assets as CinemaImageAsset[], text: "" }, {
        projectId: request.projectId, revision: request.expectedRevision, shotId, jobId: value.jobId,
        referenceAssetIds: input.referenceAssetIds as string[],
      });
    }
    if (value.status === "failed" && (!identifier(value.jobId) || typeof value.error !== "string" || !value.error)) return invalid();
    return value as unknown as ImageRecovery;
  } catch { return invalid(); }
}
export function getImageRecovery(projectId: string, shotId: string): ImageRecovery | null {
  let raw: string | null;
  try { raw = sessionStorage.getItem(key(projectId, shotId)); }
  catch { throw new Error("Image recovery storage is unavailable. Restore session storage before generating."); }
  return raw === null ? null : parse(raw, projectId, shotId);
}
export function saveImageRecovery(record: ImageRecovery): void {
  const raw = JSON.stringify(record);
  parse(raw, record.localProjectId, record.shotId);
  const previous = getImageRecovery(record.localProjectId, record.shotId);
  if (previous && (JSON.stringify(previous.request) !== JSON.stringify(record.request) ||
      previous.sourceFingerprint !== record.sourceFingerprint ||
      (previous.jobId !== null && previous.jobId !== record.jobId)))
    throw new Error("Another image request owns this setup's recovery record. Keep it for review.");
  try {
    sessionStorage.setItem(key(record.localProjectId, record.shotId), raw);
    if (sessionStorage.getItem(key(record.localProjectId, record.shotId)) !== raw) throw new Error("not retained");
  } catch { throw new Error("Could not retain image recovery. Keep the pending request; do not start another paid image."); }
}
/** Only an explicitly resolved generation may be discarded to authorize a new paid intent. */
export function clearResolvedImageRecovery(projectId: string, shotId: string): void {
  const record = getImageRecovery(projectId, shotId);
  if (!record) return;
  if (record.status === "pending") throw new Error("This image request is unresolved. Resume it instead of starting another paid image.");
  sessionStorage.removeItem(key(projectId, shotId));
  if (getImageRecovery(projectId, shotId)) throw new Error("Could not clear the resolved image. Try again before generating.");
}

/** Async hash binding is checked before any recovery transport or result application. */
export async function validateImageRecoveryContext(record: ImageRecovery): Promise<void> {
  parse(JSON.stringify(record), record.localProjectId, record.shotId);
  if (record.frameContext) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record.sourceFingerprint));
    const sha = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,"0")).join("");
    if (sha !== record.frameContext.composition.sourceProjectSha256) invalid();
  }
}
