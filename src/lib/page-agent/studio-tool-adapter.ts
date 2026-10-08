import type { PageAgentTool } from "@kylebrodeur/page-agent-core";
import { z, type ZodType } from "zod/v4";
import {
  STUDIO_TOOLS,
  type StudioToolAnnotations,
  type StudioToolDescriptor,
  type StudioToolExecution,
} from "../webmcp/studio-tools.ts";
import type { PageAgentConfirmationHandler } from "./page-agent-runtime.ts";

/**
 * Adapter from the WebMCP studio tool catalog to Page Agent custom tools.
 *
 * There is exactly one tool authority in the browser: every generated tool
 * calls the provided runner (in production, `executeStudioTool`), so the Page
 * Agent never creates a second store, executor, or MCP surface. The catalog is
 * the single source of truth for names, schemas, and safety classes.
 */

export type StudioToolRunner = (
  name: string,
  args: Record<string, unknown>,
) => Promise<StudioToolExecution>;

/** Read/navigation tools the Page Agent may run without confirmation. */
export type StudioToolClass = "read" | "navigation" | "creative";

/**
 * Safety classes derive from the same annotations WebMCP registers.
 *
 * - readOnlyHint                    → "read": immediate execution, no gate.
 * - readOnlyHint=false + consequentialHint=true → "creative": destructive,
 *   confirmed by the host before any execution.
 * - everything else                 → "navigation": workspace-level state
 *   changes (active view, selection) that undo trivially; runnable immediately.
 */
export function classifyStudioTool(annotations: StudioToolAnnotations): StudioToolClass {
  if (annotations.readOnlyHint) return "read";
  if (annotations.consequentialHint) return "creative";
  return "navigation";
}

const CREATIVE_CONFIRMATION_LABELS: Readonly<Record<string, string>> = {
  apply_ui_patch: "Patch visible studio UI controls",
  board_element: "Create or select a coverage setup",
  add_script_mark: "Add a screenplay mark to the project",
  patch_shot: "Edit production notes for a setup",
  patch_overhead: "Change the overhead diagram",
  patch_frame: "Change the framing sketch",
  sync_shot_timeline: "Reorder or drop picture clips on the timeline",
  patch_frame_history: "Remove inactive frame-history versions",
  import_still: "Attach a still image to a setup",
  start_google_connection: "Start the Google Cloud connection flow",
  disconnect_connection: "Disconnect a provider account",
};

/** Generic DOM control tools, re-enabled only when a host asks for fallbacks. */
const DOM_FALLBACK_TOOLS = ["click_element_by_index", "input_text", "select_dropdown_option"] as const;
/** Raw script execution bypasses every application guard. It stays off. */
const SCRIPT_EXECUTION_TOOL = "execute_javascript";

export interface StudioPageAgentAdapterOptions {
  /** Browser tool authority; injectable so adapter behavior is testable. */
  runner: StudioToolRunner;
  /**
   * Host confirmation callback. Creative tools are only offered to the agent
   * when a handler is configured; otherwise they are removed from the tool set.
   */
  onConfirmTool?: PageAgentConfirmationHandler;
  /** Explicitly re-enable the fork's generic DOM click/type/select tools. Default false. */
  domFallback?: boolean;
  /** Explicitly re-enable raw JavaScript execution on the page. Default false. */
  scriptExecution?: boolean;
}

/** Boundary shape for the JSON Schemas the studio catalog actually uses. */
interface JsonSchemaNode {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  oneOf?: readonly unknown[];
  properties?: Readonly<Record<string, unknown>>;
  required?: readonly string[];
  items?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  description?: unknown;
  additionalProperties?: boolean;
}

function asSchemaNode(value: unknown): JsonSchemaNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  // SAFETY: only a JSON Schema object reaches this return; the catalog's
  // InputSchema boundary is contractually an object per its type definition.
  return value;
}

function descriptionOf(node: JsonSchemaNode): string | undefined {
  return typeof node.description === "string" && node.description ? node.description : undefined;
}

