import type { CinemaMediaAsset } from "./cinema-media.ts";
import type { EditTimeline, TimelineAudioClip, TimelineClip } from "./types.ts";
import { z } from "zod";

import { MAX_SCENE_AUDIO_CUES, MAX_SCENE_SECONDS, MAX_IMPORTED_WAV_SECONDS, MAX_IMPORTED_WAV_BYTES } from "./scene-limits.ts";
export const MAX_AUDIO_CUES = MAX_SCENE_AUDIO_CUES;
export const MAX_AUDIO_CUT_SECONDS = MAX_SCENE_SECONDS;
export const MAX_WAV_SECONDS = MAX_IMPORTED_WAV_SECONDS;
export const MAX_WAV_BYTES = MAX_IMPORTED_WAV_BYTES;
/** Output frame rate shared with backend/cinema/render.py. */
export const OUTPUT_FPS = 24;
export const AUDIO_TRACK_LABEL = {
  voiceover: "Voice-over",
  sfx: "Sound effects",
  music: "Music",
} as const;
export type AudioTrack = TimelineAudioClip["track"];
export type AudioClipPatch = Partial<
  Pick<
    TimelineAudioClip,
    "label" | "track" | "start" | "duration" | "sourceInSec" | "gain" | "muted"
  >
>;
export interface PlannedTimelineAudioCue {
  clipId: string;
  track: AudioTrack;
  label: string;
  assetId: string;
  url: string;
  sourceDurationSec: number;
  start: number;
  duration: number;
  sourceInSec: number;
  gain: number;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, min: number, max: number, positive = false): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max &&
  (!positive || value > 0);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const fail = (message: string): never => {
  throw new Error(message);
};

