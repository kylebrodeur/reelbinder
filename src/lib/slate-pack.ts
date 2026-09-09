import JSZip from "jszip";
import { DEFAULT_CHAIN, DEFAULT_SKILLS } from "./prompt-chain";
import {
  documentsToProject,
  toLiningJsonl,
  toSlateMd,
  type SlateManifest,
} from "./slate-md";
import type { Project } from "./types";
import {
  ArchiveImportFailure,
  MAX_IMPORT_RECEIPT_BYTES,
  importSha256,
  receiptJson,
  validateImportedAsset,
  type ArchiveMediaOwner,
  type ArchiveMediaRecord,
  type PreparedArchiveImportReceipt,
} from "./archive-import-receipt";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_MEDIA_ASSETS,
  MAX_REFERENCE_BYTES,
  archiveMediaByteLimit,
} from "./archive-limits";
import {
  MAX_PROJECT_SNAPSHOT_BYTES,
  parseProjectSnapshot,
  serializeProjectSnapshot,
} from "./slate-snapshot";

const MANIFEST_NAME = "slate.json";
const SNAPSHOT_NAME = "project.snapshot.json";
const MAX_MEDIA_ASSETS = MAX_ARCHIVE_MEDIA_ASSETS;
const MEDIA_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/wav": "wav",
};
type MediaRecord = ArchiveMediaRecord;
type PackManifest = SlateManifest & {
  media?: { version: 1; assets: MediaRecord[]; externalUrls: string[] };
};
type MediaSlot = {
  owner: Record<string, unknown>;
  key: string;
  url: string;
  locator: Pick<
    ArchiveMediaOwner,
    "path" | "shotId" | "versionId" | "binderId" | "clipId"
  >;
};
type PackWriter = {
  remaining: () => number;
  add: (path: string, data: string | Uint8Array) => void;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Only media fields are remapped. Screenplay, prompt text and provenance stay verbatim. */
function mediaSlots(project: Project): MediaSlot[] {
  const slots: MediaSlot[] = [];
  const add = (
    value: unknown,
    key: string,
    path: string,
    ids: Omit<MediaSlot["locator"], "path"> = {},
  ) => {
    if (object(value) && typeof value[key] === "string" && value[key])
      slots.push({
        owner: value,
        key,
        url: value[key] as string,
        locator: { path: `${path}/${key}`, ...ids },
      });
  };
  add(project, "cutUrl", "");
  add(project.world, "genesisUrl", "/world");
  project.shots.forEach((shot, i) => {
    const path = `/shots/${i}`,
      ids = { shotId: shot.id };
    add(shot, "frameUrl", path, ids);
    add(shot, "videoUrl", path, ids);
    for (const historyKey of ["frameHistory", "videoHistory"] as const) {
      const history = shot[historyKey];
      if (!Array.isArray(history)) continue;
      history.forEach((version, j) => {
        const versionPath = `${path}/${historyKey}/${j}`,
          versionIds = { ...ids, versionId: version.id };
        add(version, "url", versionPath, versionIds);
        add(version.asset, "url", `${versionPath}/asset`, versionIds);
        if (object(version)) {
          if (Array.isArray(version.references))
            version.references.forEach((reference, k) =>
              add(
                reference,
                "url",
                `${versionPath}/references/${k}`,
                versionIds,
              ),
            );
          add(
            version.composition,
            "sourceFrameUrl",
            `${versionPath}/composition`,
            versionIds,
          );
        }
      });
    }
  });
  project.binder.forEach((asset, i) =>
    add(asset, "url", `/binder/${i}`, { binderId: asset.id }),
  );
  (project.musicAssets ?? []).forEach((asset, i) =>
    add(asset, "url", `/musicAssets/${i}`),
  );
  (project.audioClips ?? []).forEach((clip, i) =>
    add(clip, "url", `/audioClips/${i}`, { clipId: clip.id }),
  );
  project.timeline.clips.forEach((clip, i) => {
    add(clip, "sourceFrameUrl", `/timeline/clips/${i}`, { clipId: clip.id });
    add(clip, "sourceVideoUrl", `/timeline/clips/${i}`, { clipId: clip.id });
  });
  return slots;
}

/** Observe allowlisted inline media without fetching it or normalizing saved values. */
async function inlineMediaObservations(
  project: Project,
  phase: "source" | "prepared",
): Promise<NonNullable<PreparedArchiveImportReceipt["inlineMedia"]>> {
  const groups = new Map<string, MediaSlot["locator"][]>();
  for (const slot of mediaSlots(project))
    if (slot.url.startsWith("data:")) {
      const owners = groups.get(slot.url) ?? [];
      owners.push(slot.locator);
      groups.set(slot.url, owners);
    }
  const observations: NonNullable<PreparedArchiveImportReceipt["inlineMedia"]> =
    [];
  for (const [url, owners] of groups) {
    const base = { phase, urlSha256: await importSha256(url), owners };
    const match = /^data:([^;,]*)(;[^,]*)?,([\s\S]*)$/.exec(url);
    let bytes: Uint8Array, decoding: "base64" | "percent";
    try {
      if (!match) throw new Error("Malformed data URL");
      if (match[2]?.split(";").includes("base64")) {
        bytes = Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0));
        decoding = "base64";
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
        decoding = "percent";
      }
    } catch {
      observations.push({ ...base, decoding: "unreadable" });
      continue;
    }
    observations.push({
      ...base,
      decoding,
      mimeType: match![1] || "text/plain",
      byteSize: bytes.byteLength,
      sha256: await importSha256(bytes),
    });
  }
  return observations;
}

