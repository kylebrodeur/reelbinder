import { CATALOG_TAGS, type BreakdownItem, type CatalogTag, type Project, type ProductionItemOverride, type ProductionScope, type ScriptMark } from "./types";

const departments: Record<CatalogTag, string> = {
  cast: "Cast", extras: "Extras", prop: "Props", dressing: "Set dressing", wardrobe: "Wardrobe",
  makeup: "Makeup", vehicle: "Vehicles", animal: "Animals", stunt: "Stunts", sfx: "SFX",
  vfx: "VFX", music: "Music", equipment: "Equipment", location: "Locations",
};
export function productionName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function catalogTag(department: string): CatalogTag | undefined {
  const name = productionName(department);
  const exact = (CATALOG_TAGS as readonly CatalogTag[]).find((tag) => name === tag || name === productionName(departments[tag]));
  if (exact) return exact;
  const aliases: Record<string, CatalogTag> = { character: "cast", characters: "cast", costume: "wardrobe", costumes: "wardrobe", hair: "makeup", "set decoration": "dressing", "special effects": "sfx", "visual effects": "vfx", gear: "equipment", place: "location" };
  return aliases[name];
}
function category(item: BreakdownItem): string { return item.tag ?? catalogTag(item.department) ?? productionName(item.department); }
function isCatalog(mark: ScriptMark): boolean { return (CATALOG_TAGS as readonly string[]).includes(mark.tag); }
export function productionItemId(projectId: string, tag: string, initialName: string): string {
  return `pi:${encodeURIComponent(projectId)}:${encodeURIComponent(tag)}:${encodeURIComponent(productionName(initialName))}`;
}
export function productionScopeKey(scope: ProductionScope): string { return `${scope.kind}:${scope.id}`; }
/** JSONL and full snapshots share one strict metadata reader; malformed new records fail closed. */
export function productionItemMetadata(value: Record<string, unknown>): Partial<BreakdownItem> {
  const result: Partial<BreakdownItem> = {};
  const fail = (): never => { throw new Error("Invalid production item metadata."); };
  const strings = (input: unknown) => { if (!Array.isArray(input) || !input.every((entry) => typeof entry === "string")) return fail(); return input as string[]; };
  const record = (input: unknown): Record<string, unknown> => { if (!input || typeof input !== "object" || Array.isArray(input)) return fail(); return input as Record<string, unknown>; };
  const scope = (input: unknown): ProductionScope => { const entry = record(input); if (!["scene", "shot"].includes(String(entry.kind)) || typeof entry.id !== "string") return fail(); return { kind: entry.kind as ProductionScope["kind"], id: entry.id }; };
  if (value.tag !== undefined) { if (!(CATALOG_TAGS as readonly unknown[]).includes(value.tag)) fail(); result.tag = value.tag as CatalogTag; }
  if (value.aliases !== undefined) result.aliases = strings(value.aliases);
  if (value.mergedIds !== undefined) result.mergedIds = strings(value.mergedIds);
  if (value.overrides !== undefined) {
    if (!Array.isArray(value.overrides)) fail();
    result.overrides = (value.overrides as unknown[]).map((input) => { const entry = record(input); if (typeof entry.id !== "string" || typeof entry.notes !== "string") return fail(); return { id: entry.id, scope: scope(entry.scope), notes: entry.notes }; });
  }
  if (value.preservedNotes !== undefined) {
    if (!Array.isArray(value.preservedNotes)) fail();
    result.preservedNotes = (value.preservedNotes as unknown[]).map((input) => { const entry = record(input); if (typeof entry.sourceId !== "string" || typeof entry.notes !== "string") return fail(); return { sourceId: entry.sourceId, notes: entry.notes, ...(entry.scope !== undefined ? { scope: scope(entry.scope) } : {}) }; });
  }
  return result;
}
function overrideId(itemId: string, scope: ProductionScope): string { return `${itemId}:${scope.kind}:${encodeURIComponent(scope.id)}`; }
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
function allNotes(item: BreakdownItem): NonNullable<BreakdownItem["preservedNotes"]> {
  return [...(item.notes ? [{ sourceId: item.id, notes: item.notes, ...(item.sceneId ? { scope: { kind: "scene" as const, id: item.sceneId } } : {}) }] : []), ...(item.preservedNotes ?? [])];
}
function uniqueNotes(notes: NonNullable<BreakdownItem["preservedNotes"]>) {
  const seen = new Set<string>();
  return notes.filter((note) => { const key = JSON.stringify(note); if (seen.has(key)) return false; seen.add(key); return true; });
}
function sceneFor(project: Project, elementId: string): string | null {
  let scene: string | null = null;
  for (const element of project.script) { if (element.kind === "scene") scene = element.id; if (element.id === elementId) return scene; }
  return null;
}

