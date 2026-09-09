import type { Project } from "./types";
import { emptyWorld, emptyFloor, emptyTimeline } from "./types";

export function createSampleProject(): Project {
  const project = createBlankProject();
  return {
    ...project,
    name: "ReelBinder Sample",
    logline: "A clean workspace ready for a filmmaker's screenplay and production plan.",
  };
}

export const SAMPLE_SLATE = `---
title: Untitled
target: imagine
---

# World

Place:
Lighting:
Laws: Gravity behaves like Earth. Faces and wardrobe stay locked unless a beat names a change.

# Script

## INT. LOCATION - DAY

Write the first action.
`;

export function createBlankProject(): Project {
  const sceneId = `el_${Date.now().toString(36)}`;
  const actionId = `${sceneId}_a`;
  return {
    id: `proj_${Date.now().toString(36)}`,
    name: "Untitled",
    logline: "",
    style: "cinematic anamorphic look, shallow depth of field, filmic color, 35mm, no subtitles",
    target: "imagine",
    world: emptyWorld(),
    characters: [],
    script: [
      { id: sceneId, kind: "scene", text: "INT. LOCATION - DAY" },
      { id: actionId, kind: "action", text: "" },
    ],
    shots: [],
    skills: [],
    chain: [],
    cutUrl: null,
    binder: [],
    breakdown: [],
    marks: [],
    floor: emptyFloor(),
    timeline: emptyTimeline(),
    updatedAt: Date.now(),
  };
}
