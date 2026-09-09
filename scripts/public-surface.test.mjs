import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public candidate uses ReelBinder identity and excludes private production packs", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url)));
  const sample = await readFile(new URL("../src/lib/sample-project.ts", import.meta.url), "utf8");
  assert.equal(manifest.name, "ReelBinder");
  assert.match(sample, /ReelBinder Sample/);
  assert.doesNotMatch(sample, /Bounty Hunter|Crusty|Rusty|Noodles/);
});
