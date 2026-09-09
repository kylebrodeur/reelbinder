import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export interface NativePreviewAudioOptions {
  mediaKey: string | null | undefined;
  gain: number;
  muted: boolean;
  onPlaybackIssue?: (message: string) => void;
}
type Mix = Pick<NativePreviewAudioOptions, "gain" | "muted">;
type Graph = { source: MediaElementAudioSourceNode; gain: GainNode; connected: boolean };

function browserAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}

/** Small injectable media controller so lifecycle behavior can be tested without playback. */
export function createNativePreviewAudioController({
  createAudioContext = browserAudioContext,
  onPlaybackIssue,
  resumeTimeoutMs = 1500,
}: {
  createAudioContext?: () => AudioContext | null;
  onPlaybackIssue?: (message: string) => void;
  resumeTimeoutMs?: number;
} = {}) {
  let video: HTMLVideoElement | null = null;
  let mix: Mix = { gain: 1, muted: false };
  let context: AudioContext | null = null;
  let graphs = new WeakMap<HTMLVideoElement, Graph>();
  let disposed = false;
  let issue = "";
  let resume: Promise<void> | null = null;
  let resumeEpoch = 0;
  let awaitingResume = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let issueRevision = 0;

  function silence() {
    if (!video) return;
    video.pause();
    video.muted = true;
    video.volume = 0;
    const graph = graphs.get(video);
    if (graph && context && context.state !== "closed")
      graph.gain.gain.setValueAtTime(0, context!.currentTime);
  }
  function fail(message: string, defer = false) {
    silence();
    if (disposed || message === issue) return;
    issue = message;
    const revision = ++issueRevision;
    const notify = () => {
      if (disposed || issueRevision !== revision || issue !== message) return;
      // A caller may have invoked video.play() immediately after prime().
      // Pause again after that handler and ask the transport to stop as well.
      silence();
      onPlaybackIssue?.(message);
    };
    if (defer) queueMicrotask(notify);
    else notify();
  }
  function detach() {
    if (!video) return;
    silence();
    const graph = graphs.get(video);
    if (graph?.connected) {
      graph.source.disconnect();
      graph.gain.disconnect();
      graph.connected = false;
    }
    video = null;
  }
  function configure(allowSuspended = false, deferFailure = false) {
    if (disposed || !video) return;
    if (
      !Number.isFinite(mix.gain) ||
      mix.gain < 0 ||
      mix.gain > 4 ||
      typeof mix.muted !== "boolean"
    ) {
      fail("Source audio needs a gain from 0 to 4 and a valid mute setting.", deferFailure);
      return;
    }
    try {
      let graph = graphs.get(video);
      if (!graph && mix.gain > 1) {
        context ??= createAudioContext();
        if (!context || context.state === "closed") {
          fail(
            "This browser cannot amplify source audio. Set gain to 1 or lower, or use a browser with Web Audio.",
            deferFailure,
          );
          return;
        }
        graph = {
          source: context.createMediaElementSource(video),
          gain: context.createGain(),
          connected: false,
        };
        graphs.set(video, graph);
      }
      if (graph) {
        if (!context || context.state === "closed") {
          fail("Source audio is unavailable. Reopen Edit before playing it again.", deferFailure);
          return;
        }
        if (!graph.connected) {
          graph.source.connect(graph.gain);
          graph.gain.connect(context.destination);
          graph.connected = true;
        }
        video.volume = 1;
        video.muted = mix.muted;
        graph.gain.gain.setValueAtTime(mix.muted ? 0 : mix.gain, context.currentTime);
        if (
          context.state !== "running" &&
          !mix.muted &&
          mix.gain > 0 &&
          !allowSuspended &&
          !(resume && awaitingResume)
        ) {
          fail(
            "Press Play edit to resume source audio. The browser suspended its audio output.",
            deferFailure,
          );
          return;
        }
      } else {
        // Browsers without Web Audio still support the full 0–1 attenuation range.
        video.volume = mix.gain;
        video.muted = mix.muted;
      }
      issue = "";
      issueRevision += 1;
    } catch {
      fail(
        "Source audio could not be initialized. Reopen Edit or lower its gain before playing.",
        deferFailure,
      );
    }
  }
  function bind(next: HTMLVideoElement | null, nextMix: Mix, priming = false) {
    if (disposed) return;
    if (next !== video) {
      detach();
      video = next;
    }
    mix = { ...nextMix };
    configure(priming, priming);
  }
  function prime(next: HTMLVideoElement | null, nextMix: Mix) {
    if (disposed) return;
    // All construction/resume calls below happen synchronously in the gesture.
    issue = "";
    bind(next, nextMix, true);
    if (!context || context.state === "closed" || context.state === "running") return;
    try {
      const activeContext = context;
      const epoch = ++resumeEpoch;
      awaitingResume = true;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resume = activeContext.resume();
      resumeTimer = setTimeout(() => {
        if (epoch !== resumeEpoch) return;
        awaitingResume = false;
        if (
          !disposed &&
          context === activeContext &&
          activeContext.state !== "running" &&
          !mix.muted &&
          mix.gain > 0
        )
          fail(
            "Press Play edit again to resume source audio. Its audio output is still suspended.",
          );
      }, resumeTimeoutMs);
      void resume
        .then(() => {
          if (disposed || context !== activeContext || epoch !== resumeEpoch) return;
          if (activeContext.state !== "running" && !mix.muted && mix.gain > 0)
            fail("The browser did not enable source audio. Press Play edit to try again.");
          else configure(true);
        })
        .catch(() => {
          if (!disposed && context === activeContext && epoch === resumeEpoch)
            fail(
              "The browser could not enable source audio. Check audio permissions, then press Play edit.",
            );
        })
        .finally(() => {
          if (epoch !== resumeEpoch) return;
          if (resumeTimer !== null) clearTimeout(resumeTimer);
          resumeTimer = null;
          resume = null;
          awaitingResume = false;
        });
    } catch {
      awaitingResume = false;
      resume = null;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
      fail(
        "The browser could not enable source audio. Check audio permissions, then press Play edit.",
        true,
      );
    }
  }
  function dispose() {
    if (disposed) return;
    detach();
    disposed = true;
    resumeEpoch += 1;
    awaitingResume = false;
    issueRevision += 1;
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = null;
    const old = context;
    context = null;
    graphs = new WeakMap();
    if (old && old.state !== "closed") void old.close().catch(() => {});
  }
  return { bind, prime, suspend: silence, dispose };
}

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Native picture audio only; explicit audio cues use AudioPreview's separate mixer. */
export function useNativePreviewAudio(
  videoRef: RefObject<HTMLVideoElement | null>,
  options: NativePreviewAudioOptions,
): { prime: () => void } {
  const latest = useRef({ videoRef, options });
  latest.current = { videoRef, options };
  const controller = useRef<ReturnType<typeof createNativePreviewAudioController> | null>(null);
  const disposal = useRef<ReturnType<typeof setTimeout> | null>(null);
  function getController() {
    return (controller.current ??= createNativePreviewAudioController({
      onPlaybackIssue: (message) => latest.current.options.onPlaybackIssue?.(message),
    }));
  }
  useBrowserLayoutEffect(() => {
    if (disposal.current !== null) clearTimeout(disposal.current);
    const active = getController();
    return () => {
      active.suspend();
      // StrictMode replays layout effects with the same video element. Keep its
      // sole MediaElementSource until an actual unmount survives the next task.
      disposal.current = setTimeout(() => {
        active.dispose();
        if (controller.current === active) controller.current = null;
      }, 0);
    };
  }, []);
  useBrowserLayoutEffect(() => {
    // Every commit catches replacement elements even when the media URL is equal.
    getController().bind(videoRef.current, options);
  });
  const prime = useCallback(() => {
    const current = latest.current;
    getController().prime(current.videoRef.current, current.options);
  }, []);
  return { prime };
}