function privateAssetId(url: string): string | null {
  return /^\/api\/cinema\/assets\/([A-Za-z0-9_-]+)\/content$/.exec(url)?.[1] ?? null;
}

/** Absolute URLs are exportable only when they resolve to this browser's exact origin. */
function localPath(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  if (typeof location === "undefined") return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === location.origin && !parsed.username && !parsed.password
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}

function bundledReference(url: string): string | null {
  const path = localPath(url);
  return path &&
    /^\/(?:boards|refs|locks)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..")
    ? path
    : null;
}

function mediaLimit(mimeType: string): number {
  return archiveMediaByteLimit(mimeType);
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function responseBytes(response: Response, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (!response.ok || response.redirected)
    throw new Error(`Could not read archive media (HTTP ${response.status}).`);
  const length = Number(response.headers.get("content-length"));
  if (length > limit) throw new Error("Archive media exceeds the size limit.");
  if (!response.body) throw new Error("Archive media response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Archive media exceeds the size limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function archiveRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
  });
}

async function responseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await responseBytes(response, 1024 * 1024, signal)));
}

async function collectMedia(
  project: Project,
  zip: JSZip,
  writer: PackWriter,
): Promise<NonNullable<PackManifest["media"]>> {
  const assets: MediaRecord[] = [];
  const externalUrls: string[] = [];
  for (const sourceUrl of new Set(mediaSlots(project).map((slot) => slot.url))) {
    const path = localPath(sourceUrl);
    const id = path && privateAssetId(path);
    if (!id) {
      if (!sourceUrl.startsWith("data:")) externalUrls.push(sourceUrl);
      continue;
    }
    if (assets.length >= MAX_MEDIA_ASSETS)
      throw new Error("ReelBinder project archive contains too many media assets.");
    try {
      const metadata = await responseJson(await archiveRequest(`/api/cinema/assets/${id}`));
      if (
        !object(metadata) ||
        metadata.assetId !== id ||
        metadata.url !== `/api/cinema/assets/${id}/content` ||
        typeof metadata.mimeType !== "string" ||
        typeof metadata.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
        !Number.isSafeInteger(metadata.byteSize) ||
        (metadata.byteSize as number) <= 0 ||
        (metadata.byteSize as number) > mediaLimit(metadata.mimeType) ||
        !object(metadata.provenance)
      )
        throw new Error("Invalid owned media metadata.");
      validateProvenance({
        sourceAssetId: id,
        sourceCreatedAt: metadata.createdAt,
        sourceProvenance: metadata.provenance,
      });
      for (const slot of mediaSlots(project).filter(
        (slot) => slot.url === sourceUrl && typeof slot.owner.assetId === "string",
      )) {
        for (const key of ["assetId", "mimeType", "byteSize", "sha256"])
          if (slot.owner[key] !== undefined && slot.owner[key] !== metadata[key])
            throw new Error("The saved media record does not match the owned asset.");
      }
      const archivePath = `media/${metadata.sha256}.${MEDIA_TYPES[metadata.mimeType]}`;
      if (!zip.file(archivePath) && (metadata.byteSize as number) > writer.remaining())
        throw new Error("The complete project exceeds the 512 MiB archive limit.");
      const response = await archiveRequest(`/api/cinema/assets/${id}/content`);
      if (response.headers.get("content-type")?.split(";")[0].trim() !== metadata.mimeType)
        throw new Error("Owned media type does not match its metadata.");
      const bytes = await responseBytes(
        response,
        metadata.byteSize as number,
      );
      if (bytes.byteLength !== metadata.byteSize || (await checksum(bytes)) !== metadata.sha256)
        throw new Error("Owned media checksum or size does not match.");
      if (!zip.file(archivePath)) {
        writer.add(archivePath, bytes);
      }
      assets.push({
        sourceUrl,
        path: archivePath,
        mimeType: metadata.mimeType,
        byteSize: bytes.byteLength,
        sha256: metadata.sha256,
        metadata: {
          assetId: id,
          createdAt: typeof metadata.createdAt === "number" ? metadata.createdAt : undefined,
          provenance: metadata.provenance,
        },
      });
    } catch (error) {
      throw new Error(
        `Could not export owned media ${id}. Keep its original session open and retry. ${error instanceof Error ? error.message : "Media unavailable."}`,
      );
    }
  }
  return { version: 1, assets, externalUrls };
}

