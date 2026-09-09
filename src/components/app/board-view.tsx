import { ImageIcon, Plus } from "lucide-react";
import { useRef } from "react";
import { ShotCard } from "@/components/app/shot-card";
import { Button } from "@/components/ui/button";
import { groupShotsByScene } from "@/lib/fountain";
import { useSlate } from "@/lib/store";

export function BoardView() {
  const project = useSlate((s) => s.project);
  const selectedId = useSlate((s) => s.selectedId);
  const selectShot = useSlate((s) => s.selectShot);
  const addShot = useSlate((s) => s.addShot);
  const reorder = useSlate((s) => s.reorder);
  const setView = useSlate((s) => s.setView);
  const issues = useSlate((s) => s.issues);
  const dragFrom = useRef<number | null>(null);
  const missing = project.shots.filter((s) => !s.frameUrl).length;
  const clips = project.shots.filter((s) => s.videoUrl).length;
  const groups = groupShotsByScene(project);

  if (project.shots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-3xl">No frames boarded.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Open the script and board a beat, or add a frame by hand.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setView("script")}>
            Open script
          </Button>
          <Button onClick={() => addShot()}>
            <Plus />
            Add frame
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {project.shots.length} frames · {project.shots.length - missing} stills · {clips} clips
        </p>
        <div className="ml-auto flex gap-2">
          {missing > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setView("stage")}>
              <ImageIcon />
              Image tools in Stage
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setView("edit")}>
            Play sequence
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          {groups.map((group, gi) => (
            <section key={group.scene?.id ?? `loose-${gi}`}>
              <h2 className="mb-3 font-script text-xs uppercase tracking-wide text-muted-foreground">
                {group.scene?.text || "Unlinked frames"}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.shots.map((shot) => {
                  const index = project.shots.findIndex((s) => s.id === shot.id);
                  return (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      selected={shot.id === selectedId}
                      issues={issues.filter((i) => i.shotId === shot.id)}
                      onSelect={() => selectShot(shot.id)}
                      onDragStart={() => {
                        dragFrom.current = index;
                      }}
                      onDrop={() => {
                        if (dragFrom.current === null) return;
                        reorder(dragFrom.current, index);
                        dragFrom.current = null;
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ))}
          <button
            type="button"
            onClick={() => addShot(selectedId)}
            className="flex h-16 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-steel/40 hover:text-foreground"
          >
            <Plus className="size-4" />
            Add frame
          </button>
        </div>
      </div>
    </div>
  );
}
