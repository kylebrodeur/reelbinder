// Focused behavioral proof for the persistent Production Assistant sidebar.
//
// This loads the real component and adapter modules (no mocks at module level)
// and renders the exact seam SlateApp wires: ProductionAssistantProvider +
// PreflightControl (workspace presentation) + ProductionAssistantSidebar. The
// open/tab state is driven through the same controlled props SlateApp holds,
// so every assertion here runs the actual integration contract:
// - the desktop reopen control stays discoverable while the dock is closed
// - the dock exposes chat, Parallel research, checks and Page Agent panes
// - the chat draft persists through the production-assistant store
// - PageAgent custom tools are sourced from the current STUDIO_TOOLS catalog
//   with confirmation gating for creative tools, and tool execution runs the
//   real studio tool authority (executeStudioTool against the real store)
// - assistant Markdown is rendered by the real AssistantMarkdown without raw
//   HTML or javascript: URLs and keeps safe https links
// - the Checks↔Research wiring: per-check research sources, view-sources
//   highlight and draft-only "Research this check" composition (spec section 3)
//
// The ask form path is only mounted, never submitted. The unified composer's
// agent route DOES run a complete Page Agent task against the real
// PageAgentCore: the browser controller and the same-origin gateway are stubbed
// (no real network, no real model), which proves the steering bridge end-to-end
// while an agent run is in flight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const memory = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
});
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const mapped = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const candidate of [mapped, `${mapped}.ts`, `${mapped}.tsx`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          /* try the next extension candidate */
        }
      }
      return nextResolve(mapped, context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !/\.[a-z]+$/i.test(new URL(specifier, context.parentURL).href)
    ) {
      for (const suffix of [".ts", ".tsx"]) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          /* try the next suffix */
        }
      }
    }
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
    if (!/\.(tsx?|jsx)$/.test(url)) return nextLoad(url, context);
    const source = url.endsWith(".ts")
      ? // The native stripper keeps generic arrows like <T>(...) intact in .ts;
        // transpileModule parses them as JSX.
        stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" })
      : require("typescript").transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: require("typescript").ScriptTarget.ES2022,
            module: require("typescript").ModuleKind.ESNext,
            jsx: require("typescript").JsxEmit.ReactJSX,
          },
        }).outputText;
    return { format: "module", shortCircuit: true, source };
  },
});
const unloadHooks = hooks;

const React = require("react");
const { renderToString } = require("react-dom/server");
const harnessTs = require("typescript");
const cinemaClient = await import("../src/lib/cinema-client.ts");
const preflightLib = await import("../src/lib/preflight.ts");
const preflightGuard = await import("../src/lib/preflight-guard.ts");
const preflightStore = await import("../src/lib/preflight-store.ts");
const productionAssistantLib = await import("../src/lib/production-assistant.ts");
const productionAssistantStore = await import("../src/lib/production-assistant-store.ts");
const typesLib = await import("../src/lib/types.ts");
const pageAgentRunsModule = await import("../src/lib/page-agent/page-agent-runs.ts");
const cinemaConnectionsModule = await import("../src/components/app/cinema-connections.tsx");
const stageCopilotModule = await import("../src/lib/stage-copilot.ts");
const pageAgentCoreModule = await import("@kylebrodeur/page-agent-core");
const studioToolsModule = await import("../src/lib/webmcp/studio-tools.ts");
const studioToolAdapterModule = await import("../src/lib/page-agent/studio-tool-adapter.ts");
const pageAgentRuntimeModule = await import("../src/lib/page-agent/page-agent-runtime.ts");
const { ProductionAssistantProvider, ProductionAssistantSidebar } = await import(
  "../src/components/app/production-assistant-sidebar.tsx"
);
const { PreflightControl } = await import("../src/components/app/preflight-control.tsx");
const { AssistantMarkdown } = await import("../src/components/app/assistant-markdown.tsx");
const { STUDIO_TOOLS, executeStudioTool } = await import("../src/lib/webmcp/studio-tools.ts");
const { buildStudioPageAgentTools } = await import("../src/lib/page-agent/studio-tool-adapter.ts");
const { createPageAgentChatFetch, PAGE_AGENT_MODEL } = await import(
  "../src/lib/page-agent/page-agent-runtime.ts"
);
const { useSlate } = await import("../src/lib/store.ts");
const { setAssistantDraft } = await import("../src/lib/production-assistant-store.ts");
const { createBlankProject } = await import("../src/lib/sample-project.ts");

