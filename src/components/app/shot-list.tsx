import { coverageLabel, LINE_COLOR_BG } from "@/lib/lining";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ShotList({
  shots,
  selectedId,
  onSelect,
}: {
  shots: Shot[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-card">
      <p className="shrink-0 border-b border-border px-3 py-2 font-script text-xs uppercase tracking-wide text-muted-foreground">
        Shot list
      </p>
      <ul className="min-h-0 flex-1 overflow-auto">
        {shots.map((shot) => {
          const active = shot.id === selectedId;
          return (
            <li key={shot.id}>
              <button
                type="button"
                onClick={() => onSelect(shot.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left",
                  active ? "bg-secondary" : "hover:bg-secondary/50",
                )}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", LINE_COLOR_BG[shot.lineColor])} />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="font-script text-sm font-semibold">{coverageLabel(shot)}</span>
                    <span className="truncate text-xs text-muted-foreground">{shot.camera.replace(/-/g, " ")}</span>
                  </span>
                  <span className="block truncate text-sm">{shot.title || "Untitled"}</span>
                  {active && shot.notes ? (
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{shot.notes}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
