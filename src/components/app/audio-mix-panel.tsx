import { Music2, Plus, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MediaStudio } from "@/components/app/media-studio";
import { useSlate } from "@/lib/store";
import { ensureTimeline } from "@/lib/timeline";
import { MAX_SCENE_SECONDS, MAX_IMPORTED_WAV_SECONDS, MAX_IMPORTED_WAV_BYTES } from "@/lib/scene-limits";
import type { CinemaMediaAsset } from "@/lib/cinema-media";
import type { EditTimeline, Project, TimelineAudioClip, TimelineClip } from "@/lib/types";
import {
  AUDIO_TRACK_LABEL,
  MAX_AUDIO_CUES,
  buildTimelineAudioCues,
  createTimelineAudioClip,
  editTimelineAudioClip,
  importTimelineWav,
  pictureAudioGain,
  timelineAudioCutDuration,
  validateTimelineAudioAsset,
  validateTimelineAudioClips,
  type AudioClipPatch,
  type AudioTrack,
} from "@/lib/timeline-audio";

const seconds = (value: number) => `${Number(value.toFixed(3))} s`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The audio change could not be saved.";
const selectStyle = "h-8 rounded-md border border-border bg-background px-2 text-xs";

function AudioClipEditor({
  clip,
  save,
  remove,
}: {
  clip: TimelineAudioClip;
  save: (patch: AudioClipPatch) => boolean;
  remove: () => void;
}) {
  const [draft, setDraft] = useState({
    label: clip.label,
    track: clip.track,
    start: String(clip.start),
    duration: String(clip.duration),
    sourceInSec: String(clip.sourceInSec),
    gain: String(clip.gain),
  });
  useEffect(() => {
    setDraft({
      label: clip.label,
      track: clip.track,
      start: String(clip.start),
      duration: String(clip.duration),
      sourceInSec: String(clip.sourceInSec),
      gain: String(clip.gain),
    });
  }, [clip.label, clip.track, clip.start, clip.duration, clip.sourceInSec, clip.gain]);
  const field = (
    key: "start" | "duration" | "sourceInSec" | "gain",
    label: string,
    max: number,
  ) => (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input
        aria-label={`${clip.label}: ${label}`}
        className="h-8 min-w-0 text-xs"
        type="number"
        min={0}
        max={max}
        step={key === "gain" ? "0.1" : "0.001"}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        required
      />
    </label>
  );
  return (
    <form
      className={`grid gap-3 rounded-lg border p-3 ${clip.muted ? "border-border/50 bg-muted/20" : "border-border"}`}
      onSubmit={(event) => {
        event.preventDefault();
        save({
          label: draft.label.trim(),
          track: draft.track,
          start: Number(draft.start),
          duration: Number(draft.duration),
          sourceInSec: Number(draft.sourceInSec),
          gain: Number(draft.gain),
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          className="h-8 min-w-0 flex-1 text-xs"
          aria-label={`${clip.label}: Clip name`}
          value={draft.label}
          maxLength={200}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          required
        />
        <select
          className={selectStyle}
          aria-label={`${clip.label}: Audio track`}
          value={draft.track}
          onChange={(event) => setDraft({ ...draft, track: event.target.value as AudioTrack })}
        >
          {Object.entries(AUDIO_TRACK_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${clip.muted ? "Unmute" : "Mute"} ${clip.label} in the mix`}
          aria-pressed={clip.muted}
          title="Saved mix mute affects preview and export"
          onClick={() => save({ muted: !clip.muted })}
        >
          {clip.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          {clip.muted ? "Muted" : "On"}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Remove ${clip.label}`}
          title="Remove audio clip; Undo restores it"
          onClick={remove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {field("start", "Edit start (s)", MAX_SCENE_SECONDS)}
        {field("sourceInSec", "Source in (s)", clip.durationSec)}
        {field("duration", "Duration (s)", clip.durationSec)}
        {field("gain", "Gain (0–4)", 4)}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          Source {seconds(clip.durationSec)} · selected {seconds(clip.sourceInSec)}–
          {seconds(clip.sourceInSec + clip.duration)}
        </span>
        <Button type="submit" size="sm" variant="outline">
          Save clip
        </Button>
      </div>
    </form>
  );
}

function SourceAudioEditor({
  clip,
  save,
}: {
  clip: TimelineClip;
  save: (gain: number, muted: boolean) => void;
}) {
  const [gain, setGain] = useState(String(clip.audioGain ?? 1));
  useEffect(() => setGain(String(clip.audioGain ?? 1)), [clip.audioGain]);
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        save(Number(gain), clip.audioMuted ?? false);
      }}
    >
      <div className="min-w-32 flex-1 text-xs">
        <span>{clip.label || "Picture excerpt"}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">
          {seconds(clip.start)}–{seconds(clip.start + clip.duration)}
        </span>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        Gain
        <Input
          aria-label={`Source audio gain at ${clip.start} seconds`}
          className="h-8 w-20 text-xs"
          type="number"
          min={0}
          max={4}
          step={0.1}
          value={gain}
          required
          onChange={(event) => setGain(event.target.value)}
        />
      </label>
      <Button type="submit" size="sm" variant="outline">
        Set
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`${clip.audioMuted ? "Unmute" : "Mute"} source audio at ${clip.start} seconds`}
        aria-pressed={clip.audioMuted ?? false}
        onClick={() => save(clip.audioGain ?? 1, !clip.audioMuted)}
      >
        {clip.audioMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        {clip.audioMuted ? "Muted" : "On"}
      </Button>
    </form>
  );
}

/** Store mutations use patchProject, so edits and removal participate in existing Undo. */
export function AudioMixPanel({ timeline }: { timeline?: EditTimeline }) {
  const project = useSlate((state) => state.project);
  const [track, setTrack] = useState<AudioTrack>("voiceover");
  const [musicId, setMusicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generateMusicOpen, setGenerateMusicOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setMusicId("");
  }, [project.id]);
  const effectiveTimeline = timeline ?? project.timeline;
  const latestTimeline = useRef({ project, effectiveTimeline });
  latestTimeline.current = { project, effectiveTimeline };
  function currentEdit(current: Project): EditTimeline {
    const latest = latestTimeline.current;
    // Preserve the IDs of a displayed, not-yet-saved coverage draft. If an async
    // import outlived edits, resolve today's timeline instead of its old closure.
    return latest.project.id === current.id &&
      latest.project.timeline === current.timeline &&
      latest.project.shots === current.shots &&
      latest.project.script === current.script
      ? latest.effectiveTimeline
      : ensureTimeline(current);
  }
  const state = useMemo(() => {
    try {
      const duration = timelineAudioCutDuration(effectiveTimeline);
      try {
        buildTimelineAudioCues(project.audioClips ?? [], duration);
        return { duration, issue: "" };
      } catch (error) {
        return { duration, issue: message(error) };
      }
    } catch (error) {
      return { duration: 0, issue: message(error) };
    }
  }, [effectiveTimeline, project.audioClips]);
  const music = (project.musicAssets ?? []).filter((asset) => {
    try {
      validateTimelineAudioAsset(asset);
      return true;
    } catch {
      return false;
    }
  });
  const clips = Array.isArray(project.audioClips) ? project.audioClips : [];
  const rows = useMemo(
    () =>
      clips.map((clip, index) => {
        try {
          validateTimelineAudioClips([clip]);
          if (clips.some((other, otherIndex) => otherIndex !== index && other?.id === clip.id))
            throw new Error("Duplicate audio clip ID.");
          return { index, clip, error: "" };
        } catch (error) {
          return { index, clip: null, error: message(error) };
        }
      }),
    [project.audioClips],
  );
  const canAdd = state.duration > 0 && clips.length < MAX_AUDIO_CUES && !busy;
  const videoSource = (clip: TimelineClip) =>
    clip.sourceVideoUrl ||
    (!clip.sourceFrameUrl ? project.shots.find((shot) => shot.id === clip.shotId)?.videoUrl : null);
  const picture = effectiveTimeline.clips.filter(
    (clip) => clip.track === "picture" && videoSource(clip),
  );

  function saveClip(id: string, patch: AudioClipPatch) {
    try {
      const current = useSlate.getState();
      if (current.project.id !== project.id)
        throw new Error("The active project changed. Reopen its audio mix.");
      const audioClips = editTimelineAudioClip(
        current.project.audioClips ?? [],
        id,
        patch,
        timelineAudioCutDuration(currentEdit(current.project)),
      );
      current.patchProject({ audioClips });
      setError("");
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    }
  }
  function addAsset(
    asset: CinemaMediaAsset,
    kind: AudioTrack,
    label: string,
    projectId = project.id,
  ) {
    const current = useSlate.getState();
    if (current.project.id !== projectId)
      throw new Error(
        "The active project changed while importing audio. Its bytes were saved to this session; no other project was edited.",
      );
    const duration = timelineAudioCutDuration(currentEdit(current.project));
    const next = [
      ...(current.project.audioClips ?? []),
      createTimelineAudioClip(asset, kind, duration, { label }),
    ];
    buildTimelineAudioCues(next, duration);
    current.patchProject({ audioClips: next });
  }
  async function importWav(file: File) {
    if (importing.current) return;
    importing.current = true;
    const projectId = project.id,
      kind = track;
    setBusy(true);
    setError("");
    try {
      const asset = await importTimelineWav(file);
      addAsset(
        asset,
        kind,
        file.name.replace(/\.wav$/i, "").slice(0, 200) || AUDIO_TRACK_LABEL[kind],
        projectId,
      );
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      importing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function saveNative(clipId: string, gain: number, muted: boolean) {
    try {
      pictureAudioGain({ audioGain: gain, audioMuted: muted });
      const current = useSlate.getState();
      if (current.project.id !== project.id)
        throw new Error("The active project changed. Reopen its audio mix.");
      const currentTimeline = currentEdit(current.project);
      const target = currentTimeline.clips.find(
        (clip) => clip.id === clipId && clip.track === "picture",
      );
      if (!target) throw new Error("This picture excerpt no longer exists.");
      const sourceVideoUrl =
        target.sourceVideoUrl ||
        (!target.sourceFrameUrl
          ? current.project.shots.find((shot) => shot.id === target.shotId)?.videoUrl
          : null);
      if (!sourceVideoUrl) throw new Error("This excerpt no longer has a selected video source.");
      current.patchProject({
        timeline: {
          ...currentTimeline,
          clips: currentTimeline.clips.map((clip) =>
            clip.id === clipId
              ? { ...clip, sourceVideoUrl, audioGain: gain, audioMuted: muted }
              : clip,
          ),
        },
      });
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label="Audio mix"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Music2 className="size-4" />
            Audio mix
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved clip gain and mute affect preview and export. The player's listening mute stays
            local.
          </p>
        </div>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {clips.length}/{MAX_AUDIO_CUES} added clips
        </span>
      </div>
      {!!picture.length && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium">Source dialogue and effects</h4>
          {picture.map((clip) => (
            <SourceAudioEditor
              key={clip.id}
              clip={clip}
              save={(gain, muted) => saveNative(clip.id, gain, muted)}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectStyle}
          aria-label="Imported audio track"
          value={track}
          onChange={(event) => setTrack(event.target.value as AudioTrack)}
        >
          {Object.entries(AUDIO_TRACK_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          onClick={() => upload.current?.click()}
        >
          <Upload className="size-3.5" />
          {busy ? "Importing WAV…" : "Import WAV"}
        </Button>
        <input
          ref={upload}
          className="hidden"
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          aria-label="Import PCM WAV audio"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importWav(file);
          }}
        />
        <Dialog open={generateMusicOpen} onOpenChange={setGenerateMusicOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAdd}
              className="gap-1.5"
            >
              <Music2 className="size-3.5" />
              Generate music
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Generate Music Cue</DialogTitle>
              <DialogDescription>
                Create an original instrumental score or atmospheric cue for the timeline cut.
              </DialogDescription>
            </DialogHeader>
            <MediaStudio
              project={project}
              shot={null}
              mode="music"
              onVideo={() => {}}
              onMusic={(asset) => {
                const current = useSlate.getState();
                if (current.project.id !== project.id) return;
                const nextMusic = [
                  ...(current.project.musicAssets ?? []).filter(
                    (item) => item.assetId !== asset.assetId,
                  ),
                  asset,
                ];
                current.patchProject({ musicAssets: nextMusic });
                try {
                  const label = `Music ${nextMusic.length}`;
                  addAsset(asset, "music", label);
                  setError("");
                  setGenerateMusicOpen(false);
                } catch (err) {
                  setError(message(err));
                }
              }}
            />
          </DialogContent>
        </Dialog>
        {!!music.length && (
          <>
            <select
              className={`${selectStyle} max-w-60`}
              aria-label="Generated music to add"
              value={musicId}
              onChange={(event) => setMusicId(event.target.value)}
            >
              <option value="">Choose generated music…</option>
              {music.map((asset, index) => (
                <option key={asset.assetId} value={asset.assetId}>
                  Music {index + 1} · {seconds(asset.durationSec)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAdd || !musicId}
              onClick={() => {
                try {
                  const asset = music.find((item) => item.assetId === musicId);
                  if (!asset) throw new Error("Choose a generated music asset.");
                  addAsset(
                    asset,
                    "music",
                    `Music ${music.findIndex((item) => item.assetId === musicId) + 1}`,
                  );
                  setError("");
                } catch (error) {
                  setError(message(error));
                }
              }}
            >
              <Plus className="size-3.5" />
              Add music
            </Button>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        WAV: 48 kHz mono/stereo, 16/24/32-bit integer PCM, up to {MAX_IMPORTED_WAV_SECONDS} seconds and {MAX_IMPORTED_WAV_BYTES / (1024 * 1024)} MiB. Picture edit:{" "}
        {seconds(state.duration)}.
      </p>
      {(error || state.issue) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
        >
          {error || state.issue}
        </p>
      )}
      {!clips.length && (
        <p className="text-xs text-muted-foreground">
          {state.duration > 0
            ? "Import voice-over or effects, or add a generated music take. Each clip gets its own timing and gain."
            : "Build a picture edit before adding audio."}
        </p>
      )}
      <div className="space-y-3">
        {rows.map(({ clip, index, error: rowError }) =>
          clip ? (
            <AudioClipEditor
              key={clip.id}
              clip={clip}
              save={(patch) => saveClip(clip.id, patch)}
              remove={() => {
                const current = useSlate.getState();
                if (current.project.id === project.id) {
                  current.patchProject({
                    audioClips: (current.project.audioClips ?? []).filter(
                      (item) => item.id !== clip.id,
                    ),
                  });
                  setError("");
                }
              }}
            />
          ) : (
            <div
              key={`invalid-audio-${index}`}
              role="alert"
              className="flex items-center gap-3 rounded-md border border-destructive/30 p-3 text-xs"
            >
              <span className="flex-1">
                Audio clip {index + 1}: {rowError}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const current = useSlate.getState();
                  if (
                    current.project.id === project.id &&
                    current.project.audioClips === project.audioClips
                  )
                    current.patchProject({
                      audioClips: clips.filter((_, position) => position !== index),
                    });
                }}
              >
                Remove invalid clip
              </Button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
