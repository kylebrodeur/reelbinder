import type { CinemaJobRequest } from "./cinema-client";

export type CinemaMediaKind = "video" | "music";
export interface CinemaMediaAsset {
  assetId: string;
  url: string;
  mimeType: string;
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  sampleRate?: number;
  channels?: number;
  byteSize: number;
  sha256: string;
  createdAt: number;
  provenance: Record<string, unknown>;
}
export interface CinemaMediaResult {
  assets: CinemaMediaAsset[];
  text?: string;
}
export interface CinemaMediaVersion {
  id: string;
  url: string;
  createdAt: number;
  asset?: CinemaMediaAsset;
}
export type VeoMode = "prompt" | "start-frame" | "first-last" | "asset-references" | "extend";
export interface MediaJobOptions {
  kind: CinemaMediaKind;
  connectionId: string;
  projectId: string;
  revision: number;
  idempotencyKey: string;
  prompt: string;
  shotId?: string;
  mode?: VeoMode;
  startAssetUrl?: string | null;
  endAssetUrl?: string | null;
  referenceAssetUrls?: string[];
  sourceVideoAssetUrl?: string | null;
  referenceUrl?: string | null;
  durationSeconds?: 4 | 6 | 8;
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  generateAudio?: boolean;
  negativePrompt?: string;
  seed?: number;
}
export interface MediaRecoveryContext {
  kind: CinemaMediaKind;
  localProjectId: string;
  shotId: string | null;
}
export interface MediaRecovery extends MediaRecoveryContext {
  version: 1;
  sourceSignature: string;
  request: CinemaJobRequest;
  jobId: string | null;
}
export interface MediaPreparation extends MediaRecovery {
  phase: "preparing";
}

/** One operation survives component remounts; starting the same context shares its promise. */
export function createMediaFlightRegistry<T>() {
  const flights = new Map<string, Promise<T>>();
  return {
    get: (key: string) => flights.get(key),
    run(key: string, start: () => Promise<T>): Promise<T> {
      const existing = flights.get(key);
      if (existing) return existing;
      const operation = Promise.resolve().then(start);
      const settled = operation.finally(() => {
        flights.delete(key);
      });
      flights.set(key, settled);
      return settled;
    },
  };
}

export function mediaRecoverySettings(record: MediaRecovery) {
  const input = record.request.input;
  return record.kind === "video"
    ? {
        prompt: String(input.prompt),
        durationSeconds: input.durationSeconds as 4 | 6 | 8,
        aspectRatio: input.aspectRatio as "16:9" | "9:16",
        generateAudio: input.generateAudio as boolean,
      }
    : { prompt: String(input.prompt), negativePrompt: String(input.negativePrompt ?? "") };
}

export function parseMediaPreparation(
  raw: string | null,
  context: MediaRecoveryContext,
): MediaPreparation | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      value.phase !== "preparing" ||
      value.jobId !== null ||
      !object(value.request) ||
      value.request.projectId !== "__pending_snapshot__"
    )
      return null;
    const { phase: _phase, ...candidate } = value;
    const recovered = parseMediaRecovery(JSON.stringify(candidate), context);
    return recovered ? { ...recovered, phase: "preparing" } : null;
  } catch {
    return null;
  }
}
const assetId = (url: string) =>
  /^\/api\/cinema\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(url)?.[1] ?? null;
const assetUrl = (id: string) => `/api/cinema/assets/${id}/content`;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const videoMode = (value: unknown): value is VeoMode =>
  value === "prompt" || value === "start-frame" || value === "first-last" ||
  value === "asset-references" || value === "extend";
const videoDuration = (value: unknown): value is 4 | 6 | 8 =>
  value === 4 || value === 6 || value === 8;
const videoAspectRatio = (value: unknown): value is "16:9" | "9:16" =>
  value === "16:9" || value === "9:16";
const videoResolution = (value: unknown): value is "720p" | "1080p" =>
  value === "720p" || value === "1080p";
const privateAssetId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);

