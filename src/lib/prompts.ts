import { matchCharacter } from "./cast";
import { checkContinuity } from "./continuity";
import { assembleForTarget, assemblePrompt, assembleStillPrompt, worldLockPreview } from "./prompt-chain";
import { narrativeForShot } from "./script-linkage";
import type { ContinuityIssue, Project, Shot, Target } from "./types";

export function buildVeoPrompt(shot: Shot, project: Project): string {
  return assembleForTarget(shot, project, "veo");
}

export function buildRunwayPrompt(shot: Shot, project: Project): string {
  return assembleForTarget(shot, project, "runway");
}

export function buildImaginePrompt(shot: Shot, project: Project): string {
  return assembleForTarget(shot, { ...project, target: "imagine" }, "imagine");
}

export function buildFramePrompt(shot: Shot, project: Project, kind: "storyboard" | "still"): string {
  const look =
    kind === "storyboard"
      ? "Cinematic storyboard frame, marker and graphite on tan paper, low fidelity, not photorealistic, 16:9 production still, film storyboard aesthetic, muted ink"
      : "Photoreal cinematic still, 16:9 anamorphic, sharp, filmic color, production camera, this is the first frame of a video";
  const visible = new Set(shot.characters.map(name => matchCharacter(project.characters, name)?.name ?? name));
  const scopedWorld = { ...project, characters: project.characters.filter(character => visible.has(character.name)) };
  return [worldLockPreview(scopedWorld), look, assembleStillPrompt(shot, project), "single frame: one frozen instant only. Any action plan describes context; depict only the chosen instant. No montage, no split panels, no time sequence. No speech bubbles, no captions, no watermark, no color bars"]
    .filter(Boolean)
    .join("\n\n");
}

const PROMPT_BUILDERS = {
  veoPrompt: buildVeoPrompt,
  runwayPrompt: buildRunwayPrompt,
  imaginePrompt: buildImaginePrompt,
} as const;

/** Refresh generated values; retain any saved difference from the pre-edit chain. */
export function refreshShotPrompts(shot: Shot, project: Project, previousProject?: Project): Shot {
  const previous = previousProject?.shots.find((item) => item.id === shot.id);
  const next = { ...shot };
  for (const [field, build] of Object.entries(PROMPT_BUILDERS)) {
    const key = field as keyof typeof PROMPT_BUILDERS;
    const baseline = previous ? build(previous, previousProject!) : build(shot, project);
    const hasSavedDifference = previousProject && shot[key] !== baseline && (previous || shot[key] !== "");
    if (!hasSavedDifference) next[key] = build(shot, project);
  }
  return next;
}

export function refreshProjectPrompts(project: Project, previousProject?: Project): Project {
  return {
    ...project,
    shots: project.shots.map((s) => refreshShotPrompts(s, project, previousProject)),
    updatedAt: Date.now(),
  };
}

/** Keep saved narrative differences reviewable without surfacing inactive prompt caches. */
export function preservedFieldIssues(project: Project): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const shot of project.shots) {
    if (!shot.elementIds.some((id) => project.script.some((element) => element.id === id))) continue;
    const linked = narrativeForShot(project.script, shot);
    const fields = (["action", "dialogue"] as const).filter((field) => shot[field] !== linked[field]);
    if (!fields.length) continue;
    let hash = 2166136261;
    for (const char of JSON.stringify(fields.map((field) => [field, shot[field], linked[field]]))) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    issues.push({
      id: `iss_${shot.id}_saved_narrative_${(hash >>> 0).toString(36)}`,
      shotId: shot.id,
      code: "saved-narrative-differs",
      severity: "warn",
      title: `Review saved setup text for ${shot.setup || shot.title}`,
      detail: `Saved setup text (${fields.join(" and ")}) differs from the linked screenplay and was retained. Compare the screenplay in Shot with the saved setup direction in Prompt tuning before generating.`,
    });
  }
  return issues;
}

export function promptForShot(shot: Shot, project: Project, target: Target): string {
  return assembleForTarget(shot, project, target);
}

export function sequencePrompt(project: Project, target: Target): string {
  const issues = checkContinuity(project)
    .filter((i) => i.severity === "error")
    .map((i) => `- ${i.title}: ${i.detail}`)
    .join("\n");
  const body = project.shots
    .map((s, idx) => {
      return `SHOT ${String(idx + 1).padStart(2, "0")} · ${s.durationSec}s · ${s.title}\n${assembleForTarget(s, project, target)}`;
    })
    .join("\n\n");
  return [
    `${project.name.toUpperCase()}`,
    project.logline,
    worldLockPreview(project),
    issues ? `Unresolved continuity:\n${issues}` : "",
    "",
    body,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
