import type { FloorCamera, FloorFigure, FloorItem, FloorKind, FloorPlan, Point, Shot, SketchData, Stamp } from "./types";
import { emptyFloor } from "./types";
import { LINE_COLOR_VAR } from "./lining";

const VW = 160;
const VH = 90;

export const FLOOR_W = VW;
export const FLOOR_H = VH;

export const STRUCTURAL_KINDS = new Set<FloorKind>(["wall", "bar", "door", "well", "window"]);

/** Generic fallback when a legacy setup has no authored per-shot blocking. */
export function blockingForSetup(floor: FloorPlan, _setup: string): FloorFigure[] {
  return (floor.homes ?? []).map((home) => ({ ...home }));
}

export function figuresForShot(floor: FloorPlan, shot: Shot | null): FloorFigure[] {
  if (shot && Array.isArray(shot.blocking?.figures)) return shot.blocking.figures;
  if (!shot) return (floor.homes ?? []).map((h) => ({ ...h }));
  return blockingForSetup(floor, shot.setup);
}

export function seedShotBlocking(shots: Shot[], floor: FloorPlan): Shot[] {
  return shots.map((shot) => {
    if (shot.blocking?.figures?.length) return shot;
    return { ...shot, blocking: { figures: blockingForSetup(floor, shot.setup) } };
  });
}

export function cameraForShot(floor: FloorPlan, shot: Shot | null): FloorCamera | undefined {
  if (!shot) return undefined;
  return floor.cameras.find((c) => c.shotId === shot.id)
    ?? floor.cameras.find((c) => c.setup === shot.setup);
}

export function cameraColor(shot: Shot | null, fallback = "var(--color-script-ink)"): string {
  if (!shot) return fallback;
  return LINE_COLOR_VAR[shot.lineColor] ?? fallback;
}

export function toFloorPx(p: Point): { x: number; y: number } {
  return { x: p.x * VW, y: p.y * VH };
}

