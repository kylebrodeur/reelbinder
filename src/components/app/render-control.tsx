import { Download, Film, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CinemaJobFailure,
  CinemaRequestFailure,
  cinemaRequest,
  formatCinemaRequestFailure,
  waitForCinemaJob,
} from "@/lib/cinema-client";
import {
  pictureRenderSources,
  prepareRenderPictureAssets,
  readRenderRecovery,
  renderDuration,
  renderFingerprint,
  validateRenderResult,
  type CinemaRenderResult,
  type RenderRecovery,
} from "@/lib/cinema-render";
import { useSlate } from "@/lib/store";
import { timelineAudioRenderInputs } from "@/lib/timeline-audio";
import type { EditTimeline } from "@/lib/types";

const storageKey = (id: string) => `slate-render-v1:${encodeURIComponent(id)}`;

export function RenderControl({ timeline }: { timeline: EditTimeline }) {
  const project = useSlate((state) => state.project);
  const snapshot = useMemo(() => ({ ...project, timeline }), [project, timeline]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<RenderRecovery | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [applied, setApplied] = useState(false);
  const live = useRef({ id: project.id, mounted: true });
  live.current.id = project.id;
  const running = useRef(new Set<string>());
  const preparing = useRef(false);

  const preparation = useMemo(() => {
    try {
      const duration = renderDuration(snapshot);
      return {
        duration,
        sources: pictureRenderSources(snapshot),
        audioCues: timelineAudioRenderInputs(snapshot.audioClips ?? [], duration),
        error: "",
      };
    } catch (failure) {
      return {
        duration: 0,
        sources: [],
        audioCues: [],
        error: failure instanceof Error ? failure.message : "The edit is not ready to render.",
      };
    }
  }, [snapshot]);

  const persist = useCallback((record: RenderRecovery) => {
    // A request is durable before POST /jobs. Retrying reuses these exact inputs/key.
    sessionStorage.setItem(storageKey(record.localProjectId), JSON.stringify(record));
    if (live.current.mounted && live.current.id === record.localProjectId) setPending(record);
  }, []);

  const resolve = useCallback(
    async (recovery: RenderRecovery) => {
      const key = recovery.request.idempotencyKey;
      if (running.current.has(key)) {
        if (live.current.mounted && live.current.id === recovery.localProjectId) setBusy(true);
        return;
      }
      running.current.add(key);
      let record = recovery;
      const visible = () => live.current.mounted && live.current.id === record.localProjectId;
      if (visible()) {
        setBusy(true);
        setError("");
        setStage("Rendering the saved picture edit…");
      }
      try {
        if (!record.jobId) {
          const job = await cinemaRequest<{ jobId: string }>("/jobs", {
            method: "POST",
            body: JSON.stringify(record.request),
          });
          record = { ...record, jobId: job.jobId };
          persist(record);
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
        persist(record);
        if (visible()) {
          setStage("Cut ready");
          setApplied(false);
        }
      } catch (failure) {
        const message =
          failure instanceof CinemaRequestFailure
            ? formatCinemaRequestFailure(failure)
            : failure instanceof Error
              ? failure.message
              : "The render could not finish.";
        const terminal =
          failure instanceof CinemaJobFailure ||
          (failure instanceof CinemaRequestFailure &&
            failure.status >= 400 &&
            failure.status < 500 &&
            ![408, 429].includes(failure.status));
        if (terminal) {
          record = { ...record, terminalError: message };
          try {
            persist(record);
          } catch {
            /* The original request remains recoverable. */
          }
        }
        if (visible()) setError(message);
      } finally {
        running.current.delete(key);
        if (visible()) {
          setBusy(false);
          setStage("");
        }
      }
    },
    [persist],
  );

  useEffect(() => {
    live.current.mounted = true;
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
        "Browser session storage is unavailable. Enable it before starting a recoverable render.",
      );
    }
    const currentLive = live.current;
    return () => {
      currentLive.mounted = false;
    };
  }, [project.id, resolve]);

  useEffect(() => {
    let cancelled = false;
    setFingerprint("");
    void renderFingerprint(snapshot)
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
  }, [snapshot]);

  const start = async () => {
    if (preparing.current || busy || (pending && !pending.result && !pending.terminalError)) return;
    preparing.current = true;
    setBusy(true);
    setError("");
    setApplied(false);
    const source = structuredClone(snapshot);
    const localProjectId = source.id;
    const visible = () => live.current.mounted && live.current.id === localProjectId;
    try {
      // Capture the whole Project before preparation; subsequent edits cannot change this job.
      const sourceFingerprint = await renderFingerprint(source);
      const duration = renderDuration(source);
      const audioCues = timelineAudioRenderInputs(source.audioClips ?? [], duration);
      if (visible()) setStage("Preparing selected picture assets…");
      const pictureAssets = await prepareRenderPictureAssets(source, (body) =>
        cinemaRequest<{ assetId: string; url: string }>("/assets", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      if (visible()) setStage("Saving the complete edit snapshot…");
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
      if (visible())
        setError(failure instanceof Error ? failure.message : "Could not prepare the render.");
    } finally {
      preparing.current = false;
      if (visible()) {
        setBusy(false);
        setStage("");
      }
    }
  };

  const result = pending?.result;
  const asset = result?.assets[0];
  const changed = Boolean(pending && fingerprint && pending.sourceFingerprint !== fingerprint);
  const unresolved = Boolean(pending && !result && !pending.terminalError);

  const applyCut = async () => {
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
    useSlate.getState().patchProject({ cutUrl: asset.url });
    setApplied(true);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="default">
          <Film />
          {busy ? "Rendering…" : asset ? "Download cut" : "Render cut"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Render & download</DialogTitle>
          <DialogDescription>
            Make a 720p MP4 from your chosen picture excerpts. Still frames hold for their selected
            duration.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{preparation.sources.length} picture clips</span>
          <span>·</span>
          <span>{preparation.duration.toFixed(2)} seconds planned</span>
          <span>·</span>
          <span>24 fps</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {preparation.audioCues.length} audio clips from the timeline mix. Adjust timing, gain and
          mute in Edit before rendering.
        </p>
        {preparation.error ? <p className="text-sm text-destructive">{preparation.error}</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {stage || "Checking the render…"}
          </p>
        ) : null}
        {pending?.jobId ? (
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            Render job {pending.jobId}
          </p>
        ) : null}
        {unresolved && !busy ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The saved render is unresolved. Resume it using the same request.
            </p>
            <Button onClick={() => void resolve(pending!)}>
              <RotateCw />
              Resume render
            </Button>
          </div>
        ) : null}
        {asset ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <video
              key={asset.assetId}
              src={asset.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded bg-black"
            />
            <p className="text-xs text-muted-foreground">
              Measured output: {asset.width} × {asset.height} · {asset.fps} fps ·{" "}
              {asset.durationSec.toFixed(2)}s · {(asset.byteSize / 1024 / 1024).toFixed(1)} MiB
            </p>
            {changed ? (
              <p className="text-sm text-amber-600">
                The project changed after this version started rendering. This MP4 stays available
                for review and download.
              </p>
            ) : null}
            {result!.warnings.length ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {result!.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a
                  href={asset.url}
                  download={`${project.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "film"}-cut.mp4`}
                >
                  <Download />
                  Download MP4
                </a>
              </Button>
              <Button
                variant="secondary"
                disabled={!fingerprint || changed || busy || applied}
                onClick={() => void applyCut()}
              >
                {applied ? "Set as final cut" : "Use as final cut"}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Button
            disabled={busy || unresolved || Boolean(preparation.error) || !fingerprint}
            onClick={() => void start()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Film />}
            {asset || pending?.terminalError ? "Render current edit" : "Render MP4"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Local rendering uses no AI credits. Source alignment estimates remain estimates.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
