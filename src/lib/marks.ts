import type { BreakdownItem, CatalogTag, MarkTag, Project, ScriptElement, ScriptMark, SteerTag } from "./types";
import { CATALOG_TAGS, MARK_TAGS, STEER_TAGS } from "./types";
import { uid } from "./utils";
import { reconcileProductionCatalog } from "./production-catalog";

export function sceneIdOf(script: ScriptElement[], id: string): string | null {
  const idx = script.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  for (let i = idx; i >= 0; i--) {
    if (script[i]?.kind === "scene") return script[i].id;
  }
  return null;
}

export const STEER_META: Record<
  SteerTag,
  { label: string; hint: string; color: string }
> = {
  lock: { label: "Lock", hint: "This look must persist — face, wardrobe, set.", color: "var(--color-mark-lock)" },
  hold: { label: "Hold", hint: "Freeze this pose or object until a later beat releases it.", color: "var(--color-mark-hold)" },
  eyeline: { label: "Eyeline", hint: "Where the subject looks. Name the target.", color: "var(--color-mark-eyeline)" },
  cam: { label: "Cam", hint: "Lens, move, or frame on this span.", color: "var(--color-mark-cam)" },
  beat: { label: "Beat", hint: "Timing — a pause, a hit, a breath.", color: "var(--color-mark-beat)" },
  sound: { label: "Sound", hint: "Diegetic audio the clip must keep.", color: "var(--color-mark-sound)" },
  no: { label: "No", hint: "Do not invent this. Negative direction.", color: "var(--color-mark-no)" },
  phys: { label: "Phys", hint: "How matter behaves here — smoke, gravity, liquid.", color: "var(--color-mark-phys)" },
  cut: { label: "Cut", hint: "Cut grammar — match, smash, hold over.", color: "var(--color-mark-cut)" },
  cont: { label: "Cont", hint: "Carry this from the previous setup.", color: "var(--color-mark-cont)" },
};

export const CATALOG_META: Record<
  CatalogTag,
  { label: string; hint: string; color: string; department: string }
> = {
  cast: { label: "Cast", hint: "Speaking or featured player.", color: "var(--color-mark-cast)", department: "Cast" },
  extras: { label: "Extras", hint: "Background bodies. Not named principals.", color: "var(--color-mark-extras)", department: "Extras" },
  prop: { label: "Prop", hint: "Handled object.", color: "var(--color-mark-prop)", department: "Props" },
  dressing: { label: "Dressing", hint: "Set dressing that stays put.", color: "var(--color-mark-dressing)", department: "Set dressing" },
  wardrobe: { label: "Wardrobe", hint: "Costume piece to lock.", color: "var(--color-mark-wardrobe)", department: "Wardrobe" },
  makeup: { label: "Makeup", hint: "Hair, dirt, blood, aging.", color: "var(--color-mark-makeup)", department: "Makeup" },
  vehicle: { label: "Vehicle", hint: "Practical or pictured vehicle.", color: "var(--color-mark-vehicle)", department: "Vehicles" },
  animal: { label: "Animal", hint: "Living animal in frame.", color: "var(--color-mark-animal)", department: "Animals" },
  stunt: { label: "Stunt", hint: "A fall, fight, or gag.", color: "var(--color-mark-stunt)", department: "Stunts" },
  sfx: { label: "SFX", hint: "On-set effect — smoke, breakaway.", color: "var(--color-mark-sfx)", department: "SFX" },
  vfx: { label: "VFX", hint: "What the model must not invent around.", color: "var(--color-mark-vfx)", department: "VFX" },
  music: { label: "Music", hint: "Score or source music.", color: "var(--color-mark-music)", department: "Music" },
  equipment: { label: "Gear", hint: "Camera support, special equipment.", color: "var(--color-mark-equipment)", department: "Equipment" },
  location: { label: "Location", hint: "The place this scene is.", color: "var(--color-mark-location)", department: "Locations" },
};

export function isMarkTag(raw: string): raw is MarkTag {
  return (MARK_TAGS as readonly string[]).includes(raw);
}

export function markMeta(tag: MarkTag): { label: string; hint: string; color: string; family: "steer" | "catalog" } {
  if ((STEER_TAGS as readonly string[]).includes(tag)) {
    const m = STEER_META[tag as SteerTag];
    return { ...m, family: "steer" };
  }
  const m = CATALOG_META[tag as CatalogTag];
  return { ...m, family: "catalog" };
}

