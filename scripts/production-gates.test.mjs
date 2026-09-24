import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

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
  framePlanReviewFingerprint,
  framePlanReviewFingerprintMatches,
  imageEditReadiness,
  imageEditReviewFingerprint,
  photorealReadiness,
  photorealPlacementFingerprint,
  stageReadiness,
  storyboardReadiness,
  storyboardAncestry,
  videoReadiness,
  videoReviewFingerprint,
} = await import("../src/lib/production-gates.ts");
const { validateSnapshotProject } = await import("../src/lib/slate-snapshot.ts");
hooks.deregister();

const layers = {
  guides: true,
  wireframe: true,
  markup: true,
  image: true,
  onionSkinOpacity: 0.85,
};

function fixture() {
  const shot = {
    id: "shot-1",
    number: 1,
    title: "Arrival",
    action: "The traveller arrives.",
    dialogue: "",
    camera: "wide",
    movement: "static",
    screenDirection: "static",
    durationSec: 4,
    timeOfDay: "day",
    location: "Room",
    setup: "A",
    characters: ["Traveller"],
    lighting: "Window light",
    notes: "",
    frameUrl: null,
    frameKind: "storyboard",
    frameHistory: [],
    videoUrl: null,
    videoHistory: [],
    videoRequestId: null,
    videoStatus: "idle",
    veoPrompt: "",
    runwayPrompt: "",
    imaginePrompt: "",
    rawSource: "",
    sceneId: null,
    elementIds: [],
    blocking: { figures: [{ id: "traveller", name: "Traveller", x: 0.4, y: 0.6, facing: 0 }] },
    sketch: {
      strokes: [],
      stamps: [{ id: "frame-traveller", kind: "figure", figureId: "traveller", label: "Traveller", x: 0.4, y: 0.6, scale: 1 }],
    },
    annotations: [],
    events: [],
    coverageSize: "LS",
    lineColor: "red",
  };
  return {
    id: "project-1",
    name: "Test film",
    logline: "A traveller enters a room.",
    style: "Naturalistic",
    target: "veo",
    updatedAt: 1,
    world: { place: "Room", lighting: "Window light", ambience: "Quiet", laws: "Ordinary physics", genesisUrl: null },
    characters: [{ name: "Traveller", look: "Dusty coat" }],
    script: [],
    skills: [],
    chain: [],
    cutUrl: null,
    binder: [{ id: "overhead", tab: "diagrams", title: "Room overhead", url: "/refs/room-overhead.png" }],
    breakdown: [],
    marks: [],
    floor: {
      label: "Room plan",
      items: [{ id: "wall", kind: "wall", x: 0, y: 0, w: 1, h: 0.05, rotation: 0, label: "North wall" }],
      homes: [{ id: "traveller", name: "Traveller", x: 0.4, y: 0.6, facing: 0 }],
      cameras: [{ id: "camera-a", shotId: shot.id, setup: shot.setup, x: 0.4, y: 0.8, angle: 270, fov: 45, targetId: "traveller" }],
      path: [],
    },
    shots: [shot],
    timeline: { initialized: true, clips: [] },
  };
}

function addReviewedStoryboard(project) {
  const approvalFingerprint = framePlanReviewFingerprint(project, "shot-1", layers);
  const plan = {
    assetId: "plan",
    url: "/api/cinema/assets/plan/content",
    mimeType: "image/png",
    width: 960,
    height: 540,
    byteSize: 5,
    sha256: "b".repeat(64),
    createdAt: 1,
    provenance: { origin: "uploaded" },
  };
  const board = {
    id: "board",
    kind: "storyboard",
    url: "/api/cinema/assets/board/content",
    createdAt: 2,
    asset: {
      assetId: "board",
      provenance: { origin: "generated", referenceAssetIds: [plan.assetId] },
    },
    references: [plan],
    composition: {
      layers,
      guideSha256: plan.sha256,
      sourceFrameUrl: "",
      sourceProjectSha256: "c".repeat(64),
      sourceShotId: "shot-1",
      sketch: structuredClone(project.shots[0].sketch),
      annotations: structuredClone(project.shots[0].annotations),
      reviewedPlan: {
        version: 1,
        projectId: project.id,
        shotId: "shot-1",
        setup: project.shots[0].setup,
        planAssetId: plan.assetId,
        planSha256: plan.sha256,
        sourceProjectSha256: "c".repeat(64),
        approvalFingerprint,
      },
    },
  };
  project.shots[0].frameUrl = board.url;
  project.shots[0].frameKind = "storyboard";
  project.shots[0].frameHistory = [board];
  return board;
}

