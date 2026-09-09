import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import JSZip from "jszip/dist/jszip.min.js";
import { createHash } from "node:crypto";

// Execute the actual browser-side TypeScript modules with their Vite-style imports.
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Use JSZip's real browser bundle, as the app does; no Node stream adapter is needed.
    if (specifier === "jszip") specifier = "jszip/dist/jszip.min.js";
    if (specifier === "clsx" || specifier === "tailwind-merge")
      specifier = require.resolve(specifier);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")),
    };
  },
});
const { packSlate, unpackSlate, unpackSlateWithReceipt, isZipFile, downloadSlatePack } = await import("../src/lib/slate-pack.ts");
const { emptyShot, emptyFloor, emptyWorld } = await import("../src/lib/types.ts");
const { parseProjectSnapshot, serializeProjectSnapshot } = await import("../src/lib/slate-snapshot.ts");
const { framePlanReviewFingerprint } = await import("../src/lib/production-gates.ts");
const { timelineAudioRenderInputs } = await import("../src/lib/timeline-audio.ts");
const { markArchiveImportApplied } = await import("../src/lib/archive-import-receipt.ts");
hooks.deregister();

test("project archives accept ReelBinder and legacy Slate filenames", () => {
  for (const name of ["Project.reelbinder.zip", "Project.slate.zip", "PROJECT.REELBINDER.ZIP", "PROJECT.SLATE.ZIP"])
    assert.equal(isZipFile(new File([], name)), true, name);
});

