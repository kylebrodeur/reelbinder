import type {
  CameraAngle,
  Project,
  ScriptElement,
  ScriptKind,
  Shot,
  TimeOfDay,
} from "./types";
import { emptyShot, isBoardable, normalizeProject } from "./types";
import { ensureMarks } from "./marks";
import { uid } from "./utils";
import { hydrateWorld } from "./world";

export const MOVE_LABELS = [
  "Track L-R",
  "Track R-L",
  "Dolly in",
  "Dolly out",
  "Pan left",
  "Pan right",
  "Toward camera",
  "Away",
  "Exit frame",
  "Enter frame",
] as const;

export const CHANGE_LABELS = [
  "Light shift",
  "Weather",
  "Wardrobe",
  "Enter",
  "Exit",
  "Time cut",
] as const;

export function looksLikeScene(line: string): boolean {
  const s = line.replace(/^\./, "").trim();
  return /^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.|EST\.)/i.test(s) ||
    /^(CLOSE ON|ANGLE ON|INSERT|POV|WIDE ON|TRACKING|FAVORING)\b/i.test(s);
}

export function looksLikeTransition(line: string): boolean {
  const s = line.replace(/^>/, "").trim();
  return /^(FADE (IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|TIME CUT)/i.test(s) ||
    /TO:$/.test(s);
}

export function looksLikeCharacter(line: string): boolean {
  const s = line.replace(/^@/, "").trim();
  if (s.length < 2 || s.length > 42) return false;
  if (looksLikeScene(s) || looksLikeTransition(s)) return false;
  return /^[A-Z][A-Z0-9 .'-]+(\s*\((O\.S\.|V\.O\.|CONT'D|CONT\.|PRE-LAP)\))?$/.test(s);
}

export function parseSlugline(text: string): {
  location: string;
  timeOfDay: TimeOfDay;
  interior: boolean;
} {
  const raw = text.replace(/^\./, "").trim();
  const interior = /^(INT\.|INT |INT\/)/i.test(raw);
  const rest = raw
    .replace(/^(INT\.\/EXT\.|INT\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)\s*/i, "")
    .replace(/^(CLOSE ON|ANGLE ON|INSERT|POV|WIDE ON)\s*-?\s*/i, "");
  const parts = rest.split(/\s+[-–—]\s+/);
  const location = (parts[0] || rest || "unspecified").trim();
  const timeBit = (parts[1] || parts[0] || "").toUpperCase();
  let timeOfDay: TimeOfDay = interior ? "interior-day" : "day";
  if (/NIGHT/.test(timeBit)) timeOfDay = interior ? "interior-night" : "night";
  else if (/DAWN|MORNING/.test(timeBit)) timeOfDay = "dawn";
  else if (/DUSK|EVENING|SUNSET/.test(timeBit)) timeOfDay = "dusk";
  else if (/GOLDEN/.test(timeBit)) timeOfDay = "golden-hour";
  else if (/DAY/.test(timeBit)) timeOfDay = interior ? "interior-day" : "day";
  return { location, timeOfDay, interior };
}

export function parseFountain(raw: string): { title: string; author: string; elements: ScriptElement[] } {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ");
  const lines = text.split("\n");
  let title = "";
  let author = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      if (title && looksLikeScene(lines[i]?.trim() ?? "")) break;
      continue;
    }
    const tm = line.match(/^title:\s*(.+)$/i);
    if (tm) {
      title = tm[1].trim();
      i += 1;
      continue;
    }
    const am = line.match(/^(author|credit|written by):\s*(.+)$/i);
    if (am) {
      author = am[2].trim();
      i += 1;
      continue;
    }
    if (
      !title &&
      line === line.toUpperCase() &&
      line.length < 60 &&
      !looksLikeScene(line) &&
      !looksLikeTransition(line)
    ) {
      title = line;
      i += 1;
      continue;
    }
    break;
  }

  const elements: ScriptElement[] = [];
  let pendingCharacter: string | null = null;
  let actionBuf: string[] = [];

  const push = (kind: ScriptKind, value: string, character?: string) => {
    const t = value.replace(/\s+/g, " ").trim();
    if (!t) return;
    elements.push({
      id: uid("el"),
      kind,
      text: t,
      ...(character ? { character } : {}),
    });
  };

  const flushAction = () => {
    const t = actionBuf.join(" ").trim();
    actionBuf = [];
    if (t) push("action", t);
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (!line) {
      flushAction();
      pendingCharacter = null;
      continue;
    }
    if (line.startsWith("==") || line.startsWith("[[")) continue;

    if (looksLikeScene(line)) {
      flushAction();
      pendingCharacter = null;
      push("scene", line.replace(/^\./, "").toUpperCase());
      continue;
    }
    if (looksLikeTransition(line)) {
      flushAction();
      pendingCharacter = null;
      push("transition", line.replace(/^>/, "").trim().toUpperCase());
      continue;
    }
    if (looksLikeCharacter(line) && !pendingCharacter) {
      flushAction();
      pendingCharacter = line.replace(/^@/, "").toUpperCase();
      push("character", pendingCharacter);
      continue;
    }
    if (pendingCharacter && /^\(.*\)$/.test(line)) {
      push("parenthetical", line, pendingCharacter);
      continue;
    }
    if (pendingCharacter) {
      let dlg = [line];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !looksLikeScene(lines[i].trim()) &&
        !looksLikeCharacter(lines[i].trim())
      ) {
        const n = lines[i].trim();
        i += 1;
        if (/^\(.*\)$/.test(n)) {
          push("dialogue", dlg.join(" "), pendingCharacter);
          dlg = [];
          push("parenthetical", n, pendingCharacter);
        } else dlg.push(n);
      }
      push("dialogue", dlg.join(" "), pendingCharacter);
      continue;
    }
    actionBuf.push(line);
  }
  flushAction();
  return { title, author, elements };
}

