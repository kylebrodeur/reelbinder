import { KeyFrameGuidance } from "@/components/app/key-frame-guidance";
import { ExternalLink, Film, ImageIcon, Loader2, RefreshCw, Sparkles, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BlockingCanvas } from "@/components/app/blocking-canvas";
import { ConnectionsControl } from "@/components/app/cinema-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCinemaConnections, getCinemaHealth, type CinemaConnection } from "@/lib/cinema-client";
import { appendFrameVersions, imageReferenceAvailable } from "@/lib/cinema-images";
import { continueFromPrevious, generateShotFrame, restyleShotFrame, resumeShotImage } from "@/lib/imagine-flow";
import { getImageRecovery, clearResolvedImageRecovery } from "@/lib/image-recovery";
import { fileToJpegDataUrl } from "@/lib/media";
import { capturePlanComposition, hasFrameComposition, type FrameCompositionGuide } from "@/lib/frame-composition";
import { cameraForShot, projectFrameToFloor } from "@/lib/floor";
import { coverageLabel } from "@/lib/lining";
import {
  formatGateIssues,
  framePlanReviewFingerprint,
  imageEditReadiness,
  imageEditReviewFingerprint,
  photorealPlacementFingerprint,
  photorealReadiness,
  stageReadiness,
  storyboardAncestry,
  storyboardReadiness,
} from "@/lib/production-gates";
import { useSlate } from "@/lib/store";
import type { Shot } from "@/lib/types";

import { DEFAULT_FRAME_LAYERS, type FrameLayerSettings } from "@/lib/frame-renderer";