function legacyPlanReviewFingerprint(project, shotId, frameLayers) {
  const source = structuredClone(project);
  delete source.updatedAt;
  for (const shot of source.shots) {
    for (const key of ["frameUrl", "frameKind", "frameHistory", "videoUrl", "videoHistory", "videoRequestId", "videoStatus"])
      delete shot[key];
  }
  return JSON.stringify({ kind: "overhead-plan-review", project: source, shotId, extra: frameLayers });
}

function legacyCompactPlanReviewFingerprint(project, shotId, frameLayers) {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  return JSON.stringify({
    kind: "overhead-plan-review",
    version: 2,
    projectId: project.id,
    shotId,
    setup: shot?.setup ?? "",
    layers: frameLayers,
    sha256: createHash("sha256").update(legacyPlanReviewFingerprint(project, shotId, frameLayers)).digest("hex"),
  });
}

function addGeneratedPhotoreal(project, board) {
  const shot = project.shots[0];
  const still = {
    id: "still",
    kind: "still",
    url: "/api/cinema/assets/still/content",
    createdAt: 3,
    asset: { assetId: "still", provenance: { origin: "generated", referenceAssetIds: [board.asset.assetId] } },
  };
  shot.frameHistory.push(still);
  shot.frameUrl = still.url;
  shot.frameKind = "still";
  return still;
}

test("stage readiness fails closed until an overhead reference and linked named setup are present", () => {
  const project = fixture();
  project.binder = [];
  project.floor = { label: "", items: [], homes: [], cameras: [], path: [] };
  project.shots[0].blocking.figures = [{ id: "traveller", name: "", x: 0.4, y: 0.6, facing: 0 }];
  project.shots[0].sketch.stamps[0].figureId = "someone-else";

  const report = stageReadiness(project, "shot-1");

  assert.equal(report.ready, false);
  assert.deepEqual(report.issues.map((issue) => issue.code), [
    "missing-overhead",
    "missing-floor-label",
    "missing-floor-items",
    "missing-floor-homes",
    "missing-shot-camera",
    "unnamed-blocking",
    "unlinked-frame-plan",
  ]);
});

test("stage readiness accepts a generic named setup linked from floor to frame without production-specific IDs", () => {
  assert.deepEqual(stageReadiness(fixture(), "shot-1"), { ready: true, issues: [] });
});

test("stage readiness rejects absent, malformed, or out-of-room structural geography", () => {
  const noStructure = fixture();
  noStructure.floor.items = [{ id: "mark", kind: "mark", x: 0.5, y: 0.5, w: 0.1, h: 0.1, rotation: 0, label: "Actor mark" }];
  assert.deepEqual(stageReadiness(noStructure, "shot-1").issues.map((item) => item.code), ["missing-floor-items"]);

  for (const mutate of [
    (project) => { project.floor.items[0].w = 0; },
    (project) => { project.floor.items[0].x = -0.1; },
    (project) => { project.floor.items[0].label = ""; },
  ]) {
    const invalid = fixture();
    mutate(invalid);
    assert.ok(stageReadiness(invalid, "shot-1").issues.some((item) => item.code === "invalid-floor-items"));
  }
});
test("stage readiness identifies the exact invalid Stage item and Frame stamp", () => {
  const project = fixture();
  project.floor.items[0].x = 0.9;
  project.shots[0].sketch.stamps.push({
    id: "stray-frame-stamp",
    kind: "figure",
    x: 0.7,
    y: 0.6,
    scale: 1,
  });

  const issues = stageReadiness(project, "shot-1").issues;
  assert.match(issues.find((item) => item.code === "invalid-floor-items").message, /North wall \(wall\)/);
  assert.match(issues.find((item) => item.code === "unlinked-frame-plan").message, /stray-frame-stamp/);
});

