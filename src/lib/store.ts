import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { checkContinuity as baseContinuity } from "./continuity";
import { bindHistory, capture } from "./history";
import { draftsFromScript, hydrateProject, parseFountain, parseSlugline, sceneIdForElement } from "./fountain";
import { cameraForShot, linkSketchToBlocking } from "./floor";
import { elementsInRange, lineColorAt, nextSetup, sizeFromCamera, tightestCovering } from "./lining";
import { reconcileMarks, sceneIdOf } from "./marks";
import { preservedFieldIssues, refreshProjectPrompts } from "./prompts";
import { SAVE_KEY, saveStorage } from "./save";
import { createBlankProject, createSampleProject } from "./sample-project";
import {
  applyScriptReview as applyReviewedScript,
  narrativeForShot,
  refreshLinkedNarratives,
  synchronizeProductionDirections,
  synchronizeShotFraming,
  type ScriptReview,
} from "./script-linkage";
import { documentsToProject, isSlateText } from "./slate-md";
import type {
  Annotation,
  ContinuityIssue,
  FloorPlan,
  FrameKind,
  Project,
  ScriptElement,
  ScriptMark,
  Shot,
  ShotBlocking,
  SketchData,
  Target,
  VideoStatus,
  View,
  WorldLock,
} from "./types";
import { emptyShot, emptyWorld, VIEWS } from "./types";
import { uid } from "./utils";
import { eventsFromAnnotations, hydrateWorld, syncCoreEvents } from "./world";
import { applyProductionMerge, editProductionItem, reconcileProductionCatalog, setProductionOverride, type ProductionMergeReview } from "./production-catalog";
import type { ProductionScope } from "./types";
import { applyScriptCommentChange, type ScriptCommentChange } from "./script-comments";
import { applyPublicDemoMediaPolicy } from "./demo-media-provenance";

interface SlateState {
  hydrated: boolean;
  project: Project;
  selectedId: string | null;
  selectedElementId: string | null;
  selectedElementIds: string[];
  view: View;
  issues: ContinuityIssue[];
  setHydrated: (v: boolean) => void;
  setView: (v: View) => void;
  setTarget: (t: Target) => void;
  selectShot: (id: string | null) => void;
  selectElement: (id: string | null, mode?: "replace" | "toggle" | "range") => void;
  setSelection: (ids: string[]) => void;
  addMark: (mark: Omit<ScriptMark, "id" | "sceneId"> & { id?: string; sceneId?: string | null }) => void;
  removeMark: (id: string) => void;
  patchMark: (id: string, partial: Partial<ScriptMark>) => void;
  editProductionItem: (id: string, patch: { item?: string; notes?: string }) => { ok: true } | { ok: false; error: string };
  mergeProductionItems: (review: ProductionMergeReview, resolutions?: Record<string, string>) => { ok: true } | { ok: false; error: string };
  setProductionOverride: (itemId: string, scope: ProductionScope, notes: string | null) => { ok: true } | { ok: false; error: string };
  applyScriptCommentChange: (projectId: string, change: ScriptCommentChange) => { ok: true } | { ok: false; error: string };
  loadSample: () => void;
  newBoard: (partial?: Partial<Project>) => void;
  replaceProject: (project: Project) => void;
  patchProject: (partial: Partial<Project>) => void;
  patchWorld: (partial: Partial<WorldLock>) => void;
  patchFloor: (partial: Partial<FloorPlan>) => void;
  setBlocking: (shotId: string, blocking: ShotBlocking, opts?: { syncSketch?: boolean }) => void;
  importFountain: (text: string) => { ok: true; shots: number } | { ok: false; error: string };
  importSlate: (script: string, lining?: string) => { ok: true; shots: number } | { ok: false; error: string };
  patchElement: (id: string, partial: Partial<ScriptElement>) => void;
  addElement: (afterId: string | null, kind: ScriptElement["kind"]) => void;
  moveElement: (id: string, dir: -1 | 1) => void;
  reorderElements: (from: number, to: number) => void;
  moveElements: (ids: string[], toIndex: number) => void;
  boardElement: (elementId: string) => void;
  lineRange: (startId: string, endId: string, shotId?: string | null) => void;
  addShot: (afterId?: string | null) => void;
  deleteShot: (id: string) => void;
  duplicateShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  reorder: (from: number, to: number) => void;
  patchShot: (id: string, partial: Partial<Shot>) => { ok: true } | { ok: false; error: string };
  applyScriptReview: (review: ScriptReview) => { ok: true } | { ok: false; error: string };
  setSketch: (id: string, sketch: SketchData) => void;
  setAnnotations: (id: string, annotations: Annotation[]) => void;
  setFrame: (id: string, url: string | null, kind?: FrameKind) => void;
  setVideo: (
    id: string,
    partial: {
      videoUrl?: string | null;
      videoRequestId?: string | null;
      videoStatus?: VideoStatus;
    },
  ) => void;
  recheck: () => void;
}