export function createMediaJobRequest(options: MediaJobOptions): CinemaJobRequest {
  const { kind, connectionId, projectId, revision, idempotencyKey, shotId } = options;
  const prompt = options.prompt.trim();
  if (!connectionId || !projectId || !Number.isInteger(revision) || revision < 1 || !idempotencyKey)
    throw new Error("A connected account and saved project revision are required.");
  if (!prompt || prompt.length > 10_000)
    throw new Error("Add direction of up to 10,000 characters.");
  if (kind === "video" && !shotId) throw new Error("Select a shot to animate.");
  const input: Record<string, unknown> = { prompt, ...(shotId ? { shotId } : {}) };
  if (kind === "video") {
    const duration = options.durationSeconds ?? 4;
    const ratio = options.aspectRatio ?? "16:9";
    const resolution = options.resolution ?? "720p";
    if (![4, 6, 8].includes(duration) || !["16:9", "9:16"].includes(ratio) || !["720p", "1080p"].includes(resolution))
      throw new Error("Choose a supported duration, aspect ratio, and resolution.");
    const startAssetId = options.startAssetUrl ? assetId(options.startAssetUrl) : (options.referenceUrl ? assetId(options.referenceUrl) : null);
    const endAssetId = options.endAssetUrl ? assetId(options.endAssetUrl) : null;
    const referenceAssetIds = (options.referenceAssetUrls ?? []).map(assetId).filter((id): id is string => !!id);
    const sourceVideoAssetId = options.sourceVideoAssetUrl ? assetId(options.sourceVideoAssetUrl) : null;
    if (options.startAssetUrl && !startAssetId) throw new Error("Select a session-owned start image asset.");
    if (options.endAssetUrl && !endAssetId) throw new Error("Select a session-owned end image asset.");
    if ((options.referenceAssetUrls ?? []).length !== referenceAssetIds.length)
      throw new Error("Select only session-owned reference image assets.");
    if (options.sourceVideoAssetUrl && !sourceVideoAssetId)
      throw new Error("Select a session-owned source video asset.");

    const mode = options.mode ?? (
      endAssetId ? "first-last" :
      startAssetId ? "start-frame" :
      sourceVideoAssetId ? "extend" :
      referenceAssetIds.length ? "asset-references" :
      "prompt"
    );

    if (mode === "prompt" && (startAssetId || endAssetId || referenceAssetIds.length || sourceVideoAssetId))
      throw new Error("Prompt mode cannot use media assets.");
    if (mode === "start-frame" && (!startAssetId || endAssetId || referenceAssetIds.length || sourceVideoAssetId))
      throw new Error("Start-frame mode requires only one start image asset.");
    if (mode === "first-last" && (!startAssetId || !endAssetId || referenceAssetIds.length || sourceVideoAssetId))
      throw new Error("First-last mode requires only start and end image assets.");
    if (mode === "asset-references" &&
      (referenceAssetIds.length < 1 || referenceAssetIds.length > 3 || startAssetId || endAssetId || sourceVideoAssetId))
      throw new Error("Asset-references mode requires only one to three reference images.");
    if (mode === "extend" && (!sourceVideoAssetId || startAssetId || endAssetId || referenceAssetIds.length))
      throw new Error("Extend mode requires only one source video asset.");

    Object.assign(input, {
      mode,
      durationSeconds: duration,
      aspectRatio: ratio,
      resolution,
      generateAudio: options.generateAudio ?? true,
      ...(startAssetId ? { startAssetId } : {}),
      ...(endAssetId ? { endAssetId } : {}),
      referenceAssetIds,
      ...(sourceVideoAssetId ? { sourceVideoAssetId } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
    });
  } else {
    const negativePrompt = (options.negativePrompt ?? "").trim();
    if (negativePrompt.length > 5000)
      throw new Error("Keep excluded sounds under 5,000 characters.");
    input.negativePrompt = negativePrompt;
  }
  return { kind, connectionId, projectId, expectedRevision: revision, idempotencyKey, input };
}

export function validateCinemaMediaResult(
  result: unknown,
  expected: {
    kind: CinemaMediaKind;
    projectId: string;
    revision: number;
    shotId: string | null;
    jobId: string;
    referenceAssetIds: readonly string[];
  },
): CinemaMediaAsset[] {
  if (typeof expected.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(expected.jobId))
    throw new Error("The media job has no valid submitted job ID.");
  if (!Array.isArray(expected.referenceAssetIds) || expected.referenceAssetIds.length > (expected.kind === "video" ? 1 : 0) ||
    !expected.referenceAssetIds.every(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)))
    throw new Error("The submitted media references are invalid.");
  if (
    !object(result) ||
    !Array.isArray(result.assets) ||
    result.assets.length < 1 ||
    result.assets.length > 4
  )
    throw new Error("The job returned no usable media. Keep its job ID for review.");
  return result.assets.map((value: unknown) => {
    if (
      !object(value) ||
      typeof value.assetId !== "string" ||
      typeof value.url !== "string" ||
      assetId(value.url) !== value.assetId ||
      value.mimeType !== (expected.kind === "video" ? "video/mp4" : "audio/wav") ||
      !positive(value.durationSec) ||
      !positive(value.byteSize) ||
      !Number.isInteger(value.byteSize) ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt < 0 ||
      typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !object(value.provenance) ||
      (expected.kind === "video" && (!positive(value.width) || !positive(value.height)))
    )
      throw new Error("The job returned invalid or unmeasured media metadata.");
    const provenance = value.provenance;
    if (
      provenance.projectId !== expected.projectId ||
      provenance.sourceRevision !== expected.revision ||
      (provenance.shotId ?? null) !== expected.shotId ||
      provenance.jobId !== expected.jobId ||
      !Array.isArray(provenance.referenceAssetIds) ||
      provenance.referenceAssetIds.length !== expected.referenceAssetIds.length ||
      !provenance.referenceAssetIds.every((id, index) => id === expected.referenceAssetIds[index])
    )
      throw new Error("The returned media does not match the submitted project, shot and job.");
    return value as unknown as CinemaMediaAsset;
  });
}

