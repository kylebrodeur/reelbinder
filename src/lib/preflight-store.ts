import { create } from "zustand";
import { toast } from "sonner";
import { cinemaRequest, getCinemaConnections, submitCinemaJob } from "./cinema-client";
import { localPreflight } from "./preflight";
import {
  guardPreflightFinding,
  projectFingerprint,
  type PreflightReviewSource,
} from "./preflight-guard";
import { useSlate } from "./store";
import { MARK_TAGS, type MarkTag, type PreflightFinding, type Project } from "./types";

export type PreflightStatus = "idle" | "running" | "ready" | "error";
export interface ReviewedFinding extends PreflightFinding {
  origin: "local" | "agentic";
  sources: { title: string; url: string }[];
}
interface AgenticResult {
  sourceRevision: number;
  findings: {
    id: string;
    title: string;
    explanation: string;
    elementId?: string;
    text?: string;
    tag?: string;
    note?: string;
    sources: { title: string; url: string }[];
  }[];
}
interface RunOptions {
  connectionId: string;
  research: boolean;
  parallelConnectionId?: string;
}

function findingKey(f: PreflightFinding): string {
  return `${f.title}|${f.elementId ?? ""}|${f.suggest?.tag ?? ""}|${f.suggest?.text ?? ""}`;
}

function reviewSource(project: Project): PreflightReviewSource {
  const fingerprint = projectFingerprint(project);
  return {
    projectId: project.id,
    fingerprint,
    reviewFingerprint: fingerprint,
    backendProjectId: null,
    sourceRevision: null,
    resultRevision: null,
  };
}

function localFindings(project: Project, dismissed: string[]): ReviewedFinding[] {
  return localPreflight(project)
    .filter((finding) => !dismissed.includes(findingKey(finding)))
    .map((finding) => ({ ...finding, origin: "local", sources: [] }));
}

