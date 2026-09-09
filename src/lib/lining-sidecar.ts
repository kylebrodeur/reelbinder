import { floorLinkDiagnostics } from "./stage-format";
import type { Project, Shot } from "./types";
import { emptyShot } from "./types";
import { validateSnapshotProject } from "./slate-snapshot";
import { validateScriptCommentThreads } from "./script-comments";
import { effectiveScriptElementIds } from "./coverage-edit";
import { DEFAULT_CHAIN, DEFAULT_SKILLS } from "./prompt-chain";

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
function fail(message: string): never { throw new Error(`Lining sidecar: ${message}`); }
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) fail(`${label} requires a stable, nonempty ID.`);
  return value;
}
function unique(rows: Row[], key: string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) { const value = id(row[key], label); if (seen.has(value)) fail(`duplicate ${label} ${value}.`); seen.add(value); }
}
/** Nested identified collections are additive updates, never implicit deletions. */
function merge(base: unknown, update: unknown): unknown {
  if (Array.isArray(update)) {
    const old = Array.isArray(base) ? base : [];
    if (update.every(object) && update.every((row) => typeof row.id === "string")) {
      unique(update, "id", "nested record");
      const result = structuredClone(old) as Row[];
      for (const row of update) {
        const index = result.findIndex((item) => item.id === row.id);
        if (index < 0) result.push(structuredClone(row)); else result[index] = merge(result[index], row) as Row;
      }
      return result;
    }
    return [...old, ...update].filter((item, index, values) => values.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);
  }
  if (object(update)) {
    const result: Row = object(base) ? structuredClone(base) : {};
    for (const [key, value] of Object.entries(update)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail(`unsupported field ${key}.`);
      result[key] = merge(result[key], value);
    }
    return result;
  }
  return update;
}
function fields(row: Row, allowed: string[]) {
  for (const key of Object.keys(row)) if (key !== "kind" && !allowed.includes(key)) fail(`unsupported ${String(row.kind)} field ${key}; use a complete ReelBinder project archive for full Project state.`);
}
function aliases(row: Row, canonical: string, alternatives: string[]) {
  for (const name of alternatives) if (name in row) {
    if (canonical in row && JSON.stringify(row[canonical]) !== JSON.stringify(row[name])) fail(`conflicting ${canonical}/${name} values.`);
    row[canonical] = row[name]; delete row[name];
  }
}
function upsert(list: Row[], row: Row, key = "id") {
  const index = list.findIndex((item) => item[key] === row[key]);
  if (index < 0) list.push(structuredClone(row)); else list[index] = merge(list[index], row) as Row;
}
function sameMedia(previous: unknown, incoming: unknown, label: string) {
  if (incoming !== previous && !(incoming == null && previous == null)) fail(`${label} cannot replace media without its provenance. Import media or a complete ReelBinder project archive instead.`);
}

/** Apply production metadata to the existing film, rather than reimporting its script.
 * Omitted records/fields are retained. Media replacement and deletion are deliberately
 * separate UI operations. Validation is atomic: the caller receives no partial result.
 */
