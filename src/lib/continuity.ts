import { CAMERA_META } from "./filmmaking";
import type { ContinuityIssue, Project, Shot } from "./types";

function issue(
  shotId: string,
  code: string,
  severity: ContinuityIssue["severity"],
  title: string,
  detail: string,
): ContinuityIssue {
  // Stable content identity lets the Assistant retain triage until a finding changes.
  const content = JSON.stringify([shotId, code, severity, title, detail]);
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return {
    id: `iss_${shotId}_${code}_${(hash >>> 0).toString(36)}`,
    shotId,
    code,
    severity,
    title,
    detail,
  };
}

function lightingPeriod(lighting: string): "day" | "night" | null {
  const text = lighting.toLowerCase();
  const night = /\b(night|nighttime|moonlight|moonlit|after dark)\b/.test(text);
  const day = /\b(daylight|sunlight|sunlit|midday|noon|noonday)\b/.test(
    text.replace(/\b(no|without)\s+(daylight|sunlight)\b/g, ""),
  );
  return day === night ? null : day ? "day" : "night";
}

export function checkContinuity(project: Project): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const shots = project.shots;
  const seenChars = new Set<string>();

  if (shots.length === 0) {
    issues.push(
      issue(
        "",
        "empty",
        "info",
        "No shots yet",
        "Write or import a script, then board the beats you want to shoot.",
      ),
    );
    return issues;
  }

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const prev = i > 0 ? shots[i - 1] : null;
    const words = shot.action.trim().split(/\s+/).filter(Boolean);

    if (words.length < 8) {
      issues.push(
        issue(
          shot.id,
          "vague",
          "warn",
          `Shot ${shot.number} is underwritten`,
          "Describe the subject and action, then add the camera and lighting direction needed for this setup.",
        ),
      );
    }

    if (shot.characters.length > 3) {
      issues.push(
        issue(
          shot.id,
          "crowd",
          "error",
          `Shot ${shot.number} has ${shot.characters.length} named people`,
          "Current video models drop identity past two or three faces. Split coverage.",
        ),
      );
    }

    for (const name of shot.characters) {
      seenChars.add(name);
    }

    if (prev) {
      const samePlace =
        normalize(shot.location) === normalize(prev.location) && shot.location.trim() !== "";
      const sameScene =
        samePlace && (!shot.sceneId || !prev.sceneId || shot.sceneId === prev.sceneId);
      if (sameScene && shot.timeOfDay !== prev.timeOfDay) {
        issues.push(
          issue(
            shot.id,
            "time-jump",
            "error",
            `Time of day jumps at shot ${shot.number}`,
            `${labelTime(prev)} → ${labelTime(shot)} in the same location. Insert a transition or keep the clock still.`,
          ),
        );
      }

      if (
        normalize(shot.location) &&
        normalize(prev.location) &&
        normalize(shot.location) !== normalize(prev.location)
      ) {
        const isWide =
          shot.camera === "wide" || shot.camera === "extreme-wide" || shot.camera === "birds-eye";
        if (!isWide) {
          issues.push(
            issue(
              shot.id,
              "teleport",
              "warn",
              `New location without an establishing shot`,
              `Cut from ${prev.location} to ${shot.location} on a ${CAMERA_META[shot.camera].label.toLowerCase()}. Open the new space on a wide.`,
            ),
          );
        }
      }

      const reversed =
        (prev.screenDirection === "L-R" && shot.screenDirection === "R-L") ||
        (prev.screenDirection === "R-L" && shot.screenDirection === "L-R");
      const isCutaway =
        shot.camera === "insert" || shot.camera === "extreme-close-up" || shot.camera === "pov";
      if (reversed && !isCutaway) {
        issues.push(
          issue(
            shot.id,
            "axis",
            "error",
            `180° line jump into shot ${shot.number}`,
            `Screen direction flips ${prev.screenDirection} → ${shot.screenDirection}. Hold the line, or cut away to an insert first.`,
          ),
        );
      }

      if (prev.lighting.trim() && shot.lighting.trim()) {
        const previousPeriod = lightingPeriod(prev.lighting);
        const currentPeriod = lightingPeriod(shot.lighting);
        if (previousPeriod && currentPeriod && previousPeriod !== currentPeriod && sameScene) {
          issues.push(
            issue(
              shot.id,
              "grade",
              "warn",
              "Review the lighting change",
              `Lighting changes from ${previousPeriod} to ${currentPeriod} within this scene. Match the light direction or add an intentional transition.`,
            ),
          );
        }
      }

      if (
        (prev.camera === "close-up" || prev.camera === "extreme-close-up") &&
        (shot.camera === "close-up" || shot.camera === "extreme-close-up") &&
        prev.characters.join() === shot.characters.join() &&
        prev.characters.length > 0
      ) {
        issues.push(
          issue(
            shot.id,
            "punch-in",
            "info",
            `Back-to-back close-ups of the same person`,
            "AI will likely morph the face. Cut to a medium or an insert between them.",
          ),
        );
      }
    }

    if (shot.annotations.length > 0 && !shot.frameUrl) {
      issues.push(
        issue(
          shot.id,
          "annot-no-frame",
          "info",
          `Shot ${shot.number} has screen direction but no start frame`,
          "Generate a lo-fi frame, then keep the arrows. Veo reads annotations on the start image.",
        ),
      );
    }
  }

  const bookNames = project.characters.filter((c) => c.name.trim());
  if (bookNames.length === 0 && seenChars.size > 0) {
    issues.push(
      issue(
        shots[0]?.id ?? "",
        "cast",
        "info",
        "No character looks locked",
        "Add a one-line look for each person in the production book (wardrobe, hair, age).",
      ),
    );
  }

  return issues;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function labelTime(shot: Shot): string {
  return shot.timeOfDay.replace("-", " ");
}

export function describeAnnotations(shot: Shot): string {
  if (shot.annotations.length === 0) return "";
  return shot.annotations
    .map((a) => {
      if (a.kind === "arrow" && a.points.length >= 2) {
        const a0 = a.points[0];
        const a1 = a.points[a.points.length - 1];
        const dx = a1.x - a0.x;
        const dy = a1.y - a0.y;
        const dir =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "left to right"
              : "right to left"
            : dy > 0
              ? "top to bottom"
              : "bottom to top";
        return `Follow the ${a.color} arrow ${dir}${a.label ? ` (${a.label})` : ""}. Camera and subject move along that vector. Changes happen instantly.`;
      }
      if (a.kind === "box") {
        return `Hold the boxed region${a.label ? ` (${a.label})` : ""} as the focus of the shot.`;
      }
      return a.label;
    })
    .join(" ");
}