test("stage readiness rejects a mismatched setup and invalid, unresolved, coincident, or off-cone camera targets", () => {
  const cases = [
    [(camera) => { camera.setup = "B"; }, "invalid-shot-camera"],
    [(camera) => { camera.x = 1.1; }, "invalid-shot-camera"],
    [(camera) => { camera.fov = 0; }, "invalid-shot-camera"],
    [(camera) => { delete camera.targetId; }, "invalid-camera-target"],
    [(camera) => { camera.targetId = "missing"; }, "invalid-camera-target"],
    [(camera, project) => { camera.x = project.shots[0].blocking.figures[0].x; camera.y = project.shots[0].blocking.figures[0].y; }, "invalid-camera-target"],
    [(camera) => { camera.angle = 90; }, "invalid-camera-cone"],
  ];
  for (const [mutate, code] of cases) {
    const project = fixture();
    mutate(project.floor.cameras[0], project);
    assert.ok(stageReadiness(project, "shot-1").issues.some((item) => item.code === code), code);
  }
});

test("stage readiness resolves every visible figure through named blocking and shot cast identity", () => {
  for (const mutate of [
    (project) => { project.shots[0].sketch.stamps.push({ id: "stranger", kind: "figure", figureId: "missing", label: "Stranger", x: 0.7, y: 0.6, scale: 1 }); },
    (project) => { delete project.shots[0].sketch.stamps[0].figureId; },
    (project) => { project.shots[0].characters = []; },
  ]) {
    const project = fixture();
    mutate(project);
    assert.ok(stageReadiness(project, "shot-1").issues.some((item) => item.code === "unlinked-frame-plan"));
  }
});

test("stage readiness requires a camera assigned to the exact shot, not another shot with the same setup label", () => {
  const project = fixture();
  project.floor.cameras[0].shotId = "different-shot";
  assert.deepEqual(stageReadiness(project, "shot-1").issues.map((item) => item.code), ["missing-shot-camera"]);
});

test("plan and placement approvals invalidate when the project, shot, or visible frame layers change", () => {
  const project = fixture();
  const plan = framePlanReviewFingerprint(project, "shot-1", layers);
  const placement = photorealPlacementFingerprint(project, "shot-1");
  assert.equal(typeof plan, "string");
  assert.equal(placement, null, "placement cannot be approved before a storyboard is selected");

  addReviewedStoryboard(project);
  const approvedPlacement = photorealPlacementFingerprint(project, "shot-1");
  assert.equal(typeof approvedPlacement, "string");

  const changedProject = structuredClone(project);
  changedProject.name = "Changed film";
  assert.notEqual(framePlanReviewFingerprint(changedProject, "shot-1", layers), plan);
  assert.notEqual(photorealPlacementFingerprint(changedProject, "shot-1"), approvedPlacement);
  assert.notEqual(
    framePlanReviewFingerprint(project, "shot-1", { ...layers, markup: false }),
    framePlanReviewFingerprint(project, "shot-1", layers),
  );
  project.shots[0].sketch.stamps[0].x = 0.7;
  assert.equal(photorealPlacementFingerprint(project, "shot-1"), null);
});

test("plan approvals use a compact SHA-256 identity so ten reviewed storyboards fit backend admission", () => {
  const project = fixture();
  project.style = `Café 🤠 ${"x".repeat(185_000)}`;
  const board = addReviewedStoryboard(project);
  const parsed = JSON.parse(board.composition.reviewedPlan.approvalFingerprint);

  assert.deepEqual(Object.keys(parsed), ["kind", "version", "projectId", "shotId", "setup", "layers", "sha256"]);
  assert.equal(parsed.kind, "overhead-plan-review");
  assert.equal(parsed.version, 3);
  assert.match(parsed.sha256, /^[a-f0-9]{64}$/);
  assert.ok(board.composition.reviewedPlan.approvalFingerprint.length < 512);

  project.shots[0].frameHistory = Array.from({ length: 10 }, (_, index) => {
    const copy = structuredClone(board);
    copy.id = `board-${index}`;
    copy.url = `/api/cinema/assets/board-${index}/content`;
    copy.asset.assetId = `board-${index}`;
    copy.references[0].assetId = `plan-${index}`;
    copy.asset.provenance.referenceAssetIds = [`plan-${index}`];
    copy.composition.reviewedPlan.planAssetId = `plan-${index}`;
    return copy;
  });
  project.shots[0].frameUrl = project.shots[0].frameHistory.at(-1).url;

  assert.ok(Buffer.byteLength(JSON.stringify(project)) < 1_500_000);
  assert.deepEqual(validateSnapshotProject(project), project);
});

