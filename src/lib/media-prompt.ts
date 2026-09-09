import { buildVeoPrompt } from "./prompts";
import type { CinemaMediaKind } from "./cinema-media";
import type { Project, Shot } from "./types";

/** Initial editable draft only. Recovery and filmmaker edits retain their own authority. */
export function initialMediaPrompt(project: Project, shot: Shot | null, kind: CinemaMediaKind): string {
  if (kind === "video" && shot) return buildVeoPrompt(shot, project);
  return `Instrumental cue for ${project.name}. ${project.logline} ${project.style}`.trim();
}
