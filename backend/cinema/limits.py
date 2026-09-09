"""Finite scene capacity, not a creative target or a provider generation length.

Mirrored by src/lib/scene-limits.ts with a cross-language contract test.
"""
MIB = 1024 * 1024
MAX_SCENE_SECONDS = 300
MAX_PICTURE_CLIPS = 128
MAX_SCENE_AUDIO_CUES = 96
MAX_IMPORTED_WAV_SECONDS = 300
MAX_IMPORTED_WAV_BYTES = 64 * MIB
MAX_RENDER_INPUT_BYTES = 256 * MIB
MAX_VIDEO_BYTES = 128 * MIB
GENERATED_WAV_SECONDS = 40
GENERATED_WAV_BYTES = 8 * MIB
RENDER_DEADLINE_SECONDS = 900
AUDIO_MIX_BATCH_SIZE = 16
# Unique sources + all encoded segments + output + two float PCM mix accumulators.
RENDER_SCRATCH_BYTES = 768 * MIB