/** Add identity links without rewriting authored labels, notes, IDs or screenplay spans. */
export function reconcileProductionCatalog(project: Project): Project {
  const items = [...(project.breakdown ?? [])];
  const byId = new Map<string, BreakdownItem>();
  for (const item of items) { byId.set(item.id, item); for (const id of item.mergedIds ?? []) byId.set(id, item); }
  let changed = false;
  const marks = (project.marks ?? []).map((mark) => {
    const element = project.script.find((entry) => entry.id === mark.elementId);
    let next = mark;
    if (!element && mark.anchorStatus !== "missing") next = { ...next, anchorStatus: "missing" };
    if (!isCatalog(mark)) { changed ||= next !== mark; return next; }
    let item = mark.productionItemId ? byId.get(mark.productionItemId) : undefined;
    if (item && category(item) !== mark.tag) item = undefined;
    if (!item) {
      const name = productionName(mark.text);
      const matches = items.filter((entry) => category(entry) === mark.tag && [entry.item, ...(entry.aliases ?? [])].some((label) => productionName(label) === name));
      item = matches.find((entry) => (entry.notes ?? "") === mark.note) ?? matches[0];
      if (!item && name) {
        const id = productionItemId(project.id, mark.tag, mark.text);
        item = { id, department: departments[mark.tag as CatalogTag], item: mark.text.trim(), tag: mark.tag as CatalogTag, notes: "" };
        items.push(item); byId.set(id, item); changed = true;
      }
    }
    if (item && next.productionItemId !== item.id) next = { ...next, productionItemId: item.id };
    changed ||= next !== mark;
    return next;
  });
  return changed ? { ...project, breakdown: items, marks } : project;
}

export function productionCatalog(project: Project) {
  const linked = reconcileProductionCatalog(project);
  return linked.breakdown.map((item) => {
    const marks = linked.marks.filter((mark) => mark.productionItemId === item.id);
    const sceneIds = unique([...(item.sceneId ? [item.sceneId] : []), ...marks.map((mark) => mark.sceneId ?? sceneFor(project, mark.elementId) ?? "")]);
    const shotIds = linked.shots.filter((shot) => marks.some((mark) => shot.elementIds.includes(mark.elementId))).map((shot) => shot.id);
    return { item, marks, sceneIds, shotIds, unresolved: marks.filter((mark) => mark.anchorStatus) };
  });
}

export interface ProductionMergeReview {
  fingerprint: string;
  targetId: string;
  sourceIds: string[];
  occurrenceCount: number;
  notes: NonNullable<BreakdownItem["preservedNotes"]>;
  conflicts: { key: string; scope: ProductionScope; choices: ProductionItemOverride[] }[];
}
export function previewProductionMerge(project: Project, targetId: string, sourceIds: string[]): ProductionMergeReview {
  const ids = unique(sourceIds).filter((id) => id !== targetId);
  if (!ids.length) throw new Error("Choose another production item to merge.");
  const target = project.breakdown.find((item) => item.id === targetId);
  const sources = ids.map((id) => project.breakdown.find((item) => item.id === id));
  if (!target || sources.some((item) => !item)) throw new Error("A production item no longer exists. Review the merge again.");
  const records = [target, ...sources as BreakdownItem[]];
  if (records.some((item) => category(item) !== category(target))) throw new Error("Items in different departments must remain separate.");
  const scopes = new Map<string, ProductionItemOverride[]>();
  for (const item of records) for (const override of item.overrides ?? []) {
    const key = productionScopeKey(override.scope); scopes.set(key, [...(scopes.get(key) ?? []), override]);
  }
  return {
    fingerprint: JSON.stringify(project), targetId, sourceIds: ids,
    occurrenceCount: project.marks.filter((mark) => [targetId, ...ids].includes(mark.productionItemId ?? "")).length,
    notes: uniqueNotes(records.flatMap(allNotes)),
    conflicts: [...scopes].filter(([, values]) => new Set(values.map((value) => value.notes)).size > 1).map(([key, choices]) => ({ key, scope: choices[0].scope, choices })),
  };
}
export function applyProductionMerge(project: Project, review: ProductionMergeReview, resolutions: Record<string, string> = {}): Project {
  if (JSON.stringify(project) !== review.fingerprint) throw new Error("The project changed. Review this merge again before applying it.");
  const fresh = previewProductionMerge(project, review.targetId, review.sourceIds);
  for (const conflict of fresh.conflicts) if (!(conflict.key in resolutions)) throw new Error("Choose the effective note for each conflicting scene or shot. All original notes will be kept.");
  const ids = new Set(fresh.sourceIds);
  const target = project.breakdown.find((item) => item.id === fresh.targetId)!;
  const sources = project.breakdown.filter((item) => ids.has(item.id));
  const records = [target, ...sources];
  const replacedIds = new Set(sources.flatMap((item) => [item.id, ...(item.mergedIds ?? [])]));
  const overrides = new Map<string, ProductionItemOverride>();
  const retained = [...fresh.notes];
  for (const item of records) for (const override of item.overrides ?? []) {
    const key = productionScopeKey(override.scope);
    const notes = Object.hasOwn(resolutions, key) ? resolutions[key] : (overrides.get(key)?.notes ?? override.notes);
    overrides.set(key, { id: overrideId(target.id, override.scope), scope: override.scope, notes });
    retained.push({ sourceId: item.id, notes: override.notes, scope: override.scope });
  }
  const merged: BreakdownItem = {
    ...target,
    aliases: unique([...(target.aliases ?? []), ...sources.flatMap((item) => [item.item, ...(item.aliases ?? [])])]).filter((label) => label !== target.item),
    mergedIds: unique([...(target.mergedIds ?? []), ...sources.flatMap((item) => [item.id, ...(item.mergedIds ?? [])])]),
    preservedNotes: uniqueNotes(retained),
    overrides: [...overrides.values()],
  };
  return reconcileProductionCatalog({ ...project,
    breakdown: project.breakdown.filter((item) => !ids.has(item.id)).map((item) => item.id === target.id ? merged : item),
    floor: { ...project.floor, items: project.floor.items.map((item) => replacedIds.has(item.productionItemId ?? "") ? { ...item, productionItemId: target.id } : item) },
    marks: project.marks.map((mark) => replacedIds.has(mark.productionItemId ?? "") ? { ...mark, productionItemId: target.id } : mark),
  });
}

