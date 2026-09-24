import { KeyFrameGuidance } from "@/components/app/key-frame-guidance";
import { Film, Loader2, Music2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConnectionsControl } from "@/components/app/cinema-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cinemaRequest,
  assertCinemaJobId,
  CinemaJobFailure,
  CinemaRequestFailure,
  formatCinemaRequestFailure,
  getCinemaConnections,
  getCinemaHealth,
  waitForCinemaJob,
  type CinemaConnection,
  type CinemaHealth,
} from "@/lib/cinema-client";
import {
  createMediaJobRequest,
  createMediaFlightRegistry,
  mediaRecoverySettings,
  parseMediaPreparation,
  parseMediaRecovery,
  validateCinemaMediaResult,
  type CinemaMediaAsset,
  type CinemaMediaKind,
  type MediaRecovery,
  type MediaPreparation,
} from "@/lib/cinema-media";
import { useSlate } from "@/lib/store";
import { initialMediaPrompt } from "@/lib/media-prompt";
import { formatGateIssues, videoReadiness, videoReviewFingerprint } from "@/lib/production-gates";
import type { Project, Shot } from "@/lib/types";

const mediaFlights = createMediaFlightRegistry<void>();

export interface MediaStudioProps {
  project: Project;
  shot: Shot | null;
  mode?: CinemaMediaKind;
  onVideo: (asset: CinemaMediaAsset, shotId: string) => void;
  onMusic: (asset: CinemaMediaAsset) => void;
}

export function MediaStudio(props: MediaStudioProps) {
  const [selected, setSelected] = useState<CinemaMediaKind>(props.shot ? "video" : "music");
  const kind = props.mode ?? selected;
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3">
      {!props.mode && (
        <div className="flex gap-2" role="group" aria-label="Media tools">
          <Button
            size="sm"
            variant={kind === "video" ? "secondary" : "ghost"}
            onClick={() => setSelected("video")}
          >
            <Film />
            Animate shot
          </Button>
          <Button
            size="sm"
            variant={kind === "music" ? "secondary" : "ghost"}
            onClick={() => setSelected("music")}
          >
            <Music2 />
            Music cue
          </Button>
        </div>
      )}
      <MediaJobPanel
        key={`${props.project.id}:${kind}:${kind === "video" ? (props.shot?.id ?? "none") : "project"}`}
        {...props}
        kind={kind}
      />
    </section>
  );
}

