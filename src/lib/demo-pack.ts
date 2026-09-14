import { unpackSlateWithReceipt } from "./slate-pack";
import { MAX_ARCHIVE_BYTES, archiveMediaByteLimit } from "./archive-limits";
import { withArchiveContainerCopy, type PreparedArchiveImportReceipt } from "./archive-import-receipt";
import type { Project } from "./types";
import { uid } from "./utils";

const PLANNING_MANIFEST_URL = "/demo/manifest.json";
const FINISHED_MANIFEST_URL = "/demo/finished-manifest.json";
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_PACK_BYTES = MAX_ARCHIVE_BYTES;
const MAX_MEDIA_DESCRIPTORS = 64;
const MAX_OWNERS = 512;
const MAX_MEDIA_URL_BYTES = 2048;
const PACK_URL_PATTERN = /^\/demo\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.reelbinder\.zip$/;
const MEDIA_TYPES = new Set(["video/mp4", "audio/wav", "image/png", "image/jpeg", "image/webp"]);
const SAME_ORIGIN_MEDIA_URL_PATTERN = /^\/demo\/media\/[A-Za-z0-9_.-]+$/;
const GCP_MEDIA_URL_PATTERN = /^https:\/\/storage\.googleapis\.com\/reelbinder-public-downloads\/[A-Za-z0-9/_.-]+$/;
function safeGcpMediaUrl(value: string): boolean {
  return GCP_MEDIA_URL_PATTERN.test(value) && !value.includes("..") && !value.includes("//", 8);
}
const OWNER_LOCATOR_PATTERN =
  /^(?:project\.cutUrl|project\.world\.genesisUrl|project\.shots\[\*\]\.(?:frameUrl|videoUrl)|project\.shots\[\*\]\.(?:frameHistory|videoHistory)\[\*\]\.url|project\.shots\[\*\]\.videoHistory\[\*\]\.asset\.url|project\.timeline\.clips\[\*\]\.(?:sourceFrameUrl|sourceVideoUrl))$/;

export type PlanningStudyManifest = {
  version: 1;
  title: string;
  description: string;
  credit: string;
  pack: { url: string; sha256: string; byteSize: number };
};

export type FinishedStudyMediaDescriptor = {
  id: string;
  url: string;
  sha256: string;
  byteSize: number;
  mimeType: "video/mp4" | "audio/wav" | "image/png" | "image/jpeg" | "image/webp";
  owners: string[];
  label: string;
};

