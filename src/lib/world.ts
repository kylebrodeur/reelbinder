import { namesOf } from "./cast";
import { DIRECTION_META, MOVEMENT_META } from "./filmmaking";
import type {
  Annotation,
  CharacterBible,
  EventKind,
  Project,
  Shot,
  WorldEvent,
  WorldLock,
} from "./types";
import { CAMERA_TARGET, emptyWorld, SCENE_TARGET } from "./types";
import { uid } from "./utils";

export const EV_CAM = "ev_cam";
export const EV_ACT = "ev_act";
export const EV_DLG = "ev_dlg";

const CORE_IDS = new Set([EV_CAM, EV_ACT, EV_DLG]);

export function eventTone(target: string): "steel" | "warn" | "ok" | "muted" {
  const t = target.trim().toUpperCase();
  if (t === CAMERA_TARGET) return "steel";
  if (t === SCENE_TARGET) return "warn";
  if (!t) return "muted";
  return "ok";
}

export function subjectNames(project: Project): string[] {
  const names = new Set<string>();
  for (const c of project.characters) {
    for (const n of namesOf(c)) names.add(n);
  }
  for (const shot of project.shots) {
    for (const n of shot.characters) {
      if (n.trim()) names.add(n.trim());
    }
  }
  return [...names];
}

export function eventTargets(project: Project): string[] {
  return [CAMERA_TARGET, SCENE_TARGET, ...subjectNames(project)];
}

export function formatEventClock(sec: number): string {
  return sec.toFixed(1).replace(/\.0$/, ".0");
}

export function formatEventRange(ev: WorldEvent): string {
  return `${formatEventClock(ev.startSec)}–${formatEventClock(ev.endSec)}`;
}

export function syncCoreEvents(shot: Shot): WorldEvent[] {
  const d = Math.max(3, shot.durationSec);
  const extras = (shot.events ?? []).filter((e) => !CORE_IDS.has(e.id));
  const core: WorldEvent[] = [
    {
      id: EV_CAM,
      target: CAMERA_TARGET,
      kind: "move",
      text: cameraEventText(shot),
      startSec: 0,
      endSec: d,
    },
  ];
  if (shot.action.trim()) {
    core.push({
      id: EV_ACT,
      target: SCENE_TARGET,
      kind: "move",
      text: shot.action.trim(),
      startSec: 0,
      endSec: d,
    });
  }
  if (shot.dialogue.trim()) {
    core.push({
      id: EV_DLG,
      // A cast list is framing, not speaker attribution. Prompt assembly resolves
      // this automatic event against the selected screenplay dialogue.
      target: SCENE_TARGET,
      kind: "speech",
      text: shot.dialogue.trim(),
      startSec: Math.min(Math.max(0, d - 2.4), d * 0.4),
      endSec: d,
    });
  }
  return [
    ...core,
    ...extras.map((e) => ({
      ...e,
      startSec: clampTime(e.startSec, d),
      endSec: Math.max(clampTime(e.startSec, d) + 0.4, clampTime(e.endSec, d)),
    })),
  ];
}

function cameraEventText(shot: Shot): string {
  const move = MOVEMENT_META[shot.movement]?.prompt ?? "locked-off camera";
  const dir =
    shot.screenDirection !== "static" ? DIRECTION_META[shot.screenDirection]?.prompt : "";
  return [move, dir].filter(Boolean).join(". ");
}

function clampTime(n: number, d: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(d, Math.max(0, n));
}

export function eventsFromAnnotations(shot: Shot, annotations: Annotation[]): WorldEvent[] {
  const d = Math.max(3, shot.durationSec);
  const existing = new Set((shot.events ?? []).map((e) => e.text.trim().toLowerCase()));
  const out: WorldEvent[] = [];
  for (const a of annotations) {
    const label = a.label?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    const kind: EventKind =
      a.kind === "note" || /light|weather|wardrobe|enter|exit|time/i.test(label)
        ? "change"
        : a.kind === "box"
          ? "gesture"
          : "move";
    const target =
      kind === "change" ? SCENE_TARGET : a.kind === "arrow" ? shot.characters[0] || CAMERA_TARGET : SCENE_TARGET;
    out.push({
      id: uid("ev"),
      target,
      kind,
      text: label,
      startSec: 0,
      endSec: d,
    });
  }
  return out;
}

