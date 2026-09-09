import { draftsFromScript, looksLikeCharacter, looksLikeScene, looksLikeTransition, parseSlugline, sceneIdForElement } from "./fountain";
import { productionItemMetadata, reconcileProductionCatalog } from "./production-catalog";
import { validateScriptCommentThreads, type ScriptCommentThread } from "./script-comments";
import { applyPublicDemoMediaPolicy } from "./demo-media-provenance";
import { isCoverageSize, lineColorAt, sizeFromCamera } from "./lining";
import {
  attachPeeled,
  isMarkTag,
  mergeMarks,
  peelMarks,
  sceneIdOf,
  seedCastMarks,
  seedFromBreakdown,
  seedLocationMarks,
  weaveMarks,
} from "./marks";
import { DEFAULT_CHAIN, DEFAULT_SKILLS } from "./prompt-chain";
import type {
  BinderAsset,
  BreakdownItem,
  CameraAngle,
  CameraMovement,
  CharacterBible,
  CoverageSize,
  FloorPlan,
  LineColor,
  Project,
  PromptSkill,
  ScriptElement,
  ScriptMark,
  Shot,
  Stamp,
  Target,
  WorldLock,
} from "./types";
import {
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  emptyFloor,
  emptyTimeline,
  emptyShot,
  emptySketch,
  emptyWorld,
  LINE_COLORS,
  TARGETS,
} from "./types";
import { uid } from "./utils";
import { hydrateWorld, syncCoreEvents } from "./world";

export interface SlateManifest {
  format: "slate";
  version: 1;
  name?: string;
  script?: string;
  lining?: string;
  /** Optional complete Project snapshot; script/lining remain the legacy interchange. */
  projectSnapshot?: string;
  chain?: string[];
  cut?: string;
}

export interface LineDraft {
  setup: string;
  size?: string;
  color?: string;
  from?: string;
  to?: string;
  title?: string;
  note?: string;
  camera?: string;
  movement?: string;
  duration?: number;
  action?: string;
  dialogue?: string;
  characters?: string[];
  lighting?: string;
  id?: string;
  stamps?: Stamp[];
  frame?: string;
  blocking?: Shot["blocking"];
}

export interface ParsedSlate {
  name: string;
  logline: string;
  style: string;
  target: Target;
  cutUrl: string | null;
  world: WorldLock;
  characters: CharacterBible[];
  script: ScriptElement[];
  shots: Shot[];
  binder: BinderAsset[];
  breakdown: BreakdownItem[];
  skills: PromptSkill[];
  chain: string[];
  marks: ScriptMark[];
  scriptCommentThreads?: ScriptCommentThread[];
  floor: FloorPlan;
}

const LINE_START = /^\^\s*([A-Z0-9]+)\s*(?:\[([^\]]+)\])?\s*(?:#([a-z]+))?/i;
const FENCE_LINE = /^:::[\s]*line\s+(.+)$/i;
const ANCHOR = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

export function isSlateText(text: string): boolean {
  const t = text.trim();
  if (!t || t.startsWith("{") || t.startsWith("PK")) return false;
  if (t.startsWith("---")) return true;
  if (/^# (World|Cast|Script)\b/m.test(t)) return true;
  if (/^\^\s*[A-Z0-9]+\s*\[/m.test(t)) return true;
  if (/^:::[\s]*line\b/m.test(t)) return true;
  return false;
}

export function parseJsonl(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object") rows.push(parsed as Record<string, unknown>);
    } catch {
      /* skip bad row */
    }
  }
  return rows;
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---")) return { meta: {}, body: src };
  const end = src.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: src };
  const block = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n/, "");
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = { script: "" };
  const re = /^# (World|Cast|Script|Skills)\s*$/gim;
  const matches = [...body.matchAll(re)];
  if (matches.length === 0) {
    sections.script = body.trim();
    return sections;
  }
  const preface = body.slice(0, matches[0].index).trim();
  if (preface) sections.script = preface;
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1].toLowerCase();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    sections[name] = body.slice(start, end).trim();
  }
  return sections;
}

