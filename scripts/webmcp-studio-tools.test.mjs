import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

const toFileUrl = (value) => value.startsWith("file:") ? new URL(value) : pathToFileURL(value);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  },
});

const require = createRequire(import.meta.url);
const external = Object.fromEntries(
  ["clsx", "tailwind-merge"].map((name) => [name, require.resolve(name)]),
);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    }
    if (specifier === "jszip") specifier = "jszip/dist/jszip.min.js";
    if (external[specifier]) specifier = external[specifier];
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("?raw")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(readFileSync(toFileUrl(url.slice(0, -4)), "utf8"))}`,
      };
    }
    if (!url.endsWith(".ts")) return nextLoad(url.startsWith("file:") ? url : toFileUrl(url).href, context);
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(toFileUrl(url), "utf8"), { mode: "transform" }),
    };
  },
});

const { STUDIO_TOOLS, executeStudioTool } = await import("../src/lib/webmcp/studio-tools.ts");
const { useSlate } = await import("../src/lib/store.ts");
const { VIEWS, MARK_TAGS } = await import("../src/lib/types.ts");
const { applyUiPatch, inspectUiControls } = await import("../src/lib/webmcp/ui-json.ts");

hooks.deregister();

const SNAKE_CASE_RE = /^[a-zA-Z0-9_]+$/;

const EXPECTED = new Map([
  ["get_studio_state", { readOnlyHint: true, autoExecutable: true }],
  ["get_production_checks", { readOnlyHint: true, autoExecutable: true }],
  ["search_parallel", { readOnlyHint: true, autoExecutable: true }],
  ["get_ui_snapshot", { readOnlyHint: true, autoExecutable: false }],
  ["apply_ui_patch", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["get_script_outline", { readOnlyHint: true, autoExecutable: true }],
  ["get_shot", { readOnlyHint: true, autoExecutable: true }],
  ["set_view", { readOnlyHint: false, autoExecutable: true }],
  ["select_shot", { readOnlyHint: false, autoExecutable: true }],
  ["select_element", { readOnlyHint: false, autoExecutable: true }],
  ["board_element", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["add_script_mark", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["patch_shot", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["get_overhead_state", { readOnlyHint: true, autoExecutable: true }],
  ["patch_overhead", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["get_frame_state", { readOnlyHint: true, autoExecutable: true }],
  ["patch_frame", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["get_cut_state", { readOnlyHint: true, autoExecutable: true }],
  ["sync_shot_timeline", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["patch_frame_history", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["import_still", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["get_connection_status", { readOnlyHint: true, autoExecutable: true }],
  ["start_google_connection", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["test_connection", { readOnlyHint: true, autoExecutable: true }],
  ["disconnect_connection", { readOnlyHint: false, consequentialHint: true, autoExecutable: false }],
  ["stage_assistant_question", { readOnlyHint: false, autoExecutable: false }],
]);

function fixtureProject() {
  return {
    id: "webmcp-test",
    name: "WebMCP Test Film",
    logline: "",
    style: "",
    target: "veo",
    updatedAt: 1,
    world: { place: "", lighting: "", ambience: "", laws: "" },
    floor: { label: "", items: [], cameras: [], homes: [], path: [] },
    characters: [],
    skills: [],
    chain: [],
    binder: [],
    breakdown: [],
    cutUrl: null,
    timeline: { initialized: false, clips: [] },
    script: [
      { id: "scene-1", kind: "scene", text: "INT. WAREHOUSE - DAY" },
      { id: "beat-1", kind: "action", text: "A silver coin drops. The coin rolls away." },
      { id: "beat-2", kind: "dialogue", text: "Finders keepers.", character: "ALEX" },
    ],
    shots: [
      {
        id: "shot-1",
        number: 1,
        title: "Coin drop",
        action: "A silver coin drops onto the concrete floor.",
        dialogue: "",
        camera: "medium",
        movement: "static",
        screenDirection: "static",
        durationSec: 6,
        timeOfDay: "day",
        location: "WAREHOUSE",
        characters: ["ALEX"],
        lighting: "natural, even",
        notes: "",
        sketch: { strokes: [], stamps: [] },
        blocking: { figures: [] },
        annotations: [],
        events: [],
        setup: "Medium static on coin drop",
        coverageSize: "MS",
        coverageRole: "master",
        angleElementIds: undefined,
        lineColor: "ink",
        frameUrl: null,
        frameKind: "storyboard",
        videoUrl: null,
        videoRequestId: null,
        videoStatus: "idle",
        veoPrompt: "",
        runwayPrompt: "",
        imaginePrompt: "",
        rawSource: "",
        sceneId: "scene-1",
        elementIds: ["beat-1"],
      },
    ],
    marks: [],
  };
}

test("STUDIO_TOOLS catalog is well-formed and matches the contract", () => {
  const names = STUDIO_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
  for (const tool of STUDIO_TOOLS) {
    assert.match(tool.name, SNAKE_CASE_RE, `${tool.name} must be snake_case-safe`);
    const expected = EXPECTED.get(tool.name);
    assert.ok(expected, `${tool.name} has expected contract metadata`);
    assert.equal(tool.annotations.readOnlyHint, expected.readOnlyHint, `${tool.name} readOnlyHint mismatch`);
    assert.equal(tool.autoExecutable, expected.autoExecutable, `${tool.name} autoExecutable mismatch`);
    if ("consequentialHint" in expected) {
      assert.equal(
        tool.annotations.consequentialHint,
        expected.consequentialHint,
        `${tool.name} consequentialHint mismatch`,
      );
    }
    assert.equal(tool.inputSchema.type, "object", `${tool.name} inputSchema type mismatch`);
    assert.ok(tool.description.length > 0, `${tool.name} must have a description`);
  }
  assert.equal(STUDIO_TOOLS.length, EXPECTED.size, "tool count matches the contract");
});

test("executeStudioTool rejects unknown tool and bad args", async () => {
  const unknown = await executeStudioTool("not_a_tool", {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.error.includes("Unknown studio tool"));

  const badView = await executeStudioTool("set_view", { view: "bogus" });
  assert.equal(badView.ok, false);
  assert.ok(badView.error.includes("script"), "bad view rejected");

  const missingView = await executeStudioTool("set_view", {});
  assert.equal(missingView.ok, false);
  assert.ok(missingView.error.toLowerCase().includes("view"), "missing view rejected");

  const badShotType = await executeStudioTool("select_shot", { shotId: 123 });
  assert.equal(badShotType.ok, false);
  assert.ok(badShotType.error.includes("string"), "non-string shotId rejected");

  const unknownShot = await executeStudioTool("select_shot", { shotId: "missing" });
  assert.equal(unknownShot.ok, false);
  assert.ok(unknownShot.error.includes("No setup found"));
});

test("JSON UI tools fail closed outside a browser page", async () => {
  const snapshot = await executeStudioTool("get_ui_snapshot", {});
  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.error.includes("browser page"));

  const patch = await executeStudioTool("apply_ui_patch", {
    revision: 1,
    operations: [{ ref: "c1", action: "click" }],
  });
  assert.equal(patch.ok, false);
  assert.ok(patch.error.includes("browser page"));
});

test("set_view + select_shot + get_studio_state round-trip against store", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: null, selectedElementId: null, view: "script" });

  const setViewResult = await executeStudioTool("set_view", { view: "stage" });
  assert.equal(setViewResult.ok, true);

  const selectShotResult = await executeStudioTool("select_shot", { shotId: "shot-1" });
  assert.equal(selectShotResult.ok, true);

  const stateResult = await executeStudioTool("get_studio_state", {});
  assert.equal(stateResult.ok, true);
  const parsed = JSON.parse(stateResult.content[0].text);
  assert.equal(parsed.view, "stage");
  assert.equal(parsed.projectId, "webmcp-test");
  assert.equal(parsed.title, "WebMCP Test Film");
  assert.equal(parsed.selectedShotId, "shot-1");
  assert.equal(parsed.counts.shots, 1);
  assert.equal(parsed.counts.scriptElements, 3);
  assert.equal(parsed.counts.marks, 0);
});
test("cut state reads and synchronizes an explicit picture order with stale guards", async () => {
  const project = fixtureProject();
  project.timeline = {
    initialized: true,
    clips: [
      { id: "pic-a", shotId: "shot-1", track: "picture", start: 0, duration: 2, label: "A" },
      { id: "pic-b", shotId: "shot-1", track: "picture", start: 2, duration: 3, label: "B" },
      { id: "sound-1", shotId: "shot-1", track: "sound", start: 9, duration: 1, label: "Room tone" },
    ],
  };
  useSlate.setState({ project, selectedId: "shot-1", selectedElementId: null, view: "edit" });

  const before = await executeStudioTool("get_cut_state", {});
  assert.equal(before.ok, true);
  const beforeState = JSON.parse(before.content[0].text);
  // The revision is a SHORT stale-guard token, never the full project JSON
  // (which would bloat the Page Agent's accumulating tool-result history).
  assert.ok(beforeState.revision.length < 200, `revision must be short, got ${beforeState.revision.length} chars`);
  assert.deepEqual(beforeState.pictureClipIds, ["pic-a", "pic-b"]);

  const synced = await executeStudioTool("sync_shot_timeline", {
    expectedProjectId: beforeState.projectId,
    expectedRevision: beforeState.revision,
    expectedPictureClipIds: beforeState.pictureClipIds,
    orderedPictureClipIds: ["pic-b"],
  });
  assert.equal(synced.ok, true);
  const syncedState = JSON.parse(synced.content[0].text);
  assert.deepEqual(syncedState.removedClipIds, ["pic-a"]);
  assert.deepEqual(syncedState.state.pictureClipIds, ["pic-b"]);
  assert.equal(useSlate.getState().project.timeline.clips.find((clip) => clip.id === "pic-b").start, 0);
  assert.equal(useSlate.getState().project.timeline.clips.find((clip) => clip.id === "sound-1").start, 9);

  const stale = await executeStudioTool("sync_shot_timeline", {
    expectedProjectId: beforeState.projectId,
    expectedRevision: beforeState.revision,
    expectedPictureClipIds: beforeState.pictureClipIds,
    orderedPictureClipIds: ["pic-b"],
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed since/i);
});

test("frame history cleanup preserves the active version and imports an explicit setup still", async () => {
  const project = fixtureProject();
  project.shots[0].frameUrl = "data:image/png;base64,active";
  project.shots[0].frameHistory = [
    { id: "old-frame", url: "data:image/png;base64,old", kind: "still", createdAt: 1 },
    { id: "active-frame", url: project.shots[0].frameUrl, kind: "still", createdAt: 2 },
  ];
  useSlate.setState({ project, selectedId: "shot-1", selectedElementId: null, view: "edit" });

  const frameBefore = await executeStudioTool("get_frame_state", { shotId: "shot-1" });
  assert.equal(frameBefore.ok, true);
  const frameState = JSON.parse(frameBefore.content[0].text);
  assert.deepEqual(frameState.frame.history.map((version) => version.id), ["old-frame", "active-frame"]);

  const cleaned = await executeStudioTool("patch_frame_history", {
    shotId: "shot-1",
    expectedProjectId: frameState.projectId,
    expectedRevision: frameState.revision,
    expectedHistoryIds: ["old-frame", "active-frame"],
    removeIds: ["old-frame"],
  });
  assert.equal(cleaned.ok, true);
  assert.deepEqual(useSlate.getState().project.shots[0].frameHistory.map((version) => version.id), ["active-frame"]);

  const afterClean = JSON.parse((await executeStudioTool("get_frame_state", { shotId: "shot-1" })).content[0].text);
  const activeRemoval = await executeStudioTool("patch_frame_history", {
    shotId: "shot-1",
    expectedProjectId: afterClean.projectId,
    expectedRevision: afterClean.revision,
    expectedHistoryIds: ["active-frame"],
    removeIds: ["active-frame"],
  });
  assert.equal(activeRemoval.ok, false);
  assert.match(activeRemoval.error, /active frame/i);

  const blankProject = fixtureProject();
  useSlate.setState({ project: blankProject, selectedId: "shot-1", selectedElementId: null, view: "edit" });
  const blank = JSON.parse((await executeStudioTool("get_frame_state", { shotId: "shot-1" })).content[0].text);
  const imported = await executeStudioTool("import_still", {
    shotId: "shot-1",
    setup: blankProject.shots[0].setup,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    expectedProjectId: blank.projectId,
    expectedRevision: blank.revision,
    expectedFrameUrl: null,
    expectedHistoryIds: [],
  });
  assert.equal(imported.ok, true);
  assert.equal(useSlate.getState().project.shots[0].frameKind, "still");
  assert.match(useSlate.getState().project.shots[0].frameUrl, /^data:image\/png;base64,/);
  assert.equal(useSlate.getState().project.shots[0].frameHistory.length, 1);
});

test("typed overhead tools add and remove items and blocking figures", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: "shot-1", selectedElementId: null, view: "stage" });

  const added = await executeStudioTool("patch_overhead", {
    shotId: "shot-1",
    operations: [
      { op: "add_item", id: "chair-1", kind: "chair", x: 0.2, y: 0.3, label: "Chair" },
      { op: "add_figure", id: "figure-1", name: "ALEX", x: 0.4, y: 0.5 },
    ],
  });
  assert.equal(added.ok, true);
  const overhead = JSON.parse(added.content[0].text);
  assert.deepEqual(overhead.created, ["chair-1", "figure-1"]);
  assert.equal(overhead.state.floor.items[0].id, "chair-1");
  assert.equal(overhead.state.blocking.figures[0].name, "ALEX");

  const removed = await executeStudioTool("patch_overhead", {
    shotId: "shot-1",
    operations: [
      { op: "remove_item", id: "chair-1" },
      { op: "remove_figure", id: "figure-1" },
    ],
  });
  assert.equal(removed.ok, true);
  const empty = JSON.parse(removed.content[0].text);
  assert.equal(empty.state.floor.items.length, 0);
  assert.equal(empty.state.blocking.figures.length, 0);
});

test("typed frame tools add and remove stamps, strokes, and annotations", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: "shot-1", selectedElementId: null, view: "edit" });

  const added = await executeStudioTool("patch_frame", {
    shotId: "shot-1",
    operations: [
      { op: "add_stamp", id: "stamp-1", kind: "box", x: 0.25, y: 0.35 },
      { op: "add_stroke", id: "stroke-1", tool: "pencil", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      { op: "add_annotation", id: "annotation-1", kind: "note", points: [{ x: 0.5, y: 0.5 }], label: "Hold" },
    ],
  });
  assert.equal(added.ok, true);
  const frame = JSON.parse(added.content[0].text);
  assert.deepEqual(frame.created, ["stamp-1", "stroke-1", "annotation-1"]);
  assert.equal(frame.state.sketch.stamps.length, 1);
  assert.equal(frame.state.sketch.strokes.length, 1);
  assert.equal(frame.state.annotations.length, 1);

  const removed = await executeStudioTool("patch_frame", {
    shotId: "shot-1",
    operations: [
      { op: "remove_stamp", id: "stamp-1" },
      { op: "remove_stroke", id: "stroke-1" },
      { op: "remove_annotation", id: "annotation-1" },
    ],
  });
  assert.equal(removed.ok, true);
  const empty = JSON.parse(removed.content[0].text);
  assert.equal(empty.state.sketch.stamps.length, 0);
  assert.equal(empty.state.sketch.strokes.length, 0);
  assert.equal(empty.state.annotations.length, 0);
});

test("semantic frame placement upserts cast and removes cast, prop, and architecture items", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: "shot-1", selectedElementId: null, view: "edit" });

  const blocking = await executeStudioTool("patch_overhead", {
    shotId: "shot-1",
    operations: [{ op: "add_figure", id: "figure-1", name: "ALEX", x: 0.2, y: 0.2 }],
  });
  assert.equal(blocking.ok, true);

  const placed = await executeStudioTool("patch_frame", {
    shotId: "shot-1",
    operations: [
      { op: "place_item", kind: "cast", figureId: "figure-1", x: 0.3, y: 0.4 },
      { op: "place_item", kind: "prop", id: "prop-1", x: 0.6, y: 0.7, label: "crate" },
      { op: "place_item", kind: "architecture", id: "arch-1", points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.2 }] },
    ],
  });
  assert.equal(placed.ok, true);
  const placedFrame = JSON.parse(placed.content[0].text);
  assert.deepEqual(placedFrame.created, ["prop-1", "arch-1"]);
  assert.deepEqual(placedFrame.placed, ["st_figure-1"]);
  assert.deepEqual(placedFrame.updated, ["st_figure-1"]);
  assert.equal(placedFrame.state.sketch.stamps.length, 2);
  assert.equal(placedFrame.state.sketch.strokes.length, 1);
  assert.equal(placedFrame.state.sketch.stamps.find((stamp) => stamp.figureId === "figure-1").x, 0.3);

  const moved = await executeStudioTool("patch_frame", {
    shotId: "shot-1",
    operations: [{ op: "place_item", kind: "cast", figureId: "figure-1", x: 0.45, y: 0.55 }],
  });
  assert.equal(moved.ok, true);
  const movedFrame = JSON.parse(moved.content[0].text);
  assert.deepEqual(movedFrame.placed, ["st_figure-1"]);
  assert.deepEqual(movedFrame.created, []);
  assert.deepEqual(movedFrame.updated, ["st_figure-1"]);
  assert.equal(movedFrame.state.sketch.stamps.length, 2);
  assert.equal(movedFrame.state.sketch.stamps.find((stamp) => stamp.figureId === "figure-1").x, 0.45);

  const removed = await executeStudioTool("patch_frame", {
    shotId: "shot-1",
    operations: [
      { op: "remove_item", id: "st_figure-1" },
      { op: "remove_item", id: "prop-1" },
      { op: "remove_item", id: "arch-1" },
    ],
  });
  assert.equal(removed.ok, true);
  const removedFrame = JSON.parse(removed.content[0].text);
  assert.deepEqual(removedFrame.removed, ["st_figure-1", "prop-1", "arch-1"]);
  assert.equal(removedFrame.state.sketch.stamps.length, 0);
  assert.equal(removedFrame.state.sketch.strokes.length, 0);
  assert.equal(useSlate.getState().project.shots[0].sketch.stamps.length, 0);
  assert.equal(useSlate.getState().project.shots[0].sketch.strokes.length, 0);
});

test("add_script_mark validates quote and tag through guardPreflightFinding", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: null, selectedElementId: null, view: "script" });

  const missingQuote = await executeStudioTool("add_script_mark", {
    elementId: "beat-1",
    tag: "prop",
    quote: "",
  });
  assert.equal(missingQuote.ok, false);
  assert.ok(missingQuote.error.includes("exact quoted passage"));

  const ambiguousQuote = await executeStudioTool("add_script_mark", {
    elementId: "beat-1",
    tag: "prop",
    quote: "coin",
  });
  assert.equal(ambiguousQuote.ok, false);
  assert.ok(ambiguousQuote.error.includes("more than once"));

  const badTag = await executeStudioTool("add_script_mark", {
    elementId: "beat-1",
    tag: "not-a-tag",
    quote: "coin",
  });
  assert.equal(badTag.ok, false);
  assert.ok(badTag.error.includes("mark tag"));

  const valid = await executeStudioTool("add_script_mark", {
    elementId: "beat-1",
    tag: "prop",
    quote: "silver coin drops",
    note: "Hero prop",
  });
  assert.equal(valid.ok, true);

  const state = await executeStudioTool("get_studio_state", {});
  assert.equal(state.ok, true);
  const parsed = JSON.parse(state.content[0].text);
  assert.equal(parsed.counts.marks, 1);
});

test("patch_shot accepts only the agent-safe notes field", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: null, selectedElementId: null, view: "script" });

  const unsupportedField = await executeStudioTool("patch_shot", {
    shotId: "shot-1",
    fields: { title: "New title" },
  });
  assert.equal(unsupportedField.ok, false);
  assert.ok(unsupportedField.error.includes("Unsupported fields"));

  const badNotesType = await executeStudioTool("patch_shot", {
    shotId: "shot-1",
    fields: { notes: 123 },
  });
  assert.equal(badNotesType.ok, false);
  assert.ok(badNotesType.error.includes("string"));

  const unknownShot = await executeStudioTool("patch_shot", {
    shotId: "missing",
    fields: { notes: "Updated via agent." },
  });
  assert.equal(unknownShot.ok, false);
  assert.ok(unknownShot.error.includes("Select an existing setup"));

  const valid = await executeStudioTool("patch_shot", {
    shotId: "shot-1",
    fields: { notes: "Agent note." },
  });
  assert.equal(valid.ok, true);

  const shot = await executeStudioTool("get_shot", { shotId: "shot-1" });
  assert.equal(shot.ok, true);
  const parsed = JSON.parse(shot.content[0].text);
  assert.equal(parsed.notes, "Agent note.");
});

test("get_script_outline respects limit", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: null, selectedElementId: null, view: "script" });

  const outline = await executeStudioTool("get_script_outline", { limit: 2 });
  assert.equal(outline.ok, true);
  const parsed = JSON.parse(outline.content[0].text);
  assert.equal(parsed.elements.length, 2);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.limit, 2);
});

test("stage_assistant_question validates question length", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: null, selectedElementId: null, view: "script" });

  const tooLong = await executeStudioTool("stage_assistant_question", {
    question: "x".repeat(4001),
  });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.error.includes("4000"));

  const empty = await executeStudioTool("stage_assistant_question", { question: "" });
  assert.equal(empty.ok, false);
  assert.ok(empty.error.includes("1"));

  const valid = await executeStudioTool("stage_assistant_question", { question: "What coverage do I need?" });
  assert.equal(valid.ok, true);
});

// --- Schema audit: schemas must accept what the Page Agent (model) sends ---

function typeMatches(schema, type, value, path) {
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    if (schema.required) {
      for (const key of schema.required) {
        assert.ok(Object.hasOwn(value, key), `${path} requires "${key}" (got ${JSON.stringify(value)})`);
      }
    }
    if (schema.properties) {
      for (const key of schema.required ?? []) {
        assert.ok(key in schema.properties, `${path}: required field "${key}" must be declared in properties`);
      }
      // Declared optional properties are validated too: a schema that
      // under-types an optional field (e.g. value, expectedRevision) is a bug.
      for (const [key, memberSchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) validateSchemaValue(memberSchema, value[key], `${path}.${key}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.ok(key in schema.properties, `${path}: additional property "${key}" is not allowed`);
      }
    }
    return true;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${path} needs >= ${schema.minItems} items`);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, `${path} needs <= ${schema.maxItems} items`);
    if (schema.items) {
      for (const [index, item] of value.entries()) validateSchemaValue(schema.items, item, `${path}[${index}]`);
    }
    return true;
  }
  if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return false;
  } else if (type === "number") {
    if (typeof value !== "number") return false;
  } else if (type === "string") {
    if (typeof value !== "string") return false;
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${path} must be >= ${schema.minLength} chars`);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, `${path} must be <= ${schema.maxLength} chars`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean") return false;
  } else {
    assert.fail(`${path}: unsupported schema type "${type}"`);
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path} must be one of ${JSON.stringify(schema.enum)}`);
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path} must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, `${path} must be <= ${schema.maximum}`);
  return true;
}

/**
 * Minimal JSON Schema subset validator for the studio tool inputSchemas.
 * Supports: type (string or union array incl. "null"/"integer"), enum,
 * minimum/maximum, minLength/maxLength, minItems/maxItems, items, oneOf,
 * properties/required/additionalProperties: false. Throws with a path on any
 * mismatch so a union member's own constraints still fail the union.
 */
function validateSchemaValue(schema, value, path) {
  if (Array.isArray(schema.oneOf)) {
    let matched = 0;
    for (const branch of schema.oneOf) {
      try {
        if (validateSchemaValue(branch, value, path)) matched++;
      } catch { /* branch miss */ }
    }
    assert.ok(matched >= 1, `${path} must match one of the oneOf branches`);
    return true;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  assert.ok(types.length > 0 && types.every((type) => typeof type === "string"), `${path}: schema must declare a type`);
  for (const type of types) {
    if (type === "null") {
      if (value === null) return true;
      continue;
    }
    if (typeMatches(schema, type, value, path)) return true;
  }
  assert.fail(`${path} (value ${JSON.stringify(value)}) matched no type in ${JSON.stringify(types)}`);
}

/** Representative arguments a Page Agent would send for each tool. */
const REPRESENTATIVE_ARGS = new Map([
  ["get_ui_snapshot", { limit: 250 }],
  ["apply_ui_patch", {
    revision: 3,
    operations: [
      { ref: "c1", action: "fill", value: 50 },
      { ref: "c2", action: "fill", value: true },
      { ref: "c3", action: "click" },
    ],
  }],
  ["get_studio_state", {}],
  ["get_production_checks", {}],
  ["search_parallel", { question: "What is the fastest film festival in the world?" }],
  ["get_script_outline", { limit: 20 }],
  ["get_shot", { shotId: "shot-1" }],
  ["set_view", { view: "stage" }],
  ["select_shot", { shotId: "shot-1" }],
  ["select_element", { elementId: null }],
  ["board_element", { elementId: "beat-1" }],
  ["add_script_mark", { elementId: "beat-1", quote: "silver coin drops", tag: "prop", note: "Hero prop" }],
  ["patch_shot", { shotId: "shot-1", fields: { notes: "Agent note." } }],
  ["get_overhead_state", { shotId: "shot-1" }],
  ["patch_overhead", {
    shotId: "shot-1",
    operations: [{ op: "add_item", kind: "chair", x: 0.2, y: 0.3, label: "Chair" }],
  }],
  ["get_frame_state", { shotId: "shot-1" }],
  ["patch_frame", {
    shotId: "shot-1",
    operations: [
      { op: "add_stamp", kind: "box", x: 0.25, y: 0.35 },
      { op: "add_stroke", tool: "pencil", points: [{ x: 0.1, y: 0.1 }] },
    ],
  }],
  ["get_cut_state", {}],
  ["sync_shot_timeline", {
    expectedProjectId: "proj-1",
    expectedRevision: 7,
    expectedPictureClipIds: ["pic-a"],
    orderedPictureClipIds: ["pic-a"],
  }],
  ["patch_frame_history", {
    shotId: "shot-1",
    expectedProjectId: "proj-1",
    expectedRevision: 7,
    expectedHistoryIds: ["old-frame"],
    removeIds: ["old-frame"],
  }],
  ["import_still", {
    shotId: "shot-1",
    setup: "Medium static on coin drop",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    expectedProjectId: "proj-1",
    expectedRevision: 7,
    expectedFrameUrl: null,
    expectedHistoryIds: [],
  }],
  ["get_connection_status", {}],
  ["start_google_connection", { renewalConnectionId: "conn-1" }],
  ["test_connection", { connectionId: "conn-1" }],
  ["disconnect_connection", { connectionId: "conn-1" }],
  ["stage_assistant_question", { question: "What coverage do I need?" }],
]);

test("every tool inputSchema is structural and accepts model-typical arguments", () => {
  for (const tool of STUDIO_TOOLS) {
    const schema = tool.inputSchema;
    assert.equal(schema.type, "object", `${tool.name} must declare type "object"`);
    assert.ok(typeof schema.properties === "object" && schema.properties !== null, `${tool.name} must declare properties`);
    for (const required of schema.required ?? []) {
      assert.ok(required in schema.properties, `${tool.name}: required "${required}" is missing from properties`);
    }
    const args = REPRESENTATIVE_ARGS.get(tool.name);
    assert.ok(args, `${tool.name} must have representative model-typical arguments`);
    assert.equal(
      validateSchemaValue(schema, args, tool.name),
      true,
      `${tool.name} representative arguments must validate`,
    );
  }
});

test("schemas declare the type unions the model actually sends", () => {
  const schemaOf = (name) => STUDIO_TOOLS.find((tool) => tool.name === name).inputSchema;

  // apply_ui_patch.value must accept scalars, not just strings.
  const valueSchema = schemaOf("apply_ui_patch").properties.operations.items.properties.value;
  assert.ok(Array.isArray(valueSchema.type), "apply_ui_patch value must declare a type union");
  for (const type of ["string", "number", "boolean"]) {
    assert.ok(valueSchema.type.includes(type), `apply_ui_patch value must accept ${type}`);
  }

  // expectedRevision must accept an integer where the guard echoes a token.
  for (const name of ["sync_shot_timeline", "patch_frame_history", "import_still"]) {
    const revisionSchema = schemaOf(name).properties.expectedRevision;
    assert.ok(Array.isArray(revisionSchema.type), `${name} expectedRevision must declare a type union`);
    assert.ok(revisionSchema.type.includes("number"), `${name} expectedRevision must accept an integer`);
    assert.ok(revisionSchema.type.includes("string"), `${name} expectedRevision must accept a string`);
    assert.ok(schemaOf(name).required.includes("expectedRevision"), `${name} must still require expectedRevision`);
  }
});

test("negative cases are rejected by the declared schemas", () => {
  const schemaOf = (name) => STUDIO_TOOLS.find((tool) => tool.name === name).inputSchema;

  assert.throws(
    () => validateSchemaValue(schemaOf("select_shot"), { shotId: 123 }, "select_shot"),
    /must match one of the oneOf branches/,
    "numeric shotId must fail the select_shot oneOf",
  );
  assert.throws(
    () => validateSchemaValue(schemaOf("apply_ui_patch"), {
      revision: 3,
      operations: [{ ref: "c1", action: "fill", value: {} }],
    }, "apply_ui_patch"),
    /must be a (string|number|boolean)|matched no type/,
    "object value must fail the apply_ui_patch value union",
  );
  assert.throws(
    () => validateSchemaValue(schemaOf("set_view"), { view: "bogus" }, "set_view"),
    /must be one of/,
    "unlisted view must fail the enum",
  );
});

test("numeric expectedRevision passes the type boundary and reaches the stale guard", async () => {
  useSlate.setState({ project: fixtureProject(), selectedId: "shot-1", selectedElementId: null, view: "edit" });

  // A numeric token is coerced to its string form, so the failure is the
  // revision guard, not a type rejection. This is the correct end-to-end
  // behavior for a model that echoes the revision as a number.
  const cases = [
    ["sync_shot_timeline", { expectedProjectId: "webmcp-test", expectedRevision: 12345, expectedPictureClipIds: ["pic-a"], orderedPictureClipIds: ["pic-a"] }],
    ["patch_frame_history", {
      shotId: "shot-1",
      expectedProjectId: "webmcp-test",
      expectedRevision: 12345,
      expectedHistoryIds: [],
      removeIds: ["old-frame"],
    }],
    ["import_still", {
      shotId: "shot-1",
      setup: "Medium static on coin drop",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      expectedProjectId: "webmcp-test",
      expectedRevision: 12345,
      expectedFrameUrl: null,
      expectedHistoryIds: [],
    }],
  ];
  for (const [name, args] of cases) {
    const result = await executeStudioTool(name, args);
    assert.equal(result.ok, false, `${name} with a numeric revision must fail`);
    assert.match(
      result.error,
      /changed since this operation was prepared/,
      `${name} with a numeric revision must reach the revision guard, not a type error`,
    );
  }
});

test("applyUiPatch coerces numeric and boolean values to strings before applying", async () => {
  // Minimal DOM surface for the single text input the patch drives. The
  // classes must be real globals so ui-json's instanceof checks pass.
  let dispatched = [];
  const attributes = new Map();

  class FakeHTMLElement {
    constructor(tagName, type) {
      this.tagName = tagName;
      this.attributes = attributes;
      this.disabled = false;
      this.isContentEditable = false;
      this.textContent = "";
      this.className = "";
      this.id = "";
      this.type = type;
    }
    get isConnected() { return true; }
    getAttribute(name) { return attributes.get(name) ?? null; }
    setAttribute(name, value) { attributes.set(name, value); }
    hasAttribute(name) { return attributes.has(name); }
    closest() { return null; }
    getClientRects() { return [{}]; }
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    }
  }
  class FakeInputElement extends FakeHTMLElement {
    constructor(type) {
      super("INPUT", type);
      this.value = "";
    }
  }

  const input = new FakeInputElement("text");
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
  };
  globalThis.document = {
    title: "ReelBinder Studio",
    activeElement: input,
    querySelector: () => null,
    querySelectorAll: () => [input],
    getElementById: () => null,
  };
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.HTMLTextAreaElement = class FakeTextAreaElement extends FakeHTMLElement { };
  globalThis.HTMLSelectElement = class FakeSelectElement extends FakeHTMLElement { };
  globalThis.HTMLButtonElement = class FakeButtonElement extends FakeHTMLElement { };

  try {
    const snapshot = inspectUiControls();
    assert.equal(snapshot.ok, true);
    assert.deepEqual(snapshot.snapshot.controls.map((control) => control.ref), ["c1"]);
    const revision = snapshot.snapshot.revision;

    const result = await applyUiPatch({
      revision,
      operations: [
        { ref: "c1", action: "fill", value: 50 },
        { ref: "c1", action: "fill", value: true },
      ],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const outcomes = result.result.outcomes;
      assert.equal(outcomes.length, 2);
      assert.equal(outcomes[0].ok, true);
      assert.equal(outcomes[0].control?.value, "50");
      assert.ok(dispatched.includes("input") && dispatched.includes("change"));
      assert.equal(outcomes[1].ok, true);
      assert.equal(outcomes[1].control?.value, "true");
      assert.equal(input.value, "true");
    }

    const rejected = await applyUiPatch({
      revision,
      operations: [{ ref: "c1", action: "fill", value: {} }],
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /must be a string, number, or boolean/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
