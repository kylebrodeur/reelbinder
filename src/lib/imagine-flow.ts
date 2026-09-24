import {
  cinemaRequest,
  getCinemaConnections,
  getCinemaHealth,
  assertCinemaJobId,
  waitForCinemaJob,
  CinemaJobFailure,
  CinemaRequestFailure,
  formatCinemaRequestFailure,
} from "./cinema-client";
import {
  appendFrameVersions,
  localRasterUpload,
  privateImageAssetId,
  validateCinemaImageResult,
  type CinemaImageAsset,
  type CinemaImageResult,
} from "./cinema-images";
import { buildFramePrompt } from "./prompts";
import { frameCompositionDirection, rasterSha256, validateFrameComposition, type FrameCompositionGuide } from "./frame-composition";
import {
  formatGateIssues,
  imageEditReadiness,
  photorealReadiness,
  storyboardReadiness,
} from "./production-gates";
import { useSlate } from "./store";
import { getImageRecovery, saveImageRecovery, validateImageRecoveryContext, type ImageRecovery } from "./image-recovery";
import { withFrameImagePurpose, type FrameImageIntent } from "./image-purpose";
import type { FrameKind } from "./types";

export interface ImageRunOptions {
  connectionId: string;
  direction?: string;
  onJob?: (jobId: string) => void;
  frameGuide?: FrameCompositionGuide;
  overheadReviewFingerprint?: string | null;
  placementReviewFingerprint?: string | null;
  imageReviewFingerprint?: string | null;
}
const activeShots = new Set<string>();

function applyRecoveredImage(record: ImageRecovery, assets: CinemaImageAsset[]) {
  const current = useSlate.getState().project;
  const currentShot = current.shots.find((shot) => shot.id === record.shotId);
  if (current.id !== record.localProjectId || !currentShot) return {
    ok: true as const, url: assets[0].url, assets, jobId: record.jobId,
    message: "Image generated for the previous project. The current project was not changed.",
  };
  const unchanged = JSON.stringify(current) === record.sourceFingerprint;
  const history = appendFrameVersions(currentShot, assets, record.kind, Date.now(), record.frameContext);
  if (JSON.stringify(history) !== JSON.stringify(currentShot.frameHistory ?? []) || unchanged)
    useSlate.getState().patchShot(record.shotId, {
      frameHistory: history,
      ...(unchanged ? { frameUrl: assets[0].url, frameKind: record.kind } : {}),
    });
  return { ok: true as const, url: assets[0].url, assets, jobId: record.jobId,
    message: unchanged ? "Image ready. Earlier versions are kept in frame history." : "Image saved to frame history. Your current frame was kept." };
}

async function executeImageRecovery(initial: ImageRecovery, onJob?: (id: string) => void) {
  let record = initial;
  let returnedResult = false;
  try {
    await validateImageRecoveryContext(record);
    if (record.status === "failed") throw new Error(record.error ?? "The previous image job failed. Start a new image explicitly.");
    if (!record.jobId) {
      // Replay the original key even if its connection expired: the backend resolves
      // prior admission before checking credentials, and enforces session ownership.
      const admitted = await cinemaRequest<{ jobId: string }>("/jobs", { method: "POST", body: JSON.stringify(record.request) });
      assertCinemaJobId(admitted.jobId);
      record = { ...record, jobId: admitted.jobId };
      // If this write fails, the prior null-job intent still replays the exact same key.
      saveImageRecovery(record);
    }
    onJob?.(record.jobId!);
    const result = await waitForCinemaJob<CinemaImageResult>(record.jobId!);
    returnedResult = true;
    const assets = validateCinemaImageResult(result, {
      projectId: record.request.projectId!, revision: record.request.expectedRevision!, shotId: record.shotId,
      jobId: record.jobId, referenceAssetIds: record.request.input.referenceAssetIds as string[],
    });
    if (record.status === "succeeded" && JSON.stringify(assets.map(asset => [asset.assetId, asset.url, asset.sha256])) !==
        JSON.stringify(record.assets!.map(asset => [asset.assetId, asset.url, asset.sha256])))
      throw new Error("The recovered job no longer matches its saved image result. Keep its receipt for review.");
    record = { ...record, status: "succeeded", assets };
    saveImageRecovery(record);
    return applyRecoveredImage(record, assets);
  } catch (error) {
    let message =
      error instanceof CinemaRequestFailure
        ? formatCinemaRequestFailure(error)
        : error instanceof Error
          ? error.message
          : "Image generation could not finish.";
    if (record.status === "pending" && (returnedResult || (error instanceof CinemaJobFailure && error.code !== "INTERRUPTED_UNCERTAIN"))) {
      try { saveImageRecovery({ ...record, status: "failed", error: message }); }
      catch (storageError) { message += ` ${storageError instanceof Error ? storageError.message : "Keep recovery data."}`; }
    }
    return { ok: false as const, error: message, jobId: record.jobId };
  }
}

