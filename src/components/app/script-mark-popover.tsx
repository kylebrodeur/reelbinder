import { Clapperboard, Layers, Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { departmentFor, markColor, markMeta } from "@/lib/marks";
import { resolveProductionItem } from "@/lib/production-catalog";
import { useSlate } from "@/lib/store";
import type { ScriptMark } from "@/lib/types";

export function ScriptMarkFloatingPopover({
  mark,
  x,
  y,
  onClose,
  onEdit,
  onOpenBreakdown,
  onOpenBeatDetails,
  onRemove,
}: {
  mark: ScriptMark;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
  onOpenBreakdown: () => void;
  onOpenBeatDetails: () => void;
  onRemove: () => void;
}) {
  const project = useSlate((s) => s.project);
  const meta = markMeta(mark.tag);
  const color = markColor(mark.tag);
  const department = departmentFor(mark.tag);
  const linkedItem = mark.productionItemId
    ? resolveProductionItem(project, mark.productionItemId, { sceneId: mark.sceneId })
    : null;

  return (
    <div
      role="dialog"
      aria-label={`Mark details for ${meta.label}`}
      className="absolute z-40 rounded-lg border border-border bg-card p-3.5 shadow-2xl text-foreground font-sans text-sm animate-in fade-in zoom-in-95 duration-150"
      style={{
        width: "calc(100% - 16px)",
        maxWidth: "24rem",
        left: `clamp(8px, ${Math.max(8, x)}px, max(8px, calc(100% - 24rem - 8px)))`,
        top: Math.max(8, y),
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="size-2.5 rounded-full shrink-0 ring-2 ring-white/10"
            style={{ backgroundColor: color }}
          />
          <span className="font-semibold text-xs tracking-wider uppercase text-foreground">
            {meta.label}
          </span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0 font-sans">
            {department}
          </Badge>
          {meta.family === "steer" && (
            <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-mono text-amber-500">
              AI Steer
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close mark details"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Quote */}
      <div className="rounded border border-border/80 bg-secondary/40 px-2.5 py-1.5 font-mono text-xs text-foreground/90">
        “{mark.text}”
      </div>

      {/* Tag hint */}
      <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
        {meta.hint}
      </p>

      {/* Note */}
      {mark.note ? (
        <div className="mt-2 rounded-md border border-border/80 bg-background/60 p-2 text-xs space-y-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider block">
            Note
          </span>
          <p className="text-foreground leading-relaxed whitespace-pre-wrap">{mark.note}</p>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground">No note attached to this mark.</p>
      )}

      {/* Linked Global Production Item */}
      {linkedItem && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground rounded bg-secondary/30 px-2 py-1">
          <Layers className="size-3 text-steel shrink-0" />
          <span className="truncate">
            Catalog:{" "}
            <span className="font-medium text-foreground">{linkedItem.item.item}</span>
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-border/80">
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs gap-1 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onEdit}
        >
          <Pencil className="size-3" />
          Edit mark
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 cursor-pointer"
          onClick={onOpenBreakdown}
          title="Open Breakdown tab in sidebar"
        >
          <Layers className="size-3 text-steel" />
          Breakdown
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 cursor-pointer"
          onClick={onOpenBeatDetails}
          title="Open Beat Details in sidebar"
        >
          <Clapperboard className="size-3 text-amber-500" />
          Beat Details
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto cursor-pointer"
          onClick={onRemove}
          title="Remove mark"
          aria-label="Remove mark"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
