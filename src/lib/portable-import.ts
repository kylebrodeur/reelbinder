import { MAX_ARCHIVE_BYTES } from "./archive-limits";
import { importSha256 } from "./archive-import-receipt";

export interface ValidatedArchiveUrl {
  ok: true;
  parsedUrl: URL;
  rawUrl: string;
  redactedUrl: string;
}

export interface InvalidArchiveUrl {
  ok: false;
  error: string;
}

/**
 * Validates a user-supplied remote archive URL.
 * Strictly requires HTTPS and forbids file:, data:, blob:, http:, credentials and fragments.
 * Computes a sanitized/redacted URL stripping sensitive signed query strings.
 */
export function validateArchiveImportUrl(
  input: string,
): ValidatedArchiveUrl | InvalidArchiveUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Please enter an archive URL." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL format. Enter a full HTTPS URL." };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `Only direct HTTPS URLs are supported (received "${parsed.protocol}"). file:, data:, blob:, and http: URLs are rejected for security.`,
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: "URLs with embedded credentials (username or password) are not permitted.",
    };
  }
  if (parsed.hash) {
    return {
      ok: false,
      error: "URL fragments (#) are not permitted in archive URLs.",
    };
  }
  // Strip signed URL query parameters (e.g. AWS Signature, Google GCS accessId/signature)
  const redactedUrl = `${parsed.origin}${parsed.pathname}`;
  return {
    ok: true,
    parsedUrl: parsed,
    rawUrl: trimmed,
    redactedUrl,
  };
}

export interface FetchArchiveOptions {
  expectedSha256?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  onProgress?: (receivedBytes: number, totalBytes?: number) => void;
}

export interface FetchedArchiveResult {
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  redactedUrl: string;
  verifiedMatch: boolean;
}

/**
 * Fetches an archive from a remote HTTPS URL inside the visitor's browser.
 * Uses strict sandbox options: credentials: omit, redirect: error, cache: no-store, referrerPolicy: no-referrer.
 * Enforces size limits and validates SHA-256 before any project modification can occur.
 */
export async function fetchArchiveFromUrl(
  input: string,
  options: FetchArchiveOptions = {},
): Promise<FetchedArchiveResult> {
  const validation = validateArchiveImportUrl(input);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () =>
      timeoutController.abort(
        new Error("Archive download timed out after 60 seconds."),
      ),
    timeoutMs,
  );

  const abortListener = () => {
    timeoutController.abort(options.signal?.reason);
  };
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      throw options.signal.reason || new Error("Download aborted.");
    }
    options.signal.addEventListener("abort", abortListener, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(validation.rawUrl, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: timeoutController.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (options.signal?.aborted) {
      throw options.signal.reason || new Error("Download aborted.");
    }
    if (timeoutController.signal.aborted && !options.signal?.aborted) {
      throw (
        timeoutController.signal.reason ||
        new Error("Archive download timed out.")
      );
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    if (
      err instanceof TypeError ||
      /network|cors|failed to fetch/i.test(errMessage)
    ) {
      throw new Error(
        'Could not read this remote archive due to browser cross-origin (CORS) restrictions. Download the archive to your device first, then use "Choose file".',
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) {
      options.signal.removeEventListener("abort", abortListener);
    }
  }

  if (!response.ok) {
    throw new Error(
      `Remote server responded with HTTP ${response.status} (${response.statusText || "error"}).`,
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  const totalLength = contentLengthHeader
    ? parseInt(contentLengthHeader, 10)
    : undefined;
  if (totalLength && totalLength > maxBytes) {
    throw new Error(
      `Archive size (${(totalLength / (1024 * 1024)).toFixed(1)} MiB) exceeds the maximum allowed limit of 512 MiB.`,
    );
  }

  let receivedBytes = 0;
  let bytes: Uint8Array;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        if (options.signal?.aborted) {
          await reader.cancel();
          throw options.signal.reason || new Error("Download aborted.");
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.byteLength;
          if (receivedBytes > maxBytes) {
            await reader.cancel();
            throw new Error(
              "Archive size exceeds the maximum allowed limit of 512 MiB.",
            );
          }
          chunks.push(value);
          options.onProgress?.(receivedBytes, totalLength);
        }
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new Error(
        "Archive size exceeds the maximum allowed limit of 512 MiB.",
      );
    }
    bytes = new Uint8Array(buf);
    receivedBytes = bytes.byteLength;
    options.onProgress?.(receivedBytes, totalLength);
  }

  const sha256 = await importSha256(bytes);

  let verifiedMatch = false;
  if (options.expectedSha256) {
    const normalizedExpected = options.expectedSha256.trim().toLowerCase();
    if (sha256 !== normalizedExpected) {
      throw new Error(
        `SHA-256 mismatch: expected ${normalizedExpected}, calculated ${sha256}. Archive import halted to protect project integrity.`,
      );
    }
    verifiedMatch = true;
  }

  return {
    bytes,
    byteSize: receivedBytes,
    sha256,
    redactedUrl: validation.redactedUrl,
    verifiedMatch,
  };
}

/**
 * Attempts to use the browser File System Access API where available.
 * Returns null if the picker is cancelled or unsupported.
 */
export async function pickDeviceArchiveFile(): Promise<File | null> {
  if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
    try {
      // SAFETY: showOpenFilePicker is a browser-native API where available
      const [handle] = await (
        window as unknown as {
          showOpenFilePicker: (opts: unknown) => Promise<[{ getFile: () => Promise<File> }]>;
        }
      ).showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "ReelBinder Project Archive or Screenplay",
            accept: {
              "application/zip": [".reelbinder.zip", ".slate.zip", ".zip"],
              "text/plain": [".fountain", ".txt", ".md", ".slate.md"],
              "application/json": [".json", ".jsonl"],
            },
          },
        ],
      });
      if (!handle) return null;
      return await handle.getFile();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return null;
      }
    }
  }
  return null;
}
