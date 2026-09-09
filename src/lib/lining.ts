import type { CoverageSize, LineColor, Project, ScriptElement, Shot } from "./types";
import { COVERAGE_SIZES, isBoardable, LINE_COLORS } from "./types";
import { coverageRole } from "./coverage-edit";

export const LINE_COLOR_CLASS: Record<LineColor, string> = {
  ink: "text-line-ink",
  red: "text-line-red",
  blue: "text-line-blue",
  green: "text-line-green",
  brown: "text-line-brown",
  plum: "text-line-plum",
};

export const LINE_COLOR_BG: Record<LineColor, string> = {
  ink: "bg-line-ink",
  red: "bg-line-red",
  blue: "bg-line-blue",
  green: "bg-line-green",
  brown: "bg-line-brown",
  plum: "bg-line-plum",
};

export const LINE_COLOR_VAR: Record<LineColor, string> = {
  ink: "var(--color-line-ink)",
  red: "var(--color-line-red)",
  blue: "var(--color-line-blue)",
  green: "var(--color-line-green)",
  brown: "var(--color-line-brown)",
  plum: "var(--color-line-plum)",
};

export const COL_W = 20;
export const COL_W_COMPACT = 14;
export const LABEL_SPACE = 52;
export const LABEL_SPACE_COMPACT = 32;
export const GUTTER_PAD = 12;

export function colWidth(compact = false): number {
  return compact ? COL_W_COMPACT : COL_W;
}

export function labelSpace(compact = false): number {
  return compact ? LABEL_SPACE_COMPACT : LABEL_SPACE;
}

export function lineColorAt(index: number): LineColor {
  return LINE_COLORS[((index % LINE_COLORS.length) + LINE_COLORS.length) % LINE_COLORS.length];
}

export function nextSetup(project: Project, sceneId: string | null): string {
  const sceneIndex = project.script
    .filter((e) => e.kind === "scene")
    .findIndex((e) => e.id === sceneId);
  const sceneNumber = Math.max(1, sceneIndex + 1);
  const prefix = String(sceneNumber);
  const used = new Set(
    project.shots
      .filter((s) => s.sceneId === sceneId)
      .map((s) => s.setup.replace(new RegExp(`^${prefix}`), "") || s.setup),
  );
  const letters: string[] = [];
  for (let i = 0; i < 26; i++) letters.push(String.fromCharCode(65 + i));
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      letters.push(String.fromCharCode(65 + i) + String.fromCharCode(65 + j));
    }
  }
  const letter = letters.find((l) => !used.has(l)) ?? `X${used.size}`;
  return `${prefix}${letter}`;
}

export function coverageLabel(shot: Shot): string {
  const setup = shot.setup?.trim() || String(shot.number);
  return `${setup} [${framingLabel(shot.coverageSize)}]`;
}

export function framingLabel(size: CoverageSize): string {
  return size === "MS" ? "Medium" : size;
}

export function sizeFromCamera(camera: Shot["camera"]): CoverageSize {
  if (camera === "extreme-wide" || camera === "wide" || camera === "birds-eye") return "LS";
  if (camera === "full") return "WS";
  if (camera === "close-up") return "CU";
  if (camera === "extreme-close-up") return "ECU";
  if (camera === "insert") return "Insert";
  if (camera === "over-the-shoulder") return "OTS";
  if (camera === "pov") return "CU";
  return "MS";
}

export function isCoverageKind(kind: ScriptElement["kind"]): boolean {
  return isBoardable(kind) || kind === "character" || kind === "parenthetical" || kind === "scene";
}

export function coverageIndices(
  script: ScriptElement[],
  shot: Shot,
): { start: number; end: number } | null {
  const ids = new Set(shot.elementIds);
  let start = -1;
  let end = -1;
  script.forEach((el, i) => {
    if (ids.has(el.id)) {
      if (start < 0) start = i;
      end = i;
    }
  });
  if (start < 0) return null;
  return { start, end };
}