function schemaToZod(value: unknown): ZodType<unknown> {
  const node = asSchemaNode(value);
  const description = descriptionOf(node);

  if (node.oneOf !== undefined) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      throw new Error("oneOf needs at least two branches at the studio tool boundary.");
    }
    const union = z.union(node.oneOf.map((branch) => schemaToZod(branch)));
    return description ? union.describe(description) : union;
  }
  const types = Array.isArray(node.type) ? node.type : node.type === undefined ? [undefined] : [node.type];
  if (types.length > 1) {
    const expanded = types.map((type) => schemaToZod({ ...node, type, oneOf: undefined }));
    // SAFETY: types.length > 1 was checked above, so the branches form a valid
    // tuple for z.union.
    const union = z.union(expanded as [ZodType<unknown>, ZodType<unknown>]);
    return description ? union.describe(description) : union;
  }

  switch (types[0]) {
    case "string": {
      if (node.enum !== undefined) {
        if (!Array.isArray(node.enum) || !node.enum.every((entry) => typeof entry === "string")) {
          throw new Error("Non-string enum values are not supported by the studio tool adapter.");
        }
        // SAFETY: every element was narrowed to string directly above; z.enum
        // needs the literal tuple shape at the type level.
        let enumSchema = z.enum(node.enum as [string, ...string[]]);
        if (description) enumSchema = enumSchema.describe(description);
        return enumSchema;
      }
      let literalSchema = z.string();
      if (typeof node.minLength === "number") literalSchema = literalSchema.min(node.minLength);
      if (typeof node.maxLength === "number") literalSchema = literalSchema.max(node.maxLength);
      if (description) literalSchema = literalSchema.describe(description);
      return literalSchema;
    }
    case "integer":
    case "number": {
      let numberSchema = types[0] === "integer" ? z.number().int() : z.number();
      if (typeof node.minimum === "number") numberSchema = numberSchema.min(node.minimum);
      if (typeof node.maximum === "number") numberSchema = numberSchema.max(node.maximum);
      if (description) numberSchema = numberSchema.describe(description);
      return numberSchema;
    }
    case "boolean":
      return description ? z.boolean().describe(description) : z.boolean();
    case "null":
      return z.null();
    case "array": {
      let arraySchema = z.array(node.items !== undefined ? schemaToZod(node.items) : z.unknown());
      if (typeof node.minItems === "number") arraySchema = arraySchema.min(node.minItems);
      if (typeof node.maxItems === "number") arraySchema = arraySchema.max(node.maxItems);
      if (description) arraySchema = arraySchema.describe(description);
      return arraySchema;
    }
    case "object": {
      const shape: Record<string, ZodType<unknown>> = {};
      for (const [key, propertyValue] of Object.entries(node.properties ?? {})) {
        shape[key] = schemaToZod(propertyValue);
      }
      // Required keys without a declared property still must be present; the
      // revision-guarded sync_shot_timeline contract relies on this.
      for (const key of node.required ?? []) {
        if (!(key in shape)) {
          shape[key] = z.unknown().refine((present) => present !== undefined, `${key} is required.`);
        }
      }
      const objectSchema = node.additionalProperties === false ? z.strictObject(shape) : z.object(shape);
      return description ? objectSchema.describe(description) : objectSchema;
    }
    default:
      throw new Error(`Unsupported JSON Schema type "${String(types[0])}" at the studio tool boundary.`);
  }
}

/** Top-level studio input schemas must be objects; conversion fails closed. */
export function convertStudioInputSchema(toolName: string, schema: unknown): ZodType<Record<string, unknown>> {
  const node = asSchemaNode(schema);
  if (node.type !== "object") {
    throw new Error(`Studio tool "${toolName}" input schema is not a JSON object schema.`);
  }
  const converted = schemaToZod(schema);
  // SAFETY: schemaToZod's object branch guarantees the top level parses and
  // validates an args record, which is what the runner accepts.
  return converted as ZodType<Record<string, unknown>>;
}

function toPageAgentTool(
  descriptor: StudioToolDescriptor,
  options: StudioPageAgentAdapterOptions,
): PageAgentTool<Record<string, unknown>> | null {
  const toolClass = classifyStudioTool(descriptor.annotations);
  // Without a host confirmation handler there is no way to honor the
  // "Requires filmmaker approval" contract, so creative tools stay unexposed.
  if (toolClass === "creative" && !options.onConfirmTool) return null;

  const tool: PageAgentTool<Record<string, unknown>> = {
    description: descriptor.description,
    inputSchema: convertStudioInputSchema(descriptor.name, descriptor.inputSchema),
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      const result = await options.runner(descriptor.name, args);
      if (!result.ok) return `Tool "${descriptor.name}" failed: ${result.error}`;
      return result.content.map((content) => content.text).join("\n");
    },
  };

  if (toolClass === "navigation") {
    // Per-class seam so hosts can gate navigation later without rebuilding
    // the catalog mapping.
    tool.canRun = () => true;
  } else if (toolClass === "creative") {
    tool.destructive = true;
    tool.confirmationLabel = CREATIVE_CONFIRMATION_LABELS[descriptor.name] ?? `Run "${descriptor.name}" (changes studio content)`;
  }
  return tool;
}

/**
 * Build the PageAgentCore.customTools map from the studio catalog.
 *
 * Disabled-by-default paths carry `null` entries, which PageAgentCore treats
 * as removals: generic DOM control tools unless domFallback is requested, and
 * raw script execution unless a host explicitly authorizes it.
 */
export function buildStudioPageAgentTools(options: StudioPageAgentAdapterOptions): Record<string, PageAgentTool<Record<string, unknown>> | null> {
  const tools: Record<string, PageAgentTool<Record<string, unknown>> | null> = {};
  for (const descriptor of STUDIO_TOOLS) {
    tools[descriptor.name] = toPageAgentTool(descriptor, options);
  }
  if (!options.domFallback) {
    for (const name of DOM_FALLBACK_TOOLS) tools[name] = null;
  }
  if (!options.scriptExecution) tools[SCRIPT_EXECUTION_TOOL] = null;
  return tools;
}