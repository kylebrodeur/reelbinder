import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clapperboard,
  FileText,
  Film,
  Layers,
  MapPin,
  Plus,
  RotateCcw,
  Scissors,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPreview } from "@/components/app/audio-preview";
import { pictureAudioGain } from "@/lib/timeline-audio";
import { useNativePreviewAudio } from "@/lib/use-native-preview-audio";
import { BlockingCanvas } from "@/components/app/blocking-canvas";
import { Inspector } from "@/components/app/inspector";
import { OverheadPlan } from "@/components/app/overhead-plan";
import { SidebarDock } from "@/components/app/sidebar-dock";
import { ProductionAssistantDock } from "@/components/app/production-assistant-dock";
import { ProductionDrawer } from "@/components/app/production-drawer";
import { ScriptCoverageTimeline } from "@/components/app/script-coverage-timeline";
import { formatTimecode } from "@/lib/timecode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MediaStudio } from "@/components/app/media-studio";
import { SourceRangeSeekbar } from "@/components/app/source-range-seekbar";
import { appendMediaVersions } from "@/lib/cinema-media";
import {
  coverageBeats,
  coverageChoices,
  movePictureClip,
  pictureClips,
  pictureDuration,
  selectCoverage,
  selectCoverageAtBeat,
  setPictureSourceRange,
  sourceTimeAt,
  splitPictureClip,
} from "@/lib/coverage-edit";
import { cameraForShot, figuresForShot } from "@/lib/floor";
import { coverageLabel } from "@/lib/lining";
import { buildTimeline, clipAtTime, ensureTimeline } from "@/lib/timeline";
import { useSlate } from "@/lib/store";
import type { EditTimeline } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EditView() {
  const project = useSlate((s) => s.project);
  const patchProject = useSlate((s) => s.patchProject);
  const selectShot = useSlate((s) => s.selectShot);
  const setView = useSlate((s) => s.setView);
  const [showOverhead, setShowOverhead] = useState(true);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<"excerpt" | "shot" | "copilot" | "book" | null>("excerpt");
  const [rebuildPrompt, setRebuildPrompt] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragAnchorRef = useRef<{ id: string } | null>(null);
  const [generateTakeOpen, setGenerateTakeOpen] = useState<"viewer" | "selected" | null>(null);
  const [media, setMedia] = useState<{
    key: string;
    duration: number;
    ready: boolean;
    error?: string;
  } | null>(null);
  const timeline = useMemo(
    () => ensureTimeline(project),
    [project.timeline, project.shots, project.script, project.id],
  );
  const ordered = useMemo(() => pictureClips(timeline), [timeline]);
  const beats = useMemo(() => coverageBeats(project), [project.script, project.shots]);
  const duration = pictureDuration(timeline);
  const picture = clipAtTime(timeline, Math.min(time, Math.max(0, duration - 0.001)));
  const shot = project.shots.find((s) => s.id === picture?.shotId);
  const selected = ordered.find((c) => c.id === selectedClipId) ?? picture ?? ordered[0];
  const selectedShot = project.shots.find((s) => s.id === selected?.shotId);
  const choices = useMemo(
    () => coverageChoices(project, selected?.storyElementIds ?? []),
    [project.script, project.shots, selected?.storyElementIds],
  );
  const capturedMedia = Boolean(picture?.sourceVideoUrl || picture?.sourceFrameUrl);
  const videoUrl = capturedMedia ? picture?.sourceVideoUrl : shot?.videoUrl;
  const frameUrl = capturedMedia ? picture?.sourceFrameUrl : shot?.frameUrl;
  const mediaKey = `${project.id}:${picture?.id ?? "gap"}:${videoUrl ?? ""}`;
  const mediaReady = !videoUrl || (media?.key === mediaKey && media.ready);
  const mediaError = media?.key === mediaKey ? media.error : undefined;
  const uncovered = beats.filter((b) => !b.candidates.length).length;
  const nativeGain = picture ? pictureAudioGain(picture) : 1;
  const nativeMuted = previewMuted || nativeGain === 0;
  const { prime: primeNativeAudio } = useNativePreviewAudio(videoRef, {
    mediaKey, gain: nativeGain, muted: nativeMuted,
    onPlaybackIssue: (issue) => { setPlaying(false); setMessage(issue); },
  });

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setPreviewMuted(false);
    setSelectedClipId(null);
    setDockTab("excerpt");
    setMessage("");
    setRebuildPrompt(false);
  }, [project.id]);

  useEffect(() => {
    if (project.timeline !== timeline && project.shots.length) patchProject({ timeline });
  }, [project.id, project.timeline, project.shots.length, timeline, patchProject]);

  useEffect(() => {
    if (picture?.shotId && (playing || dockTab !== "shot")) selectShot(picture.shotId);
    if (playing && picture?.id) setSelectedClipId(picture.id);
  }, [picture?.id, picture?.shotId, playing, dockTab, selectShot]);

  useEffect(() => {
    if (!playing || !mediaReady || mediaError) return;
    let raf = 0;
    // rAF timestamps can precede effect setup's performance.now(). Start from
    // the first frame so playback never steps before the first picture clip.
    let last: number | null = null;
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, now - last) / 1000;
      last = now;
      setTime((current) => Math.min(duration, current + delta));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, mediaReady, mediaError]);

  useEffect(() => {
    if (time >= duration && playing) setPlaying(false);
  }, [time, duration, playing]);

  // The edit clock seeks the chosen source excerpt. Media loading stalls the clock.
  // This does not align independently generated performances between different takes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !picture || !videoUrl || video.readyState < 1) return;
    const sourceTime = sourceTimeAt(picture, time);
    if (Number.isFinite(video.duration) && sourceTime >= video.duration) {
      video.pause();
      setPlaying(false);
      setMessage("This excerpt exceeds the video's actual duration. Adjust its source in/out.");
      return;
    }
    if (Math.abs(video.currentTime - sourceTime) > (playing ? 0.2 : 0.015))
      video.currentTime = sourceTime;
    if (playing && mediaReady && !mediaError && time < duration) {
      if (video.paused) {
        void video.play().catch(() => {
          setPlaying(false);
          setMessage("Playback paused. Press Play edit to try again.");
        });
      }
    } else if (!playing || mediaError) video.pause();
  }, [time, picture, videoUrl, playing, mediaReady, mediaError, duration]);

  const seek = (next: number, clipId?: string) => {
    videoRef.current?.pause();
    setPlaying(false);
    setTime(Math.max(0, Math.min(duration, next)));
    if (clipId) setSelectedClipId(clipId);
    else setSelectedClipId(clipAtTime(timeline, next)?.id ?? null);
    setMessage("");
  };

  const edit = (change: () => EditTimeline, focusId = selected?.id) => {
    try {
      const next = change();
      patchProject({ timeline: next });
      setPlaying(false);
      setMessage("");
      const focus = next.clips.find((c) => c.id === focusId) ?? pictureClips(next)[0];
      setSelectedClipId(focus?.id ?? null);
      setTime(focus?.start ?? 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The edit could not be applied.");
    }
  };

  const chooseAtBeat = (elementId: string, shotId: string, targetClipId?: string) => {
    const clip = ordered.find((c) => c.id === targetClipId);
    if (clip?.shotId === shotId) {
      seek(clip.start, clip.id);
      return;
    }
    try {
      const next = selectCoverageAtBeat(project, timeline, elementId, shotId, targetClipId);
      const previousIds = new Set(ordered.map((candidate) => candidate.id));
      const focus = next.clips.find(
        (candidate) =>
          candidate.shotId === shotId &&
          candidate.storyElementIds?.includes(elementId) &&
          (candidate.id === clip?.id || !previousIds.has(candidate.id)),
      );
      edit(() => next, focus?.id);
      setDockTab("excerpt");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Choose a valid covered beat.");
    }
  };

  const rebuild = () => {
    const draft = buildTimeline(project);
    edit(
      () => ({
        ...timeline,
        ...draft,
        clips: [...draft.clips, ...timeline.clips.filter((c) => c.track !== "picture")],
      }),
      draft.clips[0]?.id,
    );
    setRebuildPrompt(false);
  };

  const chooseTake = (url: string, target = picture, expectedProject = project) => {
    const current = useSlate.getState().project;
    if (current !== expectedProject || !target) return;
    const targetShot = current.shots.find((candidate) => candidate.id === target.shotId);
    const take = targetShot?.videoHistory?.find((candidate) => candidate.url && candidate.url === url);
    if (!take || take.url === target.sourceVideoUrl) return;
    edit(() => {
      const updated = {
        ...ensureTimeline(current),
        clips: ensureTimeline(current).clips.map((clip) =>
          clip.id === target.id ? { ...clip, sourceVideoUrl: take.url } : clip,
        ),
      };
      const sourceIn = target.sourceInSec ?? 0;
      const sourceOut = target.sourceOutSec ?? sourceIn + target.duration;
      return setPictureSourceRange(updated, target.id, sourceIn, sourceOut, take.asset?.durationSec);
    }, target.id);
  };

  if (!project.shots.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Line coverage in the script, then choose the picture edit here.
      </div>
    );
  }

  const selectedIndex = ordered.findIndex((c) => c.id === selected?.id);
  const sourceIn = selected?.sourceInSec ?? 0;
  const sourceOut = selected?.sourceOutSec ?? sourceIn + (selected?.duration ?? 0);
  const selectedVideo =
    selected?.sourceVideoUrl || (selected?.sourceFrameUrl ? undefined : selectedShot?.videoUrl);
  const knownDuration =
    selected?.id === picture?.id && selectedVideo && media?.key === mediaKey
      ? media.duration
      : undefined;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="size-4 text-foreground" />
          <span className="font-semibold text-foreground">Coverage & cut</span>
          <span className="opacity-40">·</span>
          <span>Edit sequence</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {dockTab === null && (
            <Button size="sm" variant="ghost" onClick={() => setDockTab("excerpt")}>
              <Settings2 /> Cut controls
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5 font-medium shadow-sm"
            onClick={() => setView("render")}
            title="Open Render pipeline to configure export settings, review reference cuts, and render your film"
          >
            <Clapperboard className="size-3.5 text-primary" />
            <span>Render cut</span>
          </Button>
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 font-medium shadow-sm bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => (ordered.length ? setRebuildPrompt(true) : rebuild())}
          >
            <RotateCcw className="size-3.5" />
            Build edit from coverage
          </Button>

        </div>
      </div>
      {rebuildPrompt ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-secondary px-4 py-2 text-xs">
          <span>
            Build a sequence from the script’s lined shots? This replaces the current picture edit.
            Audio cues stay in place, and you can Undo.
          </span>
          <Button size="sm" onClick={rebuild}>
            Replace picture edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRebuildPrompt(false)}>
            Keep current edit
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="shrink-0 border-b border-border bg-secondary px-4 py-2 text-xs">
          {message}
        </p>
      ) : null}

      <div className="flex min-h-[600px] min-w-0 flex-1 flex-col md:min-h-[300px] md:flex-row">
        <section
          aria-label="Edit preview"
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-3 sm:p-4"
        >
          <div className="flex h-full min-h-0 w-full min-w-0 max-w-4xl flex-col items-center justify-center">
            {picture && shot ? (
              <div className="relative flex h-full max-h-[85vh] w-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-2xl">
                {/* Cinema Screen */}
                <div className="relative flex min-h-0 flex-1 overflow-hidden bg-black">
                  {showOverhead && shot ? (
                    <div className="relative hidden w-1/3 min-w-[200px] border-r border-zinc-800 bg-zinc-950 p-2 sm:flex sm:flex-col">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Overhead
                      </p>
                      <div className="min-h-0 flex-1">
                        <OverheadPlan
                          shot={shot}
                          editable={false}
                          compact
                          fill
                          className="h-full w-full"
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
                    {videoUrl ? (
                    <video
                      key={mediaKey}
                      ref={videoRef}
                      src={videoUrl}
                      muted={nativeMuted}
                      playsInline
                      preload="auto"
                      className="h-full w-full object-contain"
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        video.currentTime = Math.min(
                          sourceTimeAt(picture, time),
                          Math.max(0, video.duration - 0.001),
                        );
                        setMedia({
                          key: mediaKey,
                          duration: video.duration,
                          ready: video.readyState >= 3,
                        });
                      }}
                      onCanPlay={(event) =>
                        setMedia({
                          key: mediaKey,
                          duration: event.currentTarget.duration,
                          ready: true,
                        })
                      }
                      onWaiting={(event) =>
                        setMedia({
                          key: mediaKey,
                          duration: event.currentTarget.duration,
                          ready: false,
                        })
                      }
                      onEnded={() => {
                        if (time + 0.1 < picture.start + picture.duration) {
                          setPlaying(false);
                          setMessage(
                            "The source ended before this excerpt. Adjust source out to the actual video length.",
                          );
                        }
                      }}
                      onError={() => {
                        setMedia({
                          key: mediaKey,
                          duration: 0,
                          ready: false,
                          error: "Source video unavailable.",
                        });
                        setPlaying(false);
                      }}
                    />
                  ) : frameUrl ? (
                    <img
                      src={frameUrl}
                      alt={shot.title}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full min-h-0 flex-1 overflow-hidden">
                      <BlockingCanvas
                        className="min-h-0 flex-1"
                        fill
                        sketch={shot.sketch}
                        annotations={shot.annotations}
                        overlayFigures={figuresForShot(project.floor, shot)}
                        overlayCam={cameraForShot(project.floor, shot)}
                        readOnly
                      />
                    </div>
                  )}
                  </div>
                </div>

                {/* Takes strip — quick take switcher + generate CTA */}
                {shot && (
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 overflow-x-auto">
                    <Film className="size-3 shrink-0 text-zinc-500" />
                    {shot.videoHistory && shot.videoHistory.length > 0 ? (
                      <>
                        {shot.videoHistory.map((take, idx) => {
                          const isActive = take.url && take.url === videoUrl;
                          return (
                            <button
                              key={take.id}
                              type="button"
                              disabled={!take.url}
                              onClick={() => take.url && chooseTake(take.url)}
                              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                              } disabled:opacity-40`}
                            >
                              Take {idx + 1}
                            </button>
                          );
                        })}
                        <span className="mx-0.5 h-3 w-px shrink-0 bg-zinc-700" />
                      </>
                    ) : (
                      <span className="text-[10px] text-zinc-500">No takes yet</span>
                    )}
                    <Dialog open={generateTakeOpen === "viewer"} onOpenChange={(open) => setGenerateTakeOpen(open ? "viewer" : null)}>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className="ml-auto shrink-0 flex items-center gap-1 rounded bg-primary/90 px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary"
                        >
                          <Plus className="size-2.5" />
                          Generate take
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Generate Take · {coverageLabel(shot)}</DialogTitle>
                          <DialogDescription>
                            Render an AI video take for setup {shot.setup || shot.title}.
                          </DialogDescription>
                        </DialogHeader>
                        <MediaStudio
                          project={project}
                          shot={shot}
                          mode="video"
                          onVideo={(asset, shotId) => {
                            const current = useSlate.getState();
                            if (current.project.id !== project.id) return;
                            const source = current.project.shots.find((c) => c.id === shotId);
                            if (!source) return;
                            const updatedHistory = appendMediaVersions(
                              source.videoUrl,
                              source.videoHistory,
                              [asset],
                              Date.now(),
                            );
                            current.patchShot(shotId, {
                              videoUrl: asset.url,
                              videoStatus: "done",
                              videoRequestId: null,
                              videoHistory: updatedHistory,
                            });
                            chooseTake(asset.url, picture, useSlate.getState().project);
                            setGenerateTakeOpen(null);
                          }}
                          onMusic={() => {}}
                        />
                      </DialogContent>
                    </Dialog>
                  </div>
                )}

                {picture && (
                  <SourceRangeSeekbar
                    key={`seekbar:${picture.id}`}
                    sourceIn={picture.sourceInSec ?? 0}
                    sourceOut={picture.sourceOutSec ?? (picture.sourceInSec ?? 0) + picture.duration}
                    sourceDuration={knownDuration}
                    onDraggingChange={(dragging) => {
                      if (dragging) {
                        setPlaying(false);
                        // Anchor the drag preview to the picture clip captured at
                        // drag start: mapping draft source times through the global
                        // timeline clock can land on the next clip at the exact
                        // join (end-exclusive) and swap the bound clip mid-gesture.
                        dragAnchorRef.current = { id: picture.id };
                      } else {
                        dragAnchorRef.current = null;
                        // After a cancel/revert, restore the preview to the stored
                        // excerpt at the current playback position.
                        const video = videoRef.current;
                        if (video && Number.isFinite(video.duration)) {
                          const sourceTime = sourceTimeAt(picture, time);
                          if (Number.isFinite(sourceTime)) video.currentTime = sourceTime;
                        }
                      }
                    }}
                    onSeek={(sourceTime) => {
                      const video = videoRef.current;
                      const anchor = dragAnchorRef.current;
                      if (!video || !anchor || anchor.id !== picture.id) return;
                      if (!Number.isFinite(sourceTime) || sourceTime < 0) return;
                      video.pause();
                      setPlaying(false);
                      const upper = Number.isFinite(video.duration) ? video.duration : sourceTime;
                      video.currentTime = Math.max(0, Math.min(upper, sourceTime));
                    }}
                    onApply={(a, b) => {
                      const current = useSlate.getState().project;
                      if (current.id !== project.id) return;
                      edit(() => setPictureSourceRange(current.timeline!, picture.id, a, b, knownDuration));
                    }}
                  />
                )}

                {/* Clean Viewer HUD / Footer */}
                <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/90 px-3.5 py-2 text-xs backdrop-blur">
                  <div className="flex items-center gap-2.5 min-w-0 truncate">
                    <span className="font-semibold text-zinc-100 truncate">
                      {coverageLabel(shot)} · {shot.title || "Untitled setup"}
                    </span>
                    <span className="rounded bg-zinc-800 border border-zinc-700/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                      {videoUrl ? (
                        shot.videoHistory?.find((t) => t.url === videoUrl)
                          ? `Take ${(shot.videoHistory.findIndex((t) => t.url === videoUrl) + 1)}`
                          : "Active Take"
                      ) : frameUrl ? (
                        "Still frame"
                      ) : (
                        "Storyboard preview"
                      )}
                    </span>
                    <button
                      type="button"
                      className="hidden sm:flex items-center gap-1 rounded border border-zinc-700/60 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700/80"
                      onClick={() => setShowOverhead(!showOverhead)}
                    >
                      <MapPin className="size-2.5" />
                      {showOverhead ? "Hide Overhead" : "Show Overhead"}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
                    <span>Source {sourceTimeAt(picture, time).toFixed(2)}s</span>
                    <span className="text-zinc-600">·</span>
                    <span>
                      {mediaError ||
                        (videoUrl
                          ? mediaReady
                            ? previewMuted
                              ? "Muted"
                              : "Audio on"
                            : "Buffering…"
                          : "Animatic")}
                    </span>
                  </div>
                </div>
              </div>
            ) : ordered.length === 0 ? (
              <div className="flex min-h-0 flex-1 w-full max-w-lg flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 p-8 text-center shadow-sm">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                  <Layers className="size-6" />
                </div>
                <h3 className="font-display text-lg font-semibold">Rough Cut Assembly</h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Your timeline has no picture clips yet. Assemble an edit automatically from your lined script coverage, or choose beats below.
                </p>
                <Button size="sm" className="mt-4 gap-2 shadow-sm" onClick={rebuild}>
                  <RotateCcw className="size-3.5" />
                  Build edit from script coverage
                </Button>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center text-sm text-zinc-400">
                No picture excerpt at this timestamp ({formatTimecode(time)}). Scrub the playhead or click a clip below.
              </div>
            )}
          </div>
        </section>

        {dockTab !== null && (
          <SidebarDock
            id="edit-sidebar-dock"
            ariaLabel="Edit sidebar dock"
            tablistAriaLabel="Edit sidebar tabs"
            tabs={[
              { id: "excerpt", label: "Cut", icon: Scissors },
              { id: "shot", label: "Shot", icon: Settings2 },
              { id: "copilot", label: "Assistant", icon: Bot },
              { id: "book", label: "Book", icon: FileText },
            ]}
            activeTab={dockTab}
            onTabChange={(tabId) => {
              if (tabId === "shot" && selectedShot) selectShot(selectedShot.id);
              setDockTab(tabId);
            }}
            onClose={() => setDockTab(null)}
          >
            {dockTab === "excerpt" && (
              <div className="min-h-0 overflow-y-auto p-3">
                <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
                  Selected excerpt
                </p>
                {selected && selectedShot ? (
                  <>
                    <h3 className="mt-1 font-display text-lg">
                      {coverageLabel(selectedShot)} · {selectedShot.title || "Untitled"}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Output {formatTimecode(selected.start)}–
                      {formatTimecode(selected.start + selected.duration)} ·{" "}
                      {selected.duration.toFixed(2)}s
                    </p>
                    <div className="mt-3 flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1 px-2 text-xs"
                        aria-label="Move excerpt earlier"
                        disabled={selectedIndex <= 0}
                        onClick={() => edit(() => movePictureClip(timeline, selected.id, -1))}
                      >
                        <ArrowLeft className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1 px-2 text-xs"
                        aria-label="Move excerpt later"
                        disabled={selectedIndex >= ordered.length - 1}
                        onClick={() => edit(() => movePictureClip(timeline, selected.id, 1))}
                      >
                        <ArrowRight className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1 gap-1.5 px-2 text-xs"
                        disabled={
                          time <= selected.start + 0.05 ||
                          time >= selected.start + selected.duration - 0.05
                        }
                        onClick={() => {
                          const id = `pic_${crypto.randomUUID()}`;
                          edit(() => splitPictureClip(timeline, selected.id, time, id), id);
                        }}
                      >
                        <Scissors className="size-3" />
                        Split here
                      </Button>
                    </div>

                    {/* Take Selector */}
                    <div className="mt-4 rounded-lg border border-border bg-card p-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <Film className="size-3.5 text-foreground" />
                          Takes ({selectedShot.videoHistory?.length ?? 0})
                        </span>
                        <Dialog open={generateTakeOpen === "selected"} onOpenChange={(open) => setGenerateTakeOpen(open ? "selected" : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]">
                              <Plus className="size-3" />
                              Generate take
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Generate Take · {coverageLabel(selectedShot)}</DialogTitle>
                              <DialogDescription>
                                Render an AI video take for setup {selectedShot.setup || selectedShot.title}.
                              </DialogDescription>
                            </DialogHeader>
                            <MediaStudio
                              project={project}
                              shot={selectedShot}
                              mode="video"
                              onVideo={(asset, shotId) => {
                                const current = useSlate.getState();
                                if (current.project.id !== project.id) return;
                                const source = current.project.shots.find((c) => c.id === shotId);
                                if (!source) return;
                                const updatedHistory = appendMediaVersions(
                                  source.videoUrl,
                                  source.videoHistory,
                                  [asset],
                                  Date.now(),
                                );
                                current.patchShot(shotId, {
                                  videoUrl: asset.url,
                                  videoStatus: "done",
                                  videoRequestId: null,
                                  videoHistory: updatedHistory,
                                });
                                chooseTake(asset.url, selected, useSlate.getState().project);
                                setGenerateTakeOpen(null);
                              }}
                              onMusic={() => {}}
                            />
                          </DialogContent>
                        </Dialog>
                      </div>

                      {selectedShot.videoHistory && selectedShot.videoHistory.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          <select
                            aria-label="Choose active take"
                            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                            value={selectedVideo ?? ""}
                            onChange={(e) => chooseTake(e.target.value, selected)}
                          >
                            {!selectedShot.videoHistory.some((t) => t.url && t.url === selectedVideo) && (
                              <option value={selectedVideo ?? ""} disabled={!selectedVideo}>
                                {selectedVideo ? "Current take" : "Select a take…"}
                              </option>
                            )}
                            {selectedShot.videoHistory.map((take, idx) => (
                              <option
                                key={take.id}
                                value={take.url || `retired:${take.id}`}
                                disabled={!take.url}
                              >
                                Take {idx + 1}
                                {!take.url
                                  ? " (Retired)"
                                  : take.asset
                                    ? ` · ${take.asset.durationSec.toFixed(1)}s`
                                    : ""}
                              </option>
                            ))}
                          </select>

                          <div className="grid grid-cols-2 gap-1.5">
                            {selectedShot.videoHistory.map((take, idx) => {
                              const isSelected = Boolean(take.url && take.url === selectedVideo);
                              return (
                                <button
                                  key={take.id}
                                  type="button"
                                  disabled={!take.url}
                                  onClick={() => take.url && chooseTake(take.url, selected)}
                                  className={cn(
                                    "flex flex-col items-start rounded-md border p-2 text-left transition-all text-xs",
                                    isSelected
                                      ? "border-primary bg-primary/10 font-medium text-foreground ring-1 ring-primary/50"
                                      : "border-border bg-secondary/30 hover:bg-secondary/70 text-muted-foreground",
                                    !take.url && "opacity-50 cursor-not-allowed",
                                  )}
                                >
                                  <div className="flex w-full items-center justify-between">
                                    <span className="font-semibold text-foreground">
                                      Take {idx + 1}
                                    </span>
                                    {isSelected && <Check className="size-3 text-primary" />}
                                  </div>
                                  <span className="mt-0.5 text-[10px] font-mono">
                                    {!take.url ? "Historical reference retired" : take.asset ? `${take.asset.durationSec.toFixed(1)}s` : "previous media"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 rounded border border-dashed border-border/80 p-2.5 text-center text-[11px] text-muted-foreground">
                          <p>No generated video takes for this shot.</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                            Using storyboard frame preview.
                          </p>
                        </div>
                      )}
                    </div>
                    <SourceRangeEditor
                      key={`${selected.id}:${sourceIn}:${sourceOut}`}
                      sourceIn={sourceIn}
                      sourceOut={sourceOut}
                      onApply={(a, b) =>
                        edit(() => setPictureSourceRange(timeline, selected.id, a, b, knownDuration))
                      }
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {selected.alignment === "manual" ? "Manual source range" : "Estimated source range"}
                      {knownDuration ? ` · Video ${knownDuration.toFixed(2)}s` : ""}
                    </p>
                    <label className="mt-4 block text-xs font-medium" htmlFor="edit-story-beat">
                      Script position
                    </label>
                    <select
                      id="edit-story-beat"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={selected.storyElementIds?.length === 1 ? selected.storyElementIds[0] : ""}
                      onChange={(event) => {
                        const ids = event.target.value ? [event.target.value] : [];
                        edit(() => ({
                          ...timeline,
                          initialized: true,
                          clips: timeline.clips.map((clip) =>
                            clip.id === selected.id ? { ...clip, storyElementIds: ids } : clip,
                          ),
                        }));
                      }}
                    >
                      <option value="">
                        {selected.storyElementIds?.length ? "Multiple script beats" : "Assign a script beat"}
                      </option>
                      {beats.map((beat, index) => (
                        <option key={beat.elementId} value={beat.elementId}>
                          {index + 1}. {beat.text.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No clip selected.</p>
                )}
                {choices.length > 0 && selected && (
                  <div className="mt-6">
                    <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
                      Alternative coverage
                    </p>
                    <div className="mt-2 space-y-1">
                      {choices.map((alt) => {
                        const altShot = project.shots.find(s => s.id === alt.shotId);
                        if (!altShot) return null;
                        return (
                          <button
                            key={alt.shotId}
                            type="button"
                            disabled={selected.shotId === alt.shotId}
                            className={cn(
                              "group flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary",
                              selected.shotId === alt.shotId ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => {
                              edit(() => selectCoverage(project, timeline, selected.id, alt.shotId));
                            }}
                          >
                            <span className="truncate">
                              <span className="font-medium">{coverageLabel(altShot)}</span> · {altShot.title || "Untitled"}
                            </span>
                            {selected.shotId === alt.shotId ? (
                              <Check className="size-3 text-steel" />
                            ) : (
                              <span className="invisible text-muted-foreground group-hover:visible">
                                Swap
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {dockTab === "shot" && (
              <div className="min-h-0 flex-1 overflow-y-auto pt-3">
                <Inspector embedded />
              </div>
            )}
            {dockTab === "copilot" && shot && <ProductionAssistantDock shot={shot} />}
            {dockTab === "book" && <ProductionDrawer embedded />}
          </SidebarDock>
        )}
      </div>

      <AudioPreview
        clips={project.audioClips ?? []}
        cutDuration={duration}
        time={time}
        playing={playing && mediaReady && !mediaError}
        muted={previewMuted}
        onPlaybackIssue={(issue) => { setPlaying(false); setMessage(issue); }}
      />
      <ScriptCoverageTimeline
        project={project}
        timeline={timeline}
        selectedClip={selected}
        playingClip={playing ? picture : undefined}
        playheadClip={picture}
        defaultOpen={true}
        onChoose={chooseAtBeat}
        onSelectClip={(clip) => {
          seek(clip.start, clip.id);
          setDockTab("excerpt");
        }}
        onSeekBeat={(elementId) => {
          const clip = ordered.find((candidate) => candidate.storyElementIds?.includes(elementId));
          if (clip) seek(clip.start, clip.id);
        }}
        onShotSettings={(shotId) => {
          setPlaying(false);
          selectShot(shotId);
          setDockTab("shot");
        }}
        transport={{
          duration,
          time,
          playing,
          muted: previewMuted,
          zoom,
          mediaError,
          uncoveredBeats: uncovered || undefined,
          onPlay: () => {
            primeNativeAudio();
            const restart = time >= duration;
            if (restart) setTime(0);
            const video = videoRef.current;
            if (video && picture && !restart) {
              video.muted = nativeMuted;
              if (video.readyState >= 1) video.currentTime = sourceTimeAt(picture, time);
              void video.play().catch(() => {
                setPlaying(false);
                setMessage("Playback paused. Press Play edit to try again.");
              });
            }
            setPlaying(true);
            setMessage("");
          },
          onPause: () => {
            videoRef.current?.pause();
            setPlaying(false);
            setMessage("");
          },
          onSeek: (start) => seek(start),
          onPrevClip: () => seek([...ordered].reverse().find((c) => c.start < time - 0.01)?.start ?? 0),
          onNextClip: () => seek(ordered.find((c) => c.start > time + 0.01)?.start ?? duration),
          onZoom: setZoom,
          onToggleMute: () => {
            const muted = !previewMuted;
            if (!muted) primeNativeAudio();
            if (videoRef.current) videoRef.current.muted = muted || nativeGain === 0;
            setPreviewMuted(muted);
          }
        }}
      />
    </div>
  );
}

function SourceRangeEditor({
  sourceIn,
  sourceOut,
  onApply,
}: {
  sourceIn: number;
  sourceOut: number;
  onApply: (sourceIn: number, sourceOut: number) => void;
}) {
  const [inValue, setInValue] = useState(sourceIn.toFixed(2));
  const [outValue, setOutValue] = useState(sourceOut.toFixed(2));
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(inValue.trim() ? Number(inValue) : NaN, outValue.trim() ? Number(outValue) : NaN);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Source in (s)
          <Input
            className="mt-1 h-8 font-mono text-xs"
            type="number"
            step="0.01"
            min="0"
            value={inValue}
            onChange={(event) => setInValue(event.target.value)}
          />
        </label>
        <label className="text-xs">
          Source out (s)
          <Input
            className="mt-1 h-8 font-mono text-xs"
            type="number"
            step="0.01"
            min="0"
            value={outValue}
            onChange={(event) => setOutValue(event.target.value)}
          />
        </label>
      </div>
      <Button type="submit" size="sm" variant="outline" className="mt-2 w-full">
        Apply source range
      </Button>
    </form>
  );
}
