import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const memory = new Map();
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
        source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -4)), "utf8"))}`,
      };
    }
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")),
    };
  },
});

const { STUDIO_TOOLS, executeStudioTool } = await import("../src/lib/webmcp/studio-tools.ts");
const { useSlate } = await import("../src/lib/store.ts");
const { VIEWS, MARK_TAGS } = await import("../src/lib/types.ts");

hooks.deregister();

const SNAKE_CASE_RE = /^[a-zA-Z0-9_]+$/;

const EXPECTED = new Map([
  ["get_studio_state", { readOnlyHint: true, autoExecutable: true }],
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
