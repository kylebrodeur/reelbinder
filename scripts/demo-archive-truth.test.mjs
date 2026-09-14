import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ARCHIVE_NAME = "bounty-hunter-planning-study.reelbinder.zip";
const ARCHIVE_PATH = new URL(`../public/demo/${ARCHIVE_NAME}`, import.meta.url);
const MANIFEST_PATH = new URL("../public/demo/manifest.json", import.meta.url);

const EXPECTED_DIGEST = "33fbb070296674abc5e984de7aa5d2a3f746fabd3ff0759479e23cdae10d4831";
const EXPECTED_SIZE = 436223;
const EXPECTED_SIZE_COMMA = "436,223";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const archiveBytes = readFileSync(ARCHIVE_PATH);
const actualDigest = sha256(archiveBytes);
const actualSize = archiveBytes.byteLength;
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

const docs = [
  ["README.md", new URL("../README.md", import.meta.url)],
  ["CREDITS.md", new URL("../CREDITS.md", import.meta.url)],
  ["public/demo/README.md", new URL("../public/demo/README.md", import.meta.url)],
  ["docs-site/content/docs/presentation-project.mdx", new URL("../docs-site/content/docs/presentation-project.mdx", import.meta.url)],
];

test("public demo archive matches manifest identity", () => {
  assert.equal(actualDigest, EXPECTED_DIGEST);
  assert.equal(actualSize, EXPECTED_SIZE);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.pack.url, `/demo/${ARCHIVE_NAME}`);
  assert.equal(manifest.pack.sha256, EXPECTED_DIGEST);
  assert.equal(manifest.pack.byteSize, EXPECTED_SIZE);
});

test("public docs use the committed .reelbinder.zip filename, digest, and size", () => {
  for (const [name, url] of docs) {
    const text = readFileSync(url, "utf8");
    assert.match(text, new RegExp(ARCHIVE_NAME), `${name} must name the .reelbinder.zip archive`);
    assert.match(text, new RegExp(EXPECTED_DIGEST), `${name} must contain the archive SHA-256`);
    assert.match(text, new RegExp(EXPECTED_SIZE_COMMA), `${name} must contain the archive byte size`);
  }
});

test("public docs no longer reference stale planning-study identities", () => {
  const stale = [
    /bounty-hunter-planning-study\.slate\.zip/,
    /330672c69f5f5277569061afc71b0498d10a4460cd8f8e972819afa25b09e836/,
    /284,939/,
    /284939/,
  ];
  for (const [name, url] of docs) {
    const text = readFileSync(url, "utf8");
    for (const pattern of stale) {
      assert.doesNotMatch(text, pattern, `${name} still contains a stale planning-study reference: ${pattern}`);
    }
  }
});

const FINISHED_ARCHIVE_NAME = "finished-presentation-project.reelbinder.zip";
const finishedArchiveBytes = readFileSync(new URL(`../public/demo/${FINISHED_ARCHIVE_NAME}`, import.meta.url));
const finishedManifest = JSON.parse(readFileSync(new URL("../public/demo/finished-manifest.json", import.meta.url), "utf8"));

test("finished presentation archive matches its manifest identity", () => {
  assert.equal(finishedManifest.version, 1);
  assert.equal(finishedManifest.pack.url, `/demo/${FINISHED_ARCHIVE_NAME}`);
  assert.equal(finishedManifest.pack.sha256, sha256(finishedArchiveBytes));
  assert.equal(finishedManifest.pack.byteSize, finishedArchiveBytes.byteLength);
  assert.equal(finishedManifest.media.length, 1);
  assert.equal(finishedManifest.media[0].mimeType, "video/mp4");
  assert.ok(finishedManifest.media[0].owners.length >= 1);
});
