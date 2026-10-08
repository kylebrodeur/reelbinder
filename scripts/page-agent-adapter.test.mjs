import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const toFileUrl = (value) => value.startsWith("file:") ? new URL(value) : pathToFileURL(value);
const readSource = (url) => readFileSync(toFileUrl(url), "utf8");
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
    if (specifier === "jszip") specifier = require.resolve("jszip/dist/jszip.min.js");
    if (external[specifier]) specifier = external[specifier];
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("?raw")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(readSource(url.slice(0, -4)))}`,
      };
    }
    if (!url.endsWith(".ts")) return nextLoad(url.startsWith("file:") ? url : toFileUrl(url).href, context);
    return {
      format: "module",
      shortCircuit: true,
      // transform mode: parameter properties in cinema-client.ts need full transforms.
      source: stripTypeScriptTypes(readSource(url), { mode: "transform" }),
    };
  },
});

const { STUDIO_TOOLS } = await import("../src/lib/webmcp/studio-tools.ts");
const {
  buildStudioPageAgentTools,
  classifyStudioTool,
  convertStudioInputSchema,
} = await import("../src/lib/page-agent/studio-tool-adapter.ts");
const {
  createPageAgentChatFetch,
  isValidChatCompletion,
  PAGE_AGENT_CHAT_ENDPOINT,
  PAGE_AGENT_MODEL,
  PageAgentChatFailure,
} = await import("../src/lib/page-agent/page-agent-runtime.ts");

hooks.deregister();

const CREATIVE_TOOLS = [...STUDIO_TOOLS.filter((tool) => classifyStudioTool(tool.annotations) === "creative").map((tool) => tool.name)];
const READ_TOOLS = [...STUDIO_TOOLS.filter((tool) => classifyStudioTool(tool.annotations) === "read").map((tool) => tool.name)];
const NAVIGATION_TOOLS = [...STUDIO_TOOLS.filter((tool) => classifyStudioTool(tool.annotations) === "navigation").map((tool) => tool.name)];
assert.ok(CREATIVE_TOOLS.length > 0, "catalog must contain creative tools");
assert.ok(READ_TOOLS.length > 0, "catalog must contain read tools");

const okRunner = (name, args) => Promise.resolve({ ok: true, content: [{ type: "text", text: `ran ${name}:${JSON.stringify(args)}` }] });
const failingRunner = () => Promise.resolve({ ok: false, error: "unknown id" });

test("every studio tool maps into the Page Agent tool set", () => {
  const tools = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true });
  for (const descriptor of STUDIO_TOOLS) {
    assert.notEqual(tools[descriptor.name], undefined, `missing ${descriptor.name}`);
    if (tools[descriptor.name]) {
      assert.equal(tools[descriptor.name].description, descriptor.description);
    }
  }
});

test("read and navigation tools run immediately; creative tools are gated", async () => {
  const tools = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true });
  for (const name of READ_TOOLS) {
    assert.equal(tools[name].destructive ?? false, false, `${name} must not be destructive`);
    assert.equal(tools[name].confirmationLabel, undefined, `${name} must not need confirmation`);
  }
  for (const name of NAVIGATION_TOOLS) {
    assert.ok(typeof tools[name].canRun === "function", `${name} must expose a canRun seam`);
    assert.equal(await tools[name].canRun({}, { signal: new AbortController().signal }), true);
    assert.equal(tools[name].destructive ?? false, false);
  }
  for (const name of CREATIVE_TOOLS) {
    assert.equal(tools[name].destructive, true, `${name} must be destructive`);
    assert.ok(typeof tools[name].confirmationLabel === "string" && tools[name].confirmationLabel.length > 0, `${name} needs a label`);
  }
});

test("creative tools are removed when no host confirmation handler exists", () => {
  const tools = buildStudioPageAgentTools({ runner: okRunner });
  for (const name of CREATIVE_TOOLS) {
    assert.equal(tools[name], null, `${name} must be unexposed without a confirmation handler`);
  }
  const withHandler = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true });
  for (const name of CREATIVE_TOOLS) assert.ok(withHandler[name], `${name} must be exposed with a handler`);
});

test("generic execute_javascript and direct DOM mutation stay disabled by default", () => {
  const tools = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true });
  assert.equal(tools.execute_javascript, null);
  assert.equal(tools.click_element_by_index, null);
  assert.equal(tools.input_text, null);
  assert.equal(tools.select_dropdown_option, null);

  const domFallback = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true, domFallback: true });
  assert.equal(domFallback.click_element_by_index, undefined, "dom fallback must re-enable the fork's default tool");
  assert.equal(domFallback.input_text, undefined);
  assert.equal(domFallback.execute_javascript, null, "script execution stays off even with DOM fallback");

  const scriptExecution = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true, scriptExecution: true });
  assert.equal(scriptExecution.execute_javascript, undefined, "explicit script authorization removes the null override");
});

test("converted schemas validate args at the Page Agent boundary", () => {
  const tools = buildStudioPageAgentTools({ runner: okRunner, onConfirmTool: async () => true });

  const shot = tools.get_shot.inputSchema.safeParse({ shotId: "shot-a" });
  assert.equal(shot.success, true);

  const missingShot = tools.get_shot.inputSchema.safeParse({});
  assert.equal(missingShot.success, false);

  const nullSelect = tools.select_element.inputSchema.safeParse({ elementId: null });
  assert.equal(nullSelect.success, true);

  const badView = tools.set_view.inputSchema.safeParse({ view: "cockpit" });
  assert.equal(badView.success, false);

  // required but undeclared revision guard field (sync_shot_timeline contract)
  const timeline = tools.sync_shot_timeline.inputSchema.safeParse({
    expectedProjectId: "project-a",
    expectedRevision: "1",
    expectedPictureClipIds: [],
    orderedPictureClipIds: [],
  });
  assert.equal(timeline.success, true);
  const missingRevision = tools.sync_shot_timeline.inputSchema.safeParse({
    expectedProjectId: "project-a",
    expectedPictureClipIds: [],
    orderedPictureClipIds: [],
  });
  assert.equal(missingRevision.success, false);

  const patchBounds = tools.apply_ui_patch.inputSchema.safeParse({ revision: 3, operations: [] });
  assert.equal(patchBounds.success, false, "operations minItems: 1 must hold");
});

test("studio tool execute forwards parsed args to the runner and truthfully reports failures", async () => {
  const calls = [];
  const runner = async (name, args) => {
    calls.push({ name, args });
    return name === "fail_tool" ? { ok: false, error: "unknown tool" } : { ok: true, content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] };
  };
  const tools = buildStudioPageAgentTools({ runner, onConfirmTool: async () => true });
  const ctx = { signal: new AbortController().signal };

  const output = await tools.get_shot.execute({ shotId: "shot-a" }, ctx);
  assert.equal(output, "first\nsecond");
  assert.deepEqual(calls.at(-1), { name: "get_shot", args: { shotId: "shot-a" } });

  const failed = buildStudioPageAgentTools({ runner: failingRunner, onConfirmTool: async () => true }).get_shot;
  const failureOutput = await failed.execute({ shotId: "shot-a" }, ctx);
  assert.equal(failureOutput, 'Tool "get_shot" failed: unknown id');
});

function toPageAgentToolExists(tools, name) {
  return tools[name];
}

// ---- backend chat bindings ----

const BROWSER_STUB = { origin: "http://localhost:8080", href: "http://localhost:8080/projects/abc/edit" };
function withBrowserWindow() {
  const prior = globalThis.window;
  globalThis.window = { location: BROWSER_STUB };
  return () => {
    globalThis.window = prior;
  };
}

const CHAT_BODY = {
  model: "anything",
  messages: [{ role: "user", content: "go" }],
  tools: [{ type: "function", function: { name: "AgentOutput" } }],
  tool_choice: { type: "function", function: { name: "AgentOutput" } },
  parallel_tool_calls: true,
};
const VALID_COMPLETION = {
  id: "c1",
  object: "chat.completion",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Done." } }],
};

function bindingFixture(overrides = {}) {
  return {
    projectId: () => "backend-project",
    pageId: () => "page_abc",
    runId: () => "run_1",
    connectionId: () => "conn-1",
    expectedRevision: () => 7,
    view: () => "stage",
    researchEnabled: () => false,
    ...overrides,
  };
}

test("chat fetch rewrites to the same-origin endpoint and binds the request body", async () => {
  const restoreWindow = withBrowserWindow();
  try {
    const captured = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(VALID_COMPLETION), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const fetchChat = createPageAgentChatFetch(bindingFixture());
      const response = await fetchChat("http://other-host.example/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].url, "http://localhost:8080/api/cinema/assistant/chat/completions");
      const body = captured[0].body;
      assert.equal(body.model, PAGE_AGENT_MODEL);
      assert.equal(body.connectionId, "conn-1");
      assert.equal(body.projectId, "backend-project");
      assert.equal(body.pageId, "page_abc");
      assert.equal(body.runId, "run_1");
      assert.equal(body.expectedRevision, 7);
      assert.equal(Number.isInteger(body.expectedRevision), true);
      assert.equal(body.view, "stage");
      assert.equal(body.parallel_tool_calls, false);
      assert.deepEqual(body.tool_choice, CHAT_BODY.tool_choice);
      assert.equal(body.messages.length, 1);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), VALID_COMPLETION);
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    restoreWindow();
  }
});

test("chat fetch re-asserts contract-required fields the model patch may strip", async () => {
  const restoreWindow = withBrowserWindow();
  try {
    const captured = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured.push(JSON.parse(init.body));
      return new Response(JSON.stringify(VALID_COMPLETION), { status: 200 });
    };
    try {
      const stripped = { ...CHAT_BODY };
      delete stripped.tool_choice;
      delete stripped.parallel_tool_calls;
      await createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", { method: "POST", body: JSON.stringify(stripped) });
      assert.equal(captured[0].tool_choice, "required");
      assert.equal(captured[0].parallel_tool_calls, false);
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    restoreWindow();
  }
});

test("chat fetch fails closed when binding data is missing", async (t) => {
  const restoreWindow = withBrowserWindow();
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = priorFetch;
    restoreWindow();
  });
  globalThis.fetch = async () => assert.fail("must not reach the network");
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture({ projectId: () => "" }))("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
    /no saved project snapshot/,
  );
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture({ connectionId: () => "" }))("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
    /connected Google Cloud account is required/,
  );
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture({ runId: () => "" }))("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
    /no active run/,
  );
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture({ expectedRevision: () => 0 }))("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
    /no saved project revision/,
  );
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture({ expectedRevision: () => 2.5 }))("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
    /no saved project revision/,
  );
  await assert.rejects(
    createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", { method: "POST", body: "not json" }),
    PageAgentChatFailure,
  );
});

test("chat fetch maps backend failures to truthful messages", async (t) => {
  const restoreWindow = withBrowserWindow();
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = priorFetch;
    restoreWindow();
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Session expired.", code: "AUTH" } }), { status: 401 });
  const error = await createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", {
    method: "POST",
    body: JSON.stringify(CHAT_BODY),
  }).then(
    () => assert.fail("expected rejection"),
    (thrown) => thrown,
  );
  assert.ok(error instanceof PageAgentChatFailure);
  assert.equal(error.status, 401);
  assert.match(error.message, /Session expired/);

  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  const unavailable = await createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", {
    method: "POST",
    body: JSON.stringify(CHAT_BODY),
  }).then(
    () => assert.fail("expected rejection"),
    (thrown) => thrown,
  );
  assert.equal(unavailable.status, 404);
  assert.match(unavailable.message, /not deployed/);
});

test("chat fetch rejects responses that are not chat completions", async (t) => {
  const restoreWindow = withBrowserWindow();
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = priorFetch;
    restoreWindow();
  });
  for (const payload of ["", "<html>", JSON.stringify({ object: "chat.completion", choices: [] }), JSON.stringify({ choices: [{ message: { role: "assistant", content: { nested: true } } }] })]) {
    globalThis.fetch = async () => new Response(payload, { status: 200 });
    await assert.rejects(
      createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) }),
      /unreadable chat completion/,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify(VALID_COMPLETION), { status: 200 });
  await createPageAgentChatFetch(bindingFixture())("http://x/chat/completions", { method: "POST", body: JSON.stringify(CHAT_BODY) });
});

test("chat completion guard accepts stream-shaped tool calls and rejects non-objects", () => {
  assert.equal(isValidChatCompletion(VALID_COMPLETION), true);
  assert.equal(
    isValidChatCompletion({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "AgentOutput", arguments: "{}" } }] } }] }),
    true,
  );
  assert.equal(isValidChatCompletion({ choices: [{ message: { role: "assistant", content: null, tool_calls: "nope" } }] }), false);
  assert.equal(isValidChatCompletion(null), false);
  assert.equal(isValidChatCompletion({}), false);
});

test("PAGE_AGENT_CHAT_ENDPOINT matches the confirmed backend route", () => {
  assert.equal(PAGE_AGENT_CHAT_ENDPOINT, "/api/cinema/assistant/chat/completions");
});

test("schema conversion fails closed for non-object top-level schemas", () => {
  assert.throws(() => convertStudioInputSchema("fake_tool", { type: "string" }), /not a JSON object schema/);
  const converted = convertStudioInputSchema("get_studio_state", { type: "object", properties: {} });
  assert.equal(converted.safeParse({}).success, true);
});