test("public archive download name changes without renaming ZIP internals", async (t) => {
  const project = authoredProject();
  const previousDocument = globalThis.document;
  const anchor = { href: "", download: "", click: t.mock.fn() };
  let downloadedBlob;
  t.mock.method(URL, "createObjectURL", (blob) => {
    downloadedBlob = blob;
    return "blob:reelbinder-export-test";
  });
  t.mock.method(URL, "revokeObjectURL", () => {});
  globalThis.document = { createElement: () => anchor };
  try {
    await downloadSlatePack(project);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.equal(anchor.download, "an-authored-scene.reelbinder.zip");
  assert.equal(anchor.click.mock.callCount(), 1);
  const zip = await JSZip.loadAsync(await downloadedBlob.arrayBuffer());
  for (const path of ["slate.json", "script.slate.md", "lining.jsonl", "project.snapshot.json"])
    assert.ok(zip.file(path), path);
  const manifest = JSON.parse(await zip.file("slate.json").async("string"));
  const snapshot = JSON.parse(await zip.file("project.snapshot.json").async("string"));
  assert.equal(manifest.format, "slate");
  assert.equal(manifest.version, 1);
  assert.equal(snapshot.format, "slate-project");
  assert.equal(snapshot.project.id, project.id);
  assert.deepEqual(snapshot.project.script, project.script);
  assert.equal(snapshot.project.shots[0].frameUrl, project.shots[0].frameUrl);
  assert.equal(snapshot.project.shots[0].videoUrl, project.shots[0].videoUrl);
});

function authoredProject() {
  return {
    id: "film-authored",
    name: "An authored scene",
    logline: "A coin falls.",
    style: "Ink",
    target: "veo",
    revision: 12,
    world: { ...emptyWorld(), place: "Saloon", genesisUrl: "data:image/png;base64,AQID" },
    characters: [{ name: "Rusty", aliases: ["Crusty Rusty"], look: "Brown coat" }],
    script: [
      { id: "scene-1", kind: "scene", text: "INT. SALOON - DAY" },
      { id: "beat-1", kind: "action", text: "Rusty drops the coin." },
    ],
    shots: [
      emptyShot({
        id: "shot-1",
        setup: "1A",
        sceneId: "scene-1",
        elementIds: ["beat-1"],
        title: "The drop",
        action: "Rusty drops the coin.",
        characters: ["Rusty"],
        screenDirection: "L-R",
        durationSec: 8,
        frameKind: "still",
        frameUrl: "data:image/png;base64,BAUG",
        videoUrl: "https://media.example/take.mp4",
        videoStatus: "done",
        videoRequestId: "job-completed",
        rawSource: "Keep the exact coin fall.",
        veoPrompt: "Authored Veo direction",
        runwayPrompt: "Authored alternate",
        imaginePrompt: "Original rough",
        sketch: {
          strokes: [
            { id: "stroke-1", tool: "pencil", color: "#000", width: 2, points: [{ x: 1, y: 2 }] },
          ],
          stamps: [],
        },
        annotations: [
          {
            id: "annotation-1",
            kind: "arrow",
            label: "Coin path",
            color: "red",
            points: [
              { x: 2, y: 3 },
              { x: 4, y: 5 },
            ],
          },
        ],
        events: [
          {
            id: "authored-event",
            target: "Rusty",
            kind: "gesture",
            text: "Pause before release",
            startSec: 2,
            endSec: 3,
          },
        ],
        blocking: { figures: [{ id: "rusty-1", name: "Rusty", x: 12, y: 15, facing: 90 }] },
      }),
    ],
    skills: [{ id: "coin-skill", title: "Coin rule", body: "The coin falls under gravity." }],
    chain: ["coin-skill"],
    binder: [],
    breakdown: [{ id: "prop-coin", department: "Props", item: "Coin", sceneId: "scene-1" }],
    marks: [
      {
        id: "mark-1",
        tag: "phys",
        text: "coin",
        note: "Normal gravity",
        elementId: "beat-1",
        start: 16,
        end: 20,
        sceneId: "scene-1",
      },
    ],
    floor: {
      ...emptyFloor(),
      homes: [{ id: "rusty-1", name: "Rusty", x: 12, y: 15, facing: 90 }],
      path: [{ x: 10, y: 10 }],
    },
    timeline: {
      revision: 4,
      initialized: true,
      clips: [
        {
          id: "clip-1",
          shotId: "shot-1",
          track: "picture",
          start: 1,
          duration: 3,
          sourceInSec: 2,
          sourceOutSec: 5,
          storyElementIds: ["beat-1"],
          alignment: "manual",
          sourceVideoUrl: "https://media.example/chosen-take.mp4",
          sourceFrameUrl: "data:image/png;base64,BAUG",
        },
      ],
    },
    cutUrl: "https://media.example/cut.mp4",
    updatedAt: 123456789,
  };
}

async function archiveOf(project) {
  return JSZip.loadAsync(await (await packSlate(project)).arrayBuffer());
}

test("Slate archive preserves authored events, annotations, media, edit decisions and revisions", async () => {
  const input = authoredProject();
  const output = await unpackSlate(await (await packSlate(input)).arrayBuffer());
  assert.deepEqual(output.shots[0].events, input.shots[0].events);
  assert.deepEqual(output.timeline, input.timeline);
  assert.deepEqual(output, input);
});

test("legacy script and lining archives still import without a project snapshot", async () => {
  const archive = await archiveOf(authoredProject());
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  if (manifest.projectSnapshot) archive.remove(manifest.projectSnapshot);
  delete manifest.projectSnapshot;
  archive.file("slate.json", JSON.stringify(manifest));
  const output = await unpackSlate(await archive.generateAsync({ type: "arraybuffer" }));
  assert.equal(output.name, "An authored scene");
  assert.equal(output.script[1].text, "Rusty drops the coin.");
  assert.equal(output.shots[0].setup, "1A");
  assert.equal(output.shots[0].blocking.figures[0].name, "Rusty");
  assert.equal((await unpackSlate(await packSlate(output))).shots[0].setup, "1A");
});

for (const [label, snapshot] of [
  ["unsupported version", { format: "slate-project", version: 999, project: authoredProject() }],
  [
    "malformed required data",
    {
      format: "slate-project",
      version: 1,
      project: { ...authoredProject(), shots: "not an array" },
    },
  ],
  [
    "credential fields",
    {
      format: "slate-project",
      version: 1,
      project: { ...authoredProject(), apiKey: "must-not-import" },
    },
  ],
]) {
  test(`a declared snapshot with ${label} is rejected instead of silently losing work`, async () => {
    const archive = await archiveOf(authoredProject());
    const manifest = JSON.parse(await archive.file("slate.json").async("string"));
    manifest.projectSnapshot = "project.snapshot.json";
    archive.file("slate.json", JSON.stringify(manifest));
    archive.file(manifest.projectSnapshot, JSON.stringify(snapshot));
    await assert.rejects(
      unpackSlate(await archive.generateAsync({ type: "arraybuffer" })),
      /snapshot|credential/i,
    );
  });
}

test("a declared missing snapshot is reported rather than reconstructed lossily", async () => {
  const archive = await archiveOf(authoredProject());
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  manifest.projectSnapshot = "missing.json";
  archive.file("slate.json", JSON.stringify(manifest));
  await assert.rejects(
    unpackSlate(await archive.generateAsync({ type: "arraybuffer" })),
    /snapshot/i,
  );
});

test("embedded reference files remain usable images after snapshot import", async () => {
  const input = authoredProject();
  input.binder.push({
    id: "board-1",
    tab: "boards",
    title: "Coin board",
    url: "data:image/png;base64,AQID",
  });
  const archive = await archiveOf(input);
  assert.deepEqual(
    await archive.file("refs/boards/coin-board.png").async("uint8array"),
    new Uint8Array([1, 2, 3]),
  );
  const output = await unpackSlate(await archive.generateAsync({ type: "arraybuffer" }));
  assert.equal(output.binder.length, 1);
  assert.equal(output.binder[0].id, "board-1");
  assert.equal(output.binder[0].url, "data:image/png;base64,AQID");
});

function ownedMediaProject() {
  const project = authoredProject();
  const assets = new Map();
  for (const [id, mimeType, bytes] of [
    ["frame", "image/png", new Uint8Array([1, 2, 3, 4])],
    ["take", "video/mp4", new Uint8Array([5, 6, 7, 8])],
    ["music", "audio/wav", new Uint8Array([9, 10, 11, 12])],
    ["cut", "video/mp4", new Uint8Array([13, 14, 15, 16])],
  ]) {
    assets.set(id, {
      bytes,
      metadata: {
        assetId: id,
        url: `/api/cinema/assets/${id}/content`,
        mimeType,
        byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        createdAt: 100,
        width: 1280,
        height: 720,
        durationSec: 8,
        provenance: {
          origin: "generated",
          model: "fixture-model",
          jobId: `job-${id}`,
          sourceRevision: 12,
        },
      },
    });
  }
  const metadata = (id) => structuredClone(assets.get(id).metadata);
  project.shots[0].frameUrl = metadata("frame").url;
  project.shots[0].videoUrl = metadata("take").url;
  project.shots[0].frameHistory = [
    {
      id: "frame",
      url: metadata("frame").url,
      kind: "still",
      createdAt: 100000,
      asset: metadata("frame"),
    },
  ];
  project.shots[0].videoHistory = [
    { id: "take", url: metadata("take").url, createdAt: 100000, asset: metadata("take") },
  ];
  project.timeline.clips[0].sourceFrameUrl = metadata("frame").url;
  project.timeline.clips[0].sourceVideoUrl = metadata("take").url;
  project.musicAssets = [metadata("music")];
  project.cutUrl = metadata("cut").url;
  project.binder = [
    { id: "owned-board", tab: "boards", title: "Owned board", url: metadata("frame").url },
  ];
  project.world.genesisUrl = metadata("frame").url;
  return { project, assets };
}

function mockMedia(t, assets) {
  const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push({ url, options });
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    if (url === "/api/cinema/assets/import") {
      const body = JSON.parse(options.body);
      const source = assets.get(body.provenance.sourceAssetId);
      assert.deepEqual(new Uint8Array(Buffer.from(body.dataBase64, "base64")), source.bytes);
      assert.equal(body.sha256, source.metadata.sha256);
      return Response.json({
        ...source.metadata,
        assetId: `restored-${source.metadata.assetId}`,
        url: `/api/cinema/assets/restored-${source.metadata.assetId}/content`,
        createdAt: 200,
        provenance: { origin: "imported", ...body.provenance },
        safeServerExtension: { kept: [true, null] },
      });
    }
    assert(!requests.importing, "Import must read embedded bytes, never an expired source URL");
    const match = /^\/api\/cinema\/assets\/([^/]+)(\/content)?$/.exec(url);
    assert(match, `Unexpected URL: ${url}`);
    const source = assets.get(match[1]);
    if (!source) return new Response("Missing", { status: 404 });
    return match[2]
      ? new Response(source.bytes, { headers: { "Content-Type": source.metadata.mimeType } })
      : Response.json(source.metadata);
  };
  t.mock.method(globalThis, "fetch", fetcher);
  return requests;
}