test("edit, delivery, and audio state do not stale a reviewed Stage plan", () => {
  const project = fixture();
  const board = addReviewedStoryboard(project);
  addGeneratedPhotoreal(project, board);
  const approval = board.composition.reviewedPlan.approvalFingerprint;

  project.timeline = {
    initialized: true,
    clips: [{
      id: "picture-1",
      shotId: "shot-1",
      track: "picture",
      start: 0,
      duration: 4,
      sourceInSec: 0,
      sourceOutSec: 4,
      sourceFrameUrl: project.shots[0].frameUrl,
    }],
  };
  project.cutUrl = "/api/cinema/assets/final-cut/content";
  project.musicAssets = [{
    assetId: "score",
    url: "/api/cinema/assets/score/content",
    mimeType: "audio/wav",
    durationSec: 20,
    byteSize: 20,
    sha256: "d".repeat(64),
    createdAt: 3,
    provenance: { origin: "generated" },
  }];
  project.audioClips = [{
    id: "score-clip",
    track: "music",
    label: "Score",
    start: 0,
    duration: 20,
    sourceInSec: 0,
    gain: 0.5,
    muted: false,
    ...project.musicAssets[0],
  }];

  assert.equal(framePlanReviewFingerprint(project, "shot-1", layers), approval);
  assert.equal(framePlanReviewFingerprintMatches(approval, project, "shot-1", layers), true);
  assert.deepEqual(storyboardAncestry(project.shots[0], project), { ready: true, issues: [] });
});

test("legacy compact approval from an empty edit survives Edit auto-initialization", () => {
  const project = fixture();
  project.timeline = { initialized: false, clips: [] };
  const legacyApproval = legacyCompactPlanReviewFingerprint(project, "shot-1", layers);
  const board = addReviewedStoryboard(project);
  board.composition.reviewedPlan.approvalFingerprint = legacyApproval;
  addGeneratedPhotoreal(project, board);

  project.timeline = {
    initialized: true,
    clips: [{ id: "auto-1", shotId: "shot-1", track: "picture", start: 0, duration: 4 }],
  };

  assert.equal(framePlanReviewFingerprintMatches(legacyApproval, project, "shot-1", layers), true);
  assert.deepEqual(storyboardAncestry(project.shots[0], project), { ready: true, issues: [] });
});

test("script, room, camera, blocking, and Frame changes still stale reviewed Stage plans", () => {
  const cases = [
    ["script", (project) => { project.script.push({ id: "beat-1", kind: "action", text: "A new action beat." }); }],
    ["room", (project) => { project.floor.items[0].label = "Changed wall"; }],
    ["camera", (project) => { project.floor.cameras[0].angle += 1; }],
    ["blocking", (project) => { project.shots[0].blocking.figures[0].x += 0.01; }],
    ["Frame", (project) => { project.shots[0].sketch.stamps[0].x += 0.01; }],
  ];

  for (const [label, mutate] of cases) {
    const project = fixture();
    const board = addReviewedStoryboard(project);
    addGeneratedPhotoreal(project, board);
    const approval = board.composition.reviewedPlan.approvalFingerprint;
    mutate(project);
    assert.equal(framePlanReviewFingerprintMatches(approval, project, "shot-1", layers), false, label);
    assert.deepEqual(
      storyboardAncestry(project.shots[0], project).issues.map((item) => item.code),
      ["stale-plan-provenance"],
      label,
    );
  }
});