export function slugName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "film"
  );
}

export function manifestFor(project: Project): SlateManifest {
  return {
    format: "slate",
    version: 1,
    name: project.name,
    script: "script.slate.md",
    lining: "lining.jsonl",
    projectSnapshot: SNAPSHOT_NAME,
    chain: project.chain?.length ? project.chain : [...DEFAULT_CHAIN],
    cut: project.cutUrl ?? undefined,
  };
}

async function addReferenceFile(writer: PackWriter, path: string, url: string) {
  if (!url || url.startsWith("data:")) {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const bin = atob(url.slice(comma + 1));
      if (bin.length > MAX_REFERENCE_BYTES)
        throw new Error("A production reference exceeds the 32 MiB import limit.");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      writer.add(path, bytes);
    }
    return;
  }
  const local = bundledReference(url);
  if (!local) return;
  const response = await archiveRequest(local);
  writer.add(path, await responseBytes(response, Math.min(MAX_REFERENCE_BYTES, writer.remaining())));
}

export async function packSlate(project: Project): Promise<Blob> {
  const zip = new JSZip();
  const entrySizes = new Map<string, number>();
  let totalBytes = 0;
  const writer: PackWriter = {
    remaining: () => MAX_ARCHIVE_BYTES - totalBytes,
    add: (path, data) => {
      const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
      const nextTotal = totalBytes - (entrySizes.get(path) ?? 0) + size;
      if (nextTotal > MAX_ARCHIVE_BYTES)
        throw new Error("The complete project exceeds the 512 MiB archive limit.");
      totalBytes = nextTotal;
      entrySizes.set(path, size);
      zip.file(path, data);
    },
  };
  const writeText = (path: string, text: string, limit: number) => {
    if (new TextEncoder().encode(text).byteLength > limit)
      throw new Error(`ReelBinder project archive entry ${path} exceeds the import size limit.`);
    writer.add(path, text);
  };
  // Freeze and validate before asynchronous reads; edits during export cannot mix revisions.
  const snapshot = serializeProjectSnapshot(project);
  project = parseProjectSnapshot(snapshot);
  const manifest: PackManifest = manifestFor(project);
  writer.add(SNAPSHOT_NAME, snapshot);
  manifest.media = await collectMedia(project, zip, writer);
  writeText("script.slate.md", toSlateMd(project), 8 * 1024 * 1024);
  writeText("lining.jsonl", toLiningJsonl(project), 16 * 1024 * 1024);

  const used = new Set(DEFAULT_SKILLS.map((s) => s.id));
  for (const skill of project.skills ?? []) {
    if (!skill.body.trim()) continue;
    writeText(
      `skills/${skill.id}.md`,
      `---\nid: ${skill.id}\ntitle: ${skill.title}\n---\n\n${skill.body}\n`,
      1024 * 1024,
    );
    used.add(skill.id);
  }
  for (const skill of DEFAULT_SKILLS) {
    if (used.has(skill.id) && (project.skills ?? []).some((s) => s.id === skill.id)) continue;
    writeText(
      `skills/${skill.id}.md`,
      `---\nid: ${skill.id}\ntitle: ${skill.title}\n---\n\n${skill.body}\n`,
      1024 * 1024,
    );
  }

  let i = 0;
  for (const asset of project.binder) {
    if (!asset.url) continue;
    const ext = extensionFor(asset.url);
    const folder =
      asset.tab === "wardrobe"
        ? "refs/wardrobe"
        : asset.tab === "diagrams"
          ? "refs/diagrams"
          : "refs/boards";
    const filename = `${folder}/${slugName(asset.title) || `ref-${i}`}${ext}`;
    i += 1;
    await addReferenceFile(writer, filename, asset.url);
  }
  writeText(MANIFEST_NAME, JSON.stringify(manifest, null, 2), 1024 * 1024);
  const blob = await zip.generateAsync({ type: "blob" });
  if (blob.size > MAX_ARCHIVE_BYTES)
    throw new Error("ReelBinder project archive exceeds the 512 MiB archive limit.");
  return blob;
}