test("a multi-take scene archive over 128 MiB preserves trimmed edit and long audio in a new session", async (t) => {
  const { project, assets } = ownedMediaProject();
  for (const [id, size, fill] of [["take", 65 * 1024 * 1024, 21], ["cut", 65 * 1024 * 1024, 42], ["music", 9 * 1024 * 1024, 63]]) {
    const asset = assets.get(id);
    asset.bytes = new Uint8Array(size).fill(fill);
    Object.assign(asset.metadata, { byteSize: size, sha256: createHash("sha256").update(asset.bytes).digest("hex") });
  }
  project.shots[0].videoHistory[0].asset = structuredClone(assets.get("take").metadata);
  project.musicAssets[0] = structuredClone(assets.get("music").metadata);
  project.timeline.clips = Array.from({ length: 40 }, (_, i) => ({
    ...project.timeline.clips[0], id: `excerpt-${i}`, start: i * 4, duration: 4,
    sourceInSec: i % 2 ? 2 : 1, sourceOutSec: i % 2 ? 6 : 5,
    audioGain: i % 2 ? 0.6 : 1, audioMuted: i === 3,
  }));
  const before = structuredClone(project);
  const requests = mockMedia(t, assets);
  const packed = await packSlate(project);
  assert(packed.size > 128 * 1024 * 1024, "Exercise the former aggregate archive limit with actual bytes");
  requests.importing = true;
  const restored = await unpackSlate(packed);
  assert.equal(restored.timeline.clips.length, 40);
  assert.equal(restored.timeline.clips.at(-1).start + restored.timeline.clips.at(-1).duration, 160);
  for (const [i, clip] of restored.timeline.clips.entries()) {
    assert.deepEqual(clip, { ...before.timeline.clips[i],
      sourceVideoUrl: "/api/cinema/assets/restored-take/content",
      sourceFrameUrl: "/api/cinema/assets/restored-frame/content",
    });
  }
  assert.equal(restored.musicAssets[0].byteSize, 9 * 1024 * 1024);
  assert.deepEqual(restored.script, before.script);
  assert.deepEqual(restored.shots[0].videoHistory[0].asset.provenance, before.shots[0].videoHistory[0].asset.provenance);
  assert.deepEqual(project, before);
});

test("larger scene archives retain per-video and per-audio import bounds before upload", async (t) => {
  for (const [id, byteSize] of [["take", 128 * 1024 * 1024 + 1], ["music", 64 * 1024 * 1024 + 1]]) {
    const { project, assets } = ownedMediaProject();
    mockMedia(t, assets);
    const archive = await archiveOf(project);
    const manifest = JSON.parse(await archive.file("slate.json").async("string"));
    manifest.media.assets.find(row => row.metadata.assetId === id).byteSize = byteSize;
    archive.file("slate.json", JSON.stringify(manifest));
    let uploads = 0;
    t.mock.method(globalThis, "fetch", async () => { uploads++; throw new Error("No import may start"); });
    await assert.rejects(unpackSlate(await archive.generateAsync({ type: "arraybuffer" })), /Invalid media record in the project archive/);
    assert.equal(uploads, 0);
  }
});

test("full-scene render provenance survives archive restoration without raising the credential boundary", async (t) => {
  const { project, assets } = ownedMediaProject();
  assets.get("cut").metadata.provenance.editNotes = "direction ".repeat(7000);
  const before = structuredClone(assets.get("cut").metadata.provenance);
  const requests = mockMedia(t, assets);
  const packed = await packSlate(project);
  requests.importing = true;
  const restored = await unpackSlate(packed);
  assert.equal(restored.cutUrl, "/api/cinema/assets/restored-cut/content");
  const imported = requests.find(row => row.url.endsWith("/import") && JSON.parse(row.options.body).provenance.sourceAssetId === "cut");
  assert.deepEqual(JSON.parse(imported.options.body).provenance.sourceProvenance, before);
  const archive = await JSZip.loadAsync(await packed.arrayBuffer());
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  manifest.media.assets.find(row => row.metadata.assetId === "cut").metadata.provenance.accessToken = "blocked-fixture";
  archive.file("slate.json", JSON.stringify(manifest));
  const uploadCount = requests.filter(row => row.url.endsWith("/import")).length;
  await assert.rejects(unpackSlate(await archive.generateAsync({ type: "arraybuffer" })), /credential fields/);
  assert.equal(requests.filter(row => row.url.endsWith("/import")).length, uploadCount);
});

test("owned frame, take, music, cut and frozen history media survive a new-session archive import", async (t) => {
  const { project, assets } = ownedMediaProject();
  project.shots[0].rawSource = project.shots[0].videoUrl;
  project.shots[0].videoHistory[0].asset.provenance.originalUrl = project.shots[0].videoUrl;
  project.binder.push({
    id: "inline-board",
    tab: "boards",
    title: "Owned board",
    url: "data:image/png;base64,AQID",
  });
  const original = structuredClone(project);
  const requests = mockMedia(t, assets);
  const archive = await archiveOf(project);
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  assert.equal(manifest.media.version, 1);
  assert.equal(manifest.media.assets.length, 4);
  assert.equal(requests.filter((request) => request.url.endsWith("/content")).length, 4);
  for (const entry of manifest.media.assets) {
    const bytes = await archive.file(entry.path).async("uint8array");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
  requests.importing = true;
  const output = await unpackSlate(await archive.generateAsync({ type: "arraybuffer" }));
  const expected = structuredClone(original);
  const remap = (value) => {
    if (typeof value === "string")
      return value.replace(
        /^\/api\/cinema\/assets\/([^/]+)\/content$/,
        "/api/cinema/assets/restored-$1/content",
      );
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "provenance" || key === "rawSource"
            ? item
            : key === "assetId"
              ? `restored-${item}`
              : remap(item),
        ]),
      );
    return value;
  };
  assert.deepEqual(output, remap(expected));
  assert.deepEqual(project, original);
  assert.equal(requests.filter((request) => request.url.endsWith("/import")).length, 4);
});

