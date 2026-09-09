"""Local picture-cut rendering. Callers authorize and resolve every asset to bytes.

No project URL, asset identifier, label, or client path is opened or executed.
The public contract is documented in docs/render-design.md.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any, Mapping, Sequence
from .limits import (MAX_SCENE_SECONDS, MAX_PICTURE_CLIPS, MAX_SCENE_AUDIO_CUES,
                     MAX_RENDER_INPUT_BYTES, MAX_VIDEO_BYTES, RENDER_DEADLINE_SECONDS,
                     AUDIO_MIX_BATCH_SIZE, RENDER_SCRATCH_BYTES)


WIDTH, HEIGHT, FPS = 1280, 720, 24
MAX_DURATION = MAX_SCENE_SECONDS
MAX_ASSET_BYTES = MAX_VIDEO_BYTES
MAX_TOTAL_BYTES = MAX_RENDER_INPUT_BYTES
MAX_OUTPUT_BYTES = MAX_VIDEO_BYTES
IMAGE_FORMATS = {"image/png": ("png", "image2"), "image/jpeg": ("jpg", "image2"),
                 "image/webp": ("webp", "image2")}
VIDEO_FORMATS = {"video/mp4": ("mp4", "mov"), "video/webm": ("webm", "matroska")}
AUDIO_FORMATS = {"audio/wav": ("wav", "wav"), "audio/mpeg": ("mp3", "mp3"),
                 "audio/flac": ("flac", "flac"), "audio/ogg": ("ogg", "ogg"),
                 "audio/mp4": ("m4a", "mov")}


class RenderError(Exception):
    """A stable, public-safe error; never expose raw FFmpeg stderr to a client."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class RenderAsset:
    data: bytes
    mime_type: str
    asset_id: str | None = None


@dataclass(frozen=True)
class AudioCue:
    asset: RenderAsset
    start: float
    duration: float
    source_in_sec: float = 0
    gain: float = 1


@dataclass(frozen=True)
class RenderSegment:
    clip_id: str | None
    shot_id: str | None
    start_frame: int
    frame_count: int
    requested_start_sec: float
    requested_duration_sec: float
    source_in_sec: float
    source_out_sec: float
    alignment: str
    asset: RenderAsset | None
    audio_gain: float = 1
    audio_muted: bool = False


@dataclass(frozen=True)
class RenderPlan:
    segments: tuple[RenderSegment, ...]
    audio_cues: tuple[AudioCue, ...]
    duration_sec: float
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class _NativeAudio:
    segment: RenderSegment
    path: Path
    source_in_sec: float
    duration_sec: float
    output_start_sec: float


@dataclass(frozen=True)
class RenderResult:
    data: bytes
    duration_sec: float
    provenance: dict[str, Any]
    warnings: tuple[str, ...]
    mime_type: str = "video/mp4"
    width: int = WIDTH
    height: int = HEIGHT
    fps: int = FPS