test("desktop entry keeps the discoverable Production Assistant toggle and mounts the co-pilot dock on open", () => {
  const project = createBlankProject();
  project.name = "Sidebar integration proof";
  useSlate.setState({ project, view: "script" });

  const render = ({ open, tab }) => {
    let closeCalls = 0;
    const tree = renderToString(
      React.createElement(
        ProductionAssistantProvider,
        null,
        React.createElement(PreflightControl, {
          presentation: "workspace",
          copilotOpen: open,
          onToggleCopilot: () => {},
          onOpenCopilotChecks: () => {},
        }),
        React.createElement(ProductionAssistantSidebar, {
          open,
          onClose: () => {
            closeCalls += 1;
          },
          tab,
          onTabChange: () => {},
        }),
      ),
    );
    return { html: tree, closeCalls };
  };

  const closed = render({ open: false, tab: "gemini" });
  assert.ok(!closed.html.includes("production-assistant-sidebar"), "closed sidebar must not mount the dock");
  assert.ok(
    closed.html.includes('aria-label="Toggle Production Assistant"'),
    "recoverable reopen control must stay rendered while the dock is closed",
  );
  assert.ok(closed.html.includes('aria-expanded="false"'), "the toggle must report expanded=false while closed");

  const opened = render({ open: true, tab: "gemini" });
  assert.ok(opened.html.includes('id="production-assistant-sidebar"'), "the dock must mount by id");
  assert.ok(opened.html.includes("Production Assistant co-pilot panel"), "the dock must carry its accessible label");
  assert.ok(opened.html.includes("Toggle Production Assistant"), "the reopen control must stay rendered while open");
  assert.ok(opened.html.includes('aria-expanded="true"'), "the toggle must report expanded=true while open");
  assert.ok(opened.html.includes("Close Production Assistant sidebar"), "the dock must expose a close control");
  // Tabs are legible at the dock width: short labels ("Research"), full aria
  // labels, full-width centered pills.
  for (const label of ["Assistant", "Research", "Checks"]) {
    assert.ok(opened.html.includes(label), `the dock must list the ${label} tab`);
  }
  assert.ok(opened.html.includes('aria-selected="true"'), "the active tab must be marked selected");
  // The Page Agent surface lives inside the assistant chat flow, so there is
  // no standalone Page agent tab button anymore.
  assert.equal((opened.html.match(/role="tab"/g) ?? []).length, 3, "the dock must consolidate to three tabs");
  assert.ok(!opened.html.includes(">Page agent<"), "the standalone Page agent tab must be gone");
  const tabButtons = [...opened.html.matchAll(/<button[^>]*class="inline-flex h-7 min-w-0 flex-1[^"]*"[^>]*>/g)];
  assert.ok(tabButtons.length === 3, "every dock tab must render full-width");
  assert.ok(tabButtons.every((match) => match[0].includes("justify-center")), "every dock tab label must be centered");
});

test("sidebar panes render the real chat (with the merged Page Agent), activity and checks panes", () => {
  const project = useSlate.getState().project;
  const renderTab = (tab) =>
    renderToString(
      React.createElement(
        ProductionAssistantProvider,
        null,
        React.createElement(ProductionAssistantSidebar, {
          open: true,
          onClose: () => {},
          tab,
          onTabChange: () => {},
        }),
      ),
    );

  const chat = renderTab("gemini");
  assert.ok(chat.includes("Focused context"), "the chat pane must mount the assistant surface");
  assert.ok(
    chat.includes('aria-label="Ask the assistant"'),
    "the chat pane must render the CollabPanel-style composer card",
  );
  assert.ok(
    chat.includes("Connect to get started"),
    "the chat pane must offer the connect affordance when no google-cloud connection is configured",
  );
  assert.ok(
    !/<div[^>]*aria-label="Connect to get started"/.test(chat),
    "the stacked 'Connect to get started' card must be replaced by the affordance in the slim status line",
  );
  // The unified composer is the only input on the Assistant tab: one textarea,
  // no separate Page Agent task field, and no Run/Stop pair on its card. Tucked
  // options menu, route chips and the single send complete the row.
  assert.equal((chat.match(/<textarea/g) ?? []).length, 1, "the assistant chat flow must expose exactly one textbox");
  assert.ok(!chat.includes("Describe a task"), "the separate agent task textarea must be gone");
  assert.ok(!chat.includes('aria-label="Page Agent task"'), "the old copilot input must not survive in any form");
  assert.ok(!chat.includes(">Run task<"), "the copilot card must not carry its own Run control");
  // The Copilot streams inline in this feed while a run lives; idle it
  // renders nothing at all, so the idle pane proves no narration chrome
  // remains anywhere.
  assert.ok(
    !chat.includes('aria-label="Copilot"'),
    "the idle feed must carry no copilot stream chrome",
  );
  assert.ok(
    chat.includes("Ask about your film"),
    "the idle assistant shows the single-assistant conversation invite",
  );
  assert.ok(
    chat.includes('aria-label="Toggle Parallel research for the next ask"') &&
      chat.includes('aria-pressed="false"'),
    "the research toggle must be a direct aria-pressed chip on the open row",
  );
  assert.ok(
    chat.includes("Toggle official Gemini docs grounding for the next ask"),
    "the Gemini docs toggle must be a visible chip on the open row",
  );
  assert.ok(
    !chat.includes('aria-label="Composer options"') && !chat.includes('aria-haspopup="menu"'),
    "the buried options popover must stay gone: a click on it used to submit the form",
  );
  assert.ok(
    chat.includes("Tell the assistant what to do in the studio"),
    "the one composer drives the single assistant and keeps its composer placeholder",
  );
  assert.ok(chat.includes("Send</button>"), "the composer must expose its single send control");

  const research = renderTab("activity");
  assert.ok(
    research.includes("Parallel research activity"),
    "the research pane must expose the standalone Parallel research activity",
  );
  assert.ok(
    research.includes("separate web-research job from the Gemini answer"),
    "the research pane must keep its job boundary explanation",
  );
  assert.ok(
    !research.includes("Copilot tasks"),
    "the research pane must not carry Copilot tasks (the Copilot streams in the Assistant tab)",
  );
  // Idle Copilot chrome left the chat feed entirely (spec section 4): no
  // narration card, no footer chip while the run is idle.
  assert.ok(
    !chat.includes("Copilot activity") && !chat.includes('aria-label="Copilot run status"'),
    "the idle chat feed must carry no copilot narration or footer chip",
  );
  assert.ok(
    !research.includes('aria-label="Parallel research status"'),
    "the research pane must render the pending job as a research row, not the feed card",
  );

  const checks = renderTab("checks");
  assert.ok(checks.includes("Production checks"), "the checks pane must mount the production checks");
  assert.ok(checks.includes("Local checks update as you edit"), "the checks pane must explain live local checks");
  // There is no standalone agent tab: the Page Agent surface lives in the chat
  // flow (asserted above).
});

// The zustand v5 SSR path seeds every store read from getInitialState, so a
// live store write is invisible to renderToString. The draft round trip is
// proven by executing the real ProductionAssistantProvider and
// ProductionAssistantSidebar component functions (compiled from source) with
// controlled hooks: the context value is the Provider's genuine derived value,
// the panes are the sidebar's real children, and the ask form talks to the
// real production-assistant store.
const harnessComponents = new Proxy({}, { get: (_, key) => key });
const harnessToasts = [];

// Stub browser controller for the harness Page Agent runs: real PageAgentCore
// drives it, but no browser is present. Per-test overrides shape state.
const harnessPageControllerBehavior = {
  getBrowserState: async () => ({
    url: "http://127.0.0.1:8189/",
    content: "",
    header: "",
    footer: "",
  }),
};

class HarnessPageController {
  async getBrowserState() {
    return harnessPageControllerBehavior.getBrowserState();
  }
  async getLastUpdateTime() {
    return 0;
  }
  async showMask() {}
  async hideMask() {}
  async cleanUpHighlights() {}
  dispose() {}
}
// Per-context values registered while materializing Provider nodes (see
// materialize); the pre-existing global contextValue stays as the fallback for
// the production-assistant store context, which is always rendered at the root.
const contextFrames = [];

const harnessReact = {
  pool: null,
  contextValue: undefined,
  useState(initial) {
    const pool = harnessReact.pool;
    const index = pool.state++;
    if (!(index in pool.states)) pool.states[index] = typeof initial === "function" ? initial() : initial;
    return [pool.states[index], (next) => { pool.states[index] = typeof next === "function" ? next(pool.states[index]) : next; }];
  },
  useRef(initial) {
    const pool = harnessReact.pool;
    const index = pool.ref++;
    if (!(index in pool.refs)) pool.refs[index] = { current: initial };
    return pool.refs[index];
  },
  useMemo(calculate) {
    return calculate();
  },
  useCallback(callback) {
    return callback;
  },
  // No-op by default (renders are single-pass); the in-flight-run steering
  // proof swaps in a mount-only effect runner and restores it afterwards.
  useEffect() {},
  createContext: (defaultValue) => {
    const ctx = { defaultValue };
    ctx.Provider = { $$harnessProvider: ctx };
    return ctx;
  },
  useContext: (ctx) => {
    const frame = contextFrames.at(-1);
    if (frame?.has(ctx)) return frame.get(ctx);
    if (harnessReact.contextValue !== undefined) return harnessReact.contextValue;
    return ctx.defaultValue;
  },
};

// A zustand hook reading the live store state; getState is attached so
// components can also read actions/state outside subscriptions.
function liveHook(store) {
  const hook = (selector) => selector(store.getState());
  hook.getState = () => store.getState();
  return hook;
}

const {
  ProductionAssistantProvider: HarnessProvider,
  ProductionAssistantSidebar: HarnessSidebar,
} = await (async () => {
  const compiled = harnessTs.transpileModule(
    readFileSync(new URL("../src/components/app/production-assistant-sidebar.tsx", import.meta.url), "utf8"),
    { compilerOptions: { target: harnessTs.ScriptTarget.ES2022, module: harnessTs.ModuleKind.CommonJS, jsx: harnessTs.JsxEmit.ReactJSX } },
  ).outputText;
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: harnessReact,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": harnessComponents,
    "@/components/ui/badge": harnessComponents,
    "@/components/ui/button": harnessComponents,
    "@/components/ui/dialog": harnessComponents,
    "@/components/ui/tabs": harnessComponents,
    "@/components/app/assistant-markdown": harnessComponents,
    "@/components/app/sidebar-dock": harnessComponents,
    "@kylebrodeur/page-agent-core": pageAgentCoreModule,
    // The dynamic PageController import inside the provider resolves through
    // the same require map; the stub keeps the run browser-independent.
    "@kylebrodeur/page-agent-page-controller": { PageController: HarnessPageController },
    "@/lib/webmcp/studio-tools": studioToolsModule,
    "@/lib/page-agent/page-agent-runtime": pageAgentRuntimeModule,
    "@/lib/page-agent/studio-tool-adapter": studioToolAdapterModule,
    "@/components/app/cinema-connections": cinemaConnectionsModule,
    "@/lib/stage-copilot": stageCopilotModule,
    "sonner": {
      toast: {
        success: (message) => harnessToasts.push({ kind: "success", message }),
        error: (message) => harnessToasts.push({ kind: "error", message }),
      },
    },
    "@/lib/cinema-client": cinemaClient,
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/lib/use-generation-credits": { useGenerationCredits: () => null },
    "@/lib/page-agent/page-agent-runs": { ...pageAgentRunsModule, usePageAgentRuns: liveHook(pageAgentRunsModule.usePageAgentRuns) },
    "@/lib/preflight": preflightLib,
    "@/lib/preflight-guard": preflightGuard,
    "@/lib/preflight-store": { usePreflight: liveHook(preflightStore.usePreflight) },
    "@/lib/production-assistant": productionAssistantLib,
    "@/lib/production-assistant-store": { ...productionAssistantStore, useProductionAssistant: liveHook(productionAssistantStore.useProductionAssistant) },
    "@/lib/store": { useSlate: liveHook(useSlate) },
    "@/lib/types": typesLib,
  };
  const exports = {};
  new Function("require", "exports", compiled)((specifier) => dependencies[specifier] ?? harnessComponents, exports);
  return exports;
})();

function executeComponent(type, props, pools = null) {
  const previous = harnessReact.pool;
  let pool;
  if (pools) {
    // React keeps hook state alive across re-renders; a pools registry gives
    // the harness the same semantics for one orchestrated render session. Hook
    // counters reset per pass so call order maps onto the same state slots.
    pool = pools.get(type);
    if (!pool) {
      pool = { state: 0, ref: 0, states: [], refs: [], effectsRun: false, pooled: true };
      pools.set(type, pool);
    }
    pool.state = 0;
    pool.ref = 0;
  } else {
    pool = { state: 0, ref: 0, states: [], refs: [], effectsRun: false, pooled: false };
  }
  harnessReact.pool = pool;
  try {
    return type(props);
  } finally {
    harnessReact.pool = previous;
  }
}

let harnessNodes = 0;

function materialize(node, depth = 0, pools = null) {
  if (harnessNodes++ > 8192 || depth > 32) return null;
  if (Array.isArray(node)) return node.map((entry) => materialize(entry, depth + 1, pools));
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") {
    const rendered = executeComponent(node.type, node.props ?? {}, pools);
    return materialize(rendered, depth + 1, pools);
  }
  if (node.type && typeof node.type === "object" && node.type.$$harnessProvider) {
    // Context.Provider: register the value for the subtree, mirroring real
    // context scoping (components execute while walking the children). The
    // type is sanitized to a string so tree JSON stays serializable.
    contextFrames.push(new Map([[node.type.$$harnessProvider, node.props.value]]));
    try {
      return {
        type: "ContextProvider",
        props: { ...node.props, children: materialize(node.props?.children, depth + 1, pools) },
        key: node.key,
      };
    } finally {
      contextFrames.pop();
    }
  }
  return { type: node.type, props: { ...node.props, children: materialize(node.props?.children, depth + 1, pools) }, key: node.key };
}

function renderHarnessSidebar({ open, tab }, pools = null) {
  const closes = [];
  const tabChanges = [];
  const provided = executeComponent(HarnessProvider, { children: null });
  harnessReact.contextValue = provided.props.value;
  harnessNodes = 0;
  const sidebar = materialize(executeComponent(HarnessSidebar, {
    open,
    onClose: () => closes.push(true),
    tab,
    onTabChange: (next) => tabChanges.push(next),
  }, pools), 0, pools);
  harnessReact.contextValue = undefined;
  const rerender = () => renderHarnessSidebar({ open, tab }, pools);
  return { sidebar, closes, tabChanges, ...(pools ? { rerender } : {}) };
}

function findNode(tree, predicate, label) {
  let match = null;
  let count = 0;
  const visit = (node) => {
    if (match || count > 4096) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    count++;
    if (predicate(node)) {
      match = node;
      return;
    }
    const children = node.props?.children;
    visit(children);
  };
  visit(tree);
  assert.ok(match, label ?? "expected node was not found");
  return match;
}

