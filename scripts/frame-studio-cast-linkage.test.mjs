import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }),
    };
  },
});
const {
  applyFrameToBlocking: applyFrameToBlockingReal,
  projectFigureToFrame,
  projectFrameToFloor: projectFrameToFloorReal,
} = await import("../src/lib/floor.ts");
hooks.deregister();

function compileComponent(file, name) {
  const text = readFileSync(new URL(`../src/components/app/${file}`, import.meta.url), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(node, `${name} declaration exists`);
  return ts.transpileModule(node.getText(source).replace("export function", "function"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(descendants)];
}

function frameStudioHarness() {
  const rusty = { id: "rusty", name: "Rusty", x: 0.8, y: 0.45, facing: 180 };
  const bystander = { id: "bystander", name: "Bystander", x: 0.2, y: 0.4, facing: 0 };
  const shot = {
    id: "shot-1",
    characters: ["Rusty"],
    blocking: { figures: [rusty, bystander] },
    sketch: { strokes: [], stamps: [] },
    annotations: [],
    frameUrl: null,
  };
  const project = { id: "project-1", floor: {}, shots: [shot] };
  const calls = { sketches: [], annotations: [], blocking: [] };
  const store = {
    project,
    setSketch: (...args) => calls.sketches.push(args),
    setAnnotations: (...args) => calls.annotations.push(args),
    setBlocking: (...args) => calls.blocking.push(args),
  };
  const slots = [];
  let cursor = 0;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      },
    ];
  };
  const useSlate = (selector) => selector(store);
  useSlate.getState = () => store;
  const scope = {
    React,
    useState,
    useEffect: () => {},
    useSlate,
    DEFAULT_FRAME_LAYERS: { guides: true },
    BlockingCanvas: "BlockingCanvas",
    ImagineActions: "ImagineActions",
    Button: "Button",
    cameraForShot: () => ({ id: "camera" }),
    projectFrameToFloor: ({ x, y }) => ({ x: x / 2, y: y / 2 }),
  };
  const compiled = compileComponent("frame-studio.tsx", "FrameStudio");
  const FrameStudio = new Function(...Object.keys(scope), `${compiled}; return FrameStudio;`)(
    ...Object.values(scope),
  );
  const render = () => {
    cursor = 0;
    return FrameStudio({ shot });
  };
  return { calls, project, render, rusty, shot };
}

test("FrameStudio offers only named shot cast linked through setup blocking", () => {
  const harness = frameStudioHarness();
  const tree = harness.render();
  const nodes = descendants(tree);
  const canvas = nodes.find((node) => node.type === "BlockingCanvas");
  assert.deepEqual(canvas.props.cast, [harness.rusty]);

  const castButton = nodes.find(
    (node) => node.type === "Button" && node.props["aria-label"] === "Place Rusty in frame",
  );
  assert.ok(castButton, "linked shot cast is directly placeable");
  assert.equal(
    nodes.some((node) => node.type === "Button" && /Bystander/.test(node.props["aria-label"] ?? "")),
    false,
    "blocked figures absent from shot.characters are not offered",
  );

  castButton.props.onClick();
  const placingCanvas = descendants(harness.render()).find((node) => node.type === "BlockingCanvas");
  assert.equal(placingCanvas.props.selectedFigureId, "rusty");
  assert.equal(placingCanvas.props.placeFigureId, "rusty");
});
test("FrameStudio removes an unlinked frame item without touching linked cast blocking", () => {
  const harness = frameStudioHarness();
  const linked = { id: "rusty-frame", kind: "figure", figureId: "rusty", x: 0.7, y: 0.4, scale: 1 };
  harness.shot.sketch.stamps = [linked, { id: "stray-box", kind: "box", x: 0.5, y: 0.5, scale: 1 }];

  const remove = descendants(harness.render()).find(
    (node) => node.type === "Button" && node.props["aria-label"] === "Remove frame item stray-box",
  );
  assert.ok(remove, "unlinked frame item has an exact removal control");
  remove.props.onClick();
  assert.deepEqual(harness.calls.sketches, [[
    "shot-1",
    { strokes: [], stamps: [linked] },
  ]]);
});

test("FrameStudio moves only the live shot-cast blocking identity and preserves other figures", () => {
  const harness = frameStudioHarness();
  const canvas = descendants(harness.render()).find((node) => node.type === "BlockingCanvas");
  canvas.props.onLinkedMove("bystander", { x: 0.6, y: 0.4 });
  assert.equal(harness.calls.blocking.length, 0, "non-cast blocking cannot be moved from Frame");

  canvas.props.onLinkedMove("rusty", { x: 0.6, y: 0.4 });
  assert.equal(harness.calls.blocking.length, 1);
  const [shotId, blocking, options] = harness.calls.blocking[0];
  assert.equal(shotId, "shot-1");
  assert.deepEqual(blocking.figures, [
    { ...harness.rusty, x: 0.3, y: 0.2 },
    harness.project.shots[0].blocking.figures[1],
  ]);
  assert.deepEqual(options, { syncSketch: false });
});

