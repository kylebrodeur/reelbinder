import type { FrameLayerSettings } from "./frame-renderer";
import type { Annotation, FrameKind, SketchData } from "./types";

export interface CinemaImageAsset {
  assetId: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: number;
  provenance: Record<string, unknown>;
}
export interface CinemaFrameVersion {
  id: string;
  url: string;
  kind: FrameKind;
  createdAt: number;
  asset?: CinemaImageAsset;
  references?: CinemaImageAsset[];
  composition?: FrameCompositionRecord;
}
export interface FrameCompositionRecord {
  layers?: FrameLayerSettings;
  guideSha256: string;
  sourceFrameUrl: string;
  sourceProjectSha256: string;
  sourceShotId: string;
  sketch: SketchData;
  annotations: Annotation[];
  reviewedPlan?: ReviewedPlanRecord;
}

/** Persisted evidence that a storyboard used the exact locally captured plan the filmmaker approved. */
export interface ReviewedPlanRecord {
  version: 1;
  projectId: string;
  shotId: string;
  setup: string;
  planAssetId: string;
  planSha256: string;
  sourceProjectSha256: string;
  approvalFingerprint: string;
}
export interface CinemaImageResult {
  assets: CinemaImageAsset[];
  text: string;
}

export function privateImageAssetId(url: string): string | null {
  return /^\/api\/cinema\/assets\/([a-zA-Z0-9_-]+)\/content$/.exec(url)?.[1] ?? null;
}

export function localRasterUpload(url: string): { mimeType: string; dataBase64: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[2].length % 4 !== 0) {
    throw new Error(
      "Editing requires a local PNG, JPEG, WebP, or an image generated in this session. Upload or paste the reference first.",
    );
  }
  const bytes =
    (match[2].length * 3) / 4 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (bytes > 1024 * 1024)
    throw new Error("This reference exceeds the 1 MiB upload limit. Upload it again to resize it.");
  return { mimeType: match[1], dataBase64: match[2] };
}

export function imageReferenceAvailable(url: string | null): boolean {
  if (!url) return false;
  if (privateImageAssetId(url)) return true;
  try {
    localRasterUpload(url);
    return true;
  } catch {
    return false;
  }
}

export function validateCinemaImageResult(
  result: CinemaImageResult,
  expected: { projectId: string; revision: number; shotId: string; jobId: string | null; referenceAssetIds: readonly string[] },
): CinemaImageAsset[] {
  if (typeof expected.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(expected.jobId))
    throw new Error("The image job has no valid submitted job ID. Keep the result for review.");
  if (!Array.isArray(expected.referenceAssetIds) || expected.referenceAssetIds.length > 4 ||
    !expected.referenceAssetIds.every(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)))
    throw new Error("The submitted image references are invalid.");
  if (!result || !Array.isArray(result.assets) || result.assets.length !== 1) {
    throw new Error("The image job must return exactly one usable image.");
  }
  for (const asset of result.assets) {
    if (
      !asset ||
      typeof asset.assetId !== "string" || typeof asset.url !== "string" ||
      privateImageAssetId(asset.url) !== asset.assetId ||
      !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) ||
      ![asset.width, asset.height, asset.byteSize].every(value => Number.isSafeInteger(value) && value > 0) ||
      asset.byteSize > 8 * 1024 * 1024 ||
      typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      typeof asset.createdAt !== "number" || !Number.isFinite(asset.createdAt) || asset.createdAt < 0
    ) {
      throw new Error("The image job returned invalid asset metadata.");
    }
    const provenance = asset.provenance;
    if (
      !provenance ||
      provenance.projectId !== expected.projectId ||
      provenance.sourceRevision !== expected.revision ||
      provenance.shotId !== expected.shotId ||
      provenance.jobId !== expected.jobId ||
      !Array.isArray(provenance.referenceAssetIds) ||
      provenance.referenceAssetIds.length !== expected.referenceAssetIds.length ||
      !provenance.referenceAssetIds.every((id, index) => id === expected.referenceAssetIds[index])
    ) {
      throw new Error("The returned image does not match the submitted shot and project revision.");
    }
  }
  return result.assets;
}

export function appendFrameVersions(
  shot: { frameUrl: string | null; frameKind: FrameKind; frameHistory?: CinemaFrameVersion[] },
  assets: CinemaImageAsset[],
  kind: FrameKind,
  now: number,
  context?: { references: CinemaImageAsset[]; composition: FrameCompositionRecord },
): CinemaFrameVersion[] {
  const history = [...(shot.frameHistory ?? [])];
  if (shot.frameUrl && !history.some((version) => version.url === shot.frameUrl)) {
    history.push({ id: `prior_${now}`, url: shot.frameUrl, kind: shot.frameKind, createdAt: now });
  }
  for (const asset of assets) {
    if (!history.some((version) => version.id === asset.assetId)) {
      history.push({
        id: asset.assetId,
        url: asset.url,
        kind,
        createdAt: asset.createdAt * 1000,
        asset,
        ...(context ? structuredClone(context) : {}),
      });
    }
  }
  return history;
}
