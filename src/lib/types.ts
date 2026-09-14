import type { CinemaFrameVersion } from "./cinema-images";
import type { CinemaMediaAsset, CinemaMediaVersion } from "./cinema-media";
import type { ScriptCommentThread } from "./script-comments";
export type { ScriptCommentThread } from "./script-comments";

export const CAMERA_ANGLES = [
  "extreme-wide",
  "wide",
  "full",
  "medium",
  "close-up",
  "extreme-close-up",
  "low-angle",
  "high-angle",
  "birds-eye",
  "dutch",
  "pov",
  "over-the-shoulder",
  "insert",
] as const;
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

export const CAMERA_MOVEMENTS = [
  "static",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "dolly-in",
  "dolly-out",
  "tracking",
  "handheld",
  "crane",
  "orbit",
] as const;
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number];

export const SCREEN_DIRECTIONS = ["L-R", "R-L", "toward", "away", "static"] as const;
export type ScreenDirection = (typeof SCREEN_DIRECTIONS)[number];

export const TIMES_OF_DAY = [
  "dawn",
  "day",
  "golden-hour",
  "dusk",
  "night",
  "interior-day",
  "interior-night",
] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const TARGETS = ["imagine", "veo", "runway", "both"] as const;
export type Target = (typeof TARGETS)[number];

export const TARGET_LABEL: Record<Target, string> = {
  imagine: "Imagine",
  veo: "Veo 3",
  runway: "Runway",
  both: "All three",
};

export const VIEWS = ["script", "stage", "edit", "render"] as const;
export type View = (typeof VIEWS)[number];

export const SCRIPT_KINDS = [
  "scene",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
] as const;
export type ScriptKind = (typeof SCRIPT_KINDS)[number];

export const EVENT_KINDS = ["move", "gesture", "interact", "speech", "sound", "change"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  move: "Move",
  gesture: "Gesture",
  interact: "Interact",
  speech: "Speech",
  sound: "Sound",
  change: "Change",
};

export const SCENE_TARGET = "SCENE";
export const CAMERA_TARGET = "CAMERA";

export const COVERAGE_SIZES = ["WS", "LS", "MS", "MCU", "CU", "ECU", "OTS", "2S", "Insert"] as const;
export type CoverageSize = (typeof COVERAGE_SIZES)[number];

export const LINE_COLORS = ["ink", "red", "blue", "green", "brown", "plum"] as const;
export type LineColor = (typeof LINE_COLORS)[number];

export const STEER_TAGS = [
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
] as const;
export type SteerTag = (typeof STEER_TAGS)[number];

export const CATALOG_TAGS = [
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
] as const;
export type CatalogTag = (typeof CATALOG_TAGS)[number];

export const MARK_TAGS = [...STEER_TAGS, ...CATALOG_TAGS] as const;
export type MarkTag = (typeof MARK_TAGS)[number];

export const BINDER_TABS = [
  "cut",
  "diagrams",
  "wardrobe",
  "props",
  "boards",
  "breakdown",
  "shots",
] as const;
export type BinderTab = (typeof BINDER_TABS)[number];

export const BINDER_TAB_LABEL: Record<BinderTab, string> = {
  cut: "Cut",
  diagrams: "Diagrams",
  wardrobe: "Wardrobe",
  props: "Props",
  boards: "Boards",
  breakdown: "Breakdown",
  shots: "Shot list",
};

export type SketchTool = "pencil" | "eraser" | "figure" | "box";
export type FrameKind = "storyboard" | "still";
export type VideoStatus = "idle" | "pending" | "done" | "failed";

export const FLOOR_KINDS = [
  "wall",
  "bar",
  "door",
  "window",
  "table",
  "stool",
  "chair",
  "mark",
  "well",
  "rect",
  "circle",
  "arrow",
] as const;
export type FloorKind = (typeof FLOOR_KINDS)[number];

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  tool: SketchTool;
  points: Point[];
  color: string;
  width: number;
}

export interface Stamp {
  id: string;
  kind: "figure" | "box";
  x: number;
  y: number;
  scale: number;
  label?: string;
  figureId?: string;
}

export interface SketchData {
  strokes: Stroke[];
  stamps: Stamp[];
}

export interface FloorItem {
  id: string;
  kind: FloorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  label: string;
  shotId?: string | null;
  locked?: boolean;
  productionItemId?: string;
  markId?: string;
}