function extensionFor(url: string): string {
  const m = url.match(/\.(png|jpe?g|webp|gif|svg)(?:\?|$)/i);
  if (m) return `.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
  if (url.startsWith("data:image/png")) return ".png";
  if (url.startsWith("data:image/webp")) return ".webp";
  return ".jpg";
}

function parseSkillMd(path: string, text: string): { id: string; title: string; body: string } {
  const idFromPath = path.split("/").pop()?.replace(/\.md$/i, "") || "skill";
  let id = idFromPath;
  let title = idFromPath;
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end > 0) {
      const block = text.slice(4, end);
      body = text.slice(end + 4).replace(/^\n/, "");
      for (const line of block.split("\n")) {
        const m = line.match(/^(id|title):\s*(.+)$/i);
        if (!m) continue;
        if (m[1].toLowerCase() === "id") id = m[2].trim();
        else title = m[2].trim();
      }
    }
  }
  return { id, title, body: body.trim() };
}

function imageMime(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension === "svg"
    ? "image/svg+xml"
    : extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : `image/${extension}`;
}

function packPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid ${label} path in the project archive manifest.`);
  }
  return value;
}

/** Stop decompression at the per-entry bound instead of trusting ZIP metadata. */
async function readBounded(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    // JSZip exposes this bounded-stream API at runtime; its object typings omit it.
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > limit) {
        stream.pause();
        reject(new Error(`ReelBinder project archive entry ${entry.name} exceeds the import size limit.`));
      } else chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}

