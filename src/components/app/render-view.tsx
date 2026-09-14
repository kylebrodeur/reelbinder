import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Columns2,
  Download,
  ExternalLink,
  Film,
  Layers,
  Loader2,
  Music2,
  RotateCw,
  Sparkles,
  SplitSquareVertical,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CinemaJobFailure,
  CinemaRequestFailure,
  cinemaRequest,
  waitForCinemaJob,
} from "@/lib/cinema-client";
import { localRasterUpload, privateImageAssetId } from "@/lib/cinema-images";
import {
  pictureRenderSources,
  prepareRenderPictureAssets,
  readRenderRecovery,
  renderDuration,
  renderFingerprint,
  validateRenderResult,
  type CinemaRenderResult,
  type RenderPictureSource,
  type RenderRecovery,
} from "@/lib/cinema-render";
import { useSlate } from "@/lib/store";
import { timelineAudioRenderInputs } from "@/lib/timeline-audio";
import type { Project, TimelineClip } from "@/lib/types";
import { fetchFinishedStudyManifest, type FinishedStudyManifest } from "@/lib/demo-pack";
import { hydrateFinishedStudyMedia, type FinishedStudyMediaReceipt } from "@/lib/finished-study-media";
import { cn } from "@/lib/utils";

const storageKey = (id: string) => `slate-render-v1:${encodeURIComponent(id)}`;

export async function uploadClipAssetAndPatch(
  context: {
    sourceProjectId: string;
    clipId: string;
    shotId: string;
    sourceFrameUrl?: string;
    sourceVideoUrl?: string;
    fallbackFrameUrl?: string;
    fallbackVideoUrl?: string;
  },
  frame: string,
  upload: (body: { mimeType: string; dataBase64: string; label: string }) => Promise<{ assetId: string; url: string }>,
  getProject: () => Project,
  patchProject: (partial: Partial<Project>) => void,
  setError: (message: string) => void,
): Promise<void> {
  try {
    const body = localRasterUpload(frame);
    const asset = await upload({ ...body, label: `Picture clip ${context.clipId}` });
    if (privateImageAssetId(asset.url) !== asset.assetId) {
      throw new Error("The uploaded image did not return an owned session asset reference.");
    }
    const current = getProject();
    if (current.id !== context.sourceProjectId) {
      throw new Error("The selected project changed before this upload finished. Upload it again.");
    }
    const currentTimeline = current.timeline;
    if (!currentTimeline) {
      throw new Error("The timeline was removed before this upload finished. Upload it again.");
    }
    const currentClip = currentTimeline.clips.find((c) => c.id === context.clipId);
    if (!currentClip) {
      throw new Error("The clip was removed before this upload finished. Upload it again.");
    }
    if (currentClip.shotId !== context.shotId) {
      throw new Error("The clip's shot changed before this upload finished. Upload it again.");
    }
    if (currentClip.sourceFrameUrl !== context.sourceFrameUrl) {
      throw new Error("The clip's source frame changed before this upload finished. Upload it again.");
    }
    if (currentClip.sourceVideoUrl !== context.sourceVideoUrl) {
      throw new Error("The clip's source video changed before this upload finished. Upload it again.");
    }
    const currentShot = current.shots.find((s) => s.id === currentClip.shotId);
    if (
      !context.sourceFrameUrl &&
      !context.sourceVideoUrl &&
      (currentShot?.videoUrl ?? undefined) !== context.fallbackVideoUrl
    ) {
      throw new Error("The clip's effective video changed before this upload finished. Upload it again.");
    }
    const currentEffectiveFrame = currentClip.sourceFrameUrl || currentShot?.frameUrl;
    const capturedEffectiveFrame = context.sourceFrameUrl || context.fallbackFrameUrl;
    if (currentEffectiveFrame !== capturedEffectiveFrame) {
      throw new Error("The clip's effective frame changed before this upload finished. Upload it again.");
    }
    const nextTimeline = {
      ...currentTimeline,
      clips: currentTimeline.clips.map((c) =>
        c.id === context.clipId ? { ...c, sourceFrameUrl: asset.url } : c,
      ),
    };
    patchProject({ timeline: nextTimeline });
  } catch (failure) {
    setError(failure instanceof Error ? failure.message : "Failed to upload clip asset.");
  }
}

export function writeRenderRecovery(record: RenderRecovery): void {
  sessionStorage.setItem(storageKey(record.localProjectId), JSON.stringify(record));
}

export function persistRenderRecovery(
  record: RenderRecovery,
  isCurrent: () => boolean,
  setPending: (record: RenderRecovery | null) => void,
  write: (record: RenderRecovery) => void,
): void {
  let written = false;
  try {
    write(record);
    written = true;
  } finally {
    if (isCurrent() && (written || record.jobId)) {
      setPending(record);
    }
  }
  if (!written) {
    throw new Error("The render recovery record could not be saved to session storage.");
  }
}

