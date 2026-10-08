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
const {
  getConnectionProbe,
  imageGenerationAvailable,
  imageProbeReadiness,
  testConnection,
  getCinemaJobUsage,
  parseCinemaJobUsage,
  formatCinemaRequestFailure,
  CinemaRequestFailure,
  CINEMA_JOB_KINDS,
} = await import("../src/lib/cinema-client.ts");

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
        getCinemaJobUsage: async () => ({
          jobs: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, byKind: Object.fromEntries(CINEMA_JOB_KINDS.map((k) => [k, 0])) },
          admission: { pending: 0, pendingLimit: 4 },
        }),
        testConnection: async () => ({
          connectionId: "conn-1",
          provider: "google-cloud",
          mode: "standard",
          results: [],
        }),
        clearConnectionProbe: () => {},
        formatCinemaRequestFailure: (error) => `${error.message} (${error.code})`,
      };
    }

    if (mod === "@/lib/cinema-onboarding") {
      const defaultSetupState = () => ({
        step: "mode",
        mode: "standard",
        projectId: "",
        location: "us-central1",
        lastError: null,
        oauthRedirectUri: "",
        renewalConnectionId: null,
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
        startGoogleOAuth: async () => ({ authorizationUrl: "https://accounts.google.com", state: "state" }),
        parseOAuthCallback: () => null,
        clearOAuthUrlParams: () => {},
        exchangeOAuthCode: async () => ({ accessToken: "token", expiresIn: 3600 }),
        setupGoogleOAuth: async () => ({ project: { projectId: "film-project" }, location: "us-central1" }),
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
  assert.equal(state.location, "us-central1");
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

  const customState = { ...defaultSetupState(), step: "credentials", projectId: "slate-cinema-proj" };
  saveSetupState(customState);

  const restored = loadSetupState();
  assert.equal(restored.step, "credentials");
  assert.equal(restored.projectId, "slate-cinema-proj");

  clearSetupState();
  assert.equal(loadSetupState().step, "mode");
});


test("classifyConnectionError accurately categorizes common Google Cloud failure modes", () => {
  const billingErr = classifyConnectionError(new Error("Project must have an active billing account linked."));
  assert.equal(billingErr.category, "billing");
  assert.match(billingErr.guidance, /billing account/i);

  const permErr = classifyConnectionError(new Error("Permission denied on resource (403)."));
  assert.equal(permErr.category, "permission");
  assert.match(permErr.guidance, /permission/i);

  const apiErr = classifyConnectionError(new Error("Vertex AI API has not been used in project before or it is disabled."));
  assert.equal(apiErr.category, "api_disabled");
  assert.match(apiErr.guidance, /required Google Cloud API/i);

  const tokenErr = classifyConnectionError(new Error("TOKEN_EXPIRED: Cloud token expired."));
  assert.equal(tokenErr.category, "token_expired");
  assert.match(tokenErr.guidance, /authorization expired/i);

  const cfgErr = classifyConnectionError(new Error("Google Cloud connection setup is not configured for this ReelBinder service. (OAUTH_NOT_CONFIGURED)"));
  assert.equal(cfgErr.category, "setup_not_configured");
  assert.match(cfgErr.guidance, /operator must set/i);

  const netErr = classifyConnectionError(new Error("Network timeout after 20000ms."));
  assert.equal(netErr.category, "network");
  assert.match(netErr.guidance, /could not be reached/i);
});

test("ConnectionsPanel presents included credits by default and bring-your-own as opt-in", () => {
  const { ConnectionsPanel } = transpileConnectionsPanel();
  assert.ok(ConnectionsPanel, "ConnectionsPanel should compile and export");

  const html = renderToStaticMarkup(React.createElement(ConnectionsPanel));
  assert.match(html, /Use included monthly credits/);
  assert.match(html, /Sign in with your Google account/);
  assert.match(html, /Just sign in/);
  assert.match(html, /Use your own Cloud project/);
  assert.doesNotMatch(html, /Google AI Studio/);
  assert.doesNotMatch(html, /Express API Key/);
});

test("ConnectionsControl distinguishes personal keys from managed research capacity", () => {
  const { ConnectionsControl } = transpileConnectionsPanel();
  const html = renderToStaticMarkup(React.createElement(ConnectionsControl));
  assert.match(html, /personal Parallel key is optional/);
  assert.match(html, /managed service capacity when available/);
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

test("image probe readiness blocks failed OAuth access", () => {
  const rejected = {
    connectionId: "conn-401",
    provider: "google-cloud",
    mode: "standard",
    results: [
      { tool: "image", model: "imagen", status: "failed", code: "401", message: "Rejected" },
    ],
  };
  assert.equal(imageGenerationAvailable(true, rejected), false);
  assert.equal(imageProbeReadiness(rejected), "reauthenticate");
});

test("ConnectionRow renders Test, Renew, Disconnect and access status", () => {
  const { ConnectionRow } = transpileConnectionsPanel();
  const html = renderToStaticMarkup(
    React.createElement(ConnectionRow, {
      connection: {
        connectionId: "conn-1",
        provider: "google-cloud",
        status: "configured",
        mode: "standard",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(html, /Access untested/);
  assert.match(html, /Test/);
  assert.match(html, /Renew/);
  assert.match(html, /Disconnect/);
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
        mode: "standard",
      },
      probe: {
        busy: false,
        result: {
          connectionId: "conn-1",
          provider: "google-cloud",
          mode: "standard",
          results: [
            { tool: "script", model: "gemini", status: "verified", code: "200", message: "Script OK" },
            { tool: "video", model: "veo", status: "failed", code: "PROVIDER_ERROR", message: "Video failed" },
          ],
        },
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(failed, /video: failed/);
  assert.match(failed, /PROVIDER_ERROR/);
  assert.doesNotMatch(failed, /Access verified/);
});

test("ConnectionRow renders inconclusive probe results as warning with resolution guidance", () => {
  const { ConnectionRow } = transpileConnectionsPanel();
  const html = renderToStaticMarkup(
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
            {
              tool: "music",
              model: "lyria",
              status: "inconclusive",
              code: "404",
              message: "Model not found at this location; verify model ID and location",
            },
          ],
        },
      },
      onTest: () => {},
      onRenew: () => {},
      onDisconnect: () => {},
    }),
  );
  assert.match(html, /Access inconclusive/);
  assert.match(html, /music: inconclusive/);
  assert.match(html, /\(404\)/);
  assert.match(html, /Model not found at this location; verify model ID and location/);
  assert.match(html, /Verify the model ID and location, then test again/);
  assert.match(html, /amber/);
  assert.doesNotMatch(html, /Access verified/);
  assert.doesNotMatch(html, /Access untested/);
});

test("getCinemaJobUsage fetches and validates the usage endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const usage = {
    jobs: {
      total: 5,
      queued: 1,
      running: 1,
      succeeded: 2,
      failed: 1,
      byKind: { script: 1, preflight: 1, image: 1, video: 1, music: 0, render: 1 },
    },
    admission: { pending: 2, pendingLimit: 4 },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/cinema/jobs/usage");
    assert.equal(options.method, undefined);
    assert.equal(options.credentials, "include");
    return { ok: true, status: 200, json: async () => usage };
  };
  try {
    const result = await getCinemaJobUsage();
    assert.equal(result.admission.pending, 2);
    assert.equal(result.admission.pendingLimit, 4);
    assert.equal(result.jobs.total, 5);
    assert.equal(result.jobs.byKind.render, 1);
    assert.equal(result.jobs.byKind.music, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseCinemaJobUsage validates expected fields and defaults missing kinds to zero", () => {
  const minimal = {
    jobs: { total: 1, queued: 0, running: 0, succeeded: 1, failed: 0, byKind: {} },
    admission: { pending: 0, pendingLimit: 2 },
  };
  const parsed = parseCinemaJobUsage(minimal);
  assert.equal(parsed.jobs.total, 1);
  assert.equal(parsed.jobs.byKind.video, 0);

  const withKinds = {
    jobs: { total: 3, queued: 1, running: 0, succeeded: 1, failed: 1, byKind: { image: 1, video: 2, unknown: 9 } },
    admission: { pending: 1, pendingLimit: 2 },
  };
  const kindParsed = parseCinemaJobUsage(withKinds);
  assert.equal(kindParsed.jobs.byKind.image, 1);
  assert.equal(kindParsed.jobs.byKind.video, 2);
  assert.equal(kindParsed.jobs.byKind.script, 0);
  assert.equal(("unknown" in kindParsed.jobs.byKind), false);


  for (const bad of [
    null,
    { jobs: null, admission: { pending: 0, pendingLimit: 1 } },
    { jobs: { total: -1, queued: 0, running: 0, succeeded: 0, failed: 0, byKind: {} }, admission: { pending: 0, pendingLimit: 1 } },
    { jobs: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, byKind: {} }, admission: { pending: "0", pendingLimit: 1 } },
  ]) {
    assert.throws(() => parseCinemaJobUsage(bad));
  }
});
test("parseCinemaJobUsage accepts assistant and managed-research credits", () => {
  const credits = {
    month: "2026-10",
    admin: false,
    byType: {
      photoreal: { used: 1, limit: 100, remaining: 99 },
      storyboard: { used: 0, limit: 100, remaining: 100 },
      video: { used: 0, limit: 20, remaining: 20 },
      music: { used: 0, limit: 10, remaining: 10 },
      assistant: { used: 2, limit: 25, remaining: 23 },
      parallel: { used: 1, limit: 10, remaining: 9 },
    },
  };
  const parsed = parseCinemaJobUsage({
    jobs: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, byKind: {} },
    admission: { pending: 0, pendingLimit: 2 },
    generationCredits: credits,
  });
  assert.equal(parsed.generationCredits?.byType.assistant.remaining, 23);
  assert.equal(parsed.generationCredits?.byType.parallel.limit, 10);

  const admin = parseCinemaJobUsage({
    jobs: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, byKind: {} },
    admission: { pending: 0, pendingLimit: 2 },
    generationCredits: {
      ...credits,
      admin: true,
      byType: Object.fromEntries(
        Object.keys(credits.byType).map((kind) => [kind, { used: 0, limit: null, remaining: null }]),
      ),
    },
  });
  assert.equal(admin.generationCredits?.admin, true);
  assert.equal(admin.generationCredits?.byType.assistant.limit, null);
});

test("formatCinemaRequestFailure surfaces the actual code and message", () => {
  const queue = new CinemaRequestFailure("The job queue is full.", 429, "QUEUE_FULL");
  const text = formatCinemaRequestFailure(queue);
  assert.match(text, /QUEUE_FULL/);
  assert.match(text, /job queue is full/);
});