function blockingCanvasHarness(props) {
  const refs = [];
  const useRef = (current) => {
    const ref = { current };
    refs.push(ref);
    return ref;
  };
  const scope = {
    React,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef,
    useEffect: () => {},
    useCallback: (fn) => fn,
    Button: "Button",
    FrameLayersControl: "FrameLayersControl",
    DEFAULT_FRAME_LAYERS: {},
    CHANGE_LABELS: [],
    MOVE_LABELS: [],
    shortFigureName: (name) => name,
    projectFigureToFrame: (figure) => figure,
    toNorm: (x, y, rect) => ({
      x: Math.min(1, Math.max(0, (x - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (y - rect.top) / rect.height)),
    }),
    hitStamp: (stamps, point, radius = 0.05) =>
      stamps.find((stamp) => Math.hypot(stamp.x - point.x, stamp.y - point.y) < radius) ?? null,
    cn: (...values) => values.filter(Boolean).join(" "),
    uid: () => "generated-id",
    paint: () => {},
    W: 160,
    H: 90,
    ArrowUpRight: "ArrowUpRight",
    BoxSelect: "BoxSelect",
    Eraser: "Eraser",
    MessageSquareWarning: "MessageSquareWarning",
    MousePointer2: "MousePointer2",
    Pencil: "Pencil",
    PersonStanding: "PersonStanding",
    RotateCcw: "RotateCcw",
    StickyNote: "StickyNote",
    X: "X",
  };
  const compiled = compileComponent("blocking-canvas.tsx", "BlockingCanvas");
  const BlockingCanvas = new Function(...Object.keys(scope), `${compiled}; return BlockingCanvas;`)(
    ...Object.values(scope),
  );
  const tree = BlockingCanvas({
    sketch: { strokes: [], stamps: [] },
    annotations: [],
    ...props,
  });
  const canvas = descendants(tree).find((node) => node.type === "canvas");
  const element = {
    focus: () => {},
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  refs[0].current = element;
  const pointerDown = () => canvas.props.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 50,
    clientY: 50,
    currentTarget: element,
  });
  return { pointerDown };
}

test("BlockingCanvas never creates an unlinked generic figure when cast is explicitly restricted", () => {
  const changes = [];
  blockingCanvasHarness({ cast: [], onSketch: (sketch) => changes.push(sketch) }).pointerDown();
  assert.deepEqual(changes, []);
});

test("BlockingCanvas rejects a placement identity outside its explicit cast", () => {
  const changes = [];
  blockingCanvasHarness({
    cast: [{ id: "rusty", name: "Rusty", x: 0.8, y: 0.45, facing: 180 }],
    placeFigureId: "ghost",
    onSketch: (sketch) => changes.push(sketch),
  }).pointerDown();
  assert.deepEqual(changes, []);
});

test("BlockingCanvas cannot select a pre-existing figure outside its explicit cast", () => {
  const selections = [];
  blockingCanvasHarness({
    cast: [{ id: "rusty", name: "Rusty", x: 0.8, y: 0.45, facing: 180 }],
    sketch: {
      strokes: [],
      stamps: [{ id: "old-generic", kind: "figure", figureId: "ghost", x: 0.5, y: 0.5, scale: 1 }],
    },
    onSelectFigure: (id) => selections.push(id),
  }).pointerDown();
  assert.deepEqual(selections, [null]);
});

