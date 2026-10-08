import { create } from "zustand";

/**
 * In-memory record of Page Agent runs per project so the sidebar's Activity
 * pane can show run cards next to Parallel research activity. Session-scoped
 * and not persisted: run history is presentation state, not saved evidence.
 */
export interface PageAgentRun {
  /** PageAgentCore taskId, or a fresh id when the run had not been numbered yet. */
  runId: string;
  /** The task text the filmmaker asked, bounded for display. */
  task: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  endedAt?: number;
  /** Bounded final output or error message shown on the card. */
  summary?: string;
}

interface PageAgentRunsState {
  runs: Record<string, PageAgentRun[]>;
  recordRunStarted: (projectId: string, run: { runId: string; task: string }) => void;
  /** Terminal result of a started run; unmatched/no-op when the run never started. */
  recordRunFinished: (projectId: string, run: { runId: string; status: "completed" | "failed"; summary?: string }) => void;
  /** Clear the runs history for one project (a New-session reset). */
  clearRuns: (projectId: string) => void;
}

const MAX_RUNS_PER_PROJECT = 10;

export const usePageAgentRuns = create<PageAgentRunsState>((set) => ({
  runs: {},
  recordRunStarted: (projectId, { runId, task }) =>
    set((state) => ({
      runs: {
        ...state.runs,
        [projectId]: [
          { runId, task, status: "running" as const, startedAt: Date.now() },
          ...(state.runs[projectId] ?? []),
        ].slice(0, MAX_RUNS_PER_PROJECT),
      },
    })),
  recordRunFinished: (projectId, { runId, status, summary }) =>
    set((state) => ({
      runs: {
        ...state.runs,
        [projectId]: (state.runs[projectId] ?? []).map((run) =>
          run.runId === runId && run.status === "running"
            ? { ...run, status, summary, endedAt: Date.now() }
            : run,
        ),
      },
    })),
  clearRuns: (projectId) =>
    set((state) => ({
      runs: { ...state.runs, [projectId]: [] },
    })),
}));

/** Record the start of a Page Agent run for the sidebar Activity pane. */
export function recordRunStarted(projectId: string, run: { runId: string; task: string }): void {
  usePageAgentRuns.getState().recordRunStarted(projectId, run);
}

/** Record the terminal result of a started Page Agent run. */
export function recordRunFinished(
  projectId: string,
  run: { runId: string; status: "completed" | "failed"; summary?: string },
): void {
  usePageAgentRuns.getState().recordRunFinished(projectId, run);
}