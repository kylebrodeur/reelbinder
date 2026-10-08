import assert from "node:assert/strict";
import test from "node:test";
import { H3Event } from "h3";
import cinemaMiddleware from "../server/middleware/cinema.ts";

test("cinema gateway streams imports with a scoped deadline and preserves request isolation", async (t) => {
  const previous = process.env.CINEMA_BACKEND_URL;
  process.env.CINEMA_BACKEND_URL = "http://backend.example:8090";
  t.after(() => {
    if (previous === undefined) delete process.env.CINEMA_BACKEND_URL;
    else process.env.CINEMA_BACKEND_URL = previous;
  });
  const deadlines = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });

  let active;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `http://backend.example:8090${active.path}`);
    assert.equal(options.method, active.method);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("cookie"), "cinema_session=owned-session");
    assert.equal(headers.get("origin"), "https://slate.example");
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-forwarded-host"), null);
    assert.equal(headers.get("x-forwarded-proto"), null);
    assert.equal(options.redirect, "manual");
    if (active.method === "POST") {
      assert.equal(options.body, active.request.body, "forward the same stream, without buffering");
      assert.equal(options.duplex, "half");
      const reader = options.body.getReader();
      assert.deepEqual((await reader.read()).value, active.first);
      // The upstream sees the first chunk while the source is still open.
      active.controller.enqueue(new Uint8Array([7, 8, 9]));
      active.controller.close();
      assert.deepEqual((await reader.read()).value, new Uint8Array([7, 8, 9]));
      assert.equal((await reader.read()).done, true);
      reader.releaseLock();
    } else {
      assert.equal(options.body, undefined);
    }
    return Response.json(
      { restored: true },
      {
        headers: { "set-cookie": "cinema_session=owned-session; HttpOnly; Path=/api/cinema" },
      },
    );
  });

  for (const [path, method, expectedDeadline] of [
    ["/api/cinema/assets/import?archive=1", "POST", 120_000],
    // Non-archive API rides the 360s ceiling (FastAPI bounds an ask at 180s;
    // the gateway must outlast the provider, not the visitor — the old 25s
    // cap killed long asks and SSE as 502 'service unavailable'; the
    // current ceiling gives Page Agent completions room to reason over
    // accumulated tool history).
    ["/api/cinema/jobs", "POST", 360_000],
    ["/api/cinema/assets/import-extra", "POST", 360_000],
    ["/api/cinema/assets/import", "GET", 360_000],
  ]) {
    active = { path, method, first: new Uint8Array(3 * 1024 * 1024) };
    const body =
      method === "POST"
        ? new ReadableStream({
            start(controller) {
              active.controller = controller;
              controller.enqueue(active.first);
            },
          })
        : undefined;
    active.request = new Request(`https://slate.example${path}`, {
      method,
      body,
      ...(body ? { duplex: "half" } : {}),
      headers: {
        cookie: "cinema_session=owned-session",
        origin: "https://slate.example",
        authorization: "do-not-forward",
        "x-forwarded-host": "untrusted.example",
        "x-forwarded-proto": "http",
      },
    });
    const result = await cinemaMiddleware(new H3Event(active.request), () => {
      throw new Error("Cinema requests must use the configured gateway");
    });
    assert.match(result.headers.get("set-cookie"), /cinema_session=owned-session/);
    assert.equal(deadlines.at(-1), expectedDeadline);
  }
  assert.equal(deadlines.length, 4);
});
