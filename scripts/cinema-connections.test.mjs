import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
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

const {
  defaultSetupState,
  loadSetupState,
  saveSetupState,
  clearSetupState,
  classifyConnectionError,
  SETUP_STORAGE_KEY,
} = await import("../src/lib/cinema-onboarding.ts");
hooks.deregister();

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