function apply(project: Project, text: string): Project {
  const rows: Row[] = [];
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { fail(`line ${index + 1} is malformed JSON; correct this line and retry.`); }
    if (!object(row)) fail(`line ${index + 1} must contain one JSON object.`);
    rows.push(row);
  }
  if (!rows.length) fail("no production records found; choose a lining JSONL file.");
  const result = structuredClone(project);
  unique(project.script as unknown as Row[], "id", "script element");
  unique(project.shots as unknown as Row[], "id", "shot");
  unique(project.shots as unknown as Row[], "setup", "setup");
  for (const [label, list] of Object.entries({ mark: project.marks, reference: project.binder, catalog: project.breakdown, skill: project.skills, comment: project.scriptCommentThreads ?? [] })) unique(list as unknown as Row[], "id", label);
  const seen = new Set<string>();
  const touchedMarks = new Set<string>(), touchedThreads = new Set<string>();
  const anchor = (value: unknown) => {
    const index = project.script.findIndex((element) => element.id === value);
    if (index < 0) fail(`anchor ${String(value)} does not exist in the current script. Use its exact element ID.`);
    return index;
  };
  const scene = (value: unknown) => { if (value != null && project.script[anchor(value)].kind !== "scene") fail(`${String(value)} is not a scene anchor.`); };
  for (const original of rows) {
    const row = structuredClone(original); const kind = row.kind === "shot" ? "line" : String(row.kind ?? "line"); row.kind = kind;
    let identity: string = kind;
    if (kind === "line") {
      if (row.id !== undefined) identity += `:${id(row.id, "shot")}`;
      else { const existing = result.shots.find((shot) => shot.setup === row.setup); if (!existing) fail("new coverage requires an id and setup."); row.id = existing.id; identity += `:${existing.id}`; }
    } else if (["mark", "ref", "breakdown", "skill"].includes(kind)) identity += `:${id(row.id, kind)}`;
    else if (kind === "cast") identity += `:${id(row.name, "cast name").toLowerCase()}`;
    else if (kind === "script-comment") { if (!object(row.thread)) fail("script-comment requires a thread object."); identity += `:${id(row.thread.id, "comment thread")}`; }
    if (seen.has(identity)) fail(`duplicate ${identity} record.`); seen.add(identity);
    if (kind === "line") {
      aliases(row, "from", ["start"]); aliases(row, "to", ["end"]); aliases(row, "note", ["notes"]); aliases(row, "frame", ["frameUrl"]);
      fields(row, ["id", "setup", "from", "to", "size", "color", "title", "note", "camera", "movement", "duration", "action", "dialogue", "characters", "lighting", "stamps", "sketch", "frame", "blocking"]);
      const old = result.shots.find((shot) => shot.id === row.id);
      const setup = row.setup ?? old?.setup; id(setup, "setup");
      if (typeof setup !== "string" || !/^[A-Za-z0-9]+$/.test(setup)) fail("setup must be alphanumeric.");
      if (old && setup !== old.setup) fail(`shot ${old.id} already belongs to setup ${old.setup}; rename it in the app.`);
      if (result.shots.some((shot) => shot.setup.toLowerCase() === setup.toLowerCase() && shot.id !== row.id)) fail(`setup ${setup} already has a different stable shot ID.`);
      const shot = old ?? emptyShot({ id: String(row.id), setup, number: result.shots.length + 1 });
      for (const endpoint of ["from", "to"]) if (endpoint in row) {
        if (typeof row[endpoint] !== "string" || !row[endpoint].trim()) fail(`coverage ${setup} ${endpoint} must be an exact nonempty script element ID; omit it to retain the current endpoint.`);
        anchor(row[endpoint]);
      }
      if (!old || "from" in row || "to" in row) {
        const from = row.from ?? old?.elementIds[0], to = row.to ?? old?.elementIds.at(-1);
        const a = anchor(from), b = anchor(to);
        if (a > b) fail(`coverage ${setup} has reversed from/to anchors.`);
        shot.elementIds = project.script.slice(a, b + 1).map((element) => element.id);
        shot.sceneId = project.script.slice(0, a + 1).reverse().find((element) => element.kind === "scene")?.id ?? null;
        if (shot.coverageRole === "master" || (shot.id === "bh_1a" && !shot.coverageRole)) shot.elementIds = effectiveScriptElementIds(result, shot);
      }
      const mapping: Record<string, keyof Shot> = {size:"coverageSize",color:"lineColor",title:"title",note:"notes",camera:"camera",movement:"movement",duration:"durationSec",action:"action",dialogue:"dialogue",characters:"characters",lighting:"lighting"};
      for (const [key, target] of Object.entries(mapping)) if (key in row) (shot as unknown as Row)[target] = merge((shot as unknown as Row)[target], row[key]);
      if ("frame" in row) sameMedia(shot.frameUrl, row.frame, `setup ${setup} frame`);
      if ("sketch" in row) {
        if (!object(row.sketch)) fail("sketch must be an object."); fields(row.sketch, ["stamps"]);
        if ("stamps" in row && JSON.stringify(row.stamps) !== JSON.stringify(row.sketch.stamps)) fail("conflicting stamps/sketch values.");
        row.stamps = row.sketch.stamps;
      }
      if ("stamps" in row) { if (!Array.isArray(row.stamps)) fail("stamps must be an array."); shot.sketch.stamps = merge(shot.sketch.stamps, row.stamps) as Shot["sketch"]["stamps"]; }
      if ("blocking" in row) { if (!object(row.blocking)) fail("blocking must be an object."); fields(row.blocking, ["figures"]); shot.blocking = merge(shot.blocking, row.blocking) as Shot["blocking"]; }
      if (!old) result.shots.push(shot);
    } else if (kind === "production_catalog") {
      fields(row, ["version"]); if (row.version !== 1) fail("unsupported production catalog version.");
    } else if (kind === "world") {
      fields(row, ["place", "lighting", "ambience", "laws"]); delete row.kind; result.world = merge(result.world, row) as Project["world"];
    } else if (kind === "meta") {
      fields(row, ["name", "cut"]); if ("cut" in row) sameMedia(result.cutUrl, row.cut, "finished cut"); if ("name" in row) result.name = row.name as string;
    } else if (kind === "cast") {
      aliases(row, "aliases", ["also", "aka"]);
      if (typeof row.aliases === "string") row.aliases = row.aliases.split(",").map((value) => value.trim()).filter(Boolean);
      fields(row, ["name", "look", "voice", "start", "aliases"]); delete row.kind;
      const existing = result.characters.find((person) => person.name.toLowerCase() === String(row.name).toLowerCase());
      if (existing) row.name = existing.name; else row.look ??= "";
      upsert(result.characters as unknown as Row[], row, "name");
    } else if (kind === "floor") {
      fields(row, ["label", "items", "cameras", "homes", "path"]); delete row.kind; result.floor = merge(result.floor, row) as Project["floor"];
    } else if (kind === "chain") {
      fields(row, ["ids"]); if (!Array.isArray(row.ids) || !row.ids.every((value) => typeof value === "string")) fail("chain ids must be strings.");
      if (new Set(row.ids).size !== row.ids.length) fail("duplicate chain IDs.");
      const ids = row.ids as string[];
      result.chain = [...ids, ...result.chain.filter((value) => !ids.includes(value))];
    } else if (kind === "script-comment") {
      fields(row, ["thread"]); const thread = row.thread as Row; touchedThreads.add(String(thread.id));
      result.scriptCommentThreads ??= []; upsert(result.scriptCommentThreads as unknown as Row[], thread);
    } else if (["mark", "ref", "breakdown", "skill"].includes(kind)) {
      const keys: Record<string, string[]> = {
        mark:["id","elementId","tag","text","note","start","end","sceneId","productionItemId","anchorStatus"],
        ref:["id","tab","title","url","caption","character"],
        breakdown:["id","department","item","notes","sceneId","tag","aliases","mergedIds","preservedNotes","overrides"],
        skill:["id","title","body"],
      };
      if (kind === "mark") { aliases(row,"elementId",["element"]); aliases(row,"sceneId",["scene"]); aliases(row,"note",["notes"]); touchedMarks.add(String(row.id)); }
      fields(row, keys[kind]); delete row.kind;
      const list = (kind === "mark" ? result.marks : kind === "ref" ? result.binder : kind === "breakdown" ? result.breakdown : result.skills) as unknown as Row[];
      const old = list.find((item) => item.id === row.id);
      if (kind === "ref" && old && "url" in row) sameMedia(old.url, row.url, `reference ${String(row.id)}`);
      if (!old && kind === "mark") { row.note ??= ""; row.sceneId ??= null; }
      upsert(list, row);
    } else fail(`unsupported record kind ${kind}.`);
  }
  // Validate collection shapes before traversing references so malformed metadata
  // reports its field path instead of causing an incidental iteration error.
  validateSnapshotProject(result);
  const quote = (elementId: unknown, start: unknown, end: unknown, text: unknown) => {
    const element = project.script[anchor(elementId)];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || (end as number) > element.text.length || typeof text !== "string" || element.text.slice(start as number,end as number) !== text) fail(`quote/range does not match script element ${element.id}; select the exact current text.`);
  };
  for (const mark of result.marks) if (touchedMarks.has(mark.id)) {
    quote(mark.elementId,mark.start,mark.end,mark.text); scene(mark.sceneId);
    const actualScene = project.script.slice(0, anchor(mark.elementId) + 1).reverse().find((element) => element.kind === "scene")?.id ?? null;
    if (mark.sceneId !== null && mark.sceneId !== actualScene) fail(`mark ${mark.id} scene ${mark.sceneId} contradicts element ${mark.elementId}, which belongs to ${actualScene ?? "no scene"}.`);
    if (mark.productionItemId && !result.breakdown.some((item) => item.id === mark.productionItemId)) fail(`mark ${mark.id} references missing catalog ID ${mark.productionItemId}.`);
  }
  for (const thread of result.scriptCommentThreads ?? []) if (touchedThreads.has(thread.id)) quote(thread.anchor?.elementId,thread.anchor?.start,thread.anchor?.end,thread.anchor?.quote);
  for (const item of result.breakdown) {
    scene(item.sceneId);
    for (const override of item.overrides ?? []) {
      if (override.scope.kind === "scene") scene(override.scope.id);
      else if (!result.shots.some((shot) => shot.id === override.scope.id)) fail(`catalog override references missing shot ${override.scope.id}.`);
    }
  }
  for (const item of [...result.floor.items, ...result.floor.cameras]) if (item.shotId && !result.shots.some((shot) => shot.id === item.shotId)) fail(`floor reference has missing shot ${item.shotId}.`);
  for (const camera of result.floor.cameras) {
    const shot = result.shots.find((entry) => entry.id === camera.shotId);
    if (!shot) fail(`floor camera ${camera.id} references missing shot ${camera.shotId}.`);
    if (camera.setup !== shot.setup) fail(`floor camera ${camera.id} setup ${camera.setup} contradicts shot ${shot.id} setup ${shot.setup}.`);
  }
  for (const row of rows) if (row.kind === "floor" && Array.isArray(row.items)) {
    for (const update of row.items) if (object(update)) {
      const next = result.floor.items.find((item) => item.id === update.id);
      const before = project.floor.items.find((item) => item.id === update.id);
      if (!next) continue;
      // Preserve an unchanged unresolved imported link; reject newly authored broken links.
      if (!before || next.markId !== before.markId || next.productionItemId !== before.productionItemId) {
        const diagnostics = floorLinkDiagnostics(result, next);
        if (diagnostics.length) fail(diagnostics.join(" "));
      }
    }
  }
  for (const item of result.floor.items) {
    const previous = project.floor.items.find((entry) => entry.id === item.id);
    const previousDiagnostics = previous ? floorLinkDiagnostics(project, previous) : [];
    const introduced = floorLinkDiagnostics(result, item).filter((message) => !previousDiagnostics.includes(message));
    if (introduced.length) fail(introduced.join(" "));
  }
  for (const skill of result.chain) if (!result.skills.some((item) => item.id === skill) && !DEFAULT_SKILLS.some((item) => item.id === skill) && !(DEFAULT_CHAIN as readonly string[]).includes(skill)) fail(`chain references missing skill ${skill}.`);
  try { if (result.scriptCommentThreads) validateScriptCommentThreads(result.scriptCommentThreads); }
  catch (error) { fail(error instanceof Error ? error.message : "invalid production metadata."); }
  return result;
}

export function applyLiningSidecar(project: Project, text: string): Project {
  try { return apply(project, text); }
  catch (error) {
    const message = error instanceof Error ? error.message : "invalid production metadata.";
    if (message.startsWith("Lining sidecar:")) throw error;
    fail(`Invalid production metadata: ${message}`);
  }
}
