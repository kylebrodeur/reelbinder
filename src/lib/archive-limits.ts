import { MAX_IMPORTED_WAV_BYTES, MAX_VIDEO_BYTES } from "./scene-limits";

// A portable scene includes its selected sources, final render and retained history.
// The ZIP and its expanded entries are bounded independently of each media file.
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_MEDIA_ASSETS = 256;
export const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

export function archiveMediaByteLimit(mimeType: string): number {
  if (mimeType === "video/mp4") return MAX_VIDEO_BYTES;
  if (mimeType === "audio/wav") return MAX_IMPORTED_WAV_BYTES;
  if (["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return 8 * 1024 * 1024;
  throw new Error("Unsupported media type in ReelBinder project archive.");
}
