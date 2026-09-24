import { guardPreflightFinding, projectFingerprint, type PreflightReviewSource } from "../preflight-guard.ts";
import { useSlate } from "../store.ts";
import type { Shot } from "../types.ts";
import { MARK_TAGS, VIEWS } from "../types.ts";
import type { InputSchema } from "@mcp-b/webmcp-types";
import { applyUiPatch, inspectUiControls } from "./ui-json.ts";
import { executeProductionTool } from "./production-tools.ts";

export interface StudioToolAnnotations {
  readOnlyHint: boolean;
  consequentialHint?: boolean;
}

export interface StudioToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema object accepted at the WebMCP boundary (type: "object" in every catalog entry). */
  inputSchema: InputSchema;
  annotations: StudioToolAnnotations;
  autoExecutable: boolean;
}

export type StudioToolExecution =
  | { ok: true; content: { type: "text"; text: string }[] }
  | { ok: false; error: string };

function textResult(text: string): StudioToolExecution {
  return { ok: true, content: [{ type: "text", text }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.constructor === Object;
}

function asString(value: unknown, field: string): string | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string.` };
  return value;
}

function boundLimit(raw: unknown): number {
  if (raw === undefined) return 50;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return 50;
  return Math.max(1, Math.min(500, raw));
}

function buildGetStudioState(): StudioToolExecution {
  const state = useSlate.getState();
  const project = state.project;
  return textResult(
    JSON.stringify(
      {
        view: state.view,
        projectId: project.id,
        title: project.name,
        selectedShotId: state.selectedId,
        selectedElementId: state.selectedElementId,
        selectedElementIds: state.selectedElementIds,
        hydrated: state.hydrated,
        counts: {
          shots: project.shots.length,
          scriptElements: project.script.length,
          marks: project.marks?.length ?? 0,
        },
      },
      null,
      2,
    ),
  );
}

function buildGetUiSnapshot(args: Record<string, unknown>): StudioToolExecution {
  const limit = args.limit === undefined ? 250 : boundLimit(args.limit);
  const result = inspectUiControls(limit);
  if (!result.ok) return result;
  const state = useSlate.getState();
  return textResult(
    JSON.stringify(
      {
        projectId: state.project.id,
        view: state.view,
        ...result.snapshot,
      },
      null,
      2,
    ),
  );
}

async function buildApplyUiPatch(args: Record<string, unknown>): Promise<StudioToolExecution> {
  const result = await applyUiPatch(args);
  if (!result.ok) return result;
  const state = useSlate.getState();
  return textResult(
    JSON.stringify(
      {
        projectId: state.project.id,
        view: state.view,
        ...result.result,
      },
      null,
      2,
    ),
  );
}

function buildGetScriptOutline(args: Record<string, unknown>): StudioToolExecution {
  const limit = boundLimit(args.limit);
  const project = useSlate.getState().project;
  const elements = project.script.slice(0, limit).map((element) => {
    const text = element.text.length <= 500 ? element.text : `${element.text.slice(0, 500)}…`;
    const summary: Record<string, unknown> = {
      id: element.id,
      kind: element.kind,
      text,
    };
    if (element.character) summary.character = element.character;
    return summary;
  });
  return textResult(
    JSON.stringify(
      {
        projectId: project.id,
        limit,
        total: project.script.length,
        elements,
      },
      null,
      2,
    ),
  );
}

function buildGetShot(args: Record<string, unknown>): StudioToolExecution {
  const shotId = asString(args.shotId, "shotId");
  if (typeof shotId !== "string") return shotId;
  const project = useSlate.getState().project;
  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) return { ok: false, error: `No setup found with id "${shotId}".` };
  const mediaStatus: Record<string, string> = {
    frame: shot.frameUrl ? "present" : "missing",
    video: shot.videoStatus,
  };
  return textResult(
    JSON.stringify(
      {
        id: shot.id,
        number: shot.number,
        title: shot.title,
        sceneId: shot.sceneId,
        elementIds: shot.elementIds,
        coverageSize: shot.coverageSize,
        coverageRole: shot.coverageRole ?? null,
        camera: shot.camera,
        movement: shot.movement,
        screenDirection: shot.screenDirection,
        durationSec: shot.durationSec,
        timeOfDay: shot.timeOfDay,
        location: shot.location,
        characters: shot.characters,
        lighting: shot.lighting,
        framing: shot.setup,
        notes: shot.notes,
        mediaStatus,
      },
      null,
      2,
    ),
  );
}

function buildSetView(args: Record<string, unknown>): StudioToolExecution {
  const view = asString(args.view, "view");
  if (typeof view !== "string") return view;
  if (!VIEWS.includes(view as (typeof VIEWS)[number])) {
    return { ok: false, error: `view must be one of ${VIEWS.map((v) => `"${v}"`).join(", ")}.` };
  }
  useSlate.getState().setView(view as (typeof VIEWS)[number]);
  return textResult(`View set to "${view}".`);
}

function buildSelectShot(args: Record<string, unknown>): StudioToolExecution {
  const shotIdRaw = args.shotId;
  if (shotIdRaw !== null && shotIdRaw !== undefined && typeof shotIdRaw !== "string") {
    return { ok: false, error: "shotId must be a string or null." };
  }
  const shotId = shotIdRaw as string | null;
  if (shotId !== null) {
    const project = useSlate.getState().project;
    if (!project.shots.some((s) => s.id === shotId)) {
      return { ok: false, error: `No setup found with id "${shotId}".` };
    }
  }
  useSlate.getState().selectShot(shotId);
  return textResult(shotId === null ? "Cleared setup selection." : `Selected setup "${shotId}".`);
}

function buildSelectElement(args: Record<string, unknown>): StudioToolExecution {
  const elementIdRaw = args.elementId;
  if (elementIdRaw !== null && elementIdRaw !== undefined && typeof elementIdRaw !== "string") {
    return { ok: false, error: "elementId must be a string or null." };
  }
  const elementId = elementIdRaw as string | null;
  if (elementId !== null) {
    const project = useSlate.getState().project;
    if (!project.script.some((e) => e.id === elementId)) {
      return { ok: false, error: `No screenplay element found with id "${elementId}".` };
    }
  }
  useSlate.getState().selectElement(elementId, "replace");
  return textResult(elementId === null ? "Cleared element selection." : `Selected screenplay element "${elementId}".`);
}

function buildBoardElement(args: Record<string, unknown>): StudioToolExecution {
  const elementId = asString(args.elementId, "elementId");
  if (typeof elementId !== "string") return elementId;
  const project = useSlate.getState().project;
  if (!project.script.some((e) => e.id === elementId)) {
    return { ok: false, error: `No screenplay element found with id "${elementId}".` };
  }
  useSlate.getState().boardElement(elementId);
  const state = useSlate.getState();
  const covering = project.shots.find((s) => s.elementIds.includes(elementId)) ?? null;
  const selected = state.selectedId;
  return textResult(
    covering
      ? `Selected existing coverage for element "${elementId}".`
      : `Created new coverage for element "${elementId}"${selected ? ` (setup "${selected}")` : ""}.`,
  );
}

function buildAddScriptMark(args: Record<string, unknown>): StudioToolExecution {
  const elementId = asString(args.elementId, "elementId");
  if (typeof elementId !== "string") return elementId;
  const quote = asString(args.quote, "quote");
  if (typeof quote !== "string") return quote;
  const tag = asString(args.tag, "tag");
  if (typeof tag !== "string") return tag;
  const note = typeof args.note === "undefined" ? "" : asString(args.note, "note");
  if (typeof note !== "string") return note;

  const project = useSlate.getState().project;
  const fingerprint = projectFingerprint(project);
  const source: PreflightReviewSource = {
    projectId: project.id,
    fingerprint,
    reviewFingerprint: fingerprint,
    backendProjectId: null,
    sourceRevision: null,
    resultRevision: null,
  };
  const guard = guardPreflightFinding(project, source, { elementId, text: quote, tag, note });
  if (!guard.ok) return { ok: false, error: guard.error };

  useSlate.getState().addMark(guard.mark);
  return textResult(`Added ${guard.mark.tag} mark to element "${elementId}".`);
}

const AGENT_SAFE_SHOT_FIELDS = ["notes"] as const;

type AgentSafeShotPatch = Pick<Shot, (typeof AGENT_SAFE_SHOT_FIELDS)[number]>;

function buildPatchShot(args: Record<string, unknown>): StudioToolExecution {
  const shotId = asString(args.shotId, "shotId");
  if (typeof shotId !== "string") return shotId;
  const fields = args.fields;
  if (!isPlainObject(fields)) {
    return { ok: false, error: "fields must be an object." };
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return { ok: false, error: "fields must contain at least one supported key." };
  }
  // SAFETY: widening the const tuple to readonly string[] is total — membership
  // in a wider array is exactly membership in the tuple, and unknown keys fall
  // through to the unsupported-field error below.
  const unsupported = keys.filter((k) => !(AGENT_SAFE_SHOT_FIELDS as readonly string[]).includes(k));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `Unsupported fields: ${unsupported.map((k) => `"${k}"`).join(", ")}. Only ${AGENT_SAFE_SHOT_FIELDS.map((k) => `"${k}"`).join(", ")} may be patched by the agent.`,
    };
  }
  if (typeof fields.notes !== "string") {
    return { ok: false, error: "notes must be a string." };
  }
  const partial: AgentSafeShotPatch = { notes: fields.notes };
  const result = useSlate.getState().patchShot(shotId, partial);
  if (!result.ok) return { ok: false, error: result.error };
  return textResult(`Patched setup "${shotId}" notes.`);
}

function buildStageAssistantQuestion(args: Record<string, unknown>): StudioToolExecution {
  const question = asString(args.question, "question");
  if (typeof question !== "string") return question;
  if (question.length < 1 || question.length > 4000) {
    return { ok: false, error: "question must be between 1 and 4000 characters." };
  }
  const projectId = useSlate.getState().project.id;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("slate:stage-assistant-question", { detail: { projectId, question } }),
    );
  }
  return textResult(`Staged assistant question for project "${projectId}".`);
}

const TOOLS: StudioToolDescriptor[] = [
  {
    name: "get_ui_snapshot",
    description:
      "Returns a versioned JSON snapshot of visible controls and panels in the current ReelBinder page. Use the returned revision and control refs for apply_ui_patch.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Maximum visible controls to include (default 250).",
        },
      },
    },
    annotations: { readOnlyHint: true },
    autoExecutable: false,
  },
  {
    name: "apply_ui_patch",
    description:
      "Applies an ordered JSON patch to visible controls from a current get_ui_snapshot result and returns per-operation readback. Reinspect after the UI changes.",
    inputSchema: {
      type: "object",
      properties: {
        revision: {
          type: "integer",
          minimum: 1,
          description: "Revision returned by get_ui_snapshot.",
        },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              ref: { type: "string", minLength: 1 },
              action: {
                type: "string",
                enum: ["click", "fill", "select", "check", "uncheck", "focus"],
              },
              value: { type: "string" },
            },
            required: ["ref", "action"],
            additionalProperties: false,
          },
        },
      },
      required: ["revision", "operations"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },

  {
    name: "get_studio_state",
    description:
      "Returns the current ReelBinder studio state: active view, project id/title, selected setup/element ids, hydration status, and counts of setups, screenplay elements, and marks.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "get_script_outline",
    description:
      "Returns a bounded outline of the screenplay (project script). Each element includes id, kind, optional character, and a truncated text preview. Use the limit parameter to control how many elements are returned (1..500, default 50).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum number of screenplay elements to return (default 50)." },
      },
    },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "get_shot",
    description:
      "Returns a bounded summary of a single setup/coverage shot by id: number, title, linked screenplay element ids, framing, movement, notes, and media status. Returns an error if the shot id does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", description: "The id of the setup/coverage shot to read." },
      },
      required: ["shotId"],
    },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "set_view",
    description: "Switches the studio workspace view to script, stage, edit, or render.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: VIEWS.slice(),
          description: "The workspace view to activate: script, stage, edit, or render.",
        },
      },
      required: ["view"],
    },
    annotations: { readOnlyHint: false },
    autoExecutable: true,
  },
  {
    name: "select_shot",
    description: "Selects or clears the active setup/coverage shot. Use null to clear the selection.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: {
          oneOf: [
            { type: "string", description: "The id of the setup/coverage shot to select." },
            { type: "null", description: "Clear the setup selection." },
          ],
          description: "Setup id to select, or null to clear.",
        },
      },
      required: ["shotId"],
    },
    annotations: { readOnlyHint: false },
    autoExecutable: true,
  },
  {
    name: "select_element",
    description: "Selects or clears the active screenplay element. Use null to clear the selection.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: {
          oneOf: [
            { type: "string", description: "The id of the screenplay element to select." },
            { type: "null", description: "Clear the element selection." },
          ],
          description: "Screenplay element id to select, or null to clear.",
        },
      },
      required: ["elementId"],
    },
    annotations: { readOnlyHint: false },
    autoExecutable: true,
  },
  {
    name: "board_element",
    description:
      "Creates a new coverage setup for the given screenplay element, or selects the existing coverage if one already covers it. Requires the element id to exist.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: {
          type: "string",
          description: "The id of the screenplay element to board into a coverage setup.",
        },
      },
      required: ["elementId"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "add_script_mark",
    description:
      "Adds a screenplay mark (production note) to an exact quoted passage within a screenplay element. The quote must appear exactly once in the element text. Requires a valid mark tag.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Screenplay element id containing the quote." },
        quote: { type: "string", description: "Exact passage to mark. Must occur exactly once in the element text." },
        tag: { type: "string", enum: MARK_TAGS.slice(), description: "Mark tag/category." },
        note: { type: "string", description: "Optional note attached to the mark." },
      },
      required: ["elementId", "quote", "tag"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "patch_shot",
    description:
      "Patches an existing setup/coverage shot with an agent-safe subset of fields. Currently only 'notes' is supported; notes inform generated prompts without rewriting linked screenplay events.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", description: "The id of the setup/coverage shot to patch." },
        fields: {
          type: "object",
          properties: {
            notes: {
              type: "string",
              description: "Free-form production notes for the setup. Updating notes does not overwrite linked screenplay action or dialogue.",
            },
          },
          description: "Agent-safe shot fields. Only 'notes' is permitted; other fields require the filmmaker's manual review.",
        },
      },
      required: ["shotId", "fields"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "get_overhead_state",
    description: "Read the bounded overhead diagram for a setup, including floor items, cameras, blocking figures, and the active camera.",
    inputSchema: {
      type: "object",
      properties: { shotId: { type: "string", description: "Setup id; defaults to the selected setup." } },
    },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "patch_overhead",
    description: "Add or remove overhead items, cameras, and blocking figures with validated JSON operations. Requires filmmaker approval.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", description: "Setup id; defaults to the selected setup." },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description: "Operations: add_item {kind,x,y,label?}, remove_item {id}, add_camera {x,y}, remove_camera {id}, add_figure {name,x,y}, remove_figure {id}.",
        },
      },
      required: ["operations"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "get_frame_state",
    description: "Read the bounded framing sketch, stamps, annotations, and linked cast for a setup.",
    inputSchema: {
      type: "object",
      properties: { shotId: { type: "string", description: "Setup id; defaults to the selected setup." } },
    },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "patch_frame",
    description: "Place or remove cast, prop, and architecture items, or add/remove framing strokes and annotations with validated JSON operations. Cast placement updates the linked figure stamp; architecture placement is a pencil stroke. Selection remains a local UI state. Requires filmmaker approval.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", description: "Setup id; defaults to the selected setup." },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description: "Operations: place_item {kind:cast|prop|architecture,x,y,figureId?,points?,label?}, remove_item {id}, add_stamp {kind,x,y,figureId?}, remove_stamp {id}, add_stroke {tool,points}, remove_stroke {id}, add_annotation {kind,points,label?}, remove_annotation {id}.",
        },
      },
      required: ["operations"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "get_cut_state",
    description: "Read the revision-guarded shot list and ordered picture timeline clips without changing project state.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    autoExecutable: true,
  },
  {
    name: "sync_shot_timeline",
    description: "Apply an explicit, revision-guarded picture-clip order and optional drops while preserving non-picture tracks and clip metadata. Requires filmmaker approval.",
    inputSchema: {
      type: "object",
      properties: {
        expectedProjectId: { type: "string", minLength: 1 },
        expectedPictureClipIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
        orderedPictureClipIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
      },
      required: ["expectedProjectId", "expectedRevision", "expectedPictureClipIds", "orderedPictureClipIds"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "patch_frame_history",
    description: "Remove explicitly named inactive frame-history versions for one setup with project and history revision guards. The active frame is never removed. Requires filmmaker approval.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", minLength: 1 },
        expectedProjectId: { type: "string", minLength: 1 },
        expectedRevision: { type: "string", minLength: 1 },
        expectedHistoryIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
        removeIds: { type: "array", minItems: 1, maxItems: 500, items: { type: "string", minLength: 1 } },
      },
      required: ["shotId", "expectedProjectId", "expectedRevision", "expectedHistoryIds", "removeIds"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "import_still",
    description: "Attach a validated local PNG, JPEG, or WebP data URL to an explicitly identified setup, preserving prior frame history. Requires filmmaker approval.",
    inputSchema: {
      type: "object",
      properties: {
        shotId: { type: "string", minLength: 1 },
        setup: { type: "string", minLength: 1 },
        dataUrl: { type: "string", minLength: 1, maxLength: 1500000 },
        expectedProjectId: { type: "string", minLength: 1 },
        expectedRevision: { type: "string", minLength: 1 },
        expectedFrameUrl: { type: ["string", "null"] },
        expectedHistoryIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
      },
      required: ["shotId", "setup", "dataUrl", "expectedProjectId", "expectedRevision", "expectedFrameUrl", "expectedHistoryIds"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true },
    autoExecutable: false,
  },
  {
    name: "stage_assistant_question",
    description:
      "Stages a question for the in-app ReelBinder production assistant and opens the assistant drawer. The assistant will answer using the current project context.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "Question to stage for the production assistant (1..4000 characters).",
        },
      },
      required: ["question"],
    },
    annotations: { readOnlyHint: false },
    autoExecutable: false,
  },
];

export const STUDIO_TOOLS: readonly StudioToolDescriptor[] = TOOLS;

export async function executeStudioTool(
  name: string,
  args: Record<string, unknown>,
): Promise<StudioToolExecution> {
  if (typeof name !== "string" || !/^[a-zA-Z0-9_]+$/.test(name)) {
    return { ok: false, error: `Invalid tool name "${String(name)}".` };
  }
  if (!isPlainObject(args)) {
    return { ok: false, error: "Tool arguments must be an object." };
  }
  switch (name) {
    case "get_ui_snapshot":
      return buildGetUiSnapshot(args);
    case "apply_ui_patch":
      return buildApplyUiPatch(args);
    case "get_studio_state":
      return buildGetStudioState();
    case "get_script_outline":
      return buildGetScriptOutline(args);
    case "get_shot":
      return buildGetShot(args);
    case "set_view":
      return buildSetView(args);
    case "select_shot":
      return buildSelectShot(args);
    case "select_element":
      return buildSelectElement(args);
    case "board_element":
      return buildBoardElement(args);
    case "add_script_mark":
      return buildAddScriptMark(args);
    case "patch_shot":
      return buildPatchShot(args);
    case "get_overhead_state":
    case "patch_overhead":
    case "get_frame_state":
    case "patch_frame":
    case "get_cut_state":
    case "sync_shot_timeline":
    case "patch_frame_history":
    case "import_still":
      return executeProductionTool(name, args);
    case "stage_assistant_question":
      return buildStageAssistantQuestion(args);
    default:
      return { ok: false, error: `Unknown studio tool "${name}".` };
  }
}