export async function resumeShotImage(shotId: string, options: { onJob?: (id: string) => void } = {}) {
  const project = useSlate.getState().project;
  const key = `${project.id}:${shotId}`;
  if (activeShots.has(key)) return { ok: false as const, error: "An image job is already running for this shot." };
  activeShots.add(key);
  try {
    if (!project.shots.some(shot => shot.id === shotId)) throw new Error("The source setup no longer exists. Keep its recovery record.");
    const record = getImageRecovery(project.id, shotId);
    if (!record) throw new Error("There is no saved image request for this setup.");
    return await executeImageRecovery(record, options.onJob);
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CinemaRequestFailure
          ? formatCinemaRequestFailure(error)
          : error instanceof Error
            ? error.message
            : "Could not restore image request.",
    };
  } finally { activeShots.delete(key); }
}

async function runShotImage(
  shotId: string,
  kind: FrameKind,
  prompt: string,
  options?: ImageRunOptions,
  referenceUrl?: string,
  intent: FrameImageIntent = "restyle",
  sourceShotId: string = shotId,
) {
  try {
    const current = useSlate.getState().project;
    const recovery = getImageRecovery(current.id, shotId);
    if (recovery?.status === "pending") return resumeShotImage(shotId, options);
    if (recovery) return { ok: false as const, error: "The previous image request is resolved. Choose New image before starting another paid generation." };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CinemaRequestFailure
          ? formatCinemaRequestFailure(error)
          : error instanceof Error
            ? error.message
            : "Image recovery is unavailable.",
    };
  }
  if (!options?.connectionId)
    return {
      ok: false as const,
      error: "Choose a Google Cloud connection in the selected shot's Frame controls.",
    };
  const project = structuredClone(useSlate.getState().project);
  const sourceShot = project.shots.find((shot) => shot.id === shotId);
  if (!sourceShot)
    return { ok: false as const, error: "No shot selected." };
  const gate = intent === "storyboard"
    ? storyboardReadiness(project, shotId, options.frameGuide ?? null, options.overheadReviewFingerprint ?? null)
    : intent === "photoreal"
      ? photorealReadiness(project, shotId, options.placementReviewFingerprint ?? null)
      : imageEditReadiness(project, shotId, sourceShotId, options.imageReviewFingerprint ?? null);
  if (!gate.ready) return { ok: false as const, error: formatGateIssues(gate) };
  const key = `${project.id}:${shotId}`;
  if (activeShots.has(key))
    return { ok: false as const, error: "An image job is already running for this shot." };
  activeShots.add(key);
  const fingerprint = JSON.stringify(project);
  const jobId: string | null = null;
  try {
    if (options.frameGuide) {
      await validateFrameComposition(options.frameGuide, project, shotId);
      if (options.frameGuide.captureKind === "plan") {
        if (intent !== "storyboard" || referenceUrl)
          throw new Error("A plan-only guide can only be the sole reference for a reviewed storyboard.");
      } else if (referenceUrl !== options.frameGuide.sourceFrameUrl) {
        throw new Error("The Frame guide must use the current clean still as its first reference.");
      }
    }
    const [connections, health] = await Promise.all([getCinemaConnections(), getCinemaHealth()]);
    if (
      !connections.some(
        (connection) =>
          connection.connectionId === options.connectionId &&
          connection.provider === "google-cloud" &&
          connection.expiresAt * 1000 > Date.now(),
      )
    ) {
      throw new Error("This Cloud connection is unavailable. Add or refresh it using Connections.");
    }
    if (health.capabilities.image?.status !== "configured")
      throw new Error(
        "Image generation is unavailable until an image model is configured for the cinema service.",
      );
    const referenceAssetIds: string[] = [];
    let frameContext: Parameters<typeof appendFrameVersions>[4];
    if (referenceUrl) {
      const existingId = privateImageAssetId(referenceUrl);
      if (existingId) referenceAssetIds.push(existingId);
      else {
        const uploaded = await cinemaRequest<CinemaImageAsset>("/assets", {
          method: "POST",
          body: JSON.stringify({
            ...localRasterUpload(referenceUrl),
            label: "Shot edit reference",
          }),
        });
        if (!uploaded.assetId || privateImageAssetId(uploaded.url) !== uploaded.assetId)
          throw new Error("The reference upload returned invalid metadata.");
        if (options.frameGuide && uploaded.sha256 !== await rasterSha256(referenceUrl))
          throw new Error("The uploaded clean still does not match the captured Frame source.");
        referenceAssetIds.push(uploaded.assetId);
      }
    }
    if (options.frameGuide) {
      const uploaded = await cinemaRequest<CinemaImageAsset>("/assets", {
        method: "POST",
        body: JSON.stringify({
          ...localRasterUpload(options.frameGuide.dataUrl),
          label: "Filmmaker Frame composition guide (proposal)",
        }),
      });
      if (
        !uploaded.assetId || privateImageAssetId(uploaded.url) !== uploaded.assetId ||
        uploaded.sha256 !== options.frameGuide.sha256
      ) throw new Error("The uploaded Frame guide does not match the reviewed composition.");
      referenceAssetIds.push(uploaded.assetId);
      const sourceDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
      const sourceProjectSha256 = [...new Uint8Array(sourceDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      frameContext = {
        references: [uploaded],
        composition: {
          ...(options.frameGuide.layers ? { layers: structuredClone(options.frameGuide.layers) } : {}),
          guideSha256: options.frameGuide.sha256,
          sourceFrameUrl: options.frameGuide.sourceFrameUrl,
          sourceProjectSha256,
          sourceShotId: shotId,
          sketch: structuredClone(sourceShot.sketch),
          annotations: structuredClone(sourceShot.annotations),
          ...(options.frameGuide.captureKind === "plan" ? {
            reviewedPlan: {
              version: 1 as const,
              projectId: project.id,
              shotId,
              setup: sourceShot.setup,
              planAssetId: uploaded.assetId,
              planSha256: uploaded.sha256,
              sourceProjectSha256,
              approvalFingerprint: options.overheadReviewFingerprint!,
            },
          } : {}),
        },
      };
    }
    const ensureSourceUnchanged = () => {
      if (JSON.stringify(useSlate.getState().project) !== fingerprint)
        throw new Error("The Project changed while preparing this image. Review the current plan and try again.");
    };
    ensureSourceUnchanged();
    const saved = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
      method: "POST",
      body: JSON.stringify({ project }),
    });
    if (saved.revision !== 1 || !saved.projectId)
      throw new Error("The image source snapshot could not be saved.");
    ensureSourceUnchanged();
    const record: ImageRecovery = {
      version: 1, localProjectId: project.id, shotId, kind, sourceFingerprint: fingerprint,
      createdAt: Date.now(), jobId: null, status: "pending",
      ...(frameContext ? { frameContext } : {}),
      request: {
        kind: "image", connectionId: options.connectionId, projectId: saved.projectId,
        expectedRevision: saved.revision, idempotencyKey: crypto.randomUUID(),
        input: withFrameImagePurpose(intent, { prompt, aspectRatio: "16:9", referenceAssetIds, shotId }),
      },
    };
    saveImageRecovery(record);
    return await executeImageRecovery(record, options.onJob);
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CinemaRequestFailure
          ? formatCinemaRequestFailure(error)
          : error instanceof Error
            ? error.message
            : "Image generation could not finish.",
      jobId,
    };
  } finally {
    activeShots.delete(key);
  }
}

