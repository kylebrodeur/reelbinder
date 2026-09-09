import { MARK_TAGS, type MarkTag, type ScriptMark } from "./types.ts";

export interface PreflightReviewSource {
  projectId: string;
  fingerprint: string;
  reviewFingerprint: string;
  backendProjectId: string | null;
  sourceRevision: number | null;
  resultRevision: number | null;
}
export interface PreflightProposal {
  elementId?: string | null;
  text?: string;
  tag?: string;
  note?: string;
}
type ReviewProject = { id: string; script: { id: string; text: string }[] };
type GuardResult =
  { ok: true; mark: Omit<ScriptMark, "id" | "sceneId"> } | { ok: false; error: string };

export function projectFingerprint(project: object): string {
  // Full serialized content is a collision-free comparison token, kept in memory only.
  return JSON.stringify(project);
}

export function guardPreflightFinding<T extends ReviewProject>(
  project: T,
  source: PreflightReviewSource | null,
  proposal: PreflightProposal,
): GuardResult {
  if (
    !source ||
    source.projectId !== project.id ||
    source.reviewFingerprint !== projectFingerprint(project)
  ) {
    return {
      ok: false,
      error: "The project changed after this review. Run Preflight again before accepting notes.",
    };
  }
  if (
    source.backendProjectId &&
    (source.sourceRevision == null || source.resultRevision !== source.sourceRevision)
  ) {
    return {
      ok: false,
      error: "These results belong to a different saved revision. Run Preflight again.",
    };
  }
  if (!proposal.tag || !(MARK_TAGS as readonly string[]).includes(proposal.tag)) {
    return { ok: false, error: "This suggestion has no valid screenplay mark tag." };
  }
  const elements = project.script.filter((element) => element.id === proposal.elementId);
  if (elements.length !== 1) {
    return { ok: false, error: "This suggestion does not identify one screenplay element." };
  }
  const element = elements[0];
  const quote = proposal.text;
  if (!quote?.trim()) return { ok: false, error: "This suggestion needs an exact quoted passage." };
  const start = element.text.indexOf(quote);
  if (start < 0)
    return { ok: false, error: "The quoted passage is not present in this screenplay element." };
  if (element.text.indexOf(quote, start + 1) >= 0) {
    return {
      ok: false,
      error: "The quoted passage occurs more than once. Mark the intended passage manually.",
    };
  }
  return {
    ok: true,
    mark: {
      elementId: element.id,
      tag: proposal.tag as MarkTag,
      text: quote,
      note: proposal.note ?? "",
      start,
      end: start + quote.length,
    },
  };
}
