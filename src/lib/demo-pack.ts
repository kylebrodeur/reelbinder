import { unpackSlateWithReceipt } from "./slate-pack";
import { MAX_ARCHIVE_BYTES } from "./archive-limits";
import { withArchiveContainerCopy, type PreparedArchiveImportReceipt } from "./archive-import-receipt";
import type { Project } from "./types";
import { uid } from "./utils";

const MANIFEST_URL = "/demo/manifest.json";
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_PACK_BYTES = MAX_ARCHIVE_BYTES;

export type DemoPackManifest = {
  version: 1;
  title: string;
  description: string;
  credit: string;
  pack: { url: string; sha256: string; byteSize: number };
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateDemoManifest(value: unknown): DemoPackManifest {
  const text = (value: unknown, max: number) =>
    typeof value === "string" && !!value.trim() && value.length <= max;
  if (
    !object(value) || value.version !== 1 ||
    !text(value.title, 160) || !text(value.description, 2000) || !text(value.credit, 1000) ||
    !object(value.pack) || typeof value.pack.url !== "string" ||
    // A literal local path only: no redirect, protocol, escapes, traversal or query parameters.
    !/^\/demo\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.slate\.zip$/.test(value.pack.url) ||
    typeof value.pack.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.pack.sha256) ||
    !Number.isSafeInteger(value.pack.byteSize) ||
    (value.pack.byteSize as number) <= 0 || (value.pack.byteSize as number) > MAX_PACK_BYTES
  ) throw new Error("The film study descriptor is invalid. You can still open a script example or import your own ReelBinder project archive.");
  // Retain only the supported descriptor fields. They are displayed as text, never HTML.
  return {
    version: 1, title: value.title as string, description: value.description as string, credit: value.credit as string,
    pack: { url: value.pack.url, sha256: value.pack.sha256, byteSize: value.pack.byteSize as number },
  };
}

async function fetchBytes(path: string, limit: number, signal?: AbortSignal, json = false): Promise<Uint8Array> {
  const deadline = AbortSignal.timeout(json ? 15_000 : 120_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  requestSignal.throwIfAborted();
  const response = await fetch(path, { signal: requestSignal, credentials: "same-origin", redirect: "error", cache: "no-store" });
  requestSignal.throwIfAborted();
  if (!response.ok || response.redirected)
    throw new Error(response.status === 404
      ? "The film study is not available on this site yet. Open the script example or import a ReelBinder project archive."
      : "The film study could not be downloaded. Please try opening it again when the site is available.");
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

/** Metadata only. Call when the visitor opens Start a film; never imports media. */
export async function fetchDemoManifest(options: { signal?: AbortSignal } = {}): Promise<DemoPackManifest> {
  const bytes = await fetchBytes(MANIFEST_URL, MAX_MANIFEST_BYTES, options.signal, true);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("The film study descriptor is not readable JSON."); }
  return validateDemoManifest(value);
}

/** Explicit Open action only: verify the published bytes before importing to this visitor's session. */
export async function loadDemoPackWithReceipt(manifest: DemoPackManifest, options: { signal?: AbortSignal } = {}): Promise<{ project: Project; receipt: PreparedArchiveImportReceipt }> {
  const descriptor = validateDemoManifest(manifest);
  const bytes = await fetchBytes(descriptor.pack.url, descriptor.pack.byteSize, options.signal);
  if (bytes.byteLength !== descriptor.pack.byteSize) throw new Error("The film study archive size does not match its descriptor.");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  options.signal?.throwIfAborted();
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== descriptor.pack.sha256) throw new Error("The film study archive failed its checksum. Your project has not changed.");
  const { project, receipt } = await unpackSlateWithReceipt(new Uint8Array(bytes).buffer, options);
  options.signal?.throwIfAborted();
  // A new copy, with every authored field and nested identity preserved by the archive codec.
  const copiedProject = { ...project, id: uid("proj") };
  const copiedReceipt = await withArchiveContainerCopy(receipt, project, copiedProject);
  options.signal?.throwIfAborted();
  return { project: copiedProject, receipt: copiedReceipt };
}

/** Compatibility API for callers that only need the visitor's Project copy. */
export async function loadDemoPack(manifest: DemoPackManifest, options: { signal?: AbortSignal } = {}): Promise<Project> {
  return (await loadDemoPackWithReceipt(manifest, options)).project;
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