test("restore errors and mismatched server metadata fail without publishing a partially remapped project", async (t) => {
  const { project, assets } = ownedMediaProject();
  const requests = mockMedia(t, assets);
  const archive = await (await packSlate(project)).arrayBuffer();
  const original = structuredClone(project);
  const successfulFetch = globalThis.fetch;
  for (const mismatch of [false, true]) {
    let imported = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      if (++imported === 2)
        return mismatch
          ? Response.json({
              ...assets.get("frame").metadata,
              url: "https://untrusted.example/frame.png",
            })
          : new Response("Unavailable", { status: 503 });
      return successfulFetch(url, options);
    });
    await assert.rejects(unpackSlate(archive), /media|HTTP 503/i);
    assert.deepEqual(project, original);
    assert.equal(imported, 2);
  }
  assert.equal(requests.filter((request) => request.url.endsWith("/import")).length, 2);
});

test("missing owned media fails export; arbitrary external origins are preserved but never fetched", async (t) => {
  const { project, assets } = ownedMediaProject();
  const requests = mockMedia(t, assets);
  assets.delete("take");
  await assert.rejects(packSlate(project), /take|missing|read|export/i);
  const external = authoredProject();
  external.binder = [
    {
      id: "remote",
      tab: "boards",
      title: "Remote",
      url: "https://untrusted.example/reference.jpg",
    },
  ];
  const count = requests.length;
  const archive = await archiveOf(external);
  assert.equal(requests.length, count);
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  assert(manifest.media.externalUrls.includes(external.binder[0].url));
});

test("missing or corrupted embedded media rejects the entire import before any restore request", async (t) => {
  const { project, assets } = ownedMediaProject();
  const requests = mockMedia(t, assets);
  const original = await (await packSlate(project)).arrayBuffer();
  for (const change of ["missing", "corrupt", "unmapped", "traversal"]) {
    const archive = await JSZip.loadAsync(original);
    const manifest = JSON.parse(await archive.file("slate.json").async("string"));
    const entry = manifest.media.assets.at(-1);
    if (change === "missing") archive.remove(entry.path);
    if (change === "corrupt") archive.file(entry.path, new Uint8Array([0, 0, 0, 0]));
    if (change === "unmapped") manifest.media.assets.pop();
    if (change === "traversal") entry.path = "media/../outside.mp4";
    archive.file("slate.json", JSON.stringify(manifest));
    await assert.rejects(
      unpackSlate(await archive.generateAsync({ type: "arraybuffer" })),
      /media|checksum|path/i,
    );
    assert.equal(requests.filter((request) => request.url.endsWith("/import")).length, 0);
  }
});

function authoredAudioClips(asset) {
  return ["voiceover", "sfx", "music"].map((track, index) => ({
    ...structuredClone(asset),
    id: `audio-${track}`,
    track,
    label: `Authored ${track}`,
    start: index + 1,
    duration: 1,
    sourceInSec: index + 1,
    gain: 0.5 + index * 0.5,
    muted: track === "sfx",
  }));
}

test("explicit audio tracks embed repeated sources once and remap owned IDs without changing the mix", async (t) => {
  const { project, assets } = ownedMediaProject();
  project.audioClips = authoredAudioClips(assets.get("music").metadata);
  delete project.musicAssets; // The authored audio rows alone own this media reference.
  project.timeline.clips[0].audioGain = 0.65;
  project.timeline.clips[0].audioMuted = true;
  const original = structuredClone(project);
  const requests = mockMedia(t, assets);
  const archive = await archiveOf(project);
  const manifest = JSON.parse(await archive.file("slate.json").async("string"));
  assert.equal(manifest.media.assets.filter((entry) => entry.mimeType === "audio/wav").length, 1);
  assert.equal(requests.filter((request) => request.url === "/api/cinema/assets/music/content").length, 1);
  requests.importing = true;
  const restored = await unpackSlate(await archive.generateAsync({ type: "arraybuffer" }));
  assert.deepEqual(restored.audioClips, original.audioClips.map((clip) => ({
    ...clip,
    assetId: "restored-music",
    url: "/api/cinema/assets/restored-music/content",
  })));
  assert.equal(requests.filter((request) => request.url.endsWith("/import") && JSON.parse(request.options.body).provenance.sourceAssetId === "music").length, 1);
  assert.equal(restored.timeline.clips[0].audioGain, 0.65);
  assert.equal(restored.timeline.clips[0].audioMuted, true);
  assert.deepEqual(timelineAudioRenderInputs(restored.audioClips, 4), [
    { assetId: "restored-music", start: 1, duration: 1, sourceInSec: 1, gain: 0.5 },
    { assetId: "restored-music", start: 2, duration: 1, sourceInSec: 2, gain: 0 },
    { assetId: "restored-music", start: 3, duration: 1, sourceInSec: 3, gain: 1.5 },
  ]);
  assert.deepEqual(project, original);
});

test("snapshot rejects malformed audio source, timing and picture mix fields before archive requests", async (t) => {
  const { project, assets } = ownedMediaProject();
  project.audioClips = authoredAudioClips(assets.get("music").metadata);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected media request"); });
  for (const patch of [
    { url: "https://outside.example/audio.wav" },
    { assetId: "different-source" },
    { track: "dialogue" },
    { sourceInSec: 8 },
    { duration: 0 },
    { gain: 4.1 },
    { muted: "false" },
  ]) {
    const invalid = structuredClone(project);
    Object.assign(invalid.audioClips[0], patch);
    assert.throws(() => serializeProjectSnapshot(invalid), /audio|WAV|gain|timing|trim/i);
    await assert.rejects(packSlate(invalid), /audio|WAV|gain|timing|trim/i);
  }
  for (const patch of [{ audioGain: -1 }, { audioGain: null }, { audioMuted: "false" }]) {
    const invalid = structuredClone(project);
    Object.assign(invalid.timeline.clips[0], patch);
    assert.throws(() => serializeProjectSnapshot(invalid), /audio|gain|snapshot/i);
  }
});

test("a shorter picture edit preserves authored audio for repair and blocks an out-of-range render", () => {
  const { project, assets } = ownedMediaProject();
  project.audioClips = authoredAudioClips(assets.get("music").metadata);
  project.audioClips[0].start = 7;
  const restored = parseProjectSnapshot(serializeProjectSnapshot(project));
  assert.deepEqual(restored.audioClips, project.audioClips);
  assert.throws(() => timelineAudioRenderInputs(restored.audioClips, 4), /past the picture edit/i);
});