function parseStartSeconds(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (match) {
    const [, h, m, s] = match;
    return parseInt(h || "0", 10) * 3600 + parseInt(m || "0", 10) * 60 + parseInt(s || "0", 10);
  }
  return null;
}

function buildYouTubeEmbedUrl(videoId: string, start: number | null): string {
  const out = new URL(`https://www.youtube.com/embed/${videoId}`);
  if (start !== null && Number.isFinite(start) && start >= 0) {
    out.searchParams.set("start", String(start));
  }
  return out.toString();
}

export function normalizeYouTubeEmbedUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const isYoutubeHost =
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "m.youtube.com";
    const isPrivacyHost = parsed.hostname === "www.youtube-nocookie.com" || parsed.hostname === "youtube-nocookie.com";
    let videoId: string | null = null;
    const start = parseStartSeconds(parsed.searchParams.get("start")) ??
      parseStartSeconds(parsed.searchParams.get("t"));
    if (isYoutubeHost && parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if ((isYoutubeHost || isPrivacyHost) && parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/")[2];
    } else if (isYoutubeHost && parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/")[2];
    } else if (parsed.hostname === "youtu.be") {
      videoId = parsed.pathname.slice(1);
    }
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return buildYouTubeEmbedUrl(videoId, start);
    }
  } catch {
    // Not a URL; return trimmed input unchanged.
  }
  return trimmed;
}

export function isYouTubeVideoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "m.youtube.com" ||
      parsed.hostname === "youtu.be" ||
      parsed.hostname === "www.youtube-nocookie.com" ||
      parsed.hostname === "youtube-nocookie.com"
    );
  } catch {
    return false;
  }
}

