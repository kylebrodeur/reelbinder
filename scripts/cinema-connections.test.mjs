import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(fileURLToPath(import.meta.url), "..", "..");

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    const source = readFileSync(new URL(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: url.endsWith("/src/lib/cinema-client.ts")
        ? ts.transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText
        : stripTypeScriptTypes(source),
    };
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
const { getConnectionProbe, imageGenerationAvailable, imageProbeReadiness, testConnection } = await import("../src/lib/cinema-client.ts");

hooks.deregister();

function transpileConnectionsPanel() {
  const sourceText = readFileSync(resolve(root, "src/components/app/cinema-connections.tsx"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "");
  let compiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  compiled = "const React = require('react');\n" + compiled;

  function mockRequire(mod) {
    if (mod === "react") return React;
    if (mod === "react-dom/server") return { renderToStaticMarkup };
    if (mod === "lucide-react") {
      return new Proxy({}, {
        get(_target, name) {
          return (props) => React.createElement("svg", { "data-icon": String(name), ...props });
        },
      });
    }
    if (mod === "@/components/ui/button") {
      return {
        Button: ({ children, ...props }) => React.createElement("button", props, children),
      };
    }
    if (mod === "@/components/ui/dialog") {
      return {
        Dialog: ({ children }) => React.createElement("div", { "data-dialog": true }, children),
        DialogContent: ({ children }) => React.createElement("div", null, children),
        DialogHeader: ({ children }) => React.createElement("div", null, children),
        DialogTitle: ({ children }) => React.createElement("h2", null, children),
        DialogDescription: ({ children }) => React.createElement("p", null, children),
      };
    }
    if (mod === "@/components/ui/input") {
      return { Input: (props) => React.createElement("input", props) };
    }
    if (mod === "@/lib/cinema-client") {
      return {
        cinemaRequest: async () => {},
        getCinemaConnections: async () => [],
        getCinemaHealth: async () => ({ liveVerified: true, capabilities: {} }),
        testConnection: async () => ({
          connectionId: "conn-1",
          provider: "google-cloud",
          mode: "standard",
          results: [],
        }),
        clearConnectionProbe: () => {},
      };
    }

    if (mod === "@/lib/cinema-onboarding") {
      const defaultSetupState = () => ({
        step: "mode",
        mode: "standard",
        projectId: "",
        location: "us-central1",
        billingConfirmed: false,
        vertexConfirmed: false,
        ttsConfirmed: false,
        parallelSkipped: false,
        lastError: null,
        oauthClientId: "",
        oauthClientSecret: "",
        oauthStateNonce: "",
        oauthRedirectUri: "",
      });
      return {
        defaultSetupState,
        loadSetupState: () => defaultSetupState(),
        saveSetupState: () => {},
        clearSetupState: () => {},
        classifyConnectionError: (err) => ({
          category: "unknown",
          message: err?.message || "",
          guidance: "",
        }),
        buildGoogleOAuthUrl: () => "",
        parseOAuthCallback: () => null,
        clearOAuthUrlParams: () => {},
        exchangeOAuthCode: async () => ({}),
        SETUP_STORAGE_KEY: "test",
      };
    }
    throw new Error(`Unmocked module: ${mod}`);
  }

  const factory = new Function("exports", "require", compiled);
  const exportsObj = {};
  factory(exportsObj, mockRequire);
  return exportsObj;
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

test("loadSetupState restores gemini mode", () => {
  const mockStorage = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => mockStorage.get(key) ?? null,
      setItem: (key, val) => mockStorage.set(key, String(val)),
      removeItem: (key) => mockStorage.delete(key),
    },
  };

  const geminiState = { ...defaultSetupState(), mode: "gemini", step: "credentials" };
  saveSetupState(geminiState);
  const restored = loadSetupState();
  assert.equal(restored.mode, "gemini");
  assert.equal(restored.step, "credentials");

  clearSetupState();
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

test("ConnectionsPanel renders the guided Gemini API Key option", () => {
  const { ConnectionsPanel } = transpileConnectionsPanel();
  assert.ok(ConnectionsPanel, "ConnectionsPanel should compile and export");

  const html = renderToStaticMarkup(React.createElement(ConnectionsPanel));
  assert.match(html, /Gemini API Key/);
  assert.match(html, /Google AI Studio/);
  assert.match(html, /Script, Preflight analysis, Images, Video and Music/);
  assert.match(html, /Standard OAuth \(Recommended\)/);
  assert.match(html, /Express API Key/);
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
    assert.equal(getConnectionProbe("conn-1"), result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image probe readiness separates rejected credentials from unavailable connection modes", () => {
  const rejected = {
    connectionId: "conn-401",
    provider: "google-cloud",
    mode: "express",
    results: [
      { tool: "script", model: "gemini", status: "failed", code: "401", message: "Rejected" },
      { tool: "image", model: "imagen", status: "failed", code: "401", message: "Rejected" },
      { tool: "video", model: "veo", status: "failed", code: "UNSUPPORTED_MODE", message: "Unavailable" },
      { tool: "music", model: "lyria", status: "failed", code: "UNSUPPORTED_MODE", message: "Unavailable" },
    ],
  };
  assert.equal(imageGenerationAvailable(true, rejected), false);
  assert.equal(imageProbeReadiness(rejected), "reauthenticate");

  const unsupported = {
    ...rejected,
    connectionId: "conn-unsupported",
    results: [{ tool: "image", model: "imagen", status: "failed", code: "UNSUPPORTED_MODE", message: "Unavailable" }],
  };
  assert.equal(imageProbeReadiness(unsupported), "unsupported");
  assert.equal(imageGenerationAvailable(true, unsupported), false);
});

test("ConnectionRow renders Test, Renew, Disconnect and access status", () => {
  const { ConnectionRow } = transpileConnectionsPanel();
  const html = renderToStaticMarkup(
    React.createElement(ConnectionRow, {
      connection: {
        connectionId: "conn-1",
        provider: "google-cloud",
        status: "configured",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        mode: "gemini",
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(html, /Access untested/);
  assert.match(html, />Test</);
  assert.match(html, />Renew</);
  assert.match(html, />Disconnect</);
});

test("ConnectionRow renders verified and failed per-tool probe results", () => {
  const { ConnectionRow } = transpileConnectionsPanel();
  const verified = renderToStaticMarkup(
    React.createElement(ConnectionRow, {
      connection: {
        connectionId: "conn-1",
        provider: "google-cloud",
        status: "configured",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        mode: "standard",
        projectId: "proj-1",
      },
      probe: {
        busy: false,
        result: {
          connectionId: "conn-1",
          provider: "google-cloud",
          mode: "standard",
          results: [
            { tool: "script", model: "gemini", status: "verified", code: "200", message: "Script OK" },
            { tool: "image", model: "imagen", status: "verified", code: "200", message: "Image OK" },
          ],
        },
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(verified, /Access verified/);
  assert.match(verified, /script: verified/);
  assert.doesNotMatch(verified, /Access untested/);

  const failed = renderToStaticMarkup(
    React.createElement(ConnectionRow, {
      connection: {
        connectionId: "conn-1",
        provider: "google-cloud",
        status: "configured",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        mode: "express",
      },
      probe: {
        busy: false,
        result: {
          connectionId: "conn-1",
          provider: "google-cloud",
          mode: "express",
          results: [
            { tool: "script", model: "gemini", status: "verified", code: "200", message: "Script OK" },
            { tool: "video", model: "veo", status: "failed", code: "UNSUPPORTED_MODE", message: "Not available in express" },
          ],
        },
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(failed, /video unavailable in this connection mode/);
  assert.match(failed, /video: unavailable/);
  assert.match(failed, /renewal will not enable it/);
  assert.doesNotMatch(failed, /Access verified/);
});
