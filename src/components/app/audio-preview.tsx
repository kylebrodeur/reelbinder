import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineAudioClip } from "@/lib/types";
import {
  buildTimelineAudioCues,
  timelineAudioPosition,
  type PlannedTimelineAudioCue,
} from "@/lib/timeline-audio";

export interface AudioPreviewProps {
  clips: TimelineAudioClip[];
  cutDuration: number;
  time: number;
  playing: boolean;
  /** Listening control only. Persisted cue mute is already in the shared plan. */
  muted: boolean;
  /** The edit transport should pause on an audio stall/error to retain sync. */
  onPlaybackIssue?: (message: string) => void;
}
type AudioGraph = { source: MediaElementAudioSourceNode; gain: GainNode };

/** Explicit cues only; the picture player remains responsible for native video sound. */
export function AudioPreview({
  clips,
  cutDuration,
  time,
  playing,
  muted,
  onPlaybackIssue,
}: AudioPreviewProps) {
  const result = useMemo(() => {
    try {
      return { cues: buildTimelineAudioCues(clips, cutDuration), error: "" };
    } catch (error) {
      return {
        cues: [] as PlannedTimelineAudioCue[],
        error: error instanceof Error ? error.message : "Audio timing is invalid.",
      };
    }
  }, [clips, cutDuration]);
  const [issue, setIssue] = useState("");
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const graphs = useRef(new Map<HTMLAudioElement, AudioGraph>());
  const context = useRef<AudioContext | null>(null);
  const pending = useRef(new WeakSet<HTMLAudioElement>());
  const unlocking = useRef(new WeakSet<HTMLAudioElement>());
  const blocked = useRef(false);
  const mounted = useRef(true);
  const disposal = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registrations = useMemo(
    () =>
      new Map(
        result.cues.map((cue) => [
          cue.clipId,
          (audio: HTMLAudioElement | null) => {
            if (audio) elements.current.set(cue.clipId, audio);
            else {
              // Detached HTML media can keep playing. Pause it before dropping our ref.
              elements.current.get(cue.clipId)?.pause();
              elements.current.delete(cue.clipId);
            }
          },
        ]),
      ),
    [result.cues],
  );
  const latest = useRef({
    cues: result.cues,
    error: result.error,
    time,
    playing,
    muted,
    onPlaybackIssue,
  });
  latest.current = {
    cues: result.cues,
    error: result.error,
    time,
    playing,
    muted,
    onPlaybackIssue,
  };

  const pauseAll = useCallback(() => {
    for (const audio of elements.current.values()) audio.pause();
  }, []);
  const report = useCallback(
    (message: string) => {
      if (!mounted.current) return;
      const first = !blocked.current;
      blocked.current = true;
      pauseAll();
      setIssue(message);
      if (first) latest.current.onPlaybackIssue?.(message);
    },
    [pauseAll],
  );

  const gainFor = useCallback(
    (audio: HTMLAudioElement, gain: number) => {
      let graph = graphs.current.get(audio);
      // HTMLMediaElement.volume cannot amplify. Create Web Audio only when needed,
      // and retain its one allowed source node for this particular media element.
      if (gain > 1 && !graph) {
        const AudioContextClass =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass)
          throw new Error(
            "This browser cannot preview gain above 1. Lower the gain or use a browser with Web Audio.",
          );
        context.current ??= new AudioContextClass();
        const source = context.current.createMediaElementSource(audio);
        const gainNode = context.current.createGain();
        source.connect(gainNode);
        gainNode.connect(context.current.destination);
        graph = { source, gain: gainNode };
        graphs.current.set(audio, graph);
      }
      if (graph) {
        audio.volume = 1;
        graph.gain.gain.setValueAtTime(gain, context.current!.currentTime);
        if (context.current?.state === "suspended") {
          void context.current
            .resume()
            .catch(() => report("Audio could not start. Enable audio below, then play the edit."));
          // Do not advance silently while a browser gesture is required.
          report("Audio needs a browser gesture. Enable audio below, then play the edit.");
          return false;
        }
      } else audio.volume = gain;
      return true;
    },
    [report],
  );

  const sync = useCallback(() => {
    const state = latest.current;
    if (state.error) {
      pauseAll();
      return;
    }
    for (const cue of state.cues) {
      const audio = elements.current.get(cue.clipId);
      if (!audio) continue;
      if (unlocking.current.has(audio)) continue;
      const outputActive =
        Number.isFinite(state.time) &&
        state.time >= cue.start &&
        state.time < cue.start + cue.duration;
      if (
        outputActive &&
        state.playing &&
        !state.muted &&
        cue.gain > 0 &&
        audio.readyState >= 1 &&
        Number.isFinite(audio.duration) &&
        cue.sourceInSec + cue.duration > audio.duration + 0.02
      ) {
        report(
          `The source for “${cue.label}” is shorter than its saved trim. Correct the clip before playback.`,
        );
        return;
      }
      const position = timelineAudioPosition(cue, state.time, audio.duration);
      audio.muted = state.muted || cue.gain === 0;
      if (!position.active || !state.playing || state.muted || cue.gain === 0 || blocked.current) {
        audio.pause();
        // Seek while paused too, so scrubbing never leaves an old cue playing.
        if (audio.readyState >= 1 && Math.abs(audio.currentTime - position.sourceTime) > 0.015) {
          try {
            audio.currentTime = position.sourceTime;
          } catch {
            /* Metadata may be changing. */
          }
        }
        continue;
      }
      if (audio.readyState < 2) {
        report(`Buffering “${cue.label}”. Wait for it to load, then play the edit again.`);
        return;
      }
      try {
        if (!gainFor(audio, cue.gain)) return;
        if (Math.abs(audio.currentTime - position.sourceTime) > 0.12)
          audio.currentTime = position.sourceTime;
      } catch (error) {
        report(
          error instanceof Error ? error.message : "Audio could not seek to the selected source.",
        );
        return;
      }
      if (audio.paused && !pending.current.has(audio)) {
        pending.current.add(audio);
        void audio
          .play()
          .then(() => {
            const current = latest.current;
            const updated = current.cues.find((item) => item.clipId === cue.clipId);
            if (
              !mounted.current ||
              blocked.current ||
              !current.playing ||
              current.muted ||
              !updated ||
              updated.url !== cue.url ||
              elements.current.get(cue.clipId) !== audio ||
              updated.gain === 0 ||
              !timelineAudioPosition(updated, current.time, audio.duration).active
            )
              audio.pause();
          })
          .catch((error: unknown) => {
            const current = latest.current;
            const updated = current.cues.find((item) => item.clipId === cue.clipId);
            if (
              !current.playing ||
              current.muted ||
              blocked.current ||
              !updated ||
              updated.url !== cue.url ||
              elements.current.get(cue.clipId) !== audio ||
              !timelineAudioPosition(cue, current.time, audio.duration).active
            )
              return;
            report(
              error instanceof DOMException && error.name === "NotAllowedError"
                ? "The browser blocked audio playback. Enable audio below, then play the edit."
                : `Could not play “${cue.label}”. Check its session access and try playback again.`,
            );
          })
          .finally(() => pending.current.delete(audio));
      }
    }
  }, [gainFor, pauseAll, report]);

  useEffect(() => {
    mounted.current = true;
    if (disposal.current !== null) clearTimeout(disposal.current);
    return () => {
      mounted.current = false;
      pauseAll();
      // React StrictMode replays effects on the same media element. Defer final
      // disposal so it does not attempt a forbidden second Web Audio source.
      disposal.current = setTimeout(() => {
        if (mounted.current) return;
        for (const [audio, graph] of graphs.current) {
          audio.pause();
          graph.source.disconnect();
          graph.gain.disconnect();
        }
        graphs.current.clear();
        const old = context.current;
        context.current = null;
        if (old && old.state !== "closed") void old.close().catch(() => {});
      }, 0);
    };
  }, [pauseAll]);
  useEffect(() => {
    // A deliberate new transport play retries previously paused cues. No asset
    // import or provider request is repeated by this playback retry.
    if (playing) {
      blocked.current = false;
      setIssue("");
    } else pauseAll();
  }, [playing, pauseAll]);
  useEffect(() => {
    const currentElements = new Set(elements.current.values());
    for (const [audio, graph] of graphs.current)
      if (!currentElements.has(audio)) {
        audio.pause();
        graph.source.disconnect();
        graph.gain.disconnect();
        graphs.current.delete(audio);
      }
    sync();
  }, [result, time, playing, muted, sync]);
  useEffect(() => {
    if (result.error && playing) report(result.error);
  }, [result.error, playing, report]);

  const stalled = (cue: PlannedTimelineAudioCue) => {
    const state = latest.current;
    const current = state.cues.find((item) => item.clipId === cue.clipId && item.url === cue.url);
    if (
      current &&
      state.playing &&
      !state.muted &&
      current.gain > 0 &&
      timelineAudioPosition(current, state.time).active
    )
      report(`Playback stalled on “${cue.label}”. Wait for it to load, then play the edit again.`);
  };
  function enable() {
    try {
      if (context.current?.state === "suspended")
        void context.current
          .resume()
          .catch(() =>
            report(
              "The browser could not enable amplified audio. Check audio permissions and try again.",
            ),
          );
      blocked.current = false;
      setIssue("");
      // Invoke play synchronously inside this button gesture, even when the
      // parent paused its transport after NotAllowedError. Prime future cues too.
      for (const cue of latest.current.cues) {
        const audio = elements.current.get(cue.clipId);
        if (!audio || unlocking.current.has(audio)) continue;
        unlocking.current.add(audio);
        audio.muted = false;
        audio.volume = 0;
        graphs.current.get(audio)?.gain.gain.setValueAtTime(0, context.current!.currentTime);
        void audio
          .play()
          .then(() => {
            audio.pause();
          })
          .catch(() =>
            report(
              `The browser could not enable “${cue.label}”. Check its session access and audio permissions.`,
            ),
          )
          .finally(() => {
            unlocking.current.delete(audio);
            audio.pause();
            audio.muted = latest.current.muted || cue.gain === 0;
            if (mounted.current && elements.current.get(cue.clipId) === audio) sync();
          });
      }
    } catch {
      report("The browser could not enable audio. Check audio permissions and try again.");
    }
  }
  return (
    <>
      {result.cues.map((cue) => (
        <audio
          key={`${cue.clipId}:${cue.url}`}
          ref={registrations.get(cue.clipId)}
          src={cue.url}
          preload="auto"
          className="hidden"
          aria-hidden="true"
          onLoadedMetadata={sync}
          onCanPlay={sync}
          onWaiting={() => stalled(cue)}
          onStalled={() => stalled(cue)}
          onEnded={sync}
          onError={() =>
            report(
              `Audio “${cue.label}” is unavailable or could not be decoded. Restore its source before playing the edit.`,
            )
          }
        />
      ))}
      {(result.error || issue) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
        >
          <span className="min-w-0 flex-1">{result.error || issue}</span>
          {!result.error && (
            <Button type="button" size="sm" variant="outline" onClick={() => void enable()}>
              Enable audio
            </Button>
          )}
        </div>
      )}
    </>
  );
}