export function sortEvents(events: WorldEvent[]): WorldEvent[] {
  return [...events].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

export function describeEvents(events: WorldEvent[]): string {
  if (!events.length) return "";
  return sortEvents(events)
    .map((e) => {
      const kind = e.kind === "speech" ? "speech" : e.kind === "sound" ? "sound" : "action";
      const line = e.kind === "speech" ? `"${e.text.replace(/^["']|["']$/g, "")}"` : e.text;
      return `[${formatEventRange(e)} ${e.target} ${kind}] ${line}`;
    })
    .join("\n");
}

export function worldLockBlock(project: Project): string {
  const world = project.world ?? emptyWorld();
  const subjects = project.characters
    .filter((c) => c.name.trim())
    .map(subjectLine)
    .join("\n");
  const lines = [
    "WORLD LOCK (persists for the whole film — do not change unless an event names it)",
    world.place ? `Place: ${world.place}` : "",
    world.lighting ? `Lighting: ${world.lighting}` : "",
    world.ambience ? `Ambience: ${world.ambience}` : "",
    world.laws ? `Laws: ${world.laws}` : "",
    project.style ? `Style: ${project.style}` : "",
    subjects ? `Subjects:\n${subjects}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function subjectLine(c: CharacterBible): string {
  return [
    `- ${c.name}: ${c.look}`.trim(),
    c.voice ? `Voice: ${c.voice}` : "",
    c.start ? `Starts: ${c.start}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

export function beatEventBlock(shot: Shot, suppliedEvents?: WorldEvent[]): string {
  const events = sortEvents(suppliedEvents ?? (shot.events?.length ? shot.events : syncCoreEvents(shot)));
  const body = describeEvents(events);
  return [
    `THIS BEAT — ${shot.durationSec}s — only these events may change the world`,
    body || shot.action,
  ].join("\n");
}

export function buildGenesisPrompt(project: Project): string {
  const world = project.world ?? emptyWorld();
  const starts = project.characters
    .filter((c) => c.name.trim())
    .map((c) => `${c.name} (${c.look}${c.start ? `; ${c.start}` : ""})`)
    .join("; ");
  return [
    "Photoreal cinematic still, 16:9 anamorphic, first frame of this world before action begins.",
    world.place,
    world.lighting,
    starts ? `Subjects in starting positions: ${starts}.` : "",
    project.style,
    "No motion implied beyond a held pose, no captions, no watermark, no logos.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function hydrateWorld(project: Project): Project {
  const world = fillWorldFromShots(project);
  const shots = project.shots.map((shot) => {
    if (shot.events?.length) return shot;
    return { ...shot, events: syncCoreEvents(shot) };
  });
  return { ...project, world, shots };
}

export function fillWorldFromShots(project: Project): WorldLock {
  const world = project.world ?? emptyWorld();
  if (world.place.trim() && world.lighting.trim()) return world;
  const first = project.shots[0];
  return {
    ...emptyWorld(),
    ...world,
    place: world.place.trim() || first?.location || world.place,
    lighting: world.lighting.trim() || first?.lighting || world.lighting,
    laws: world.laws.trim() || emptyWorld().laws,
  };
}

export function worldFromLogline(input: {
  place?: string;
  lighting?: string;
  ambience?: string;
  laws?: string;
}): WorldLock {
  return {
    ...emptyWorld(),
    place: input.place ?? "",
    lighting: input.lighting ?? "",
    ambience: input.ambience ?? "",
    laws: input.laws?.trim() || emptyWorld().laws,
    genesisUrl: null,
  };
}

export function steerChips(): { label: string; target: string; kind: EventKind; text: string }[] {
  return [
    { label: "Track L–R", target: CAMERA_TARGET, kind: "move", text: "Camera tracks left to right with the subject." },
    { label: "Dolly in", target: CAMERA_TARGET, kind: "move", text: "Smooth dolly in toward the subject." },
    { label: "Hold", target: SCENE_TARGET, kind: "gesture", text: "Hold the current framing. Nothing leaves frame." },
    { label: "Rain", target: SCENE_TARGET, kind: "change", text: "Rain thickens. Wet ground stays reflective." },
    { label: "Light shift", target: SCENE_TARGET, kind: "change", text: "Practical lights shift warmer. Time of day does not jump." },
    { label: "Look back", target: SCENE_TARGET, kind: "gesture", text: "The subject glances back toward camera, then continues." },
  ];
}

/** Legacy first-cast core labels are ambiguous, not proof of authored action attribution. */
export function promptActionEvents(shot: Shot, events: WorldEvent[]): { events: WorldEvent[]; warning: string } {
  const core = events.find(event => event.id === EV_ACT);
  const automaticShape = core && core.target === shot.characters[0] &&
    core.kind === "move" && core.text === shot.action.trim() &&
    core.startSec === 0 && core.endSec === Math.max(3, shot.durationSec);
  if (!automaticShape) return { events, warning: "" };
  return {
    events: events.map(event => event === core ? { ...event, target: SCENE_TARGET } : event),
    warning: "Action attribution check: the saved core label matches the first visible character, which does not establish who performs each action. The complete action is presented at scene scope for review; saved events and authored text are unchanged.",
  };
}
