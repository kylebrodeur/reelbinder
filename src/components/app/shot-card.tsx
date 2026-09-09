import { BlockingCanvas } from "@/components/app/blocking-canvas";
import { Badge } from "@/components/ui/badge";
import { CAMERA_META, MOVEMENT_META } from "@/lib/filmmaking";
import { slugForScene } from "@/lib/fountain";
import { useSlate } from "@/lib/store";
import type { ContinuityIssue, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ShotCard({
  shot,
  selected,
  issues,
  onSelect,
  onDragStart,
  onDrop,
}: {
  shot: Shot;
  selected: boolean;
  issues: ContinuityIssue[];
  onSelect: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const script = useSlate((s) => s.project.script);
  const hard = issues.some((i) => i.severity === "error");
  const warn = issues.some((i) => i.severity === "warn");
  const slug = slugForScene(script, shot.sceneId);

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", shot.id);
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={onSelect}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-shadow duration-150",
        selected
          ? "border-steel/50 shadow-[0_0_0_1px_var(--color-steel)]"
          : "border-border hover:border-steel/30",
      )}
    >
      <div className="px-3 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {String(shot.number).padStart(2, "0")}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{shot.durationSec}s</span>
        </div>
        {slug ? (
          <p className="mt-1 truncate font-script text-[11px] uppercase tracking-wide text-muted-foreground">
            {slug}
          </p>
        ) : null}
        <div className="relative mt-2 overflow-hidden rounded-md">
          {shot.videoUrl ? (
            <video
              src={shot.videoUrl}
              muted
              playsInline
              preload="metadata"
              className="aspect-video w-full object-cover"
            />
          ) : (
            <BlockingCanvas
              sketch={shot.sketch}
              annotations={shot.annotations}
              frameUrl={shot.frameUrl}
              readOnly
            />
          )}
          {shot.videoStatus === "pending" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 text-xs">
              Rendering…
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2 px-3 py-3">
        <h3 className="truncate font-medium leading-snug">{shot.title || "Untitled shot"}</h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{shot.action}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{CAMERA_META[shot.camera].label}</Badge>
          <Badge variant="outline">{MOVEMENT_META[shot.movement].label}</Badge>
          {shot.videoUrl ? (
            <Badge variant="steel">Clip</Badge>
          ) : shot.frameUrl ? (
            <Badge variant="ok">Still</Badge>
          ) : null}
          {hard ? (
            <Badge variant="error">Line jump</Badge>
          ) : warn ? (
            <Badge variant="warn">Check</Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}
