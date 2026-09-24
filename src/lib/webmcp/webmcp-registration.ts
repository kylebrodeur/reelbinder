import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import type { WebMcpToolAnnotations } from "@mcp-b/webmcp-types";
import { executeStudioTool, STUDIO_TOOLS } from "./studio-tools.ts";

const RELAY_SCRIPT_ID = "slate-webmcp-relay";
const RELAY_SCRIPT_SRC = "/webmcp/embed.js";

/**
 * Installs the ReelBinder studio WebMCP surface.
 * - Initializes the polyfill (no-op if native document.modelContext exists).
 * - Registers every STUDIO_TOOLS entry on document.modelContext.
 * - Injects the self-hosted local-relay embed script once.
 *
 * Returns a dispose function that aborts the registration signal and removes
 * the injected script. Safe to call twice under React StrictMode.
 */
export function installStudioWebmcp(): () => void {
  if (typeof document === "undefined") return () => {};

  initializeWebMCPPolyfill();

  const modelContext = document.modelContext;
  if (!modelContext) {
    return () => {};
  }

  const controller = new AbortController();

  for (const tool of STUDIO_TOOLS) {
    // Chrome documents consequentialHint; @mcp-b/webmcp-types 5.1.0 does not yet
    // declare it, so the intersection keeps both contracts honest without a cast.
    const annotations: WebMcpToolAnnotations & { consequentialHint?: boolean } = tool.annotations;
    void modelContext
      .registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations,
          execute: (args: Record<string, unknown>) => executeStudioTool(tool.name, args),
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn(`WebMCP registration failed for ${tool.name}:`, error);
      });
  }

  let script = document.getElementById(RELAY_SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = RELAY_SCRIPT_ID;
    script.src = RELAY_SCRIPT_SRC;
    script.defer = true;
    script.setAttribute("data-relay-host", "127.0.0.1");
    document.head.appendChild(script);
  }

  return () => {
    controller.abort();
    const installed = document.getElementById(RELAY_SCRIPT_ID);
    if (installed && installed.parentNode) {
      installed.parentNode.removeChild(installed);
    }
  };
}