function hasNode(tree, predicate) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (predicate(node)) {
      found = true;
      return;
    }
    visit(node.props?.children);
  };
  visit(tree);
  return found;
}

const STEERING_PLACEHOLDER = "The assistant is working — your message steers the run…";

/** Every non-hidden node in the rendered tree; hidden subtrees stay invisible. */
function visibleNodes(tree) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.props?.hidden === true) return;
    out.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  return out;
}

/** Count nodes matching a predicate across the rendered tree. */
function countNodes(tree, predicate) {
  return visibleNodes(tree).filter(predicate).length;
}

test("chat drafts persist through the production-assistant store across tab switches", () => {
  const project = useSlate.getState().project;
  const originalDraft = "Check my coverage gaps before the next shoot.";
  setAssistantDraft(project.id, originalDraft);

  const first = renderHarnessSidebar({ open: true, tab: "gemini" });
  const askForm = findNode(first.sidebar, (node) => node.type === "textarea", "the ask form textarea");
  // One input only: the unified composer replaced both the ask form and the
  // Page Agent task field.
  assert.equal(
    countNodes(first.sidebar, (node) => node.type === "textarea"),
    1,
    "the assistant tab must expose exactly one textbox",
  );
  assert.equal(askForm.props.value, originalDraft, "the ask form must render the stored draft");

  const second = renderHarnessSidebar({ open: true, tab: "checks" });
  assert.equal(second.closes.length, 0, "rendering another tab must not close the sidebar");

  const nextDraft = "Focus on the missing coverage for the tavern scene.";
  const third = renderHarnessSidebar({ open: true, tab: "gemini" });
  const revisited = findNode(third.sidebar, (node) => node.type === "textarea");
  assert.equal(revisited.props.value, originalDraft, "returning to the assistant tab must show the stored draft");

  // Typing drives the store through the form's onChange, exactly as in SlateApp.
  revisited.props.onChange({ target: { value: nextDraft } });
  assert.equal(
    productionAssistantStore.useProductionAssistant.getState().sessions[project.id]?.draft,
    nextDraft,
    "typing must commit the draft through the real production-assistant store",
  );
  const fourth = renderHarnessSidebar({ open: true, tab: "gemini" });
  assert.equal(findNode(fourth.sidebar, (node) => node.type === "textarea").props.value, nextDraft, "the new draft must be visible on the next render");
  setAssistantDraft(project.id, "");
});

test("copilot runs history no longer renders as separate task cards in the assistant pane", () => {
  const project = useSlate.getState().project;
  const text = (rendered) => JSON.stringify(rendered.sidebar === undefined ? rendered : rendered.sidebar);
  const taskText = "Compare the ordered picture clips with the shot list.";
  const summary = "Ordered the master after the saloon beat.";

  // The Copilot's work streams inline in the chat feed; the recorded runs
  // history drives only the Research tab pill — no separate task cards and no
  // empty-tasks banner.
  const empty = renderHarnessSidebar({ open: true, tab: "gemini" });
  assert.ok(
    !text(empty).includes("No Copilot tasks yet"),
    "the assistant pane must not show a dead empty-tasks banner",
  );

  pageAgentRunsModule.recordRunStarted(project.id, { runId: "run_proof_1", task: taskText });
  const started = renderHarnessSidebar({ open: true, tab: "gemini" });
  assert.ok(!text(started).includes(taskText), "a recorded run must not render as a separate task card");
  assert.ok(!text(started).includes("Copilot tasks"), "no separate Copilot tasks section may remain");

  pageAgentRunsModule.recordRunFinished(project.id, { runId: "run_proof_1", status: "completed", summary });
  const settled = renderHarnessSidebar({ open: true, tab: "gemini" });
  assert.ok(!text(settled).includes(summary), "a settled run must not render its summary as a standalone card");

  // An unknown run id must not clobber real records.
  pageAgentRunsModule.recordRunFinished(project.id, { runId: "run_other", status: "failed", summary: "should not match" });
  const guarded = renderHarnessSidebar({ open: true, tab: "gemini" });
  assert.ok(!text(guarded).includes("should not match"), "an unmatched finish call must not surface anything in the pane");
});

test("the assistant tab offers a connect affordance that opens Settings on the app tab", () => {
  const project = useSlate.getState().project;
  const captured = [];
  const fakeWindow = new EventTarget();
  fakeWindow.addEventListener(cinemaConnectionsModule.SLATE_OPEN_SETTINGS_EVENT, (event) => {
    captured.push({ type: event.type, detail: event.detail });
  });
  const priorWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const rendered = renderHarnessSidebar({ open: true, tab: "gemini" });

    // The slim status line is ONE element carrying both the model status and
    // the connection state — collapsed from the old stacked config cards.
    const line = findNode(
      rendered.sidebar,
      (node) => typeof node.type === "string" && node.props?.["aria-label"] === "Assistant connection status",
      "the slim assistant status line",
    );
    assert.equal(line.type, "p", "the status line must be a single paragraph element, not a card stack");
    const lineText = JSON.stringify(line);
    assert.ok(
      lineText.includes("unavailable") || lineText.includes("paused") || lineText.includes("running"),
      "the status line must report the model running/paused status",
    );
    assert.ok(
      lineText.includes("Connect to get started"),
      "the status line must carry the connection state so the connect affordance lives inside it",
    );

    // No stacked config cards remain: the connect card is gone and both picker
    // checkboxes now live in the tucked options menu.
    assert.ok(
      !hasNode(
        rendered.sidebar,
        (node) => typeof node.type === "string" && node.type === "div" && node.props?.["aria-label"] === "Connect to get started",
      ),
      "the stacked 'Connect to get started' card must be replaced by the status line",
    );

    // The one bordered composer card: single send, route chips, the toggle
    // chips and the quick action live inside ONE card. The research/docs
    // toggles are direct aria-pressed chips on the open row (replacing the
    // buried Options popover, whose clicks used to submit the form); the
    // Submit-typed Send stays the only element that submits.
    const composerCard = findNode(
      rendered.sidebar,
      (node) => node.type === "form" && node.props?.["aria-label"] === "Ask the assistant",
      "the unified composer card",
    );
    const cardText = JSON.stringify(composerCard);
    assert.ok(cardText.includes('"Send"'), "the send button must live inside the composer card");
    assert.ok(cardText.includes("+ Production review"), "the quick action must live inside the composer card");
    assert.ok(cardText.includes("Focused context"), "the context pills must live on the composer header");
    // The composer is Copilot-first: no Ask/Copilot route toggle remains.
    assert.ok(
      !hasNode(
        rendered.sidebar,
        (node) => node.props?.["aria-label"] === "Assistant composer routing",
      ),
      "the Ask/Copilot route toggle must be gone from the Copilot-first composer",
    );
    const researchChip = findNode(
      rendered.sidebar,
      (node) => node.props?.["aria-label"] === "Toggle Parallel research for the next ask",
      "the Parallel research toggle chip",
    );
    assert.equal(researchChip.props.type, "button", "the research chip must never submit the composer form");
    assert.equal(researchChip.props["aria-pressed"], false, "the research chip starts unpressed");
    const docsChip = findNode(
      rendered.sidebar,
      (node) => node.props?.["aria-label"] === "Toggle official Gemini docs grounding for the next ask",
      "the Gemini docs toggle chip",
    );
    assert.equal(docsChip.props.type, "button", "the docs chip must never submit the composer form");
    assert.equal(docsChip.props["aria-pressed"], false, "the docs chip starts unpressed");
    assert.ok(
      !hasNode(
        rendered.sidebar,
        (node) => node.props?.["aria-label"] === "Composer options" || node.props?.role === "menu",
        "the buried options popover trigger and menu",
      ),
      "the buried options popover must stay gone",
    );

    const button = findNode(
      line,
      (node) => typeof node.type === "string" && node.type === "Button" && node.props?.["aria-label"] === "Connect to get started",
      "the connect button inside the status line",
    );
    button.props.onClick();

    assert.equal(captured.length, 1, "the connect button must dispatch exactly one settings open event");
    assert.equal(captured[0].type, cinemaConnectionsModule.SLATE_OPEN_SETTINGS_EVENT);
    assert.deepEqual(captured[0].detail, { tab: "app" }, "Settings must be asked for the app connection tab");
  } finally {
    globalThis.window = priorWindow;
  }
});