export type FinishedStudyManifest = {
  version: 1;
  title: string;
  description: string;
  credit: string;
  pack: { url: string; sha256: string; byteSize: number };
  media: FinishedStudyMediaDescriptor[];
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function packDescriptor(value: unknown): { url: string; sha256: string; byteSize: number } {
  if (
    !object(value) || typeof value.url !== "string" ||
    // A literal local path only: no redirect, protocol, escapes, traversal or query parameters.
    !PACK_URL_PATTERN.test(value.url) ||
    !sha256(value.sha256) ||
    !Number.isSafeInteger(value.byteSize) ||
    (value.byteSize as number) <= 0 || (value.byteSize as number) > MAX_PACK_BYTES
  ) throw new Error("The film study descriptor is invalid. You can still open a script example or import your own ReelBinder project archive.");
  return { url: value.url, sha256: value.sha256, byteSize: value.byteSize as number };
}

export function validatePlanningStudyManifest(value: unknown): PlanningStudyManifest {
  if (
    !object(value) || value.version !== 1 ||
    !boundedText(value.title, 160) || !boundedText(value.description, 2000) || !boundedText(value.credit, 1000) ||
    !object(value.pack)
  ) throw new Error("The film study descriptor is invalid. You can still open a script example or import your own ReelBinder project archive.");
  // Retain only the supported descriptor fields. They are displayed as text, never HTML.
  return {
    version: 1,
    title: value.title as string,
    description: value.description as string,
    credit: value.credit as string,
    pack: packDescriptor(value.pack),
  };
}

export function validateFinishedStudyManifest(value: unknown): FinishedStudyManifest {
  if (
    !object(value) || value.version !== 1 ||
    !boundedText(value.title, 160) || !boundedText(value.description, 2000) || !boundedText(value.credit, 1000) ||
    !object(value.pack) || !Array.isArray(value.media) || value.media.length < 1 || value.media.length > MAX_MEDIA_DESCRIPTORS
  ) throw new Error("The finished presentation descriptor is invalid. You can still open the planning study or import your own ReelBinder project archive.");
  const pack = packDescriptor(value.pack);
  const seenIds = new Set<string>();
  const media = value.media.map((entry) => {
    if (
      !object(entry) ||
      typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id) || seenIds.has(entry.id) ||
      typeof entry.url !== "string" || new TextEncoder().encode(entry.url).byteLength > MAX_MEDIA_URL_BYTES ||
      (!SAME_ORIGIN_MEDIA_URL_PATTERN.test(entry.url) && !safeGcpMediaUrl(entry.url)) ||
      !sha256(entry.sha256) ||
      !Number.isSafeInteger(entry.byteSize) || (entry.byteSize as number) <= 0 ||
      typeof entry.mimeType !== "string" || !MEDIA_TYPES.has(entry.mimeType) ||
      (entry.byteSize as number) > archiveMediaByteLimit(entry.mimeType as string) ||
      !Array.isArray(entry.owners) || entry.owners.length < 1 || entry.owners.length > MAX_OWNERS ||
      !entry.owners.every((owner) => typeof owner === "string" && OWNER_LOCATOR_PATTERN.test(owner)) ||
      !boundedText(entry.label, 200)
    ) throw new Error("The finished presentation descriptor contains an invalid media entry.");
    seenIds.add(entry.id as string);
    return {
      id: entry.id as string,
      url: entry.url as string,
      sha256: entry.sha256 as string,
      byteSize: entry.byteSize as number,
      mimeType: entry.mimeType as FinishedStudyMediaDescriptor["mimeType"],
      owners: entry.owners as string[],
      label: entry.label as string,
    };
  });
  return {
    version: 1,
    title: value.title as string,
    description: value.description as string,
    credit: value.credit as string,
    pack,
    media,
  };
}

type FetchOptions = { signal?: AbortSignal; credentials?: RequestCredentials; referrerPolicy?: ReferrerPolicy; json?: boolean };