export interface FloorFigure {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: number;
  targetId?: string;
}

export type CameraRotationMode = "over-time" | "static" | "target";

export interface FloorCamera {
  id: string;
  shotId: string;
  setup: string;
  x: number;
  y: number;
  angle: number;
  fov: number;
  path?: Point[];
  rotationMode?: CameraRotationMode;
  targetId?: string | null;
}

export interface FloorPlan {
  label: string;
  items: FloorItem[];
  cameras: FloorCamera[];
  homes: FloorFigure[];
  path: Point[];
}

export interface ShotBlocking {
  figures: FloorFigure[];
}

export interface Annotation {
  id: string;
  kind: "arrow" | "box" | "note" | "continuity";
  points: Point[];
  label: string;
  color: string;
  threadId?: string;
}

export interface ScriptProductionDirection {
  shotId: string;
  coverageSize: CoverageSize;
  camera: CameraAngle;
  movement: CameraMovement;
  screenDirection: ScreenDirection;
  timeOfDay: TimeOfDay;
  lighting?: string;
  location?: string;
}

export interface ScriptElement {
  id: string;
  kind: ScriptKind;
  text: string;
  character?: string;
  productionDirections?: ScriptProductionDirection[];
}

export type IssueSeverity = "error" | "warn" | "info";

export interface ContinuityIssue {
  id: string;
  shotId: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
}

export interface WorldEvent {
  id: string;
  target: string;
  kind: EventKind;
  text: string;
  startSec: number;
  endSec: number;
}

export interface WorldLock {
  place: string;
  lighting: string;
  ambience: string;
  laws: string;
  genesisUrl?: string | null;
}

export interface ScriptMark {
  id: string;
  tag: MarkTag;
  text: string;
  note: string;
  elementId: string;
  start: number;
  end: number;
  sceneId: string | null;
  /** Stable global production item; the mark remains its own screenplay occurrence. */
  productionItemId?: string;
  /** Unresolved anchors retain their original quote, range and notes for repair. */
  anchorStatus?: "missing" | "ambiguous";
}

export interface PreflightFinding {
  id: string;
  elementId: string | null;
  severity: IssueSeverity;
  title: string;
  detail: string;
  suggest?: {
    tag: MarkTag;
    text: string;
    note: string;
    start?: number;
    end?: number;
  };
}

export interface Shot {
  id: string;
  number: number;
  title: string;
  action: string;
  dialogue: string;
  camera: CameraAngle;
  movement: CameraMovement;
  screenDirection: ScreenDirection;
  durationSec: number;
  timeOfDay: TimeOfDay;
  location: string;
  characters: string[];
  lighting: string;
  notes: string;
  sketch: SketchData;
  blocking: ShotBlocking;
  annotations: Annotation[];
  events: WorldEvent[];
  setup: string;
  coverageSize: CoverageSize;
  /** Coverage purpose, independent of framing size (MS remains medium shot). */
  coverageRole?: "master" | "angle";
  /** Prior lined passage saved when an angle becomes a master; absent for native masters. */
  angleElementIds?: string[];
  lineColor: LineColor;
  frameUrl: string | null;
  frameKind: FrameKind;
  frameHistory?: CinemaFrameVersion[];
  videoUrl: string | null;
  videoHistory?: CinemaMediaVersion[];
  videoRequestId: string | null;
  videoStatus: VideoStatus;
  veoPrompt: string;
  runwayPrompt: string;
  imaginePrompt: string;
  rawSource: string;
  sceneId: string | null;
  elementIds: string[];
}

export interface CharacterBible {
  name: string;
  look: string;
  voice?: string;
  start?: string;
  aliases?: string[];
}

export const TIMELINE_TRACKS = ["picture", "coverage", "dialogue", "sound"] as const;
export type TimelineTrack = (typeof TIMELINE_TRACKS)[number];

export const TRACK_LABEL: Record<TimelineTrack, string> = {
  picture: "Picture",
  coverage: "Coverage",
  dialogue: "Dialogue",
  sound: "Sound",
};

export interface TimelineClip {
  id: string;
  shotId: string;
  track: TimelineTrack;
  start: number;
  duration: number;
  label?: string;
  /** Source media seconds, independent of the clip's position in the output cut. */
  sourceInSec?: number;
  sourceOutSec?: number;
  /** Script coverage represented by this excerpt, independent of output order. */
  storyElementIds?: string[];
  alignment?: "estimated" | "manual";
  /** Freeze selected media when present; legacy clips use the shot's current media. */
  sourceVideoUrl?: string;
  sourceFrameUrl?: string;
  /** Persisted native source mix; separate from the edit player's listening mute. */
  audioGain?: number;
  audioMuted?: boolean;
}