test("the checks and assistant tabs carry the stage-director surfaces for the focused shot", async () => {
  const { emptyShot } = typesLib;
  const priorProject = useSlate.getState().project;
  const priorSelectedId = useSlate.getState().selectedId;
  const sceneId = `el_${Date.now().toString(36)}`;
  const beatId = `${sceneId}_a`;
  const project = createBlankProject();
  project.script = [
    { id: sceneId, kind: "scene", text: "INT. TAVERN - DAY" },
    { id: beatId, kind: "action", text: "The traveller pauses." },
  ];
  const firstShot = emptyShot({ id: "shot-a", setup: "1A", title: "Establishing", sceneId, elementIds: [beatId], action: "An establishing pause." });
  const secondShot = emptyShot({ id: "shot-b", setup: "2H", title: "Reverse", sceneId, elementIds: [beatId], action: "The reverse." });
  project.shots = [firstShot, secondShot];
  useSlate.setState({ project, selectedId: "shot-b" });

  try {
    const restoreProject = useSlate.getState().project;
    assert.ok(restoreProject === project, "the focused-shot fixture must be the live project");

    // Director continuity: selected shot wins, first shot is the fallback, and
    // the advisory language stays honest.
    const checksView = renderHarnessSidebar({ open: true, tab: "checks" });
    const continuity = findNode(
      checksView.sidebar,
      (node) => node.props?.["aria-label"] === "Director continuity",
      "the Director continuity section",
    );
    const continuityText = JSON.stringify(continuity);
    assert.ok(continuityText.includes("2H"), "the continuity section must target the selected shot's setup");
    assert.ok(continuityText.includes("Continuity not assessed"), "the not-assessed note must stay present");
    assert.ok(
      !JSON.stringify(checksView.sidebar).includes("Continuity Verified") &&
      !JSON.stringify(checksView.sidebar).includes("Anchored to Master"),
      "continuity cards must never claim a verified or master-anchored verdict",
    );

    useSlate.setState({ selectedId: null });
    const fallbackView = renderHarnessSidebar({ open: true, tab: "checks" });
    assert.ok(
      JSON.stringify(findNode(fallbackView.sidebar, (node) => node.props?.["aria-label"] === "Director continuity", "fallback continuity section")).includes("1A"),
      "without a selection the continuity section must fall back to the first shot",
    );
    useSlate.setState({ selectedId: "shot-b" });

    // Stage prompt synthesizer: the full card now lives in the Stage view dock.
    // The assistant pane carries only the compact affordance: load the prompt
    // into the composer or copy it; never a prompt mutation.
    const prompt = stageCopilotModule.synthesizeStagePrompt(secondShot);
    assert.ok(prompt.length > 0, "the synthesizer must produce a staged prompt for the shot");
    const chatView = renderHarnessSidebar({ open: true, tab: "gemini" });
    const card = findNode(
      chatView.sidebar,
      (node) => node.props?.["aria-label"] === "Stage prompt synthesizer",
      "the stage prompt affordance",
    );
    const cardText = JSON.stringify(card);
    assert.ok(cardText.includes("2H"), "the assistant affordance must target the selected shot's setup");
    assert.ok(!cardText.includes(prompt.slice(0, 40)), "the full prompt text no longer renders inside the assistant pane");
    const useButton = findNode(
      card,
      (node) => node.props?.["aria-label"] === "Load stage prompt into the question composer",
      "the load-into-composer button",
    );
    useButton.props.onClick();
    assert.equal(
      productionAssistantStore.useProductionAssistant.getState().sessions[useSlate.getState().project.id]?.draft,
      prompt,
      "loading must place the synthesized prompt into the draft composer",
    );
    assert.ok(
      harnessToasts.some((entry) => entry.kind === "success" && /Stage prompt loaded/.test(entry.message)),
      "loading must report success through the toast",
    );
    const copyButton = findNode(
      card,
      (node) => node.props?.["aria-label"] === "Copy synthesized stage prompt",
      "the copy button",
    );
    const writes = [];
    let clipboardStubbed = false;
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: { writeText: (text) => { writes.push(text); return Promise.resolve(); } },
        configurable: true,
      });
      clipboardStubbed = true;
    }
    const fingerprintBefore = JSON.stringify(useSlate.getState().project);
    harnessToasts.length = 0;
    copyButton.props.onClick();
    // The toast fires off the clipboard promise; yield to it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (clipboardStubbed) {
      assert.deepEqual(writes, [prompt], "copying must write exactly the synthesized prompt");
    }
    assert.ok(
      harnessToasts.some((entry) => entry.kind === "success" && /Stage prompt copied/.test(entry.message)),
      "copying must report success through the toast",
    );
    assert.equal(
      JSON.stringify(useSlate.getState().project),
      fingerprintBefore,
      "copying the suggestion must not mutate the project or the authored prompt",
    );
    // There is no "Set as Imagine Prompt" affordance anywhere in the card.
    assert.ok(!cardText.includes("Set as Imagine Prompt"), "the synthesizer must not offer a prompt-setting action");
    if (globalThis.navigator && clipboardStubbed) {
      Object.defineProperty(globalThis.navigator, "clipboard", { value: undefined, configurable: true });
    }
  } finally {
    useSlate.setState({ project: priorProject, selectedId: priorSelectedId });
  }
});

test("Page Agent custom tools come from the current STUDIO_TOOLS catalog with confirmation gating", async () => {
  const descriptors = STUDIO_TOOLS.map((tool) => tool.name);
  const creative = STUDIO_TOOLS.filter(
    (tool) => !tool.annotations.readOnlyHint && tool.annotations.consequentialHint,
  ).map((tool) => tool.name);

  const withConfirmation = buildStudioPageAgentTools({
    runner: executeStudioTool,
    onConfirmTool: async () => true,
  });
  const withoutConfirmation = buildStudioPageAgentTools({ runner: executeStudioTool });

  for (const name of descriptors) {
    assert.ok(name in withConfirmation, `${name} must be offered to PageAgentCore`);
    assert.ok(name in withoutConfirmation, `${name} must stay mapped without a confirmation handler`);
  }
  for (const name of creative) {
    const tool = withConfirmation[name];
    assert.ok(tool, `creative tool ${name} must be offered when a confirmation handler exists`);
    assert.equal(tool.destructive, true, `${name} must be marked destructive for the confirmation flow`);
    assert.ok(
      typeof tool.confirmationLabel === "string" && tool.confirmationLabel.length > 0,
      `${name} must carry a filmmaker-facing confirmation label`,
    );
    assert.equal(
      withoutConfirmation[name],
      null,
      `creative tool ${name} must never be offered without a host confirmation handler`,
    );
  }
  for (const name of ["click_element_by_index", "input_text", "select_dropdown_option", "execute_javascript"]) {
    assert.equal(withConfirmation[name], null, `${name} must stay disabled by default`);
  }

  // Navigation custom tool executes the real studio authority against the
  // real store: the same call the page agent would make at runtime.
  useSlate.setState({ view: "script" });
  const tool = withConfirmation["set_view"];
  const output = await tool.execute({ view: "stage" }, { signal: new AbortController().signal });
  assert.ok(typeof output === "string" && output.length > 0, "set_view must return tool output text");
  assert.equal(useSlate.getState().view, "stage", "set_view must drive the real store through executeStudioTool");
  useSlate.setState({ view: "script" });

  // A creative tool with invalid arguments surfaces the real failure without
  // mutating anything; the runner output is what reaches the model.
  const failure = await withConfirmation["patch_shot"].execute({}, { signal: new AbortController().signal });
  assert.match(
    String(failure),
    /^Tool "patch_shot" failed:/,
    "failed tool runs must surface the real error as tool output",
  );

  // The chat binding contract stays bound to the backend page-agent endpoint:
  // the same-origin fetch rewrites the destination and extends the request
  // body with the session binding the backend validates.
  assert.equal(PAGE_AGENT_MODEL, "slate-production-assistant");
  const priorFetch = globalThis.fetch;
  const priorWindow = globalThis.window;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input?.url ?? input), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  globalThis.window = { location: { origin: "http://127.0.0.1:8080" } };
  try {
    const fetcher = createPageAgentChatFetch({
      projectId: () => "proj_integration",
      pageId: () => "page_integration",
      runId: () => "run_integration",
      connectionId: () => "conn_integration",
      expectedRevision: () => 1,
      view: () => "stage",
      researchEnabled: () => false,
    });
    const response = await fetcher("https://example.invalid/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    const parsed = await response.json();
    assert.equal(requests.length, 1, "exactly one bound chat request must be sent");
    assert.equal(
      requests[0].url,
      "http://127.0.0.1:8080/api/cinema/assistant/chat/completions",
      "chat traffic must be rewritten to the same-origin gateway endpoint",
    );
    assert.equal(requests[0].body.projectId, "proj_integration");
    assert.equal(requests[0].body.pageId, "page_integration");
    assert.equal(requests[0].body.runId, "run_integration");
    assert.equal(requests[0].body.connectionId, "conn_integration");
    assert.equal(requests[0].body.expectedRevision, 1);
    assert.equal(requests[0].body.model, "slate-production-assistant", "the model must be forced to the backend binding");
    assert.equal(requests[0].body.parallel_tool_calls, false);
    assert.equal(requests[0].body.tool_choice, "required");
    assert.equal(parsed.choices[0].message.content, "ok", "the validated completion must pass through");
  } finally {
    globalThis.fetch = priorFetch;
    globalThis.window = priorWindow;
  }
});

test("assistant Markdown drops raw HTML, javascript: URLs and keeps safe https links", () => {
  const payload = [
    "<script>alert(1)</script>",
    "",
    "## Scene notes",
    "",
    '[run it](javascript:alert(1))',
    "[Parallel docs](https://parallel.tomato/research)",
    "![trick](javascript:alert(2))",
    "**Bold creative choice.**",
  ].join("\n");
  const html = renderToString(React.createElement(AssistantMarkdown, { children: payload }));
  assert.ok(!html.includes("<script"), "raw HTML must be discarded");
  assert.ok(!html.includes('src="javascript:'), "javascript: images must be dropped");
  assert.ok(!html.includes('href="javascript:'), "javascript: URLs must never become links");
  assert.ok(
    new RegExp('href="https://parallel\\.tomato/research"').test(html),
    "safe https links must render as links",
  );
  assert.ok(html.includes('target="_blank"') && html.includes('rel="noreferrer"'), "safe links must not leak the opener");
  assert.ok(html.includes("run it"), "safe link text must still render");
  assert.ok(html.includes("<strong>Bold creative choice.</strong>"), "ordinary markdown must render");
});

const AGENT_ROUTE_PLACEHOLDER =
  "Tell the assistant what to do in the studio; it can use the studio tools…";

