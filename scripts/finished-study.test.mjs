import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "clsx" || specifier === "tailwind-merge") specifier = require.resolve(specifier);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes("/src/")) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")) };
  },
});
const { validateFinishedStudyManifest, validatePlanningStudyManifest } = await import("../src/lib/demo-pack.ts");
const { hydrateFinishedStudyMedia } = await import("../src/lib/finished-study-media.ts");
hooks.deregister();

const validManifest = {
  version: 1,
  title: "Finished presentation",
  description: "Media-light finished presentation Project.",
  credit: "Rights retained by Kyle Brodeur.",
  pack: { url: "/demo/finished-presentation-project.reelbinder.zip", sha256: "a".repeat(64), byteSize: 12345 },
  media: [{
    id: "finished-presentation-film",
    url: "/demo/media/the-bounty-hunter-v07.mp4",
    sha256: "b".repeat(64),
    byteSize: 16765387,
    mimeType: "video/mp4",
    owners: ["project.cutUrl", "project.shots[*].videoUrl", "project.timeline.clips[*].sourceVideoUrl"],
    label: "Accepted V07 finished film",
  }],
};

const project = {
  id: "proj_test",
  name: "Finished test",
  cutUrl: null,
  shots: [
    { id: "shot_1", videoUrl: null },
    { id: "shot_2", videoUrl: null },
  ],
  timeline: { clips: [
    { id: "clip_1", track: "picture", shotId: "shot_1", sourceVideoUrl: null },
    { id: "clip_2", track: "picture", shotId: "shot_2", sourceVideoUrl: null },
  ] },
};

function bytesResponse(bytes) {
  return {
    ok: true,
    redirected: false,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null) },
    body: {
      getReader: () => {
        let exhausted = false;
        return {
          read: async () => {
            if (exhausted) return { done: true, value: undefined };
            exhausted = true;
            return { done: false, value: bytes };
          },
          cancel: async () => {},
          releaseLock: () => {},
        };
      },
    },
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    redirected: false,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

test("finished-study descriptor accepts a valid manifest", () => {
  const manifest = validateFinishedStudyManifest(validManifest);
  assert.equal(manifest.media[0].id, "finished-presentation-film");
  assert.deepEqual(manifest.media[0].owners, validManifest.media[0].owners);
});

test("finished-study descriptor rejects invalid shapes", () => {
  for (const change of [
    { ...validManifest, version: 2 },
    { ...validManifest, media: [] },
    { ...validManifest, pack: { ...validManifest.pack, url: "https://example.com/demo/x.reelbinder.zip" } },
    { ...validManifest, media: [{ ...validManifest.media[0], mimeType: "video/webm" }] },
    { ...validManifest, media: [{ ...validManifest.media[0], byteSize: 0 }] },
    { ...validManifest, media: [{ ...validManifest.media[0], owners: [] }] },
    { ...validManifest, media: [{ ...validManifest.media[0], owners: ["project.musicAssets[*].url"] }] },
    { ...validManifest, media: [{ ...validManifest.media[0], url: "https://storage.googleapis.com/reelbinder-public-downloads/../evil.mp4" }] },
    { ...validManifest, media: [validManifest.media[0], validManifest.media[0]] },
  ]) {
    assert.throws(() => validateFinishedStudyManifest(change), `expected rejection for ${JSON.stringify(change).slice(0, 80)}`);
  }
});

test("planning descriptor still accepts its committed shape", () => {
  const manifest = validatePlanningStudyManifest({
    version: 1,
    title: "Planning study",
    description: "Source-only planning study.",
    credit: "Rights retained by Kyle Brodeur.",
    pack: { url: "/demo/bounty-hunter-planning-study.reelbinder.zip", sha256: "c".repeat(64), byteSize: 436223 },
  });
  assert.equal(manifest.pack.byteSize, 436223);
});

test("hydration imports declared media once and patches only declared owners", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push({ url });
    if (String(url).endsWith("/demo/media/the-bounty-hunter-v07.mp4")) return bytesResponse(new Uint8Array(16).fill(1));
    if (String(url).endsWith("/api/cinema/assets/import")) return jsonResponse({ assetId: "asset_new", url: "/api/cinema/assets/asset_new/content" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const bytes = new Uint8Array(16).fill(1);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const manifest = structuredClone(validManifest);
  manifest.media[0].sha256 = sha;
  manifest.media[0].byteSize = bytes.byteLength;
  const original = structuredClone(project);
  const result = await hydrateFinishedStudyMedia(manifest, original, new AbortController().signal);
  assert.equal(result.receipt.state, "applied");
  assert.equal(result.project.cutUrl, "/api/cinema/assets/asset_new/content");
  assert.equal(result.project.shots[0].videoUrl, "/api/cinema/assets/asset_new/content");
  assert.equal(result.project.shots[1].videoUrl, "/api/cinema/assets/asset_new/content");
  assert.equal(result.project.timeline.clips[0].sourceVideoUrl, "/api/cinema/assets/asset_new/content");
  assert.equal(result.project.timeline.clips[1].sourceVideoUrl, "/api/cinema/assets/asset_new/content");
  const importCalls = calls.filter((call) => String(call.url).endsWith("/api/cinema/assets/import"));
  assert.equal(importCalls.length, 1);
});

test("hydration fails closed on checksum mismatch without changing project media", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (String(url).endsWith("/demo/media/the-bounty-hunter-v07.mp4")) return bytesResponse(new Uint8Array(8).fill(2));
    throw new Error(`unexpected fetch ${url}`);
  };
  const original = structuredClone(project);
  const result = await hydrateFinishedStudyMedia(validManifest, structuredClone(project), new AbortController().signal);
  assert.equal(result.receipt.state, "failed");
  assert.equal(result.project.cutUrl, original.cutUrl);
  assert.equal(result.project.shots[0].videoUrl, original.shots[0].videoUrl);
  assert.equal(calls.some((url) => String(url).endsWith("/api/cinema/assets/import")), false);
});

test("hydration does not call any provider job endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return bytesResponse(new Uint8Array(4)); };
  await hydrateFinishedStudyMedia(validManifest, structuredClone(project), new AbortController().signal);
  assert.equal(calls.some((url) => String(url).includes("/jobs")), false);
});