test("missing or corrupt explicit audio bytes fail before any new-session upload", async (t) => {
  const { assets } = ownedMediaProject();
  const project = authoredProject();
  project.audioClips = authoredAudioClips(assets.get("music").metadata);
  const requests = mockMedia(t, assets);
  const original = await (await packSlate(project)).arrayBuffer();
  for (const mode of ["missing", "corrupt", "undeclared"]) {
    const archive = await JSZip.loadAsync(original);
    const manifest = JSON.parse(await archive.file("slate.json").async("string"));
    assert.equal(manifest.media.assets.length, 1);
    const entry = manifest.media.assets[0];
    if (mode === "missing") archive.remove(entry.path);
    if (mode === "corrupt") archive.file(entry.path, new Uint8Array([0, 0, 0, 0]));
    if (mode === "undeclared") manifest.media.assets = [];
    archive.file("slate.json", JSON.stringify(manifest));
    await assert.rejects(unpackSlate(await archive.generateAsync({ type: "arraybuffer" })), /media|checksum/i);
    assert.equal(requests.filter((request) => request.url.endsWith("/import")).length, 0);
  }
});

for (const [label, alter] of [
  [
    "missing",
    (value) => {
      delete value.provenance;
    },
  ],
  [
    "generated origin",
    (value) => {
      value.provenance.origin = "generated";
    },
  ],
  [
    "wrong source",
    (value) => {
      value.provenance.sourceAssetId = "forged";
    },
  ],
  [
    "wrong source time",
    (value) => {
      value.provenance.sourceCreatedAt = 42;
    },
  ],
  [
    "dropped nested model",
    (value) => {
      delete value.provenance.sourceProvenance.model;
    },
  ],
  [
    "forged nested job",
    (value) => {
      value.provenance.sourceProvenance.jobId = "forged";
    },
  ],
])
  test(`archive rejects ${label} returned lineage despite matching bytes`, async (t) => {
    const { project, assets } = ownedMediaProject();
    mockMedia(t, assets);
    const archive = await packSlate(project);
    const good = globalThis.fetch;
    t.mock.method(globalThis, "fetch", async (...args) => {
      const response = await good(...args);
      if (args[0] !== "/api/cinema/assets/import") return response;
      const value = await response.json();
      alter(value);
      return Response.json(value);
    });
    await assert.rejects(unpackSlate(archive), /lineage|provenance/i);
  });

test("prepared receipt preserves each owner and identical-byte distinct source records", async (t) => {
  assert.equal(
    typeof unpackSlateWithReceipt,
    "function",
    "receipt-returning importer must be available",
  );
  const { project, assets } = ownedMediaProject();
  const second = structuredClone(assets.get("take"));
  Object.assign(second.metadata, {
    assetId: "take2",
    url: "/api/cinema/assets/take2/content",
    provenance: { ...second.metadata.provenance, jobId: "independent-job" },
  });
  assets.set("take2", second);
  project.shots[0].videoHistory.push({
    id: "independent-version",
    url: second.metadata.url,
    createdAt: 101000,
    asset: second.metadata,
  });
  project.shots[0].frameHistory[0].references = [
    structuredClone(assets.get("frame").metadata),
  ];
  project.shots[0].frameHistory[0].composition = {
    sourceFrameUrl: assets.get("frame").metadata.url,
    guideSha256: assets.get("frame").metadata.sha256,
    sourceShotId: "shot-1",
    sourceProjectSha256: "a".repeat(64),
    sketch: { strokes: [], stamps: [] },
    annotations: [],
  };
  project.audioClips = authoredAudioClips(assets.get("music").metadata);
  const original = structuredClone(project);
  mockMedia(t, assets);
  const archive = await packSlate(project);
  const { project: restored, receipt } = await unpackSlateWithReceipt(archive);
  assert.equal(receipt.state, "prepared");
  assert.equal(receipt.assets.length, 5);
  assert.equal(
    receipt.archive.sha256,
    createHash("sha256")
      .update(new Uint8Array(await archive.arrayBuffer()))
      .digest("hex"),
  );
  assert.equal(
    receipt.project.preparedSha256,
    createHash("sha256").update(JSON.stringify(restored)).digest("hex"),
  );
  const takes = receipt.assets.filter((row) =>
    ["take", "take2"].includes(row.source.metadata.assetId),
  );
  assert.equal(takes.length, 2);
  assert.equal(takes[0].source.path, takes[1].source.path);
  assert.notEqual(takes[0].receiving.assetId, takes[1].receiving.assetId);
  assert.deepEqual(
    restored.shots[0].videoHistory.map((v) => v.id),
    ["take", "independent-version"],
  );
  assert.deepEqual(
    restored.shots[0].videoHistory.map((v) => v.asset.provenance),
    original.shots[0].videoHistory.map((v) => v.asset.provenance),
  );
  const paths = receipt.assets.flatMap((row) =>
    row.owners.map((owner) => owner.path),
  );
  for (const path of [
    "/cutUrl",
    "/world/genesisUrl",
    "/shots/0/frameUrl",
    "/shots/0/videoUrl",
    "/shots/0/frameHistory/0/url",
    "/shots/0/frameHistory/0/asset/url",
    "/shots/0/frameHistory/0/references/0/url",
    "/shots/0/frameHistory/0/composition/sourceFrameUrl",
    "/shots/0/videoHistory/1/asset/url",
    "/binder/0/url",
    "/musicAssets/0/url",
    "/audioClips/0/url",
    "/timeline/clips/0/sourceFrameUrl",
    "/timeline/clips/0/sourceVideoUrl",
  ])
    assert.ok(paths.includes(path), path);
  const owner = takes
    .find((row) => row.source.metadata.assetId === "take2")
    .owners.find((row) => row.path.endsWith("/asset/url"));
  assert.equal(owner.shotId, "shot-1");
  assert.equal(owner.versionId, "independent-version");
  assert.equal(owner.sourceAssetId, "take2");
  assert.equal(owner.receivingAssetId, "restored-take2");
  assert.deepEqual(receipt.assets[0].receiving.safeServerExtension, {
    kept: [true, null],
  });
  assert.deepEqual(project, original);
});

