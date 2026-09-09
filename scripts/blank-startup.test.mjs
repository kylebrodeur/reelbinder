import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "clsx" || specifier === "tailwind-merge") specifier = require.resolve(specifier);
    if (specifier.startsWith("@/packs/") && specifier.endsWith("?raw")) {
      const [sourcePath, query] = specifier.slice(2).split("?");
      return { url: `${new URL(`../src/${sourcePath}`, import.meta.url).href}?${query}`, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("?raw")) {
      const sourceUrl = new URL(url);
      sourceUrl.search = "";
      return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(sourceUrl, "utf8"))};` };
    }
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")) };
  },
});
const { createBlankProject } = await import("../src/lib/sample-project.ts");
const { useSlate } = await import("../src/lib/store.ts");
hooks.deregister();

function storageWith(value) {
  return {
    getItem: () => value,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

function assertBlank(project) {
  assert.equal(project.name, "Untitled");
  assert.equal(project.logline, "");
  assert.deepEqual(project.characters, []);
  assert.deepEqual(project.shots, []);
  assert.deepEqual(project.binder, []);
  assert.deepEqual(project.timeline.clips, []);
  assert.equal(project.script.find((element) => element.kind === "action")?.text, "");
  assert.doesNotMatch(JSON.stringify(project), /Bounty Hunter/i);
}

test("fresh startup uses a genuinely blank Project", () => {
  assertBlank(useSlate.getState().project);
});

test("missing legacy Project data migrates to blank", async () => {
  useSlate.persist.setOptions({ storage: storageWith({ state: {}, version: 12 }) });
  await useSlate.persist.rehydrate();
  assertBlank(useSlate.getState().project);
});

test("rehydration preserves a saved authored Project", async () => {
  const authored = createBlankProject();
  authored.id = "persisted-authored-project";
  authored.name = "Authored project";
  authored.logline = "An authored logline stays put.";
  authored.style = "An authored visual language.";
  authored.world.place = "An authored location";
  authored.script[0].text = "INT. AUTHORED ROOM - NIGHT";
  authored.script[1].text = "An authored action remains unchanged.";
  authored.skills = [{ id: "authored-skill", title: "Authored direction", body: "Preserve this direction." }];
  authored.chain = ["authored-skill"];
  authored.timeline = { clips: [], initialized: true };
  authored.revision = 9;
  const expected = structuredClone(authored);

  useSlate.persist.setOptions({
    storage: storageWith({
      state: {
        project: authored,
        selectedId: null,
        selectedElementId: authored.script[1].id,
        view: "edit",
      },
      version: 13,
    }),
  });
  await useSlate.persist.rehydrate();

  const restored = useSlate.getState();
  assert.equal(restored.project.id, expected.id);
  assert.equal(restored.project.name, expected.name);
  assert.equal(restored.project.logline, expected.logline);
  assert.equal(restored.project.style, expected.style);
  assert.equal(restored.project.world.place, expected.world.place);
  assert.deepEqual(restored.project.script, expected.script);
  assert.deepEqual(restored.project.skills, expected.skills);
  assert.deepEqual(restored.project.chain, expected.chain);
  assert.deepEqual(restored.project.timeline, expected.timeline);
  assert.equal(restored.project.revision, expected.revision);
  assert.equal(restored.selectedElementId, authored.script[1].id);
  assert.equal(restored.view, "edit");
});

test("Start a film exposes blank, verified planning import, and unavailable finished study", () => {
  const source = readFileSync(new URL("../src/components/app/film-entry-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, />New blank project</);
  assert.match(source, /"Open Bounty Hunter planning study"/);
  assert.match(source, /Planning only: no finished film or accepted media is included\./);
  assert.match(source, /<Button disabled>Coming after final review<\/Button>/);
  assert.match(source, /createProjectOpenAttempt/);
  assert.match(source, /loadDemoPackWithReceipt/);
  assert.match(source, /onClick=\{\(\) => void openDemo\(\)\}/);
  assert.doesNotMatch(source, /createSampleProject|Open script example/);
  assert.match(source, /\.reelbinder\.zip or \.slate\.zip/);
});