test("the composer steers an in-flight Page Agent run from the one textbox and returns to Send after it settles", async () => {
  const project = createBlankProject();
  project.name = "Steering proof";
  useSlate.setState({ project, view: "script" });

  const priorFetch = globalThis.fetch;
  const priorWindow = globalThis.window;
  const priorUseEffect = harnessReact.useEffect;
  const requests = [];
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const completion = (action) =>
    json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                function: {
                  name: "AgentOutput",
                  arguments: JSON.stringify({
                    evaluation_previous_goal: "No earlier step.",
                    memory: "Task started.",
                    next_goal: "Finish and report.",
                    action,
                  }),
                },
                id: "call_harness_agentoutput",
              },
            ],
          },
        },
      ],
    });
  let chatGateResolvers = [];
  const releaseChat = () => {
    for (const resolve of chatGateResolvers.splice(0)) resolve(completion({ wait: { seconds: 1 } }));
  };

  globalThis.window = { location: { origin: "http://127.0.0.1:8189" } };
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.includes("/api/cinema/connections")) {
      return json({
        connections: [
          {
            connectionId: "conn_harness",
            provider: "google-cloud",
            status: "configured",
            expiresAt: Date.now() / 1000 + 3600,
          },
        ],
      });
    }
    if (url.includes("/api/cinema/health")) {
      return json({ liveVerified: true, capabilities: { preflight: { status: "configured", model: "Google ADK" } } });
    }
    if (url.includes("/api/cinema/projects")) {
      return json({ projectId: "proj_harness", revision: 7 });
    }
    if (url.includes("/api/cinema/assistant/chat/completions")) {
      requests.push(init?.body ? JSON.parse(init.body) : null);
      if (requests.length === 1) {
        // The first think stays in flight until the proof has driven steering.
        return new Promise((resolve) => chatGateResolvers.push(resolve));
      }
      return completion({ done: { text: "The ordered picture clips already match the shot list.", success: true } });
    }
    return json({ error: { message: "unexpected fetch", code: "unexpected" } });
  };
  const pools = new Map();
  harnessReact.useEffect = (callback) => {
    const pool = harnessReact.pool;
    if (pool?.pooled && !pool.effectsRun) {
      pool.effectsRun = true;
      callback();
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const composerTextarea = (state) =>
    findNode(state.sidebar, (node) => node.type === "textarea", "the composer textarea");
  const waitForPlaceholders = async (state, want) => {
    let current = state;
    let textarea = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      current = current.rerender();
      textarea = findNode(current.sidebar, (node) => node.type === "textarea", "the composer textarea");
      if (textarea.props.placeholder === want) return { state: current, textarea };
      await sleep(20);
    }
    assert.equal(textarea?.props.placeholder, want, "timed out waiting for the expected composer placeholder");
    return { state: current, textarea };
  };

  try {
    let state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    // Mount effects ran; typing and routing live only in the composer.
    assert.equal(
      countNodes(state.sidebar, (node) => node.type === "textarea"),
      1,
      "the assistant tab must still expose exactly one textbox",
    );
    assert.equal(composerTextarea(state).props.placeholder, AGENT_ROUTE_PLACEHOLDER, "the idle composer carries the copilot placeholder by default");
    assert.ok(
      findNode(state.sidebar, (node) => node.type === "button" && node.props["aria-label"] === "Toggle Parallel research for the next ask", "the research toggle chip"),
    );

    // The composer is Copilot-first: no route chip to switch. The single
    // textbox drives the Page Agent directly.

    const task = "Compare the ordered picture clips with the shot list.";
    setAssistantDraft(project.id, task);
    state = state.rerender();
    assert.equal(composerTextarea(state).props.value, task, "the agent route composes in the single stored draft");

    // Send starts the Page Agent run.
    findNode(
      state.sidebar,
      (node) => node.type === "Button" && JSON.stringify(node.props.children).includes('"Send"'),
      "the send control",
    ).props.onClick();

    // While the run is in flight the same single box becomes a steering control.
    const inFlight = await waitForPlaceholders(state, STEERING_PLACEHOLDER);
    state = inFlight.state;
    assert.ok(
      JSON.stringify(findNode(state.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Steer the running agent", "the steering send control").props.children).includes('"Steer"'),
      "Send must switch to steering while the run is in flight",
    );
    assert.ok(
      countNodes(state.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Stop the running assistant") > 0,
      "the run's Stop control must surface in the composer",
    );
    assert.equal(
      countNodes(state.sidebar, (node) => node.type === "textarea"),
      1,
      "steering must ride the one composer textbox",
    );
    assert.equal(
      productionAssistantStore.useProductionAssistant.getState().sessions[project.id]?.draft ?? "",
      "",
      "starting an agent task must consume the composer text",
    );

    // Steer the run: same box, same send control. The first think is confirmed
    // in flight first, so the queued steering drains deterministically at the
    // run's next step instead of racing it.
    for (let attempt = 0; attempt < 240 && requests.length < 1; attempt++) await sleep(25);
    assert.equal(requests.length, 1, "the first think must reach the stubbed gateway");
    const steer = "Look at the shot list before the edit view.";
    setAssistantDraft(project.id, steer);
    state = state.rerender();
    findNode(
      state.sidebar,
      (node) => node.type === "Button" && JSON.stringify(node.props.children).includes('"Steer"'),
      "the steering send control",
    ).props.onClick();
    state = state.rerender();
    assert.equal(
      productionAssistantStore.useProductionAssistant.getState().sessions[project.id]?.draft ?? "",
      "",
      "a steered message must clear the composer",
    );
    // The Copilot streams inline in the chat feed: the footer chip above the
    // composer stays a pure status, and the typed task reads as an ordinary
    // user message beside the run's entries.
    const chip = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Assistant run status",
      "the assistant footer status chip",
    );
    assert.ok(!!chip, "the footer must carry the assistant run status");
    assert.ok(
      JSON.stringify(state.sidebar).includes(task),
      "the sent task must appear as a chat message in the feed",
    );
    assert.ok(
      JSON.stringify(state.sidebar).includes(steer),
      "the feed must show the queued steering message while the run is in flight; the streaming article is transient",
    );

    // The steering must reach the agent loop as operator instructions before the
    // next step, and the run must settle back to Send.
    releaseChat();
    let settled = null;
    for (let attempt = 0; attempt < 240; attempt++) {
      settled = (settled ?? state).rerender();
      const record = (pageAgentRunsModule.usePageAgentRuns.getState().runs[project.id] ?? []).find(
        (entry) => entry.task === task,
      );
      if (record?.status === "completed") break;
      await sleep(25);
    }
    const record = (pageAgentRunsModule.usePageAgentRuns.getState().runs[project.id] ?? []).find(
      (entry) => entry.task === task,
    );
    assert.ok(record?.status === "completed", "the run must settle as completed in the runs feed");
    assert.equal(
      requests[1] ? JSON.stringify(requests[1]).includes("Operator steering for the current task:") && JSON.stringify(requests[1]).includes(steer) : false,
      true,
      "the queued steering must reach the agent loop before its next step",
    );
    settled = settled.rerender();
    assert.equal(
      findNode(settled.sidebar, (node) => node.type === "textarea", "the composer textarea").props.placeholder,
      AGENT_ROUTE_PLACEHOLDER,
      "after the run settles the composer must leave steering mode",
    );
    assert.ok(
      findNode(settled.sidebar, (node) => node.type === "Button" && JSON.stringify(node.props.children).includes('"Send"'), "the send control"),
      "the composer must return to its plain send control",
    );
    assert.equal(
      countNodes(settled.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Stop the running assistant"),
      0,
      "the stop control must disappear once the run settles",
    );
    // The assistant's message feed now carries the run's returned answer; the
    // queued steering cleared when the run settled.
    const settledAssistant = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    const conversation = findNode(
      settledAssistant.sidebar,
      (node) => node.props?.["aria-label"] === "Assistant conversation",
      "the assistant conversation feed",
    );
    assert.ok(
      JSON.stringify(conversation).includes("The ordered picture clips already match the shot list."),
      "the feed must carry the run's returned answer",
    );
    // The settled feed keeps the steering as an ordinary "You" message: the
    // one-conversation surface records operator steering in the chat history
    // instead of a transient queued chip.
    assert.ok(
      JSON.stringify(conversation).includes(steer),
      "the steering message itself remains visible as the user's chat entry",
    );
    // Empty-state gating: wiping the conversation must NOT resurface the
    // invite while the settled Copilot run still carries history and its
    // result — only a genuinely idle assistant shows the empty state now.
    productionAssistantStore.useProductionAssistant.setState((sessionState) => ({
      sessions: {
        ...sessionState.sessions,
        [project.id]: { ...sessionState.sessions[project.id], messages: [] },
      },
    }));
    const emptied = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    assert.ok(
      !JSON.stringify(emptied.sidebar).includes("Start a conversation"),
      "the empty state must stay hidden while Copilot history and result remain",
    );
    // Wiping the conversation history removes the message articles with it;
    // the empty-state invite stays hidden because the settled run's own
    // history and result still live in the Page Agent session.
    assert.ok(
      findNode(
        settled.sidebar,
        (node) => node.props?.["aria-label"] === "Assistant run status",
        "the settled assistant footer status chip",
      ),
      "the footer status chip stays available while the settled run is not idle",
    );
  } finally {
    globalThis.fetch = priorFetch;
    globalThis.window = priorWindow;
    harnessReact.useEffect = priorUseEffect;
  }
});

// --- Research tab redesign (spec sections 2-4) harness proofs ---

const RESEARCH_DONE_QUESTION = "How were taverns lit in 1890s Dublin?";
const RESEARCH_FAILED_QUESTION = "Where were lighthouses built in 1890s Dublin?";

function seedResearchSession(project, { pending, messages }) {
  productionAssistantStore.useProductionAssistant.setState((state) => ({
    sessions: {
      ...state.sessions,
      [project.id]: {
        ...productionAssistantLib.emptyAssistantSession(project.id),
        ...(messages ? { messages } : {}),
        ...(pending ? { researchPending: pending } : {}),
        ...(pending && pending.__faultCode
          ? { researchError: pending.__faultMessage, researchFaultCode: pending.__faultCode }
          : {}),
      },
    },
  }));
}

function researchSource(project) {
  return {
    projectId: project.id,
    fingerprint: "{}",
    reviewFingerprint: "{}",
    backendProjectId: "snap-research",
    sourceRevision: 1,
    resultRevision: null,
  };
}

function failedResearchPending(startedAt, project) {
  return {
    request: {
      kind: "preflight",
      connectionId: "google-a",
      projectId: "snap-research",
      expectedRevision: 1,
      idempotencyKey: "key-failed",
      input: {
        question: RESEARCH_FAILED_QUESTION,
        research: true,
        parallelOnly: true,
        officialDocs: false,
        conversation: [],
      },
    },
    source: researchSource(project),
    jobId: "job-failed",
    startedAt,
  };
}

test("the research tab lists job rows with honest actions and job links highlight rows", () => {
  const project = createBlankProject();
  project.name = "Research tab proof";
  useSlate.setState({ project });
  const now = Date.now();
  const done = {
    id: "key-done:research",
    role: "assistant",
    provider: "parallel",
    text: productionAssistantLib.PARALLEL_RESEARCH_NOTE,
    sources: [{ title: "Archives", url: "https://example.org/archives" }],
    jobId: "job-done",
    question: RESEARCH_DONE_QUESTION,
    finishedAt: now,
    researchDurationMs: 65_000,
  };
  const withoutSources = {
    ...done,
    id: "key-bare:research",
    jobId: "job-bare",
    question: "What did 1890s Dublin market sellers shout?",
    sources: [],
    researchDurationMs: 12_000,
  };
  const answerWithSuggestion = {
    id: "key-done:answer",
    role: "assistant",
    text: "Use warmer practicals.",
    suggestion: { question: RESEARCH_DONE_QUESTION },
  };
  const failed = failedResearchPending(now - 65_000, project);
  failed.__faultCode = "PARALLEL_TIMEOUT";
  failed.__faultMessage = "Parallel Search timed out. (PARALLEL_TIMEOUT)";
  const pools = new Map();

  try {
    seedResearchSession(project, {
      messages: [answerWithSuggestion, done, withoutSources],
      pending: failed,
    });

    // The Assistant feed stays pure chat: research results filtered out, the
    // answer's suggestion renders as the job LINK (the job already exists).
    let state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    assert.ok(
      !JSON.stringify(state.sidebar).includes("key-done:research"),
      "a delivered research message must not feed the sidebar chat",
    );
    const linkChip = findNode(
      state.sidebar,
      (node) =>
        node.type === "button" &&
        node.props["aria-label"] === `View the research job for: ${RESEARCH_DONE_QUESTION}`,
      "the suggestion's job link chip",
    );
    linkChip.props.onClick();
    assert.ok(
      state.tabChanges.includes("activity"),
      "the suggestion chip job link must switch to the Research tab",
    );

    // Research tab: research rows first (failed row, then done rows), then
    // Reports, then Copilot tasks.
    state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    const activityText = JSON.stringify(state.sidebar);
    assert.ok(activityText.includes("Parallel research activity"), "the research section must mount");
    assert.ok(activityText.includes(RESEARCH_DONE_QUESTION), "the done row must carry its question");
    assert.ok(
      hasNode(state.sidebar, (node) =>
        Array.isArray(node.props?.children) && node.props.children.join("") === "job job-done"),
      "the done row must carry its job id",
    );
    assert.ok(activityText.includes("1 source"), "the done row must carry its sources count");
    assert.ok(
      hasNode(state.sidebar, (node) =>
        Array.isArray(node.props?.children) && node.props.children.join("") === "1m 5s elapsed"),
      "the done row must carry its elapsed time",
    );
    assert.ok(activityText.includes(RESEARCH_FAILED_QUESTION), "the failed row must list the failed question");
    assert.ok(activityText.includes("PARALLEL_TIMEOUT"), "the failed row must render its fault code");
    assert.ok(
      activityText.includes("Parallel Search timed out. (PARALLEL_TIMEOUT)"),
      "the failed row must carry the honest failure message",
    );
    assert.ok(
      countNodes(
        state.sidebar,
        (node) => node.type === "Button" && node.props["aria-label"] === "Run research again as a new job with a new idempotency key (one new Parallel credit)",
      ) === 1,
      "the failed row must offer the explicitly-charged Run again action",
    );
    assert.ok(
      countNodes(state.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Dismiss failed research") === 1,
      "the failed row must offer Dismiss",
    );
    assert.ok(
      JSON.stringify(findNode(
        state.sidebar,
        (node) => node.type === "Button" && (node.props["aria-label"] ?? "").startsWith("Run research again"),
        "the Run again control",
      )).includes("Run again (new charge)"),
      "the run-again label must carry the new-charge honesty",
    );

    // Done rows: Add research as context (enabled with sources), plus the
    // honest disabled states (already-added note, source-less job).
    const addButtons = visibleNodes(state.sidebar).filter(
      (node) => node.type === "Button" && node.props["aria-label"] === "Add research as context",
    );
    assert.equal(addButtons.length, 2, "each done row must carry the add-context action");
    const enabled = findNode(
      state.sidebar,
      (node) =>
        node.type === "Button" &&
        node.props["aria-label"] === "Add research as context" &&
        node.props.disabled !== true,
      "the enabled add-context control",
    );
    enabled.props.onClick();
    const session = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.ok(
      session.messages.some((message) => message.id === productionAssistantLib.researchNoteMessageId("job-done")),
      "adding context must append the per-job note message",
    );
    const note = session.messages.at(-1);
    assert.ok(
      note.researchNoteJobId === "job-done" &&
        note.text.includes("Parallel job job-done") &&
        note.text.includes(RESEARCH_DONE_QUESTION) &&
        note.sources[0].url === "https://example.org/archives",
      "the note must carry the job id, question and cited sources",
    );
    state = state.rerender();
    assert.ok(
      countNodes(state.sidebar, (node) => node.type === "Button" && JSON.stringify(node.props.children).includes("Added as context")) === 1,
      "the note-added row must flip to its honest added state",
    );
    const stillDisabled = visibleNodes(state.sidebar).filter(
      (node) =>
        node.type === "Button" &&
        node.props["aria-label"] === "Add research as context" &&
        node.props.disabled === true,
    );
    assert.equal(stillDisabled.length, 2, "the added note and the source-less row must both be disabled");
    let hinted = false;
    for (const node of stillDisabled) {
      if (JSON.stringify(node).includes("no sources yet")) hinted = true;
    }
    assert.ok(hinted, "the source-less row must hint why adding is disabled");

    // The note rides the chat conversation as a distinct Parallel-labelled
    // message even where research results are filtered out.
    const feed = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    assert.ok(
      JSON.stringify(feed.sidebar).includes("Parallel · research note"),
      "the research note must render in the conversation as a Parallel-labelled note",
    );
    assert.ok(
      !JSON.stringify(feed.sidebar).includes("key-done:research"),
      "the delivered research result itself still stays out of the sidebar chat feed",
    );

    // Job-link highlight: the chip's row id highlights the row in the Research tab.
    state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    const link = findNode(
      state.sidebar,
      (node) => node.type === "button" && node.props["aria-label"] === `View the research job for: ${RESEARCH_DONE_QUESTION}`,
      "the suggestion link chip",
    );
    link.props.onClick();
    state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    const highlightedRow = findNode(
      state.sidebar,
      (node) =>
        node.props?.["aria-label"] === `Research job: ${RESEARCH_DONE_QUESTION}` &&
        node.props["aria-current"] === "true",
      "the highlighted done row",
    );
    assert.ok(
      JSON.stringify(highlightedRow).includes("job-done"),
      "the highlight must land on the row the job link pointed at",
    );

    // The live running row: a polling job shows Running + honest "sources
    // pending", with neither Resume nor Run-again while it is in flight.
    seedResearchSession(project, {
      messages: [],
      pending: {
        request: {
          kind: "preflight",
          connectionId: "google-a",
          projectId: "snap-research",
          expectedRevision: 1,
          idempotencyKey: "key-running",
          input: {
            question: "Why does the harbour fog matter?",
            research: true,
            parallelOnly: true,
            officialDocs: false,
            conversation: [],
          },
        },
        source: researchSource(project),
        jobId: "job-run",
        startedAt: Date.now() - 5_000,
      },
    });
    productionAssistantStore.useProductionAssistant.setState((fresh) => ({
      researchRunning: { ...fresh.researchRunning, [project.id]: true },
    }));
    state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    const runningRow = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Research job: Why does the harbour fog matter?",
      "the running research row",
    );
    const runningText = JSON.stringify(runningRow);
    assert.ok(runningText.includes("Running"), "the running row must report Running");
    assert.ok(runningText.includes("sources pending"), "the running row must be honest about pending sources");
    assert.ok(!runningText.includes("Resume Parallel research"), "a polling job must not offer Resume");
    assert.ok(!runningText.includes("Run again (new charge)"), "a running job is not failed and must not offer Run again");
  } finally {
    productionAssistantStore.useProductionAssistant.setState({ sessions: {} });
  }
});

test("a research suggestion chip runs the question on a new key and links the job", async () => {
  const project = createBlankProject();
  project.name = "Suggestion chip proof";
  useSlate.setState({ project });
  const priorFetch = globalThis.fetch;
  const priorWindow = globalThis.window;
  const submittedBodies = [];
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.window = { location: { origin: "http://127.0.0.1:9189" } };
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if (url.includes("/api/cinema/connections")) {
      return json({
        connections: [
          {
            connectionId: "conn_sugg",
            provider: "google-cloud",
            status: "configured",
            expiresAt: Date.now() / 1000 + 3600,
          },
        ],
      });
    }
    if (url.includes("/api/cinema/projects")) {
      return json({ projectId: "proj_sugg", revision: 4 });
    }
    if (url.includes("/api/cinema/jobs")) {
      if (init?.method === "POST") {
        submittedBodies.push(JSON.parse(init.body));
        return json({ jobId: "job-sugg" });
      }
      return json({
        jobId: "job-sugg",
        status: "succeeded",
        result: {
          sourceRevision: 4,
          sources: [{ title: "Lamplight archives", url: "https://example.org/lamp" }],
          provenance: { origin: "managed" },
        },
      });
    }
    return json({ error: { message: "unexpected fetch", code: "unexpected" } });
  };
  const pools = new Map();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    seedResearchSession(project, {
      messages: [
        { id: "m1", role: "assistant", text: "Keep the tavern warm." },
        {
          id: "m1:answer",
          role: "assistant",
          text: "The tavern used oil lamps during this period.",
          suggestion: { question: RESEARCH_DONE_QUESTION },
        },
      ],
    });

    let state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    // Before any job: the chip RUNS the suggestion — no job exists yet, so no
    // credit is charged until this click.
    assert.ok(
      countNodes(
        state.sidebar,
        (node) =>
          node.type === "button" && node.props["aria-label"] === `Run research: ${RESEARCH_DONE_QUESTION}`,
      ) === 1,
      "a suggestion with no job yet must render as the Run research chip",
    );
    findNode(
      state.sidebar,
      (node) => node.type === "button" && node.props["aria-label"] === `Run research: ${RESEARCH_DONE_QUESTION}`,
      "the run chip",
    ).props.onClick();

    // The job lands and delivers quickly; wait for the delivered research
    // message (the store publishes the running pending before submitting --
    // which can settle within one sleep step, so no running peek is possible).
    for (let attempt = 0; attempt < 400; attempt++) {
      await sleep(25);
      state = state.rerender();
      if (
        productionAssistantStore.useProductionAssistant
          .getState()
          .sessions[project.id]?.messages.some(
            (message) => message.provider === "parallel" && message.jobId === "job-sugg",
          )
      )
        break;
    }
    const body = submittedBodies.at(-1);
    assert.equal(body.input.question, RESEARCH_DONE_QUESTION);
    assert.deepEqual(
      { research: body.input.research, parallelOnly: body.input.parallelOnly, officialDocs: body.input.officialDocs },
      { research: true, parallelOnly: true, officialDocs: false },
    );
    assert.equal(body.projectId, "proj_sugg");
    assert.equal(body.expectedRevision, 4);
    assert.ok(
      typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0,
      "the suggestion must submit under its own idempotency key",
    );

    const settledSession = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.equal(settledSession.researchPending, null);
    const delivered = settledSession.messages.find((message) => message.provider === "parallel");
    assert.equal(delivered?.jobId, "job-sugg");
    assert.equal(delivered?.question, RESEARCH_DONE_QUESTION);

    // Once the job exists the chip is the honest job link into the Research tab.
    state = state.rerender();
    const link = findNode(
      state.sidebar,
      (node) => node.type === "button" && node.props["aria-label"] === `View the research job for: ${RESEARCH_DONE_QUESTION}`,
      "the post-submit job link chip",
    );
    link.props.onClick();
    assert.ok(state.tabChanges.includes("activity"), "the job link must switch to the Research tab");
    state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    assert.ok(
      findNode(
        state.sidebar,
        (node) =>
          node.props?.["aria-label"] === `Research job: ${RESEARCH_DONE_QUESTION}` &&
          node.props["aria-current"] === "true",
        "the linked research row",
      ),
      "the job link must highlight its row in the Research tab",
    );
    assert.ok(
      countNodes(state.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Add research as context") === 1,
      "the delivered job must surface the Add research as context action",
    );
  } finally {
    globalThis.fetch = priorFetch;
    globalThis.window = priorWindow;
    productionAssistantStore.useProductionAssistant.setState({ sessions: {} });
  }
});
test("the composer mention pickers filter by surface, append tokens and record refs", () => {
  const project = createBlankProject();
  project.name = "Mention picker proof";
  project.script = [
    { id: "bh_sc_tavern", kind: "scene", text: "INT. TAVERN - DAY" },
    { id: "bh_a_smoke", kind: "action", text: "Smoke drifts under the oil lamps." },
  ];
  project.shots = [
    typesLib.emptyShot({ id: "bh_1a", setup: "1A", title: "Tavern business", number: 1 }),
    typesLib.emptyShot({ id: "bh_1m", setup: "1M", title: "The coin", number: 2 }),
  ];
  project.scriptCommentThreads = [
    {
      id: "th-1",
      anchor: { elementId: "bh_a_smoke", quote: "Smoke drifts", start: 0, end: 12 },
      status: "open",
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  try {
    useSlate.setState({ project, view: "stage", selectedId: null });

    // `@` on the stage surface lists setups; the headline counts and filters.
    setAssistantDraft(project.id, "Ask about @");
    let state = renderHarnessSidebar({ open: true, tab: "gemini" });
    let picker = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"]?.startsWith("Mention picker: Setups"),
      "the setups picker",
    );
    let pickerText = JSON.stringify(picker);
    assert.ok(pickerText.includes("Setups · 2"), "the picker headline must count its entries");
    const coins = findNode(
      picker,
      (node) => node.type === "Button" && node.props["aria-label"] === "Mention 1M The coin",
      "the 1M picker entry",
    );
    assert.ok(
      !!coins,
      "the stage picker must list the setups",
    );
    setAssistantDraft(project.id, "Ask about @tav");
    state = renderHarnessSidebar({ open: true, tab: "gemini" });
    picker = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"]?.startsWith("Mention picker: Setups"),
      "the filtered setups picker",
    );
    pickerText = JSON.stringify(picker);
    assert.ok(
      pickerText.includes("Setups · 1 matching \\\"tav\\\""),
      "the headline must show the current filter",
    );
    const pick = findNode(
      picker,
      (node) => node.type === "Button" && node.props["aria-label"] === "Mention 1A Tavern business",
      "the 1A picker entry",
    );
    pick.props.onClick();

    let session = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.ok(
      session.draft.startsWith("Ask about @1A Tavern business "),
      `the pick must append the plain-text token, got: ${session.draft}`,
    );
    assert.deepEqual(session.mentions, ["bh_1a"], "the pick must record the setup ref");

    // After the pick the token closes with its trailing space: no picker.
    state = renderHarnessSidebar({ open: true, tab: "gemini" });
    assert.equal(
      countNodes(state.sidebar, (node) => node.props?.["aria-label"]?.startsWith("Mention picker:")),
      0,
      "a completed token must close the picker",
    );

    // `#` lists elements (kind + truncated text) and threads riding their
    // anchored element ref; picking the element records its id.
    setAssistantDraft(project.id, `${session.draft}Explain #smoke`);
    state = renderHarnessSidebar({ open: true, tab: "gemini" });
    picker = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"]?.startsWith("Mention picker: Script elements & threads"),
      "the element picker",
    );
    assert.ok(
      JSON.stringify(picker).includes("action · Smoke drifts under the oil lamps."),
      "element entries must show kind plus truncated text",
    );
    assert.ok(
      JSON.stringify(picker).includes("thread · Smoke drifts"),
      "thread entries must show the anchored text",
    );
    const elementPick = findNode(
      picker,
      (node) =>
        node.type === "Button" &&
        node.props["aria-label"] === "Mention action · Smoke drifts under the oil lamps.",
      "the bh_a_smoke picker entry",
    );
    elementPick.props.onClick();
    session = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.ok(session.draft.includes("#bh_a_smoke "), "the element token must append its id");
    assert.deepEqual(session.mentions, ["bh_1a", "bh_a_smoke"], "both picks must record their refs");

    // Surface filtering: on script, `@` lists scenes/beats and no setups.
    useSlate.setState({ view: "script" });
    setAssistantDraft(project.id, "Ask about @");
    state = renderHarnessSidebar({ open: true, tab: "gemini" });
    picker = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"]?.startsWith("Mention picker: Scenes & beats"),
      "the script-surface picker",
    );
    const pickerHtml = JSON.stringify(picker);
    assert.ok(pickerHtml.includes("bh_sc_tavern"), "the script picker must list the scene");
    assert.ok(!pickerHtml.includes("1A Tavern business"), "the script picker must not list setups");
  } finally {
    productionAssistantStore.useProductionAssistant.setState({ sessions: {} });
  }
});

