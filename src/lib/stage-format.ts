import { matchCharacter } from "./cast";
import { categoryForItem, defaultItemSize, figuresForShot, SET_KINDS, type FloorCategory } from "./floor";
import { resolveCatalogIdentity } from "./production-catalog";
import { validateSnapshotProject } from "./slate-snapshot";
import { FLOOR_KINDS, type FloorItem, type FloorKind, type Project } from "./types";

/** Catalog vocabulary describes identity; floor kinds describe drawable shapes. */
export function catalogFloorKind(tag?: string): FloorKind {
  return (FLOOR_KINDS as readonly string[]).includes(tag ?? "") ? tag as FloorKind : "rect";
}
export function stageItemCategory(project: Project, item: FloorItem): FloorCategory {
  const entry = item.productionItemId ? resolveCatalogIdentity(project, item.productionItemId) : null;
  return entry && ["prop", "dressing"].includes(entry.tag ?? "") ? "furniture" : categoryForItem(item.kind);
}
export function stageItemLocked(project: Project, item: FloorItem, locked: ReadonlySet<FloorCategory>): boolean {
  return Boolean(item.locked || locked.has(stageItemCategory(project, item)));
}
export function floorLinkDiagnostics(project: Project, item: FloorItem): string[] {
  const errors: string[] = [];
  const catalog = item.productionItemId ? resolveCatalogIdentity(project, item.productionItemId) : null;
  const mark = item.markId ? project.marks.find((entry) => entry.id === item.markId) : null;
  if (item.productionItemId && !catalog) errors.push(`Catalog link ${item.productionItemId} is unresolved; reconnect it in the Production Book.`);
  if (item.markId && !mark) errors.push(`Script mark ${item.markId} is unresolved; choose a current occurrence.`);
  const markCatalog = mark?.productionItemId ? resolveCatalogIdentity(project, mark.productionItemId) : null;
  if (mark?.productionItemId && !markCatalog) errors.push(`The linked mark has an unresolved catalog identity ${mark.productionItemId}.`);
  if (catalog && markCatalog && catalog.id !== markCatalog.id) errors.push("The occurrence and direct catalog links refer to different items; reconnect the occurrence.");
  return errors;
}
export function linkFloorMark(project: Project, item: FloorItem, markId: string | null): FloorItem {
  if (markId === null) return { ...item, markId: undefined };
  const mark = project.marks.find((entry) => entry.id === markId);
  if (!mark) throw new Error("Stage: this script mark no longer exists. Select a current occurrence.");
  const next = { ...item, markId, productionItemId: item.productionItemId ?? mark.productionItemId };
  const diagnostics = floorLinkDiagnostics(project, next);
  if (diagnostics.length) throw new Error(`Stage: ${diagnostics.join(" ")}`);
  return next;
}

/** Validate a same-Project drag completely before history capture or store writes. */
export function prepareStageDrop(project: Project, expectedProjectId: string, shotId: string | null, raw: string, point: {x:number;y:number}, itemId: string) {
  if (project.id !== expectedProjectId) throw new Error("Stage: the Project changed during the drag. Drag the item again.");
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { throw new Error("Stage: this drop is not valid production data."); }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.projectId !== project.id) throw new Error("Stage: drag an item from the current Project's Production Book.");
  if (![point.x,point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Stage: invalid placement coordinates.");
  const shot = project.shots.find((entry) => entry.id === shotId);
  if (shotId && !shot) throw new Error("Stage: the selected setup no longer exists.");
  if (data.type === "cast") {
    if (!shot || typeof data.name !== "string" || typeof data.id !== "string") throw new Error("Stage: choose a setup and a saved cast member.");
    const person = project.characters.find((entry) => entry.name === data.name);
    if (!person || data.id !== person.name.toLowerCase().replace(/\s+/g,"-")) throw new Error("Stage: save this cast member in the current Production Book before placing them.");
    const figures = figuresForShot(project.floor,shot);
    const named = figures.filter((figure) => (matchCharacter(project.characters, figure.name)?.name ?? figure.name) === person.name);
    if (named.length > 1) throw new Error("Stage: multiple figures match this cast member. Select the intended figure on the plan instead.");
    const existing = named[0];
    const conflicting = figures.find((figure) => figure.id === data.id && figure.id !== existing?.id);
    if (conflicting) throw new Error("Stage: this figure ID belongs to another cast member.");
    const figureId = existing?.id ?? data.id;
    const next = existing ? figures.map((figure) => figure.id === figureId ? {...figure,...point} : figure) : [...figures,{id:figureId,name:person.name,...point,facing:90}];
    validateSnapshotProject({...project,shots:project.shots.map((entry) => entry.id === shot.id ? {...entry,blocking:{figures:next}} : entry)});
    return {kind:"figure" as const,id:figureId,shotId:shot.id,figures:next};
  }
  if (data.type !== "prop" && data.type !== "item") throw new Error("Stage: unsupported drop type.");
  if (typeof data.kind !== "string" || !(FLOOR_KINDS as readonly string[]).includes(data.kind)) throw new Error("Stage: unsupported floor shape. Drag the item again from the Production Book.");
  for (const key of ["productionItemId","markId"]) if (data[key] !== undefined && (typeof data[key] !== "string" || !data[key])) throw new Error(`Stage: invalid ${key}.`);
  if (typeof data.label !== "string") throw new Error("Stage: this item needs a label.");
  const kind = data.kind as FloorKind, size = defaultItemSize(kind);
  const catalog = data.productionItemId ? resolveCatalogIdentity(project,String(data.productionItemId)) : null;
  if (data.productionItemId && !catalog) throw new Error("Stage: the catalog item no longer exists. Reopen the Production Book.");
  const item: FloorItem = {id:itemId,kind,...point,...size,rotation:0,label:data.label,shotId:SET_KINDS.has(kind)?null:shotId,
    ...(catalog ? {productionItemId:catalog.id} : {}),...(data.markId ? {markId:String(data.markId)} : {})};
  const errors = floorLinkDiagnostics(project,item); if (errors.length) throw new Error(`Stage: ${errors.join(" ")}`);
  if (project.floor.items.some((entry) => entry.id === itemId)) throw new Error("Stage: placement ID already exists; retry the drop.");
  const items = [...project.floor.items,item];validateSnapshotProject({...project,floor:{...project.floor,items}});
  return {kind:"item" as const,id:itemId,items};
}