const CinemaMediaAssetSchema = z
  .object({
    assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    url: z.string(),
    mimeType: z.literal("audio/wav"),
    durationSec: z.number().finite().min(0).max(MAX_IMPORTED_WAV_SECONDS),
    width: z.number().optional(),
    height: z.number().optional(),
    hasAudio: z.boolean().optional(),
    sampleRate: z.number().optional(),
    channels: z.number().optional(),
    byteSize: z.number().safe().int().min(1).max(MAX_IMPORTED_WAV_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    provenance: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const TimelineAudioClipSchema = CinemaMediaAssetSchema.extend({
  id: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.trim().length > 0),
  track: z.enum(["voiceover", "sfx", "music"]),
  mimeType: z.literal("audio/wav"),
  label: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.trim().length > 0),
  start: z.number().finite().min(0).max(MAX_SCENE_SECONDS),
  duration: z.number().finite().gt(0).max(MAX_SCENE_SECONDS),
  sourceInSec: z.number().finite().min(0).max(MAX_IMPORTED_WAV_SECONDS),
  gain: z.number().finite().min(0).max(4),
  muted: z.boolean(),
}).passthrough();

/** Frame-aligned output duration matching backend/cinema/render.py.
 *  The renderer rounds each clip boundary to the nearest frame with
 *  JavaScript-style round-half-up, then audio must fit the last frame.
 */
export function frameAlignedCutDuration(cutDuration: number, fps = OUTPUT_FPS): number {
  if (!number(cutDuration, 0, MAX_AUDIO_CUT_SECONDS) || !number(fps, 1, 120)) {
    return fail("Frame alignment needs a finite cut duration and a positive frame rate.");
  }
  return Math.floor(cutDuration * fps + 0.5) / fps;
}

/** Format/URL validation does not establish session ownership; the API checks ownership. */
export function validateTimelineAudioAsset(
  value: unknown,
): CinemaMediaAsset & { mimeType: "audio/wav" } {
  const result = CinemaMediaAssetSchema.safeParse(value);
  if (!result.success) {
    // WHY: Mapping Zod errors to the exact legacy messages required by existing tests.
    const issues = result.error.issues;
    if (issues.some((i) => i.path[0] === "assetId" || i.path[0] === "url")) {
      return fail("Audio must reference an owned cinema asset with a matching asset ID.");
    }
    if (issues.some((i) => i.path[0] === "durationSec" || i.path[0] === "mimeType")) {
      return fail("Audio needs a measured PCM WAV source of at most 300 seconds.");
    }
    return fail("Audio source metadata is incomplete or exceeds the 64 MiB limit.");
  }

  const asset = result.data;
  if (asset.url !== `/api/cinema/assets/${asset.assetId}/content`) {
    return fail("Audio must reference an owned cinema asset with a matching asset ID.");
  }
  if (asset.durationSec <= 0) {
    return fail("Audio needs a measured PCM WAV source of at most 300 seconds.");
  }

  if (
    (asset.sampleRate !== undefined && asset.sampleRate !== 48000) ||
    (asset.channels !== undefined && asset.channels !== 1 && asset.channels !== 2)
  ) {
    return fail("Audio must be 48 kHz mono or stereo PCM WAV.");
  }

  return asset;
}

/** Strict authored-data boundary; does not silently clamp or rewrite selected timing. */
export function validateTimelineAudioClips(value: unknown): TimelineAudioClip[] {
  if (!Array.isArray(value) || value.length > MAX_AUDIO_CUES) {
    return fail("An edit supports at most 96 explicit audio clips.");
  }

  const clips: TimelineAudioClip[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    const asset = validateTimelineAudioAsset(item);
    const result = TimelineAudioClipSchema.safeParse(item);

    if (!result.success) {
      const issues = result.error.issues;
      if (issues.some((i) => i.path[0] === "id")) {
        return fail("Audio clip IDs must be present and unique.");
      }
      if (issues.some((i) => i.path[0] === "track")) {
        return fail("Choose Voice-over, Sound effects or Music for each audio clip.");
      }
      if (issues.some((i) => i.path[0] === "label" || i.path[0] === "muted" || i.path[0] === "gain")) {
        return fail("Audio clips need a label, a mute setting and gain from 0 to 4.");
      }
      return fail("Audio timing must use finite, nonnegative seconds and a positive duration.");
    }

    const clip = result.data;
    if (ids.has(clip.id)) {
      return fail("Audio clip IDs must be present and unique.");
    }
    ids.add(clip.id);

    if (clip.start + clip.duration > MAX_AUDIO_CUT_SECONDS + 1e-7) {
      return fail("Audio must end within the 300-second edit limit.");
    }
    if (clip.sourceInSec + clip.duration > asset.durationSec + 1e-7) {
      return fail("The selected audio trim extends past its measured source.");
    }

    clips.push(clip);
  }

  return structuredClone(clips);
}

/** The same validated plan drives both the preview and the render request. */
export function buildTimelineAudioCues(
  clips: unknown,
  cutDuration: number,
): PlannedTimelineAudioCue[] {
  const validated = validateTimelineAudioClips(clips);
  if (!number(cutDuration, 0, MAX_AUDIO_CUT_SECONDS) || (validated.length > 0 && cutDuration <= 0))
    return fail("Place audio within a picture edit of at most 300 seconds.");
  const frameAligned = frameAlignedCutDuration(cutDuration);
  return validated.map((clip) => {
    if (clip.start + clip.duration > frameAligned + 1e-7)
      return fail(
        `Audio clip “${clip.label}” extends past the picture edit: it ends at ${(clip.start + clip.duration).toFixed(3)} s but the 24 fps render ends at ${frameAligned.toFixed(3)} s. Trim or move the clip before preview or render.`,
      );
    return {
      clipId: clip.id,
      track: clip.track,
      label: clip.label,
      assetId: clip.assetId,
      url: clip.url,
      sourceDurationSec: clip.durationSec,
      start: clip.start,
      duration: clip.duration,
      sourceInSec: clip.sourceInSec,
      gain: clip.muted ? 0 : clip.gain,
    };
  });
}

/** Keep only the existing backend fields; metadata and stable IDs stay in Project. */
export function timelineAudioRenderInputs(clips: unknown, cutDuration: number) {
  return buildTimelineAudioCues(clips, cutDuration).map(
    ({ assetId, start, duration, sourceInSec, gain }) => ({
      assetId,
      start,
      duration,
      sourceInSec,
      gain,
    }),
  );
}

export function createTimelineAudioClip(
  asset: CinemaMediaAsset,
  track: AudioTrack,
  cutDuration: number,
  options: { id?: string; label?: string; start?: number } = {},
): TimelineAudioClip {
  const source = validateTimelineAudioAsset(asset);
  const start = options.start ?? 0;
  const clip: TimelineAudioClip = {
    ...structuredClone(source),
    id: options.id ?? crypto.randomUUID(),
    track,
    label: options.label ?? AUDIO_TRACK_LABEL[track],
    start,
    duration: Math.min(source.durationSec, cutDuration - start),
    sourceInSec: 0,
    gain: 1,
    muted: false,
  };
  buildTimelineAudioCues([clip], cutDuration);
  return clip;
}

export function editTimelineAudioClip(
  clips: TimelineAudioClip[],
  id: string,
  patch: AudioClipPatch,
  cutDuration: number,
): TimelineAudioClip[] {
  const allowed = ["label", "track", "start", "duration", "sourceInSec", "gain", "muted"];
  if (!object(patch) || Object.keys(patch).some((key) => !allowed.includes(key)))
    return fail("An audio edit cannot replace its ID or owned source.");
  if (!clips.some((clip) => clip.id === id)) return fail("This audio clip no longer exists.");
  const next = clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip));
  // Existing cues may need repair after the picture cut became shorter. Validate
  // the changed cue against the frame-aligned cut without preventing repair of its siblings.
  validateTimelineAudioClips(next);
  buildTimelineAudioCues(
    next.filter((clip) => clip.id === id),
    cutDuration,
  );
  return next;
}

export function pictureAudioGain(clip: Pick<TimelineClip, "audioGain" | "audioMuted">): number {
  const gain = clip.audioGain ?? 1;
  if (
    !number(gain, 0, 4) ||
    (clip.audioMuted !== undefined && typeof clip.audioMuted !== "boolean")
  )
    return fail("Source audio gain must be from 0 to 4 with a valid mute setting.");
  return clip.audioMuted ? 0 : gain;
}

