import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { createHash } from "node:crypto";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "jszip") specifier = "jszip/dist/jszip.min.js";
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

const { validateArchiveImportUrl, fetchArchiveFromUrl, pickDeviceArchiveFile } = await import("../src/lib/portable-import.ts");
const { createProjectOpenAttempt } = await import("../src/lib/demo-pack.ts");
hooks.deregister();

test("validateArchiveImportUrl accepts direct HTTPS URLs and preserves signed query parameters", () => {
  const signedUrl = "https://storage.googleapis.com/test-bucket/project.reelbinder.zip?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=test%40account";
  const result = validateArchiveImportUrl(signedUrl);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rawUrl, signedUrl);
    assert.equal(result.redactedUrl, "https://storage.googleapis.com/test-bucket/project.reelbinder.zip");
    assert.equal(result.parsedUrl.searchParams.get("X-Goog-Algorithm"), "GOOG4-RSA-SHA256");
  }
});

test("validateArchiveImportUrl rejects insecure and non-HTTPS protocols", () => {
  for (const invalid of [
    "http://example.com/archive.zip",
    "file:///Users/kyle/archive.zip",
    "data:application/zip;base64,UEsDBA==",
    "blob:https://studio.reelbinder.app/1234-5678",
    "ftp://example.com/file.zip",
    "",
    "not-a-url",
  ]) {
    const result = validateArchiveImportUrl(invalid);
    assert.equal(result.ok, false, `Expected rejection for: ${invalid}`);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  }
});

test("validateArchiveImportUrl rejects URLs with credentials or fragments", () => {
  const withCreds = "https://admin:secret@example.com/archive.zip";
  const resCreds = validateArchiveImportUrl(withCreds);
  assert.equal(resCreds.ok, false);
  if (!resCreds.ok) assert.match(resCreds.error, /credentials/i);

  const withFragment = "https://example.com/archive.zip#section";
  const resFrag = validateArchiveImportUrl(withFragment);
  assert.equal(resFrag.ok, false);
  if (!resFrag.ok) assert.match(resFrag.error, /fragment/i);
});

test("fetchArchiveFromUrl successfully downloads bytes and validates matching SHA-256", async (t) => {
  const payload = new Uint8Array([80, 75, 3, 4, 10, 20, 30, 40]);
  const expectedHash = createHash("sha256").update(payload).digest("hex");

  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.referrerPolicy, "no-referrer");
    return new Response(payload, {
      status: 200,
      headers: { "Content-Type": "application/zip", "Content-Length": String(payload.byteLength) },
    });
  });

  const res = await fetchArchiveFromUrl("https://example.com/archive.reelbinder.zip?sig=abc123xyz", {
    expectedSha256: expectedHash,
  });

  assert.deepEqual(res.bytes, payload);
  assert.equal(res.byteSize, payload.byteLength);
  assert.equal(res.sha256, expectedHash);
  assert.equal(res.verifiedMatch, true);
  assert.equal(res.redactedUrl, "https://example.com/archive.reelbinder.zip");
});

test("fetchArchiveFromUrl fails with hard error on SHA-256 mismatch", async (t) => {
  const payload = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(payload, { status: 200 });
  });

  await assert.rejects(
    fetchArchiveFromUrl("https://example.com/archive.reelbinder.zip", {
      expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
    /SHA-256 mismatch/i
  );
});

test("fetchArchiveFromUrl enforces maximum byte limit", async (t) => {
  const payload = new Uint8Array(1024);
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(payload, {
      status: 200,
      headers: { "Content-Length": "1024" },
    });
  });

  await assert.rejects(
    fetchArchiveFromUrl("https://example.com/large.zip", { maxBytes: 500 }),
    /exceeds the maximum allowed limit/i
  );
});

test("fetchArchiveFromUrl diagnoses CORS failure and advises downloading file directly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });

  await assert.rejects(
    fetchArchiveFromUrl("https://non-cors-host.example/archive.zip"),
    /\(CORS\) restrictions[\s\S]*Choose file/i
  );
});

test("fetchArchiveFromUrl handles user cancellation via AbortSignal", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new Error("Operation cancelled"));
      });
    });
  });

  const fetchPromise = fetchArchiveFromUrl("https://example.com/archive.zip", {
    signal: controller.signal,
  });
  controller.abort(new Error("User cancelled import"));

  await assert.rejects(fetchPromise, /cancelled/i);
});

test("pickDeviceArchiveFile returns null when window is not defined or picker not supported", async () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(await pickDeviceArchiveFile(), null);

    globalThis.window = {};
    assert.equal(await pickDeviceArchiveFile(), null);
  } finally {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
});

test("pickDeviceArchiveFile safely calls showOpenFilePicker when present", async () => {
  const originalWindow = globalThis.window;
  try {
    const fakeFile = { name: "test.slate.zip", size: 100 };
    globalThis.window = {
      showOpenFilePicker: async (opts) => {
        assert.equal(opts.multiple, false);
        return [{ getFile: async () => fakeFile }];
      },
    };
    const file = await pickDeviceArchiveFile();
    assert.equal(file, fakeFile);

    // Test AbortError handling
    globalThis.window = {
      showOpenFilePicker: async () => {
        const err = new Error("User cancelled");
        err.name = "AbortError";
        throw err;
      },
    };
    assert.equal(await pickDeviceArchiveFile(), null);
  } finally {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
});

test("non-zip script open concurrency guard rejects when project changes during async read", async () => {
  let current = { id: "p1", name: "Film 1" };
  const getProject = () => current;
  const replaceProject = (p) => { current = p; };

  const attempt = createProjectOpenAttempt(getProject, replaceProject);
  const snapshot = JSON.stringify(getProject());

  // Simulate concurrent edit during async read
  let readFinished = false;
  const asyncRead = async () => {
    await new Promise((r) => setTimeout(r, 10));
    readFinished = true;
    return "INT. ROOM - DAY\nAction.";
  };

  const readPromise = (async () => {
    const text = await asyncRead();
    attempt.signal.throwIfAborted();
    if (JSON.stringify(getProject()) !== snapshot) {
      throw new Error("Your project changed while the script was opening. Open it again when you are ready to replace the current project.");
    }
    return text;
  })();

  // Mutate project while read is in flight
  current = { id: "p1", name: "Film 1 (Modified by user)" };

  await assert.rejects(
    readPromise,
    /Your project changed while the script was opening/
  );
  assert.equal(readFinished, true);
});

test("non-zip script open concurrency guard rejects when open attempt is cancelled", async () => {
  let current = { id: "p1", name: "Film 1" };
  const getProject = () => current;
  const replaceProject = (p) => { current = p; };

  const attempt = createProjectOpenAttempt(getProject, replaceProject);
  const snapshot = JSON.stringify(getProject());

  const readPromise = (async () => {
    await new Promise((r) => setTimeout(r, 20));
    attempt.signal.throwIfAborted();
    if (JSON.stringify(getProject()) !== snapshot) {
      throw new Error("Your project changed while the script was opening.");
    }
    return "done";
  })();

  attempt.cancel();

  await assert.rejects(
    readPromise,
    (err) => err.name === "AbortError"
  );
});

