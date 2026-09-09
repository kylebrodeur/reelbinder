import { CAMERA_META } from "@/lib/filmmaking";
import { groupShotsByScene } from "@/lib/fountain";
import { useSlate } from "@/lib/store";
import { cn } from "@/lib/utils";

export function GraphView() {
  const project = useSlate((s) => s.project);
  const selectedId = useSlate((s) => s.selectedId);
  const selectShot = useSlate((s) => s.selectShot);
  const issues = useSlate((s) => s.issues);
  const groups = groupShotsByScene(project);

  if (project.shots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Board beats from the script to see the chain.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        {groups.map((group, gi) => (
          <section key={group.scene?.id ?? `g-${gi}`}>
            <h2 className="mb-3 font-script text-xs uppercase tracking-wide text-muted-foreground">
              {group.scene?.text || "Unlinked"}
            </h2>
            <div className="flex flex-col">
              {group.shots.map((shot, i) => {
                const hard = issues.some((iss) => iss.shotId === shot.id && iss.severity === "error");
                const next = group.shots[i + 1];
                const axisBreak =
                  next &&
                  ((shot.screenDirection === "L-R" && next.screenDirection === "R-L") ||
                    (shot.screenDirection === "R-L" && next.screenDirection === "L-R"));
                return (
                  <div key={shot.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => selectShot(shot.id)}
                      className={cn(
                        "flex w-full items-stretch overflow-hidden rounded-lg border text-left",
                        selectedId === shot.id ? "border-steel/50" : "border-border",
                      )}
                    >
                      <div className="flex w-16 shrink-0 flex-col items-center justify-center bg-secondary font-mono text-xs tabular-nums text-muted-foreground">
                        {String(shot.number).padStart(2, "0")}
                        <span className="mt-1 text-steel">{shot.durationSec}s</span>
                      </div>
                      <div className="min-w-0 flex-1 px-4 py-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <h3 className="font-medium">{shot.title}</h3>
                          <span className="text-xs text-muted-foreground">
                            {CAMERA_META[shot.camera].label} · {shot.screenDirection}
                          </span>
                          {shot.videoUrl && <span className="text-xs text-steel">clip</span>}
                          {!shot.videoUrl && shot.frameUrl && (
                            <span className="text-xs text-ok">still</span>
                          )}
                          {hard && <span className="text-xs text-destructive">break</span>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {shot.action}
                        </p>
                      </div>
                    </button>
                    {i < group.shots.length - 1 && (
                      <div className="flex items-center gap-3 py-2 pl-8">
                        <div className={cn("h-8 w-px", axisBreak ? "bg-destructive" : "bg-border")} />
                        <p className={cn("text-xs", axisBreak ? "text-destructive" : "text-muted-foreground")}>
                          {axisBreak ? "Direction reverses — 180° risk" : "continues"}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