export function timelineAudioCutDuration(timeline: EditTimeline): number {
  let end = 0;
  for (const clip of timeline.clips.filter((clip) => clip.track === "picture")) {
    if (
      !number(clip.start, 0, MAX_AUDIO_CUT_SECONDS) ||
      !number(clip.duration, 0, MAX_AUDIO_CUT_SECONDS, true)
    )
      return fail("The picture edit contains invalid timing.");
    end = Math.max(end, clip.start + clip.duration);
  }
  if (end > MAX_AUDIO_CUT_SECONDS + 1e-7)
    return fail("Audio mixing currently supports picture edits up to 300 seconds.");
  return end;
}

/** One cue's media clock, clamped to measured metadata if the decoder reports less. */
export function timelineAudioPosition(
  cue: PlannedTimelineAudioCue,
  time: number,
  measuredDuration = cue.sourceDurationSec,
) {
  const end = Math.min(
    cue.sourceDurationSec,
    Number.isFinite(measuredDuration) && measuredDuration > 0
      ? measuredDuration
      : cue.sourceDurationSec,
  );
  const offset = Math.max(0, Number.isFinite(time) ? time - cue.start : 0);
  const sourceTime = Math.min(end, cue.sourceInSec + Math.min(offset, cue.duration));
  return {
    active:
      Number.isFinite(time) &&
      time >= cue.start &&
      time < cue.start + cue.duration &&
      sourceTime < end,
    sourceTime,
  };
}

/** Matches backend/cinema/av_media.py: integer PCM, 48 kHz, mono/stereo, <=300 s. */
export function validatePcmWav(bytes: Uint8Array): {
  durationSec: number;
  sampleRate: number;
  channels: number;
} {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES)
    return fail("Choose a PCM WAV file up to 64 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.byteLength)
    return fail("The WAV file is invalid or truncated.");
  let format: { channels: number; sampleRate: number; blockAlign: number } | undefined;
  let dataSize: number | undefined;
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return fail("The WAV file has a truncated chunk.");
    const kind = tag(offset),
      size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + size > bytes.byteLength) return fail("The WAV file has a truncated chunk.");
    if (kind === "fmt ") {
      if (format || size < 16) return fail("The WAV format chunk is invalid.");
      const code = view.getUint16(start, true),
        channels = view.getUint16(start + 2, true),
        rate = view.getUint32(start + 4, true),
        byteRate = view.getUint32(start + 8, true),
        blockAlign = view.getUint16(start + 12, true),
        bits = view.getUint16(start + 14, true);
      let pcm = code === 1;
      if (code === 0xfffe && size >= 40 && view.getUint16(start + 16, true) >= 22) {
        const guid = [...bytes.subarray(start + 24, start + 40)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const validBits = view.getUint16(start + 18, true);
        pcm = guid === "0100000000001000800000aa00389b71" && validBits > 0 && validBits <= bits;
      }
      if (
        !pcm ||
        rate !== 48000 ||
        ![1, 2].includes(channels) ||
        ![16, 24, 32].includes(bits) ||
        blockAlign !== (channels * bits) / 8 ||
        byteRate !== rate * blockAlign
      )
        return fail("Use 48 kHz mono or stereo integer PCM WAV, 16, 24 or 32 bit.");
      format = { channels, sampleRate: rate, blockAlign };
    } else if (kind === "data") {
      if (dataSize !== undefined) return fail("Use a WAV file with one audio data chunk.");
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (!format || dataSize === undefined || dataSize <= 0 || dataSize % format.blockAlign)
    return fail("The WAV file has no complete PCM audio frames.");
  const durationSec = dataSize / format.blockAlign / format.sampleRate;
  if (durationSec > MAX_WAV_SECONDS)
    return fail("Trim the source WAV to at most 300 seconds before importing it.");
  return { durationSec, sampleRate: format.sampleRate, channels: format.channels };
}

/** Register local audio once. Upload provenance comes from the import API, never a model. */
export async function importTimelineWav(
  file: File,
  signal?: AbortSignal,
): Promise<CinemaMediaAsset> {
  if (file.size <= 0 || file.size > MAX_WAV_BYTES)
    return fail("Choose a PCM WAV file up to 64 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const measured = validatePcmWav(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  const response = await fetch("/api/cinema/assets/import", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType: "audio/wav", dataBase64: btoa(binary), sha256 }),
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok)
    return fail(
      object(result) && object(result.error) && typeof result.error.message === "string"
        ? result.error.message
        : `Audio import failed (HTTP ${response.status}).`,
    );
  const asset = validateTimelineAudioAsset(result);
  if (
    asset.sha256 !== sha256 ||
    asset.byteSize !== bytes.byteLength ||
    Math.abs(asset.durationSec - measured.durationSec) > 1e-7 ||
    asset.sampleRate !== measured.sampleRate ||
    asset.channels !== measured.channels
  )
    return fail("The imported audio metadata does not match the selected WAV.");
  return asset;
}
