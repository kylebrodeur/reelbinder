/** Capacity of an assembled scene, independent of a provider's short take length.
 * backend/cinema/limits.py mirrors this contract; a cross-language test checks it.
 */
export const MAX_SCENE_SECONDS = 300;
export const MAX_PICTURE_CLIPS = 128;
export const MAX_SCENE_AUDIO_CUES = 96;
export const MAX_IMPORTED_WAV_SECONDS = 300;
export const MAX_IMPORTED_WAV_BYTES = 64 * 1024 * 1024;
export const MAX_RENDER_INPUT_BYTES = 256 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