export function appendMediaVersions(
  url: string | null,
  previous: CinemaMediaVersion[] | undefined,
  assets: CinemaMediaAsset[],
  now: number,
): CinemaMediaVersion[] {
  const history = [...(previous ?? [])];
  if (url && !history.some((version) => version.url === url))
    history.push({ id: `prior_${now}`, url, createdAt: now });
  for (const asset of assets) {
    if (!history.some((version) => version.id === asset.assetId))
      history.push({ id: asset.assetId, url: asset.url, createdAt: asset.createdAt * 1000, asset });
  }
  return history;
}

export function parseMediaRecovery(
  raw: string | null,
  context: MediaRecoveryContext,
): MediaRecovery | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      value.version !== 1 ||
      value.phase !== undefined ||
      value.kind !== context.kind ||
      value.localProjectId !== context.localProjectId ||
      value.shotId !== context.shotId ||
      typeof value.sourceSignature !== "string" ||
      (value.jobId !== null &&
        (typeof value.jobId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.jobId)))
    )
      return null;
    const request = value.request;
    if (
      !object(request) ||
      request.kind !== context.kind ||
      typeof request.connectionId !== "string" ||
      !request.connectionId ||
      typeof request.projectId !== "string" ||
      !request.projectId ||
      !positive(request.expectedRevision) ||
      !Number.isInteger(request.expectedRevision) ||
      typeof request.idempotencyKey !== "string" ||
      !request.idempotencyKey ||
      request.idempotencyKey.length > 128 ||
      !object(request.input) ||
      typeof request.input.prompt !== "string" ||
      !request.input.prompt.trim() ||
      request.input.prompt.length > 10_000 ||
      (request.input.shotId ?? null) !== context.shotId
    )
      return null;
    // Rebuild the bounded public payload; session storage is data, never an arbitrary request.
    const prompt = request.input.prompt;
    const input = request.input;
    const referenceIds = input.referenceAssetIds;
    const mode = input.mode;
    const startId = input.startAssetId;
    const endId = input.endAssetId;
    const sourceVideoId = input.sourceVideoAssetId;
    const resolution = input.resolution ?? "720p";
    const negativePrompt = input.negativePrompt;
    const seed = input.seed;
    let recovered: CinemaJobRequest;
    if (context.kind === "video") {
      if (!Array.isArray(referenceIds) || referenceIds.length > 3) return null;
      const parsedReferenceIds: string[] = [];
      for (const id of referenceIds) {
        if (!privateAssetId(id)) return null;
        parsedReferenceIds.push(id);
      }
      if (mode !== undefined && !videoMode(mode)) return null;
      if (startId !== undefined && !privateAssetId(startId)) return null;
      if (endId !== undefined && !privateAssetId(endId)) return null;
      if (sourceVideoId !== undefined && !privateAssetId(sourceVideoId)) return null;
      const durationSeconds = input.durationSeconds;
      if (!videoDuration(durationSeconds)) return null;
      const aspectRatio = input.aspectRatio;
      if (!videoAspectRatio(aspectRatio)) return null;
      if (!videoResolution(resolution)) return null;
      const generateAudio = input.generateAudio;
      if (typeof generateAudio !== "boolean") return null;
      if (
        negativePrompt !== undefined &&
        (typeof negativePrompt !== "string" || negativePrompt.length > 5000)
      )
        return null;
      if (
        seed !== undefined &&
        (typeof seed !== "number" ||
          !Number.isSafeInteger(seed) ||
          seed < 0 ||
          seed > 4294967295)
      )
        return null;
      recovered = createMediaJobRequest({
        kind: "video",
        connectionId: request.connectionId,
        projectId: request.projectId,
        revision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey,
        prompt,
        ...(context.shotId ? { shotId: context.shotId } : {}),
        durationSeconds,
        aspectRatio,
        resolution,
        generateAudio,
        ...(mode ? { mode } : {}),
        ...(startId ? { startAssetUrl: assetUrl(startId) } : {}),
        ...(endId ? { endAssetUrl: assetUrl(endId) } : {}),
        ...((mode === "asset-references" || parsedReferenceIds.length > 1)
          ? { referenceAssetUrls: parsedReferenceIds.map(assetUrl) }
          : parsedReferenceIds[0]
            ? { referenceUrl: assetUrl(parsedReferenceIds[0]) }
            : {}),
        ...(sourceVideoId ? { sourceVideoAssetUrl: assetUrl(sourceVideoId) } : {}),
        ...(typeof negativePrompt === "string" ? { negativePrompt } : {}),
        ...(typeof seed === "number" ? { seed } : {}),
      });
    } else {
      const musicNegativePrompt = input.negativePrompt;
      if (typeof musicNegativePrompt !== "string" || musicNegativePrompt.length > 5000)
        return null;
      recovered = createMediaJobRequest({
        kind: "music",
        connectionId: request.connectionId,
        projectId: request.projectId,
        revision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey,
        prompt,
        negativePrompt: musicNegativePrompt,
      });
    }
    return {
      version: 1,
      ...context,
      sourceSignature: value.sourceSignature,
      request: recovered,
      jobId: value.jobId as string | null,
    };
  } catch {
    return null;
  }
}
