import type { Project } from "./types";

// Receipts are separate evidence artifacts, never part of a Project or provider request.
export const MAX_IMPORT_RECEIPT_BYTES = 16 * 1024 * 1024;
export type JsonObject = Record<string, unknown>;
export interface ArchiveMediaRecord {
  sourceUrl: string;
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  metadata: { assetId: string; createdAt?: number; provenance?: JsonObject };
}
export interface ArchiveMediaOwner {
  path: string;
  shotId?: string;
  versionId?: string;
  binderId?: string;
  clipId?: string;
  sourceUrl: string;
  receivingUrl: string;
  sourceAssetId?: string;
  receivingAssetId?: string;
}
export type ArchiveOwnerLocator = Pick<
  ArchiveMediaOwner,
  "path" | "shotId" | "versionId" | "binderId" | "clipId"
>;
export interface ArchiveMediaMapping {
  source: ArchiveMediaRecord;
  receiving: JsonObject & {
    assetId: string;
    url: string;
    provenance: JsonObject;
  };
  owners: ArchiveMediaOwner[];
}
export interface PreparedArchiveImportReceipt {
  format: "slate-import-receipt";
  version: 1;
  importId: string;
  state: "prepared";
  preparedAt: string;
  archive: { sha256: string; byteSize: number };
  sourceSnapshot?: { path: string; sha256: string };
  sourceProjectId: string;
  project: { id: string; preparedSha256: string };
  containerMapping?: {
    sourceProjectId: string;
    receivingProjectId: string;
    reason: "demo-copy";
  };
  assets: ArchiveMediaMapping[];
  referenceChanges: {
    archivePath: string;
    path: string;
    binderId: string;
    added: boolean;
    sourceUrl?: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
  }[];
  inlineMedia?: {
    phase: "source" | "prepared";
    urlSha256: string;
    owners: ArchiveOwnerLocator[];
    decoding: "base64" | "percent" | "unreadable";
    mimeType?: string;
    byteSize?: number;
    sha256?: string;
  }[];
  externalUrls: string[];
  retiredDemoMedia: unknown[];
}
export type AppliedArchiveImportReceipt = Omit<
  PreparedArchiveImportReceipt,
  "state"
> & {
  state: "applied";
  appliedAt: string;
  appliedProject: { id: string; sha256: string };
};
export type FailedArchiveImportReceipt = Omit<
  PreparedArchiveImportReceipt,
  "state"
> & {
  state: "failed";
  failedAt: string;
  pendingSource?: Pick<ArchiveMediaRecord, "sourceUrl" | "path" | "sha256">;
};

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** JSON evidence retains safe extra fields; it never carries credential material. */
export function receiptJson<T>(value: T, limit = MAX_IMPORT_RECEIPT_BYTES): T {
  let count = 0;
  const visit = (node: unknown, depth: number) => {
    if (++count > 500_000 || depth > 40)
      throw new Error("Import receipt exceeds its complexity limit.");
    if (typeof node === "number" && !Number.isFinite(node))
      throw new Error("Invalid import receipt number.");
    if (Array.isArray(node)) node.forEach((child) => visit(child, depth + 1));
    else if (object(node))
      for (const [key, child] of Object.entries(node)) {
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
            "secretkey",
            "privatekey",
            "constructor",
            "prototype",
          ].includes(normalized) ||
          key === "__proto__"
        )
          throw new Error(
            "Import receipt provenance must not contain credential or prototype fields.",
          );
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
  const text = JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).byteLength > limit)
    throw new Error("Import receipt exceeds its size limit.");
  return JSON.parse(text) as T;
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equalJson(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
  );
}

export function validateImportedAsset(
  value: unknown,
  source: ArchiveMediaRecord,
): ArchiveMediaMapping["receiving"] {
  const restored = receiptJson(value, 1024 * 1024);
  if (
    !object(restored) ||
    typeof restored.url !== "string" ||
    !/^\/api\/cinema\/assets\/[A-Za-z0-9_-]{1,128}\/content$/.test(
      restored.url,
    ) ||
    restored.assetId !== restored.url.split("/")[4] ||
    restored.sha256 !== source.sha256 ||
    restored.mimeType !== source.mimeType ||
    restored.byteSize !== source.byteSize
  )
    throw new Error(
      "Restored archive media does not match its handle, checksum, type or size.",
    );
  const provenance = restored.provenance;
  // The backend omits an absent/null optional envelope time; nested nulls stay exact.
  const sourceTime = source.metadata.createdAt;
  if (
    !object(provenance) ||
    provenance.origin !== "imported" ||
    provenance.sourceAssetId !== source.metadata.assetId ||
    (sourceTime == null
      ? Object.hasOwn(provenance, "sourceCreatedAt")
      : provenance.sourceCreatedAt !== sourceTime) ||
    !equalJson(
      provenance.sourceProvenance,
      receiptJson(source.metadata.provenance ?? {}),
    )
  )
    throw new Error(
      "Restored archive media provenance does not match its submitted source lineage.",
    );
  if (
    typeof restored.createdAt !== "number" ||
    !Number.isFinite(restored.createdAt) ||
    restored.createdAt < 0
  )
    throw new Error(
      "Restored archive media has an invalid receiving timestamp.",
    );
  // The existing backend bounds the submitted wrapper at 128 KiB, then adds origin.
  receiptJson(provenance, 128 * 1024 + 64);
  return restored as ArchiveMediaMapping["receiving"];
}