export function toFountain(title: string, elements: ScriptElement[]): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`Title: ${title}`, "");
  }
  for (const [index, el] of elements.entries()) {
    if (el.kind === "scene") {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(el.text.toUpperCase(), "");
    } else if (el.kind === "action") {
      lines.push(wrapFountain(el.text, 60), "");
    } else if (el.kind === "character") {
      lines.push(el.text.toUpperCase());
    } else if (el.kind === "parenthetical") {
      const t = el.text.startsWith("(") ? el.text : `(${el.text})`;
      lines.push(`\t${t}`);
    } else if (el.kind === "dialogue") {
      lines.push(wrapFountain(el.text, 35, "\t"));
      const next = elements[index + 1];
      if (next?.kind !== "parenthetical") lines.push("");
    } else if (el.kind === "transition") {
      lines.push(el.text.toUpperCase(), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function wrapFountain(text: string, width: number, prefix = ""): string {
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let row = "";
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (next.length > width && row) {
      rows.push(prefix + row);
      row = w;
    } else row = next;
  }
  if (row) rows.push(prefix + row);
  return rows.join("\n");
}

export function sceneIdAt(elements: ScriptElement[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    if (elements[i].kind === "scene") return elements[i].id;
  }
  return null;
}

export function sceneIdForElement(elements: ScriptElement[], elementId: string): string | null {
  const idx = elements.findIndex((e) => e.id === elementId);
  if (idx < 0) return null;
  return sceneIdAt(elements, idx);
}

export function slugForScene(elements: ScriptElement[], sceneId: string | null): string {
  if (!sceneId) return "";
  return elements.find((e) => e.id === sceneId)?.text ?? "";
}

export function shotsForElement(shots: Shot[], elementId: string): Shot[] {
  return shots.filter(
    (s) => s.elementIds.includes(elementId) || s.sceneId === elementId,
  );
}

function inferCamera(text: string, isFirstInScene: boolean): CameraAngle {
  const t = text.toLowerCase();
  if (/\binsert\b/.test(t)) return "insert";
  if (/\bextreme close|ecu\b/.test(t)) return "extreme-close-up";
  if (/\bclose[- ]on\b|\bclose-up\b|\bcloseup\b/.test(t)) return "close-up";
  if (/\bover[- ]the[- ]shoulder\b|\bots\b/.test(t)) return "over-the-shoulder";
  if (/\blow[- ]angle\b/.test(t)) return "low-angle";
  if (/\bhigh[- ]angle\b/.test(t)) return "high-angle";
  if (/\bbird'?s[- ]eye|overhead|from above\b/.test(t)) return "birds-eye";
  if (/\bpov\b|point of view/.test(t)) return "pov";
  if (/\bextreme wide|establishing\b/.test(t) || isFirstInScene) return isFirstInScene ? "extreme-wide" : "wide";
  if (/\bwide\b/.test(t)) return "wide";
  return isFirstInScene ? "wide" : "medium";
}

export function draftsFromScript(elements: ScriptElement[], max = 12): Shot[] {
  const shots: Shot[] = [];
  let sceneId: string | null = null;
  let location = "";
  let timeOfDay: TimeOfDay = "day";
  let firstInScene = true;
  let n = 1;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.kind === "scene") {
      sceneId = el.id;
      const slug = parseSlugline(el.text);
      location = slug.location;
      timeOfDay = slug.timeOfDay;
      firstInScene = true;
      continue;
    }
    if (!isBoardable(el.kind)) continue;
    if (shots.length >= max) break;

    const character = el.kind === "dialogue" ? el.character : undefined;
    const action =
      el.kind === "dialogue"
        ? `${character || "Someone"} speaks.`
        : el.text;
    const title =
      el.kind === "dialogue"
        ? (character || "Dialogue")
        : el.text.split(/[.!?]/)[0]?.slice(0, 42) || `Shot ${n}`;

    shots.push(
      emptyShot({
        id: uid("shot"),
        number: n,
        title,
        action,
        dialogue: el.kind === "dialogue" ? el.text : "",
        camera: inferCamera(el.text, firstInScene),
        movement: firstInScene ? "static" : "static",
        screenDirection: "static",
        durationSec: 6,
        timeOfDay,
        location,
        characters: character ? [character] : [],
        lighting: timeOfDay.includes("night") ? "practicals, motivated" : "natural, even",
        sceneId,
        elementIds: [el.id],
      }),
    );
    firstInScene = false;
    n += 1;
  }
  return shots;
}

export function scriptFromShots(name: string, shots: Shot[]): { script: ScriptElement[]; shots: Shot[] } {
  const elements: ScriptElement[] = [];
  let lastSlug = "";
  const nextShots: Shot[] = [];
  void name;

  for (const shot of shots) {
    let sceneId = shot.sceneId;
    const slug = shot.location ? formatSlug(shot.location, shot.timeOfDay) : "";
    if (slug && slug !== lastSlug) {
      const scene: ScriptElement = { id: uid("el"), kind: "scene", text: slug };
      elements.push(scene);
      lastSlug = slug;
      sceneId = scene.id;
    } else if (!sceneId) {
      const lastScene = [...elements].reverse().find((e) => e.kind === "scene");
      sceneId = lastScene?.id ?? null;
    }
    const action: ScriptElement = {
      id: uid("el"),
      kind: "action",
      text: shot.action || shot.title,
    };
    elements.push(action);
    const elementIds = [action.id];
    if (shot.dialogue.trim()) {
      const who = shot.characters[0] || "VOICE";
      elements.push({ id: uid("el"), kind: "character", text: who.toUpperCase() });
      const dlg: ScriptElement = {
        id: uid("el"),
        kind: "dialogue",
        text: shot.dialogue,
        character: who.toUpperCase(),
      };
      elements.push(dlg);
      elementIds.push(dlg.id);
    }
    nextShots.push({
      ...shot,
      sceneId,
      elementIds: shot.elementIds.length ? shot.elementIds : elementIds,
    });
  }

  if (elements.length === 0) {
    elements.push(
      { id: uid("el"), kind: "scene", text: "INT. LOCATION - DAY" },
      { id: uid("el"), kind: "action", text: "" },
    );
  }
  return { script: elements, shots: nextShots };
}

function formatSlug(location: string, time: TimeOfDay): string {
  const interior = time.startsWith("interior");
  const clock =
    time === "night" || time === "interior-night"
      ? "NIGHT"
      : time === "dawn"
        ? "DAWN"
        : time === "dusk"
          ? "DUSK"
          : time === "golden-hour"
            ? "GOLDEN HOUR"
            : "DAY";
  return `${interior ? "INT." : "EXT."} ${location.toUpperCase()} - ${clock}`;
}

export function linkShotsInOrder(shots: Shot[], elements: ScriptElement[]): Shot[] {
  const boardable = elements.filter((e) => isBoardable(e.kind));
  return shots.map((shot, i) => {
    const el = boardable[i];
    if (!el) return { ...shot, sceneId: shot.sceneId, elementIds: shot.elementIds };
    return {
      ...shot,
      elementIds: shot.elementIds.length ? shot.elementIds : [el.id],
      sceneId: shot.sceneId ?? sceneIdForElement(elements, el.id),
    };
  });
}

export function relinkSceneIds(script: ScriptElement[], shots: Shot[]): Shot[] {
  return shots.map((shot) => {
    const primary = shot.elementIds[0];
    if (!primary) return shot;
    return { ...shot, sceneId: sceneIdForElement(script, primary) ?? shot.sceneId };
  });
}

export function groupShotsByScene(
  project: Project,
): { scene: ScriptElement | null; shots: Shot[] }[] {
  const groups: { scene: ScriptElement | null; shots: Shot[] }[] = [];
  const used = new Set<string>();
  for (const el of project.script) {
    if (el.kind !== "scene") continue;
    const shots = project.shots.filter((s) => s.sceneId === el.id);
    shots.forEach((s) => used.add(s.id));
    groups.push({ scene: el, shots });
  }
  const loose = project.shots.filter((s) => !used.has(s.id));
  if (loose.length) groups.push({ scene: null, shots: loose });
  if (groups.length === 0) groups.push({ scene: null, shots: project.shots });
  return groups;
}

export function isFountainText(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("{")) return false;
  return /^(INT\.|EXT\.|INT\.\/EXT\.|Title:)/im.test(t) || looksLikeScene(t.split("\n").find((l) => l.trim()) ?? "");
}

export function hydrateProject(raw: Project): Project {
  const base = normalizeProject(raw);
  if ((!base.script || base.script.length === 0) && base.shots.length) {
    const syn = scriptFromShots(base.name, base.shots);
    return ensureMarks(hydrateWorld({ ...base, script: syn.script, shots: syn.shots }));
  }
  return ensureMarks(hydrateWorld({ ...base, shots: relinkSceneIds(base.script ?? [], base.shots) }));
}