test("the composer rides the focused shot as a removable implicit focus ref", () => {
  const project = createBlankProject();
  project.name = "Focus chip proof";
  project.shots = [
    typesLib.emptyShot({ id: "bh_1a", setup: "1A", title: "Tavern business", number: 1 }),
    typesLib.emptyShot({ id: "bh_1m", setup: "1M", title: "The coin", number: 2 }),
  ];
  try {
    useSlate.setState({ project, view: "stage", selectedId: "bh_1a" });
    // Local composer state (the removable-focus toggle) lives across re-renders
    // only through a pooled render session; each pass re-executes with real
    // store state, and a click + rerender is the same seam a real browser runs.
    const pools = new Map();
    let state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    const chip = findNode(
      state.sidebar,
      (node) =>
        node.type === "button" &&
        node.props["aria-label"] === "Drop the focused shot mention from the next task",
      "the implicit focus chip",
    );
    assert.ok(
      JSON.stringify(chip).includes("Focus: 1A Tavern business +"),
      "the chip must label the focused setup honestly",
    );
    // Removal is the explicit full-snapshot choice for the next ask.
    chip.props.onClick();
    state = state.rerender();
    assert.equal(
      countNodes(
        state.sidebar,
        (node) => node.props?.["aria-label"] === "Drop the focused shot mention from the next task",
      ),
      0,
      "the dropped focus ref must leave the composer free of context refs",
    );
  } finally {
    productionAssistantStore.useProductionAssistant.setState({ sessions: {} });
  }
});

