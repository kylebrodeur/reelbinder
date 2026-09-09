import { matchCharacter } from "./cast";
import { markMeta } from "./marks";
import type { MarkTag, PreflightFinding, Project, ScriptElement } from "./types";
import { uid } from "./utils";

const PROP_WORDS =
  /\b(coin|cigar|tankard|glass|whiskey|necklace|cross|hat|coat|gun|holster|door|doors|chair|table|lamp|washcloth|bandana|vest|apron)\b/gi;
const SOUND_WORDS = /\b(hear|swing|clink|scrape|pour|creak|footstep|silence)\b/gi;
// "Not just/only/merely" expands an idea; it does not forbid an element.
const NO_WORDS =
  /\b(never|no one|nobody|(?:does not|don't|do not)(?!\s+(?:just|only|merely)\b)|no score|no subtitles)\b/gi;
const EYE_WORDS = /\b(eyes? meet|looks? (?:at|to|toward)|eyeline|gazes?)\b/gi;

function spanOf(el: ScriptElement, re: RegExp): { text: string; start: number; end: number } | null {
  re.lastIndex = 0;
  const m = re.exec(el.text);
  if (!m || m.index == null) return null;
  return { text: m[0], start: m.index, end: m.index + m[0].length };
}

function hasTag(project: Project, elementId: string, tag: MarkTag, needle?: string): boolean {
  return (project.marks ?? []).some((m) => {
    if (m.elementId !== elementId || m.tag !== tag) return false;
    if (!needle) return true;
    return m.text.toLowerCase().includes(needle.toLowerCase());
  });
}

export function localPreflight(project: Project): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const push = (f: Omit<PreflightFinding, "id">) => {
    findings.push({ ...f, id: uid("pf") });
  };

  for (const el of project.script) {
    if (el.kind === "action" || el.kind === "dialogue") {
      const covered = project.shots.some((s) => s.elementIds.includes(el.id));
      if (!covered) {
        push({
          elementId: el.id,
          severity: "warn",
          title: "Unlined beat",
          detail: "This action or dialogue has no coverage line. Draw a line or mark a cam.",
          suggest: { tag: "cam", text: el.text.slice(0, 48), note: "Needs a setup." },
        });
      }
    }
    if (el.kind === "action") {
      PROP_WORDS.lastIndex = 0;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = PROP_WORDS.exec(el.text))) {
        const word = m[0];
        const key = word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!hasTag(project, el.id, "prop", word) && !hasTag(project, el.id, "dressing", word)) {
          push({
            elementId: el.id,
            severity: "info",
            title: `Untagged ${word.toLowerCase()}`,
            detail: `“${word}” reads as a prop or dressing and is not marked. Tag it so the model does not invent a different one.`,
            suggest: {
              tag: "prop",
              text: word,
              note: "Hero piece. Keep this object.",
              start: m.index,
              end: m.index + word.length,
            },
          });
        }
      }
      const sound = spanOf(el, SOUND_WORDS);
      if (sound && !hasTag(project, el.id, "sound")) {
        push({
          elementId: el.id,
          severity: "info",
          title: "Sound not marked",
          detail: `“${sound.text}” is audio the clip should keep. Mark it sound so it is not scored over.`,
          suggest: { tag: "sound", text: sound.text, note: "Diegetic. Keep this.", start: sound.start, end: sound.end },
        });
      }
      const no = spanOf(el, NO_WORDS);
      if (no && !hasTag(project, el.id, "no")) {
        push({
          elementId: el.id,
          severity: "warn",
          title: "Negative not locked",
          detail: `The prose says “${no.text}” but there is no no-mark. Models invent through soft negatives.`,
          suggest: { tag: "no", text: no.text, note: "Do not invent around this.", start: no.start, end: no.end },
        });
      }
      const eye = spanOf(el, EYE_WORDS);
      if (eye && !hasTag(project, el.id, "eyeline")) {
        push({
          elementId: el.id,
          severity: "info",
          title: "Eyeline unnamed",
          detail: "A look is described without an eyeline mark. Name who they look at.",
          suggest: { tag: "eyeline", text: eye.text, note: "Name the target.", start: eye.start, end: eye.end },
        });
      }
    }
    if (el.kind === "parenthetical" && /beat/i.test(el.text) && !hasTag(project, el.id, "beat")) {
      push({
        elementId: el.id,
        severity: "info",
        title: "Beat untimed",
        detail: "A (beat) with no beat-mark. Tell the model how long to hold.",
        suggest: { tag: "beat", text: el.text, note: "Hold a breath before the next line.", start: 0, end: el.text.length },
      });
    }
    if (el.kind === "character") {
      const name = el.text.replace(/\s*\(.*\)\s*$/, "");
      const hasLock = (project.marks ?? []).some(
        (m) => m.tag === "lock" && m.text.toLowerCase().includes(name.toLowerCase().split(" ")[0] ?? ""),
      );
      const look = matchCharacter(project.characters, name)?.look;
      if (!hasLock && look) {
        push({
          elementId: el.id,
          severity: "info",
          title: `${name} unlocked`,
          detail: "This player has a look in the production book but no lock on the page.",
          suggest: { tag: "lock", text: name, note: look, start: 0, end: Math.min(name.length, el.text.length) },
        });
      }
    }
  }

  if (!(project.marks ?? []).some((m) => m.tag === "no")) {
    push({
      elementId: project.script.find((e) => e.kind === "action")?.id ?? null,
      severity: "info",
      title: "No negatives marked",
      detail: "Without a no-mark, models invent extras, text, and smiles. Tag at least one span.",
      suggest: { tag: "no", text: "extra people, subtitles", note: "No extra patrons, no text on screen." },
    });
  }

  return findings.slice(0, 12);
}

export function mergeFindings(local: PreflightFinding[], remote: PreflightFinding[]): PreflightFinding[] {
  const out = [...local];
  for (const f of remote) {
    const dup = out.some(
      (x) => x.title === f.title && x.elementId === f.elementId,
    );
    if (!dup) out.push(f);
  }
  return out.slice(0, 32);
}

export function findingHint(tag: MarkTag): string {
  return markMeta(tag).hint;
}