function renumber(shots: Shot[]): Shot[] {
  return shots.map((s, i) => ({ ...s, number: i + 1 }));
}

function checkContinuity(project: Project): ContinuityIssue[] {
  return [...baseContinuity(project), ...preservedFieldIssues(project)];
}

function withPrompts(project: Project, previousProject?: Project): Project {
  project = applyPublicDemoMediaPolicy(project);
  const linked = refreshLinkedNarratives(synchronizeProductionDirections(project), undefined, previousProject);
  return refreshProjectPrompts(reconcileProductionCatalog(linked), previousProject);
}

function restoreLinkedProject(project: Project): Project {
  project = applyPublicDemoMediaPolicy(project);
  // Loading is not permission to regenerate saved narrative or model-tuning artifacts.
  // Unmarked differences are preserved and surfaced by preservedFieldIssues.
  return reconcileProductionCatalog(synchronizeProductionDirections(project));
}

function stamp(project: Project, label = "Edit", previousProject: Project = useSlate.getState().project): Pick<SlateState, "project" | "issues"> {
  capture(label);
  const next = withPrompts(project, previousProject);
  return { project: next, issues: checkContinuity(next) };
}

function coveringShot(project: Project, elementId: string): Shot | undefined {
  return tightestCovering(project, elementId);
}

function moveGroup(script: ScriptElement[], ids: string[], dir: -1 | 1): ScriptElement[] {
  const set = new Set(ids);
  const moving = script.filter((x) => set.has(x.id));
  if (!moving.length) return script;
  const rest = script.filter((x) => !set.has(x.id));
  const indices = script.map((x, i) => (set.has(x.id) ? i : -1)).filter((i) => i >= 0);
  const first = indices[0] ?? 0;
  const last = indices[indices.length - 1] ?? 0;
  if (dir < 0) {
    if (first <= 0) return script;
    const dest = script[first - 1];
    if (!dest) return script;
    const at = rest.findIndex((x) => x.id === dest.id);
    rest.splice(Math.max(0, at), 0, ...moving);
    return rest;
  }
  if (last >= script.length - 1) return script;
  const dest = script[last + 1];
  if (!dest) return script;
  const at = rest.findIndex((x) => x.id === dest.id);
  rest.splice(at + 1, 0, ...moving);
  return rest;
}

function placeGroup(script: ScriptElement[], ids: string[], toIndex: number): ScriptElement[] {
  const set = new Set(ids);
  const moving = script.filter((x) => set.has(x.id));
  if (!moving.length) return script;
  const rest = script.filter((x) => !set.has(x.id));
  const before = script.slice(0, Math.max(0, toIndex)).filter((x) => set.has(x.id)).length;
  const insertAt = Math.max(0, Math.min(rest.length, toIndex - before));
  rest.splice(insertAt, 0, ...moving);
  return rest;
}

function applyProject(project: Project, view: View = "script"): Partial<SlateState> {
  project = applyPublicDemoMediaPolicy(project);
  project = reconcileProductionCatalog(synchronizeProductionDirections(project));
  const selectedElementId =
    project.script.find((e) => e.kind === "action")?.id ?? project.script[0]?.id ?? null;
  return {
    project,
    selectedId: project.shots[0]?.id ?? null,
    selectedElementId,
    selectedElementIds: selectedElementId ? [selectedElementId] : [],
    issues: checkContinuity(project),
    view,
  };
}

