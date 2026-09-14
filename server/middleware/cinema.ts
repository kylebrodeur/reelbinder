import { proxyRequest, type H3Event } from "h3";

/** Same-origin cinema gateway for the built Nitro app, including vite preview. */
export default async function cinemaMiddleware(
  event: H3Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const DEMO_MEDIA_PATH = "/demo/media/the-bounty-hunter-v07.mp4";
  if (event.url.pathname === DEMO_MEDIA_PATH) {
    if (event.req.method !== "GET" && event.req.method !== "HEAD") {
      return Response.json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are allowed." } },
        { status: 405, headers: { "cache-control": "no-store" } },
      );
    }
    return proxyRequest(event, "https://storage.googleapis.com/reelbinder-public-downloads/v07/the-bounty-hunter-v07.mp4", {
      fetchOptions: { redirect: "manual", signal: AbortSignal.timeout(120_000) },
      filterHeaders: ["authorization", "x-forwarded-host", "x-forwarded-proto"],
    });
  }
  if (!event.url.pathname.startsWith("/api/cinema/")) return next();

  const configured = process.env.CINEMA_BACKEND_URL;
  if (!configured) {
    return Response.json(
      { error: { code: "SERVICE_UNCONFIGURED", message: "The cinema service is not connected." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let upstream: URL;
  try {
    upstream = new URL(configured);
    if (
      !["http:", "https:"].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== "/" ||
      upstream.search ||
      upstream.hash
    )
      throw new Error("Cinema backend must be an HTTP origin");
  } catch {
    return Response.json(
      {
        error: {
          code: "SERVICE_UNCONFIGURED",
          message: "The cinema service configuration is invalid.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  // Only the server-configured origin selects the destination. Preserve the
  // cinema session cookie and Origin so the backend can enforce its own scope.
  upstream.pathname = event.url.pathname;
  upstream.search = event.url.search;
  const importingArchive =
    event.req.method === "POST" && event.url.pathname === "/api/cinema/assets/import";
  try {
    return await proxyRequest(event, upstream.href, {
      // H3 forwards the request body stream. Allow the archive client's upload window.
      fetchOptions: {
        redirect: "manual",
        signal: AbortSignal.timeout(importingArchive ? 120_000 : 25_000),
      },
      filterHeaders: ["authorization", "x-forwarded-host", "x-forwarded-proto"],
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The cinema service is temporarily unavailable.",
        },
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