/** Explicit owned audio; durationSec is measured source length, duration is edit length. */
export interface TimelineAudioClip extends CinemaMediaAsset {
  id: string;
  track: "voiceover" | "sfx" | "music";
  mimeType: "audio/wav";
  label: string;
  start: number;
  duration: number;
  sourceInSec: number;
  gain: number;
  muted: boolean;
}

export interface EditTimeline {
  clips: TimelineClip[];
  /** An intentionally empty edit must not be regenerated on every visit. */
  initialized?: boolean;
}

export interface PromptSkill {
  id: string;
  title: string;
  body: string;
}

export interface PromptLayer {
  id: string;
  title: string;
  text: string;
}

export interface BinderAsset {
  id: string;
  tab: BinderTab;
  title: string;
  url?: string | null;
  caption?: string;
  character?: string;
}

export interface BreakdownItem {
  id: string;
  department: string;
  item: string;
  notes?: string;
  sceneId?: string | null;
  tag?: CatalogTag;
  aliases?: string[];
  mergedIds?: string[];
  preservedNotes?: { sourceId: string; notes: string; scope?: ProductionScope }[];
  overrides?: ProductionItemOverride[];
}

export interface ProductionScope {
  kind: "scene" | "shot";
  id: string;
}

export interface ProductionItemOverride {
  id: string;
  scope: ProductionScope;
  notes: string;
}

export interface Project {
  id: string;
  name: string;
  logline: string;
  style: string;
  target: Target;
  world: WorldLock;
  characters: CharacterBible[];
  script: ScriptElement[];
  shots: Shot[];
  skills: PromptSkill[];
  chain: string[];
  cutUrl: string | null;
  demoSource?: "planning-study" | "finished-study";
  musicAssets?: CinemaMediaAsset[];
  audioClips?: TimelineAudioClip[];
  binder: BinderAsset[];
  breakdown: BreakdownItem[];
  marks: ScriptMark[];
  scriptCommentThreads?: ScriptCommentThread[];
  floor: FloorPlan;
  timeline: EditTimeline;
  updatedAt: number;
}

const STRUCTURE_KEYS: (keyof Shot)[] = [
  "title",
  "action",
  "dialogue",
  "camera",
  "movement",
  "screenDirection",
  "durationSec",
  "timeOfDay",
  "location",
  "characters",
  "lighting",
  "notes",
  "annotations",
];

export function isStructuredPatch(partial: Partial<Shot>): boolean {
  return STRUCTURE_KEYS.some((k) => k in partial);
}

export function emptySketch(): SketchData {
  return { strokes: [], stamps: [] };
}

export function emptyBlocking(): ShotBlocking {
  return { figures: [] };
}

export function emptyTimeline(): EditTimeline {
  return { clips: [] };
}

export function emptyFloor(): FloorPlan {
  return { label: "", items: [], cameras: [], homes: [], path: [] };
}

export function normalizeFloor(raw?: Partial<FloorPlan> | null): FloorPlan {
  const base = emptyFloor();
  if (!raw) return base;
  return {
    label: typeof raw.label === "string" ? raw.label : base.label,
    items: Array.isArray(raw.items) ? raw.items : base.items,
    cameras: Array.isArray(raw.cameras) ? raw.cameras : base.cameras,
    homes: Array.isArray(raw.homes) ? raw.homes : base.homes,
    path: Array.isArray(raw.path) ? raw.path : base.path,
  };
}

export function emptyWorld(): WorldLock {
  return {
    place: "",
    lighting: "",
    ambience: "",
    laws:
      "Gravity behaves like Earth. Faces, wardrobe, weather, and time of day stay locked unless a beat names a change. Camera is third-person cinematic unless a shot is POV.",
    genesisUrl: null,
  };
}

function asCoverageSize(raw: unknown, camera?: CameraAngle): CoverageSize {
  if (typeof raw === "string" && (COVERAGE_SIZES as readonly string[]).includes(raw)) return raw as CoverageSize;
  if (camera === "extreme-wide" || camera === "wide" || camera === "birds-eye") return "LS";
  if (camera === "close-up") return "CU";
  if (camera === "extreme-close-up") return "ECU";
  if (camera === "insert") return "Insert";
  if (camera === "over-the-shoulder") return "OTS";
  return "MS";
}

