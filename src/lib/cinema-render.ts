import { localRasterUpload, privateImageAssetId } from "./cinema-images.ts";
import type { Project } from "./types";
import type { CinemaJobRequest } from "./cinema-client";
import { MAX_SCENE_SECONDS, MAX_PICTURE_CLIPS, MAX_VIDEO_BYTES } from "./scene-limits.ts";

export interface RenderPictureSource {
  clipId: string;
  kind: "asset" | "local";
  url: string;
  assetId?: string;
}

export interface RenderAudioInput {
  assetId: string;
  start: number;
  duration: number;
  sourceInSec: number;
  gain: number;
}

export interface CinemaRenderAsset {
  assetId: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  byteSize: number;
  provenance: Record<string, unknown>;
}

export interface CinemaRenderResult {
  assets: CinemaRenderAsset[];
  warnings: string[];
}

export interface RenderRecovery {
  version: 1;
  localProjectId: string;
  sourceFingerprint: string;
  request: CinemaJobRequest;
  jobId: string | null;
  result?: CinemaRenderResult;
  terminalError?: string;
}

export function readRenderRecovery(
  source: string | null,
  projectId: string,
): RenderRecovery | null {
  if (!source) return null;
  try {
    const record = JSON.parse(source) as RenderRecovery;
    const request = record.request;
    if (
      record.version !== 1 ||
      record.localProjectId !== projectId ||
      !/^[a-f0-9]{64}$/.test(record.sourceFingerprint) ||
      request?.kind !== "render" ||
      request.connectionId !== undefined ||
      typeof request.projectId !== "string" ||
      !request.projectId ||
      !Number.isInteger(request.expectedRevision) ||
      !(request.expectedRevision! > 0) ||
      typeof request.idempotencyKey !== "string" ||
      !request.idempotencyKey ||
      !request.input?.pictureAssets ||
      typeof request.input.pictureAssets !== "object" ||
      Array.isArray(request.input.pictureAssets) ||
      !Object.values(request.input.pictureAssets).every(
        (id) => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id),
      ) ||
      !(record.jobId === null || typeof record.jobId === "string")
    )
      return null;
    if (record.result)
      record.result = validateRenderResult(record.result, {
        projectId: request.projectId,
        revision: request.expectedRevision!,
        jobId: record.jobId!,
      });
    return record;
  } catch {
    return null;
  }
}

export function renderDuration(project: Project): number {
  const clips = project.timeline.clips
    .filter((clip) => clip.track === "picture")
    .sort((a, b) => a.start - b.start);
  if (!clips.length) throw new Error("Choose picture clips before rendering.");
  if (clips.length > MAX_PICTURE_CLIPS) throw new Error(`This render supports up to ${MAX_PICTURE_CLIPS} picture clips.`);
  let end = 0;
  const ids = new Set<string>();
  for (const clip of clips) {
    if (
      !Number.isFinite(clip.start) ||
      !Number.isFinite(clip.duration) ||
      clip.start < 0 ||
      clip.duration <= 0
    )
      throw new Error("Each picture clip needs a valid output start and duration.");
    if (clip.start < end - 0.000001)
      throw new Error("Picture clips overlap. Choose a sequence before rendering.");
    if (Math.round((clip.start + clip.duration) * 24) <= Math.round(clip.start * 24))
      throw new Error("Each picture clip must occupy at least one output frame.");
    if (!clip.id || ids.has(clip.id)) throw new Error("Picture clips need unique IDs.");
    ids.add(clip.id);
    const sourceIn = clip.sourceInSec ?? 0;
    const sourceOut = clip.sourceOutSec ?? sourceIn + clip.duration;
    if (
      !Number.isFinite(sourceIn) ||
      !Number.isFinite(sourceOut) ||
      sourceIn < 0 ||
      Math.abs(sourceOut - sourceIn - clip.duration) > 0.000001
    )
      throw new Error("Source in/out must match each picture clip's duration.");
    end = clip.start + clip.duration;
  }
  if (end > MAX_SCENE_SECONDS) throw new Error(`This render supports cuts up to ${MAX_SCENE_SECONDS} seconds.`);
  return Math.round(end * 24) / 24;
}