function sourceAssetId(url: string): string | null {
  const local = privateAssetId(url);
  if (local) return local;
  try {
    const parsed = new URL(url);
    return /^(?:http|https):$/.test(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
      ? privateAssetId(parsed.pathname)
      : null;
  } catch {
    return null;
  }
}

function validateProvenance(value: unknown) {
  if (!object(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 128 * 1024)
    throw new Error("Invalid or oversized archive media provenance.");
  const visit = (item: unknown, depth: number) => {
    if (depth > 30) throw new Error("Archive media provenance is too deeply nested.");
    if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (object(item))
      for (const [key, child] of Object.entries(item)) {
        const normalized = key.replace(/[-_]/g, "").toLowerCase();
        if (
          [
            "apikey",
            "accesstoken",
            "refreshtoken",
            "authorization",
            "credentials",
            "password",
            "secret",
            "privatekey",
            "constructor",
            "prototype",
          ].includes(normalized) ||
          key === "__proto__"
        )
          throw new Error("Archive media provenance must not contain credential fields.");
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
}

/** Validate every declared byte before any private upload or Project mutation. */
async function restoreMedia(
  zip: JSZip,
  project: Project,
  media: unknown,
  readBytes: (entry: JSZip.JSZipObject, limit: number) => Promise<Uint8Array>,
  receipt: PreparedArchiveImportReceipt,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (media === undefined) return; // Historical packs did not contain generated media.
  if (
    !object(media) ||
    media.version !== 1 ||
    !Array.isArray(media.assets) ||
    media.assets.length > MAX_MEDIA_ASSETS ||
    !Array.isArray(media.externalUrls) ||
    !media.externalUrls.every((url) => typeof url === "string")
  )
    throw new Error("Invalid media manifest in the project archive.");
  const slots = mediaSlots(project);
  const referenced = new Set(slots.map((slot) => slot.url));
  const declared = new Map<string, MediaRecord>();
  const contents = new Map<string, Uint8Array>();
  for (const value of media.assets) {
    signal?.throwIfAborted();
    if (
      !object(value) ||
      typeof value.sourceUrl !== "string" ||
      !referenced.has(value.sourceUrl) ||
      declared.has(value.sourceUrl) ||
      typeof value.path !== "string" ||
      typeof value.mimeType !== "string" ||
      !Object.hasOwn(MEDIA_TYPES, value.mimeType) ||
      typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.byteSize) ||
      (value.byteSize as number) <= 0 ||
      (value.byteSize as number) > mediaLimit(value.mimeType) ||
      !object(value.metadata) ||
      !sourceAssetId(value.sourceUrl) ||
      value.metadata.assetId !== sourceAssetId(value.sourceUrl)
    )
      throw new Error("Invalid media record in the project archive.");
    const path = packPath(value.path, "media");
    if (path !== `media/${value.sha256}.${MEDIA_TYPES[value.mimeType]}`)
      throw new Error("Invalid media path in the project archive.");
    if (
      value.metadata.createdAt !== undefined &&
      (typeof value.metadata.createdAt !== "number" ||
        !Number.isFinite(value.metadata.createdAt) ||
        value.metadata.createdAt < 0)
    )
      throw new Error("Invalid archive media timestamp.");
    validateProvenance({
      sourceAssetId: value.metadata.assetId,
      sourceCreatedAt: value.metadata.createdAt,
      sourceProvenance: value.metadata.provenance ?? {},
    });
    const entry = zip.file(path);
    if (!entry)
      throw new Error(
        `ReelBinder project archive is missing declared media ${value.metadata.assetId}.`,
      );
    if (!contents.has(path))
      contents.set(path, await readBytes(entry, value.byteSize as number));
    const bytes = contents.get(path)!;
    if (
      bytes.byteLength !== value.byteSize ||
      (await checksum(bytes)) !== value.sha256
    )
      throw new Error(
        `Media checksum or size failed for ${value.metadata.assetId}.`,
      );
    signal?.throwIfAborted();
    declared.set(value.sourceUrl, value as unknown as MediaRecord);
  }
  for (const url of referenced) {
    if (privateAssetId(url) && !declared.has(url))
      throw new Error("ReelBinder project archive is missing an owned media declaration.");
    if (
      sourceAssetId(url) &&
      !declared.has(url) &&
      !media.externalUrls.includes(url)
    )
      throw new Error("ReelBinder project archive is missing a media declaration.");
  }

  const replacements = new Map<string, { assetId: string; url: string }>();
  const receivingSources = new Map<string, string>();
  let pendingSource:
    { sourceUrl: string; path: string; sha256: string } | undefined;
  try {
    for (const record of declared.values()) {
      signal?.throwIfAborted();
      pendingSource = {
        sourceUrl: record.sourceUrl,
        path: record.path,
        sha256: record.sha256,
      };
      const owners = slots
        .filter((slot) => slot.url === record.sourceUrl)
        .map((slot) => ({
          ...slot.locator,
          sourceUrl: slot.url,
          ...(slot.key === "url" && typeof slot.owner.assetId === "string"
            ? { sourceAssetId: slot.owner.assetId }
            : {}),
        }));
      // Reserve the bounded response and failure envelope before another upload commits.
      const reservedOwners = owners.map((owner) => ({
        ...owner,
        receivingUrl: `/api/cinema/assets/${"x".repeat(128)}/content`,
        ...(owner.sourceAssetId !== undefined
          ? { receivingAssetId: "x".repeat(128) }
          : {}),
      }));
      receiptJson(
        {
          ...receipt,
          pendingSource,
          assets: [
            ...receipt.assets,
            { source: record, owners: reservedOwners },
          ],
        },
        MAX_IMPORT_RECEIPT_BYTES - 1024 * 1024 - 4096,
      );
      const response = await archiveRequest("/api/cinema/assets/import", {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataBase64: base64(contents.get(record.path)!),
          mimeType: record.mimeType,
          sha256: record.sha256,
          provenance: {
            sourceAssetId: record.metadata.assetId,
            sourceCreatedAt: record.metadata.createdAt,
            sourceProvenance: record.metadata.provenance ?? {},
          },
        }),
      });
      const restored = validateImportedAsset(
        await responseJson(response, signal),
        record,
      );
      const priorSource = receivingSources.get(restored.assetId);
      if (priorSource && priorSource !== record.sourceUrl)
        throw new Error(
          "Restored archive media shares a receiving handle across distinct source lineages.",
        );
      receivingSources.set(restored.assetId, record.sourceUrl);
      const mapping = receiptJson({
        source: record,
        receiving: restored,
        owners: owners.map((owner) => ({
          ...owner,
          receivingUrl: restored.url,
          ...(owner.sourceAssetId !== undefined
            ? { receivingAssetId: restored.assetId }
            : {}),
        })),
      });
      receipt.assets.push(mapping);
      pendingSource = undefined;
      signal?.throwIfAborted();
      replacements.set(record.sourceUrl, {
        assetId: restored.assetId,
        url: restored.url,
      });
    }
  } catch (error) {
    // Individual backend uploads can remain; this is evidence, not rollback or a retry.
    throw new ArchiveImportFailure(error, receipt, pendingSource);
  }
  // Do not touch the imported snapshot unless every restore succeeded.
  signal?.throwIfAborted();
  for (const slot of slots) {
    const replacement = replacements.get(slot.url);
    if (!replacement) continue;
    slot.owner[slot.key] = replacement.url;
    if (slot.key === "url" && typeof slot.owner.assetId === "string")
      slot.owner.assetId = replacement.assetId;
  }
}

export async function unpackSlateWithReceipt(
  file: Blob | ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<{ project: Project; receipt: PreparedArchiveImportReceipt }> {
  const { signal } = options;
  signal?.throwIfAborted();
  const byteLength = file instanceof Blob ? file.size : file.byteLength;
  if (byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("ReelBinder project archive exceeds the 512 MiB import limit.");
  const archiveBytes = file instanceof Blob ? await file.arrayBuffer() : file.slice(0);
  const archiveSha256 = await importSha256(new Uint8Array(archiveBytes));
  signal?.throwIfAborted();
  const zip = await JSZip.loadAsync(archiveBytes);
  signal?.throwIfAborted();
  if (Object.keys(zip.files).length > 2000)
    throw new Error("ReelBinder project archive contains too many files.");
  let totalBytes = 0;
  const readBytes = async (entry: JSZip.JSZipObject, limit: number) => {
    signal?.throwIfAborted();
    const bytes = await readBounded(
      entry,
      Math.min(limit, MAX_ARCHIVE_BYTES - totalBytes),
    );
    signal?.throwIfAborted();
    totalBytes += bytes.byteLength;
    return bytes;
  };
  const readText = async (entry: JSZip.JSZipObject, limit: number) =>
    new TextDecoder().decode(await readBytes(entry, limit));
  const manifestFile = zip.file(MANIFEST_NAME);
  const manifest = manifestFile
    ? (JSON.parse(await readText(manifestFile, 1024 * 1024)) as PackManifest)
    : ({ format: "slate", version: 1 } as PackManifest);
  if (!manifest || manifest.format !== "slate" || manifest.version !== 1)
    throw new Error("Unsupported project archive manifest format or version.");
  let snapshot: Project | undefined;
  let sourceSnapshot: PreparedArchiveImportReceipt["sourceSnapshot"];
  if (manifest.projectSnapshot !== undefined) {
    const snapshotFile = zip.file(
      packPath(manifest.projectSnapshot, "project snapshot"),
    );
    if (!snapshotFile)
      throw new Error("This archive is missing its declared project snapshot.");
    const snapshotBytes = await readBytes(
      snapshotFile,
      MAX_PROJECT_SNAPSHOT_BYTES,
    );
    sourceSnapshot = {
      path: manifest.projectSnapshot,
      sha256: await importSha256(snapshotBytes),
    };
    snapshot = parseProjectSnapshot(new TextDecoder().decode(snapshotBytes));
  }
  const scriptName = packPath(manifest.script || "script.slate.md", "script");
  const liningName = packPath(manifest.lining || "lining.jsonl", "lining");
  const scriptFile =
    zip.file(scriptName) ||
    zip.file("script.md") ||
    zip.file("script.fountain");
  if (!scriptFile) throw new Error("This archive has no script.slate.md.");
  const script = await readText(scriptFile, 8 * 1024 * 1024);
  const liningFile = zip.file(liningName);
  let lining = liningFile ? await readText(liningFile, 16 * 1024 * 1024) : "";

  const skills: { id: string; title: string; body: string }[] = [];
  const skillFiles = Object.keys(zip.files).filter(
    (p) => p.startsWith("skills/") && p.endsWith(".md") && !zip.files[p]?.dir,
  );
  for (const path of skillFiles) {
    const fileObj = zip.file(path);
    if (!fileObj) continue;
    skills.push(parseSkillMd(path, await readText(fileObj, 1024 * 1024)));
  }
  if (skills.length) {
    lining +=
      (lining && !lining.endsWith("\n") ? "\n" : "") +
      skills
        .map((s) =>
          JSON.stringify({
            kind: "skill",
            id: s.id,
            title: s.title,
            body: s.body,
          }),
        )
        .join("\n") +
      "\n";
  }

  // An explicit snapshot is authoritative. Re-parsing would recreate IDs/events and erase edit decisions.
  const project = snapshot ?? documentsToProject({ script, lining, manifest });
  const receipt: PreparedArchiveImportReceipt = {
    format: "slate-import-receipt",
    version: 1,
    importId: crypto.randomUUID(),
    state: "prepared",
    preparedAt: new Date().toISOString(),
    archive: { sha256: archiveSha256, byteSize: byteLength },
    ...(sourceSnapshot ? { sourceSnapshot } : {}),
    sourceProjectId: project.id,
    project: { id: project.id, preparedSha256: "" },
    assets: [],
    referenceChanges: [],
    inlineMedia: await inlineMediaObservations(project, "source"),
    externalUrls: [],
    retiredDemoMedia: receiptJson(
      (project as unknown as Record<string, unknown>).retiredDemoMedia ?? [],
    ) as unknown[],
  };

  const refFiles = Object.keys(zip.files).filter(
    (p) =>
      p.startsWith("refs/") &&
      !zip.files[p]?.dir &&
      /\.(png|jpe?g|webp|gif|svg)$/i.test(p),
  );
  for (const path of refFiles) {
    const fileObj = zip.file(path);
    if (!fileObj) continue;
    const bytes = await readBytes(fileObj, 32 * 1024 * 1024);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const dataUrl = `data:${imageMime(path)};base64,${btoa(binary)}`;
    const base =
      path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? path;
    const tab = path.includes("wardrobe")
      ? "wardrobe"
      : path.includes("diagram")
        ? "diagrams"
        : "boards";
    const existing = project.binder.find(
      (a) =>
        a.url &&
        !sourceAssetId(a.url) &&
        (path.endsWith(a.url) ||
          a.title.toLowerCase().includes(base.replace(/-/g, " "))),
    );
    const sourceUrl = existing?.url;
    if (existing) existing.url = dataUrl;
    else {
      project.binder.push({
        id: `ref_${base}`,
        tab,
        title: base.replace(/-/g, " "),
        url: dataUrl,
      });
    }
    const binderIndex = existing
      ? project.binder.indexOf(existing)
      : project.binder.length - 1;
    receipt.referenceChanges.push({
      archivePath: path,
      path: `/binder/${binderIndex}/url`,
      binderId: project.binder[binderIndex].id,
      added: !existing,
      ...(sourceUrl && !sourceUrl.startsWith("data:") ? { sourceUrl } : {}),
      mimeType: imageMime(path),
      byteSize: bytes.byteLength,
      sha256: await importSha256(bytes),
    });
  }
  if (manifest.media?.assets?.length && !snapshot)
    throw new Error("A media archive requires its complete project snapshot.");
  receipt.inlineMedia!.push(
    ...(await inlineMediaObservations(project, "prepared")),
  );
  receiptJson(receipt); // Reject oversized evidence before any backend upload.
  try {
    await restoreMedia(
      zip,
      project,
      manifest.media,
      readBytes,
      receipt,
      signal,
    );
    signal?.throwIfAborted();
    receipt.externalUrls = [...(manifest.media?.externalUrls ?? [])];
    receipt.project.preparedSha256 = await importSha256(
      JSON.stringify(project),
    );
    signal?.throwIfAborted();
    return { project, receipt: receiptJson(receipt) };
  } catch (error) {
    if (error instanceof ArchiveImportFailure) throw error;
    throw new ArchiveImportFailure(error, receipt);
  }
}

/** Compatibility API for existing callers that only need the imported Project. */
export async function unpackSlate(
  file: Blob | ArrayBuffer,
  options: { signal?: AbortSignal } = {},
): Promise<Project> {
  return (await unpackSlateWithReceipt(file, options)).project;
}

export function isZipFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".zip") ||
    n.endsWith(".slate") ||
    n.endsWith(".slate.zip") ||
    file.type === "application/zip"
  );
}

export async function downloadSlatePack(project: Project) {
  const blob = await packSlate(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugName(project.name)}.slate.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