export function elementsInRange(
  script: ScriptElement[],
  startId: string,
  endId: string,
): ScriptElement[] {
  const a = script.findIndex((e) => e.id === startId);
  const b = script.findIndex((e) => e.id === endId);
  if (a < 0 || b < 0) return [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return script.slice(lo, hi + 1).filter((e) => isCoverageKind(e.kind));
}

export function packColumns(spans: { start: number; end: number }[]): number[] {
  const columnsEnd: number[] = [];
  return spans.map((span) => {
    for (let c = 0; c < columnsEnd.length; c++) {
      if (span.start > columnsEnd[c]) {
        columnsEnd[c] = span.end;
        return c;
      }
    }
    columnsEnd.push(span.end);
    return columnsEnd.length - 1;
  });
}

export function linedShots(project: Project) {
  const spans = project.shots
    .map((shot) => {
      const range = coverageIndices(project.script, shot);
      if (!range) return null;
      return { shot, ...range };
    })
    .filter((s): s is { shot: Shot; start: number; end: number } => Boolean(s));
  const columns = packColumns(spans);
  return spans.map((span, i) => ({ ...span, column: columns[i] ?? 0 }));
}

export function columnCount(project: Project): number {
  const lined = linedShots(project);
  if (!lined.length) return 1;
  return Math.max(1, ...lined.map((l) => l.column + 1));
}

export function gutterWidth(cols: number, compact = false): number {
  return labelSpace(compact) + Math.max(1, cols) * colWidth(compact) + GUTTER_PAD;
}

/** First-paint lining geometry so coverage arrows don't wait on measure/fonts. */
export function estimateLiningGeom(
  script: ScriptElement[],
  width: number,
): { rects: Record<string, { top: number; height: number }>; width: number; height: number } {
  const rects: Record<string, { top: number; height: number }> = {};
  let y = 0;
  for (const el of script) {
    const cpl = el.kind === "dialogue" || el.kind === "parenthetical" ? 40 : 62;
    const lines = Math.max(1, Math.ceil((el.text?.length || 1) / cpl));
    const textH = lines * 17.5;
    const mt =
      el.kind === "scene"
        ? 32
        : el.kind === "character"
          ? 20
          : el.kind === "transition"
            ? 24
            : el.kind === "action"
              ? 16
              : 6;
    const mb = el.kind === "scene" ? 12 : 4;
    const height = mt + textH + mb;
    rects[el.id] = { top: y + mt * 0.35, height: textH + 10 };
    y += height;
  }
  return { rects, width: Math.max(1, width), height: Math.max(1, y) };
}

export function shotsCovering(project: Project, elementId: string): Shot[] {
  return project.shots.filter((s) => s.elementIds.includes(elementId) || s.sceneId === elementId);
}

export function tightestCovering(project: Project, elementId: string): Shot | undefined {
  const hits = shotsCovering(project, elementId);
  if (!hits.length) return undefined;
  return [...hits].sort((a, b) => a.elementIds.length - b.elementIds.length)[0];
}

export function nearestElementId(
  script: ScriptElement[],
  rects: Record<string, { top: number; height: number }>,
  y: number,
): string | null {
  let best: { id: string; dist: number } | null = null;
  for (const el of script) {
    const r = rects[el.id];
    if (!r) continue;
    const dist = y < r.top ? r.top - y : y > r.top + r.height ? y - (r.top + r.height) : 0;
    if (!best || dist < best.dist) best = { id: el.id, dist };
  }
  return best?.id ?? null;
}

export const SIZE_HINT: Record<CoverageSize, string> = {
  WS: "Wide — full body head-to-toe and room geography",
  LS: "Long — full body in wider setting (synonym of Wide)",
  MS: "Medium — waist up, conversation default (not master shot)",
  MCU: "Medium close — chest and face",
  CU: "Close-up — one face or principal object",
  ECU: "Extreme close — eyes, detail, or macro texture",
  OTS: "Over the shoulder — dialogue reverse coverage",
  "2S": "Two-shot — both characters in one frame",
  Insert: "Insert — prop or detail that sells the cut",
};

export function isCoverageSize(value: string): value is CoverageSize {
  return (COVERAGE_SIZES as readonly string[]).includes(value);
}

export function marginNumber(script: ScriptElement[], index: number): string | null {
  const el = script[index];
  if (!el) return null;
  if (el.kind === "scene") {
    return String(script.slice(0, index + 1).filter((e) => e.kind === "scene").length);
  }
  if (el.kind === "character") {
    return String(script.slice(0, index + 1).filter((e) => e.kind === "character").length);
  }
  return null;
}
