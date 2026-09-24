"""Studio WebMCP tool catalog for agent-driven UI navigation.

Mirrors the shared contract in src/lib/webmcp/studio-tools.ts so the backend
knows which tool names the in-page assistant is allowed to invoke automatically.
Only read/navigation tools are auto-executable; creative mutations are not.
"""

import json
from typing import Any

StudioToolAnnotations = dict[str, Any]
StudioToolDescriptor = dict[str, Any]


_MARK_TAGS = [
    "lock",
    "hold",
    "eyeline",
    "cam",
    "beat",
    "sound",
    "no",
    "phys",
    "cut",
    "cont",
    "cast",
    "extras",
    "prop",
    "dressing",
    "wardrobe",
    "makeup",
    "vehicle",
    "animal",
    "stunt",
    "sfx",
    "vfx",
    "music",
    "equipment",
    "location",
]


def _tool(
    name: str,
    description: str,
    input_schema: dict[str, Any],
    annotations: StudioToolAnnotations,
    auto_executable: bool,
) -> StudioToolDescriptor:
    return {
        "name": name,
        "description": description,
        "inputSchema": input_schema,
        "annotations": annotations,
        "autoExecutable": auto_executable,
    }


_STUDIO_TOOLS: tuple[StudioToolDescriptor, ...] = (
    _tool(
        "get_ui_snapshot",
        "Return a versioned JSON snapshot of visible controls and panels. Use its revision and refs with apply_ui_patch.",
        {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 500}},
            "required": [],
        },
        {"readOnlyHint": True},
        False,
    ),
    _tool(
        "apply_ui_patch",
        "Apply ordered JSON operations to visible controls from get_ui_snapshot and return readback. Requires filmmaker approval.",
        {
            "type": "object",
            "properties": {
                "revision": {"type": "integer", "minimum": 1},
                "operations": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 50,
                    "items": {
                        "type": "object",
                        "properties": {
                            "ref": {"type": "string", "minLength": 1},
                            "action": {
                                "type": "string",
                                "enum": ["click", "fill", "select", "check", "uncheck", "focus"],
                            },
                            "value": {"type": "string"},
                        },
                        "required": ["ref", "action"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["revision", "operations"],
            "additionalProperties": False,
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "get_studio_state",
        "Read the current studio view, project id/selection/counts, and hydration status.",
        {"type": "object", "properties": {}, "required": []},
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "get_script_outline",
        "List script elements with bounded text. Optional limit (1..500) caps element count.",
        {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 500}},
            "required": [],
        },
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "get_shot",
        "Read a bounded shot summary by id (number, coverage, framing, movement, notes, media status).",
        {
            "type": "object",
            "properties": {"shotId": {"type": "string", "minLength": 1}},
            "required": ["shotId"],
        },
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "set_view",
        "Switch the studio UI to the given view (script, stage, edit, or render).",
        {
            "type": "object",
            "properties": {"view": {"type": "string", "enum": ["script", "stage", "edit", "render"]}},
            "required": ["view"],
        },
        {"readOnlyHint": False, "consequentialHint": False},
        True,
    ),
    _tool(
        "select_shot",
        "Focus a shot in the studio UI. Pass null to clear the selection.",
        {
            "type": "object",
            "properties": {"shotId": {"type": ["string", "null"], "minLength": 1}},
            "required": ["shotId"],
        },
        {"readOnlyHint": False, "consequentialHint": False},
        True,
    ),
    _tool(
        "select_element",
        "Focus a script element in the studio UI. Pass null to clear the selection.",
        {
            "type": "object",
            "properties": {"elementId": {"type": ["string", "null"], "minLength": 1}},
            "required": ["elementId"],
        },
        {"readOnlyHint": False, "consequentialHint": False},
        True,
    ),
    _tool(
        "board_element",
        "Board a script element into a new shot. Requires filmmaker approval; not auto-executable.",
        {
            "type": "object",
            "properties": {"elementId": {"type": "string", "minLength": 1}},
            "required": ["elementId"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "add_script_mark",
        "Add a production mark to a script element. Requires filmmaker approval; not auto-executable.",
        {
            "type": "object",
            "properties": {
                "elementId": {"type": "string", "minLength": 1},
                "quote": {"type": "string", "minLength": 1},
                "tag": {"type": "string", "enum": _MARK_TAGS},
                "note": {"type": "string"},
            },
            "required": ["elementId", "quote", "tag"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "patch_shot",
        "Update the notes field of an existing shot. Requires filmmaker approval; not auto-executable.",
        {
            "type": "object",
            "properties": {
                "shotId": {"type": "string", "minLength": 1},
                "fields": {
                    "type": "object",
                    "properties": {"notes": {"type": "string"}},
                    "required": ["notes"],
                    "additionalProperties": False,
                },
            },
            "required": ["shotId", "fields"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "get_overhead_state",
        "Read the bounded overhead diagram for a setup.",
        {
            "type": "object",
            "properties": {"shotId": {"type": "string", "minLength": 1}},
            "required": [],
        },
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "patch_overhead",
        "Add or remove overhead items, cameras, and blocking figures. Operations: add_item {kind,x,y,label?}, remove_item {id}, add_camera {x,y}, remove_camera {id}, add_figure {name,x,y}, remove_figure {id}. Requires filmmaker approval.",
        {
            "type": "object",
            "properties": {
                "shotId": {"type": "string", "minLength": 1},
                "operations": {"type": "array", "minItems": 1, "maxItems": 50, "items": {"type": "object"}},
            },
            "required": ["operations"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "get_frame_state",
        "Read the bounded framing sketch, stamps, annotations, and linked cast for a setup.",
        {"type": "object", "properties": {"shotId": {"type": "string", "minLength": 1}}, "required": []},
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "patch_frame",
        "Place or remove cast, prop, and architecture items, or add/remove framing strokes and annotations. Operations: place_item {kind:cast|prop|architecture,x,y,figureId?,points?,label?}, remove_item {id}, add_stamp {kind,x,y,figureId?}, remove_stamp {id}, add_stroke {tool,points}, remove_stroke {id}, add_annotation {kind,points,label?}, remove_annotation {id}. Cast placement updates the linked figure stamp; architecture placement is a pencil stroke. Selection remains a local UI state. Requires filmmaker approval.",
        {
            "type": "object",
            "properties": {
                "shotId": {"type": "string", "minLength": 1},
                "operations": {"type": "array", "minItems": 1, "maxItems": 50, "items": {"type": "object"}},
            },
            "required": ["operations"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "get_cut_state",
        "Read the revision-guarded shot list and ordered picture timeline clips.",
        {"type": "object", "properties": {}, "required": []},
        {"readOnlyHint": True},
        True,
    ),
    _tool(
        "sync_shot_timeline",
        "Apply an explicit revision-guarded picture-clip order and optional drops while preserving non-picture tracks. Requires filmmaker approval.",
        {
            "properties": {
                "expectedProjectId": {"type": "string", "minLength": 1},
                "expectedRevision": {"type": "string", "minLength": 1},
                "expectedPictureClipIds": {"type": "array", "maxItems": 500, "items": {"type": "string", "minLength": 1}},
                "orderedPictureClipIds": {"type": "array", "maxItems": 500, "items": {"type": "string", "minLength": 1}},
            },
            "required": ["expectedProjectId", "expectedRevision", "expectedPictureClipIds", "orderedPictureClipIds"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "patch_frame_history",
        "Remove explicitly named inactive frame-history versions for one setup. The active frame is never removed.",
        {
            "type": "object",
            "properties": {
                "shotId": {"type": "string", "minLength": 1},
                "expectedProjectId": {"type": "string", "minLength": 1},
                "expectedRevision": {"type": "string", "minLength": 1},
                "expectedHistoryIds": {"type": "array", "maxItems": 500, "items": {"type": "string", "minLength": 1}},
                "removeIds": {"type": "array", "minItems": 1, "maxItems": 500, "items": {"type": "string", "minLength": 1}},
            },
            "required": ["shotId", "expectedProjectId", "expectedRevision", "expectedHistoryIds", "removeIds"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "import_still",
        "Attach a validated local PNG, JPEG, or WebP data URL to an explicitly identified setup and preserve prior frame history.",
        {
            "type": "object",
            "properties": {
                "shotId": {"type": "string", "minLength": 1},
                "setup": {"type": "string", "minLength": 1},
                "dataUrl": {"type": "string", "minLength": 1, "maxLength": 1500000},
                "expectedProjectId": {"type": "string", "minLength": 1},
                "expectedRevision": {"type": "string", "minLength": 1},
                "expectedFrameUrl": {"type": ["string", "null"]},
                "expectedHistoryIds": {"type": "array", "maxItems": 500, "items": {"type": "string", "minLength": 1}},
            },
            "required": ["shotId", "setup", "dataUrl", "expectedProjectId", "expectedRevision", "expectedFrameUrl", "expectedHistoryIds"],
        },
        {"readOnlyHint": False, "consequentialHint": True},
        False,
    ),
    _tool(
        "stage_assistant_question",
        "Stage a question in the Production Assistant input and open the assistant drawer.",
        {
            "type": "object",
            "properties": {"question": {"type": "string", "minLength": 1, "maxLength": 4000}},
            "required": ["question"],
        },
        {"readOnlyHint": False},
        False,
    ),
)

AUTO_EXECUTABLE_TOOLS: frozenset[str] = frozenset(
    t["name"] for t in _STUDIO_TOOLS if t["autoExecutable"]
)

_MAX_UI_ACTIONS = 10
_MAX_SERIALIZED_ACTION_BYTES = 1024


def ui_actions_instruction() -> str:
    """Compact instruction appended to preflight prompts describing allowed ui_actions."""
    lines = [
        "You may also return ui_actions, a list of at most 10 auto-executable browser actions",
        "that navigate or read the studio UI to point the filmmaker to relevant content.",
        "These actions run in the browser and never modify creative project content.",
        "Allowed tools:",
    ]
    for tool in _STUDIO_TOOLS:
        if not tool["autoExecutable"]:
            continue
        name = tool["name"]
        schema = tool["inputSchema"]
        req = ", ".join(schema.get("required", []))
        shape = f"({req})" if req else "()"
        lines.append(f"- {name}{shape}: {tool['description']}")
    lines.append("Drop any tool name not in this list and any action whose args is not a JSON object.")
    return " ".join(lines)


def validate_ui_actions(raw: Any) -> list[dict[str, Any]]:
    """Return only catalog-allowed, well-shaped ui_actions, bounded for safety.

    Unknown input is accepted and dropped; the caller never fails a job because
    of malformed ui_actions.
    """
    if not isinstance(raw, list):
        return []
    valid: list[dict[str, Any]] = []
    for item in raw[:_MAX_UI_ACTIONS]:
        if not isinstance(item, dict):
            continue
        tool = item.get("tool")
        args = item.get("args")
        if not isinstance(tool, str) or tool not in AUTO_EXECUTABLE_TOOLS:
            continue
        if not isinstance(args, dict):
            continue
        serialized = len(json.dumps({"tool": tool, "args": args}).encode("utf-8"))
        if serialized > _MAX_SERIALIZED_ACTION_BYTES:
            continue
        valid.append({"tool": tool, "args": args})
        if len(valid) >= _MAX_UI_ACTIONS:
            break
    return valid
