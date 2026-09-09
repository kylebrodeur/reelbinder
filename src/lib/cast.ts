import type { CharacterBible } from "./types";

export function nameKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/["“”']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function namesOf(person: CharacterBible): string[] {
  const aliases = Array.isArray(person.aliases) ? person.aliases : [];
  return [person.name, ...aliases].map((n) => n.trim()).filter(Boolean);
}

export function normalizeCharacter(raw: Partial<CharacterBible> & { name?: string }): CharacterBible | null {
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  const extra =
    typeof (raw as { aka?: string }).aka === "string"
      ? String((raw as { aka?: string }).aka)
          .split(",")
          .map((s) => s.trim())
      : [];
  const aliases = [...(Array.isArray(raw.aliases) ? raw.aliases : []), ...extra]
    .map((s) => String(s).trim())
    .filter((s, i, all) => s && nameKey(s) !== nameKey(name) && all.findIndex((x) => nameKey(x) === nameKey(s)) === i);
  return {
    name,
    look: String(raw.look ?? ""),
    voice: raw.voice ? String(raw.voice) : undefined,
    start: raw.start ? String(raw.start) : undefined,
    aliases,
  };
}

export function matchCharacter(people: CharacterBible[], raw: string): CharacterBible | undefined {
  const k = nameKey(raw);
  if (!k || !people.length) return undefined;
  const exact = people.find((c) => namesOf(c).some((n) => nameKey(n) === k));
  if (exact) return exact;
  const tokenHits = people.filter((c) =>
    namesOf(c).some((n) => {
      const nk = nameKey(n);
      if (nk === k) return true;
      const parts = nk.split(" ");
      return parts.includes(k) || nk.endsWith(` ${k}`) || nk.startsWith(`${k} `);
    }),
  );
  return tokenHits.length === 1 ? tokenHits[0] : undefined;
}

export function samePerson(people: CharacterBible[], a: string, b: string): boolean {
  const left = matchCharacter(people, a);
  const right = matchCharacter(people, b);
  if (left && right) return left.name === right.name;
  return nameKey(a) === nameKey(b);
}
