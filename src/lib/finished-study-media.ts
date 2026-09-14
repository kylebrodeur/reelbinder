import { archiveMediaByteLimit } from "./archive-limits";
import type { FinishedStudyManifest, FinishedStudyMediaDescriptor } from "./demo-pack";
import type { Project } from "./types";

export interface FinishedStudyMediaAsset {
  descriptorId: string;
  assetId: string;
  url: string;
  sha256: string;
  byteSize: number;
  mimeType: FinishedStudyMediaDescriptor["mimeType"];
  owners: string[];
}

export interface FinishedStudyMediaReceipt {
  format: "finished-study-media-receipt";
  version: 1;
  projectId: string;
  startedAt: string;
  finishedAt: string;
  state: "prepared" | "applied" | "failed" | "uncertain";
  beforeFingerprint: string;
  afterFingerprint?: string;
  descriptors: Array<{ id: string; url: string; sha256: string; byteSize: number; mimeType: string; label: string; outcome: "imported" | "failed" | "skipped"; error?: string }>;
  importedAssets: FinishedStudyMediaAsset[];
  errors: string[];
}

const ASSET_IMPORT_URL = "/api/cinema/assets/import";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function now(): string {
  return new Date().toISOString();
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function projectFingerprint(project: Project): Promise<string> {
  return checksum(new TextEncoder().encode(JSON.stringify(project)));
}

async function fetchMediaBytes(url: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  signal.throwIfAborted();
  if (!response.ok || response.redirected)
    throw new Error(`Approved media could not be downloaded (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("Approved media exceeds its published size.");
  if (!response.body) throw new Error("Approved media response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Approved media exceeds its published size.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function importVerifiedMedia(
  descriptor: FinishedStudyMediaDescriptor,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<FinishedStudyMediaAsset> {
  const provenance = {
    sourceAssetId: descriptor.id,
    sourceCreatedAt: Math.floor(Date.now() / 1000),
    sourceProvenance: {
      origin: "public-download",
      mediaRole: "finished-study-public-mirror",
      label: descriptor.label,
      sha256: descriptor.sha256,
      byteSize: descriptor.byteSize,
      mimeType: descriptor.mimeType,
      urlKind: descriptor.url.startsWith("/demo/") ? "same-origin" : "public-https",
    },
  };
  const response = await fetch(ASSET_IMPORT_URL, {
    signal,
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mimeType: descriptor.mimeType,
      dataBase64: btoa(String.fromCharCode(...bytes)),
      sha256: descriptor.sha256,
      provenance,
    }),
  });
  signal.throwIfAborted();
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !object(data) || typeof data.assetId !== "string" || typeof data.url !== "string") {
    const envelope = object(data) && object(data.error) ? data.error : null;
    const code = object(envelope) && typeof envelope.code === "string" ? envelope.code : null;
    throw new Error(`Approved media import failed for ${descriptor.id} (${code ?? `HTTP ${response.status}`}).`);
  }
  return {
    descriptorId: descriptor.id,
    assetId: data.assetId,
    url: data.url,
    sha256: descriptor.sha256,
    byteSize: bytes.byteLength,
    mimeType: descriptor.mimeType,
    owners: [...descriptor.owners],
  };
}

function applyOwner(project: Project, asset: FinishedStudyMediaAsset): boolean {
  let matched = false;
  for (const owner of asset.owners) {
    if (owner === "project.cutUrl") {
      if (project.cutUrl == null) { project.cutUrl = asset.url; matched = true; }
      continue;
    }
    const shotsMatch = /^project\.shots\[\*\]\.(videoUrl|frameUrl)$/.exec(owner);
    if (shotsMatch) {
      for (const shot of project.shots ?? []) {
        const key = shotsMatch[1] as "videoUrl" | "frameUrl";
        if (shot[key] == null) { shot[key] = asset.url; matched = true; }
      }
      continue;
    }
    const clipsMatch = /^project\.timeline\.clips\[\*\]\.source(Video|Frame)Url$/.exec(owner);
    if (clipsMatch) {
      const key = clipsMatch[1] === "Video" ? "sourceVideoUrl" : "sourceFrameUrl";
      for (const clip of project.timeline?.clips ?? []) {
        if (clip[key] == null) { clip[key] = asset.url; matched = true; }
      }
      continue;
    }
    throw new Error(`The finished-study descriptor names an unsupported media owner: ${owner}`);
  }
  return matched;
}

/**
 * Fetch, verify and import every declared finished-study media descriptor, then return
 * a hydrated copy of the Project. There is no silent partial success: if any descriptor
 * fails, the returned Project is the untouched clone and the receipt names the failure.
 */
export async function hydrateFinishedStudyMedia(
  manifest: FinishedStudyManifest,
  project: Project,
  signal: AbortSignal,
): Promise<{ project: Project; receipt: FinishedStudyMediaReceipt }> {
  const beforeFingerprint = await projectFingerprint(project);
  signal.throwIfAborted();
  const cloned: Project = structuredClone(project);
  const receipt: FinishedStudyMediaReceipt = {
    format: "finished-study-media-receipt",
    version: 1,
    projectId: project.id,
    startedAt: now(),
    finishedAt: now(),
    state: "prepared",
    beforeFingerprint,
    descriptors: [],
    importedAssets: [],
    errors: [],
  };

  let failure: string | null = null;
  for (const descriptor of manifest.media) {
    const outcome: FinishedStudyMediaReceipt["descriptors"][number] = {
      id: descriptor.id,
      url: descriptor.url,
      sha256: descriptor.sha256,
      byteSize: descriptor.byteSize,
      mimeType: descriptor.mimeType,
      label: descriptor.label,
      outcome: "skipped",
    };
    if (failure) { receipt.descriptors.push(outcome); continue; }
    try {
      if (!Number.isSafeInteger(descriptor.byteSize) || descriptor.byteSize <= 0 || descriptor.byteSize > archiveMediaByteLimit(descriptor.mimeType))
        throw new Error("The published media descriptor is invalid.");
      const bytes = await fetchMediaBytes(descriptor.url, descriptor.byteSize, signal);
      if (bytes.byteLength !== descriptor.byteSize)
        throw new Error("The downloaded media size does not match its published descriptor.");
      const sha256 = await checksum(bytes);
      if (sha256 !== descriptor.sha256)
        throw new Error("The downloaded media failed its checksum. Your project media has not changed.");
      const imported = await importVerifiedMedia(descriptor, bytes, signal);
      if (!applyOwner(cloned, imported))
        throw new Error("The finished-study descriptor did not match any offline media owner in this Project.");
      receipt.importedAssets.push(imported);
      outcome.outcome = "imported";
    } catch (error) {
      failure = `${descriptor.id}: ${error instanceof Error ? error.message : "The media download failed."}`;
      outcome.outcome = "failed";
      outcome.error = failure;
      receipt.errors.push(failure);
    }
    receipt.descriptors.push(outcome);
  }

  if (failure) {
    // Imported assets stay visible as session-owned evidence; no Project URL changes.
    receipt.state = "failed";
    receipt.finishedAt = now();
    return { project, receipt };
  }

  const afterFingerprint = await projectFingerprint(cloned);
  receipt.afterFingerprint = afterFingerprint;
  receipt.state = "applied";
  receipt.finishedAt = now();
  return { project: cloned, receipt };
}