async function fingerprint(project: Project): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(project)),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function MediaJobPanel({
  project,
  shot,
  kind,
  onVideo,
  onMusic,
}: MediaStudioProps & { kind: CinemaMediaKind }) {
  const shotId = kind === "video" ? (shot?.id ?? null) : null;
  const storageKey = `slate:media:${project.id}:${kind}:${shotId ?? "project"}`;
  const [prompt, setPrompt] = useState(initialMediaPrompt(project, shot, kind));
  const [negativePrompt, setNegativePrompt] = useState("Vocals");
  const [duration, setDuration] = useState<4 | 6 | 8>(
    kind === "video" && shot && [4, 6, 8].includes(shot.durationSec)
      ? shot.durationSec as 4 | 6 | 8
      : 4,
  );
  const [ratio, setRatio] = useState<"16:9" | "9:16">("16:9");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [health, setHealth] = useState<CinemaHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirmedCharge, setConfirmedCharge] = useState(false);
  const [recovery, setRecovery] = useState<MediaRecovery | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [frozenConnectionId, setFrozenConnectionId] = useState<string | null>(null);
  const [assets, setAssets] = useState<CinemaMediaAsset[]>([]);
  const [error, setError] = useState("");
  const [canReset, setCanReset] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [reviewedChange, setReviewedChange] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [videoReview, setVideoReview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSignature(null);
    setReviewedChange(null);
    setVideoReview(null);
    void fingerprint(project)
      .then((value) => {
        if (active) setSignature(value);
      })
      .catch(() => {
        if (active) setError("Could not capture the project revision for generation.");
      });
    return () => {
      active = false;
    };
  }, [project]);
  useEffect(() => {
    let active = true;
    setVideoReview(null);
    const restore = () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const context = { kind, localProjectId: project.id, shotId };
        const saved = parseMediaRecovery(raw, context);
        const preparation = parseMediaPreparation(raw, context);
        if (raw && !saved && !preparation) {
          setError(
            "Saved job details could not be restored. Do not repeat a paid request until its status is known.",
          );
          return;
        }
        setRecovery(saved);
        setPreparing(!!preparation);
        const frozen = saved ?? preparation;
        if (frozen) {
          const settings = mediaRecoverySettings(frozen);
          setPrompt(settings.prompt);
          setFrozenConnectionId(frozen.request.connectionId ?? null);
          if (settings.durationSeconds !== undefined) setDuration(settings.durationSeconds);
          if (settings.aspectRatio !== undefined) setRatio(settings.aspectRatio);
          if (settings.generateAudio !== undefined) setGenerateAudio(settings.generateAudio);
          if (settings.negativePrompt !== undefined) setNegativePrompt(settings.negativePrompt);
        }
        if (preparation && !mediaFlights.get(storageKey)) {
          setCanReset(true);
          setError(
            "Preparation stopped before a generation was submitted. Clear it to prepare a new request.",
          );
        }
        setRestored(true);
      } catch {
        setError(
          "Session recovery storage is unavailable. Restore it before submitting a paid job.",
        );
      }
    };
    restore();
    const flight = mediaFlights.get(storageKey);
    if (flight) {
      setBusy(true);
      void flight.finally(() => {
        if (active) {
          restore();
          setBusy(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [storageKey, kind, project.id, shotId]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [items, status] = await Promise.all([getCinemaConnections(), getCinemaHealth()]);
      const standard = items.filter(
        (connection) =>
          connection.provider === "google-cloud" &&
          connection.mode === "standard" &&
          !!connection.projectId,
      );
      setConnections(standard);
      setHealth(status);
      setConnectionId((current) =>
        standard.some((connection) => connection.connectionId === current)
          ? current
          : (standard[0]?.connectionId ?? ""),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read media availability.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = (value: MediaRecovery) => {
    // Save the exact request before submission, then the job ID before polling.
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    setRecovery(value);
    setPreparing(false);
    setFrozenConnectionId(value.request.connectionId ?? null);
  };
  const reset = () => {
    if (mediaFlights.get(storageKey)) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      setError(
        "Could not clear saved job details. Keep this result until session storage is available.",
      );
      return;
    }
    setRecovery(null);
    setPreparing(false);
    setFrozenConnectionId(null);
    setAssets([]);
    setCanReset(false);
    setConfirmedCharge(false);
    setVideoReview(null);
    setError("");
    setApplied(false);
  };
  const capability = health?.capabilities[kind];
  const configured = capability?.status === "configured";
  const sourceChanged = !!recovery && signature !== null && recovery.sourceSignature !== signature;
  const localReference =
    !!shot?.frameUrl && /^\/api\/cinema\/assets\/[A-Za-z0-9_-]+\/content$/.test(shot.frameUrl);
  const videoIntent = kind === "video"
    ? { prompt, durationSeconds: duration, aspectRatio: ratio, generateAudio }
    : undefined;
  const expectedVideoReview = kind === "video" && shotId
    ? videoReviewFingerprint(project, shotId, videoIntent)
    : null;
  const videoGate = kind === "video" && shotId
    ? videoReadiness(project, shotId, videoReview, videoIntent)
    : null;

  const execute = async () => {
    setBusy(true);
    setError("");
    setCanReset(false);
    let record = recovery;
    let prepared = !!record;
    let submitting = false;
    try {
      if (!record) {
        if (kind === "video" && shotId) {
          const currentGate = videoReadiness(project, shotId, videoReview, videoIntent);
          if (!currentGate.ready) throw new Error(formatGateIssues(currentGate));
        }
        if (!confirmedCharge || !configured || !connectionId || !signature)
          throw new Error("Confirm this generation and connect an available Cloud project first.");
        if (kind === "video" && !shotId) throw new Error("Select a shot to animate.");
        const preparation: MediaPreparation = {
          phase: "preparing",
          version: 1,
          kind,
          localProjectId: project.id,
          shotId,
          sourceSignature: signature,
          jobId: null,
          request: createMediaJobRequest({
            kind,
            connectionId,
            projectId: "__pending_snapshot__",
            revision: 1,
            idempotencyKey: crypto.randomUUID(),
            prompt,
            ...(shotId ? { shotId } : {}),
            durationSeconds: duration,
            aspectRatio: ratio,
            generateAudio,
            referenceUrl: shot?.frameUrl,
            negativePrompt,
          }),
        };
        // A remount sees this marker and the shared flight before any network work begins.
        sessionStorage.setItem(storageKey, JSON.stringify(preparation));
        setPreparing(true);
        setFrozenConnectionId(connectionId);
        const saved = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
          method: "POST",
          body: JSON.stringify({ project }),
        });
        if (typeof saved.projectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(saved.projectId) || saved.revision !== 1)
          throw new Error("The source snapshot returned invalid identity. No generation was submitted; clear preparation and try again.");
        const { phase: _phase, ...intent } = preparation;
        record = {
          ...intent,
          request: {
            ...intent.request,
            projectId: saved.projectId,
            expectedRevision: saved.revision,
          },
        };
        persist(record);
        prepared = true;
      }
      if (!record.jobId) {
        submitting = true;
        const submitted = await cinemaRequest<{ jobId: string }>("/jobs", {
          method: "POST",
          body: JSON.stringify(record.request),
        });
        assertCinemaJobId(submitted.jobId);
        submitting = false;
        record = { ...record, jobId: submitted.jobId };
        // Retain the ID in memory even if storage becomes unavailable after submission.
        setRecovery(record);
        try {
          persist(record);
        } catch {
          setError(`Keep job ${submitted.jobId}; session recovery storage is unavailable.`);
        }
      }
      if (!record.jobId) throw new Error("No job ID was returned. Keep this request for recovery.");
      const result = await waitForCinemaJob<unknown>(record.jobId);
      setAssets(
        validateCinemaMediaResult(result, {
          kind,
          projectId: record.request.projectId!,
          revision: record.request.expectedRevision!,
          shotId: record.shotId,
          jobId: record.jobId,
          referenceAssetIds: kind === "video" ? record.request.input.referenceAssetIds as string[] : [],
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof CinemaRequestFailure
          ? formatCinemaRequestFailure(failure)
          : failure instanceof Error
            ? failure.message
            : "The media job could not complete.",
      );
      setCanReset(
        !prepared ||
          (failure instanceof CinemaJobFailure && failure.code !== "INTERRUPTED_UNCERTAIN") ||
          (submitting &&
            failure instanceof CinemaRequestFailure &&
            [400, 401, 403, 404, 413, 422, 503].includes(failure.status)),
      );
    } finally {
      setBusy(false);
    }
  };
  const run = () => mediaFlights.run(storageKey, execute);

  const apply = async (asset: CinemaMediaAsset) => {
    if (
      !recovery ||
      recovery.localProjectId !== project.id ||
      !signature ||
      (sourceChanged && reviewedChange !== signature)
    )
      return;
    const current = useSlate.getState().project;
    const before = JSON.stringify(current);
    try {
      const currentSignature = await fingerprint(current);
      if (current.id !== recovery.localProjectId || currentSignature !== signature ||
          JSON.stringify(useSlate.getState().project) !== before) {
        setError("The project changed before this result could be applied. Review it against the current film again.");
        return;
      }
    } catch {
      setError("Could not verify the current Project revision. Review this result again.");
      return;
    }
    if (kind === "video") {
      if (
        !recovery.shotId ||
        !current.shots.some((candidate) => candidate.id === recovery.shotId)
      ) {
        setError("The source shot no longer exists. Keep this take as a downloadable result.");
        return;
      }
      onVideo(asset, recovery.shotId);
    } else onMusic(asset);
    setApplied(true);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            {kind === "video"
              ? shot
                ? `Animate shot ${shot.number} · ${shot.title}`
                : "Select a shot to animate"
              : `Music cue · ${project.name}`}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {kind === "video"
              ? "Generate a take, watch it, then choose whether to use it."
              : "Create an instrumental cue, listen, then add it to the film."}
          </p>
        </div>
        <ConnectionsControl />
      </div>
      <div className="flex items-start justify-between gap-2 rounded-md bg-secondary/50 p-2 text-xs">
        <div>
          <p>{capability?.model ?? "Model not configured"}</p>
          <p className="mt-1 text-muted-foreground">
            {capability?.reason ?? "Read tool status after the cinema service is connected."}
          </p>
          <p className="mt-1 text-muted-foreground">
            {configured
              ? "Configured; live access depends on your connected project."
              : "Generation is currently unavailable."}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh media connections and models"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      {!assets.length && (
        <>
          <label className="grid gap-1.5 text-xs">
            Cloud project
            <select
              className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2"
              value={frozenConnectionId ?? connectionId}
              disabled={busy || !!recovery || preparing}
              onChange={(event) => setConnectionId(event.target.value)}
            >
              {!connections.length && (
                <option value="">Connect a Cloud project with an access token</option>
              )}
              {frozenConnectionId &&
                !connections.some(
                  (connection) => connection.connectionId === frozenConnectionId,
                ) && <option value={frozenConnectionId}>Original saved connection</option>}
              {connections.map((connection) => (
                <option key={connection.connectionId} value={connection.connectionId}>
                  {connection.projectId} · {connection.location ?? "configured region"}
                </option>
              ))}
            </select>
          </label>
          {kind === "video" && shot && <KeyFrameGuidance projectId={project.id} shot={shot} mode="take" />}
          {kind === "video" && videoGate && !videoGate.ready ? (
            <div role="alert" className="space-y-1 rounded-md border border-destructive/40 p-2 text-xs">
              <p className="font-medium">This setup is not ready for paid video generation.</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {videoGate.issues.map((item) => <li key={item.code}>{item.message}</li>)}
              </ul>
            </div>
          ) : null}
          <label className="grid gap-1.5 text-xs">
            {kind === "video"
              ? "Motion, performance and camera direction"
              : "Mood, instruments and musical direction"}
            <Textarea
              rows={3}
              maxLength={10000}
              value={prompt}
              disabled={busy || !!recovery || preparing}
              onChange={(event) => {
                setPrompt(event.target.value);
                setVideoReview(null);
              }}
            />
          </label>
          {kind === "video" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs">
                  Take length
                  <select
                    className="h-9 rounded-md border border-border bg-background px-2"
                    value={duration}
                    disabled={busy || !!recovery || preparing}
                    onChange={(event) => {
                      setDuration(Number(event.target.value) as 4 | 6 | 8);
                      setVideoReview(null);
                    }}
                  >
                    {[4, 6, 8].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds} seconds
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs">
                  Frame
                  <select
                    className="h-9 rounded-md border border-border bg-background px-2"
                    value={ratio}
                    disabled={busy || !!recovery || preparing}
                    onChange={(event) => {
                      setRatio(event.target.value as "16:9" | "9:16");
                      setVideoReview(null);
                    }}
                  >
                    <option value="16:9">16:9 landscape</option>
                    <option value="9:16">9:16 portrait</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  disabled={busy || !!recovery || preparing}
                  onChange={(event) => {
                    setGenerateAudio(event.target.checked);
                    setVideoReview(null);
                  }}
                />
                Request sound with the take
              </label>
              <p className="text-xs text-muted-foreground">
                {localReference
                  ? "Veo receives this selected, reviewed photoreal still as its one starting image."
                  : "Generate and select a storyboard-descended photoreal still before creating video."}
              </p>
              {expectedVideoReview ? (
                <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={videoReview === expectedVideoReview}
                    disabled={busy || !!recovery || preparing}
                    onChange={(event) => setVideoReview(event.target.checked ? expectedVideoReview : null)}
                  />
                  I reviewed the selected photoreal still, its one-start-frame intent, the feasible motion, and the planned cut. No intermediate or end keyframe is being sent to Veo.
                </label>
              ) : null}
            </>
          ) : (
            <label className="grid gap-1.5 text-xs">
              Exclude from the cue
              <Input
                maxLength={5000}
                value={negativePrompt}
                disabled={busy || !!recovery || preparing}
                onChange={(event) => setNegativePrompt(event.target.value)}
              />
            </label>
          )}
          {!recovery && !preparing && (
            <label className="flex items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmedCharge}
                disabled={busy}
                onChange={(event) => setConfirmedCharge(event.target.checked)}
              />
              Use my connected Cloud project for this generation. Model usage may incur charges.
            </label>
          )}
          <Button
            className="w-full"
            disabled={
              busy ||
              preparing ||
              !restored ||
              (!recovery &&
                (!configured ||
                  !connectionId ||
                  !confirmedCharge ||
                  !prompt.trim() ||
                  !signature ||
                  (kind === "video" && (!shotId || !videoGate?.ready))))
            }
            onClick={() => void run()}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                Waiting for media…
              </>
            ) : recovery?.jobId ? (
              "Check existing job"
            ) : recovery ? (
              "Resume original request"
            ) : kind === "video" ? (
              "Generate take"
            ) : (
              "Generate music cue"
            )}
          </Button>
        </>
      )}
      {recovery && (
        <p className="break-all text-xs text-muted-foreground">
          {recovery.jobId
            ? `Job: ${recovery.jobId}. Checking it does not submit another generation.`
            : "The original request is saved. Resume uses the same request ID."}{" "}
          Generation may take several minutes; you can return to this tool and check again.
        </p>
      )}
      {!!assets.length && (
        <div className="space-y-3">
          {sourceChanged && !applied && (
            <label className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={reviewedChange === signature}
                onChange={(event) => setReviewedChange(event.target.checked ? signature : null)}
              />
              The project changed after this generation. I reviewed this result against the current
              film and want to keep it.
            </label>
          )}
          {assets.map((asset) => (
            <div key={asset.assetId} className="space-y-2">
              {kind === "video" ? (
                <video
                  src={asset.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-72 w-full rounded-md bg-black"
                />
              ) : (
                <audio src={asset.url} controls preload="metadata" className="w-full" />
              )}
              <p className="text-xs text-muted-foreground">
                {asset.durationSec.toFixed(2)}s measured
                {asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""} ·{" "}
                {String(asset.provenance.model ?? "connected model")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={applied || !signature || (sourceChanged && reviewedChange !== signature)}
                  onClick={() => void apply(asset)}
                >
                  {applied ? "Added to film" : kind === "video" ? "Use this take" : "Add music cue"}
                </Button>
                <a className="inline-flex items-center text-xs underline" href={asset.url} download>
                  {kind === "video" ? "Download take" : "Download cue"}
                </a>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Media belongs to this session. Download it while available. Applying keeps previous
            takes through the film’s history.
          </p>
          <Button variant="ghost" size="sm" onClick={reset}>
            {applied ? "Prepare another generation" : "Discard this result"}
          </Button>
        </div>
      )}
      {canReset && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This request failed. Starting another generation may incur a new charge.
          </p>
          <Button variant="outline" size="sm" onClick={reset}>
            Start a new request
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-2 text-xs leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}