function blockingStudioHarness({ foreignMark = "stamp" } = {}) {
  const bountyHunter = { id: "bh", name: "The Bounty Hunter", x: 0.2, y: 0.7, facing: 0 };
  const noodles = { id: "noodles", name: "Noodles", x: 0.6, y: 0.5, facing: 180 };
  const camera = { id: "cam-1h", shotId: "shot-1h", setup: "1H", x: 0.5, y: 0.9, angle: 270, fov: 60 };
  const noodlesFrame = projectFigureToFrame(noodles, camera);
  const shot = {
    id: "shot-1h",
    setup: "1H",
    characters: ["The Bounty Hunter"],
    blocking: { figures: [bountyHunter, noodles] },
    sketch: {
      strokes: [],
      stamps: [
        { id: "bh-frame", kind: "figure", figureId: "bh", x: 0.3, y: 0.6, scale: 1 },
        ...(foreignMark === "stamp"
          ? [{ id: "old-noodles", kind: "figure", figureId: "noodles", x: 0.7, y: 0.5, scale: 1 }]
          : []),
      ],
    },
    annotations: foreignMark === "arrow"
      ? [{
          id: "move-noodles",
          kind: "arrow",
          label: "Noodles",
          points: [noodlesFrame, { x: Math.min(0.95, noodlesFrame.x + 0.12), y: noodlesFrame.y }],
        }]
      : [],
    frameUrl: null,
  };
  const calls = { blocking: [], composedFigures: [], sketches: [] };
  const project = { id: "project-1", floor: { items: [] }, shots: [shot] };
  const store = {
    project,
    selectShot: () => {},
    patchFloor: () => {},
    setBlocking: (...args) => calls.blocking.push(args),
    setSketch: (...args) => calls.sketches.push(args),
    setAnnotations: () => {},
  };
  const slots = [];
  let cursor = 0;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      },
    ];
  };
  const useSlate = (selector) => selector(store);
  useSlate.getState = () => store;
  const playback = { playing: false, shotClock: 0, shotProgress: 0, shotId: null };
  const useStagePlayback = (selector) => selector(playback);
  useStagePlayback.getState = () => ({ reset: () => {} });
  const scope = {
    React,
    useState,
    useEffect: () => {},
    useSlate,
    useStagePlayback,
    DEFAULT_FRAME_LAYERS: { guides: true },
    figuresForShot: () => shot.blocking.figures,
    cameraForShot: () => camera,
    originalOverheadFor: () => null,
    originalBoardFor: () => null,
    poseAt: () => null,
    poseCameraAt: () => null,
    sketchFromBlocking: (figures) => {
      calls.composedFigures.push(figures);
      return { strokes: [], stamps: figures.map((figure) => ({ id: figure.id, kind: "figure", figureId: figure.id, x: 0.5, y: 0.5, scale: 1 })) };
    },
    applyFrameToBlocking: applyFrameToBlockingReal,
    frameMarksToItems: () => [],
    projectFrameToFloor: projectFrameToFloorReal,
    cn: () => "",
    PANES: [],
    BlockingCanvas: "BlockingCanvas",
    ImagineActions: "ImagineActions",
    OverheadPlan: "OverheadPlan",
    OriginalInset: "OriginalInset",
    DropdownMenu: "DropdownMenu",
    DropdownMenuTrigger: "DropdownMenuTrigger",
    DropdownMenuContent: "DropdownMenuContent",
    DropdownMenuItem: "DropdownMenuItem",
    Button: "Button",
    ChevronDown: "ChevronDown",
    Image: "Image",
    Layers: "Layers",
    COVERAGE_DOCK_TOGGLE_EVENT: "coverage-toggle",
  };
  const compiled = compileComponent("blocking-studio.tsx", "BlockingStudio");
  const BlockingStudio = new Function(...Object.keys(scope), `${compiled}; return BlockingStudio;`)(
    ...Object.values(scope),
  );
  const render = () => {
    cursor = 0;
    return BlockingStudio({ shot, shots: [shot] });
  };
  return { bountyHunter, calls, noodles, render };
}

test("BlockingStudio restricts the interactive Frame cast to shot-declared blocking identities", () => {
  const harness = blockingStudioHarness();
  let canvas = descendants(harness.render()).find((node) => node.type === "BlockingCanvas");
  assert.deepEqual(canvas.props.cast, [harness.bountyHunter]);

  canvas.props.onSelectFigure("noodles");
  canvas = descendants(harness.render()).find((node) => node.type === "BlockingCanvas");
  assert.equal(canvas.props.selectedFigureId, null);
  assert.equal(canvas.props.placeFigureId, null);
});

test("BlockingStudio composes Frame marks from declared cast while preserving complete floor blocking", () => {
  const harness = blockingStudioHarness();
  const nodes = descendants(harness.render());
  const compose = nodes.find(
    (node) => node.type === "DropdownMenuItem" && node.props.children === "Compose frame from current plan",
  );
  assert.ok(compose);
  compose.props.onSelect();
  assert.deepEqual(harness.calls.composedFigures, [[harness.bountyHunter]]);
  assert.deepEqual(harness.calls.sketches[0][0], "shot-1h");
});

for (const foreignMark of ["stamp", "arrow"]) {
  test(`BlockingStudio sync-back preserves off-shot blocking despite a foreign ${foreignMark}`, () => {
    const harness = blockingStudioHarness({ foreignMark });
    const nodes = descendants(harness.render());
    const syncBack = nodes.find(
      (node) => node.type === "DropdownMenuItem" && node.props.children === "Update plan from frame positions",
    );
    assert.ok(syncBack);
    syncBack.props.onSelect();

    assert.equal(harness.calls.blocking.length, 1);
    const [shotId, blocking, options] = harness.calls.blocking[0];
    const byId = new Map(blocking.figures.map((figure) => [figure.id, figure]));
    assert.equal(shotId, "shot-1h");
    assert.notDeepEqual(byId.get("bh"), harness.bountyHunter, "declared cast still follows Frame marks");
    assert.deepEqual(byId.get("noodles"), harness.noodles, "foreign blocking remains floor truth");
    assert.deepEqual(options, { syncSketch: false });
  });
}