test("sliced answers render the bounded-context honesty line and chips; trim-less answers stay clean", () => {
  const project = createBlankProject();
  project.name = "Honesty line proof";
  useSlate.setState({ project });
  try {
    productionAssistantStore.useProductionAssistant.setState((state) => ({
      sessions: {
        ...state.sessions,
        [project.id]: {
          ...productionAssistantLib.emptyAssistantSession(project.id),
          messages: [
            {
              id: "m1",
              role: "assistant",
              text: "Full-snapshot answer.",
            },
            {
              id: "m2",
              role: "assistant",
              text: "Sliced answer.",
              contextTrimmed: true,
              contextIncluded: [
                { kind: "setup", id: "bh_1a", label: "1A Tavern business" },
                { kind: "element", id: "bh_a_smoke", label: "action · Smoke drifts" },
              ],
              contextUnresolved: ["bh_ghost", "bh_specter"],
            },
          ],
        },
      },
    }));
    const state = renderHarnessSidebar({ open: true, tab: "gemini" });
    const sliced = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Answer context honesty",
      "the sliced answer's context honesty block",
    );
    const html = JSON.stringify(sliced);
    assert.ok(
      html.includes("Answered against a bounded outline plus your mentions, not the full project."),
      "the honesty line must show what the answer ran against",
    );
    assert.ok(html.includes("Setup · 1A Tavern business"), "the included setup must render as a chip");
    assert.ok(html.includes("Element · action · Smoke drifts"), "the included element must render as a chip");
    assert.ok(
      html.includes("not resolved: bh_ghost, bh_specter"),
      "unresolved refs must render softly",
    );
    assert.equal(
      countNodes(state.sidebar, (node) => node.props?.["aria-label"] === "Answer context honesty"),
      1,
      "only the sliced answer may carry the honesty block",
    );
  } finally {
    productionAssistantStore.useProductionAssistant.setState({ sessions: {} });
  }
});