/** Captured media wins over subsequently changed shot media. Never fetch a video URL. */
export function pictureRenderSources(project: Project): RenderPictureSource[] {
  renderDuration(project);
  return project.timeline.clips
    .filter((clip) => clip.track === "picture")
    .map((clip) => {
      const shot = project.shots.find((candidate) => candidate.id === clip.shotId);
      const captured = Boolean(clip.sourceVideoUrl || clip.sourceFrameUrl);
      const video = captured ? clip.sourceVideoUrl : shot?.videoUrl;
      const frame = captured ? clip.sourceFrameUrl : shot?.frameUrl;
      if (video) {
        const assetId = privateImageAssetId(video);
        if (!assetId)
          throw new Error(
            `The selected video for ${clip.label || shot?.title || "a picture clip"} must be a session-owned asset. Remote or local-file video import is not available here.`,
          );
        return { clipId: clip.id, kind: "asset", url: video, assetId };
      }
      if (!frame)
        throw new Error(
          `Add a still or video to ${clip.label || shot?.title || "each selected picture clip"} before rendering.`,
        );
      const assetId = privateImageAssetId(frame);
      if (assetId) return { clipId: clip.id, kind: "asset", url: frame, assetId };
      try {
        localRasterUpload(frame);
        return { clipId: clip.id, kind: "local", url: frame };
      } catch {
        throw new Error(
          "Select a generated image or upload a local raster image in Stage before rendering this clip.",
        );
      }
    });
}

export function renderMusicCue(
  asset: { assetId: string; url: string; mimeType: string; durationSec?: number },
  cutDuration: number,
): RenderAudioInput {
  if (
    privateImageAssetId(asset.url) !== asset.assetId ||
    !asset.mimeType.startsWith("audio/") ||
    !Number.isFinite(asset.durationSec) ||
    !(asset.durationSec! > 0) ||
    !Number.isFinite(cutDuration) ||
    cutDuration <= 0
  )
    throw new Error("Select session-owned music with a measured duration before mixing it.");
  return {
    assetId: asset.assetId,
    start: 0,
    duration: Math.min(cutDuration, asset.durationSec!),
    sourceInSec: 0,
    gain: 1,
  };
}

/** Full semantic snapshot; assigning a cut and save bookkeeping do not change the edit. */
export function renderSnapshotText(project: Project): string {
  return JSON.stringify({ ...project, cutUrl: null, updatedAt: 0 });
}

export async function renderFingerprint(project: Project): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(renderSnapshotText(project)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateRenderResult(
  result: unknown,
  expected: { projectId: string; revision: number; jobId: string },
): CinemaRenderResult {
  const value = result as Partial<CinemaRenderResult> | null;
  if (!value || !Array.isArray(value.assets) || value.assets.length !== 1)
    throw new Error("The render returned no usable MP4.");
  const asset = value.assets[0];
  if (
    !asset ||
    privateImageAssetId(asset.url) !== asset.assetId ||
    asset.mimeType !== "video/mp4" ||
    asset.width !== 1280 ||
    asset.height !== 720 ||
    asset.fps !== 24 ||
    !Number.isFinite(asset.durationSec) ||
    !(asset.durationSec > 0 && asset.durationSec <= MAX_SCENE_SECONDS && asset.byteSize > 0 && asset.byteSize <= MAX_VIDEO_BYTES)
  )
    throw new Error("The render returned invalid MP4 metadata.");
  if (
    asset.provenance?.projectId !== expected.projectId ||
    asset.provenance?.sourceRevision !== expected.revision ||
    asset.provenance?.jobId !== expected.jobId
  )
    throw new Error("The returned cut does not match the submitted project revision and job.");
  return {
    assets: [asset],
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

export async function prepareRenderPictureAssets(
  project: Project,
  upload: (body: {
    mimeType: string;
    dataBase64: string;
    label: string;
  }) => Promise<{ assetId: string; url: string }>,
): Promise<Record<string, string>> {
  const sources = pictureRenderSources(project);
  const prepared = new Map<string, string>();
  const bindings: Record<string, string> = Object.create(null);
  for (const source of sources) {
    let assetId = source.assetId ?? prepared.get(source.url);
    if (!assetId) {
      const body = localRasterUpload(source.url);
      const asset = await upload({ ...body, label: "Picture render source" });
      if (privateImageAssetId(asset.url) !== asset.assetId)
        throw new Error("The uploaded still did not return an owned asset reference.");
      assetId = asset.assetId;
      prepared.set(source.url, assetId);
    }
    bindings[source.clipId] = assetId;
  }
  return bindings;
}