const BLANK = withPrompts(createBlankProject());

export const useSlate = create<SlateState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      project: BLANK,
      selectedId: BLANK.shots[0]?.id ?? null,
      selectedElementId: BLANK.script.find((e) => e.kind === "action")?.id ?? null,
      selectedElementIds: BLANK.script.find((e) => e.kind === "action")
        ? [BLANK.script.find((e) => e.kind === "action")!.id]
        : [],
      view: "script",
      issues: checkContinuity(BLANK),
      setHydrated: (v) => set({ hydrated: v }),
      setView: (view) => set({ view }),
      setTarget: (target) => set((s) => stamp({ ...s.project, target }, "Change target")),
      selectShot: (id) =>
        set((s) => {
          const shot = s.project.shots.find((x) => x.id === id);
          return {
            selectedId: id,
            selectedElementId: shot?.elementIds[0] ?? shot?.sceneId ?? s.selectedElementId,
          };
        }),
      selectElement: (id, mode = "replace") =>
        set((s) => {
          if (!id) return { selectedElementId: null, selectedElementIds: [] };
          const script = s.project.script;
          let ids = s.selectedElementIds.filter((x) => script.some((e) => e.id === x));
          if (mode === "toggle") {
            ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
            if (!ids.length) ids = [id];
          } else if (mode === "range") {
            const anchor = s.selectedElementId ?? ids[0] ?? id;
            const a = script.findIndex((e) => e.id === anchor);
            const b = script.findIndex((e) => e.id === id);
            if (a >= 0 && b >= 0) {
              const lo = Math.min(a, b);
              const hi = Math.max(a, b);
              ids = script.slice(lo, hi + 1).map((e) => e.id);
            } else ids = [id];
          } else {
            ids = [id];
          }
          const current = s.project.shots.find((x) => x.id === s.selectedId);
          const stillCovers =
            current && (current.elementIds.includes(id) || current.sceneId === id);
          const shot = stillCovers ? current : coveringShot(s.project, id);
          return { selectedElementId: id, selectedElementIds: ids, selectedId: shot?.id ?? s.selectedId };
        }),
      setSelection: (ids) =>
        set((s) => ({
          selectedElementIds: ids,
          selectedElementId: ids[ids.length - 1] ?? null,
        })),
      addMark: (mark) =>
        set((s) => {
          const existing = s.project.marks.find((entry) => entry.elementId === mark.elementId && entry.tag === mark.tag && entry.start === mark.start && entry.end === mark.end && entry.note === (mark.note ?? ""));
          if (existing) return s;
          const sceneId = mark.sceneId ?? sceneIdOf(s.project.script, mark.elementId);
          const created: ScriptMark = {
            ...mark,
            id: mark.id || uid("mk"),
            tag: mark.tag,
            text: mark.text,
            note: mark.note ?? "",
            elementId: mark.elementId,
            start: mark.start,
            end: mark.end,
            sceneId,
          };
          const marks = [...(s.project.marks ?? []), created];
          return stamp({ ...s.project, marks }, "Mark");
        }),
      removeMark: (id) =>
        set((s) => stamp({ ...s.project, marks: (s.project.marks ?? []).filter((m) => m.id !== id) }, "Remove mark")),
      patchMark: (id, partial) =>
        set((s) => {
          const marks = (s.project.marks ?? []).map((m) => (m.id === id ? { ...m, ...partial } : m));
          return stamp({ ...s.project, marks }, "Edit mark");
        }),
      editProductionItem: (id, patch) => {
        try { const project = editProductionItem(get().project, id, patch); set(stamp(project, `Edit production item ${id}`)); return { ok: true }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The item could not be edited." }; }
      },
      mergeProductionItems: (review, resolutions) => {
        try { const project = applyProductionMerge(get().project, review, resolutions); set(stamp(project, `Merge production items ${review.targetId}`)); return { ok: true }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The merge could not be applied." }; }
      },
      setProductionOverride: (itemId, scope, notes) => {
        try { const project = setProductionOverride(get().project, itemId, scope, notes); set(stamp(project, `${notes === null ? "Reset" : "Edit"} production override ${itemId} ${scope.kind}:${scope.id}`)); return { ok: true }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The override could not be changed." }; }
      },
      applyScriptCommentChange: (projectId, change) => {
        try {
          const current = get().project;
          if (current.id !== projectId) return { ok: false, error: "The active project changed. Reopen this comment in its project." };
          const project = applyScriptCommentChange(current, change);
          if (project !== current) set(stamp(project, `Script comment ${change.kind} ${"threadId" in change ? change.threadId : change.thread.id}`));
          return { ok: true };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The comment could not be saved." }; }
      },
      loadSample: () => {
        capture("Load sample");
        set(applyProject(createSampleProject()));
      },
      newBoard: (partial) => {
        capture("New script");
        const project = withPrompts({ ...createBlankProject(), ...partial });
        set(applyProject(project));
      },
      replaceProject: (project) => {
        capture("Replace script");
        const next = restoreLinkedProject(hydrateProject(project));
        set(applyProject(next, get().view));
      },
      patchProject: (partial) =>
        set((s) => {
          capture(partial.characters ? "Edit cast" : "Edit script");
          // Editing the cut or its mix does not change screenplay or setup events.
          const editOnly = Object.keys(partial).every((key) =>
            key === "audioClips" || key === "timeline" || key === "cutUrl",
          );
          const merged = { ...s.project, ...partial };
          const project = editOnly ? merged : reconcileProductionCatalog(refreshLinkedNarratives(synchronizeProductionDirections(merged), undefined, s.project));
          const refresh =
            partial.style !== undefined ||
            partial.logline !== undefined ||
            partial.characters !== undefined ||
            partial.world !== undefined || partial.script !== undefined || partial.shots !== undefined;
          const next = refresh ? withPrompts(project, s.project) : { ...project, updatedAt: Date.now() };
          return { project: next, issues: checkContinuity(next) };
        }),
      patchWorld: (partial) =>
        set((s) => {
          capture("Edit world");
          const world = { ...(s.project.world ?? emptyWorld()), ...partial };
          const project = { ...s.project, world, updatedAt: Date.now() };
          const next = withPrompts(project, s.project);
          return { project: next, issues: checkContinuity(next) };
        }),
      patchFloor: (partial) =>
        set((s) => {
          const floor = { ...s.project.floor, ...partial };
          let shots = s.project.shots;
          if (partial.cameras) {
            shots = shots.map((shot) => {
              if (s.selectedId && shot.id !== s.selectedId) return shot;
              if (!shot.blocking?.figures?.length) return shot;
              return {
                ...shot,
                sketch: linkSketchToBlocking(shot.blocking.figures, cameraForShot(floor, shot), shot.sketch),
              };
            });
          }
          return stamp({ ...s.project, floor, shots }, "Edit plan");
        }),
      setBlocking: (shotId, blocking, opts) =>
        set((s) => {
          const shots = s.project.shots.map((shot) => {
            if (shot.id !== shotId) return shot;
            const next = { ...shot, blocking };
            if (opts?.syncSketch === false) return next;
            return {
              ...next,
              sketch: linkSketchToBlocking(blocking.figures, cameraForShot(s.project.floor, next), shot.sketch),
            };
          });
          return stamp({ ...s.project, shots }, "Edit plan");
        }),
      importFountain: (text) => {
        if (isSlateText(text)) return get().importSlate(text);
        const parsed = parseFountain(text);
        if (parsed.elements.length === 0) {
          return { ok: false as const, error: "No scenes or action found in that file." };
        }
        const drafted = draftsFromScript(parsed.elements, 12);
        const project = withPrompts({
          ...createBlankProject(),
          id: uid("proj"),
          name: parsed.title || "Untitled",
          logline: "",
          script: parsed.elements,
          shots: drafted,
          characters: parsed.elements
            .filter((e) => e.kind === "character")
            .reduce<{ name: string; look: string }[]>((acc, e) => {
              if (!acc.some((c) => c.name.toLowerCase() === e.text.toLowerCase())) {
                acc.push({ name: e.text.replace(/\s*\(.*\)/, ""), look: "" });
              }
              return acc;
            }, []),
        });
        capture("Import");
        set(applyProject(project));
        return { ok: true as const, shots: project.shots.length };
      },
      importSlate: (script, lining) => {
        const project = withPrompts(documentsToProject({ script, lining, id: uid("proj") }));
        if (project.script.length === 0) {
          return { ok: false as const, error: "No scenes or action found in that project file." };
        }
        capture("Import");
        set(applyProject(project));
        return { ok: true as const, shots: project.shots.length };
      },
      patchElement: (id, partial) =>
        set((s) => {
          const prev = s.project.script.find((e) => e.id === id);
          const script = s.project.script.map((el) => (el.id === id ? { ...el, ...partial } : el));
          const el = script.find((e) => e.id === id);
          let shots = s.project.shots;
          let marks = s.project.marks ?? [];
          if (prev && el && partial.text !== undefined) {
            marks = reconcileMarks(prev.text, el.text, marks.filter((m) => m.elementId === id)).concat(
              marks.filter((m) => m.elementId !== id),
            );
          }
          if (el?.kind === "scene" && (partial.text !== undefined || partial.kind !== undefined)) {
            const slug = parseSlugline(el.text);
            shots = shots.map((shot) => {
              if (!shot.elementIds.includes(id) && shot.sceneId !== id) return shot;
              return { ...shot, location: slug.location, timeOfDay: slug.timeOfDay };
            });
          }
          const project = refreshLinkedNarratives({ ...s.project, script, shots, marks }, [id], s.project);
          return stamp(project, "Edit script");
        }),
      addElement: (afterId, kind) =>
        set((s) => {
          const script = [...s.project.script];
          const idx = afterId ? script.findIndex((e) => e.id === afterId) : script.length - 1;
          const insertAt = idx >= 0 ? idx + 1 : script.length;
          const created: ScriptElement = {
            id: uid("el"),
            kind,
            text:
              kind === "scene"
                ? "INT. LOCATION - DAY"
                : kind === "character"
                  ? "NAME"
                  : kind === "transition"
                    ? "CUT TO:"
                    : "",
          };
          script.splice(insertAt, 0, created);
          return {
            ...stamp({ ...s.project, script }, "Add beat"),
            selectedElementId: created.id,
            selectedElementIds: [created.id],
          };
        }),
      moveElement: (id, dir) =>
        set((s) => {
          const ids = s.selectedElementIds.includes(id) ? s.selectedElementIds : [id];
          const script = moveGroup(s.project.script, ids, dir);
          return { ...stamp({ ...s.project, script }, "Move beat"), selectedElementId: id, selectedElementIds: ids };
        }),
      reorderElements: (from, to) =>
        set((s) => {
          const script = [...s.project.script];
          if (from < 0 || to < 0 || from >= script.length || to >= script.length) return s;
          const item = script[from];
          if (!item) return s;
          const ids = s.selectedElementIds.includes(item.id) ? s.selectedElementIds : [item.id];
          return stamp({ ...s.project, script: placeGroup(script, ids, to) }, "Move beat");
        }),
      moveElements: (ids, toIndex) =>
        set((s) => stamp({ ...s.project, script: placeGroup(s.project.script, ids, toIndex) }, "Move beat")),
      boardElement: (elementId) => {
        const s = get();
        const existing = coveringShot(s.project, elementId);
        if (existing) {
          set({ selectedId: existing.id, selectedElementId: elementId, view: s.view });
          return;
        }
        get().lineRange(elementId, elementId, null);
      },
      lineRange: (startId, endId, shotId) =>
        set((s) => {
          const covered = elementsInRange(s.project.script, startId, endId);
          if (!covered.length) return s;
          const elementIds = covered.map((e) => e.id);
          const sceneId = sceneIdForElement(s.project.script, startId);
          const scene = s.project.script.find((e) => e.id === sceneId);
          const slug = scene ? parseSlugline(scene.text) : { location: "", timeOfDay: "day" as const };
          const actionEl = covered.find((e) => e.kind === "action");
          const dlgEl = covered.find((e) => e.kind === "dialogue");
          const chars = [
            ...new Set(
              covered
                .map((e) => e.character || (e.kind === "character" ? e.text.replace(/\s*\(.*\)/, "") : ""))
                .filter(Boolean),
            ),
          ];
          if (shotId) {
            const shots = s.project.shots.map((shot) => {
              if (shot.id !== shotId) return shot;
              return {
                ...shot,
                elementIds,
                sceneId,
                location: slug.location || shot.location,
                timeOfDay: slug.timeOfDay || shot.timeOfDay,
                characters: chars.length ? chars : shot.characters,
              };
            });
            return {
              ...stamp({ ...s.project, shots }, "Line coverage"),
              selectedId: shotId,
              selectedElementId: startId,
            };
          }
          const prev = s.project.shots[s.project.shots.length - 1];
          const created = emptyShot({
            id: uid("shot"),
            number: s.project.shots.length + 1,
            setup: nextSetup(s.project, sceneId),
            coverageSize: sizeFromCamera(prev?.camera ?? "medium"),
            lineColor: lineColorAt(s.project.shots.length),
            title:
              dlgEl?.character ||
              actionEl?.text.split(/[.!?]/)[0]?.slice(0, 42) ||
              slug.location ||
              "New coverage",
            action: actionEl?.text ?? "",
            dialogue: dlgEl?.text ?? "",
            camera: prev?.camera ?? "medium",
            movement: "static",
            screenDirection: prev?.screenDirection ?? "static",
            durationSec: 6,
            timeOfDay: slug.timeOfDay || prev?.timeOfDay || "day",
            location: slug.location || prev?.location || "",
            characters: chars.length ? chars : prev?.characters ?? [],
            lighting: prev?.lighting ?? "natural, even",
            sceneId,
            elementIds,
            events: [],
          });
          Object.assign(created, narrativeForShot(s.project.script, created));
          created.events = syncCoreEvents(created);
          const shots = renumber([...s.project.shots, created]);
          const project = { ...s.project, shots };
          return {
            ...stamp(project, "Line coverage"),
            selectedId: created.id,
            selectedElementId: startId,
          };
        }),
      addShot: (afterId) =>
        set((s) => {
          const shots = [...s.project.shots];
          const idx = afterId ? shots.findIndex((x) => x.id === afterId) : shots.length - 1;
          const insertAt = idx >= 0 ? idx + 1 : shots.length;
          const prev = shots[insertAt - 1];
          const elementId = s.selectedElementId;
          const sceneId = elementId
            ? sceneIdForElement(s.project.script, elementId)
            : prev?.sceneId ?? null;
          const created = emptyShot({
            id: uid("shot"),
            number: insertAt + 1,
            setup: nextSetup({ ...s.project, shots }, sceneId),
            lineColor: lineColorAt(insertAt),
            title: "New shot",
            action: "",
            camera: prev?.camera ?? "medium",
            movement: "static",
            screenDirection: prev?.screenDirection ?? "static",
            durationSec: prev?.durationSec ?? 6,
            timeOfDay: prev?.timeOfDay ?? "day",
            location: prev?.location ?? "",
            characters: prev?.characters ?? [],
            lighting: prev?.lighting ?? "natural, even",
            sceneId,
            elementIds: elementId ? [elementId] : [],
          });
          shots.splice(insertAt, 0, created);
          const project = { ...s.project, shots: renumber(shots) };
          return { ...stamp(project, "Add setup"), selectedId: created.id };
        }),
      deleteShot: (id) =>
        set((s) => {
          const shots = s.project.shots.filter((x) => x.id !== id);
          const project = { ...s.project, shots: renumber(shots) };
          const selectedId =
            s.selectedId === id ? (shots[Math.max(0, shots.length - 1)]?.id ?? null) : s.selectedId;
          return { ...stamp(project, "Delete setup"), selectedId };
        }),
      duplicateShot: (id) =>
        set((s) => {
          const shots = [...s.project.shots];
          const idx = shots.findIndex((x) => x.id === id);
          if (idx < 0) return s;
          const copy: Shot = {
            ...structuredClone(shots[idx]),
            id: uid("shot"),
            title: `${shots[idx].title} copy`,
            setup: nextSetup(s.project, shots[idx].sceneId),
            lineColor: lineColorAt(idx + 1),
            frameUrl: null,
            videoUrl: null,
            videoRequestId: null,
            videoStatus: "idle",
          };
          shots.splice(idx + 1, 0, copy);
          const project = { ...s.project, shots: renumber(shots) };
          // The copy's previous generated values came from its source setup.
          const previous = { ...s.project, shots: [...s.project.shots, { ...s.project.shots[idx], id: copy.id }] };
          return { ...stamp(project, "Duplicate setup", previous), selectedId: copy.id };
        }),
      moveShot: (id, dir) =>
        set((s) => {
          const shots = [...s.project.shots];
          const idx = shots.findIndex((x) => x.id === id);
          const next = idx + dir;
          if (idx < 0 || next < 0 || next >= shots.length) return s;
          const [item] = shots.splice(idx, 1);
          shots.splice(next, 0, item);
          return stamp({ ...s.project, shots: renumber(shots) }, "Move setup");
        }),
      reorder: (from, to) =>
        set((s) => {
          const shots = [...s.project.shots];
          if (from < 0 || to < 0 || from >= shots.length || to >= shots.length) return s;
          const [item] = shots.splice(from, 1);
          shots.splice(to, 0, item);
          return stamp({ ...s.project, shots: renumber(shots) }, "Move setup");
        }),
      applyScriptReview: (review) => {
        const result = applyReviewedScript(get().project, review);
        if (!result.ok) return result;
        set(stamp(result.project, "Apply screenplay edits"));
        return { ok: true as const };
      },
      patchShot: (id, partial) => {
        const current = get().project;
        const original = current.shots.find((shot) => shot.id === id);
        if (!original) return { ok: false as const, error: "Select an existing setup." };
        if ((partial.action !== undefined || partial.dialogue !== undefined) && original.elementIds.some((elementId) => current.script.some((element) => element.id === elementId))) {
          return { ok: false as const, error: "Review the linked screenplay beats before changing action or dialogue." };
        }
        set((s) => {
          if (partial.notes !== undefined && Object.keys(partial).every((key) => key === "notes")) {
            // Notes inform generated prompts without rewriting saved story events.
            capture("Edit setup");
            const project = {
              ...s.project,
              shots: s.project.shots.map((shot) => shot.id === id ? { ...shot, ...partial } : shot),
            };
            const next = refreshProjectPrompts(project, s.project);
            return { project: next, issues: checkContinuity(next) };
          }
          const shots = s.project.shots.map((shot) => {
            if (shot.id !== id) return shot;
            const next = synchronizeShotFraming(shot, partial);
            if (!partial.events) next.events = syncCoreEvents(next);
            return next;
          });
          return stamp({ ...s.project, shots }, "Edit setup");
        });
        return { ok: true as const };
      },
      setSketch: (id, sketch) =>
        set((s) => {
          const shots = s.project.shots.map((shot) => (shot.id === id ? { ...shot, sketch } : shot));
          return stamp({ ...s.project, shots }, "Draw frame");
        }),
      setAnnotations: (id, annotations) =>
        set((s) => {
          const shots = s.project.shots.map((shot) => {
            if (shot.id !== id) return shot;
            const extras = eventsFromAnnotations({ ...shot, annotations }, annotations);
            const next = {
              ...shot,
              annotations,
              events: syncCoreEvents({
                ...shot,
                annotations,
                events: [...(shot.events ?? []), ...extras],
              }),
            };
            return next;
          });
          return stamp({ ...s.project, shots }, "Mark frame");
        }),
      setFrame: (id, url, kind) =>
        set((s) => {
          const shots = s.project.shots.map((shot) =>
            shot.id === id
              ? { ...shot, frameUrl: url, frameKind: kind ?? shot.frameKind }
              : shot,
          );
          return stamp({ ...s.project, shots }, "Set still");
        }),
      setVideo: (id, partial) =>
        set((s) => {
          const shots = s.project.shots.map((shot) =>
            shot.id === id ? { ...shot, ...partial } : shot,
          );
          return { project: { ...s.project, shots, updatedAt: Date.now() } };
        }),
      recheck: () => set((s) => ({ issues: checkContinuity(s.project) })),
    }),
    {
      name: SAVE_KEY,
      version: 13,
      skipHydration: true,
      storage: createJSONStorage(() => saveStorage as unknown as Storage),
      partialize: (s) => ({
        project: s.project,
        selectedId: s.selectedId,
        selectedElementId: s.selectedElementId,
        view: s.view,
      }),
      migrate: (persisted) => {
        const p = persisted as Partial<SlateState> | undefined;
        const projectRaw = p?.project;
        // Missing Project data starts blank. Persisted filmmaker data follows the
        // restoration branch below and is never replaced by changing demo content.
        if (!projectRaw) {
          return {
            project: BLANK,
            selectedId: BLANK.shots[0]?.id ?? null,
            selectedElementId:
              BLANK.script.find((e) => e.kind === "action")?.id ?? BLANK.script[0]?.id ?? null,
            selectedElementIds: BLANK.script.find((e) => e.kind === "action")
              ? [BLANK.script.find((e) => e.kind === "action")!.id]
              : [],
            view: "script" as View,
          };
        }
        const project = restoreLinkedProject(hydrateWorld(hydrateProject(projectRaw)));
        const selectedId =
          p.selectedId && project.shots.some((s) => s.id === p.selectedId)
            ? p.selectedId
            : (project.shots[0]?.id ?? null);
        const selectedElementId =
          p.selectedElementId && project.script.some((e) => e.id === p.selectedElementId)
            ? p.selectedElementId
            : (project.script.find((e) => e.kind === "action")?.id ?? null);
        return {
          project,
          selectedId,
          selectedElementId,
          selectedElementIds: selectedElementId ? [selectedElementId] : [],
          view: "script" as View,
        };
      },
      merge: (persisted, current) => {
        const p = persisted as Partial<SlateState> | undefined;
        if (!p?.project) return current;
        const project = restoreLinkedProject(hydrateWorld(hydrateProject(p.project)));
        const rawView = p.view as string | undefined;
        const mapped =
          rawView === "board" || rawView === "world" || rawView === "graph"
            ? "script"
            : rawView === "prompts" || rawView === "play"
              ? "edit"
              : rawView;
        const view = mapped && (VIEWS as readonly string[]).includes(mapped) ? (mapped as View) : "script";
        const selectedId =
          p.selectedId && project.shots.some((s) => s.id === p.selectedId)
            ? p.selectedId
            : (project.shots[0]?.id ?? null);
        const selectedElementId =
          p.selectedElementId && project.script.some((e) => e.id === p.selectedElementId)
            ? p.selectedElementId
            : (project.script.find((e) => e.kind === "action")?.id ??
              project.script[0]?.id ??
              null);
        return {
          ...current,
          project,
          view,
          selectedId,
          selectedElementId,
          selectedElementIds: selectedElementId ? [selectedElementId] : [],
          issues: checkContinuity(project),
        };
      },
    },
  ),
);

bindHistory({
  take: () => {
    const s = useSlate.getState();
    return {
      project: structuredClone(s.project),
      selectedId: s.selectedId,
      selectedElementId: s.selectedElementId,
      selectedElementIds: [...s.selectedElementIds],
      view: s.view,
    };
  },
  put: (snap) => {
    const project = applyPublicDemoMediaPolicy(snap.project);
    useSlate.setState({
      project,
      selectedId: snap.selectedId,
      selectedElementId: snap.selectedElementId,
      selectedElementIds: snap.selectedElementIds,
      view: snap.view,
      issues: checkContinuity(project),
    });
  },
});