function remoteFindings(result: AgenticResult): ReviewedFinding[] {
  return result.findings.map((finding, index) => ({
    id: `agentic_${index}_${finding.id}`,
    title: finding.title,
    detail: finding.explanation,
    elementId: finding.elementId ?? null,
    severity: "info",
    origin: "agentic",
    suggest:
      finding.tag && (MARK_TAGS as readonly string[]).includes(finding.tag) && finding.text
        ? { tag: finding.tag as MarkTag, text: finding.text, note: finding.note ?? "" }
        : undefined,
    sources: (finding.sources ?? []).filter((source) => {
      try {
        const url = new URL(source.url);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }),
  }));
}

interface PreflightState {
  status: PreflightStatus;
  findings: ReviewedFinding[];
  dismissed: string[];
  reportOpen: boolean;
  error: string | null;
  ranAt: number | null;
  source: PreflightReviewSource | null;
  jobId: string | null;
  setReportOpen: (open: boolean) => void;
  runLocal: () => void;
  run: (options?: RunOptions) => Promise<void>;
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
}

export const usePreflight = create<PreflightState>((set, get) => ({
  status: "idle",
  findings: [],
  dismissed: [],
  reportOpen: false,
  error: null,
  ranAt: null,
  source: null,
  jobId: null,
  setReportOpen: (reportOpen) => set({ reportOpen }),
  runLocal: () => {
    if (get().status === "running") return;
    const project = useSlate.getState().project;
    const dismissed = get().source?.projectId === project.id ? get().dismissed : [];
    set({
      status: "ready",
      source: reviewSource(project),
      findings: localFindings(project, dismissed),
      dismissed,
      error: null,
      ranAt: Date.now(),
      reportOpen: true,
      jobId: null,
    });
  },
  run: async (options) => {
    // Existing entry points can open the report; a live run needs an explicit selection.
    if (!options) {
      set({ reportOpen: true });
      return;
    }
    const { connectionId, research, parallelConnectionId } = options;
    if (get().status === "running") return;
    const project = structuredClone(useSlate.getState().project);
    const source = reviewSource(project);
    const dismissed = get().source?.projectId === project.id ? get().dismissed : [];
    const local = localFindings(project, dismissed);
    set({
      status: "running",
      findings: local,
      source,
      dismissed,
      error: null,
      reportOpen: true,
      jobId: null,
    });
    try {
      const connections = await getCinemaConnections();
      const configured = (id: string | undefined, provider: string) =>
        connections.some(
          (connection) =>
            connection.connectionId === id &&
            connection.provider === provider &&
            connection.status === "configured" &&
            connection.expiresAt * 1000 > Date.now(),
        );
      if (!configured(connectionId, "google-cloud"))
        throw new Error(
          "Add a Google Cloud connection using the Connections button, then refresh connections here.",
        );
      if (research && !configured(parallelConnectionId, "parallel"))
        throw new Error(
          "Parallel research requires a Parallel connection. Add it using Connections.",
        );
      const saved = await cinemaRequest<{ projectId: string; revision: number }>("/projects", {
        method: "POST",
        body: JSON.stringify({ project }),
      });
      if (saved.revision !== 1 || !saved.projectId)
        throw new Error("The review snapshot could not be established.");
      const submittedSource = {
        ...source,
        backendProjectId: saved.projectId,
        sourceRevision: saved.revision,
      };
      set({ source: submittedSource });
      const result = await submitCinemaJob<AgenticResult>(
        {
          kind: "preflight",
          connectionId,
          ...(research ? { parallelConnectionId } : {}),
          projectId: saved.projectId,
          expectedRevision: saved.revision,
          idempotencyKey: crypto.randomUUID(),
          input: { research },
        },
        (jobId) => set({ jobId }),
      );
      if (result.sourceRevision !== saved.revision || !Array.isArray(result.findings)) {
        throw new Error("The returned review does not match the submitted project revision.");
      }
      const findings = [...local, ...remoteFindings(result)].filter(
        (finding) => !dismissed.includes(findingKey(finding)),
      );
      const current = useSlate.getState().project;
      const changed =
        current.id !== source.projectId || projectFingerprint(current) !== source.fingerprint;
      set({
        status: "ready",
        findings,
        source: { ...submittedSource, resultRevision: result.sourceRevision },
        ranAt: Date.now(),
        error: changed
          ? "The project changed while Preflight ran. Review these notes, then run again before accepting."
          : null,
      });
      if (!changed) toast.success(`${findings.length} preflight notes ready for review`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preflight could not finish.";
      // Retain independently computed local notes; a failed live run is not an agentic result.
      set({ status: "error", findings: local, source, error: message });
      toast.error(message);
    }
  },
  accept: (id) => {
    const state = get();
    if (state.status === "running") return;
    const finding = state.findings.find((candidate) => candidate.id === id);
    if (!finding?.suggest) return;
    const result = guardPreflightFinding(useSlate.getState().project, state.source, {
      elementId: finding.elementId,
      ...finding.suggest,
    });
    if (!result.ok) {
      set({ error: result.error });
      toast.error(result.error);
      return;
    }
    useSlate.getState().addMark(result.mark);
    const reviewFingerprint = projectFingerprint(useSlate.getState().project);
    set((current) => ({
      findings: current.findings.filter((candidate) => candidate.id !== id),
      dismissed: [...current.dismissed, findingKey(finding)],
      source: current.source ? { ...current.source, reviewFingerprint } : null,
    }));
    toast.success(`Marked ${finding.suggest.tag}`);
  },
  reject: (id) => {
    if (get().status === "running") return;
    const finding = get().findings.find((candidate) => candidate.id === id);
    if (!finding) return;
    set((state) => ({
      findings: state.findings.filter((candidate) => candidate.id !== id),
      dismissed: [...state.dismissed, findingKey(finding)],
    }));
  },
  acceptAll: () => {
    for (const finding of get().findings) {
      if (finding.suggest) get().accept(finding.id);
    }
  },
  rejectAll: () => {
    if (get().status === "running") return;
    set((state) => ({
      findings: [],
      dismissed: [...state.dismissed, ...state.findings.map(findingKey)],
    }));
  },
}));
