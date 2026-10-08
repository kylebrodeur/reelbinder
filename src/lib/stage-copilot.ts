/**
 * Pure Stage-direction logic shared by the single Production Assistant surface:
 * director continuity checks and the staged-prompt synthesizer for a shot.
 */
import { cameraForShot, figuresForShot } from "./floor.ts";
import { coverageLabel } from "./lining.ts";
import type { FloorPlan, Shot } from "./types.ts";

export interface ContinuityCheck {
  id: string;
  type: "axis_180" | "eyeline" | "coverage" | "ok";
  severity: "warn" | "info" | "pass";
  title: string;
  detail: string;
}

export function checkStageContinuity(
  shot: Shot,
  allShots: Shot[],
  floor: FloorPlan,
): ContinuityCheck[] {
  const checks: ContinuityCheck[] = [];
  const sceneShots = allShots.filter((s) => s.sceneId === shot.sceneId);
  const idx = sceneShots.findIndex((s) => s.id === shot.id);
  const prevShot = idx > 0 ? sceneShots[idx - 1] : null;

  const currentCam = cameraForShot(floor, shot);
  const prevCam = prevShot ? cameraForShot(floor, prevShot) : null;
  const currentFigures = figuresForShot(floor, shot);

  // Check 1: 180-degree line-of-action check
  if (currentCam && prevCam && currentFigures.length >= 2) {
    let f1: { x: number; y: number; name?: string } = currentFigures[0];
    let f2: { x: number; y: number; name?: string } = currentFigures[1];
    let explicitEyeline = false;

    // Look for an explicit eyeline target
    for (const fig of currentFigures) {
      if (fig.targetId) {
        const target = currentFigures.find(f => f.id === fig.targetId) ||
                       floor.items.find(i => i.id === fig.targetId);
        if (target && 'x' in target && 'y' in target) {
          f1 = fig;
          f2 = {
            x: target.x,
            y: target.y,
            name: "name" in target && typeof target.name === "string" ? target.name : "label" in target && typeof target.label === "string" ? target.label : "target",
          };
          explicitEyeline = true;
          break;
        }
      }
    }

    if (f1 && f2) {
      // Line of action vector: f1 -> f2
      const lineX = f2.x - f1.x;
      const lineY = f2.y - f1.y;

      // Cross product for current camera: (cam.x - f1.x) * lineY - (cam.y - f1.y) * lineX
      const crossCurrent = (currentCam.x - f1.x) * lineY - (currentCam.y - f1.y) * lineX;
      const crossPrev = (prevCam.x - f1.x) * lineY - (prevCam.y - f1.y) * lineX;

      // If signs differ, cameras are on opposite sides of the action line
      if (Math.sign(crossCurrent) !== Math.sign(crossPrev) && Math.abs(crossCurrent) > 0.01 && Math.abs(crossPrev) > 0.01) {
        checks.push({
          id: "axis-cross",
          type: "axis_180",
          severity: "warn",
          title: "180° Rule Violation (Action Axis)",
          detail: `Cameras ${prevShot?.setup} and ${shot.setup} sit on opposite sides of the line between ${f1.name} and ${f2.name || 'target'}. ${explicitEyeline ? 'This compares your explicit eyeline axis.' : 'This compares coverage-list neighbors based on arbitrary positioning, not an authored action axis. Set an eyeline target to be sure.'} Review the intended cut.`,
        });
      }
    }
  }

  // Coverage ordering and travel tokens do not establish edit continuity or gaze.
  const master = sceneShots.find((s) => s.coverageRole === "master" && s.id !== shot.id);
  if (master) {
    checks.push({
      id: "master-reference",
      type: "coverage",
      severity: "info",
      title: `Full Coverage reference (${coverageLabel(master)})`,
      detail: `Setup ${master.setup} is available for comparison. Shared range and staging alignment have not been assessed.`,
    });
  }
  checks.push({
    id: "continuity-unassessed",
    type: "ok",
    severity: "info",
    title: "Continuity not assessed",
    detail: "Coverage order and subject travel do not establish edit adjacency, an action axis or gaze. Review the selected takes and intended cut.",
  });

  return checks;
}

export function synthesizeStagePrompt(shot: Shot): string {
  const parts = [
    `${coverageLabel(shot)} framing, ${shot.camera} camera angle`,
    shot.movement && shot.movement !== "static" ? `${shot.movement} camera motion` : null,
    shot.screenDirection && shot.screenDirection !== "static" ? `subject travel: ${shot.screenDirection}` : null,
    shot.title ? `Scene moment: ${shot.title}` : null,
    shot.action ? `Action: ${shot.action}` : null,
    shot.characters?.length ? `Featuring: ${shot.characters.join(", ")}` : null,
    shot.lighting ? `Lighting: ${shot.lighting}` : null,
    shot.location ? `Location: ${shot.location}` : null,
    shot.timeOfDay ? `Time: ${shot.timeOfDay}` : null,
  ].filter(Boolean);
  return parts.join(". ") + ".";
}