export function markColor(tag: MarkTag): string {
  return markMeta(tag).color;
}

export function departmentFor(tag: MarkTag): string {
  if ((CATALOG_TAGS as readonly string[]).includes(tag)) return CATALOG_META[tag as CatalogTag].department;
  return STEER_META[tag as SteerTag].label;
}

const WRAP = /\[\[([a-z][a-z0-9-]*)(?::([^\]]+))?\]\]([\s\S]*?)\[\[\/(?:\1)?\]\]/gi;
const COMMENT = /<!--\s*@([a-z][a-z0-9-]*)(?:[:\s]+([^>]*?))?\s*-->([\s\S]*?)<!--\s*\/@\s*-->/gi;

export function peelMarks(text: string): { text: string; marks: Omit<ScriptMark, "id" | "elementId" | "sceneId">[] } {
  const found: { tag: MarkTag; note: string; inner: string; at: number; length: number }[] = [];
  const src = text ?? "";
  const collect = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const tag = (m[1] || "").toLowerCase();
      if (!isMarkTag(tag) || m.index == null) continue;
      found.push({
        tag,
        note: (m[2] || "").trim(),
        inner: m[3] ?? "",
        at: m.index,
        length: m[0].length,
      });
    }
  };
  collect(WRAP);
  collect(COMMENT);
  found.sort((a, b) => a.at - b.at);
  const nested: typeof found = [];
  let cursor = 0;
  for (const f of found) {
    if (f.at < cursor) continue;
    nested.push(f);
    cursor = f.at + f.length;
  }
  let out = "";
  let last = 0;
  const marks: Omit<ScriptMark, "id" | "elementId" | "sceneId">[] = [];
  for (const f of nested) {
    out += src.slice(last, f.at);
    const start = out.length;
    out += f.inner;
    marks.push({
      tag: f.tag,
      note: f.note,
      text: f.inner,
      start,
      end: start + f.inner.length,
    });
    last = f.at + f.length;
  }
  out += src.slice(last);
  return { text: out, marks };
}

export function weaveMarks(text: string, marks: ScriptMark[]): string {
  // Inline notation cannot represent crossing spans. JSONL carries every occurrence;
  // emit a non-overlapping subset here so screenplay text remains round-trippable.
  let end = 0;
  const sorted = [...marks].filter((mark) => !mark.anchorStatus && mark.start >= 0 && mark.end <= text.length && mark.start < mark.end)
    .sort((a, b) => a.start - b.start).filter((mark) => { if (mark.start < end) return false; end = mark.end; return true; }).reverse();
  let out = text;
  for (const m of sorted) {
    if (m.start < 0 || m.end > out.length || m.start >= m.end) continue;
    const inner = out.slice(m.start, m.end);
    const note = m.note.replaceAll("[", "").replaceAll("]", "").trim();
    const open = note ? `[[${m.tag}:${note}]]` : `[[${m.tag}]]`;
    out = `${out.slice(0, m.start)}${open}${inner}[[/]]${out.slice(m.end)}`;
  }
  return out;
}

export function attachPeeled(
  elementId: string,
  sceneId: string | null,
  peeled: Omit<ScriptMark, "id" | "elementId" | "sceneId">[],
): ScriptMark[] {
  return peeled.map((m) => ({
    ...m,
    id: uid("mk"),
    elementId,
    sceneId,
  }));
}

export function markSegments(
  text: string,
  marks: ScriptMark[],
): { text: string; mark?: ScriptMark }[] {
  const usable = marks
    .filter((m) => !m.anchorStatus && m.start >= 0 && m.end <= text.length && m.start < m.end)
    .sort((a, b) => a.start - b.start);
  const parts: { text: string; mark?: ScriptMark }[] = [];
  let i = 0;
  for (const m of usable) {
    if (m.start < i) continue;
    if (m.start > i) parts.push({ text: text.slice(i, m.start) });
    parts.push({ text: text.slice(m.start, m.end), mark: m });
    i = m.end;
  }
  if (i < text.length) parts.push({ text: text.slice(i) });
  if (!parts.length) parts.push({ text });
  return parts;
}

export function marksOnElement(project: Project, elementId: string): ScriptMark[] {
  return (project.marks ?? []).filter((m) => m.elementId === elementId && !m.anchorStatus);
}

