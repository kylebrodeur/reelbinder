import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATALOG_META, STEER_META, markColor, markMeta } from "@/lib/marks";
import type { MarkTag } from "@/lib/types";
import { CATALOG_TAGS, STEER_TAGS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSlate } from "@/lib/store";
import { resolveProductionItem } from "@/lib/production-catalog";
import { ProductionItemEditor } from "@/components/app/production-item-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface MarkDraft {
  elementId: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  existingId?: string;
  tag?: MarkTag;
  note?: string;
}

export function MarkPopover({
  draft,
  onTag,
  onClose,
  onRemove,
}: {
  draft: MarkDraft;
  onTag: (tag: MarkTag, note: string) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const [tag, setTag] = useState<MarkTag>(draft.tag ?? "lock");
  const [note, setNote] = useState(draft.note ?? "");
  const [globalItem, setGlobalItem] = useState<string | null>(null);
  const project = useSlate((state) => state.project);
  const existing = project.marks.find((mark) => mark.id === draft.existingId);
  const parent = existing?.productionItemId ? resolveProductionItem(project, existing.productionItemId, { sceneId: existing.sceneId }) : null;
  const meta = markMeta(tag);

  return (
    <div
      className="absolute z-20 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ left: Math.max(8, draft.x), top: Math.max(8, draft.y) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p className="truncate font-script text-xs text-muted-foreground">“{draft.text}”</p>
      <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Steer</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {STEER_TAGS.map((t) => (
          <TagChip key={t} tag={t} active={tag === t} onPick={setTag} />
        ))}
      </div>
      <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Catalog</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {CATALOG_TAGS.map((t) => (
          <TagChip key={t} tag={t} active={tag === t} onPick={setTag} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{meta.hint}</p>
      {parent ? <p className="mt-2 text-xs text-muted-foreground">Linked to <button type="button" className="text-steel underline underline-offset-2" onClick={() => setGlobalItem(parent.item.id)}>{parent.item.item} · global item</button></p> : null}
      <Input
        className="mt-2 h-8 text-xs"
        placeholder="Note — who they look at, what not to invent…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onTag(tag, note);
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onTag(tag, note)}>
          Mark {meta.label.toLowerCase()}
        </Button>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Clear
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
      <Dialog open={!!globalItem} onOpenChange={(open) => { if (!open) setGlobalItem(null); }}><DialogContent className="max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>Global production item</DialogTitle></DialogHeader>{globalItem ? <ProductionItemEditor key={globalItem} itemId={globalItem} onBack={() => setGlobalItem(null)} onSelect={setGlobalItem} /> : null}</DialogContent></Dialog>
    </div>
  );
}

function TagChip({
  tag,
  active,
  onPick,
}: {
  tag: MarkTag;
  active: boolean;
  onPick: (t: MarkTag) => void;
}) {
  const label = tag in STEER_META ? STEER_META[tag as keyof typeof STEER_META].label : CATALOG_META[tag as keyof typeof CATALOG_META].label;
  return (
    <button
      type="button"
      onClick={() => onPick(tag)}
      className={cn(
        "rounded-sm px-1.5 py-0.5 font-script text-xs",
        active ? "bg-secondary" : "text-muted-foreground hover:bg-secondary/60",
      )}
      style={{ color: markColor(tag) }}
    >
      {label}
    </button>
  );
}