function parseWorld(text: string): WorldLock {
  const world = emptyWorld();
  if (!text.trim()) return world;
  const keys = ["place", "lighting", "ambience", "laws"] as const;
  let current: (typeof keys)[number] | null = null;
  const buf: Record<string, string[]> = { place: [], lighting: [], ambience: [], laws: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\*?\*?([A-Za-z]+)\*?\*?[:.]\s*(.*)$/);
    const key = m?.[1]?.toLowerCase();
    if (key && (keys as readonly string[]).includes(key)) {
      current = key as (typeof keys)[number];
      if (m?.[2]) buf[current].push(m[2]);
      continue;
    }
    if (current) buf[current].push(line);
    else buf.place.push(line);
  }
  return {
    ...world,
    place: buf.place.join(" ").trim() || world.place,
    lighting: buf.lighting.join(" ").trim() || world.lighting,
    ambience: buf.ambience.join(" ").trim() || world.ambience,
    laws: buf.laws.join(" ").trim() || world.laws,
  };
}

function parseCast(text: string): CharacterBible[] {
  const people: CharacterBible[] = [];
  if (!text.trim()) return people;
  let current: CharacterBible | null = null;
  const flush = () => {
    if (current?.name) people.push(current);
    current = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^##\s+(.+)$/);
    const bold = line.match(/^\*\*(.+?)\*\*(?:\s*[—–-]\s*(.+))?$/);
    if (heading || (bold && !/^(look|voice|start)\b/i.test(bold[1]))) {
      flush();
      current = {
        name: (heading?.[1] || bold?.[1] || "").trim(),
        look: bold?.[2]?.trim() ?? "",
        aliases: [],
      };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^(Look|Voice|Start|Starts|Also|AKA|Aliases)\s*[:.]\s*(.+)$/i);
    if (field) {
      const k = field[1].toLowerCase();
      if (k === "look") current.look = field[2].trim();
      else if (k === "voice") current.voice = field[2].trim();
      else if (k === "also" || k === "aka" || k === "aliases") {
        current.aliases = field[2]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else current.start = field[2].trim();
      continue;
    }
    current.look = current.look ? `${current.look} ${line}` : line;
  }
  flush();
  return people;
}

function parseSkillsSection(text: string): PromptSkill[] {
  const skills: PromptSkill[] = [];
  if (!text.trim()) return skills;
  const chunks = text.split(/^##\s+/m).filter(Boolean);
  for (const chunk of chunks) {
    const [first, ...rest] = chunk.split("\n");
    const title = first.trim();
    const body = rest.join("\n").trim();
    if (!title || !body) continue;
    skills.push({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("skill"),
      title,
      body,
    });
  }
  return skills;
}

function stripAnchor(line: string): { text: string; id: string | null } {
  const m = line.match(ANCHOR);
  if (!m) return { text: line.trim(), id: null };
  return { text: line.replace(ANCHOR, "").trim(), id: m[1] };
}

function parseLineHeader(header: string): LineDraft | null {
  const m = header.trim().match(LINE_START) || header.trim().match(/^([A-Z0-9]+)\s*(?:\[([^\]]+)\])?\s*(?:#([a-z]+))?/i);
  if (!m) return null;
  return {
    setup: m[1].toUpperCase(),
    size: m[2]?.trim(),
    color: m[3]?.toLowerCase(),
  };
}

function applyLineField(draft: LineDraft, key: string, value: string) {
  const k = key.toLowerCase();
  if (k === "from" || k === "start") draft.from = value;
  else if (k === "to" || k === "end") draft.to = value;
  else if (k === "covers") {
    const parts = value.split(/\s*(?:\.\.|→|->|—|–)\s*/);
    if (parts[0]) draft.from = parts[0].replace(/^["']|["']$/g, "");
    if (parts[1]) draft.to = parts[1].replace(/^["']|["']$/g, "");
  } else if (k === "title") draft.title = value;
  else if (k === "note" || k === "notes") draft.note = value;
  else if (k === "camera") draft.camera = value;
  else if (k === "movement" || k === "move") draft.movement = value;
  else if (k === "action") draft.action = value;
  else if (k === "dialogue") draft.dialogue = value;
  else if (k === "lighting") draft.lighting = value;
  else if (k === "duration") draft.duration = Number(value) || draft.duration;
  else if (k === "id") draft.id = value;
  else if (k === "characters") draft.characters = value.split(",").map((s) => s.trim()).filter(Boolean);
  else draft.note = draft.note ? `${draft.note} ${value}` : value;
}

function parseScriptWithLines(text: string): { elements: ScriptElement[]; drafts: LineDraft[] } {
  const drafts: LineDraft[] = [];
  const elements: ScriptElement[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let pendingCharacter: string | null = null;
  let actionBuf: { text: string; id: string | null }[] = [];

  const flushAction = () => {
    if (!actionBuf.length) return;
    const id = actionBuf.find((a) => a.id)?.id ?? uid("el");
    const t = actionBuf
      .map((a) => a.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    actionBuf = [];
    if (t) elements.push({ id, kind: "action", text: t });
  };

  const push = (kind: ScriptElement["kind"], value: string, id: string | null, character?: string) => {
    const t = value.replace(/\s+/g, " ").trim();
    if (!t) return;
    elements.push({
      id: id || uid("el"),
      kind,
      text: t,
      ...(character ? { character } : {}),
    });
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    i += 1;
    if (FENCE_LINE.test(trimmed)) {
      flushAction();
      pendingCharacter = null;
      const header = trimmed.replace(/^:::[\s]*line\s+/i, "");
      const draft = parseLineHeader(`^ ${header}`) ?? parseLineHeader(header);
      const body: string[] = [];
      while (i < lines.length && !/^:::/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^:::/.test(lines[i].trim())) i += 1;
      if (draft) {
        for (const bl of body) {
          const t = bl.trim();
          const field = t.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
          if (field) applyLineField(draft, field[1], field[2]);
          else if (t) draft.note = draft.note ? `${draft.note} ${t}` : t;
        }
        drafts.push(draft);
      }
      continue;
    }
    if (LINE_START.test(trimmed)) {
      flushAction();
      pendingCharacter = null;
      const draft = parseLineHeader(trimmed);
      if (!draft) continue;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) {
          i += 1;
          break;
        }
        if (LINE_START.test(t) || FENCE_LINE.test(t) || looksLikeScene(t) || t.startsWith("#") || t.startsWith("##")) {
          break;
        }
        const field = t.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
        if (field) applyLineField(draft, field[1], field[2]);
        else draft.note = draft.note ? `${draft.note} ${t}` : t;
        i += 1;
      }
      drafts.push(draft);
      continue;
    }
    if (!trimmed) {
      flushAction();
      pendingCharacter = null;
      continue;
    }
    const heading = trimmed.match(/^##\s+(.+)$/);
    const { text: stripped, id } = stripAnchor(heading ? heading[1] : trimmed);
    if (heading || looksLikeScene(stripped)) {
      flushAction();
      pendingCharacter = null;
      push("scene", stripped.replace(/^\./, "").toUpperCase(), id);
      continue;
    }
    if (looksLikeTransition(stripped)) {
      flushAction();
      pendingCharacter = null;
      push("transition", stripped.replace(/^>/, "").toUpperCase(), id);
      continue;
    }
    // Inline marks are presentation metadata, not part of the speaker cue.
    // Keep their raw payload for the later mark-extraction pass.
    const visibleCue = peelMarks(stripped).text;
    if (looksLikeCharacter(visibleCue) && !pendingCharacter) {
      flushAction();
      pendingCharacter = visibleCue.replace(/^@/, "").toUpperCase();
      push("character", stripped.replace(/^@/, ""), id);
      continue;
    }
    if (pendingCharacter && /^\(.*\)$/.test(visibleCue)) {
      push("parenthetical", stripped, id, pendingCharacter);
      continue;
    }
    if (pendingCharacter) {
      const dlg = [stripped];
      let dlgId = id;
      while (i < lines.length && !dlgId) {
        const nRaw = lines[i].trim();
        if (!nRaw) break;
        const n = stripAnchor(nRaw);
        const nextVisible = peelMarks(n.text).text;
        // A parenthetical belongs after this speech, and an explicit anchor ends
        // a dialogue element. Leave subsequent elements for the outer loop.
        if (LINE_START.test(nRaw) || FENCE_LINE.test(nRaw) || looksLikeScene(nextVisible) || looksLikeCharacter(nextVisible) || /^\(.*\)$/.test(nextVisible)) break;
        i += 1;
        dlg.push(n.text);
        if (n.id) dlgId = n.id;
      }
      push("dialogue", dlg.join(" "), dlgId, pendingCharacter);
      continue;
    }
    actionBuf.push({ text: stripped, id });
  }
  flushAction();
  return { elements, drafts };
}

function resolveAnchor(script: ScriptElement[], token: string | undefined): string | null {
  if (!token) return null;
  const t = token.trim().replace(/^["']|["']$/g, "");
  if (!t) return null;
  const exact = script.find((e) => e.id === t);
  if (exact) return exact.id;
  const lower = t.toLowerCase();
  const hit = script.find(
    (e) => e.text.toLowerCase() === lower || e.text.toLowerCase().startsWith(lower),
  );
  return hit?.id ?? null;
}

function asLineColor(raw: string | undefined, index: number): LineColor {
  if (raw && (LINE_COLORS as readonly string[]).includes(raw)) return raw as LineColor;
  return lineColorAt(index);
}

function asCamera(raw: string | undefined): CameraAngle | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase().replace(/\s+/g, "-");
  return (CAMERA_ANGLES as readonly string[]).includes(t) ? (t as CameraAngle) : undefined;
}

function asMove(raw: string | undefined): CameraMovement | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase().replace(/\s+/g, "-");
  return (CAMERA_MOVEMENTS as readonly string[]).includes(t) ? (t as CameraMovement) : undefined;
}

function asSize(raw: string | undefined, camera?: CameraAngle): CoverageSize {
  if (raw && isCoverageSize(raw)) return raw;
  return sizeFromCamera(camera ?? "medium");
}

function elementsBetween(script: ScriptElement[], startId: string | null, endId: string | null): string[] {
  if (!startId && !endId) return [];
  const a = startId ? script.findIndex((e) => e.id === startId) : 0;
  const b = endId ? script.findIndex((e) => e.id === endId) : script.length - 1;
  if (a < 0 || b < 0) return startId ? [startId] : [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return script.slice(lo, hi + 1).map((e) => e.id);
}

function draftToShot(draft: LineDraft, index: number, script: ScriptElement[]): Shot {
  const fromId = resolveAnchor(script, draft.from);
  const toId = resolveAnchor(script, draft.to) ?? fromId;
  const elementIds = elementsBetween(script, fromId, toId);
  const sceneId = elementIds[0] ? sceneIdForElement(script, elementIds[0]) : script.find((e) => e.kind === "scene")?.id ?? null;
  const scene = script.find((e) => e.id === sceneId);
  const slug = scene ? parseSlugline(scene.text) : { location: "", timeOfDay: "day" as const };
  const camera = asCamera(draft.camera) ?? "medium";
  const actionEl = script.find((e) => elementIds.includes(e.id) && e.kind === "action");
  const dlgEl = script.find((e) => elementIds.includes(e.id) && e.kind === "dialogue");
  const blocking = draft.blocking ?? { figures: [] };
  const blockedIds = new Set(blocking.figures.map((figure) => figure.id));
  const stamps = (draft.stamps ?? []).map((s, i) => {
    const rawFigureId = (s as Stamp & { figureId?: unknown }).figureId;
    if (rawFigureId !== undefined && (typeof rawFigureId !== "string" || !rawFigureId.trim())) {
      throw new Error(`Setup ${draft.setup} stamp figureId must be a nonempty string.`);
    }
    if (rawFigureId !== undefined && s.kind !== "figure") {
      throw new Error(`Setup ${draft.setup} box stamp cannot carry figureId ${rawFigureId}.`);
    }
    if (typeof rawFigureId === "string" && !blockedIds.has(rawFigureId)) {
      throw new Error(`Setup ${draft.setup} stamp figureId ${rawFigureId} does not match a blocked figure.`);
    }
    return {
      id: s.id || `st_${i}`,
      kind: s.kind === "box" ? ("box" as const) : ("figure" as const),
      x: s.x,
      y: s.y,
      scale: s.scale ?? 1,
      label: s.label,
      ...(typeof rawFigureId === "string" ? { figureId: rawFigureId } : {}),
    };
  });
  const shot = emptyShot({
    id: draft.id || uid("shot"),
    number: index + 1,
    setup: draft.setup,
    coverageSize: asSize(draft.size, camera),
    lineColor: asLineColor(draft.color, index),
    title: draft.title || draft.setup,
    action: draft.action || actionEl?.text || "",
    dialogue: draft.dialogue || dlgEl?.text || "",
    camera,
    movement: asMove(draft.movement) ?? "static",
    durationSec: draft.duration ?? 6,
    timeOfDay: slug.timeOfDay,
    location: slug.location,
    characters: draft.characters ?? [],
    lighting: draft.lighting || "",
    notes: draft.note || "",
    sceneId,
    elementIds,
    sketch: stamps.length ? { strokes: [], stamps } : emptySketch(),
    frameUrl: draft.frame || null,
    blocking,
  });
  shot.events = syncCoreEvents(shot);
  return shot;
}

function jsonlToDraft(row: Record<string, unknown>): LineDraft | null {
  const kind = String(row.kind ?? "line");
  if (kind !== "line" && kind !== "shot") return null;
  const setup = String(row.setup ?? "").toUpperCase();
  if (!setup) return null;
  const stamps = Array.isArray(row.stamps)
    ? (row.stamps as Stamp[])
    : Array.isArray((row.sketch as { stamps?: Stamp[] } | undefined)?.stamps)
      ? ((row.sketch as { stamps: Stamp[] }).stamps)
      : undefined;
  return {
    setup,
    size: row.size ? String(row.size) : undefined,
    color: row.color ? String(row.color) : undefined,
    from: row.from ? String(row.from) : row.start ? String(row.start) : undefined,
    to: row.to ? String(row.to) : row.end ? String(row.end) : undefined,
    title: row.title ? String(row.title) : undefined,
    note: row.note ? String(row.note) : row.notes ? String(row.notes) : undefined,
    camera: row.camera ? String(row.camera) : undefined,
    movement: row.movement ? String(row.movement) : undefined,
    duration: typeof row.duration === "number" ? row.duration : undefined,
    action: row.action ? String(row.action) : undefined,
    dialogue: row.dialogue ? String(row.dialogue) : undefined,
    lighting: row.lighting ? String(row.lighting) : undefined,
    id: row.id ? String(row.id) : undefined,
    characters: Array.isArray(row.characters) ? row.characters.map(String) : undefined,
    stamps,
    frame: row.frame ? String(row.frame) : row.frameUrl ? String(row.frameUrl) : undefined,
    blocking:
      row.blocking && typeof row.blocking === "object"
        ? (row.blocking as Shot["blocking"])
        : undefined,
  };
}

export function parseSlateSource(scriptText: string, liningText = ""): ParsedSlate {
  const { meta, body } = parseFrontmatter(scriptText);
  const sections = splitSections(body);
  const world = parseWorld(sections.world ?? "");
  const characters = parseCast(sections.cast ?? "");
  const { elements, drafts } = parseScriptWithLines(sections.script || body);
  const skills = parseSkillsSection(sections.skills ?? "");
  const binder: BinderAsset[] = [];
  const breakdown: BreakdownItem[] = [];
  const extraSkills: PromptSkill[] = [...skills];
  const jsonlDrafts: LineDraft[] = [];
  const jsonlMarks: ScriptMark[] = [];
  const commentThreads: unknown[] = [];
  let catalogRecord = false;
  let floor = emptyFloor();
  let cutUrl = meta.cut || null;
  let chain: string[] = [...DEFAULT_CHAIN];

  if (liningText.trim()) {
    for (const row of parseJsonl(liningText)) {
      const kind = String(row.kind ?? "line");
      if (kind === "production_catalog") {
        if (row.version !== 1) throw new Error("Unsupported production catalog version.");
        catalogRecord = true;
      } else if (kind === "script-comment") {
        commentThreads.push(row.thread);
      } else if (kind === "world") {
        world.place = String(row.place ?? world.place);
        world.lighting = String(row.lighting ?? world.lighting);
        world.ambience = String(row.ambience ?? world.ambience);
        world.laws = String(row.laws ?? world.laws);
      } else if (kind === "cast") {
        const name = String(row.name ?? "");
        if (!name) continue;
        const aliases = Array.isArray(row.aliases)
          ? row.aliases.map(String)
          : String(row.also ?? row.aka ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        const existing = characters.find((c) => c.name.toLowerCase() === name.toLowerCase());
        const next = {
          name,
          look: String(row.look ?? existing?.look ?? ""),
          voice: row.voice ? String(row.voice) : existing?.voice,
          start: row.start ? String(row.start) : existing?.start,
          aliases: aliases.length ? aliases : existing?.aliases ?? [],
        };
        if (existing) Object.assign(existing, next);
        else characters.push(next);
      } else if (kind === "ref") {
        binder.push({
          id: String(row.id ?? uid("ref")),
          tab: (String(row.tab ?? "boards") as BinderAsset["tab"]) || "boards",
          title: String(row.title ?? "Reference"),
          url: row.url ? String(row.url) : undefined,
          caption: row.caption ? String(row.caption) : undefined,
          character: row.character ? String(row.character) : undefined,
        });
      } else if (kind === "breakdown") {
        breakdown.push({
          id: String(row.id ?? uid("bd")),
          department: String(row.department ?? ""),
          item: String(row.item ?? ""),
          notes: String(row.notes ?? ""),
          ...(row.sceneId !== undefined ? { sceneId: row.sceneId === null ? null : String(row.sceneId) } : {}),
          ...productionItemMetadata(row),
        });
      } else if (kind === "skill") {
        extraSkills.push({
          id: String(row.id ?? uid("skill")),
          title: String(row.title ?? "Skill"),
          body: String(row.body ?? ""),
        });
      } else if (kind === "chain" && Array.isArray(row.ids)) {
        chain = row.ids.map(String);
      } else if (kind === "floor") {
        floor = {
          label: String(row.label ?? ""),
          items: Array.isArray(row.items) ? (row.items as FloorPlan["items"]) : [],
          cameras: Array.isArray(row.cameras) ? (row.cameras as FloorPlan["cameras"]) : [],
          homes: Array.isArray(row.homes) ? (row.homes as FloorPlan["homes"]) : [],
          path: Array.isArray(row.path) ? (row.path as FloorPlan["path"]) : [],
        };
      } else if (kind === "mark") {
        const tag = String(row.tag ?? "").toLowerCase();
        if (!isMarkTag(tag)) continue;
        const elementId = String(row.element ?? row.elementId ?? "");
        if (!elementId) continue;
        jsonlMarks.push({
          id: String(row.id ?? uid("mk")),
          tag,
          text: String(row.text ?? ""),
          note: String(row.note ?? row.notes ?? ""),
          elementId,
          start: typeof row.start === "number" ? row.start : 0,
          end: typeof row.end === "number" ? row.end : String(row.text ?? "").length,
          sceneId: row.scene ? String(row.scene) : null,
          ...(typeof row.productionItemId === "string" ? { productionItemId: row.productionItemId } : {}),
          ...(["missing", "ambiguous"].includes(String(row.anchorStatus)) ? { anchorStatus: row.anchorStatus as ScriptMark["anchorStatus"] } : {}),
        });
      } else if (kind === "meta") {
        if (row.cut) cutUrl = String(row.cut);
        if (row.name) meta.title = String(row.name);
      } else {
        const draft = jsonlToDraft(row);
        if (draft) jsonlDrafts.push(draft);
      }
    }
  }

  const merged = new Map<string, LineDraft>();
  for (const d of drafts) merged.set(d.setup, { ...d });
  for (const d of jsonlDrafts) {
    const prev = merged.get(d.setup);
    merged.set(d.setup, prev ? { ...prev, ...d, note: d.note || prev.note } : d);
  }

  const cleaned: ScriptElement[] = [];
  const inlineMarks: ScriptMark[] = [];
  for (const el of elements) {
    const peeled = peelMarks(el.text);
    cleaned.push({ ...el, text: el.kind === "character" ? peeled.text.toUpperCase() : peeled.text });
    inlineMarks.push(...attachPeeled(el.id, sceneIdOf(elements, el.id), peeled.marks));
  }
  const jsonlSetups = new Set(jsonlDrafts.map((draft) => draft.setup));
  const markdownSetups = new Set(drafts.map((draft) => draft.setup));
  const jsonlIsComplete = drafts.every((draft) => jsonlSetups.has(draft.setup));
  const orderedSetups = jsonlIsComplete
    ? jsonlDrafts.map((draft) => draft.setup)
    : [...drafts.map((draft) => draft.setup), ...jsonlDrafts.filter((draft) => !markdownSetups.has(draft.setup)).map((draft) => draft.setup)];
  const seenSetups = new Set<string>();
  const orderedDrafts = orderedSetups
    .filter((setup) => !seenSetups.has(setup) && seenSetups.add(setup))
    .map((setup) => merged.get(setup))
    .filter((draft): draft is LineDraft => !!draft);
  for (const [setup, draft] of merged) {
    if (!seenSetups.has(setup)) orderedDrafts.push(draft);
  }
  const shots = orderedDrafts.map((d, i) => draftToShot(d, i, cleaned));
  const target = (TARGETS as readonly string[]).includes(meta.target) ? (meta.target as Target) : "imagine";
  const filledShots = shots.length ? shots : draftsFromScript(cleaned, 12);
  const explicitMarks = mergeMarks(
    jsonlMarks.map((m) => ({
      ...m,
      sceneId: m.sceneId ?? sceneIdOf(cleaned, m.elementId),
      text: m.text || cleaned.find((e) => e.id === m.elementId)?.text.slice(m.start, m.end) || m.text,
    })),
    catalogRecord ? [] : inlineMarks,
  );
  const seeds = catalogRecord ? [] : [...seedCastMarks(cleaned), ...seedLocationMarks(cleaned), ...seedFromBreakdown(cleaned, breakdown)].filter((mark) => !explicitMarks.some((existing) => existing.elementId === mark.elementId && existing.tag === mark.tag && existing.start === mark.start && existing.end === mark.end));
  const marks = mergeMarks(explicitMarks, seeds);

  return {
    name: meta.title || meta.name || "Untitled",
    logline: meta.logline || "",
    style: meta.style || "",
    target,
    cutUrl,
    world,
    characters,
    script: cleaned,
    shots: filledShots,
    binder,
    breakdown,
    skills: extraSkills.filter((s) => s.body.trim()),
    chain,
    marks,
    ...(commentThreads.length ? { scriptCommentThreads: validateScriptCommentThreads(commentThreads) } : {}),
    floor,
  };
}

export function parsedToProject(parsed: ParsedSlate, id?: string): Project {
  const shots = parsed.shots.map((shot) => ({
    ...shot,
    lighting: shot.lighting.trim() || parsed.world.lighting || shot.lighting,
    location: shot.location.trim() || parsed.world.place || shot.location,
  }));
  const project: Project = {
    id: id || uid("proj"),
    name: parsed.name,
    logline: parsed.logline,
    style: parsed.style,
    target: parsed.target,
    world: parsed.world,
    characters: parsed.characters,
    script: parsed.script,
    shots,
    skills: parsed.skills,
    chain: parsed.chain.length ? parsed.chain : [...DEFAULT_CHAIN],
    cutUrl: parsed.cutUrl,
    binder: parsed.binder,
    breakdown: parsed.breakdown,
    marks: parsed.marks,
    ...(parsed.scriptCommentThreads ? { scriptCommentThreads: parsed.scriptCommentThreads } : {}),
    floor: parsed.floor ?? emptyFloor(),
    timeline: emptyTimeline(),
    updatedAt: Date.now(),
  };
  return applyPublicDemoMediaPolicy(reconcileProductionCatalog(hydrateWorld(project)));
}

function wrapText(text: string, width = 68): string {
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let row = "";
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (next.length > width && row) {
      rows.push(row);
      row = w;
    } else row = next;
  }
  if (row) rows.push(row);
  return rows.join("\n");
}

export function toSlateMd(project: Project): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${project.name}`);
  if (project.logline) lines.push(`logline: ${project.logline}`);
  if (project.style) lines.push(`style: ${project.style}`);
  lines.push(`target: ${project.target}`);
  if (project.cutUrl) lines.push(`cut: ${project.cutUrl}`);
  lines.push("---", "");

  const world = project.world ?? emptyWorld();
  lines.push("# World", "");
  if (world.place) lines.push(`Place: ${world.place}`);
  if (world.lighting) lines.push(`Lighting: ${world.lighting}`);
  if (world.ambience) lines.push(`Ambience: ${world.ambience}`);
  if (world.laws) lines.push(`Laws: ${world.laws}`);
  lines.push("");

  if (project.characters.length) {
    lines.push("# Cast", "");
    for (const c of project.characters) {
      lines.push(`## ${c.name}`);
      if (c.aliases?.length) lines.push(`Also: ${c.aliases.join(", ")}`);
      if (c.look) lines.push(`Look: ${c.look}`);
      if (c.voice) lines.push(`Voice: ${c.voice}`);
      if (c.start) lines.push(`Start: ${c.start}`);
      lines.push("");
    }
  }

  const extraSkills = (project.skills ?? []).filter((s) => !DEFAULT_SKILLS.some((d) => d.id === s.id && d.body === s.body));
  if (extraSkills.length) {
    lines.push("# Skills", "");
    for (const s of extraSkills) {
      lines.push(`## ${s.title || s.id}`, s.body, "");
    }
  }

  lines.push("# Script", "");
  const pendingCoverage: string[] = [];
  for (const [index, el] of project.script.entries()) {
    const next = project.script[index + 1];
    const continuesSpeech = (el.kind === "character" || el.kind === "dialogue" || el.kind === "parenthetical") &&
      (next?.kind === "dialogue" || next?.kind === "parenthetical");
    const elMarks = (project.marks ?? []).filter((m) => {
      if (m.elementId !== el.id) return false;
      if ((el.kind === "character" || el.kind === "scene") && m.start === 0 && m.end >= el.text.length) {
        return false;
      }
      return true;
    });
    const body = elMarks.length ? weaveMarks(el.text, elMarks) : el.text;
    if (el.kind === "scene") {
      lines.push(`## ${body} {#${el.id}}`, "");
    } else if (el.kind === "character") {
      lines.push(`${body} {#${el.id}}`);
    } else if (el.kind === "parenthetical") {
      const t = el.text.startsWith("(") ? body : `(${body})`;
      lines.push(`${t} {#${el.id}}`);
    } else if (el.kind === "dialogue") {
      lines.push(`${elMarks.length ? body : wrapText(body, 42)} {#${el.id}}`);
      if (!continuesSpeech) lines.push("");
    } else if (el.kind === "transition") {
      lines.push(`${body} {#${el.id}}`, "");
    } else {
      lines.push(`${elMarks.length ? body : wrapText(body)} {#${el.id}}`, "");
    }
    for (const shot of project.shots) {
      if (shot.elementIds[0] !== el.id) continue;
      pendingCoverage.push(`^ ${shot.setup} [${shot.coverageSize}] #${shot.lineColor}`);
      if (shot.elementIds[0]) pendingCoverage.push(`from: ${shot.elementIds[0]}`);
      if (shot.elementIds[shot.elementIds.length - 1]) {
        pendingCoverage.push(`to: ${shot.elementIds[shot.elementIds.length - 1]}`);
      }
      if (shot.title) pendingCoverage.push(`title: ${shot.title}`);
      pendingCoverage.push(`camera: ${shot.camera}`);
      if (shot.movement !== "static") pendingCoverage.push(`movement: ${shot.movement}`);
      if (shot.notes) pendingCoverage.push(shot.notes);
      pendingCoverage.push("");
    }
    // Coverage metadata and blank lines terminate parser speech context, so
    // emit these anchored definitions only after the complete speech block.
    if (!continuesSpeech && pendingCoverage.length) {
      lines.push("", ...pendingCoverage);
      pendingCoverage.length = 0;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function toLiningJsonl(project: Project): string {
  const rows: unknown[] = [{ kind: "production_catalog", version: 1 }];
  for (const thread of project.scriptCommentThreads ?? []) rows.push({ kind: "script-comment", thread });
  for (const shot of project.shots) {
    rows.push({
      kind: "line",
      id: shot.id,
      setup: shot.setup,
      size: shot.coverageSize,
      color: shot.lineColor,
      from: shot.elementIds[0],
      to: shot.elementIds[shot.elementIds.length - 1],
      title: shot.title,
      note: shot.notes,
      camera: shot.camera,
      movement: shot.movement,
      duration: shot.durationSec,
      action: shot.action,
      dialogue: shot.dialogue,
      characters: shot.characters,
      lighting: shot.lighting,
      stamps: shot.sketch.stamps,
      frame: shot.frameUrl,
      blocking: shot.blocking?.figures?.length ? shot.blocking : undefined,
    });
  }
  for (const m of project.marks ?? []) {
    rows.push({
      kind: "mark",
      id: m.id,
      element: m.elementId,
      tag: m.tag,
      text: m.text,
      note: m.note,
      start: m.start,
      end: m.end,
      scene: m.sceneId,
      productionItemId: m.productionItemId,
      anchorStatus: m.anchorStatus,
    });
  }
  for (const a of project.binder) {
    rows.push({
      kind: "ref",
      id: a.id,
      tab: a.tab,
      title: a.title,
      url: a.url,
      caption: a.caption,
      character: a.character,
    });
  }
  for (const b of project.breakdown) {
    rows.push({
      kind: "breakdown",
      id: b.id,
      department: b.department,
      item: b.item,
      notes: b.notes,
      sceneId: b.sceneId,
      tag: b.tag,
      aliases: b.aliases,
      mergedIds: b.mergedIds,
      preservedNotes: b.preservedNotes,
      overrides: b.overrides,
    });
  }
  for (const s of project.skills ?? []) {
    if (DEFAULT_SKILLS.some((d) => d.id === s.id && d.body === s.body)) continue;
    rows.push({ kind: "skill", id: s.id, title: s.title, body: s.body });
  }
  if (project.chain?.length) rows.push({ kind: "chain", ids: project.chain });
  if (project.floor?.items?.length || project.floor?.cameras?.length) {
    rows.push({ kind: "floor", ...project.floor });
  }
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

export function documentsToProject(input: {
  script: string;
  lining?: string;
  manifest?: Partial<SlateManifest> | null;
  id?: string;
}): Project {
  const parsed = parseSlateSource(input.script, input.lining ?? "");
  if (input.manifest?.name) parsed.name = input.manifest.name;
  if (input.manifest?.cut) parsed.cutUrl = input.manifest.cut;
  if (input.manifest?.chain?.length) parsed.chain = input.manifest.chain;
  return parsedToProject(parsed, input.id);
}