export function marksOnShot(project: Project, shotId: string): ScriptMark[] {
  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) return [];
  const ids = new Set(shot.elementIds);
  return (project.marks ?? []).filter((m) => ids.has(m.elementId) && !m.anchorStatus);
}

export function formatMarksBlock(marks: ScriptMark[]): string {
  if (!marks.length) return "";
  const lines = marks.map((m) => {
    const meta = markMeta(m.tag);
    const note = m.note.trim();
    return `${meta.label.toUpperCase()} "${m.text.trim()}"${note ? ` — ${note}` : ""}`;
  });
  return `DIRECTION\n${lines.join("\n")}`;
}

function findSpan(text: string, needle: string): { start: number; end: number } | null {
  const n = needle.trim();
  if (!n) return null;
  const lower = text.toLowerCase();
  const at = lower.indexOf(n.toLowerCase());
  if (at < 0) return null;
  return { start: at, end: at + n.length };
}

export function seedCastMarks(script: ScriptElement[]): ScriptMark[] {
  const marks: ScriptMark[] = [];
  for (const el of script) {
    if (el.kind !== "character") continue;
    const name = el.text.replace(/\s*\(.*\)\s*$/, "").trim();
    if (!name) continue;
    marks.push({
      id: uid("mk"),
      tag: "cast",
      text: name,
      note: "",
      elementId: el.id,
      start: 0,
      end: Math.min(name.length, el.text.length),
      sceneId: sceneIdOf(script, el.id),
    });
  }
  return marks;
}

export function seedLocationMarks(script: ScriptElement[]): ScriptMark[] {
  const marks: ScriptMark[] = [];
  for (const el of script) {
    if (el.kind !== "scene") continue;
    const text = el.text.trim();
    if (!text) continue;
    marks.push({
      id: uid("mk"),
      tag: "location",
      text,
      note: "",
      elementId: el.id,
      start: 0,
      end: text.length,
      sceneId: el.id,
    });
  }
  return marks;
}

export function seedFromBreakdown(script: ScriptElement[], breakdown: BreakdownItem[]): ScriptMark[] {
  const marks: ScriptMark[] = [];
  const tagFromDept = (dept: string): MarkTag | null => {
    const d = dept.toLowerCase();
    if (/cast|character/.test(d)) return "cast";
    if (/extra/.test(d)) return "extras";
    if (/prop/.test(d)) return "prop";
    if (/dress|set/.test(d)) return "dressing";
    if (/wardrobe|costume/.test(d)) return "wardrobe";
    if (/makeup|hair/.test(d)) return "makeup";
    if (/vehicle|car/.test(d)) return "vehicle";
    if (/animal/.test(d)) return "animal";
    if (/stunt/.test(d)) return "stunt";
    if (/vfx/.test(d)) return "vfx";
    if (/sfx|effect/.test(d)) return "sfx";
    if (/sound|audio/.test(d)) return "sound";
    if (/music|score/.test(d)) return "music";
    if (/equip|camera|gear/.test(d)) return "equipment";
    if (/location|place/.test(d)) return "location";
    return null;
  };
  for (const row of breakdown) {
    const tag = tagFromDept(row.department);
    if (!tag) continue;
    const needle = row.item.trim();
    if (!needle) continue;
    for (const el of script) {
      if (el.kind === "character" && tag === "cast") continue;
      if (el.kind === "scene" && tag === "location") continue;
      const span = findSpan(el.text, needle);
      if (!span) continue;
      marks.push({
        id: uid("mk"),
        tag,
        text: el.text.slice(span.start, span.end),
        note: row.notes || "",
        elementId: el.id,
        start: span.start,
        end: span.end,
        sceneId: sceneIdOf(script, el.id),
      });
      break;
    }
  }
  return marks;
}

function keyOf(m: Pick<ScriptMark, "elementId" | "start" | "end" | "tag">): string {
  return `${m.elementId}:${m.tag}:${m.start}:${m.end}`;
}

export function mergeMarks(...groups: ScriptMark[][]): ScriptMark[] {
  const byKey = new Map<string, ScriptMark>();
  for (const group of groups) {
    for (const m of group) {
      const k = `${keyOf(m)}:${m.note || ""}`;
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, m);
        continue;
      }
      byKey.set(k, {
        ...prev,
        ...m,
        id: prev.id,
        note: m.note || prev.note,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.elementId !== b.elementId) return a.elementId.localeCompare(b.elementId);
    return a.start - b.start;
  });
}