export async function generateShotFrame(
  shotId: string,
  kind: FrameKind,
  options?: ImageRunOptions,
) {
  const { project } = useSlate.getState();
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot) return { ok: false as const, error: "No shot selected." };
  const prompt = [
    kind === "storyboard" && options?.frameGuide
      ? frameCompositionDirection(options.frameGuide, shot)
      : kind === "still"
        ? "Use Image 1 as the reviewed storyboard composition. Preserve its blocking, screen direction, eyelines, room geography, hands and prop placement while rendering one photoreal cinematic still. Do not add text or captions."
        : "",
    buildFramePrompt(shot, project, kind),
    options?.direction?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return runShotImage(
    shotId,
    kind,
    prompt,
    options,
    kind === "still" ? shot.frameUrl ?? undefined : undefined,
    kind === "storyboard" ? "storyboard" : "photoreal",
  );
}

export async function restyleShotFrame(
  shotId: string,
  instruction: string,
  options?: ImageRunOptions,
) {
  const { project } = useSlate.getState();
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot?.frameUrl)
    return { ok: false as const, error: "Upload a local still or generate an image first." };
  const direction =
    instruction.trim() ||
    (options?.frameGuide
      ? `Photoreal cinematic still using the proposed Frame placement. ${project.style}. No text.`
      : `Photoreal cinematic still. Preserve composition, faces, wardrobe and the action. ${project.style}. No text.`);
  const prompt = options?.frameGuide
    ? `${frameCompositionDirection(options.frameGuide, shot)}\n\nFilmmaker direction: ${direction}`
    : direction;
  return runShotImage(shotId, "still", prompt, options, shot.frameUrl, "restyle", shotId);
}

export async function continueFromPrevious(shotId: string, options?: ImageRunOptions) {
  const { project } = useSlate.getState();
  const index = project.shots.findIndex((shot) => shot.id === shotId);
  const shot = project.shots[index];
  const previous = project.shots[index - 1];
  if (!shot) return { ok: false as const, error: "No shot selected." };
  if (!previous?.frameUrl)
    return { ok: false as const, error: "The previous setup has no still to reference." };
  const prompt = [
    "Use the reference image for faces, wardrobe, lighting and color continuity in this new setup.",
    buildFramePrompt(shot, project, "still"),
    options?.direction?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return runShotImage(shotId, "still", prompt, options, previous.frameUrl, "continue", previous.id);
}

export async function animateShot(_shotId: string) {
  return {
    ok: false as const,
    error:
      "Video generation is unavailable. A supported project-scoped Cloud connection and video adapter are still required.",
  };
}

export async function generateMissingStills(
  _kind: FrameKind,
  _onProgress?: (done: number, total: number) => void,
) {
  return {
    ok: false as const,
    error: "Generate images individually in Stage → Frame after choosing a Cloud connection.",
    count: 0,
  };
}