export function editProductionItem(project: Project, id: string, patch: { item?: string; notes?: string }): Project {
  const item = project.breakdown.find((entry) => entry.id === id);
  if (!item) throw new Error("This production item no longer exists.");
  if (patch.item !== undefined && !patch.item.trim()) throw new Error("Give the global item a name.");
  const next = { ...item, ...patch,
    aliases: patch.item !== undefined && patch.item !== item.item ? unique([...(item.aliases ?? []), item.item]) : item.aliases,
    preservedNotes: patch.notes !== undefined && patch.notes !== item.notes && item.notes ? uniqueNotes([...(item.preservedNotes ?? []), { sourceId: id, notes: item.notes }]) : item.preservedNotes,
  };
  return { ...project, breakdown: project.breakdown.map((entry) => entry.id === id ? next : entry) };
}
export function setProductionOverride(project: Project, itemId: string, scope: ProductionScope, notes: string | null): Project {
  const item = project.breakdown.find((entry) => entry.id === itemId);
  if (!item) throw new Error("This production item no longer exists.");
  const exists = scope.kind === "scene" ? project.script.some((entry) => entry.id === scope.id && entry.kind === "scene") : project.shots.some((entry) => entry.id === scope.id);
  if (!exists) throw new Error("This scene or shot no longer exists.");
  const key = productionScopeKey(scope);
  const old = (item.overrides ?? []).filter((entry) => productionScopeKey(entry.scope) === key);
  const overrides = (item.overrides ?? []).filter((entry) => productionScopeKey(entry.scope) !== key);
  if (notes !== null) overrides.push({ id: overrideId(itemId, scope), scope, notes });
  const next = { ...item, overrides, preservedNotes: uniqueNotes([...(item.preservedNotes ?? []), ...old.filter((entry) => entry.notes !== notes).map((entry) => ({ sourceId: itemId, notes: entry.notes, scope }))]) };
  return { ...project, breakdown: project.breakdown.map((entry) => entry.id === itemId ? next : entry) };
}
export function resolveProductionItem(project: Project, itemId: string, context: { sceneId?: string | null; shotId?: string | null } = {}) {
  const item = project.breakdown.find((entry) => entry.id === itemId);
  if (!item) return null;
  const shot = context.shotId ? project.shots.find((entry) => entry.id === context.shotId) : undefined;
  const sceneId = context.sceneId ?? shot?.sceneId;
  const scene = item.overrides?.find((entry) => entry.scope.kind === "scene" && entry.scope.id === sceneId);
  const shotOverride = item.overrides?.find((entry) => entry.scope.kind === "shot" && entry.scope.id === context.shotId);
  return { item, scene, shot: shotOverride, notes: shotOverride?.notes ?? scene?.notes ?? item.notes ?? "", origin: shotOverride?.scope ?? scene?.scope ?? { kind: "global" as const, id: item.id } };
}

/** Resolve a retained historical alias without rewriting or discarding imported links. */
export function resolveCatalogIdentity(project: Pick<Project, "breakdown">, id: string): BreakdownItem | null {
  const matches = project.breakdown.filter((item) => item.id === id || item.mergedIds?.includes(id));
  return matches.length === 1 ? matches[0] : null;
}