export function RenderView() {
  const project = useSlate((state) => state.project);
  const setView = useSlate((state) => state.setView);
  const patchProject = useSlate((state) => state.patchProject);
  const selectShot = useSlate((state) => state.selectShot);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<RenderRecovery | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [applied, setApplied] = useState(false);
  const [uploadingClips, setUploadingClips] = useState<Record<string, boolean>>({});
  const [layoutMode, setLayoutMode] = useState<"split" | "toggle">("split");
  const [finishedStudyManifest, setFinishedStudyManifest] = useState<FinishedStudyManifest | null>(null);
  const [finishedStudyError, setFinishedStudyError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState<string>("");
  const [hydrationReceipt, setHydrationReceipt] = useState<FinishedStudyMediaReceipt | null>(null);
  const [activeToggleTab, setActiveToggleTab] = useState<"deliverable" | "reference" | "stills">(
    "deliverable",
  );
  const [preflightStatusChecked, setPreflightStatusChecked] = useState(false);

  const liveMounted = useRef(true);
  const liveProjectId = useRef(project.id);
  liveProjectId.current = project.id;
  const running = useRef(new Set<string>());
  const preparing = useRef(false);



  const preparation = useMemo(() => {
    try {
      const duration = renderDuration(project);
      return {
        duration,
        sources: pictureRenderSources(project),
        audioCues: timelineAudioRenderInputs(project.audioClips ?? [], duration),
        error: "",
      };
    } catch (failure) {
      return {
        duration: 0,
        sources: [] as RenderPictureSource[],
        audioCues: [],
        error: failure instanceof Error ? failure.message : "The timeline edit is not ready to render.",
      };
    }
  }, [project]);

  const pictureClips = useMemo(() => {
    return (project.timeline?.clips ?? [])
      .filter((clip) => clip.track === "picture")
      .sort((a, b) => a.start - b.start);
  }, [project.timeline]);
  const finishedStudyOffline = project.demoSource === "finished-study" &&
    pictureClips.some((clip) => !clip.sourceVideoUrl && !clip.sourceFrameUrl);
  useEffect(() => {
    if (!finishedStudyOffline || finishedStudyManifest) return;
    const controller = new AbortController();
    void fetchFinishedStudyManifest({ signal: controller.signal }).then((manifest) => {
      if (!controller.signal.aborted) setFinishedStudyManifest(manifest);
    }).catch(() => {
      if (!controller.signal.aborted) setFinishedStudyError("The finished-study media descriptor is unavailable.");
    });
    return () => controller.abort();
  }, [finishedStudyOffline, finishedStudyManifest]);

  const hydrateMedia = useCallback(async () => {
    if (!finishedStudyManifest || hydrating) return;
    setHydrating(true);
    setFinishedStudyError(null);
    setHydrationProgress("Downloading and verifying approved media…");
    const controller = new AbortController();
    const snapshot = JSON.stringify(useSlate.getState().project);
    try {
      const result = await hydrateFinishedStudyMedia(finishedStudyManifest, useSlate.getState().project, controller.signal);
      if (JSON.stringify(useSlate.getState().project) !== snapshot)
        throw new Error("Your project changed while media was downloading. Review it and try Download media again.");
      useSlate.getState().replaceProject(result.project);
      setHydrationReceipt(result.receipt);
      setHydrationProgress("");
      if (result.receipt.state === "failed") setFinishedStudyError(result.receipt.errors[0] ?? "Media download failed.");
      else setHydrationProgress("Media relinked.");
    } catch (error) {
      setHydrationProgress("");
      setFinishedStudyError(error instanceof Error ? error.message : "Media download failed.");
    } finally {
      setHydrating(false);
    }
  }, [finishedStudyManifest, hydrating]);

  const persist = useCallback((record: RenderRecovery) => {
    persistRenderRecovery(
      record,
      () => liveMounted.current && liveProjectId.current === record.localProjectId,
      setPending,
      writeRenderRecovery,
    );
  }, []);

  const resolve = useCallback(
    async (recovery: RenderRecovery) => {
      const key = recovery.request.idempotencyKey;
      if (running.current.has(key)) {
        if (liveMounted.current && liveProjectId.current === recovery.localProjectId) {
          setBusy(true);
        }
        return;
      }
      running.current.add(key);
      let record = recovery;
      const isCurrent = () =>
        liveMounted.current && liveProjectId.current === record.localProjectId;
      let storageFailure = "";
      const safePersist = (next: RenderRecovery) => {
        try {
          persist(next);
          if (storageFailure && isCurrent()) setError("");
          storageFailure = "";
        } catch (failure) {
          const detail = failure instanceof Error ? ` ${failure.message}` : "";
          storageFailure = `The recovery update could not be saved.${detail} Keep this view open to retain the latest job state.`;
          if (isCurrent()) setError(storageFailure);
        }
      };

      if (isCurrent()) {
        setBusy(true);
        setError("");
        setStage("Rendering the saved picture edit with FFmpeg…");
      }
      try {
        if (!record.jobId) {
          const job = await cinemaRequest<{ jobId: string }>("/jobs", {
            method: "POST",
            body: JSON.stringify(record.request),
          });
          record = { ...record, jobId: job.jobId };
          safePersist(record);
        }
        const result = validateRenderResult(
          await waitForCinemaJob<CinemaRenderResult>(record.jobId!),
          {
            projectId: record.request.projectId!,
            revision: record.request.expectedRevision!,
            jobId: record.jobId!,
          },
        );
        record = { ...record, result };
        safePersist(record);
        if (isCurrent()) {
          setStage("Cut ready");
          setApplied(false);
        }
      } catch (failure) {
        const message =
          failure instanceof Error ? failure.message : "The render pipeline could not finish.";
        const terminal =
          failure instanceof CinemaJobFailure ||
          (failure instanceof CinemaRequestFailure &&
            failure.status >= 400 &&
            failure.status < 500 &&
            ![408, 429].includes(failure.status));
        if (terminal) {
          record = { ...record, terminalError: message };
          safePersist(record);
        }
        if (isCurrent()) setError(storageFailure ? `${message} ${storageFailure}` : message);
      } finally {
        running.current.delete(key);
        if (isCurrent()) {
          setBusy(false);
          setStage("");
        }
      }
    },
    [persist],
  );

  useEffect(() => {
    liveMounted.current = true;
    setError("");
    setStage("");
    setBusy(false);
    setApplied(false);
    try {
      const record = readRenderRecovery(sessionStorage.getItem(storageKey(project.id)), project.id);
      setPending(record);
      if (record?.terminalError) setError(record.terminalError);
      else if (record && !record.result) void resolve(record);
    } catch {
      setError(
        "Browser session storage is unavailable. Enable it to retain recoverable render jobs.",
      );
    }
    return () => {
      liveMounted.current = false;
    };
  }, [project.id, resolve]);

  useEffect(() => {
    let cancelled = false;
    setFingerprint("");
    void renderFingerprint(project)
      .then((value) => {
        if (!cancelled) setFingerprint(value);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "This browser could not fingerprint the edit. Use a secure local or HTTPS session.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const start = async () => {
    if (preparing.current || busy || (pending && !pending.result && !pending.terminalError)) return;
    preparing.current = true;
    setBusy(true);
    setError("");
    setApplied(false);
    const source = structuredClone(project);
    const localProjectId = source.id;
    const isCurrent = () =>
      liveMounted.current && liveProjectId.current === localProjectId;

    try {
      const sourceFingerprint = await renderFingerprint(source);
      const duration = renderDuration(source);
      const audioCues = timelineAudioRenderInputs(source.audioClips ?? [], duration);

      if (isCurrent()) setStage("Preparing selected picture assets…");
      const pictureAssets = await prepareRenderPictureAssets(source, (body) =>
        cinemaRequest<{ assetId: string; url: string }>("/assets", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );

      if (isCurrent()) setStage("Saving complete edit snapshot…");
      const saved = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
        method: "POST",
        body: JSON.stringify({ project: source }),
      });

      const record: RenderRecovery = {
        version: 1,
        localProjectId,
        sourceFingerprint,
        jobId: null,
        request: {
          kind: "render",
          projectId: saved.projectId,
          expectedRevision: saved.revision,
          idempotencyKey: `render_${crypto.randomUUID()}`,
          input: { pictureAssets, audioCues },
        },
      };
      persist(record);
      await resolve(record);
    } catch (failure) {
      if (isCurrent())
        setError(failure instanceof Error ? failure.message : "Could not prepare the render.");
    } finally {
      preparing.current = false;
      if (isCurrent()) {
        setBusy(false);
        setStage("");
      }
    }
  };

  const handleUploadClipAsset = async (clip: TimelineClip) => {
    const shot = project.shots.find((s) => s.id === clip.shotId);
    const frame = clip.sourceFrameUrl || shot?.frameUrl;
    if (!frame) return;

    setUploadingClips((prev) => ({ ...prev, [clip.id]: true }));
    setError("");

    await uploadClipAssetAndPatch(
      {
        sourceProjectId: project.id,
        clipId: clip.id,
        shotId: clip.shotId,
        sourceFrameUrl: clip.sourceFrameUrl,
        sourceVideoUrl: clip.sourceVideoUrl,
        fallbackFrameUrl: shot?.frameUrl ?? undefined,
        fallbackVideoUrl: shot?.videoUrl ?? undefined,
      },
      frame,
      async (body) =>
        cinemaRequest<{ assetId: string; url: string }>("/assets", {
          method: "POST",
          body: JSON.stringify({ ...body, label: `Picture clip ${clip.label || clip.id}` }),
        }),
      () => useSlate.getState().project,
      patchProject,
      setError,
    );

    setUploadingClips((prev) => {
      const next = { ...prev };
      delete next[clip.id];
      return next;
    });
  };

  const handleApplyAsFinalCut = async () => {
    if (!asset || !pending) return;
    const current = useSlate.getState().project;
    const currentFingerprint = await renderFingerprint(current);
    if (
      useSlate.getState().project !== current ||
      current.id !== pending.localProjectId ||
      currentFingerprint !== pending.sourceFingerprint
    ) {
      setError(
        "The project changed after this render started. Download this version or render the current edit; it cannot replace the current cut.",
      );
      return;
    }
    patchProject({ cutUrl: asset.url });
    setApplied(true);
  };

  const result = pending?.result;
  const asset = result?.assets[0];
  const changed = Boolean(pending && fingerprint && pending.sourceFingerprint !== fingerprint);
  const unresolved = Boolean(pending && !result && !pending.terminalError);

  // Reference cuts
  const binderReferenceCut = useMemo(() => {
    return project.binder?.find((a) => a.tab === "cut" && a.url)?.url;
  }, [project.binder]);

  const activeReferenceUrl = useMemo(() => {
    return binderReferenceCut ? normalizeYouTubeEmbedUrl(binderReferenceCut) : null;
  }, [binderReferenceCut]);
  const referenceLabel = "Director Reference Cut";
  const missingReference = "No director reference is bound to this project. Add a reference cut to the binder.";

  // Stepper Stage Calculation
  type StepState = "done" | "active" | "error" | "pending";

  const preflightState = useMemo<StepState>(() => {
    if (preparation.error) return "error";
    if (busy && stage.toLowerCase().includes("prepar")) return "active";
    if (preparation.sources.length > 0) return "done";
    return "pending";
  }, [preparation, busy, stage]);

  const assetPrepState = useMemo<StepState>(() => {
    if (preflightState === "error") return "error";
    if (Object.keys(uploadingClips).length > 0) return "active";
    if (busy && stage.toLowerCase().includes("picture assets")) return "active";
    if (pending?.request?.input?.pictureAssets) return "done";
    const allSessionAssets =
      preparation.sources.length > 0 &&
      preparation.sources.every((s) => s.kind === "asset" && Boolean(s.assetId));
    if (allSessionAssets) return "done";
    if (preparation.sources.some((s) => !s.url)) return "error";
    return "pending";
  }, [preflightState, uploadingClips, busy, stage, pending, preparation.sources]);

  const encodingState = useMemo<StepState>(() => {
    if (pending?.result) return "done";
    if (pending?.terminalError) return "error";
    if (busy && (stage.includes("Rendering") || stage.includes("Saving"))) return "active";
    if (unresolved) return "active";
    return "pending";
  }, [pending, busy, stage, unresolved]);

  const deliverableState = useMemo<StepState>(() => {
    if (pending?.result) return "done";
    if (pending?.terminalError) return "error";
    if (busy && stage.toLowerCase().includes("ready")) return "active";
    return "pending";
  }, [pending, busy, stage]);

  // Deliverable URL
  const deliverableVideoUrl =
    asset?.url || (project.cutUrl && !isYouTubeVideoUrl(project.cutUrl) ? project.cutUrl : null);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      {/* 1. Header & Primary Pipeline Control */}
      <header className="border-b border-border bg-card/60 px-6 py-5 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Film className="size-5 text-primary" />
              <h1 className="text-xl font-bold tracking-tight">Render & Delivery Pipeline</h1>
              <Badge variant="outline" className="text-xs font-mono">
                1280×720 · 24 fps MP4
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{project.name || "Untitled Film"}</span>
              <span>·</span>
              <span>{pictureClips.length} picture clips</span>
              <span>·</span>
              <span>{Math.max(0, ...pictureClips.map((clip) => clip.start + clip.duration)).toFixed(2)}s cut duration</span>
              <span>·</span>
              <span>{(project.audioClips ?? []).length} timeline audio cues</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPreflightStatusChecked(true);
              }}
              title="Validate timeline bounds, picture clip continuity and audio alignment"
            >
              <Check className="size-3.5" />
              Check Preflight
            </Button>

            {unresolved && !busy ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void resolve(pending!)}
                className="gap-1.5"
              >
                <RotateCw className="size-3.5" />
                Resume Render
              </Button>
            ) : null}

            <Button
              variant="default"
              size="sm"
              disabled={busy || unresolved || Boolean(preparation.error) || !fingerprint}
              onClick={() => void start()}
              className="gap-1.5 shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>{stage || "Rendering…"}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>{asset || pending?.terminalError ? "Render current edit" : "Render MP4 Cut"}</span>
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView("edit")}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <span>Edit Sequence</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* 2. Pipeline Stepper */}
        <div className="mx-auto mt-6 max-w-7xl">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            {/* Step 1: Preflight */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                preflightState === "done" && "border-ok/30 bg-ok/5",
                preflightState === "active" && "border-primary/40 bg-primary/5",
                preflightState === "error" && "border-destructive/40 bg-destructive/5",
                preflightState === "pending" && "border-border/60 bg-card/40 opacity-70",
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background border border-border">
                {preflightState === "done" ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : preflightState === "error" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : preflightState === "active" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">1</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-tight">1. Timeline Preflight</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {preparation.error
                    ? "Validation error"
                    : preparation.sources.length > 0
                      ? `${preparation.sources.length} clips verified`
                      : "Awaiting sequence"}
                </p>
              </div>
            </div>

            {/* Step 2: Asset Prep */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                assetPrepState === "done" && "border-ok/30 bg-ok/5",
                assetPrepState === "active" && "border-primary/40 bg-primary/5",
                assetPrepState === "error" && "border-destructive/40 bg-destructive/5",
                assetPrepState === "pending" && "border-border/60 bg-card/40 opacity-70",
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background border border-border">
                {assetPrepState === "done" ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : assetPrepState === "error" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : assetPrepState === "active" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">2</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-tight">2. Asset Ingestion</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {assetPrepState === "done"
                    ? "Session assets ready"
                    : assetPrepState === "active"
                      ? "Uploading media…"
                      : "Local rasters & takes"}
                </p>
              </div>
            </div>

            {/* Step 3: FFmpeg Encoding */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                encodingState === "done" && "border-ok/30 bg-ok/5",
                encodingState === "active" && "border-primary/40 bg-primary/5",
                encodingState === "error" && "border-destructive/40 bg-destructive/5",
                encodingState === "pending" && "border-border/60 bg-card/40 opacity-70",
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background border border-border">
                {encodingState === "done" ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : encodingState === "error" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : encodingState === "active" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">3</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-tight">3. Timeline Encoding</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {encodingState === "done"
                    ? "720p 24fps encoded"
                    : encodingState === "active"
                      ? "FFmpeg rendering…"
                      : "Local video & audio"}
                </p>
              </div>
            </div>

            {/* Step 4: Deliverable Assembly */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                deliverableState === "done" && "border-ok/30 bg-ok/5",
                deliverableState === "active" && "border-primary/40 bg-primary/5",
                deliverableState === "error" && "border-destructive/40 bg-destructive/5",
                deliverableState === "pending" && "border-border/60 bg-card/40 opacity-70",
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background border border-border">
                {deliverableState === "done" ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : deliverableState === "error" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : deliverableState === "active" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">4</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold leading-tight">4. Deliverable Assembly</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {deliverableState === "done"
                    ? "Validated MP4 ready"
                    : deliverableState === "error"
                      ? "Assembly failed"
                      : "Export & download"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Status Alerts / Preflight Notifications */}
        {preparation.error ? (
          <div className="mx-auto mt-4 max-w-7xl rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">Preflight validation issue: </span>
              {preparation.error}
            </div>
            <Button size="sm" variant="outline" onClick={() => setView("edit")}>
              Go to Edit
            </Button>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="mx-auto mt-4 max-w-7xl rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1 font-medium">{error}</span>
            <Button size="sm" variant="ghost" onClick={() => setError("")}>
              Dismiss
            </Button>
          </div>
        ) : null}

        {preflightStatusChecked && !preparation.error && (
          <div className="mx-auto mt-4 max-w-7xl rounded-md border border-ok/30 bg-ok/10 p-3 text-xs text-ok flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>
                Preflight check passed: {preparation.sources.length} contiguous picture clips,{" "}
                {preparation.duration.toFixed(2)}s output span, {preparation.audioCues.length} audio
                cues aligned. Ready for full render.
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-ok hover:text-ok hover:bg-ok/20 h-6 px-2"
              onClick={() => setPreflightStatusChecked(false)}
            >
              Dismiss
            </Button>
          </div>
        )}
      </header>

      {/* Main Workspace Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 p-6">
        {/* 3. Dual-Player / Reference Comparison Viewer */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Dual Playback & Reference Comparison
              </h2>
              <p className="text-xs text-muted-foreground">
                Compare your latest 720p 24fps render directly against director reference cuts.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Layout Mode Switcher */}
              <div className="flex items-center rounded-md border border-border bg-card p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setLayoutMode("split")}
                  className={cn(
                    "flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors",
                    layoutMode === "split"
                      ? "bg-secondary text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title="Side-by-side comparison"
                >
                  <Columns2 className="size-3.5" />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("toggle")}
                  className={cn(
                    "flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors",
                    layoutMode === "toggle"
                      ? "bg-secondary text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title="Single focused player with tab switcher"
                >
                  <SplitSquareVertical className="size-3.5" />
                  <span>Toggle</span>
                </button>
              </div>
            </div>
          </div>

          {/* SPLIT VIEW LAYOUT */}
          {layoutMode === "split" ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Left Column: Primary Encoded Deliverable */}
              <div className="flex flex-col space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={deliverableVideoUrl ? "ok" : "outline"} className="text-xs">
                      {asset ? "Rendered MP4" : deliverableVideoUrl ? "Project Cut" : "Unrendered"}
                    </Badge>
                    <span className="text-xs font-medium">Primary Deliverable</span>
                  </div>
                  {asset ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {asset.width}×{asset.height} · {asset.fps}fps · {asset.durationSec.toFixed(1)}s
                    </span>
                  ) : null}
                </div>

                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/90 flex items-center justify-center">
                  {deliverableVideoUrl ? (
                    <video
                      key={deliverableVideoUrl}
                      src={deliverableVideoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="size-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                      <Film className="size-10 stroke-[1.5] mb-2 opacity-40" />
                      <p className="text-xs font-medium">No encoded deliverable rendered yet</p>
                      <p className="text-[11px] max-w-xs mt-1 text-muted-foreground/80">
                        Click &quot;Render MP4 Cut&quot; in the header to compile your timeline into a
                        720p 24fps release video.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 text-xs"
                        disabled={busy || Boolean(preparation.error) || !fingerprint}
                        onClick={() => void start()}
                      >
                        Start Render Now
                      </Button>
                    </div>
                  )}
                </div>

                {/* Encoded Video Diagnostics & Actions */}
                {asset ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground">
                      <span>Size: {(asset.byteSize / 1024 / 1024).toFixed(2)} MiB</span>
                      {pending?.jobId ? (
                        <span className="font-mono text-[10px]">Job: {pending.jobId}</span>
                      ) : null}
                    </div>

                    {changed ? (
                      <p className="rounded bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-600 dark:text-amber-400">
                        The project edit was modified after this version rendered. This MP4 remains
                        available for review and download.
                      </p>
                    ) : null}

                    {result?.warnings && result.warnings.length > 0 ? (
                      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                        {result.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild size="sm" variant="default" className="gap-1.5 text-xs">
                        <a
                          href={asset.url}
                          download={`${(project.name || "film").replace(/[^a-zA-Z0-9_-]+/g, "-")}-cut.mp4`}
                        >
                          <Download className="size-3.5" />
                          Download MP4
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!fingerprint || changed || busy || applied}
                        onClick={() => void handleApplyAsFinalCut()}
                        className="gap-1.5 text-xs"
                      >
                        <Check className="size-3.5" />
                        {applied ? "Saved as Final Cut" : "Use as Final Cut"}
                      </Button>
                    </div>
                  </div>
                ) : deliverableVideoUrl ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                      <a href={deliverableVideoUrl} download="project-cut.mp4">
                        <Download className="size-3.5" />
                        Download Video
                      </a>
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Right Column: Reference Comparison */}
              <div className="flex flex-col space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="steel" className="text-xs">
                      Director Reference
                    </Badge>
                    <span className="text-xs font-medium">Source Reference Video</span>
                  </div>
                  {activeReferenceUrl && <a
                    href={activeReferenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <span>External</span>
                    <ExternalLink className="size-3" />
                  </a>}
                </div>

                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                  {activeReferenceUrl ? <iframe
                    src={activeReferenceUrl}
                    title="Reference Film Cut"
                    className="size-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  /> : <p className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">{missingReference}</p>}
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground pt-1">
                  <p className="font-medium text-foreground">
                    {referenceLabel}
                  </p>
                  <p className="text-[11px]">
                    Compare framing, pacing, and staging with the reference in your production book.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* TOGGLE VIEW LAYOUT */
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
              <Tabs
                value={activeToggleTab}
                onValueChange={(val) => {
                  if (val === "deliverable" || val === "reference" || val === "stills") {
                    setActiveToggleTab(val);
                  }
                }}
                className="w-full"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <TabsList>
                    <TabsTrigger value="deliverable" className="gap-1.5">
                      <Film className="size-3.5" />
                      <span>Encoded MP4</span>
                    </TabsTrigger>
                    <TabsTrigger value="reference" className="gap-1.5">
                      <Video className="size-3.5" />
                      <span>Reference Cut</span>
                    </TabsTrigger>
                    <TabsTrigger value="stills" className="gap-1.5">
                      <Layers className="size-3.5" />
                      <span>Sequence Stills Gallery</span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="deliverable" className="space-y-4 pt-2">
                  <div className="relative aspect-video max-h-[520px] w-full overflow-hidden rounded-lg bg-black mx-auto">
                    {deliverableVideoUrl ? (
                      <video
                        key={deliverableVideoUrl}
                        src={deliverableVideoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="size-full object-contain"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
                        <Film className="size-12 stroke-[1.5] mb-2 opacity-40" />
                        <p className="text-sm font-medium">No encoded deliverable rendered yet</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-4"
                          disabled={busy || Boolean(preparation.error) || !fingerprint}
                          onClick={() => void start()}
                        >
                          Render MP4 Now
                        </Button>
                      </div>
                    )}
                  </div>

                  {asset ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="text-xs text-muted-foreground">
                        Specs: {asset.width}×{asset.height} · {asset.fps} fps ·{" "}
                        {asset.durationSec.toFixed(2)}s · {(asset.byteSize / 1024 / 1024).toFixed(2)}{" "}
                        MiB
                      </div>
                      <div className="flex items-center gap-2">
                        <Button asChild size="sm" variant="default" className="gap-1.5">
                          <a
                            href={asset.url}
                            download={`${(project.name || "film").replace(/[^a-zA-Z0-9_-]+/g, "-")}-cut.mp4`}
                          >
                            <Download className="size-3.5" />
                            Download MP4
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!fingerprint || changed || busy || applied}
                          onClick={() => void handleApplyAsFinalCut()}
                          className="gap-1.5"
                        >
                          <Check className="size-3.5" />
                          {applied ? "Saved as Final Cut" : "Use as Final Cut"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="reference" className="space-y-4 pt-2">
                  <div className="relative aspect-video max-h-[520px] w-full overflow-hidden rounded-lg bg-black mx-auto">
                    {activeReferenceUrl ? <iframe
                      src={activeReferenceUrl}
                      title="Reference Film"
                      className="size-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    /> : <p className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">{missingReference}</p>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {referenceLabel}{activeReferenceUrl ? ` — ${activeReferenceUrl}` : ""}
                  </div>
                </TabsContent>

                <TabsContent value="stills" className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {pictureClips.map((clip) => {
                      const shot = project.shots.find((s) => s.id === clip.shotId);
                      const frame = clip.sourceFrameUrl || shot?.frameUrl;
                      return (
                        <div
                          key={clip.id}
                          className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-xs"
                        >
                          <div className="relative aspect-video w-full overflow-hidden rounded bg-black/60 mb-2">
                            {frame ? (
                              <img
                                src={frame}
                                alt={clip.label || "Clip still"}
                                className="size-full object-cover"
                              />
                            ) : (
                              <div className="flex size-full items-center justify-center text-muted-foreground">
                                No Still
                              </div>
                            )}
                          </div>
                          <span className="font-semibold truncate">{clip.label || shot?.title || "Clip"}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {clip.start.toFixed(2)}s – {(clip.start + clip.duration).toFixed(2)}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </section>

        {/* 4. Asset Rendering Progress & Inventory */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Picture Clips & Asset Ingestion Inventory
              </h2>
              <p className="text-xs text-muted-foreground">
                Track status of every timeline excerpt, session asset bindings, and local raster uploads.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{pictureClips.length} clips total</span>
            </div>
          </div>

        {finishedStudyOffline && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Download className="size-4 text-steel" />
                  <h3 className="text-sm font-semibold text-foreground">Media offline</h3>
                  {hydrationReceipt?.state === "applied" && (
                    <Badge variant="ok" className="text-[11px]">Relinked</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {finishedStudyManifest
                    ? `${finishedStudyManifest.media.length} approved media ${finishedStudyManifest.media.length === 1 ? "file" : "files"} are listed by the published descriptor.`
                    : "The approved media descriptor is loading."}{" "}
                  Downloads come from the verified public mirror and are checked against the published SHA-256, byte size and MIME type before your visitor session owns them.
                </p>
                <a
                  href="https://docs.reelbinder.app/presentation-project/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-steel underline-offset-2 hover:underline"
                >
                  Rights, hashes and public mirror details <ExternalLink className="size-3" />
                </a>
              </div>
              <Button disabled={hydrating || !finishedStudyManifest} onClick={() => void hydrateMedia()}>
                {hydrating ? <><Loader2 className="animate-spin" />Downloading…</> : <><Download /> Download media and relink</>}
              </Button>
            </div>
            {hydrationProgress && <p className="mt-2 text-xs text-muted-foreground">{hydrationProgress}</p>}
            {finishedStudyError && (
              <p className="mt-2 rounded-md border border-destructive/50 p-3 text-xs" role="alert">{finishedStudyError}</p>
            )}
            {hydrationReceipt && (
              <div className="mt-2 space-y-1">
                {hydrationReceipt.descriptors.map((descriptor) => (
                  <p key={descriptor.id} className="text-[11px] text-muted-foreground">
                    {descriptor.label}: {descriptor.outcome}
                    {descriptor.error ? ` — ${descriptor.error}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Sequence</th>
                    <th className="px-4 py-3">Thumbnail</th>
                    <th className="px-4 py-3">Shot / Setup</th>
                    <th className="px-4 py-3">Timeline Span</th>
                    <th className="px-4 py-3">Media Kind</th>
                    <th className="px-4 py-3">Ingestion Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pictureClips.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No picture clips on timeline. Go to the Edit view to line up shots on the
                        picture track.
                      </td>
                    </tr>
                  ) : (
                    pictureClips.map((clip, index) => {
                      const shot = project.shots.find((s) => s.id === clip.shotId);
                      const source = preparation.sources.find((s) => s.clipId === clip.id);
                      const captured = Boolean(clip.sourceVideoUrl || clip.sourceFrameUrl);
                      const video = captured ? clip.sourceVideoUrl : shot?.videoUrl;
                      const frame = captured ? clip.sourceFrameUrl : shot?.frameUrl;
                      const isUploading = Boolean(uploadingClips[clip.id]);

                      // Determine clip status badge
                      let statusBadge: {
                        label: string;
                        variant: "ok" | "steel" | "warn" | "error" | "default";
                      } = { label: "Pending", variant: "warn" };

                      if (isUploading) {
                        statusBadge = { label: "Uploading…", variant: "steel" };
                      } else if (video) {
                        const assetId = privateImageAssetId(video);
                        if (assetId) {
                          statusBadge = { label: "Session Video", variant: "ok" };
                        } else {
                          statusBadge = { label: "External Video", variant: "error" };
                        }
                      } else if (frame) {
                        const assetId = privateImageAssetId(frame);
                        if (assetId) {
                          statusBadge = { label: "Ready Asset", variant: "ok" };
                        } else {
                          statusBadge = { label: "Local Raster", variant: "warn" };
                        }
                      } else {
                        statusBadge = { label: "Missing Media", variant: "error" };
                      }

                      return (
                        <tr key={clip.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                            #{(index + 1).toString().padStart(2, "0")}
                          </td>
                          <td className="px-4 py-3">
                            <div className="relative aspect-video w-16 overflow-hidden rounded border border-border bg-black/50">
                              {frame ? (
                                <img
                                  src={frame}
                                  alt={clip.label || "Clip"}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                                  Empty
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex flex-col">
                              <span>{clip.label || shot?.title || "Untitled Clip"}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                Shot ID: {clip.shotId || "unlinked"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">
                            {clip.start.toFixed(2)}s – {(clip.start + clip.duration).toFixed(2)}s
                            <span className="ml-1.5 text-foreground/80 font-sans">
                              ({clip.duration.toFixed(2)}s)
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground capitalize">
                            {video ? "Video Take" : frame ? "Image Frame" : "None"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusBadge.variant} className="gap-1 text-[11px]">
                              {isUploading ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : statusBadge.variant === "ok" ? (
                                <CheckCircle2 className="size-3" />
                              ) : statusBadge.variant === "warn" ? (
                                <Clock className="size-3" />
                              ) : (
                                <AlertCircle className="size-3" />
                              )}
                              <span>{statusBadge.label}</span>
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {source?.kind === "local" && frame ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                disabled={isUploading || busy}
                                onClick={() => void handleUploadClipAsset(clip)}
                              >
                                {isUploading ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Upload className="size-3" />
                                )}
                                <span>Upload Asset</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  if (clip.shotId) selectShot(clip.shotId);
                                  setView("edit");
                                }}
                              >
                                View in Edit
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 5. Timeline Audio Cues Overview */}
        <section className="space-y-3 pb-8">
          <div className="flex items-center gap-2">
            <Music2 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Timeline Audio Mix Cues</h3>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-xs">
            {preparation.audioCues.length === 0 ? (
              <p className="text-muted-foreground">
                No timeline audio cues configured. Available native audio follows each clip's mute and
                gain settings; ambient tracks and musical scores can be arranged in the Edit tab timeline
                mix.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {preparation.audioCues.map((cue, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md border border-border/80 bg-muted/20 p-2.5"
                  >
                    <div>
                      <p className="font-medium">Audio Cue #{idx + 1}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        Offset: {cue.start.toFixed(2)}s · Dur: {cue.duration.toFixed(2)}s
                      </p>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Gain: {(cue.gain * 100).toFixed(0)}%
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
