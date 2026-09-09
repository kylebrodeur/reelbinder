import { useSlate } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ContinuityRail() {
  const issues = useSlate((s) => s.issues);
  const selectShot = useSlate((s) => s.selectShot);
  const setView = useSlate((s) => s.setView);
  const view = useSlate((s) => s.view);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;

  const next =
    view === "script"
      ? { label: "Stage the setup", go: "stage" as const }
      : view === "stage"
        ? { label: "Edit the cut", go: "edit" as const }
        : view === "edit"
          ? { label: "Render", go: "render" as const }
          : { label: "Back to script", go: "script" as const };

  if (issues.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 text-xs text-ok">
        <span>Continuity is clean. Script → Stage → Play → Edit.</span>
        <button type="button" className="text-steel" onClick={() => setView(next.go)}>
          {next.label}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card">
      <div className="flex gap-4 overflow-x-auto px-4 py-2">
        <span className="shrink-0 self-center font-mono text-xs tabular-nums text-muted-foreground">
          {errors} breaks · {warns} checks
        </span>
        {issues.map((iss) => (
          <button
            key={iss.id}
            type="button"
            onClick={() => iss.shotId && selectShot(iss.shotId)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs",
              iss.severity === "error"
                ? "border-destructive/40 text-destructive"
                : iss.severity === "warn"
                  ? "border-warn/40 text-warn"
                  : "border-border text-muted-foreground",
            )}
          >
            {iss.title}
          </button>
        ))}
      </div>
    </div>
  );
}