test("reviewed storyboard plan provenance is strictly validated and remapped through a Slate pack", async (t) => {
  const { project, assets } = ownedMediaProject();
  const shot = project.shots[0];
  const layers = { guides: true, wireframe: true, markup: true, image: true, onionSkinOpacity: 0.85 };
  const approvalFingerprint = framePlanReviewFingerprint(project, shot.id, layers);
  const plan = structuredClone(assets.get("frame"));
  Object.assign(plan.metadata, {
    assetId: "plan",
    url: "/api/cinema/assets/plan/content",
    provenance: { origin: "uploaded" },
  });
  assets.set("plan", plan);
  assets.get("frame").metadata.provenance = {
    ...assets.get("frame").metadata.provenance,
    referenceAssetIds: ["plan"],
  };
  const sourceProjectSha256 = createHash("sha256").update(JSON.stringify(project)).digest("hex");
  shot.frameKind = "storyboard";
  shot.frameHistory[0] = {
    ...shot.frameHistory[0],
    kind: "storyboard",
    asset: structuredClone(assets.get("frame").metadata),
    references: [structuredClone(plan.metadata)],
    composition: {
      layers,
      guideSha256: plan.metadata.sha256,
      sourceFrameUrl: "",
      sourceProjectSha256,
      sourceShotId: shot.id,
      sketch: structuredClone(shot.sketch),
      annotations: structuredClone(shot.annotations),
      reviewedPlan: {
        version: 1,
        projectId: project.id,
        shotId: shot.id,
        setup: shot.setup,
        planAssetId: "plan",
        planSha256: plan.metadata.sha256,
        sourceProjectSha256,
        approvalFingerprint,
      },
    },
  };
  mockMedia(t, assets);

  const restored = await unpackSlate(await packSlate(project));
  const version = restored.shots[0].frameHistory[0];
  assert.equal(version.references[0].assetId, "restored-plan");
  assert.equal(version.composition.reviewedPlan.planAssetId, "plan", "the approved source identity remains immutable");
  assert.equal(version.composition.reviewedPlan.planSha256, plan.metadata.sha256);
  assert.equal(version.composition.reviewedPlan.approvalFingerprint, approvalFingerprint);
  assert.doesNotThrow(() => serializeProjectSnapshot(restored));

  const malformed = structuredClone(restored);
  malformed.shots[0].frameHistory[0].composition.reviewedPlan.planAssetId = "unrelated-plan";
  assert.throws(() => serializeProjectSnapshot(malformed), /reviewedPlan|planAssetId|snapshot/i);
});

test("failed restore records confirmed uploads without publishing a prepared/applied Project", async (t) => {
  const { project, assets } = ownedMediaProject();
  mockMedia(t, assets);
  const archive = await packSlate(project);
  const good = globalThis.fetch;
  let count = 0;
  t.mock.method(globalThis, "fetch", async (...args) => {
    if (args[0] === "/api/cinema/assets/import" && ++count === 2)
      throw new Error("Interrupted response");
    return good(...args);
  });
  await assert.rejects(unpackSlate(archive), (error) => {
    assert.equal(error.receipt?.state, "failed");
    assert.equal(error.receipt.assets.length, 1);
    assert.ok(error.receipt.pendingSource);
    assert.equal(error.receipt.appliedProject, undefined);
    return true;
  });
});

test("receipt classifies inline bytes and bundled reference ownership without embedding data URLs or claiming external portability", async (t) => {
  const project = authoredProject();
  project.binder = [
    {
      id: "source-board",
      tab: "boards",
      title: "Coin study",
      url: "data:image/png;base64,AQID",
    },
  ];
  const archive = await packSlate(project),
    result = await unpackSlateWithReceipt(archive);
  assert.equal(result.receipt.referenceChanges.length, 1);
  assert.equal(result.receipt.referenceChanges[0].binderId, "source-board");
  assert.equal(result.receipt.referenceChanges[0].added, false);
  const inline = result.receipt.inlineMedia.find(
    (row) =>
      row.phase === "source" &&
      row.owners.some((owner) => owner.path === "/binder/0/url"),
  );
  assert.equal(inline.mimeType, "image/png");
  assert.equal(inline.byteSize, 3);
  assert.equal(
    inline.sha256,
    createHash("sha256")
      .update(new Uint8Array([1, 2, 3]))
      .digest("hex"),
  );
  assert.equal(
    inline.owners.find((owner) => owner.path === "/binder/0/url").binderId,
    "source-board",
  );
  assert.ok(
    result.receipt.externalUrls.includes("https://media.example/take.mp4"),
  );
  assert.ok(!JSON.stringify(result.receipt).includes("data:image/png;base64,"));
});
test("legacy malformed inline URL stays an explicit unverified observation rather than changing Project data", async () => {
  const project = authoredProject();
  project.world.genesisUrl = "data:image/png;base64,not!base64";
  const result = await unpackSlateWithReceipt(await packSlate(project));
  assert.equal(result.project.world.genesisUrl, project.world.genesisUrl);
  const inline = result.receipt.inlineMedia.find((row) =>
    row.owners.some((owner) => owner.path === "/world/genesisUrl"),
  );
  assert.equal(inline.decoding, "unreadable");
  assert.equal(inline.sha256, undefined);
  assert.equal(
    inline.urlSha256,
    createHash("sha256").update(project.world.genesisUrl).digest("hex"),
  );
});
test("receiving handle cannot merge distinct source records with matching bytes and individually echoed lineages", async (t) => {
  const { project, assets } = ownedMediaProject();
  const second = structuredClone(assets.get("take"));
  Object.assign(second.metadata, {
    assetId: "take2",
    url: "/api/cinema/assets/take2/content",
    provenance: { ...second.metadata.provenance, jobId: "second" },
  });
  assets.set("take2", second);
  project.shots[0].videoHistory.push({
    id: "version2",
    url: second.metadata.url,
    createdAt: 100,
    asset: second.metadata,
  });
  mockMedia(t, assets);
  const archive = await packSlate(project),
    good = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => {
    const r = await good(...args);
    if (args[0] !== "/api/cinema/assets/import") return r;
    const value = await r.json();
    if (["take", "take2"].includes(value.provenance.sourceAssetId)) {
      value.assetId = "same-handle";
      value.url = "/api/cinema/assets/same-handle/content";
    }
    return Response.json(value);
  });
  await assert.rejects(unpackSlateWithReceipt(archive), (error) => {
    assert.match(error.message, /distinct source lineages/);
    assert.equal(error.receipt.state, "failed");
    assert.ok(error.receipt.pendingSource);
    return true;
  });
});