export function clientToFloor(e: { clientX: number; clientY: number }, el: Element): Point {
  const r = el.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

export function facingFrom(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export function fovForCoverageSize(size?: string | null): number {
  switch (size) {
    case "WS":
    case "LS":
      return 60;
    case "FS":
      return 50;
    case "2S":
      return 45;
    case "MS":
      return 38;
    case "MCU":
      return 30;
    case "CU":
      return 22;
    case "ECU":
      return 14;
    case "OTS":
      return 35;
    case "Insert":
      return 24;
    default:
      return 38;
  }
}

export function snapAngle(deg: number, snapStep = 15): number {
  const norm = ((deg % 360) + 360) % 360;
  const snapped = Math.round(norm / snapStep) * snapStep;
  return snapped === 360 ? 0 : snapped;
}

export function snapToGrid(pos: Point, gridSize = 0.02): Point {
  return {
    x: Math.min(1, Math.max(0, Math.round(pos.x / gridSize) * gridSize)),
    y: Math.min(1, Math.max(0, Math.round(pos.y / gridSize) * gridSize)),
  };
}

export function wedgePoints(cam: FloorCamera, length = 18): string {
  const { x, y } = toFloorPx(cam);
  const rad = (cam.angle * Math.PI) / 180;
  const fov = cam.fov || 38;
  const half = ((fov / 2) * Math.PI) / 180;
  const a0 = rad - half;
  const a1 = rad + half;
  const x1 = x + Math.cos(a0) * length;
  const y1 = y + Math.sin(a0) * length;
  const x2 = x + Math.cos(a1) * length;
  const y2 = y + Math.sin(a1) * length;
  return `${x},${y} ${x1},${y1} ${x2},${y2}`;
}

export function chevronPoints(figure: FloorFigure, size = 5.4): string {
  const { x, y } = toFloorPx(figure);
  const rad = (figure.facing * Math.PI) / 180;
  const tx = x + Math.cos(rad) * size;
  const ty = y + Math.sin(rad) * size;
  const bx = x - Math.cos(rad) * size * 0.7;
  const by = y - Math.sin(rad) * size * 0.7;
  const ox = Math.cos(rad + Math.PI / 2) * size * 0.55;
  const oy = Math.sin(rad + Math.PI / 2) * size * 0.55;
  return `${tx},${ty} ${bx + ox},${by + oy} ${bx - ox},${by - oy}`;
}

export function rotateHandle(figure: FloorFigure, size = 8): { x: number; y: number } {
  const { x, y } = toFloorPx(figure);
  const rad = (figure.facing * Math.PI) / 180;
  return { x: x + Math.cos(rad) * size, y: y + Math.sin(rad) * size };
}

export function pathD(path: Point[]): string {
  if (!path.length) return "";
  return path
    .map((p, i) => {
      const { x, y } = toFloorPx(p);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Shared Catmull-Rom control points for display and rehearsal. */
function splineSegment(path: Point[], i: number): [Point, Point, Point, Point] {
  const a = path[i], b = path[i + 1];
  const before = path[Math.max(0, i - 1)];
  const after = path[Math.min(path.length - 1, i + 2)];
  return [a,
    { x: a.x + (b.x - before.x) / 6, y: a.y + (b.y - before.y) / 6 },
    { x: b.x - (after.x - a.x) / 6, y: b.y - (after.y - a.y) / 6 }, b];
}

/** Evaluate the same cubic curve drawn by splineD; t is segment time, not distance. */
export function pointOnSpline(path: Point[], t: number): Point {
  if (!path.length) return { x: 0.5, y: 0.5 };
  const u = Math.min(1, Math.max(0, t));
  if (path.length === 1 || u === 0) return path[0];
  if (u === 1) return path[path.length - 1];
  if (path.length === 2) return {
    x: path[0].x + (path[1].x - path[0].x) * u,
    y: path[0].y + (path[1].y - path[0].y) * u,
  };
  const i = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
  const v = u * (path.length - 1) - i;
  const [a, b, c, d] = splineSegment(path, i);
  const evaluate = (key: "x" | "y") =>
    (1-v)**3*a[key] + 3*(1-v)**2*v*b[key] + 3*(1-v)*v*v*c[key] + v**3*d[key];
  return { x: evaluate("x"), y: evaluate("y") };
}

/** Generate a smooth cubic Bezier spline SVG path string through an array of points. */
export function splineD(path: Point[]): string {
  if (!path.length) return "";
  if (path.length <= 2) return pathD(path);
  const start = toFloorPx(path[0]);
  let d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  for (let i = 0; i < path.length - 1; i++) {
    const [, b, c, end] = splineSegment(path, i).map(toFloorPx);
    d += ` C ${b.x.toFixed(1)} ${b.y.toFixed(1)}, ${c.x.toFixed(1)} ${c.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }
  return d;
}

/** Compute a camera movement spline trajectory between current camera and destination. */
export function cameraSpline(cam: FloorCamera, nextCam: FloorCamera | null): Point[] {
  if (cam.path && cam.path.length > 1) {
    const start = { x: cam.x, y: cam.y };
    const first = cam.path[0];
    return first.x === start.x && first.y === start.y ? cam.path : [start, ...cam.path];
  }
  if (!nextCam) return [];
  const midX = (cam.x + nextCam.x) / 2;
  const midY = (cam.y + nextCam.y) / 2;
  const dx = nextCam.x - cam.x;
  const dy = nextCam.y - cam.y;
  // Perpendicular offset for curved dolly tracks
  const arcX = midX - dy * 0.12;
  const arcY = midY + dx * 0.12;
  return [{ x: cam.x, y: cam.y }, { x: arcX, y: arcY }, { x: nextCam.x, y: nextCam.y }];
}

export function figureColor(id: string): string {
  if (id === "noodles") return "var(--color-line-red)";
  if (id === "rusty") return "var(--color-line-blue)";
  if (id === "bh") return "var(--color-line-ink)";
  if (id === "cameo") return "var(--color-line-brown)";
  if (id === "woman") return "var(--color-line-plum)";
  return "var(--color-script-ink)";
}

export function shortFigureName(name: string): string {
  if (/bounty/i.test(name)) return "BH";
  return name.split(/\s+/)[0] || name;
}

export function wrapDeg(deg: number): number {
  let a = ((deg + 180) % 360) - 180;
  if (a < -180) a += 360;
  return a;
}

/** Project a floor figure into this setup's camera frame. Closer people sit lower. */
export function projectFigureToFrame(fig: FloorFigure, cam: FloorCamera): Point {
  const dx = fig.x - cam.x;
  const dy = fig.y - cam.y;
  const dist = Math.hypot(dx, dy);
  const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rel = wrapDeg(bearing - cam.angle);
  const half = Math.max(14, cam.fov / 2);
  const x = 0.5 + (rel / half) * 0.4;
  const closeness = 1 - Math.min(1, dist / 0.85);
  const y = 0.4 + closeness * 0.38;
  return {
    x: Math.min(0.9, Math.max(0.1, x)),
    y: Math.min(0.86, Math.max(0.2, y)),
  };
}

/** Inverse of projectFigureToFrame — drop a frame point onto the floor. */
export function projectFrameToFloor(p: Point, cam: FloorCamera): Point {
  const half = Math.max(14, cam.fov / 2);
  const rel = ((p.x - 0.5) / 0.4) * half;
  const closeness = (p.y - 0.4) / 0.38;
  const dist = (1 - Math.min(1, Math.max(0, closeness))) * 0.85;
  const rad = ((cam.angle + rel) * Math.PI) / 180;
  return {
    x: Math.min(0.95, Math.max(0.05, cam.x + Math.cos(rad) * dist)),
    y: Math.min(0.95, Math.max(0.05, cam.y + Math.sin(rad) * dist)),
  };
}

export const TOOLBOX_GROUPS = [
  {
    id: "set" as const,
    label: "Set",
    items: [
      { kind: "wall" as const, label: "Wall" },
      { kind: "door" as const, label: "Door" },
      { kind: "window" as const, label: "Window" },
      { kind: "bar" as const, label: "Bar" },
    ],
  },
  {
    id: "furn" as const,
    label: "Furniture",
    items: [
      { kind: "table" as const, label: "Table" },
      { kind: "stool" as const, label: "Stool" },
      { kind: "chair" as const, label: "Chair" },
      { kind: "well" as const, label: "Well" },
    ],
  },
  {
    id: "mark" as const,
    label: "Marks",
    items: [
      { kind: "mark" as const, label: "Number" },
      { kind: "rect" as const, label: "Box" },
      { kind: "circle" as const, label: "Circle" },
      { kind: "arrow" as const, label: "Arrow" },
    ],
  },
];

export const SET_KINDS = new Set<FloorKind>(["wall", "bar", "door", "window", "well"]);

export type FloorCategory = "set" | "furniture" | "marks" | "cast" | "cameras";

export const FLOOR_CATEGORIES: { id: FloorCategory; label: string; description: string }[] = [
  { id: "set", label: "Set & Architecture", description: "Walls, doors, windows, bar, and structural elements" },
  { id: "furniture", label: "Furniture & Props", description: "Tables, chairs, stools, and practical stage items" },
  { id: "marks", label: "Floor Marks", description: "Blocking marks, numbers, zones, and movement cues" },
  { id: "cast", label: "Cast & Blocking", description: "Actors, performers, and character positions" },
  { id: "cameras", label: "Cameras & Cones", description: "Camera setups, lenses, and view cones" },
];

export function categoryForItem(kind: FloorKind): FloorCategory {
  if (SET_KINDS.has(kind)) return "set";
  if (kind === "table" || kind === "stool" || kind === "chair") return "furniture";
  return "marks";
}

export function defaultItemSize(kind: FloorKind): { w: number; h: number } {
  if (kind === "wall") return { w: 0.28, h: 0.04 };
  if (kind === "door") return { w: 0.12, h: 0.08 };
  if (kind === "window") return { w: 0.1, h: 0.04 };
  if (kind === "bar") return { w: 0.12, h: 0.36 };
  if (kind === "table") return { w: 0.1, h: 0.14 };
  if (kind === "stool" || kind === "chair" || kind === "circle") return { w: 0.05, h: 0.07 };
  if (kind === "well") return { w: 0.08, h: 0.1 };
  if (kind === "arrow") return { w: 0.12, h: 0.04 };
  if (kind === "rect") return { w: 0.1, h: 0.08 };
  return { w: 0.05, h: 0.08 };
}

export function layerVisible(
  ownerShotId: string | null | undefined,
  currentShotId: string | null,
  solo: boolean,
  hidden: Set<string>,
): boolean {
  if (!ownerShotId) return true;
  if (solo) return ownerShotId === currentShotId;
  return !hidden.has(ownerShotId);
}

export function applyFrameToBlocking(
  figures: FloorFigure[],
  cam: FloorCamera | undefined,
  sketch: SketchData,
  annotations: { kind: string; points: Point[]; label: string }[],
): FloorFigure[] {
  if (!cam) return figures;
  return figures.map((fig) => {
    const stamp = sketch.stamps.find((s) => s.figureId === fig.id);
    if (stamp) {
      const pos = projectFrameToFloor(stamp, cam);
      return { ...fig, x: pos.x, y: pos.y };
    }
    const move = annotations.find((a) => {
      if (a.kind !== "arrow" || a.points.length < 2) return false;
      if (a.label && fig.name.toLowerCase().startsWith(a.label.toLowerCase().slice(0, 4))) return true;
      const start = a.points[0];
      if (!start) return false;
      const projected = projectFigureToFrame(fig, cam);
      return Math.hypot(projected.x - start.x, projected.y - start.y) < 0.12;
    });
    if (move?.points.length) {
      const end = move.points[move.points.length - 1];
      if (end) {
        const pos = projectFrameToFloor(end, cam);
        const start = move.points[0];
        const facing = start ? facingFrom(projectFrameToFloor(start, cam), pos) : fig.facing;
        return { ...fig, x: pos.x, y: pos.y, facing };
      }
    }
    return fig;
  });
}

export function frameMarksToItems(
  sketch: SketchData,
  annotations: { id: string; kind: string; points: Point[]; label: string }[],
  cam: FloorCamera,
  shotId: string,
): FloorItem[] {
  const items: FloorItem[] = [];
  for (const s of sketch.stamps) {
    if (s.kind !== "box") continue;
    const p = projectFrameToFloor(s, cam);
    items.push({
      id: `fl_box_${s.id}`,
      kind: "rect",
      x: p.x,
      y: p.y,
      w: 0.08,
      h: 0.08,
      rotation: 0,
      label: s.label || "",
      shotId,
    });
  }
  for (const a of annotations) {
    if (a.kind !== "arrow" || a.points.length < 2) continue;
    const start = a.points[0];
    const end = a.points[a.points.length - 1];
    if (!start || !end) continue;
    const a0 = projectFrameToFloor(start, cam);
    const a1 = projectFrameToFloor(end, cam);
    items.push({
      id: `fl_arr_${a.id}`,
      kind: "arrow",
      x: a0.x,
      y: a0.y,
      w: Math.max(0.04, Math.hypot(a1.x - a0.x, a1.y - a0.y)),
      h: 0.04,
      rotation: facingFrom(a0, a1),
      label: a.label,
      shotId,
    });
  }
  return items;
}

export function sketchFromBlocking(
  figures: FloorFigure[],
  cam: FloorCamera | undefined,
  prev: { strokes: SketchData["strokes"]; stamps: Stamp[] },
): SketchData {
  const next: Stamp[] = figures.map((fig, i) => {
    const pos = cam
      ? projectFigureToFrame(fig, cam)
      : { x: 0.22 + (i % 4) * 0.18, y: 0.62 };
    return {
      id: `st_${fig.id}`,
      kind: "figure",
      figureId: fig.id,
      label: shortFigureName(fig.name),
      x: pos.x,
      y: pos.y,
      scale: 1,
    };
  });
  for (const s of prev.stamps) {
    if (s.kind === "figure") continue;
    next.push(s);
  }
  return { strokes: prev.strokes, stamps: next };
}

export function linkSketchToBlocking(
  figures: FloorFigure[],
  cam: FloorCamera | undefined,
  prev: { strokes: SketchData["strokes"]; stamps: Stamp[] },
): SketchData {
  return sketchFromBlocking(figures, cam, prev);
}

export function ensureFloor(floor: FloorPlan | undefined | null, shots: Shot[]): FloorPlan {
  const next = floor && (floor.items?.length || floor.cameras?.length) ? floor : emptyFloor();
  if (next.items.length || next.cameras.length) {
    const cameras = next.cameras.map((c) => {
      if (c.shotId && shots.some((s) => s.id === c.shotId)) return c;
      const shot = shots.find((s) => s.setup === c.setup);
      return shot ? { ...c, shotId: shot.id } : c;
    });
    return { ...next, cameras };
  }
  return next;
}