export function catalogGroups(project: Project): {
  tag: MarkTag;
  label: string;
  color: string;
  family: "steer" | "catalog";
  items: { key: string; text: string; note: string; marks: ScriptMark[] }[];
}[] {
  const buckets = new Map<MarkTag, ScriptMark[]>();
  for (const m of project.marks ?? []) {
    const list = buckets.get(m.tag) ?? [];
    list.push(m);
    buckets.set(m.tag, list);
  }
  const order = [...STEER_TAGS, ...CATALOG_TAGS];
  return order
    .filter((tag) => (buckets.get(tag) ?? []).length)
    .map((tag) => {
      const meta = markMeta(tag);
      const marks = buckets.get(tag) ?? [];
      const items = new Map<string, ScriptMark[]>();
      for (const m of marks) {
        const key = m.text.trim().toLowerCase();
        const list = items.get(key) ?? [];
        list.push(m);
        items.set(key, list);
      }
      return {
        tag,
        label: meta.label,
        color: meta.color,
        family: meta.family,
        items: [...items.entries()].map(([key, list]) => ({
          key,
          text: list[0]?.text.trim() || key,
          note: list.find((m) => m.note)?.note ?? "",
          marks: list,
        })),
      };
    });
}

export function breakdownFromMarks(marks: ScriptMark[]): BreakdownItem[] {
  const seen = new Map<string, BreakdownItem>();
  for (const m of marks) {
    if (!(CATALOG_TAGS as readonly string[]).includes(m.tag)) continue;
    const dept = departmentFor(m.tag);
    const item = m.text.trim();
    const k = `${dept.toLowerCase()}::${item.toLowerCase()}`;
    if (!item || seen.has(k)) continue;
    seen.set(k, {
      id: uid("bd"),
      department: dept,
      item,
      notes: m.note,
    });
  }
  return [...seen.values()];
}

export function reconcileMarks(oldText: string, newText: string, marks: ScriptMark[]): ScriptMark[] {
  if (oldText === newText) return marks;
  return marks.map((m) => {
      const snippet = m.anchorStatus ? m.text : oldText.slice(m.start, m.end) || m.text;
      if (!snippet) return { ...m, anchorStatus: "missing" as const };
      const at = newText.indexOf(snippet);
      if (at < 0) return { ...m, anchorStatus: "missing" as const };
      if (newText.indexOf(snippet, at + 1) >= 0) return { ...m, anchorStatus: "ambiguous" as const };
      const { anchorStatus: _status, ...anchored } = m;
      return { ...anchored, text: snippet, start: at, end: at + snippet.length };
    });
}

export function describeMarkLanguage(): string {
  return `Slate direction marks wrap a span of script:
[[lock]]text[[/]]  [[eyeline:Rusty]]His eyes[[/]]  <!-- @no extra patrons -->nobody else<!-- /@ -->

STEER (AI video direction):
${STEER_TAGS.map((t) => `- ${t}: ${STEER_META[t].hint}`).join("\n")}

CATALOG (production breakdown):
${CATALOG_TAGS.map((t) => `- ${t}: ${CATALOG_META[t].hint}`).join("\n")}`;
}

export function ensureMarks(project: Project): Project {
  const peeled: ScriptMark[] = [];
  const script = project.script.map((el) => {
    const { text, marks } = peelMarks(el.text);
    if (marks.length) peeled.push(...attachPeeled(el.id, sceneIdOf(project.script, el.id), marks));
    return text === el.text ? el : { ...el, text };
  });
  const existing = project.marks ?? [];
  const seeded =
    existing.length || peeled.length
      ? mergeMarks(existing, peeled)
      : mergeMarks(
          seedCastMarks(script),
          seedLocationMarks(script),
          seedFromBreakdown(script, project.breakdown ?? []),
        );
  const marks = seeded.map((m) => ({
    ...m,
    sceneId: m.sceneId ?? sceneIdOf(script, m.elementId),
    start: Number.isFinite(m.start) ? m.start : 0,
    end: Number.isFinite(m.end) ? m.end : m.text.length,
  }));
  let breakdown = project.breakdown ?? [];
  if (!breakdown.length) breakdown = breakdownFromMarks(marks);
  return reconcileProductionCatalog({ ...project, script, marks, breakdown });
}
