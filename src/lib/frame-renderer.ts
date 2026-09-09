import type { Annotation, Point, SketchData, Stamp } from "./types";

export const FRAME_WIDTH = 960;
export const FRAME_HEIGHT = 540;
const W = FRAME_WIDTH;
const H = FRAME_HEIGHT;

function wrappedLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) { lines.push(line); line = ""; }
        for (const character of word) {
          if (line && ctx.measureText(line + character).width > maxWidth) {
            lines.push(line); line = character;
          } else line += character;
        }
      } else if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) {
        lines.push(line); line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

function drawAnnotationLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.font = "600 16px 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "left";
  let lines = wrappedLabel(ctx, text, 320);
  if (lines.length * 20 > H - 24) lines = wrappedLabel(ctx, text, W - 16);
  const width = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
  const left = Math.max(8, Math.min(x, W - 8 - width));
  const top = Math.max(16, Math.min(y, H - 8 - (lines.length - 1) * 20));
  ctx.strokeStyle = "#f9f3e3";
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  lines.forEach((line, index) => {
    ctx.strokeText(line, left, top + index * 20);
    ctx.fillText(line, left, top + index * 20);
  });
  ctx.restore();
}

function drawFigure(ctx: CanvasRenderingContext2D, s: Stamp, selected: boolean) {
  const x = s.x * W;
  const y = s.y * H;
  const sc = 28 * s.scale;
  ctx.save();
  if (selected) {
    ctx.strokeStyle = "#8a93a0";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - sc * 0.15, sc * 0.95, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "#2a2722";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y - sc * 0.72, sc * 0.22, 0, Math.PI * 2);
  ctx.moveTo(x, y - sc * 0.5);
  ctx.lineTo(x, y + sc * 0.15);
  ctx.moveTo(x - sc * 0.38, y - sc * 0.22);
  ctx.lineTo(x + sc * 0.38, y - sc * 0.22);
  ctx.moveTo(x, y + sc * 0.15);
  ctx.lineTo(x - sc * 0.32, y + sc * 0.7);
  ctx.moveTo(x, y + sc * 0.15);
  ctx.lineTo(x + sc * 0.32, y + sc * 0.7);
  ctx.strokeStyle = "#f9f3e3";
  ctx.lineWidth = 6.2;
  ctx.stroke();
  ctx.strokeStyle = "#2a2722";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  if (s.label) {
    ctx.fillStyle = "#2a2722";
    ctx.font = "600 16px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#f9f3e3";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(s.label, x, y + sc * 0.95);
    ctx.fillText(s.label, x, y + sc * 0.95);
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, width = 3) {
  const x1 = a.x * W;
  const y1 = a.y * H;
  const x2 = b.x * W;
  const y2 = b.y * H;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 14 * Math.cos(ang - 0.4), y2 - 14 * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - 14 * Math.cos(ang + 0.4), y2 - 14 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

export interface FrameLayerSettings {
  guides: boolean;
  wireframe: boolean;
  markup: boolean;
  image: boolean;
  onionSkinOpacity: number;
}
export const DEFAULT_FRAME_LAYERS: FrameLayerSettings = {
  guides: true, wireframe: true, markup: true, image: true, onionSkinOpacity: 0.85,
};

export interface PaintFrameOptions {
  guides?: boolean;
  wireframe?: boolean;
  markup?: boolean;
  image?: boolean;
  onionSkinOpacity?: number;
}

export function paintFrame(
  ctx: CanvasRenderingContext2D,
  sketch: SketchData,
  annotations: Annotation[],
  frame: HTMLImageElement | null,
  selectedId?: string | null,
  overlay?: Stamp[],
  options?: PaintFrameOptions,
) {
  const showGuides = options?.guides !== false;
  const showWireframe = options?.wireframe !== false;
  const showMarkup = options?.markup !== false;
  const showImage = options?.image !== false;
  const overlayAlpha = options?.onionSkinOpacity ?? 1;

  ctx.clearRect(0, 0, W, H);

  // Background / Image layer
  if (frame && showImage) {
    ctx.drawImage(frame, 0, 0, W, H);
    ctx.fillStyle = "rgba(11,11,12,0.12)";
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#e6dfd0";
    ctx.fillRect(0, 0, W, H);
  }

  // Framing & Composition Guides
  if (showGuides) {
    ctx.save();
    ctx.strokeStyle = frame && showImage ? "rgba(255,255,255,0.25)" : "rgba(42,39,34,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(36, 36, W - 72, H - 72);
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.moveTo(W / 3, 36);
    ctx.lineTo(W / 3, H - 36);
    ctx.moveTo((W * 2) / 3, 36);
    ctx.lineTo((W * 2) / 3, H - 36);
    ctx.moveTo(36, H / 3);
    ctx.lineTo(W - 36, H / 3);
    ctx.moveTo(36, (H * 2) / 3);
    ctx.lineTo(W - 36, (H * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Set opacity for sketch/wireframe layer (Onion-skinning over frame)
  ctx.save();
  if (frame && showImage) {
    ctx.globalAlpha = Math.max(0, Math.min(1, overlayAlpha));
  }

  // Strokes / Pencil layer
  if (showMarkup) {
    for (const stroke of sketch.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * W, stroke.points[0].y * H);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * W, p.y * H);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // Figures & Stamps layer
  const figures = overlay?.length ? overlay : sketch.stamps.filter((s) => s.kind === "figure");
  const rest = overlay?.length ? sketch.stamps.filter((s) => s.kind !== "figure") : sketch.stamps.filter((s) => s.kind !== "figure");

  if (showWireframe) {
    for (const stamp of figures) {
      const selected = Boolean(
        selectedId && (stamp.figureId === selectedId || stamp.id === selectedId || stamp.label === selectedId),
      );
      drawFigure(ctx, stamp, selected);
    }
  }

  if (showMarkup) {
    for (const stamp of rest) {
      if (stamp.kind === "box") {
        ctx.strokeStyle = "#2a2722";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          stamp.x * W - 40 * stamp.scale,
          stamp.y * H - 24 * stamp.scale,
          80 * stamp.scale,
          48 * stamp.scale,
        );
        if (stamp.label) {
          ctx.fillStyle = "#2a2722";
          ctx.font = "600 14px 'IBM Plex Sans', sans-serif";
          ctx.textAlign = "center";
          ctx.strokeStyle = "#f9f3e3";
          ctx.lineWidth = 4;
          ctx.lineJoin = "round";
          ctx.strokeText(stamp.label, stamp.x * W, stamp.y * H + 36 * stamp.scale);
          ctx.fillText(stamp.label, stamp.x * W, stamp.y * H + 36 * stamp.scale);
        }
      }
    }

    for (const a of annotations) {
      if (a.kind === "arrow" && a.points.length >= 2) {
        drawArrow(ctx, a.points[0], a.points[a.points.length - 1], a.color || "#c45c4e", 4);
      }
      if (a.kind === "box" && a.points.length >= 2) {
        const a0 = a.points[0];
        const a1 = a.points[1];
        ctx.strokeStyle = a.color || "#8a93a0";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          Math.min(a0.x, a1.x) * W,
          Math.min(a0.y, a1.y) * H,
          Math.abs(a1.x - a0.x) * W,
          Math.abs(a1.y - a0.y) * H,
        );
      }
      if (a.kind === "note" && a.points[0]) {
        const x = a.points[0].x * W;
        const y = a.points[0].y * H;
        ctx.fillStyle = a.color || "#a67c52";
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (a.kind === "continuity" && a.points[0]) {
        const x = a.points[0].x * W;
        const y = a.points[0].y * H;
        ctx.fillStyle = a.color || "#db2777"; // pink-600
        ctx.beginPath();
        // draw a diamond
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 8, y);
        ctx.lineTo(x, y + 8);
        ctx.lineTo(x - 8, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (a.label && a.points[0]) {
        drawAnnotationLabel(ctx, a.label, a.points[0].x * W + 10, a.points[0].y * H - 8, a.color || "#c45c4e");
      }
    }
  }

  ctx.restore();
}
