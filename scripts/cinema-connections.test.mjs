import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { transformWithOxc } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "..");

function resolveAlias(specifier) {
  if (!specifier.startsWith("@/")) return specifier;
  const relative = specifier.slice(2);
  const srcRoot = resolve(ROOT, "src");
  const candidates = [
    resolve(srcRoot, relative + ".tsx"),
    resolve(srcRoot, relative + ".ts"),
    resolve(srcRoot, relative, "index.tsx"),
    resolve(srcRoot, relative, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return "file://" + candidate;
  }
  return specifier;
}

async function transformSource(path) {
  const source = readFileSync(path, "utf8");
  const lang = path.endsWith(".tsx") ? "tsx" : "ts";
  return (
    await transformWithOxc(source, path, {
      lang,
      jsx: { runtime: "automatic", importSource: "react" },
    })
  ).code;
}

async function precomputeSources() {
  const sources = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      const info = statSync(path);
      if (info.isDirectory()) {
        walk(path);
      } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
        sources.set(path, transformSource(path));
      }
    }
  };
  for (const dir of ["src/lib", "src/components/ui", "src/components/app"]) {
    walk(resolve(ROOT, dir));
  }
  for (const [path, promise] of sources) {
    sources.set(path, await promise);
  }
  return sources;
}

const sourceCache = await precomputeSources();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "clsx" || specifier === "tailwind-merge") {
      specifier = require.resolve(specifier);
    }
    specifier = resolveAlias(specifier);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      specifier += ".ts";
    }
    return nextResolve(specifier, context, nextResolve);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("file://")) return nextLoad(url, context, nextLoad);
    const path = fileURLToPath(new URL(url));
    if (sourceCache.has(path)) {
      return { format: "module", shortCircuit: true, source: sourceCache.get(path) };
    }
    return nextLoad(url, context, nextLoad);
  },
});

const {
  defaultSetupState,
  loadSetupState,
  saveSetupState,
  clearSetupState,
  classifyConnectionError,
  SETUP_STORAGE_KEY,
} = await import("../src/lib/cinema-onboarding.ts");
const { testConnection } = await import("../src/lib/cinema-client.ts");
const { ConnectionRow } = await import("../src/components/app/cinema-connections.tsx");
const React = await import("react");
const { renderToString } = await import("react-dom/server");
hooks.deregister();

function renderRow(props) {
  return renderToString(React.createElement(ConnectionRow, props));
}

function cleanHtml(html) {
  return html.replace(/\u003c!--.*?--\u003e/g, "");
}

function baseConnection() {
  return {
    connectionId: "conn-1",
    provider: "google-cloud",
    status: "configured",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    mode: "standard",
    projectId: "proj-1",
    location: "us-central1",
  };
}

test("defaultSetupState returns initial step 'mode' and clean values", () => {
  const state = defaultSetupState();
  assert.equal(state.step, "mode");
  assert.equal(state.mode, "standard");
  assert.equal(state.projectId, "");
  assert.equal(state.billingConfirmed, false);
  assert.equal(state.vertexConfirmed, false);
  assert.equal(state.ttsConfirmed, false);
  assert.equal(state.lastError, null);
});

test("loadSetupState and saveSetupState persist state in sessionStorage", () => {
  const mockStorage = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => mockStorage.get(key) ?? null,
      setItem: (key, val) => mockStorage.set(key, String(val)),
      removeItem: (key) => mockStorage.delete(key),
    },
  };

  const initial = loadSetupState();
  assert.equal(initial.step, "mode");

  const customState = {
    ...defaultSetupState(),
    step: "billing",
    projectId: "slate-cinema-proj",
    billingConfirmed: true,
  };
  saveSetupState(customState);

  const restored = loadSetupState();
  assert.equal(restored.step, "billing");
  assert.equal(restored.projectId, "slate-cinema-proj");
  assert.equal(restored.billingConfirmed, true);

  clearSetupState();
  assert.equal(loadSetupState().step, "mode");
});

