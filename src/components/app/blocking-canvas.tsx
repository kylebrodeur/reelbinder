import { ArrowUpRight, BoxSelect, Eraser, MessageSquareWarning, MousePointer2, Pencil, PersonStanding, RotateCcw, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CHANGE_LABELS, MOVE_LABELS } from "@/lib/fountain";
import { shortFigureName, projectFigureToFrame } from "@/lib/floor";
import type { Annotation, FloorCamera, FloorFigure, Point, SketchData, Stamp, Stroke } from "@/lib/types";
import { cn, uid } from "@/lib/utils";

import { FRAME_WIDTH as W, FRAME_HEIGHT as H, paintFrame as paint } from "@/lib/frame-renderer";
import { DEFAULT_FRAME_LAYERS, FrameLayersControl, type FrameLayerSettings } from "@/components/app/frame-layers-control";

type StageTool = "select" | "figure" | "pencil" | "prop" | "move" | "hold" | "change" | "continuity" | "eraser";

function toNorm(x: number, y: number, rect: DOMRect): Point {
  return {
    x: Math.min(1, Math.max(0, (x - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (y - rect.top) / rect.height)),
  };
}

function hitStamp(stamps: Stamp[], p: Point, r = 0.05): Stamp | null {
  let best: Stamp | null = null;
  let bestD = r;
  for (const s of stamps) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function BlockingCanvas({
  layers: controlledLayers,
  onLayersChange,
  sketch,
  annotations,
  frameUrl,
  readOnly = false,
  fill = false,
  cast,
  selectedFigureId = null,
  placeFigureId = null,
  overlayFigures,
  overlayCam,
  onSelectFigure,
  onSketch,
  onAnnotations,
  onLinkedMove,
  className,
}: {
  layers?: FrameLayerSettings;
  onLayersChange?: (layers: FrameLayerSettings) => void;
  sketch: SketchData;
  annotations: Annotation[];
  frameUrl?: string | null;
  readOnly?: boolean;
  fill?: boolean;
  cast?: FloorFigure[];
  selectedFigureId?: string | null;
  placeFigureId?: string | null;
  overlayFigures?: FloorFigure[];
  overlayCam?: FloorCamera | null;
  onSelectFigure?: (id: string | null) => void;
  onSketch?: (s: SketchData) => void;
  onAnnotations?: (a: Annotation[]) => void;
  onLinkedMove?: (figureId: string, point: Point) => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<StageTool>(cast?.length ? "select" : "figure");
  const [localLayers, setLocalLayers] = useState<FrameLayerSettings>(DEFAULT_FRAME_LAYERS);
  const layers = controlledLayers ?? localLayers;
  const setLayers = onLayersChange ?? setLocalLayers;
  const [pending, setPending] = useState<{ id: string; kind: "move" | "hold" | "change" | "continuity" } | null>(null);
  const drawing = useRef(false);
  const current = useRef<Stroke | Annotation | null>(null);
  const dragStamp = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const live = useRef({ sketch, annotations, tool, placeFigureId, selectedFigureId, cast, onLinkedMove });
  live.current = { sketch, annotations, tool, placeFigureId, selectedFigureId, cast, onLinkedMove };

  const overlayStamps: Stamp[] | undefined = overlayFigures?.length
    ? overlayFigures.map((fig, i) => {
        const pos = overlayCam
          ? projectFigureToFrame(fig, overlayCam)
          : { x: 0.22 + (i % 4) * 0.18, y: 0.62 };
        return {
          id: `ov_${fig.id}`,
          kind: "figure" as const,
          figureId: fig.id,
          label: shortFigureName(fig.name),
          x: pos.x,
          y: pos.y,
          scale: 1,
        };
      })
    : undefined;

  const redraw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, sketch, annotations, imgRef.current, null, overlayStamps, layers);
    const selected = selectedFigureId ? (overlayStamps ?? sketch.stamps).find((stamp) => stamp.figureId === selectedFigureId) : undefined;
    if (selected && !readOnly) {
      const x = selected.x * W, y = selected.y * H, size = 28 * selected.scale;
      ctx.save();
      ctx.strokeStyle = "#f3efe6"; ctx.lineWidth = 5;
      ctx.strokeRect(x - size, y - size * 1.1, size * 2, size * 2.2);
      ctx.strokeStyle = "#1769aa"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
      ctx.strokeRect(x - size, y - size * 1.1, size * 2, size * 2.2);
      ctx.restore();
    }
  }, [sketch, annotations, selectedFigureId, overlayStamps, readOnly, layers]);

  useEffect(() => {
    if (!frameUrl) {
      imgRef.current = null;
      redraw();
      return;
    }
    let active = true;
    imgRef.current = null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      imgRef.current = img;
      redraw();
    };
    img.src = frameUrl;
    return () => { active = false; img.onload = null; };
  }, [frameUrl, redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pointer = (e: React.PointerEvent) => {
    const canvas = ref.current;
    if (!canvas) return toNorm(0, 0, new DOMRect());
    return toNorm(e.clientX, e.clientY, canvas.getBoundingClientRect());
  };

  const setLabel = (label: string) => {
    if (!pending) return;
    onAnnotations?.(annotations.map((a) => (a.id === pending.id ? { ...a, label } : a)));
    setPending(null);
  };

  const upsertFigure = (figureId: string, p: Point): boolean => {
    const { sketch: sk, cast: people } = live.current;
    const person = people?.find((f) => f.id === figureId);
    if (people && !person) return false;
    const existing = sk.stamps.find((s) => s.figureId === figureId);
    const stamp: Stamp = {
      id: existing?.id ?? `st_${figureId}`,
      kind: "figure",
      figureId,
      label: person ? shortFigureName(person.name) : existing?.label,
      x: p.x,
      y: p.y,
      scale: existing?.scale ?? 1,
    };
    const stamps = existing
      ? sk.stamps.map((s) => (s.id === existing.id ? stamp : s))
      : [...sk.stamps, stamp];
    onSketch?.({ ...sk, stamps });
    return true;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly || e.button !== 0) return;
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointer(e);
    drawing.current = true;
    setPending(null);
    const { sketch: sk, tool: t, placeFigureId: placeId, cast: people } = live.current;

    const hit = hitStamp(sk.stamps, p);
    const linkedHit = !people || hit?.kind !== "figure" ||
      (!!hit.figureId && people.some((figure) => figure.id === hit.figureId));
    if ((t === "select" || t === "figure") && hit && linkedHit && !placeId) {
      dragStamp.current = hit.id;
      if (hit.figureId) onSelectFigure?.(hit.figureId);
      return;
    }

    if (placeId || (t === "figure" && people?.length)) {
      const id = placeId || live.current.selectedFigureId || people?.find((f) => !sk.stamps.some((s) => s.figureId === f.id))?.id;
      if (id && upsertFigure(id, p)) {
        onSelectFigure?.(id);
        drawing.current = false;
        return;
      }
      if (placeId || people) {
        drawing.current = false;
        return;
      }
    }

    if (t === "figure") {
      if (people) {
        drawing.current = false;
        return;
      }
      const stamp: Stamp = { id: uid("st"), kind: "figure", x: p.x, y: p.y, scale: 1 };
      onSketch?.({ ...sk, stamps: [...sk.stamps, stamp] });
      drawing.current = false;
      return;
    }
    if (t === "select") {
      drawing.current = false;
      onSelectFigure?.(null);
      return;
    }
    if (t === "prop") {
      const stamp: Stamp = { id: uid("st"), kind: "box", x: p.x, y: p.y, scale: 1 };
      onSketch?.({ ...sk, stamps: [...sk.stamps, stamp] });
      drawing.current = false;
      return;
    }
    if (t === "change") {
      const a: Annotation = {
        id: uid("ann"),
        kind: "note",
        points: [p],
        label: "Change",
        color: "#a67c52",
      };
      onAnnotations?.([...annotations, a]);
      current.current = null;
      drawing.current = false;
      setPending({ id: a.id, kind: "change" });
      return;
    }
    if (t === "continuity") {
      const a: Annotation = {
        id: uid("ann"),
        kind: "continuity",
        points: [p],
        label: "Continuity Note",
        color: "#db2777",
      };
      onAnnotations?.([...annotations, a]);
      current.current = null;
      drawing.current = false;
      // We could use a new pending kind to type a custom label, or open a dialog/panel.
      setPending({ id: a.id, kind: "continuity" });
      return;
    }
    if (t === "move") {
      const a: Annotation = {
        id: uid("ann"),
        kind: "arrow",
        points: [p, p],
        label: "Move",
        color: "#c45c4e",
      };
      current.current = a;
      onAnnotations?.([...annotations, a]);
      return;
    }
    if (t === "hold") {
      const a: Annotation = {
        id: uid("ann"),
        kind: "box",
        points: [p, p],
        label: "Hold",
        color: "#8a93a0",
      };
      current.current = a;
      onAnnotations?.([...annotations, a]);
      return;
    }
    if (t === "eraser" || t === "pencil") {
      const stroke: Stroke = {
        id: uid("sk"),
        tool: t === "eraser" ? "eraser" : "pencil",
        points: [p],
        color: t === "eraser" ? "rgba(0,0,0,1)" : "#2a2722",
        width: t === "eraser" ? 22 : 2.4,
      };
      current.current = stroke;
      onSketch?.({ ...sk, strokes: [...sk.strokes, stroke] });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (readOnly) return;
    const p = pointer(e);
    if (dragStamp.current) {
      const { sketch: sk } = live.current;
      onSketch?.({
        ...sk,
        stamps: sk.stamps.map((s) => (s.id === dragStamp.current ? { ...s, x: p.x, y: p.y } : s)),
      });
      return;
    }
    if (!drawing.current) return;
    const cur = current.current;
    if (!cur) return;
    if ("kind" in cur) {
      onAnnotations?.(
        annotations.map((a) => (a.id === cur.id ? { ...a, points: [a.points[0], p] } : a)),
      );
      return;
    }
    onSketch?.({
      ...live.current.sketch,
      strokes: live.current.sketch.strokes.map((s) =>
        s.id === cur.id ? { ...s, points: [...s.points, p] } : s,
      ),
    });
  };

  const onUp = () => {
    const cur = current.current;
    const dragged = dragStamp.current;
    drawing.current = false;
    current.current = null;
    dragStamp.current = null;
    if (dragged) {
      const stamp = live.current.sketch.stamps.find((s) => s.id === dragged);
      if (stamp?.figureId) live.current.onLinkedMove?.(stamp.figureId, { x: stamp.x, y: stamp.y });
    }
    if (cur && "kind" in cur) {
      setPending({ id: cur.id, kind: cur.kind === "arrow" ? "move" : "hold" });
    }
  };

  const clear = () => {
    onSketch?.({ strokes: [], stamps: [] });
    onAnnotations?.([]);
    setPending(null);
  };

  const tools: { id: StageTool; icon: typeof Pencil; label: string; hint: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select", hint: "Drag people already in frame" },
    { id: "figure", icon: PersonStanding, label: "People", hint: "Place the selected player in frame" },
    { id: "pencil", icon: Pencil, label: "Detail", hint: "Props, architecture, weather" },
    { id: "prop", icon: BoxSelect, label: "Prop", hint: "A thing the camera must see" },
    { id: "move", icon: ArrowUpRight, label: "Move", hint: "Camera or subject travel" },
    { id: "hold", icon: BoxSelect, label: "Hold", hint: "What cannot leave frame" },
    { id: "change", icon: StickyNote, label: "Change", hint: "Light, weather, wardrobe" },
    { id: "continuity", icon: MessageSquareWarning, label: "Continuity", hint: "Mark continuity issues" },
    { id: "eraser", icon: Eraser, label: "Erase", hint: "Remove pencil" },
  ];

  const hint = tools.find((t) => t.id === tool)?.hint ?? "";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-1">
            {tools.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={tool === t.id ? "secondary" : "ghost"}
                onClick={() => setTool(t.id)}
                aria-pressed={tool === t.id}
                aria-label={t.label}
                title={t.hint}
              >
                <t.icon />
                <span className="hidden sm:inline">{t.label}</span>
              </Button>
            ))}
            <Button type="button" size="icon-sm" variant="ghost" onClick={clear} aria-label="Clear frame marks">
              <RotateCcw />
            </Button>
          </div>
        )}
        <FrameLayersControl
          settings={layers}
          onChange={setLayers}
          hasImage={Boolean(frameUrl)}
        />
      </div>
      <div className={cn("overflow-hidden rounded-md bg-paper outline outline-1 -outline-offset-1 outline-paper-ink/15", fill && "min-h-0 flex-1")}>
        <canvas
          ref={ref}
          width={W}
          height={H}
          tabIndex={readOnly ? undefined : 0}
          aria-label="Frame blocking canvas"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setPending(null); setTool("select"); onSelectFigure?.(null);
          }}
          className={cn(
            "block w-full touch-none",
            fill ? "h-full min-h-0 object-contain" : "h-auto",
            readOnly ? "pointer-events-none" : "cursor-crosshair",
          )}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
      {!readOnly && (
        <div className="space-y-2">
          {selectedFigureId ? <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1" role="status">
            <span className="min-w-0 flex-1 truncate text-xs">{placeFigureId ? "Place" : "Selected"}: {cast?.find((figure) => figure.id === selectedFigureId)?.name ?? sketch.stamps.find((stamp) => stamp.figureId === selectedFigureId)?.label ?? "Person"}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Deselect frame person" onClick={() => onSelectFigure?.(null)}><X /></Button>
          </div> : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {placeFigureId ? "Click the frame to place this person. Escape cancels." : `${hint}.`}
          </p>
          {pending && (
            <div className="flex flex-wrap gap-1">
              <span className="self-center text-xs text-muted-foreground">
                {pending.kind === "move" ? "What kind of move?" : pending.kind === "hold" ? "Label the hold" : pending.kind === "continuity" ? "Issue type:" : "What changes?"}
              </span>
              {(pending.kind === "change" ? CHANGE_LABELS : pending.kind === "move" ? MOVE_LABELS : pending.kind === "continuity" ? ["Eyeline Match", "Screen Direction", "Prop Placement", "Action Mismatch", "Costume/Makeup"] : ["Hold", "Must see", "Eyeline"]).map(
                (label) => (
                  <Button key={label} type="button" size="sm" variant="outline" onClick={() => setLabel(label)}>
                    {label}
                  </Button>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const StageCanvas = BlockingCanvas;