def _number(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RenderError("INVALID_TIMING", f"{name} must be a finite number.")
    try:
        value = float(value)
    except OverflowError:
        raise RenderError("INVALID_TIMING", f"{name} must be a finite number.") from None
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise RenderError("INVALID_TIMING", f"{name} must be finite and {'positive' if positive else 'nonnegative'}.")
    return value


def _audio_gain(value: Any, name: str = "Audio gain") -> float:
    """Finite number 0..4; booleans and non-numeric values are rejected."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RenderError("INVALID_AUDIO", f"{name} must be a finite number between 0 and 4.")
    try:
        gain = float(value)
    except OverflowError:
        raise RenderError("INVALID_AUDIO", f"{name} must be a finite number between 0 and 4.") from None
    if not math.isfinite(gain) or gain < 0 or gain > 4:
        raise RenderError("INVALID_AUDIO", f"{name} must be a finite number between 0 and 4.")
    return gain


def _boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise RenderError("INVALID_AUDIO", f"{name} must be a boolean.")
    return value


def _validate_asset(asset: Any, formats: Mapping[str, Any]) -> None:
    if not isinstance(asset, RenderAsset) or asset.mime_type not in formats:
        raise RenderError("UNSUPPORTED_MEDIA", "Supply registered bytes in a supported media format.")
    if not isinstance(asset.data, bytes) or not 0 < len(asset.data) <= MAX_ASSET_BYTES:
        raise RenderError("ASSET_SIZE", "Each asset must contain between 1 byte and 128 MiB.")


def plan_render(project: Mapping[str, Any], picture_assets: Mapping[str, RenderAsset],
                *, audio_cues: Sequence[AudioCue] = ()) -> RenderPlan:
    """Validate a snapshot without running a decoder or changing any edit decision.

    picture_assets is keyed by timeline clip ID, after session authorization.
    Native picture audio is detected during rendering; explicit AudioCues add music.
    """
    timeline = project.get("timeline")
    if not isinstance(timeline, Mapping) or not isinstance(timeline.get("clips"), list):
        raise RenderError("EMPTY_PICTURE", "The project needs an explicit picture timeline.")
    clips = timeline["clips"]
    if any(not isinstance(c, Mapping) for c in clips):
        raise RenderError("INVALID_TIMELINE", "Timeline clips must be objects.")
    pictures = [c for c in clips if c.get("track") == "picture"]
    if not pictures:
        raise RenderError("EMPTY_PICTURE", "Select picture clips before rendering.")
    if len(pictures) > MAX_PICTURE_CLIPS or len(audio_cues) > MAX_SCENE_AUDIO_CUES:
        raise RenderError("RENDER_LIMIT", f"A render supports up to {MAX_PICTURE_CLIPS} picture clips and {MAX_SCENE_AUDIO_CUES} audio cues.")
    for c in pictures:
        _number(c.get("start"), "Output start")
    pictures.sort(key=lambda c: c["start"])
    segments: list[RenderSegment] = []
    warnings: list[str] = []
    ids: set[str] = set()
    previous_end = 0.0
    frame_end = 0
    unique_assets: dict[tuple[str, str], int] = {}
    asset_keys: dict[int, tuple[str, str]] = {}
    def count_asset(asset):
        key = asset_keys.get(id(asset))
        if key is None:
            key = (asset.mime_type, hashlib.sha256(asset.data).hexdigest())
            asset_keys[id(asset)] = key
        unique_assets[key] = len(asset.data)
    for c in pictures:
        clip_id = c.get("id")
        if not isinstance(clip_id, str) or not clip_id or len(clip_id) > 200 or clip_id in ids:
            raise RenderError("INVALID_TIMELINE", "Picture clip IDs must be unique nonempty strings.")
        ids.add(clip_id)
        start = _number(c["start"], "Output start")
        duration = _number(c.get("duration"), "Output duration", positive=True)
        if start + duration > MAX_DURATION:
            raise RenderError("RENDER_LIMIT", f"The render supports cuts up to {MAX_DURATION} seconds.")
        if start < previous_end - 1e-6:
            raise RenderError("PICTURE_OVERLAP", "Picture clips overlap; choose a sequence before rendering.")
        # Match JavaScript Math.round for nonnegative timeline times, including
        # exact half-frame edits; Python round uses ties-to-even instead.
        start_frame, end_frame = math.floor(start * FPS + 0.5), math.floor((start + duration) * FPS + 0.5)
        if end_frame <= start_frame:
            raise RenderError("INVALID_TIMING", "Each picture clip must occupy at least one output frame.")
        source_in = _number(c.get("sourceInSec", 0), "Source in")
        source_out = _number(c.get("sourceOutSec", source_in + duration), "Source out", positive=True)
        if abs(source_out - source_in - duration) > 1e-6:
            raise RenderError("RETIME_UNSUPPORTED", "Source span must match output duration; retiming is not implemented.")
        asset = picture_assets.get(clip_id)
        if asset is None:
            raise RenderError("ASSET_REQUIRED", "Every picture clip needs authorized local asset bytes.")
        _validate_asset(asset, IMAGE_FORMATS | VIDEO_FORMATS)
        count_asset(asset)
        if start_frame > frame_end:
            segments.append(RenderSegment(None, None, frame_end, start_frame - frame_end,
                                          frame_end / FPS, (start_frame - frame_end) / FPS,
                                          0, 0, "gap", None))
        alignment = "manual" if c.get("alignment") == "manual" and "sourceInSec" in c and "sourceOutSec" in c else "estimated"
        audio_gain = _audio_gain(c.get("audioGain", 1))
        audio_muted = _boolean(c.get("audioMuted", False), "Audio muted")
        segments.append(RenderSegment(clip_id, c.get("shotId"), start_frame, end_frame - start_frame,
                                      start, duration, source_in, source_out, alignment, asset,
                                      audio_gain, audio_muted))
        frame_end, previous_end = end_frame, start + duration
    if any(s.alignment == "estimated" for s in segments):
        warnings.append("Some source alignment is estimated; rendering does not synchronize action between angles.")
    if any(s.asset and s.asset.mime_type in IMAGE_FORMATS for s in segments):
        warnings.append("Still images are held for the selected output duration; they have no source media clock.")
    if any(c.get("track") in ("dialogue", "sound") for c in clips):
        warnings.append("Audio planning lanes need assets. The render includes available source-video sound and selected audio cues.")
    if any(abs(s.start_frame / FPS - s.requested_start_sec) > 1e-6 or
           abs(s.frame_count / FPS - s.requested_duration_sec) > 1e-6 for s in segments):
        warnings.append("Output boundaries are rounded to 24 fps; original source times are preserved in provenance.")
    for cue in audio_cues:
        if not isinstance(cue, AudioCue):
            raise RenderError("INVALID_AUDIO", "Audio cues require asset bytes and explicit timing.")
        _validate_asset(cue.asset, AUDIO_FORMATS | VIDEO_FORMATS)
        start = _number(cue.start, "Audio output start")
        duration = _number(cue.duration, "Audio duration", positive=True)
        _number(cue.source_in_sec, "Audio source in")
        gain = _number(cue.gain, "Audio gain")
        if gain > 4 or start + duration > frame_end / FPS + 1e-6:
            raise RenderError("INVALID_AUDIO", "Audio cues must fit inside the cut with gain between 0 and 4.")
        count_asset(cue.asset)
    if sum(unique_assets.values()) > MAX_TOTAL_BYTES:
        raise RenderError("RENDER_LIMIT", "Referenced media exceeds the 256 MiB render limit.")
    return RenderPlan(tuple(segments), tuple(audio_cues), frame_end / FPS, tuple(warnings))


def _run(args: list[str], deadline: float, *, code: str = "RENDER_FAILED") -> bytes:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RenderError("RENDER_TIMEOUT", "The local render exceeded its time limit.")
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, check=False, timeout=remaining, shell=False)
    except subprocess.TimeoutExpired:
        raise RenderError("RENDER_TIMEOUT", "The local render exceeded its time limit.") from None
    except OSError:
        raise RenderError("RENDER_UNAVAILABLE", "FFmpeg and ffprobe must be installed on the rendering host.") from None
    if result.returncode:
        message = "Registered media could not be decoded." if code == "INVALID_MEDIA" else "FFmpeg could not render this cut."
        raise RenderError(code, message)
    return result.stdout


def _input_options(asset: RenderAsset, path: Path) -> list[str]:
    _, demuxer = (IMAGE_FORMATS | VIDEO_FORMATS | AUDIO_FORMATS)[asset.mime_type]
    options = ["-protocol_whitelist", "file,pipe", "-f", demuxer]
    if demuxer == "mov":
        options += ["-enable_drefs", "0"]
    if demuxer == "image2":
        options += ["-pattern_type", "none"]
    return options + ["-i", str(path)]


def _probe(ffprobe: str, path: Path, deadline: float, asset: RenderAsset | None = None) -> dict:
    raw = _run([ffprobe, "-v", "error"] + (_input_options(asset, path) if asset else ["-i", str(path)]) +
               ["-show_entries", "stream=codec_type,width,height,start_time,duration,avg_frame_rate:format=start_time,duration", "-of", "json"],
               deadline, code="INVALID_MEDIA")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise RenderError("INVALID_MEDIA", "Registered media metadata is unreadable.") from None


def _check_stream(info: dict, kind: str, source_out: float, *, still: bool = False) -> None:
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == kind), None)
    if stream is None:
        raise RenderError("INVALID_MEDIA", f"Registered media has no {kind} stream.")
    if kind == "video" and not 0 < stream.get("width", 0) * stream.get("height", 0) <= 16_777_216:
        raise RenderError("MEDIA_DIMENSIONS", "Source image dimensions exceed the local render limit.")
    if not still:
        try:
            duration = float(stream.get("duration", info.get("format", {}).get("duration", 0)))
        except (ValueError, TypeError):
            duration = 0
        if not math.isfinite(duration) or source_out > duration + 0.002:
            raise RenderError("SOURCE_RANGE", "A selected source range extends beyond its registered media.")


def _metadata_time(value: Any, default: float = 0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError, OverflowError):
        return default


def _native_audio(info: dict, segment: RenderSegment, path: Path,
                  explicit_cues: Sequence[AudioCue]) -> _NativeAudio | None:
    stream = next((stream for stream in info.get("streams", []) if stream.get("codec_type") == "audio"), None)
    if stream is None or segment.audio_muted or segment.audio_gain == 0:
        return None
    # FFmpeg normalizes input timestamps to the container's start. Keep a delayed
    # audio stream delayed relative to the picture, including AAC priming samples.
    container_start = _metadata_time(info.get("format", {}).get("start_time"))
    audio_start = _metadata_time(stream.get("start_time"), container_start) - container_start
    stream_duration = _metadata_time(stream.get("duration"), float("inf"))
    source_in = max(segment.source_in_sec, audio_start)
    offset = max(0, audio_start - segment.source_in_sec)
    duration = min(segment.source_out_sec - source_in, audio_start + stream_duration - source_in,
                   segment.frame_count / FPS - offset)
    if duration <= 0.000001:
        return None
    # Existing callers may already provide this exact source audio as a cue.
    # Do not mix it twice; authored gain/timing takes precedence.
    if any((cue.asset is segment.asset or (cue.asset.asset_id and cue.asset.asset_id == segment.asset.asset_id))
           and abs(cue.start - segment.start_frame / FPS) < 0.000001
           and abs(cue.source_in_sec - segment.source_in_sec) < 0.000001
           and abs(cue.duration - segment.requested_duration_sec) < 0.000001 for cue in explicit_cues):
        return None
    return _NativeAudio(segment, path, source_in, duration, segment.start_frame / FPS + offset)


def render_project(project: Mapping[str, Any], picture_assets: Mapping[str, RenderAsset],
                   *, audio_cues: Sequence[AudioCue] = (), timeout_sec: float = RENDER_DEADLINE_SECONDS) -> RenderResult:
    """Render authorized media bytes into a 720p H.264 MP4; no credential is needed.

    This synchronous CPU task belongs in a bounded worker, never an async request
    event loop. Temporary media are deleted on success, failure, or timeout.
    """
    plan = plan_render(project, picture_assets, audio_cues=audio_cues)
    if isinstance(timeout_sec, bool) or not isinstance(timeout_sec, (int, float)) or not 0 < timeout_sec <= RENDER_DEADLINE_SECONDS:
        raise RenderError("RENDER_LIMIT", f"Render execution timeout must be between 0 and {RENDER_DEADLINE_SECONDS} seconds.")
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RenderError("RENDER_UNAVAILABLE", "FFmpeg and ffprobe must be installed on the rendering host.")
    if shutil.disk_usage(tempfile.gettempdir()).free < RENDER_SCRATCH_BYTES:
        raise RenderError("RENDER_STORAGE", "The rendering scratch volume needs at least 768 MiB free.")
    deadline = time.monotonic() + timeout_sec
    base = [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-y", "-filter_threads", "2", "-filter_complex_threads", "2"]
    scale = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    with tempfile.TemporaryDirectory(prefix="cinema-render-") as temporary:
        directory = Path(temporary)
        names: list[str] = []
        native_audio: list[_NativeAudio] = []
        sources: dict[tuple[str, str], tuple[Path, dict]] = {}
        def source_file(asset):
            key = (asset.mime_type, hashlib.sha256(asset.data).hexdigest())
            if key not in sources:
                extension = (IMAGE_FORMATS | VIDEO_FORMATS | AUDIO_FORMATS)[asset.mime_type][0]
                path = directory / f"source-{len(sources):03d}.{extension}"
                path.write_bytes(asset.data)
                sources[key] = (path, _probe(ffprobe, path, deadline, asset))
            return sources[key]
        segment_bytes = 0
        for i, segment in enumerate(plan.segments):
            duration = segment.frame_count / FPS
            if segment.asset is None:
                inputs = ["-f", "lavfi", "-i", f"color=c=black:s={WIDTH}x{HEIGHT}:r={FPS}"]
                filters = "setsar=1"
            else:
                asset = segment.asset
                source, info = source_file(asset)
                still = asset.mime_type in IMAGE_FORMATS
                _check_stream(info, "video", segment.source_out_sec, still=still)
                if still:
                    inputs = ["-loop", "1", "-framerate", str(FPS)] + _input_options(asset, source)
                    filters = scale
                else:
                    native = _native_audio(info, segment, source, plan.audio_cues)
                    if native:
                        native_audio.append(native)
                    inputs = ["-ss", str(segment.source_in_sec)] + _input_options(asset, source)
                    # Pad at most a frame for 24 fps rounding, never a missing source range.
                    filters = f"trim=duration={segment.requested_duration_sec},setpts=PTS-STARTPTS,{scale},fps={FPS},tpad=stop_mode=clone:stop_duration={1 / FPS}"
            name = f"segment-{i:03d}.mp4"
            remaining_bytes = MAX_OUTPUT_BYTES - segment_bytes
            if remaining_bytes <= 0:
                raise RenderError("RENDER_LIMIT", "Encoded picture segments exceed 128 MiB. The render cannot fit its output byte allowance.")
            # Empty initial VBV credit avoids a fresh bitrate burst at every
            # excerpt. 2.4 Mbps plus192 kbps audio leaves container/encoder
            # headroom within128 MiB even at the300-second scene boundary.
            _run(base + inputs + ["-map", "0:v:0", "-an", "-vf", filters, "-frames:v", str(segment.frame_count),
                 "-r", str(FPS), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-threads", "2",
                 "-maxrate", "2400k", "-bufsize", "2400k", "-x264-params", "vbv-init=0", "-pix_fmt", "yuv420p", "-video_track_timescale", "24000", "-map_metadata", "-1",
                 "-fflags", "+bitexact", "-flags:v", "+bitexact", "-fs", str(remaining_bytes), str(directory / name)], deadline)
            segment_bytes += (directory / name).stat().st_size
            if segment_bytes >= MAX_OUTPUT_BYTES:
                raise RenderError("RENDER_LIMIT", "Encoded picture segments exceed 128 MiB. The render cannot fit its output byte allowance.")
            segment_info = _probe(ffprobe, directory / name, deadline)
            if abs(float(segment_info.get("format", {}).get("duration", 0)) - duration) > 1 / FPS / 2:
                raise RenderError("SOURCE_RANGE", "A source did not supply the selected number of picture frames.")
            names.append(name)
        manifest = directory / "segments.txt"
        manifest.write_text("".join(f"file '{name}'\n" for name in names), encoding="utf-8")
        inputs = ["-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", str(manifest)]
        # Each row is independently timed. Cache bytes/probes once, even when the
        # same take supplies many excerpts. At most 16 decoders plus one floating
        # accumulator are open in each pass; limit only the final mix, avoiding
        # intermediate clipping or normalization changes between batches.
        audio_rows: list[tuple[RenderAsset, Path, float, float, float, float]] = []
        for cue in plan.audio_cues:
            source, info = source_file(cue.asset)
            _check_stream(info, "audio", cue.source_in_sec + cue.duration)
            if cue.gain:
                audio_rows.append((cue.asset, source, cue.source_in_sec, cue.duration, cue.start, cue.gain))
        for cue in native_audio:
            audio_rows.append((cue.segment.asset, cue.path, cue.source_in_sec, cue.duration_sec,
                               cue.output_start_sec, cue.segment.audio_gain))
        accumulator: Path | None = None
        mix_limit = math.ceil(plan.duration_sec * 48000) * 2 * 4 + 8192
        for batch_start in range(0, len(audio_rows), AUDIO_MIX_BATCH_SIZE):
            batch = audio_rows[batch_start:batch_start + AUDIO_MIX_BATCH_SIZE]
            mix_inputs: list[str] = []
            audio_filters: list[str] = []
            if accumulator:
                mix_inputs += ["-f", "wav", "-i", str(accumulator)]
                audio_filters.append("[0:a:0]anull[bed]")
                input_offset = 1
            else:
                audio_filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={plan.duration_sec}[bed]")
                input_offset = 0
            for i, (asset, path, source_in, duration, start, gain) in enumerate(batch):
                mix_inputs += _input_options(asset, path)
                audio_filters.append(f"[{i + input_offset}:a:0]atrim=start={source_in}:duration={duration},"
                                     f"asetpts=PTS-STARTPTS,aresample=48000,volume={gain},"
                                     f"adelay={round(start * 48000)}S:all=1[a{i}]")
            audio_filters.append("[bed]" + "".join(f"[a{i}]" for i in range(len(batch))) +
                                 f"amix=inputs={len(batch) + 1}:duration=first:normalize=0,"
                                 f"atrim=duration={plan.duration_sec}[mixed]")
            next_mix = directory / f"mix-{(batch_start // AUDIO_MIX_BATCH_SIZE) % 2}.wav"
            _run(base + mix_inputs + ["-filter_complex", ";".join(audio_filters), "-map", "[mixed]",
                 "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-t", str(plan.duration_sec),
                 "-fs", str(mix_limit), str(next_mix)], deadline)
            mix_info = _probe(ffprobe, next_mix, deadline)
            if next_mix.stat().st_size >= mix_limit or abs(float(mix_info.get("format", {}).get("duration", 0)) - plan.duration_sec) > 1 / 48000:
                raise RenderError("RENDER_FAILED", "The audio mix did not match the planned scene duration.")
            if accumulator:
                accumulator.unlink()
            accumulator = next_mix
        output_options = ["-map", "0:v:0", "-c:v", "copy"]
        if accumulator:
            inputs += ["-f", "wav", "-i", str(accumulator)]
            output_options += ["-map", "1:a:0", "-af", "alimiter=limit=0.95:level=false:latency=true",
                               "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
        else:
            output_options += ["-an"]
        output = directory / "cut.mp4"
        _run(base + inputs + output_options + ["-t", str(plan.duration_sec), "-movflags", "+faststart",
             "-map_metadata", "-1", "-fflags", "+bitexact", "-fs", str(MAX_OUTPUT_BYTES), str(output)], deadline)
        info = _probe(ffprobe, output, deadline)
        duration = float(info.get("format", {}).get("duration", 0))
        if abs(duration - plan.duration_sec) > 1 / FPS or output.stat().st_size >= MAX_OUTPUT_BYTES:
            raise RenderError("RENDER_FAILED", "The encoded output did not match the planned cut duration or size limit.")
        data = output.read_bytes()
    provenance = {
        "kind": "local-ffmpeg-render", "width": WIDTH, "height": HEIGHT, "fps": FPS,
        "limits": {"sceneSeconds": MAX_DURATION, "executionSeconds": timeout_sec, "audioBatchSize": AUDIO_MIX_BATCH_SIZE},
        "plannedDurationSec": plan.duration_sec, "durationSec": duration, "sha256": hashlib.sha256(data).hexdigest(),
        "pictureClips": [{"clipId": s.clip_id, "shotId": s.shot_id, "assetId": s.asset.asset_id,
                          "assetSha256": hashlib.sha256(s.asset.data).hexdigest(), "start": s.requested_start_sec,
                          "duration": s.requested_duration_sec, "renderedStartSec": s.start_frame / FPS,
                          "renderedDurationSec": s.frame_count / FPS, "sourceInSec": s.source_in_sec,
                          "sourceOutSec": s.source_out_sec, "alignment": s.alignment,
                          "audioGainRequested": s.audio_gain,
                          "audioGainEffective": 0 if s.audio_muted else s.audio_gain,
                          "audioMuted": s.audio_muted,
                          "mediaKind": "still" if s.asset.mime_type in IMAGE_FORMATS else "video"}
                         for s in plan.segments if s.asset],
        "audioCues": [{"assetId": c.asset.asset_id, "assetSha256": hashlib.sha256(c.asset.data).hexdigest(),
                       "start": c.start, "duration": c.duration, "sourceInSec": c.source_in_sec, "gain": c.gain}
                      for c in plan.audio_cues],
        "nativeAudioClips": [{"clipId": cue.segment.clip_id, "assetId": cue.segment.asset.asset_id,
                              "start": cue.output_start_sec, "duration": cue.duration_sec,
                              "sourceInSec": cue.source_in_sec, "gain": cue.segment.audio_gain,
                              "audioGainRequested": cue.segment.audio_gain,
                              "audioGainEffective": 0 if cue.segment.audio_muted else cue.segment.audio_gain,
                              "audioMuted": cue.segment.audio_muted}
                             for cue in native_audio],
    }
    return RenderResult(data, duration, provenance, plan.warnings)