async function fetchBytes(path: string, limit: number, options: FetchOptions = {}): Promise<Uint8Array> {
  const { signal, credentials = "same-origin", referrerPolicy = "strict-origin-when-cross-origin", json = false } = options;
  const deadline = AbortSignal.timeout(json ? 15_000 : 120_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  requestSignal.throwIfAborted();
  const response = await fetch(path, { signal: requestSignal, credentials, redirect: "error", cache: "no-store", referrerPolicy });
  requestSignal.throwIfAborted();
  if (!response.ok || response.redirected)
    throw new Error(response.status === 404
      ? "That film study is not available on this site yet. Open the script example or import a ReelBinder project archive."
      : "That film study could not be downloaded. Please try opening it again when the site is available.");
  if (json && !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""))
    throw new Error("The film study descriptor is not a JSON document.");
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("The film study download exceeds its size limit.");
  if (!response.body) throw new Error("The film study download is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Also release a mocked/cached stream that is not wired to fetch's AbortSignal.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  requestSignal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      requestSignal.throwIfAborted();
      const { done, value } = await reader.read();
      requestSignal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("The film study download exceeds its size limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    requestSignal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchManifest<T>(url: string, validate: (value: unknown) => T, options: FetchOptions = {}): Promise<T> {
  const bytes = await fetchBytes(url, MAX_MANIFEST_BYTES, { ...options, json: true });
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("The film study descriptor is not readable JSON."); }
  return validate(value);
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Metadata only. Call when the visitor opens Start a film; never imports media. */
export async function fetchPlanningStudyManifest(options: { signal?: AbortSignal } = {}): Promise<PlanningStudyManifest> {
  return fetchManifest(PLANNING_MANIFEST_URL, validatePlanningStudyManifest, options);
}

/** Explicit Open action only: verify the published bytes before importing to this visitor's session. */
export async function loadPlanningStudyWithReceipt(
  manifest: PlanningStudyManifest,
  options: { signal?: AbortSignal } = {},
): Promise<{ project: Project; receipt: PreparedArchiveImportReceipt }> {
  const descriptor = validatePlanningStudyManifest(manifest);
  const bytes = await fetchBytes(descriptor.pack.url, descriptor.pack.byteSize, { signal: options.signal });
  if (bytes.byteLength !== descriptor.pack.byteSize) throw new Error("The film study archive size does not match its descriptor.");
  const sha256 = await checksum(bytes);
  options.signal?.throwIfAborted();
  if (sha256 !== descriptor.pack.sha256) throw new Error("The film study archive failed its checksum. Your project has not changed.");
  const { project, receipt } = await unpackSlateWithReceipt(new Uint8Array(bytes).buffer, options);
  options.signal?.throwIfAborted();
  // A new copy, with every authored field and nested identity preserved by the archive codec.
  const copiedProject = { ...project, id: uid("proj") };
  const copiedReceipt = await withArchiveContainerCopy(receipt, project, copiedProject);
  options.signal?.throwIfAborted();
  return { project: copiedProject, receipt: copiedReceipt };
}

/** Metadata only. The finished study's small descriptor is fetched when the dialog opens. */
export async function fetchFinishedStudyManifest(options: { signal?: AbortSignal } = {}): Promise<FinishedStudyManifest> {
  return fetchManifest(FINISHED_MANIFEST_URL, validateFinishedStudyManifest, options);
}

/** Explicit Open action only: verify the media-light archive before importing to this visitor's session. */
export async function loadFinishedStudyWithReceipt(
  manifest: FinishedStudyManifest,
  options: { signal?: AbortSignal } = {},
): Promise<{ project: Project; receipt: PreparedArchiveImportReceipt }> {
  const descriptor = validateFinishedStudyManifest(manifest);
  const bytes = await fetchBytes(descriptor.pack.url, descriptor.pack.byteSize, { signal: options.signal });
  if (bytes.byteLength !== descriptor.pack.byteSize) throw new Error("The finished presentation archive size does not match its descriptor.");
  const sha256 = await checksum(bytes);
  options.signal?.throwIfAborted();
  if (sha256 !== descriptor.pack.sha256) throw new Error("The finished presentation archive failed its checksum. Your project has not changed.");
  const { project, receipt } = await unpackSlateWithReceipt(new Uint8Array(bytes).buffer, options);
  options.signal?.throwIfAborted();
  const copiedProject = { ...project, id: uid("proj") };
  const copiedReceipt = await withArchiveContainerCopy(receipt, project, copiedProject);
  options.signal?.throwIfAborted();
  return { project: copiedProject, receipt: copiedReceipt };
}

/** Shared by dialog demo/file opens. No async gap between revision check and replacement. */
export function createProjectOpenAttempt(getProject: () => Project, replaceProject: (project: Project) => void) {
  const snapshot = JSON.stringify(getProject());
  const controller = new AbortController();
  let started = false;
  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    async open(load: (signal: AbortSignal) => Promise<Project>): Promise<Project> {
      if (started) throw new Error("This open request has already started.");
      started = true;
      controller.signal.throwIfAborted();
      const project = await load(controller.signal);
      controller.signal.throwIfAborted();
      if (JSON.stringify(getProject()) !== snapshot)
        throw new Error("Your project changed while the archive was opening. Open it again when you are ready to replace the current project.");
      replaceProject(project);
      return project;
    },
  };
}