export function ImagineActions({ shot, compact = false, compositionPreview = false, frameLayers = DEFAULT_FRAME_LAYERS }: { shot: Shot; compact?: boolean; compositionPreview?: boolean; frameLayers?: FrameLayerSettings }) {
  const project = useSlate((state) => state.project);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const compositionContext = useRef({ projectId: project.id, shotId: shot.id, frameLayers, compositionPreview });
  compositionContext.current = { projectId: project.id, shotId: shot.id, frameLayers, compositionPreview };
  const patchShot = useSlate((state) => state.patchShot);
  const [, setRecoveryRevision] = useState(0);
  const recoveryState = (() => {
    try { return { record: getImageRecovery(project.id, shot.id), error: "" }; }
    catch (error) { return { record: null, error: error instanceof Error ? error.message : "Image recovery is unavailable." }; }
  })();
  const [busy, setBusy] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ url: string; label: string } | null>(null);
  const [planGuide, setPlanGuide] = useState<FrameCompositionGuide | null>(null);
  const [overheadReview, setOverheadReview] = useState<string | null>(null);
  const [placementReview, setPlacementReview] = useState<string | null>(null);
  const [imageReview, setImageReview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const index = project.shots.findIndex((candidate) => candidate.id === shot.id);
  const previous = index > 0 ? project.shots[index - 1] : undefined;
  const canRun = !!connectionId && imageReady && !busy && !loading && !recoveryState.record && !recoveryState.error;
  const canEdit = imageReferenceAvailable(shot.frameUrl);
  const canReferencePrevious = imageReferenceAvailable(previous?.frameUrl ?? null);
  const currentAsset = shot.frameHistory?.find((version) => version.url === shot.frameUrl)?.asset;
  const stageGate = stageReadiness(project, shot.id);
  const planFingerprint = framePlanReviewFingerprint(project, shot.id, frameLayers);
  const capturedLayersCurrent = !!planGuide?.layers && JSON.stringify(planGuide.layers) === JSON.stringify(frameLayers);
  const planGate = capturedLayersCurrent
    ? storyboardReadiness(project, shot.id, planGuide, overheadReview)
    : { ready: false, issues: [{ code: "stale-plan-capture" as const, message: "The visible Frame layers changed after capture. Capture and review the plan again." }] };
  const placementFingerprint = photorealPlacementFingerprint(project, shot.id);
  const stillGate = photorealReadiness(project, shot.id, placementReview);
  const selectedStoryboard = !!placementFingerprint;
  const selectedReviewedStill = storyboardAncestry(shot, project).ready;
  const imageReviewFingerprint = imageEditReviewFingerprint(project, shot.id, shot.id);
  const imageGate = imageEditReadiness(project, shot.id, shot.id, imageReview);
  const previousReviewFingerprint = previous ? imageEditReviewFingerprint(project, shot.id, previous.id) : null;
  const previousImageGate = previous ? imageEditReadiness(project, shot.id, previous.id, imageReview) : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    try {
      const [available, health] = await Promise.all([getCinemaConnections(), getCinemaHealth()]);
      const cloud = available.filter(
        (connection) =>
          connection.provider === "google-cloud" && connection.expiresAt * 1000 > Date.now(),
      );
      setConnections(cloud);
      setConnectionId((id) =>
        cloud.some((connection) => connection.connectionId === id)
          ? id
          : (cloud[0]?.connectionId ?? ""),
      );
      setImageReady(health.capabilities.image?.status === "configured");
      setModel(health.capabilities.image?.model ?? null);
      if (health.capabilities.image?.status !== "configured")
        setConnectionError("An image model has not been configured for this cinema service.");
    } catch (error) {
      setImageReady(false);
      setConnectionId("");
      setConnections([]);
      setConnectionError(
        error instanceof Error ? error.message : "The cinema service is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    setLastResult(null);
    setLastJobId(null);
    setPlanGuide(null);
    setOverheadReview(null);
    setPlacementReview(null);
    setImageReview(null);
  }, [project.id, shot.id]);
  useEffect(() => {
    setPlanGuide(null);
    setOverheadReview(null);
    setPlacementReview(null);
    setImageReview(null);
  }, [project, shot.id, frameLayers]);

  const run = async (
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string; message?: string; url?: string }>,
  ) => {
    const current = useSlate.getState();
    const selectedId = current.selectedId ?? current.project.shots[0]?.id;
    if (!mounted.current || current.project.id !== project.id ||
        compositionContext.current.projectId !== project.id ||
        compositionContext.current.shotId !== shot.id || selectedId !== shot.id ||
        !current.project.shots.some((candidate) => candidate.id === shot.id)) {
      toast.error("The selected Project or setup changed. Use the current Frame controls again.");
      return;
    }
    try {
      const recovery = getImageRecovery(project.id, shot.id);
      if (label === "resume" ? recovery?.status !== "pending" :
          label === "restore" ? recovery?.status !== "succeeded" : !!recovery) {
        toast.error("Resolve the saved image request before starting a new image.");
        setRecoveryRevision(value => value + 1);
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image recovery is unavailable.");
      setRecoveryRevision(value => value + 1);
      return;
    }
    setBusy(label);
    setLastJobId(null);
    setLastResult(null);
    const resultLabel = shot.setup || shot.title;
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error || "The image job could not finish.");
        return;
      }
      if (result.url) setLastResult({ url: result.url, label: resultLabel });
      toast.success(result.message || "Image ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image job could not finish.");
    } finally {
      setBusy(null);
      setRecoveryRevision(value => value + 1);
    }
  };
  const enableNewImage = () => {
    const state = useSlate.getState();
    const selectedId = state.selectedId ?? state.project.shots[0]?.id;
    if (!mounted.current || state.project.id !== project.id || selectedId !== shot.id ||
      compositionContext.current.projectId !== project.id || compositionContext.current.shotId !== shot.id) return;
    try { clearResolvedImageRecovery(project.id, shot.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : "The saved request is not resolved."); }
    setRecoveryRevision(value => value + 1);
  };
  const options = { connectionId, direction, onJob: setLastJobId };

  const capturePlan = async () => {
    if (!stageGate.ready) {
      toast.error(formatGateIssues(stageGate));
      return;
    }
    if (compositionPreview) {
      toast.error("Stop the rehearsal preview before capturing the authored Frame plan.");
      return;
    }
    const source = JSON.stringify({ project, shotId: shot.id, frameLayers });
    setBusy("capture-plan");
    try {
      const guide = await capturePlanComposition(project, shot.id, frameLayers);
      const state = useSlate.getState();
      const selectedId = state.selectedId ?? state.project.shots[0]?.id;
      if (!mounted.current || selectedId !== shot.id ||
          source !== JSON.stringify({ project: state.project, shotId: shot.id, frameLayers: compositionContext.current.frameLayers }))
        throw new Error("The Project, setup, or visible Frame layers changed during capture. Capture the current plan again.");
      setPlanGuide(guide);
      setOverheadReview(null);
      setPlacementReview(null);
      setImageReview(null);
      toast.success("Current Frame plan captured locally for overhead review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The Frame plan could not be captured.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file || busy) return;
    const sourceProjectId = project.id;
    const shotId = shot.id;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("Upload a PNG, JPEG, or WebP image.");
      const url = await fileToJpegDataUrl(file);
      const current = useSlate.getState().project;
      const currentShot = current.shots.find((candidate) => candidate.id === shotId);
      if (current.id !== sourceProjectId || !currentShot)
        throw new Error(
          "The selected project changed before this image was ready. Upload it again.",
        );
      const now = Date.now();
      patchShot(shotId, {
        frameUrl: url,
        frameKind: "still",
        frameHistory: [
          ...appendFrameVersions(currentShot, [], "still", now),
          { id: `upload_${crypto.randomUUID()}`, url, kind: "still", createdAt: now },
        ],
      });
      toast.success("Local still attached; earlier frames are kept in history");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that image.");
    }
  };

  return (
    <div
      className="space-y-3 outline-none"
      tabIndex={0}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void onFile(event.dataTransfer.files[0] ?? null);
      }}
      onPaste={(event) => {
        const item = [...(event.clipboardData?.items ?? [])].find((value) =>
          value.type.startsWith("image/"),
        );
        const file = item?.getAsFile();
        if (file) void onFile(file);
      }}
    >
      {recoveryState.error ? (
        <p className="text-xs text-destructive" role="alert">
          Image recovery cannot be read: {recoveryState.error} New image requests are blocked until recovery is available.
        </p>
      ) : null}
      {recoveryState.record ? (
        <div className="space-y-2 rounded-md border border-border p-2" role="status" aria-label="Saved image request">
          <p className="text-xs">
            {recoveryState.record.status === "pending"
              ? "An image request is unresolved. Resume its saved request; this keeps the same submission identity."
              : `The saved image request ${recoveryState.record.status === "succeeded" ? "completed" : "failed"}. Review its result before starting another image.`}
          </p>
          {recoveryState.record.error ? <p className="text-xs text-destructive">{recoveryState.record.error}</p> : null}
          {recoveryState.record.jobId ? <p className="break-all font-mono text-[10px]">Image job: {recoveryState.record.jobId}</p> : null}
          {recoveryState.record.status === "succeeded" ? (
            <div className="space-y-2">
              {recoveryState.record.assets?.map((asset, index) => (
                <a key={asset.assetId} href={asset.url} target="_blank" rel="noopener noreferrer"
                  className="block text-xs text-steel underline">Open saved result {index + 1}</a>
              ))}
              <Button size="sm" variant="outline" disabled={!!busy}
                onClick={() => void run("restore", () => resumeShotImage(shot.id, { onJob: setLastJobId }))}>
                {busy === "restore" ? <Loader2 className="animate-spin" /> : null}Restore saved result
              </Button>
              <p className="text-xs text-muted-foreground">Restore checks access to the completed job and keeps the result in frame history; it does not submit a new generation.</p>
            </div>
          ) : null}
          {recoveryState.record.status === "pending" ? (
            <Button size="sm" variant="outline" disabled={!!busy}
              onClick={() => void run("resume", () => resumeShotImage(shot.id, { onJob: setLastJobId }))}>
              {busy === "resume" ? <Loader2 className="animate-spin" /> : null}
              {recoveryState.record.jobId ? "Resume image job" : "Recover image request"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={enableNewImage}>Enable a new image</Button>
          )}
        </div>
      ) : null}
      {shot.videoUrl ? (
        <video
          src={shot.videoUrl}
          controls
          playsInline
          className="aspect-video w-full rounded-md bg-black"
        />
      ) : null}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-xs font-semibold">Frame Generation</span>
        </div>
        <div className="flex items-center gap-1">
          <ConnectionsControl />
          <Button
            size="icon-sm"
            variant="ghost"
            title="Refresh connections"
            onClick={() => void refresh()}
            disabled={!!busy || loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>
      {connections.length > 0 ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Connection</span>
          <select
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={connectionId}
            onChange={(event) => setConnectionId(event.target.value)}
            disabled={!!busy || loading}
          >
            {connections.map((connection, i) => (
              <option key={connection.connectionId} value={connection.connectionId}>
                Cloud {i + 1} · …{connection.connectionId.slice(-6)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-2 text-center text-xs text-muted-foreground">
          <span>No active Google Cloud connection. </span>
          <span className="block mt-0.5 text-[11px]">Click <strong>Connections</strong> above to add your key.</span>
        </div>
      )}
      {connectionError && connections.length > 0 ? (
        <p className="text-xs text-destructive" role="status">
          {connectionError}
        </p>
      ) : null}
      {/* Direction & Prompt Synthesis Tokens */}
      <div className="space-y-1.5 rounded-md border border-border/70 bg-card/60 p-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>Active Direction Tokens</span>
          <span>Synthesized in prompt</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground" title="Shot framing scale">
            Framing: {coverageLabel(shot)}
          </span>
          <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground" title="Camera angle">
            Angle: {shot.camera}
          </span>
          {shot.movement && shot.movement !== "static" ? (
            <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground" title="Camera movement">
              Move: {shot.movement}
            </span>
          ) : null}
          {shot.characters?.length ? (
            <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title="Blocking cast">
              Cast: {shot.characters.join(", ")}
            </span>
          ) : null}
          {shot.lighting ? (
            <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400" title="Lighting ambience">
              Light: {shot.lighting}
            </span>
          ) : null}
        </div>
      </div>

      <KeyFrameGuidance projectId={project.id} shot={shot} mode="frame" disabled={!!busy || !!recoveryState.record || !!recoveryState.error} />
      <Input
        value={direction}
        onChange={(event) => setDirection(event.target.value)}
        aria-label="Image direction"
        placeholder="Image direction: warmer light, wider framing…"
        disabled={!!busy}
      />
      {!stageGate.ready ? (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 p-2 text-xs">
          <p className="font-medium">Stage setup is not ready for visual generation.</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {stageGate.issues.map((item) => <li key={item.code}>{item.message}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2 rounded-md border border-border p-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy || !!recoveryState.record || !!recoveryState.error || !stageGate.ready || compositionPreview || !hasFrameComposition(shot)}
          onClick={() => void capturePlan()}
        >
          {busy === "capture-plan" ? <Loader2 className="animate-spin" /> : <ImageIcon />}
          Capture current plan
        </Button>
        <p className="text-xs text-muted-foreground">Free local capture: the current figures and direction marks are rendered on paper without using or changing the selected still.</p>
        {planGuide ? (
          <div className="space-y-2">
            <img src={planGuide.dataUrl} alt="Captured Frame plan for overhead review" className="aspect-video w-full rounded-sm border border-border object-contain" />
            <label className="flex items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={capturedLayersCurrent && overheadReview === planFingerprint}
                disabled={!capturedLayersCurrent || planGuide.sourceFingerprint !== JSON.stringify(project) || !!busy}
                onChange={(event) => setOverheadReview(event.target.checked ? planFingerprint : null)}
              />
              I compared this captured Frame plan with the source overhead and confirm the room, cast sides, camera, eyelines, hands, and props are correctly placed.
            </label>
          </div>
        ) : null}
        {planGuide && !planGate.ready ? <p className="text-xs text-destructive" role="status">{formatGateIssues(planGate)}</p> : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={!canRun || !planGate.ready || !planGuide}
          className="justify-start gap-2 h-9 px-3"
          onClick={() => void run("board", () => generateShotFrame(shot.id, "storyboard", {
            ...options,
            frameGuide: planGuide!,
            overheadReviewFingerprint: overheadReview,
          }))}
        >
          {busy === "board" ? <Loader2 className="animate-spin" /> : <ImageIcon className="size-4 shrink-0" />}
          <div className="flex flex-col text-left leading-none">
            <span className="text-xs font-semibold">Draft Storyboard</span>
            <span className="text-[10px] text-muted-foreground">Marker / Graphite</span>
          </div>
        </Button>
      </div>
      {selectedStoryboard ? (
        <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={placementReview === placementFingerprint}
            disabled={!!busy}
            onChange={(event) => setPlacementReview(event.target.checked ? placementFingerprint : null)}
          />
          I reviewed this selected storyboard against the overhead and approve its placement as the source for the photoreal still.
        </label>
      ) : null}
      <div className={compact ? "flex flex-col gap-1.5" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canRun || !stillGate.ready}
          className="justify-start gap-2 h-9 px-3"
          onClick={() => void run("still", () => generateShotFrame(shot.id, "still", {
            ...options,
            placementReviewFingerprint: placementReview,
          }))}
        >
          {busy === "still" ? <Loader2 className="animate-spin" /> : <Sparkles className="size-4 shrink-0 text-amber-500" />}
          <div className="flex flex-col text-left leading-none">
            <span className="text-xs font-semibold">Photoreal Keyframe</span>
            <span className="text-[10px] text-muted-foreground">Cinematic Anamorphic</span>
          </div>
        </Button>
      </div>
      {!selectedStoryboard ? <p className="text-xs text-muted-foreground">Select a generated storyboard in Frame history before creating a photoreal keyframe.</p> : null}
      {selectedStoryboard && !stillGate.ready ? <p className="text-xs text-destructive" role="status">{formatGateIssues(stillGate)}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload />
          Upload / paste
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRun || !canEdit || !imageGate.ready || !direction.trim()}
          onClick={() => void run("restyle", () => restyleShotFrame(shot.id, direction, {
            ...options,
            imageReviewFingerprint: imageReview,
          }))}
        >
          {busy === "restyle" ? <Loader2 className="animate-spin" /> : <Wand2 />}Edit current frame
        </Button>
        {!compact && previous?.frameUrl ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!canRun || !canReferencePrevious || !previousImageGate?.ready}
            onClick={() => void run("continue", () => continueFromPrevious(shot.id, {
              ...options,
              imageReviewFingerprint: imageReview,
            }))}
          >
            {busy === "continue" ? <Loader2 className="animate-spin" /> : null}
            Use previous reference
          </Button>
        ) : null}
      </div>
      {selectedReviewedStill && imageReviewFingerprint ? (
        <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={imageReview === imageReviewFingerprint}
            disabled={!!busy}
            onChange={(event) => setImageReview(event.target.checked ? imageReviewFingerprint : null)}
          />
          I reviewed this exact current still and Stage setup as the source for a paid image edit.
        </label>
      ) : null}
      {!compact && previousReviewFingerprint ? (
        <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={imageReview === previousReviewFingerprint}
            disabled={!!busy}
            onChange={(event) => setImageReview(event.target.checked ? previousReviewFingerprint : null)}
          />
          I reviewed the exact previous still and this current Stage setup as the source for a paid continuation.
        </label>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Capture and approve the authored plan before storyboard generation. Photoreal generation then uses the selected, placement-reviewed storyboard as its one image reference.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          void onFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {shot.frameUrl && !canEdit ? (
        <p className="text-xs text-muted-foreground">
          To edit this reference, upload or paste its local raster image. Remote reference URLs are
          not fetched.
        </p>
      ) : null}
      {model ? (
        <p className="text-xs text-muted-foreground">
          {model} · 16:9. Each generation or edit uses your connected account and may incur provider
          charges.
        </p>
      ) : null}
      {shot.frameHistory?.length ? (
        <label className="block text-xs text-muted-foreground">
          <span className="mb-1 block">Frame history · {shot.frameHistory.length} versions</span>
          <select
            className="h-9 w-full rounded-sm border border-border bg-background px-2 text-foreground"
            value={shot.frameUrl ?? ""}
            disabled={!!busy}
            onChange={(event) => {
              const version = shot.frameHistory?.find((item) => item.url === event.target.value);
              if (version?.url) patchShot(shot.id, { frameUrl: version.url, frameKind: version.kind });
            }}
          >
            {!shot.frameHistory.some((version) => version.url === shot.frameUrl) ? (
              <option value={shot.frameUrl ?? ""}>Current frame</option>
            ) : null}
            {shot.frameHistory.map((version, i) => (
              <option key={version.id} value={version.url || `retired:${version.id}`} disabled={!version.url}>
                {i + 1} · {version.url ? version.kind : "Historical reference retired"}
                {!version.url ? "" : version.asset
                  ? ` · ${String(version.asset.provenance.model ?? "Generated")}`
                  : " · Attached"}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {currentAsset ? (
        <p className="text-xs text-muted-foreground">
          Generated from revision {String(currentAsset.provenance.sourceRevision)} ·{" "}
          {currentAsset.width} × {currentAsset.height}. Private image access lasts with this
          session; export while available.
        </p>
      ) : null}
      {lastResult ? (
        <a
          href={lastResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-steel underline"
        >
          <ExternalLink className="size-3" />
          Open latest result · {lastResult.label}
        </a>
      ) : null}
      {lastJobId ? (
        <p className="break-all font-mono text-[10px] text-muted-foreground">
          Image job: {lastJobId}
        </p>
      ) : null}
      <div className="border-t border-border pt-2">
        <Button className="w-full" size="sm" variant="secondary" onClick={() => useSlate.getState().setView("edit")}>
          <Film />
          Open video & music tools
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a take or instrumental cue in Edit using your Google Cloud connection.
        </p>
      </div>
    </div>
  );
}

export function FrameStudio({ shot }: { shot: Shot }) {
  const [frameLayers, setFrameLayers] = useState(DEFAULT_FRAME_LAYERS);
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null);
  const [placeFigureId, setPlaceFigureId] = useState<string | null>(null);
  const setSketch = useSlate((state) => state.setSketch);
  const setAnnotations = useSlate((state) => state.setAnnotations);
  const cast = (shot.blocking?.figures ?? []).filter((figure) => shot.characters?.includes(figure.name));

  useEffect(() => {
    setSelectedFigureId(null);
    setPlaceFigureId(null);
  }, [shot.id]);

  const moveLinkedFigure = (figureId: string, point: { x: number; y: number }) => {
    const current = useSlate.getState();
    const currentShot = current.project.shots.find((candidate) => candidate.id === shot.id);
    if (!currentShot) return;
    const figure = currentShot.blocking.figures.find((candidate) => candidate.id === figureId);
    if (!figure || !currentShot.characters.includes(figure.name)) return;
    const camera = cameraForShot(current.project.floor, currentShot);
    if (!camera) return;
    const position = projectFrameToFloor(point, camera);
    current.setBlocking(
      currentShot.id,
      {
        figures: currentShot.blocking.figures.map((candidate) =>
          candidate.id === figureId ? { ...candidate, x: position.x, y: position.y } : candidate,
        ),
      },
      { syncSketch: false },
    );
  };

  return (
    <div className="space-y-3">
      {cast.length ? (
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Frame cast">
          {cast.map((figure) => {
            const placed = shot.sketch.stamps.some((stamp) => stamp.figureId === figure.id);
            return (
              <Button
                key={figure.id}
                type="button"
                size="sm"
                variant={selectedFigureId === figure.id ? "secondary" : "outline"}
                aria-pressed={selectedFigureId === figure.id}
                aria-label={`${placed ? "Select" : "Place"} ${figure.name} in frame`}
                onClick={() => {
                  setSelectedFigureId(figure.id);
                  setPlaceFigureId(placed ? null : figure.id);
                }}
              >
                {figure.name}
              </Button>
            );
          })}
        </div>
      ) : null}
      <BlockingCanvas
        layers={frameLayers}
        onLayersChange={setFrameLayers}
        sketch={shot.sketch}
        annotations={shot.annotations}
        frameUrl={shot.frameUrl}
        cast={cast}
        selectedFigureId={selectedFigureId}
        placeFigureId={placeFigureId}
        onSelectFigure={(figureId) => {
          setSelectedFigureId(figureId);
          setPlaceFigureId(null);
        }}
        onSketch={(sketch) => setSketch(shot.id, sketch)}
        onAnnotations={(annotations) => setAnnotations(shot.id, annotations)}
        onLinkedMove={moveLinkedFigure}
      />
      <ImagineActions frameLayers={frameLayers} shot={shot} />
    </div>
  );
}