test("re-export and second import record an explicit next hop without flattening prior provenance or changing original history", async (t) => {
  const { project, assets } = ownedMediaProject();
  mockMedia(t, assets);
  const good = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => {
    const response = await good(...args);
    if (args[0] === "/api/cinema/assets/import") {
      const metadata = await response.clone().json();
      assets.set(metadata.assetId, {
        metadata,
        bytes: assets.get(metadata.provenance.sourceAssetId).bytes,
      });
    }
    return response;
  });
  const first = await unpackSlateWithReceipt(await packSlate(project)),
    firstEvidence = JSON.stringify(first.receipt);
  const repacked = await packSlate(first.project),
    second = await unpackSlateWithReceipt(repacked);
  assert.notEqual(first.receipt.importId, second.receipt.importId);
  assert.equal(JSON.stringify(first.receipt), firstEvidence);
  for (const row of second.receipt.assets) {
    const previous = first.receipt.assets.find(
      (prior) => prior.receiving.assetId === row.source.metadata.assetId,
    );
    assert(previous);
    assert.deepEqual(
      row.source.metadata.provenance,
      previous.receiving.provenance,
    );
    assert.deepEqual(
      row.receiving.provenance.sourceProvenance,
      previous.receiving.provenance,
    );
    assert.notEqual(row.receiving.assetId, previous.receiving.assetId);
  }
  assert.deepEqual(
    second.project.shots[0].videoHistory[0].asset.provenance,
    project.shots[0].videoHistory[0].asset.provenance,
  );
  assert.equal(
    second.project.shots[0].videoHistory[0].id,
    project.shots[0].videoHistory[0].id,
  );
  const truthful = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => {
    const response = await truthful(...args);
    if (args[0] !== "/api/cinema/assets/import") return response;
    const value = await response.json();
    value.provenance.sourceProvenance.sourceAssetId = "forged-prior-hop";
    return Response.json(value);
  });
  await assert.rejects(unpackSlateWithReceipt(repacked), /lineage/);
});