test("legacy embedded plan approvals remain valid and current after the compact fingerprint upgrade", () => {
  const project = fixture();
  const legacy = legacyPlanReviewFingerprint(project, "shot-1", layers);
  const board = addReviewedStoryboard(project);
  board.composition.reviewedPlan.approvalFingerprint = legacy;

  assert.doesNotThrow(() => validateSnapshotProject(project));
  assert.equal(typeof photorealPlacementFingerprint(project, "shot-1"), "string");

  project.floor.items[0].label = "Changed wall";
  assert.equal(photorealPlacementFingerprint(project, "shot-1"), null);
});

test("storyboard readiness requires the current plan-only capture and its explicit overhead review", () => {
  const project = fixture();
  const guide = {
    captureKind: "plan",
    layers,
    dataUrl: "data:image/png;base64,aGVsbG8=",
    sha256: "a".repeat(64),
    sourceFingerprint: JSON.stringify(project),
    sourceFrameUrl: "",
    shotId: "shot-1",
  };
  assert.deepEqual(storyboardReadiness(project, "shot-1", null, null).issues.map((item) => item.code), ["missing-plan-capture"]);
  assert.deepEqual(storyboardReadiness(project, "shot-1", guide, null).issues.map((item) => item.code), ["missing-plan-review"]);
  const approval = framePlanReviewFingerprint(project, "shot-1", layers);
  assert.equal(storyboardReadiness(project, "shot-1", guide, approval).ready, true);
  guide.sourceFingerprint = JSON.stringify({ ...project, name: "old" });
  assert.deepEqual(storyboardReadiness(project, "shot-1", guide, approval).issues.map((item) => item.code), ["stale-plan-capture"]);
});

test("photoreal readiness requires a selected generated storyboard and current placement review", () => {
  const project = fixture();
  assert.deepEqual(photorealReadiness(project, "shot-1", null).issues.map((item) => item.code), ["missing-selected-storyboard"]);
  const board = {
    id: "board",
    kind: "storyboard",
    url: "/api/cinema/assets/board/content",
    createdAt: 1,
    asset: { assetId: "board", provenance: { origin: "uploaded" } },
  };
  project.shots[0].frameUrl = board.url;
  project.shots[0].frameKind = "storyboard";
  project.shots[0].frameHistory = [board];
  assert.deepEqual(photorealReadiness(project, "shot-1", null).issues.map((item) => item.code), ["missing-selected-storyboard"]);
  board.asset.provenance.origin = "generated";
  assert.deepEqual(photorealReadiness(project, "shot-1", null).issues.map((item) => item.code), ["missing-plan-provenance"]);
  addReviewedStoryboard(project);
  assert.deepEqual(photorealReadiness(project, "shot-1", null).issues.map((item) => item.code), ["missing-placement-review"]);
  const approval = photorealPlacementFingerprint(project, "shot-1");
  assert.equal(photorealReadiness(project, "shot-1", approval).ready, true);
  project.shots[0].action = "Changed action";
  assert.deepEqual(photorealReadiness(project, "shot-1", approval).issues.map((item) => item.code), ["stale-plan-provenance"]);
});

test("photoreal readiness requires the selected storyboard's exact current approved plan lineage", () => {
  const project = fixture();
  const board = addReviewedStoryboard(project);
  const placement = photorealPlacementFingerprint(project, "shot-1");
  assert.equal(photorealReadiness(project, "shot-1", placement).ready, true);

  board.composition.reviewedPlan.planAssetId = "other-plan";
  assert.deepEqual(photorealReadiness(project, "shot-1", placement).issues.map((item) => item.code), ["missing-plan-provenance"]);
  board.composition.reviewedPlan.planAssetId = "plan";
  project.floor.items[0].label = "Changed wall";
  assert.deepEqual(photorealReadiness(project, "shot-1", placement).issues.map((item) => item.code), ["stale-plan-provenance"]);
});