function asLineColor(raw: unknown, index = 0): LineColor {
  if (typeof raw === "string" && (LINE_COLORS as readonly string[]).includes(raw)) return raw as LineColor;
  return LINE_COLORS[((index % LINE_COLORS.length) + LINE_COLORS.length) % LINE_COLORS.length] ?? "ink";
}

export function emptyShot(partial: Partial<Shot> & { id: string; number?: number }): Shot {
  const coverageSize = asCoverageSize(partial.coverageSize, partial.camera);
  return {
    title: "",
    action: "",
    dialogue: "",
    camera: "medium",
    movement: "static",
    screenDirection: "static",
    durationSec: 6,
    timeOfDay: "day",
    location: "",
    characters: [],
    lighting: "natural, even",
    notes: "",
    sketch: emptySketch(),
    blocking: emptyBlocking(),
    annotations: [],
    events: [],
    setup: "",
    frameUrl: null,
    frameKind: "storyboard",
    videoUrl: null,
    videoRequestId: null,
    videoStatus: "idle",
    veoPrompt: "",
    runwayPrompt: "",
    imaginePrompt: "",
    rawSource: "",
    sceneId: null,
    elementIds: [],
    ...partial,
    id: partial.id,
    number: partial.number ?? 1,
    coverageSize: asCoverageSize(partial.coverageSize ?? coverageSize, partial.camera),
    lineColor: asLineColor(partial.lineColor, (partial.number ?? 1) - 1),
  };
}

export function isBoardable(kind: ScriptKind): boolean {
  return kind === "action" || kind === "dialogue";
}

export function normalizeShot(raw: Partial<Shot> & { id: string }): Shot {
  const legacyId = (raw as { elementId?: string | null }).elementId;
  const elementIds = raw.elementIds ?? (legacyId ? [legacyId] : []);
  return emptyShot({
    number: raw.number ?? 1,
    ...raw,
    id: raw.id,
    sketch: raw.sketch ?? emptySketch(),
    blocking: raw.blocking?.figures ? { figures: raw.blocking.figures } : emptyBlocking(),
    annotations: raw.annotations ?? [],
    events: Array.isArray(raw.events) ? raw.events : [],
    characters: raw.characters ?? [],
    elementIds,
    sceneId: raw.sceneId ?? null,
    setup: raw.setup ?? "",
    coverageSize: asCoverageSize(raw.coverageSize, raw.camera),
    lineColor: asLineColor(raw.lineColor, (raw.number ?? 1) - 1),
    rawSource: typeof raw.rawSource === "string" ? raw.rawSource : "",
  });
}

export function normalizeProject(raw: Project): Project {
  return {
    ...raw,
    target: (TARGETS as readonly string[]).includes(raw.target) ? raw.target : "imagine",
    world: raw.world ?? emptyWorld(),
    script: Array.isArray(raw.script) ? raw.script : [],
    shots: (raw.shots ?? []).map((s, i) => normalizeShot({ ...s, number: s.number ?? i + 1 })),
    skills: Array.isArray(raw.skills) ? raw.skills.filter((s) => s?.id && s?.body) : [],
    chain: Array.isArray(raw.chain) ? raw.chain.filter((id) => typeof id === "string") : [],
    characters: Array.isArray(raw.characters)
      ? raw.characters
          .filter((c) => c?.name)
          .map((c) => ({
            name: String(c.name).trim(),
            look: String(c.look ?? ""),
            voice: c.voice ? String(c.voice) : undefined,
            start: c.start ? String(c.start) : undefined,
            aliases: Array.isArray(c.aliases)
              ? c.aliases.map(String).map((s) => s.trim()).filter(Boolean)
              : [],
          }))
      : [],
    cutUrl: raw.cutUrl ?? null,
    binder: Array.isArray(raw.binder) ? raw.binder : [],
    breakdown: Array.isArray(raw.breakdown) ? raw.breakdown : [],
    marks: Array.isArray(raw.marks) ? raw.marks.filter((m) => m?.id && m?.tag && m?.elementId) : [],
    floor: normalizeFloor(raw.floor),
    timeline: raw.timeline?.clips ? { ...raw.timeline, clips: raw.timeline.clips } : emptyTimeline(),
  };
}