export async function importSha256(
  value: string | Uint8Array,
): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A deliberate demo copy changes the container only; nested identities stay exact. */
export async function withArchiveContainerCopy(
  receipt: PreparedArchiveImportReceipt,
  source: Project,
  copy: Project,
): Promise<PreparedArchiveImportReceipt> {
  const before = JSON.stringify(source),
    copied = JSON.stringify(copy);
  const original = JSON.parse(before) as Project,
    receiving = JSON.parse(copied) as Project;
  const frozenReceipt = receiptJson(receipt);
  if (
    frozenReceipt.state !== "prepared" ||
    original.id !== frozenReceipt.project.id ||
    !receiving.id ||
    !equalJson({ ...original, id: receiving.id }, receiving) ||
    (await importSha256(before)) !== frozenReceipt.project.preparedSha256
  )
    throw new Error(
      "The film study copy changed more than its Project container.",
    );
  return receiptJson({
    ...frozenReceipt,
    project: { id: receiving.id, preparedSha256: await importSha256(copied) },
    containerMapping: {
      sourceProjectId: original.id,
      receivingProjectId: receiving.id,
      reason: "demo-copy" as const,
    },
  });
}

function atPointer(value: unknown, path: string): unknown {
  return path
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (parent, part) =>
        parent !== null && typeof parent === "object"
          ? (parent as JsonObject)[part.replace(/~1/g, "/").replace(/~0/g, "~")]
          : undefined,
      value,
    );
}

/** IDs belong to the ancestor at this exact pointer, not another record with the same URL. */
function validateAppliedOwner(
  project: Project,
  owner: ArchiveOwnerLocator,
): void {
  const ancestors: [keyof Omit<ArchiveOwnerLocator, "path">, RegExp][] = [
    ["shotId", /^\/shots\/\d+(?=\/)/],
    ["versionId", /^\/shots\/\d+\/(?:frameHistory|videoHistory)\/\d+(?=\/)/],
    ["binderId", /^\/binder\/\d+(?=\/)/],
    ["clipId", /^\/(?:audioClips|timeline\/clips)\/\d+(?=\/)/],
  ];
  for (const [field, pattern] of ancestors) {
    const ancestor = pattern.exec(owner.path)?.[0];
    // A legacy version without an ID remains absent; do not invent an identity.
    if (
      (ancestor || owner[field] !== undefined) &&
      (!ancestor || atPointer(project, `${ancestor}/id`) !== owner[field])
    )
      throw new Error(
        "The applied Project owner identity does not match its import receipt.",
      );
  }
}

/** Call immediately after guarded replacement. Capture synchronously before hashing. */
export async function markArchiveImportApplied(
  receipt: PreparedArchiveImportReceipt,
  project: Project,
): Promise<AppliedArchiveImportReceipt> {
  const frozen = JSON.stringify(project);
  const observed = JSON.parse(frozen) as Project;
  const evidence = receiptJson(receipt);
  const appliedAt = new Date().toISOString();
  if (evidence.state !== "prepared" || observed.id !== evidence.project.id)
    throw new Error("The imported Project does not match this receipt.");
  for (const asset of evidence.assets)
    for (const owner of asset.owners) {
      validateAppliedOwner(observed, owner);
      if (
        atPointer(observed, owner.path) !== owner.receivingUrl ||
        (owner.receivingAssetId !== undefined &&
          atPointer(observed, owner.path.replace(/\/url$/, "/assetId")) !==
            owner.receivingAssetId)
      )
        throw new Error(
          "The applied Project media does not match its import receipt.",
        );
    }
  for (const reference of evidence.referenceChanges)
    validateAppliedOwner(observed, reference);
  const inlineHashes = new Map<string, Promise<string>>();
  for (const inline of evidence.inlineMedia ?? []) {
    if (inline.phase !== "prepared") continue; // Source observations describe the historical input.
    for (const owner of inline.owners) {
      validateAppliedOwner(observed, owner);
      const url = atPointer(observed, owner.path);
      if (typeof url !== "string")
        throw new Error(
          "The applied Project inline media does not match its import receipt.",
        );
      const hash = inlineHashes.get(url) ?? importSha256(url);
      inlineHashes.set(url, hash);
      if ((await hash) !== inline.urlSha256)
        throw new Error(
          "The applied Project inline media does not match its import receipt.",
        );
    }
  }
  return receiptJson({
    ...evidence,
    state: "applied" as const,
    appliedAt,
    appliedProject: { id: observed.id, sha256: await importSha256(frozen) },
  });
}

export class ArchiveImportFailure extends Error {
  readonly receipt: FailedArchiveImportReceipt;
  constructor(
    cause: unknown,
    receipt: PreparedArchiveImportReceipt,
    pendingSource?: FailedArchiveImportReceipt["pendingSource"],
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : "The archive import did not finish.",
      { cause },
    );
    this.name =
      cause instanceof Error && cause.name === "AbortError"
        ? "AbortError"
        : "ArchiveImportFailure";
    this.receipt = receiptJson({
      ...receipt,
      state: "failed" as const,
      failedAt: new Date().toISOString(),
      ...(pendingSource ? { pendingSource } : {}),
    });
  }
}

export function downloadArchiveImportReceipt(
  receipt: AppliedArchiveImportReceipt,
): void {
  if (receipt.state !== "applied" || !receipt.appliedProject?.sha256)
    throw new Error("Only an applied import receipt can be downloaded here.");
  const data = JSON.stringify(receiptJson(receipt), null, 2);
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reelbinder-import-${receipt.importId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