test("storyboard ancestry requires the selected photoreal version to reference a prior generated storyboard", () => {
  const project = fixture();
  const shot = project.shots[0];
  const board = {
    id: "board",
    kind: "storyboard",
    url: "/api/cinema/assets/board/content",
    createdAt: 1,
    asset: { assetId: "board", provenance: { origin: "uploaded" } },
  };
  const still = {
    id: "still",
    kind: "still",
    url: "/api/cinema/assets/still/content",
    createdAt: 2,
    asset: { assetId: "still", provenance: { origin: "uploaded", referenceAssetIds: ["board"] } },
  };
  shot.frameHistory = [board, still];
  shot.frameUrl = still.url;
  shot.frameKind = "still";
  assert.deepEqual(storyboardAncestry(shot).issues.map((item) => item.code), ["missing-selected-photoreal"]);
  still.asset.provenance.origin = "generated";
  assert.equal(storyboardAncestry(shot).ready, false, "an uploaded image relabeled as a storyboard is not generated ancestry");
  board.asset.provenance.origin = "generated";
  assert.equal(storyboardAncestry(shot, project).ready, false, "a generated board without reviewed plan provenance is not approved ancestry");
  const reviewedBoard = addReviewedStoryboard(project);
  still.asset.provenance.referenceAssetIds = [reviewedBoard.asset.assetId];
  shot.frameHistory.push(still);
  shot.frameUrl = still.url;
  shot.frameKind = "still";
  assert.equal(storyboardAncestry(shot, project).ready, true);

  const restyled = {
    id: "restyled",
    kind: "still",
    url: "/api/cinema/assets/restyled/content",
    createdAt: 3,
    asset: { assetId: "restyled", provenance: { origin: "generated", referenceAssetIds: ["still"] } },
  };
  shot.frameHistory.push(restyled);
  shot.frameUrl = restyled.url;
  assert.equal(storyboardAncestry(shot).ready, true, "generated still edits retain transitive storyboard ancestry");

  still.asset.provenance.referenceAssetIds = [];
  assert.equal(storyboardAncestry(shot).ready, false);
});

test("paid image edit readiness requires Stage, storyboard-approved source, and an exact current review", () => {
  const project = fixture();
  const board = addReviewedStoryboard(project);
  const still = {
    id: "still",
    kind: "still",
    url: "/api/cinema/assets/still/content",
    createdAt: 3,
    asset: { assetId: "still", provenance: { origin: "generated", referenceAssetIds: [board.asset.assetId] } },
  };
  project.shots[0].frameHistory.push(still);
  project.shots[0].frameUrl = still.url;
  project.shots[0].frameKind = "still";

  assert.deepEqual(imageEditReadiness(project, "shot-1", "shot-1", null).issues.map((item) => item.code), ["missing-image-review"]);
  const review = imageEditReviewFingerprint(project, "shot-1", "shot-1");
  assert.equal(imageEditReadiness(project, "shot-1", "shot-1", review).ready, true);
  project.shots[0].notes = "Changed after image review";
  assert.deepEqual(imageEditReadiness(project, "shot-1", "shot-1", review).issues.map((item) => item.code), ["stale-plan-provenance", "missing-image-review"]);
});

test("video readiness requires stage truth, selected storyboard-descended still, and current explicit review", () => {
  const project = fixture();
  const shot = project.shots[0];
  const board = addReviewedStoryboard(project);
  const still = {
    id: "still",
    kind: "still",
    url: "/api/cinema/assets/still/content",
    createdAt: 2,
    asset: { assetId: "still", provenance: { origin: "generated", referenceAssetIds: ["board"] } },
  };
  shot.frameHistory = [board, still];
  shot.frameUrl = still.url;
  shot.frameKind = "still";

  const unreviewed = videoReadiness(project, shot.id, null);
  assert.equal(unreviewed.ready, false);
  assert.deepEqual(unreviewed.issues.map((issue) => issue.code), ["missing-video-review"]);

  const intent = { prompt: "Hold the look, then turn.", durationSeconds: 4, aspectRatio: "16:9", generateAudio: true };
  const approval = videoReviewFingerprint(project, shot.id, intent);
  assert.equal(videoReadiness(project, shot.id, approval, intent).ready, true);
  assert.equal(videoReadiness(project, shot.id, approval, { ...intent, durationSeconds: 8 }).ready, false);
  project.shots[0].notes = "Changed after review";
  assert.equal(videoReadiness(project, shot.id, approval, intent).ready, false);
  assert.deepEqual(videoReadiness(project, shot.id, approval, intent).issues.map((issue) => issue.code), ["stale-plan-provenance"]);
});
