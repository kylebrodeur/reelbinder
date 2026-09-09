import { matchCharacter } from "./cast";
import { CAMERA_META, DIRECTION_META, MOVEMENT_META, TIME_META, cameraPrompt } from "./filmmaking";
import { describeAnnotations } from "./continuity";
import { formatMarksBlock, marksOnShot } from "./marks";
import { promptDialogue } from "./prompt-dialogue";
import type { Project, PromptLayer, PromptSkill, Shot, Target } from "./types";
import { emptyWorld } from "./types";
import { beatEventBlock, describeEvents, subjectLine, worldLockBlock, promptActionEvents } from "./world";

export const DEFAULT_CHAIN = ["world", "cast", "coverage", "beat", "steer", "continuity", "target"] as const;

export const DEFAULT_SKILLS: PromptSkill[] = [
  {
    id: "world",
    title: "World lock",
    body: `WORLD LOCK (persists for the whole film — do not change unless an event names it)
Place: {{world.place}}
Lighting: {{world.lighting}}
Ambience: {{world.ambience}}
Laws: {{world.laws}}
Style: {{style}}`,
  },
  {
    id: "cast",
    title: "Cast in frame",
    body: `{{cast}}`,
  },
  {
    id: "coverage",
    title: "Coverage",
    body: `Setup {{shot.setup}} [{{shot.coverageSize}}] · {{shot.durationSec}}s
Camera: {{camera}}
Move: {{movement}}
Screen direction: {{direction}}
Time: {{time}}
Location: {{shot.location}}
Lighting stays: {{shot.lighting}}`,
  },
  {
    id: "beat",
    title: "This beat",
    body: `THIS BEAT — only these events may change the world
{{events}}
Action: {{shot.action}}
{{dialogue}}
{{notes}}
{{annot}}`,
  },
  {
    id: "steer",
    title: "Direction",
    body: `{{marks}}`,
  },
  {
    id: "continuity",
    title: "Continuity",
    body: `Continuous physical motion. Same wardrobe, faces, weather, and color grade the whole clip. No jump cuts, no morphing, no extra people, no on-screen text, no subtitles, no watermark, no captions.`,
  },
  {
    id: "imagine",
    title: "Imagine",
    body: `Animate this shot for {{shot.durationSec}} seconds as a photoreal cinematic clip. Honor the world lock. If this continues from a still, the first frame is that still.`,
  },
  {
    id: "veo",
    title: "Veo 3",
    body: `{{shot.durationSec}}-second shot. Photoreal, continuous motion, no morphing faces. Spoken dialogue only if named. No subtitles.`,
  },
  {
    id: "runway",
    title: "Runway",
    body: `cinematic, sharp, consistent character, no text on screen, no subtitles`,
  },
];

export function skillsFor(project: Project): PromptSkill[] {
  const extra = project.skills ?? [];
  const byId = new Map<string, PromptSkill>();
  for (const skill of DEFAULT_SKILLS) byId.set(skill.id, skill);
  for (const skill of extra) {
    if (skill?.id) byId.set(skill.id, skill);
  }
  return [...byId.values()];
}

export function chainFor(project: Project): string[] {
  const chain = project.chain?.length ? project.chain : [...DEFAULT_CHAIN];
  return chain.map((id) => (id === "target" ? targetSkillId(project.target) : id));
}

function targetSkillId(target: Target): string {
  if (target === "runway") return "runway";
  if (target === "veo") return "veo";
  return "imagine";
}

export function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{([a-z.]+)\}\}/gi, (_, key: string) => ctx[key] ?? "");
}

export function shotContext(shot: Shot, project: Project): Record<string, string> {
  const world = project.world ?? emptyWorld();
  const cast = project.characters
    .filter((c) => shot.characters.some((n) => matchCharacter(project.characters, n)?.name === c.name))
    .map(subjectLine);
  const castLine =
    cast.length > 0
      ? `Subjects in frame:\n${cast.join("\n")}`
      : shot.characters.length
        ? `Characters: ${shot.characters.join(", ")}.`
        : "";
  const annot = describeAnnotations(shot);
  const speech = promptDialogue(shot, project);
  const action = promptActionEvents(shot, speech.events);
  return {
    "world.place": world.place,
    "world.lighting": world.lighting,
    "world.ambience": world.ambience,
    "world.laws": world.laws,
    style: project.style,
    cast: castLine,
    "shot.setup": shot.setup || String(shot.number),
    "shot.coverageSize": shot.coverageSize,
    "shot.durationSec": String(shot.durationSec),
    "shot.title": shot.title,
    "shot.action": shot.action,
    "shot.location": shot.location,
    "shot.lighting": shot.lighting,
    "shot.dialogue": shot.dialogue,
    // The standalone token must include spoken words for existing custom skills.
    dialogue: [describeEvents(speech.events.filter((event) => event.kind === "speech")), speech.direction]
      .filter(Boolean).join("\n"),
    "dialogue.direction": speech.direction,
    notes: [shot.notes.trim() ? `Coverage note: ${shot.notes.trim()}` : "", action.warning].filter(Boolean).join("\n"),
    annot: annot ? `Start-frame: ${annot}` : "",
    events: beatEventBlock(shot, action.events),
    marks: formatMarksBlock(marksOnShot(project, shot.id)),
    camera: cameraPrompt(shot.camera, shot.movement),
    movement: MOVEMENT_META[shot.movement]?.prompt ?? shot.movement,
    direction: DIRECTION_META[shot.screenDirection]?.prompt ?? shot.screenDirection,
    time: TIME_META[shot.timeOfDay]?.prompt ?? shot.timeOfDay,
    "camera.rule": CAMERA_META[shot.camera]?.rule ?? "",
  };
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function buildLayers(shot: Shot, project: Project, forStill = false): PromptLayer[] {
  const skills = skillsFor(project);
  const ctx = shotContext(shot, project);
  const layers: PromptLayer[] = [];
  for (const id of chainFor(project)) {
    const skill = skills.find((s) => s.id === id);
    if (!skill) continue;
    // Only default temporal target instructions are omitted; custom skills keep their text.
    if (forStill && ["imagine", "veo", "runway"].includes(id) &&
      skill.body === DEFAULT_SKILLS.find(candidate => candidate.id === id)?.body) continue;
    // A template that renders events already contains their speech. Keep the
    // dialogue token's checks and off-screen direction without repeating words.
    const layerContext = /\{\{events\}\}/i.test(skill.body)
      ? { ...ctx, dialogue: ctx["dialogue.direction"] }
      : ctx;
    const text = tidy(interpolate(skill.body, layerContext));
    if (!text) continue;
    layers.push({ id: skill.id, title: skill.title, text });
  }
  return layers;
}

export function assemblePrompt(shot: Shot, project: Project): string {
  if (shot.rawSource?.trim()) return shot.rawSource.trim();
  return buildLayers(shot, project)
    .map((l) => l.text)
    .join("\n\n");
}

export function assembleForTarget(shot: Shot, project: Project, target: Target): string {
  if (shot.rawSource?.trim() && (target === project.target || target === "imagine")) {
    return shot.rawSource.trim();
  }
  return buildLayers(shot, { ...project, target })
    .map((l) => l.text)
    .join("\n\n");
}

export function worldLockPreview(project: Project): string {
  return worldLockBlock(project);
}

export function assembleStillPrompt(shot: Shot, project: Project): string {
  if (shot.rawSource?.trim()) return shot.rawSource.trim();
  return buildLayers(shot, project, true).map(layer => layer.text).join("\n\n");
}
