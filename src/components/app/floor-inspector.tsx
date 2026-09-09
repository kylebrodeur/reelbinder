import { Focus, Link2, Lock, RotateCw, Tag, Trash2, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { matchCharacter, namesOf } from "@/lib/cast";
import { SET_KINDS } from "@/lib/floor";
import { coverageLabel } from "@/lib/lining";
import { markColor } from "@/lib/marks";
import type { CharacterBible, FloorCamera, FloorFigure, FloorItem, ScriptMark, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FloorSel =
  | { kind: "figure"; id: string }
  | { kind: "camera"; id: string }
  | { kind: "item"; id: string }
  | null;

export function FloorInspector({
  sel,
  figure,
  camera,
  item,
  shots,
  characters,
  marks = [],
  onRename,
  onRotate,
  onToggleLock,
  onLinkShot,
  onLinkSet,
  onLinkMark,
  onRemove,
  onClose,
  canRemove = true,
  disabled = false,
  locked = false,
  diagnostics = [],
  figures = [],
  items = [],
  onUpdateCameraRotationMode,
  onUpdateCameraTarget,
  onUpdateFigureTarget,
  isSoloed = false,
  onToggleSolo,
}: {
  sel: FloorSel;
  figure?: FloorFigure;
  camera?: FloorCamera;
  item?: FloorItem;
  shots: Shot[];
  characters: CharacterBible[];
  marks?: ScriptMark[];
  figures?: FloorFigure[];
  items?: FloorItem[];
  onRename: (label: string) => void;
  onRotate?: (deltaOrDeg: number, absolute?: boolean) => void;
  onToggleLock?: () => void;
  onLinkShot: (shotId: string | null) => void;
  onLinkSet: (setWide: boolean) => void;
  onLinkMark?: (markId: string | null) => void;
  onUpdateCameraRotationMode?: (mode: "over-time" | "static" | "target") => void;
  onUpdateCameraTarget?: (targetId: string | null) => void;
  onUpdateFigureTarget?: (targetId: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
  canRemove?: boolean;
  disabled?: boolean;
  locked?: boolean;
  diagnostics?: string[];
  isSoloed?: boolean;
  onToggleSolo?: () => void;
}) {
  if (!sel || (!figure && !camera && !item)) return null;

  const linked = figure ? matchCharacter(characters, figure.name) : undefined;
  const linkedShot = camera ? shots.find((shot) => shot.id === camera.shotId) ?? shots.find((shot) => shot.setup === camera.setup) : undefined;
  const linkedMark = item?.markId ? marks.find((m) => m.id === item.markId) : undefined;
  const title =
    sel.kind === "figure"
      ? figure?.name || "Player"
      : sel.kind === "camera"
        ? camera?.setup || "Camera"
        : item?.label || item?.kind || "Item";

  const rot = item ? Math.round(item.rotation || 0) : camera ? Math.round(camera.angle || 0) : figure ? Math.round(figure.facing || 0) : 0;
  const posX = item ? Math.round(item.x * 100) : camera ? Math.round(camera.x * 100) : figure ? Math.round(figure.x * 100) : 0;
  const posY = item ? Math.round(item.y * 100) : camera ? Math.round(camera.y * 100) : figure ? Math.round(figure.y * 100) : 0;

  return (
    <section
      aria-label="Selected plan item"
      className="shrink-0 space-y-3 border-b border-border bg-card px-3 py-3 text-foreground"
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Selected{" "}
              {sel.kind === "figure" ? "person" : sel.kind === "camera" ? "camera" : item?.kind}
            </p>
            {item?.locked ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.2 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                <Lock className="size-2.5" /> Locked
              </span>
            ) : null}
          </div>
          <h3 className="break-words text-sm font-semibold">{title}</h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            X:{posX}% · Y:{posY}% · {rot}°
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onToggleSolo ? (
            <Button
              type="button"
              size="sm"
              variant={isSoloed ? "default" : "outline"}
              className="h-7 px-2 text-xs gap-1"
              onClick={onToggleSolo}
              title={
                isSoloed
                  ? "Exit solo mode (Esc or double-click)"
                  : "Solo this element to move it without touching other items (or double-click on diagram)"
              }
            >
              <Focus className="size-3" />
              <span>{isSoloed ? "Soloed" : "Solo"}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Deselect plan item"
            title="Deselect (Escape)"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      {diagnostics.map((message) => <p key={message} role="status" className="text-xs text-amber-600">{message}</p>)}
      {locked ? <p className="text-xs text-muted-foreground">Locked: unlock the item or its category to edit.</p> : null}
            {sel.kind === "item" && onToggleLock ? (
              <Button
                type="button"
                size="sm"
                variant={item?.locked ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={onToggleLock}
                disabled={disabled}
                title={item?.locked ? "Unlock item (allow moving)" : "Lock item in place"}
              >
                {item?.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                {item?.locked ? "Locked" : "Lock"}
              </Button>
            ) : null}
      <fieldset disabled={disabled || locked} className="space-y-3">
        {sel.kind === "figure" ? (
          <>
            <label className="block text-xs text-muted-foreground">
              Production book
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
                value={figure?.name || ""}
                onChange={(e) => onRename(e.target.value)}
              >
                <option value={figure?.name || ""}>{figure?.name || "Unlinked"}</option>
                {characters
                  .filter((c) => c.name !== figure?.name)
                  .map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.aliases?.length ? ` (${c.aliases[0]})` : ""}
                    </option>
                  ))}
              </select>
            </label>
            {linked?.aliases?.length ? (
              <p className="text-[10px] text-muted-foreground">
                Also{" "}
                {namesOf(linked)
                  .filter((n) => n !== linked.name)
                  .join(", ")}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Facing:</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onRotate?.(90)}
              >
                <RotateCw className="size-3" /> Turn 90°
              </Button>
            </div>
            
            <label className="block text-xs font-medium text-foreground mt-3 border-t border-border/60 pt-2.5">
              Looking at (Eyeline)
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
                value={figure?.targetId || ""}
                onChange={(e) => onUpdateFigureTarget?.(e.target.value || null)}
              >
                <option value="">(No specific target)</option>
                {figures.length ? (
                  <optgroup label="Actors">
                    {figures.filter(f => f.id !== figure?.id).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {items.length ? (
                  <optgroup label="Marks & Props">
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.label || it.kind}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {camera ? (
                  <optgroup label="Camera">
                    <option value={camera.id}>{camera.setup}</option>
                  </optgroup>
                ) : null}
              </select>
            </label>
          </>
        ) : (
          <label className="block text-xs text-muted-foreground">
            {sel.kind === "camera" ? "Camera label" : "Item label"}
            <Input
              value={camera ? camera.setup : item?.label || ""}
              className="mt-1 h-8"
              onChange={(e) => onRename(e.target.value)}
            />
          </label>
        )}

        {/* Rotation & Lock controls for Items & Cameras */}
        {sel.kind === "item" || sel.kind === "camera" ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {onRotate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onRotate(sel.kind === "camera" ? 45 : 90)}
                title={`Rotate ${sel.kind === "camera" ? "45°" : "90°"} clockwise`}
              >
                <RotateCw className="size-3" /> {sel.kind === "camera" ? "+45°" : "+90°"}
              </Button>
            ) : null}

          </div>
        ) : null}

        {sel.kind === "camera" ? (
          <label className="block text-xs text-muted-foreground">
            Linked setup
            <select
              className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
              value={linkedShot?.id || ""}
              onChange={(e) => onLinkShot(e.target.value || null)}
            >
              {!linkedShot ? <option value="" disabled>Choose setup</option> : null}
              {shots.map((s) => (
                <option key={s.id} value={s.id}>
                  {coverageLabel(s)} · {s.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {sel.kind === "camera" && camera ? (
          <div className="space-y-2 border-t border-border/60 pt-2.5">
            <label className="block text-xs font-medium text-foreground">
              Tracking rotation
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
                value={camera.rotationMode || "over-time"}
                onChange={(e) =>
                  onUpdateCameraRotationMode?.(
                    e.target.value as "over-time" | "static" | "target",
                  )
                }
              >
                <option value="over-time">Over time (Smooth turn)</option>
                <option value="static">Static (Hold fixed angle)</option>
                <option value="target">Pin to target</option>
              </select>
            </label>
            {camera.rotationMode === "target" ? (
              <label className="block text-xs text-muted-foreground">
                Target to track
                <select
                  className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
                  value={camera.targetId || ""}
                  onChange={(e) => onUpdateCameraTarget?.(e.target.value || null)}
                >
                  <option value="">Choose target</option>
                  {figures.length ? (
                    <optgroup label="Actors">
                      {figures.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {items.length ? (
                    <optgroup label="Marks & Props">
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.label || it.kind}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        {/* Script mark linking for items */}
        {sel.kind === "item" && marks.length > 0 && onLinkMark ? (
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">
              Link script breakdown
              <select
                className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
                value={item?.markId || ""}
                onChange={(e) => onLinkMark(e.target.value || null)}
              >
                <option value="">(Not linked to script mark)</option>
                {marks.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.tag.toUpperCase()}] {m.text}
                  </option>
                ))}
              </select>
            </label>
            {linkedMark ? (
              <span
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  color: markColor(linkedMark.tag),
                  borderColor: markColor(linkedMark.tag),
                  backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
                }}
              >
                <Tag className="size-2.5" />
                {linkedMark.tag.toUpperCase()}: {linkedMark.text}
              </span>
            ) : null}
          </div>
        ) : null}

        {sel.kind === "item" && item && !SET_KINDS.has(item.kind) ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={!item.shotId}
              onChange={(e) => onLinkSet(e.target.checked)}
            />
            Whole set
          </label>
        ) : null}
        {sel.kind === "item" && item?.shotId ? (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Link2 className="size-3" /> This shot only
          </p>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={!canRemove || !!item?.locked}
          className="w-full justify-start"
          onClick={onRemove}
          title={
            item?.locked
              ? "Unlock this item before removing it"
              : !canRemove
                ? sel.kind === "camera"
                  ? "The active setup keeps its camera"
                  : "This item is part of the shared set"
                : "Remove selected item"
          }
        >
          <Trash2 />
          Remove
        </Button>
      </fieldset>
    </section>
  );
}