test(
  "original complete archive returns sixteen byte-bound mappings with original screenplay, history and retirement policy",
  { skip: !process.env.APP22_ORIGINAL_ARCHIVE },
  async (t) => {
    const bytes = readFileSync(process.env.APP22_ORIGINAL_ARCHIVE),
      zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("slate.json").async("string")),
      source = parseProjectSnapshot(
        await zip.file(manifest.projectSnapshot).async("string"),
      );
    assert.equal(manifest.media.assets.length, 16);
    const assets = new Map();
    for (const row of manifest.media.assets)
      assets.set(row.metadata.assetId, {
        bytes: await zip.file(row.path).async("uint8array"),
        metadata: {
          ...row.metadata,
          url: row.sourceUrl,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
          sha256: row.sha256,
        },
      });
    const requests = mockMedia(t, assets);
    requests.importing = true;
    const result = await unpackSlateWithReceipt(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    assert.equal(result.receipt.assets.length, 16);
    assert.deepEqual(result.project.script, source.script);
    assert.deepEqual(
      result.receipt.retiredDemoMedia,
      source.retiredDemoMedia ?? [],
    );
    assert.deepEqual(
      result.project.shots.map((s) => ({
        id: s.id,
        frame: s.frameHistory?.map((v) => [v.id, v.asset?.provenance]),
        video: s.videoHistory?.map((v) => [v.id, v.asset?.provenance]),
      })),
      source.shots.map((s) => ({
        id: s.id,
        frame: s.frameHistory?.map((v) => [v.id, v.asset?.provenance]),
        video: s.videoHistory?.map((v) => [v.id, v.asset?.provenance]),
      })),
    );
    for (const row of result.receipt.assets) {
      assert.ok(row.owners.length);
      assert.equal(row.receiving.sha256, row.source.sha256);
      assert.equal(row.receiving.byteSize, row.source.byteSize);
      assert.deepEqual(
        row.receiving.provenance.sourceProvenance,
        row.source.metadata.provenance,
      );
    }
    assert.equal(requests.length, 16);
    assert.equal(
      result.receipt.archive.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  },
);

test("source snapshot hash binds exact ZIP entry bytes even when legacy UTF-8 decoding replaces an invalid byte", async () => {
  const zip = await archiveOf(authoredProject());
  const manifest = JSON.parse(await zip.file("slate.json").async("string"));
  const bytes = await zip.file(manifest.projectSnapshot).async("uint8array");
  const marker = new TextEncoder().encode("An authored scene");
  let index = -1;
  for (let i = 0; i < bytes.length - marker.length; i++)
    if (marker.every((v, j) => bytes[i + j] === v)) {
      index = i;
      break;
    }
  assert.ok(index >= 0);
  bytes[index] = 255;
  zip.file(manifest.projectSnapshot, bytes);
  const result = await unpackSlateWithReceipt(
    await zip.generateAsync({ type: "arraybuffer" }),
  );
  assert.equal(
    result.receipt.sourceSnapshot.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
});

test('archive hash and decoding use one frozen copy of a caller-owned ArrayBuffer',async()=>{
  const first=authoredProject();first.name='Original';const second=structuredClone(first);second.name='Mutating';
  const bytes=await(await packSlate(first)).arrayBuffer(),replacement=await(await packSlate(second)).arrayBuffer();
  assert.equal(bytes.byteLength,replacement.byteLength);const originalHash=createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  const pending=unpackSlateWithReceipt(bytes);new Uint8Array(bytes).set(new Uint8Array(replacement));const result=await pending;
  assert.equal(result.project.name,'Original');assert.equal(result.receipt.archive.sha256,originalHash);
});

for (const [label, change] of [
  ['shot',p=>{p.shots[0].id='different-shot'}],
  ['frame version',p=>{p.shots[0].frameHistory[0].id='different-frame-version'}],
  ['video version',p=>{p.shots[0].videoHistory[0].id='different-video-version'}],
  ['binder',p=>{p.binder[0].id='different-binder'}],
  ['audio clip',p=>{p.audioClips[0].id='different-audio-clip'}],
  ['timeline clip',p=>{p.timeline.clips[0].id='different-timeline-clip'}],
]) test(`actual archive applied receipt rejects changed ${label} identity with receiving URLs unchanged`,async t=>{
  const {project,assets}=ownedMediaProject();project.audioClips=authoredAudioClips(assets.get('music').metadata);mockMedia(t,assets);
  const {project:prepared,receipt}=await unpackSlateWithReceipt(await packSlate(project));
  const unchanged=await markArchiveImportApplied(receipt,prepared);assert.equal(unchanged.state,'applied');
  const changed=structuredClone(prepared);change(changed);
  await assert.rejects(markArchiveImportApplied(receipt,changed),/owner.*identity|identity.*owner/i);
  assert.equal(receipt.state,'prepared');assert.deepEqual(unchanged.assets,receipt.assets);
});
for(const family of ['shots','frameHistory','videoHistory','binder','audioClips','timeline'])test(`actual archive applied receipt rejects reordered ${family} owners that share identical receiving URLs`,async t=>{
  const {project,assets}=ownedMediaProject();project.audioClips=authoredAudioClips(assets.get('music').metadata);
  const collection=p=>family==='shots'?p.shots:family==='binder'?p.binder:family==='audioClips'?p.audioClips:family==='timeline'?p.timeline.clips:p.shots[0][family];
  const list=collection(project);if(list.length===1)list.push({...structuredClone(list[0]),id:`second-${family}`});
  mockMedia(t,assets);const {project:prepared,receipt}=await unpackSlateWithReceipt(await packSlate(project));
  collection(prepared).reverse();await assert.rejects(markArchiveImportApplied(receipt,prepared),/owner.*identity|identity.*owner/i);
});
for(const path of ['reference','composition'])test(`actual archive applied receipt validates version identity through a ${path}-only owned slot`,async t=>{
  const {project,assets}=ownedMediaProject();const version=project.shots[0].frameHistory[0];
  version.url='https://example.invalid/historical.png';delete version.asset;
  if(path==='reference')version.references=[structuredClone(assets.get('frame').metadata)];
  else version.composition={sourceFrameUrl:assets.get('frame').metadata.url,guideSha256:assets.get('frame').metadata.sha256,sourceShotId:'shot-1',sourceProjectSha256:'a'.repeat(64),sketch:{strokes:[],stamps:[]},annotations:[]};
  mockMedia(t,assets);const {project:prepared,receipt}=await unpackSlateWithReceipt(await packSlate(project));
  prepared.shots[0].frameHistory[0].id='wrong-ancestor-version';
  await assert.rejects(markArchiveImportApplied(receipt,prepared),/owner.*identity|identity.*owner/i);
});
for(const family of ['inline shot','inline version','inline binder','inline timeline','bundled binder'])test(`actual archive applied receipt validates ${family} observation identity`,async()=>{
  const project=authoredProject();project.binder=[{id:'source-board',tab:'boards',title:'Coin study',url:'data:image/png;base64,AQID'}];
  project.shots[0].frameHistory=[{id:'inline-version',url:'data:image/png;base64,AQID',kind:'still',createdAt:1}];
  const {project:prepared,receipt}=await unpackSlateWithReceipt(await packSlate(project));
  if(family==='inline shot')prepared.shots[0].id='wrong-shot';
  if(family==='inline version')prepared.shots[0].frameHistory[0].id='wrong-version';
  if(family==='inline binder'||family==='bundled binder')prepared.binder[0].id='wrong-binder';
  if(family==='inline timeline')prepared.timeline.clips[0].id='wrong-clip';
  if(family==='bundled binder')receipt.inlineMedia=[]; // Isolate the independently recorded bundled-reference identity claim.
  await assert.rejects(markArchiveImportApplied(receipt,prepared),/owner.*identity|identity.*owner/i);
});

test('actual archive applied receipt rejects changed prepared inline URL bytes even without owned assets',async()=>{
  const {project,receipt}=await unpackSlateWithReceipt(await packSlate(authoredProject()));
  assert.equal(receipt.assets.length,0);project.world.genesisUrl='data:image/png;base64,BAUG';
  await assert.rejects(markArchiveImportApplied(receipt,project),/inline.*receipt|receipt.*inline/i);
});
test('actual archive inline verification hashes the synchronous applied snapshot and ignores historical source-phase locations',async()=>{
  const {project,receipt}=await unpackSlateWithReceipt(await packSlate(authoredProject()));
  const historical=receipt.inlineMedia.filter(row=>row.phase==='source');for(const row of historical){row.urlSha256='f'.repeat(64);row.owners=row.owners.map(owner=>({...owner,path:'/historical/location',shotId:'historical-shot'}))}
  const expected=createHash('sha256').update(JSON.stringify(project)).digest('hex');const pending=markArchiveImportApplied(receipt,project);
  project.world.genesisUrl='data:image/png;base64,BAUG';project.shots[0].id='subsequent-edit';
  const applied=await pending;assert.equal(applied.appliedProject.sha256,expected);assert.deepEqual(applied.inlineMedia.filter(row=>row.phase==='source'),historical);
});

test('actual archive retains an absent legacy version identity without accepting a newly assigned owner ID',async t=>{
  const {project,assets}=ownedMediaProject();delete project.shots[0].frameHistory[0].id;mockMedia(t,assets);
  const result=await unpackSlateWithReceipt(await packSlate(project));assert.equal(result.project.shots[0].frameHistory[0].id,undefined);
  assert.equal((await markArchiveImportApplied(result.receipt,result.project)).state,'applied');
  result.project.shots[0].frameHistory[0].id='new-semantic-identity';
  await assert.rejects(markArchiveImportApplied(result.receipt,result.project),/owner.*identity|identity.*owner/i);
});
test('successive bundled references retain historical observations while applying the final inline value at the same binder identity',async()=>{
  const project=authoredProject();project.binder=[{id:'shared-board',title:'Shared a shared b',tab:'boards',url:'data:image/png;base64,AQID'}];
  const zip=await archiveOf(project);zip.file('refs/boards/shared-a.png',new Uint8Array([4,5,6]));zip.file('refs/boards/shared-b.png',new Uint8Array([7,8,9]));
  const result=await unpackSlateWithReceipt(await zip.generateAsync({type:'arraybuffer'}));
  assert.equal(result.receipt.referenceChanges.length,3);assert.ok(result.receipt.referenceChanges.every(row=>row.binderId==='shared-board'&&row.path==='/binder/0/url'));
  const changes=result.receipt.referenceChanges;assert.notEqual(changes[0].sha256,changes.at(-1).sha256);
  const initial=result.receipt.inlineMedia.find(row=>row.phase==='source'&&row.owners.some(owner=>owner.binderId==='shared-board'));
  const final=result.receipt.inlineMedia.find(row=>row.phase==='prepared'&&row.owners.some(owner=>owner.binderId==='shared-board'));
  assert.notEqual(initial.urlSha256,final.urlSha256);assert.equal((await markArchiveImportApplied(result.receipt,result.project)).state,'applied');
});