test("checks pair with completed research: per-check sources, view-sources highlight and draft-only composition", () => {
  const project = createBlankProject();
  project.name = "Checks research wiring proof";
  // Domain-titled checks derive from continuity issues: deterministic, no
  // preflight ordering to depend on. The plain check pairs with nothing.
  useSlate.setState({
    project,
    view: "script",
    issues: [
      { id: "cont-prop", shotId: "shot-1a", code: "continuity", severity: "warn", title: "Untagged glass", detail: "The glass reads as a prop or dressing and is not marked." },
      { id: "cont-sound", shotId: "shot-1a", code: "continuity", severity: "warn", title: "Sound not marked", detail: "The street sound in this setup dies with the cut." },
      { id: "cont-plain", shotId: "shot-1a", code: "continuity", severity: "info", title: "Eyeline unnamed", detail: "A look is described without an eyeline mark." },
    ],
  });
  productionAssistantStore.useProductionAssistant.setState({ composerResearch: {} });
  const now = Date.now();
  const pools = new Map();
  try {
    seedResearchSession(project, {
      pending: null,
      messages: [
        {
          id: "key-props:research",
          role: "assistant",
          provider: "parallel",
          text: productionAssistantLib.PARALLEL_RESEARCH_NOTE,
          sources: [{ title: "Bar ledger", url: "https://example.org/bar" }],
          jobId: "job-props",
          question: "Which props did barkeeps keep behind the bar?",
          finishedAt: now,
          researchDurationMs: 10_000,
        },
        {
          id: "key-sound:research",
          role: "assistant",
          provider: "parallel",
          text: productionAssistantLib.PARALLEL_RESEARCH_NOTE,
          sources: [
            { title: "Street noise archive", url: "https://example.org/noise" },
            { title: "Foley notes", url: "https://example.org/foley" },
          ],
          jobId: "job-sound",
          question: "What did street sound cost in the 1890s?",
          finishedAt: now,
          researchDurationMs: 20_000,
        },
        {
          id: "key-none:research",
          role: "assistant",
          provider: "parallel",
          text: productionAssistantLib.PARALLEL_RESEARCH_NOTE,
          sources: [{ title: "Lighting notes", url: "https://example.org/light" }],
          jobId: "job-none",
          question: "Why this light?",
          finishedAt: now,
          researchDurationMs: 30_000,
        },
      ],
    });

    // Research tab: the sources block sits beneath the row list, grouped by
    // check title, only for checks a completed row actually matches.
    let state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    assert.ok(
      hasNode(state.sidebar, (node) => node.props?.["aria-label"] === "Sources by check"),
      "the research tab must expose the sources-by-check block",
    );
    const propGroup = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Sources for check: Untagged glass",
      "the props check's source group",
    );
    const propGroupJson = JSON.stringify(propGroup);
    assert.ok(propGroupJson.includes("Bar ledger") && propGroupJson.includes("https://example.org/bar"), "the props group must carry its cited source");
    assert.ok(propGroupJson.includes("Props"), "the group must name its shared domain");
    assert.ok(
      JSON.stringify(propGroup).includes("research job job-props"),
      "the group must name the job its sources came from",
    );
    const soundGroup = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Sources for check: Sound not marked",
      "the sound check's source group",
    );
    assert.ok(
      JSON.stringify(soundGroup).includes("Street noise archive") && JSON.stringify(soundGroup).includes("Foley notes"),
      "the sound group must carry all its deduped cited sources",
    );
    assert.ok(
      JSON.stringify(soundGroup).includes("2 sources"),
      "the sound group must carry its source count",
    );
    assert.ok(
      !JSON.stringify(state.sidebar).includes("Sources for check: Eyeline unnamed"),
      "a check no research row matches must not fabricate a source group",
    );
    assert.ok(
      !JSON.stringify(findNode(
        state.sidebar,
        (node) => node.props?.["aria-label"] === "Sources by check",
        "the sources-by-check block",
      )).includes("Lighting notes"),
      "the unmatched question's sources must not appear under any check",
    );

    // Checks tab: matching rows carry "View sources"; every row carries
    // "Research this check"; the unmatched check carries no view chip.
    state = renderHarnessSidebar({ open: true, tab: "checks" }, pools);
    const viewChips = visibleNodes(state.sidebar).filter(
      (node) => node.type === "Button" && node.props["aria-label"] === "View sources",
    );
    assert.equal(viewChips.length, 2, "only the two check rows with matched research must carry View sources");
    assert.equal(
      countNodes(state.sidebar, (node) => node.type === "Button" && node.props["aria-label"] === "Research this check"),
      5,
      "every check row must carry the Research this check affordance (3 seeded checks + the blank project's Unlined beat and No negatives marked)",
    );
    assert.ok(
      JSON.stringify(state.sidebar).includes("Nothing is sent until you press Send"),
      "the compose affordance must honestly say it never sends on its own",
    );

    // "View sources": switches to the Research tab (controlled tab change)
    // and highlights the matching research row.
    viewChips[0].props.onClick();
    assert.ok(
      state.tabChanges.includes("activity"),
      "viewing sources must switch to the Research tab",
    );
    state = renderHarnessSidebar({ open: true, tab: "activity" }, pools);
    const highlighted = findNode(
      state.sidebar,
      (node) => node.props?.["aria-current"] === "true",
      "the highlighted research row",
    );
    assert.ok(
      JSON.stringify(highlighted).includes("Research job: Which props did barkeeps keep behind the bar?"),
      "the highlight must land on the matched research row",
    );

    // "Research this check": composes the focused question in the draft with
    // the Research toggle on. Nothing is sent — no pending, no research pending.
    state = renderHarnessSidebar({ open: true, tab: "checks" }, pools);
    const composeChip = findNode(
      state.sidebar,
      (node) => node.type === "Button" && node.props["aria-label"] === "Research this check",
      "the Research this check chip",
    );
    composeChip.props.onClick();
    assert.ok(
      state.tabChanges.includes("gemini"),
      "composing must bring the composer (Assistant tab) forward",
    );
    const session = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.equal(
      productionAssistantStore.useProductionAssistant.getState().composerResearch?.[project.id],
      true,
      "composing must turn the composer Research toggle on",
    );
    state = renderHarnessSidebar({ open: true, tab: "gemini" }, pools);
    const textarea = findNode(state.sidebar, (node) => node.type === "textarea", "the composer draft");
    assert.equal(
      textarea.props.value,
      productionAssistantLib.checkResearchQuestion("Untagged glass"),
      "composing must fill the draft with the focused, citation-asking question",
    );
    const researchToggle = findNode(
      state.sidebar,
      (node) => node.props?.["aria-label"] === "Toggle Parallel research for the next ask",
      "the composer research toggle",
    );
    assert.equal(
      researchToggle.props["aria-pressed"],
      true,
      "the composed research draft must render with the Research toggle on",
    );
    const still = productionAssistantStore.useProductionAssistant.getState().sessions[project.id];
    assert.equal(still.pending, null, "composing must never send: no ask pending is created");
    assert.equal(still.researchPending, null, "composing must never send: no research job starts");
  } finally {
    productionAssistantStore.useProductionAssistant.setState({ sessions: {}, composerResearch: {} });
    useSlate.setState({ issues: [] });
    pools.clear();
  }
});