test("classifyConnectionError accurately categorizes common Google Cloud failure modes", () => {
  const billingErr = classifyConnectionError(new Error("Project must have an active billing account linked."));
  assert.equal(billingErr.category, "billing");
  assert.match(billingErr.guidance, /billing account/i);

  const permErr = classifyConnectionError(new Error("Permission denied on resource (403)."));
  assert.equal(permErr.category, "permission");
  assert.match(permErr.guidance, /sufficient permissions/i);

  const apiErr = classifyConnectionError(new Error("Vertex AI API has not been used in project before or it is disabled."));
  assert.equal(apiErr.category, "api_disabled");
  assert.match(apiErr.guidance, /Vertex AI API/i);

  const tokenErr = classifyConnectionError(new Error("TOKEN_EXPIRED: Cloud token expired."));
  assert.equal(tokenErr.category, "token_expired");
  assert.match(tokenErr.guidance, /token has expired/i);

  const netErr = classifyConnectionError(new Error("Network timeout after 20000ms."));
  assert.equal(netErr.category, "network");
  assert.match(netErr.guidance, /network/i);
});

test("testConnection posts an empty JSON body to the auth-only probe endpoint", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        connectionId: "conn-1",
        provider: "google-cloud",
        mode: "standard",
        projectId: "proj-1",
        location: "us-central1",
        results: [],
      }),
    };
  };
  try {
    const result = await testConnection("conn-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/cinema/connections/conn-1/test");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, JSON.stringify({}));
    assert.equal(calls[0].options.credentials, "include");
    assert.equal(result.connectionId, "conn-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ConnectionRow renders Test, Renew, Disconnect and Access untested by default", () => {
  const html = renderRow({
    connection: baseConnection(),
    onTest: () => {},
    onRenew: () => {},
    onDisconnect: () => {},
  });
  assert.match(html, /Access untested/);
  assert.match(html, />Test</);
  assert.match(html, />Renew</);
  assert.match(html, />Disconnect</);
});

test("ConnectionRow shows Testing access while busy", () => {
  const html = renderRow({
    connection: baseConnection(),
    probe: { busy: true },
    onTest: () => {},
    onRenew: () => {},
    onDisconnect: () => {},
  });
  assert.match(html, /Testing access/);
});

test("ConnectionRow swaps label to Access verified when every probe is verified", () => {
  const html = renderRow({
    connection: baseConnection(),
    probe: {
      busy: false,
      result: {
        connectionId: "conn-1",
        provider: "google-cloud",
        mode: "standard",
        results: [
          { tool: "script", model: "gemini-2.5", status: "verified", code: "200", message: "OK" },
          { tool: "image", model: "imagen-3", status: "verified", code: "200", message: "OK" },
        ],
      },
    },
    onTest: () => {},
    onRenew: () => {},
    onDisconnect: () => {},
  });
  const text = cleanHtml(html);
  assert.match(text, /Access verified/);
  assert.match(text, /script: verified/);
  assert.match(text, /image: verified/);
  assert.doesNotMatch(text, /Access untested/);
});

test("ConnectionRow shows failed tool and code on failure", () => {
  const html = renderRow({
    connection: baseConnection(),
    probe: {
      busy: false,
      result: {
        connectionId: "conn-1",
        provider: "google-cloud",
        mode: "standard",
        results: [
          { tool: "script", model: "gemini-2.5", status: "verified", code: "200", message: "OK" },
          { tool: "video", model: "veo-3", status: "failed", code: "PROVIDER_ERROR", message: "Unavailable" },
        ],
      },
    },
    onTest: () => {},
    onRenew: () => {},
    onDisconnect: () => {},
  });
  const text = cleanHtml(html);
  assert.match(text, /video PROVIDER_ERROR/);
  assert.match(text, /video: failed/);
  assert.match(text, /\(PROVIDER_ERROR\)/);
  assert.doesNotMatch(text, /Access verified/);
});

test("ConnectionRow renders per-tool result chips with messages", () => {
  const html = renderRow({
    connection: baseConnection(),
    probe: {
      busy: false,
      result: {
        connectionId: "conn-1",
        provider: "google-cloud",
        mode: "express",
        results: [
          { tool: "script", model: "gemini-2.5", status: "verified", code: "200", message: "Script OK" },
          { tool: "image", model: "imagen-3", status: "verified", code: "200", message: "Image OK" },
          { tool: "video", model: "veo-3", status: "failed", code: "UNSUPPORTED_MODE", message: "Not available in express" },
          { tool: "music", model: "lyria", status: "failed", code: "UNSUPPORTED_MODE", message: "Not available in express" },
        ],
      },
    },
    onTest: () => {},
    onRenew: () => {},
    onDisconnect: () => {},
  });
  const text = cleanHtml(html);
  assert.match(text, /Script OK/);
  assert.match(text, /Image OK/);
  assert.match(text, /Not available in express/);
  assert.match(text, /music: failed/);
});
