import { MARK_TAGS, type ContinuityIssue, type MarkTag, type PreflightFinding } from "./types.ts";
import type { CinemaJobRequest } from "./cinema-client.ts";
import type { PreflightReviewSource } from "./preflight-guard.ts";
import type { ReviewedFinding } from "./preflight-store";
import type { Project, ScriptElement, Shot, View } from "./types";
import { scriptCommentContext } from "./script-comments.ts";
import { STUDIO_TOOLS } from "./webmcp/studio-tools.ts";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: { title: string; url: string }[];
  threadId?: string;
  jobId?: string;
  inlineDelivered?: boolean;
  /** Set only on standalone Parallel research messages; every other message is Gemini. */
  provider?: "parallel";
  /** Standalone Parallel research messages: the researched question (Research tab rows + context notes). */
  question?: string;
  /** Standalone Parallel research messages: epoch ms when the job delivered (elapsed display only). */
  finishedAt?: number;
  /** Standalone Parallel research messages: job runtime ms, for the Research tab's elapsed display. */
  researchDurationMs?: number;
  /** Set on the compact research-context note created by "Add research as context"; marks the note as distinct. */
  researchNoteJobId?: string;
  /** Assistant-proposed research question (≤200 chars); renders the "Run research" chip until the job exists. */
  suggestion?: { question: string };
  /** True only when the answer was produced against the bounded context slice (mentions/focus refs were sent). */
  contextTrimmed?: boolean;
  /** What the sliced ask actually sent, per the backend response header data. */
  contextIncluded?: AssistantContextEntry[];
  /** Mention refs that matched nothing in the saved snapshot; backend dropped them. */
  contextUnresolved?: string[];
}

export type AssistantContextKind = "setup" | "element";
export interface AssistantContextEntry {
  kind: AssistantContextKind;
  id: string;
  label: string;
}

/**
 * Bounded context refs an ask carries: ids resolved against the saved snapshot
 * at ask time. Absent or empty means the full snapshot — today's behavior
 * stays untouched for every request that sends no refs.
 */
export const ASSISTANT_CONTEXT_REFS_MAX = 12;
const CONTEXT_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const isContextRefId = (value: unknown): value is string =>
  typeof value === "string" && CONTEXT_REF_PATTERN.test(value);

/**
 * Keep valid, deduped refs in first-seen order; drop invalid or overflowing
 * entries silently, capped at 12. Bounded exactly like the backend validator.
 */
export function normalizeContextRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  for (const item of value) {
    if (!isContextRefId(item) || refs.includes(item)) continue;
    refs.push(item);
    if (refs.length >= ASSISTANT_CONTEXT_REFS_MAX) break;
  }
  return refs;
}

/**
 * Effective ask refs: explicit mention picks first, then the implicit focus
 * ref when a slot is still left — the focus never crowds out an explicit pick.
 */
export function effectiveContextRefs(mentions: string[], focusRef: string | null): string[] {
  const refs = normalizeContextRefs(mentions);
  if (focusRef && isContextRefId(focusRef) && refs.length < ASSISTANT_CONTEXT_REFS_MAX && !refs.includes(focusRef))
    refs.push(focusRef);
  return refs;
}

export interface AssistantPending {
  phase: "preparing" | "ready";
  request: CinemaJobRequest;
  source: PreflightReviewSource;
  jobId: string | null;
  threadId?: string;
  /** Follow-up standalone Parallel research was requested; runs separately after this answer. */
  researchAfter?: boolean;
  parallelConnectionId?: string;
  /** Set after an inspect-first answer (empty answer + studio tool plan): this pending re-asks with the tool results. */
  studioFollowUp?: boolean;
}
/** Independent Parallel research job: same saved snapshot identity, no Gemini answer attached. */
export interface AssistantResearchPending {
  request: CinemaJobRequest;
  source: PreflightReviewSource;
  jobId: string | null;
  /** Delivers the source follow-up to the same script-comment thread when applicable. */
  threadId?: string;
  /** Epoch ms when this job's (latest) execution attempt started; elapsed display only. */
  startedAt?: number;
}
export interface AssistantReport {
  source: PreflightReviewSource;
  findings: ReviewedFinding[];
  /** Outcomes of auto-executed UI navigation tools, if any. */
  uiActions?: {
    tool: string;
    args: Record<string, unknown>;
    ok: boolean;
    error?: string;
  }[];
}
export interface AssistantSession {
  version: 1;
  projectId: string;
  draft: string;
  messages: AssistantMessage[];
  dismissed: string[];
  pending: AssistantPending | null;
  /** Standalone Parallel research job tracked separately from the main request. */
  researchPending: AssistantResearchPending | null;
  /** Parallel research job failure shown beside, never instead of, the delivered answer. */
  researchError: string | null;
  /** The named fault code behind researchError (e.g. PARALLEL_TIMEOUT), for the Research tab's failed row. */
  researchFaultCode: string | null;
  report: AssistantReport | null;
  error: string | null;
  canRestart: boolean;
  focusThreadId?: string;
  /** Composer mention picks (contextRefs) recorded from the pickers; cleared on send exactly like the draft. */
  mentions: string[];
}
export interface ProductionIssue extends PreflightFinding {
  key: string;
  shotId?: string;
  origin: "local" | "agentic";
  sources: { title: string; url: string }[];
}


export function assistantInput(
  question: string,
  messages: AssistantMessage[],
  research: boolean,
  officialDocsOrProject: boolean | Project = false,
  projectOrThreadId?: Project | string,
  threadId?: string,
  contextRefs?: string[],
) {
  const officialDocs =
    typeof officialDocsOrProject === "boolean" ? officialDocsOrProject : false;
  const project =
    typeof officialDocsOrProject === "boolean"
      ? projectOrThreadId && typeof projectOrThreadId !== "string"
        ? projectOrThreadId
        : undefined
      : officialDocsOrProject;
  const focusedThreadId =
    typeof officialDocsOrProject === "boolean"
      ? threadId
      : typeof projectOrThreadId === "string"
        ? projectOrThreadId
        : threadId;
  const text = question.trim();
  if (!text || text.length > 4000) throw new Error("Ask a question of up to 4,000 characters.");
  const commentContext = project ? scriptCommentContext(project, focusedThreadId) : "";
  const conversation = messages
    .slice(commentContext ? -7 : -8)
    .map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
  if (commentContext) conversation.push({ role: "user", text: commentContext });
  return {
    question: text,
    research,
    officialDocs,
    conversation,
    // Additive: an ask with no refs keeps the full-snapshot input shape.
    ...(contextRefs?.length ? { contextRefs } : {}),
  };
}

export function productionIssueKey(
  issue: Pick<ProductionIssue, "title" | "detail" | "elementId" | "suggest" | "shotId">,
): string {
  return JSON.stringify([
    issue.title,
    issue.detail,
    issue.elementId ?? "",
    issue.shotId ?? "",
    issue.suggest?.tag ?? "",
    issue.suggest?.text ?? "",
  ]);
}

export function productionIssues(
  local: PreflightFinding[],
  continuity: ContinuityIssue[],
  remote: ReviewedFinding[],
  dismissed: string[],
): ProductionIssue[] {
  const seen = new Set(dismissed);
  const candidates: Omit<ProductionIssue, "key">[] = [
    ...continuity.map((issue) => ({
      ...issue,
      elementId: null,
      origin: "local" as const,
      sources: [],
    })),
    ...local.map((issue) => ({ ...issue, origin: "local" as const, sources: [] })),
    ...remote.filter((issue) => issue.origin === "agentic"),
  ];
  const result: ProductionIssue[] = [];
  for (const issue of candidates) {
    const key = productionIssueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...issue, key });
  }
  const priority = { error: 0, warn: 1, info: 2 };
  return result.sort((a, b) => priority[a.severity] - priority[b.severity]);
}

export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Shared HTTP(S)-only policy for stored sources and rendered assistant links. */
export function isSafeSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const safeSources = (value: unknown): { title: string; url: string }[] =>
  Array.isArray(value)
    ? value
        .filter(
          (item): item is { title: string; url: string } =>
            record(item) && typeof item.title === "string" && isSafeSourceUrl(item.url),
        )
        .slice(0, 20)
    : [];

export interface PlannedUiAction {
  tool: string;
  args: Record<string, unknown>;
}

export function planUiActions(
  raw: unknown,
  tools: readonly { name: string; autoExecutable?: boolean }[],
): PlannedUiAction[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(tools.filter((t) => t.autoExecutable).map((t) => t.name));
  const result: PlannedUiAction[] = [];
  for (const item of raw.slice(0, 10)) {
    if (
      !record(item) ||
      typeof item.tool !== "string" ||
      !allowed.has(item.tool) ||
      !record(item.args)
    )
      continue;
    result.push({ tool: item.tool, args: item.args });
    if (result.length >= 10) break;
  }
  return result;
}
/**
 * A composer mention token in progress: the draft's trailing word starting
 * with `@` (shots/setups) or `#` (script elements/threads). The token always
 * runs to the end of the draft, so a space or a pick closes it.
 */
export interface AssistantMentionQuery {
  trigger: "@" | "#";
  /** Text typed after the trigger; matched case-insensitively against candidates. */
  query: string;
  /** Index of the trigger character in the draft. */
  start: number;
}

export function mentionQuery(draft: string): AssistantMentionQuery | null {
  let start = draft.length;
  while (start > 0 && !/\s/.test(draft.charAt(start - 1))) start -= 1;
  const token = draft.slice(start);
  if (token[0] !== "@" && token[0] !== "#") return null;
  return { trigger: token[0] as "@" | "#", query: token.slice(1), start };
}

/** Replace the in-progress mention token with the picked plain-text token, ready for the next word. */
export function mentionPickedDraft(draft: string, token: string): string {
  const mention = mentionQuery(draft);
  if (mention) return `${draft.slice(0, mention.start)}${token} `;
  return `${draft.trimEnd()} ${token} `;
}

/** One mention picker candidate: the contextRef it records, its token and its display label. */
export interface AssistantMentionCandidate {
  /** The contextRef id sent with the ask. */
  ref: string;
  kind: AssistantContextKind;
  label: string;
  /** Plain-text token appended to the draft on pick. */
  token: string;
  /** Lowercased text the picker matches queries against. */
  searchText: string;
}

const ASSISTANT_MENTION_EXCERPT_CHARS = 60;
const mentionExcerpt = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, ASSISTANT_MENTION_EXCERPT_CHARS);

const setupMentionCandidate = (shot: Shot): AssistantMentionCandidate => {
  const label = [shot.setup, shot.title].filter(Boolean).join(" ") || `Shot ${shot.number}`;
  return {
    ref: shot.id,
    kind: "setup",
    label,
    token: `@${label}`,
    searchText: `${shot.number} ${label} ${shot.id}`.toLowerCase(),
  };
};

const elementMentionCandidate = (element: ScriptElement): AssistantMentionCandidate => ({
  ref: element.id,
  kind: "element",
  // Kind plus truncated element text, so the picker stays readable at width.
  label: mentionExcerpt(element.text) ? `${element.kind} · ${mentionExcerpt(element.text)}` : `#${element.id}`,
  token: `#${element.id}`,
  searchText: `${element.id} ${element.kind} ${element.text}`.toLowerCase(),
});

/** `@` candidates for the current surface: script lists scenes/beats; stage, edit and render list shots. */
export function shotMentionCandidates(view: View, project: Project): AssistantMentionCandidate[] {
  if (view === "script")
    return project.script.filter((element) => element.kind === "scene").map(elementMentionCandidate);
  return project.shots.map(setupMentionCandidate);
}

/** `#` candidates: every script element plus each script comment thread, which rides its anchored element ref. */
export function elementMentionCandidates(project: Project): AssistantMentionCandidate[] {
  const candidates = project.script.map(elementMentionCandidate);
  for (const thread of project.scriptCommentThreads ?? []) {
    const anchored = project.script.find((element) => element.id === thread.anchor.elementId);
    const anchorText = mentionExcerpt(thread.anchor.quote) || mentionExcerpt(anchored?.text ?? "");
    candidates.push({
      ref: thread.anchor.elementId,
      kind: "element",
      label: anchorText ? `thread · ${anchorText}` : `thread on #${thread.anchor.elementId}`,
      token: `#${thread.anchor.elementId}`,
      searchText: `${thread.anchor.elementId} thread ${thread.anchor.quote} ${anchored?.text ?? ""}`.toLowerCase(),
    });
  }
  return candidates;
}

/** Resolve contextRef ids to the picker's labels for the Copilot task note.
 * Setups and script elements map to the same labels the mention picker shows;
 * unmatched or non-identifier refs drop. */
export function contextRefLabels(
  project: Project,
  refs: string[],
): { kind: AssistantContextKind; id: string; label: string }[] {
  const byId: Record<string, AssistantMentionCandidate> = {};
  for (const shot of project.shots) {
    const candidate = setupMentionCandidate(shot);
    byId[candidate.ref] = candidate;
  }
  for (const element of project.script) {
    const candidate = elementMentionCandidate(element);
    byId[candidate.ref] = candidate;
  }
  const seen = new Set<string>();
  const result: { kind: AssistantContextKind; id: string; label: string }[] = [];
  for (const ref of normalizeContextRefs(refs)) {
    const candidate = byId[ref];
    if (!candidate || seen.has(ref)) continue;
    seen.add(ref);
    result.push({ kind: candidate.kind, id: ref, label: candidate.label });
    if (result.length >= ASSISTANT_CONTEXT_REFS_MAX) break;
  }
  return result;
}

export const ASSISTANT_MENTION_PICKER_LIMIT = 40;

export interface AssistantMentionPicker {
  headline: string;
  entries: AssistantMentionCandidate[];
  total: number;
}

/**
 * The compact composer picker for an in-progress mention token: candidates
 * filtered by the typed query, capped at the picker limit with an honest
 * headline that says when the list was cut.
 */
export function assistantMentionPicker(
  mention: AssistantMentionQuery,
  view: View,
  project: Project,
): AssistantMentionPicker {
  const baseLabel =
    mention.trigger === "@"
      ? view === "script"
        ? "Scenes & beats"
        : view === "stage"
          ? "Setups"
          : "Shots"
      : "Script elements & threads";
  const candidates =
    mention.trigger === "@" ? shotMentionCandidates(view, project) : elementMentionCandidates(project);
  const query = mention.query.trim();
  const matched = query
    ? candidates.filter((candidate) => candidate.searchText.includes(query.toLowerCase()))
    : candidates;
  const capped = matched.length > ASSISTANT_MENTION_PICKER_LIMIT;
  return {
    headline: `${baseLabel} · ${matched.length}${query ? ` matching "${query}"` : ""}${
      capped ? ` (first ${ASSISTANT_MENTION_PICKER_LIMIT} shown)` : ""
    }`,
    entries: matched.slice(0, ASSISTANT_MENTION_PICKER_LIMIT),
    total: matched.length,
  };
}

/** Standalone Parallel jobs are source-only; a blank or absent answer keeps the message stable. */
export const PARALLEL_RESEARCH_NOTE = "Parallel research sources for this same question.";

/**
 * Stable conversation-feed id for one job's compact research-context note.
 * The per-job id makes "Add research as context" idempotent: a second click
 * can never append the same note twice.
 */
export const researchNoteMessageId = (jobId: string) => `research-context:${jobId}`;

/**
 * Compact research-context note appended by "Add research as context": the
 * job id, the researched question, and up to six cited source titles. This is
 * a distinct Parallel-labelled note message — not user text — so the next
 * ask's conversation carries exactly what the research found.
 */
export function researchContextNote(
  jobId: string,
  question: string | undefined,
  sources: { title: string; url: string }[],
  maxSources = 6,
): string {
  const lines = [`Research context from Parallel job ${jobId} — carried for the next answer.`];
  if (question?.trim()) lines.push(`Question: ${question.trim()}`);
  const cited = sources.slice(0, maxSources);
  lines.push(
    cited.length
      ? `Cited sources: ${cited.map((source) => source.title).join("; ")}`
      : "This job returned no sources.",
  );
  return lines.join("\n");
}

/** Compact duration label ("42s", "3m 5s", "1h 2m") for research job elapsed display. */
export function researchDurationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Checks ↔ Research domain heuristic (spec section 3): a completed Parallel
 * research job is paired with a production check when its question and the
 * check's title touch the same production domain. Domains are plain keyword
 * families matched with word-boundary prefixes — no model call, no fake data;
 * a row or check outside these families matches nothing.
 */
export type AssistantCheckResearchDomain = "period" | "props" | "wardrobe" | "set-dressing" | "sound";

export interface AssistantCheckResearchDomainSpec {
  id: AssistantCheckResearchDomain;
  label: string;
  keywords: readonly string[];
}

/** Human labels for the domain tags beside grouped and per-check research affordances. */
export const CHECK_RESEARCH_DOMAIN_LABELS: Readonly<
  Record<AssistantCheckResearchDomain, string>
> = {
  period: "Period & world accuracy",
  props: "Props",
  wardrobe: "Wardrobe",
  "set-dressing": "Set dressing",
  sound: "Sound",
};

const CHECK_RESEARCH_DOMAIN_KEYWORDS: readonly AssistantCheckResearchDomainSpec[] = [
  {
    id: "period",
    label: "Period & world accuracy",
    keywords: ["period", "anachronis", "historical", "history", "accuracy", "accurate", "authentic", "world"],
  },
  { id: "props", label: "Props", keywords: ["prop", "props", "tool", "weapon"] },
  {
    id: "wardrobe",
    label: "Wardrobe",
    keywords: ["wardrobe", "costume", "clothing", "clothes", "outfit", "garment", "attire", "fabric"],
  },
  {
    id: "set-dressing",
    label: "Set dressing",
    keywords: ["set dressing", "dressing", "dressed", "furniture", "furnishings", "decor"],
  },
  { id: "sound", label: "Sound", keywords: ["sound", "audio", "score", "music", "foley", "ambience", "ambiance", "ambient", "diegetic", "noise"] },
];

const domainKeywordRegexes: Record<string, RegExp> = {};
const domainKeywordMatch = (keyword: string, text: string): boolean => {
  let regex = domainKeywordRegexes[keyword];
  if (!regex) {
    // Word-boundary prefix match: `\bdressing` never fires inside
    // "addressing" — the boundary keeps the heuristic honest.
    regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    domainKeywordRegexes[keyword] = regex;
  }
  return regex.test(text);
};

/** Extra non-keyword patterns per domain: a decade token ("1890s") reads as a period question. */
const CHECK_RESEARCH_DOMAIN_PATTERNS: Partial<Record<AssistantCheckResearchDomain, RegExp>> = {
  period: /\b[0-9]{2,4}0s\b/i,
};

/** The domains a piece of text (a check title, a research question) touches. */
export function checkResearchDomains(text: string): AssistantCheckResearchDomain[] {
  if (!text.trim()) return [];
  const hit: AssistantCheckResearchDomain[] = [];
  for (const domain of CHECK_RESEARCH_DOMAIN_KEYWORDS) {
    if (
      domain.keywords.some((keyword) => domainKeywordMatch(keyword, text)) ||
      CHECK_RESEARCH_DOMAIN_PATTERNS[domain.id]?.test(text) === true
    )
      hit.push(domain.id);
  }
  return hit;
}

/** Whether a completed research question and a check's text share a domain. */
export function checkResearchSharesDomain(question: string, checkText: string): boolean {
  const questionDomains = checkResearchDomains(question);
  if (questionDomains.length === 0) return false;
  return checkResearchDomains(checkText).some((domain) => questionDomains.includes(domain));
}

/**
 * Draft question composed by a check row's "Research this check" affordance:
 * focused on the check, asking for inspectable citations. It only fills the
 * composer draft — the filmmaker presses Send.
 */
export function checkResearchQuestion(checkTitle: string): string {
  return `What do period-accurate sources say about ${checkTitle}? Cite sources I can inspect.`;
}

/** One research source-grouping input: a completed Parallel research row. */
export interface CheckResearchRow {
  /** Stable row key; used as the job reference when no jobId was recorded. */
  id: string;
  question?: string;
  sources?: { title: string; url: string }[];
  jobId?: string | null;
}

/** One check's cited-research group for the Research tab's "Sources" block. */
export interface CheckResearchSources {
  /** Heading the group renders under — the check's title. */
  checkTitle: string;
  /** Domain shared by the check and the matching research questions. */
  domain: AssistantCheckResearchDomain;
  /** Job ids of the matching completed rows (jobId when recorded, else the row key). */
  jobIds: string[];
  /** Cited sources across the matching rows, deduped by URL, first-seen order. */
  sources: { title: string; url: string }[];
}

/**
 * Group the cited sources of completed research rows by the check they match:
 * one group per check title whose domain a matching row's question shares,
 * sources deduped and capped per group. Checks and rows that match nothing
 * yield nothing — the block only renders with real matches.
 */
export function checkResearchSources(
  checks: AssistantCheckLike[],
  research: CheckResearchRow[],
  maxSourcesPerCheck = 8,
): CheckResearchSources[] {
  const byTitle = new Map<string, CheckResearchSources>();
  for (const check of checks) {
    const title = check.title.trim();
    if (!title || byTitle.has(title)) continue;
    const checkDomains = checkResearchDomains(checkTextOf(check));
    if (checkDomains.length === 0) continue;
    for (const row of research) {
      if ((row.sources?.length ?? 0) === 0) continue;
      const shared = checkResearchDomains(row.question ?? "").find((domain) =>
        checkDomains.includes(domain),
      );
      if (!shared) continue;
      let group = byTitle.get(title);
      if (!group) {
        group = { checkTitle: title, domain: shared, jobIds: [], sources: [] };
        byTitle.set(title, group);
      }
      const jobRef = row.jobId ?? row.id;
      if (!group.jobIds.includes(jobRef)) group.jobIds.push(jobRef);
      for (const source of row.sources ?? []) {
        if (group.sources.some((existing) => existing.url === source.url)) continue;
        if (group.sources.length >= maxSourcesPerCheck) break;
        group.sources.push(source);
      }
    }
  }
  return [...byTitle.values()];
}

/** One production check the research wiring can pair with (title + its detail text). */
export interface AssistantCheckLike {
  title: string;
  detail?: string;
}

/** The check text the heuristic reads: title plus detail — local checks name
 * their noun in the title ("Untagged lamp") but their domain words in the
 * detail ("reads as a prop or dressing"). */
const checkTextOf = (check: AssistantCheckLike): string =>
  [check.title, check.detail].filter((part) => !!part?.trim()).join(" ");

/**
 * The newest completed research row whose question shares a domain with one
 * check: the row the check's "View sources" affordance highlights in the
 * Research tab. Rows without cited sources never match.
 */
export function newestMatchingCheckResearch(
  check: AssistantCheckLike,
  research: CheckResearchRow[],
): CheckResearchRow | null {
  const checkDomains = checkResearchDomains(checkTextOf(check));
  if (checkDomains.length === 0) return null;
  for (let index = research.length - 1; index >= 0; index -= 1) {
    const row = research[index];
    if ((row.sources?.length ?? 0) === 0) continue;
    if (
      checkResearchDomains(row.question ?? "").some((domain) => checkDomains.includes(domain))
    )
      return row;
  }
  return null;
}

/**
 * Strip query strings from any http(s) URL inside free text, keeping
 * origin + path. Copilot history/observations can embed callback URLs whose
 * search carries live OAuth authorization codes, state and scope — those may
 * never reach the chat feed or stored run history. Plain text and relative
 * references pass through untouched.
 */
export function redactUrlQuery(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) => {
    try {
      const parsed = new URL(url.replace(/[)\].,;:'"]+$/g, ""));
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  });
}

export function parallelResearchResult(
  value: unknown,
  revision: number,
): { answer: string; sources: { title: string; url: string }[] } {
  if (!record(value) || value.sourceRevision !== revision || !Array.isArray(value.sources))
    throw new Error(
      "The Parallel research response does not match this review's snapshot revision.",
    );
  const answer =
    typeof value.answer === "string" && value.answer.trim() && value.answer.length <= 12000
      ? value.answer
      : PARALLEL_RESEARCH_NOTE;
  return { answer, sources: safeSources(value.sources) };
}

/** Compact relative label for report rows; timestamps are epoch seconds (ms tolerated). */
export function reportRelativeTime(createdAt: number, now = Date.now()): string {
  const at = Math.abs(createdAt) > 1e11 ? createdAt : createdAt * 1000;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

export function emptyAssistantSession(projectId: string): AssistantSession {
  return {
    version: 1,
    projectId,
    draft: "",
    messages: [],
    dismissed: [],
    pending: null,
    researchPending: null,
    researchError: null,
    researchFaultCode: null,
    report: null,
    error: null,
    canRestart: false,
    mentions: [],
  };
}

export function parseAssistantSession(
  raw: string | null,
  projectId: string,
): AssistantSession | null {
  if (!raw || raw.length > 4_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      value.version !== 1 ||
      value.projectId !== projectId ||
      typeof value.draft !== "string" ||
      value.draft.length > 4000 ||
      (value.focusThreadId !== undefined &&
        (typeof value.focusThreadId !== "string" ||
          !value.focusThreadId ||
          value.focusThreadId.length > 200)) ||
      (value.researchError !== undefined &&
        value.researchError !== null &&
        (typeof value.researchError !== "string" || value.researchError.length > 500)) ||
      (value.researchFaultCode !== undefined &&
        value.researchFaultCode !== null &&
        (typeof value.researchFaultCode !== "string" || value.researchFaultCode.length > 200)) ||
      !Array.isArray(value.messages) ||
      value.messages.length > 24 ||
      !value.messages.every(
        (m) =>
          record(m) &&
          typeof m.id === "string" &&
          ["user", "assistant"].includes(String(m.role)) &&
          typeof m.text === "string" &&
          m.text.length <= 12000 &&
          (m.threadId === undefined ||
            (typeof m.threadId === "string" && !!m.threadId && m.threadId.length <= 200)) &&
          (m.jobId === undefined ||
            (typeof m.jobId === "string" && !!m.jobId && m.jobId.length <= 200)) &&
          (m.inlineDelivered === undefined || typeof m.inlineDelivered === "boolean") &&
          (m.provider === undefined || m.provider === "parallel") &&
          (m.question === undefined ||
            (typeof m.question === "string" && !!m.question.trim() && m.question.length <= 4000)) &&
          (m.finishedAt === undefined ||
            (typeof m.finishedAt === "number" && Number.isFinite(m.finishedAt))) &&
          (m.researchDurationMs === undefined ||
            (typeof m.researchDurationMs === "number" && Number.isFinite(m.researchDurationMs))) &&
          (m.researchNoteJobId === undefined ||
            (typeof m.researchNoteJobId === "string" &&
              !!m.researchNoteJobId &&
              m.researchNoteJobId.length <= 200)) &&
          (m.suggestion === undefined ||
            (record(m.suggestion) &&
              typeof m.suggestion.question === "string" &&
              !!m.suggestion.question.trim() &&
              m.suggestion.question.length <= 200)) &&
          (m.contextTrimmed === undefined || typeof m.contextTrimmed === "boolean") &&
          validContextIncluded(m.contextIncluded) &&
          validContextUnresolved(m.contextUnresolved),
      ) ||
      !Array.isArray(value.dismissed) ||
      value.dismissed.length > 500 ||
      !value.dismissed.every((key) => typeof key === "string")
    )
      return null;
    const validSource = (source: unknown) =>
      record(source) &&
      source.projectId === projectId &&
      typeof source.fingerprint === "string" &&
      typeof source.reviewFingerprint === "string";
    if (value.pending !== null) {
      const p = value.pending;
      if (
        !record(p) ||
        !["preparing", "ready"].includes(String(p.phase)) ||
        (p.threadId !== undefined &&
          (typeof p.threadId !== "string" || !p.threadId || p.threadId.length > 200)) ||
        (p.researchAfter !== undefined && typeof p.researchAfter !== "boolean") ||
        (p.parallelConnectionId !== undefined &&
          (typeof p.parallelConnectionId !== "string" ||
            !p.parallelConnectionId ||
            p.parallelConnectionId.length > 200)) ||
        !validSource(p.source) ||
        !record(p.request) ||
        p.request.kind !== "preflight" ||
        typeof p.request.connectionId !== "string" ||
        typeof p.request.idempotencyKey !== "string" ||
        !record(p.request.input) ||
        typeof p.request.input.question !== "string" ||
        !Array.isArray(p.request.input.conversation) ||
        !p.request.input.question.trim() ||
        p.request.input.question.length > 4000 ||
        p.request.input.conversation.length > 8 ||
        !p.request.input.conversation.every(
          (turn) =>
            record(turn) &&
            ["user", "assistant"].includes(String(turn.role)) &&
            typeof turn.text === "string" &&
            !!turn.text.trim() &&
            turn.text.length <= 4000,
        ) ||
        (p.jobId !== null && typeof p.jobId !== "string")
      )
        return null;
      const source = p.source as unknown as PreflightReviewSource;
      if (
        p.phase === "ready" &&
        (typeof p.request.projectId !== "string" ||
          p.request.projectId !== source.backendProjectId ||
          p.request.expectedRevision !== source.sourceRevision ||
          typeof source.sourceRevision !== "number" ||
          source.sourceRevision < 1)
      )
        return null;
      if (p.phase === "preparing" && p.jobId !== null) return null;
    }
    if (value.researchPending !== undefined && value.researchPending !== null) {
      const research = value.researchPending;
      if (
        !record(research) ||
        (research.threadId !== undefined &&
          (typeof research.threadId !== "string" ||
            !research.threadId ||
            research.threadId.length > 200)) ||
        !validSource(research.source) ||
        !record(research.request) ||
        research.request.kind !== "preflight" ||
        typeof research.request.connectionId !== "string" ||
        typeof research.request.idempotencyKey !== "string" ||
        !research.request.idempotencyKey ||
        research.request.idempotencyKey.length > 128 ||
        !record(research.request.input) ||
        (research.request.parallelConnectionId !== undefined &&
          (typeof research.request.parallelConnectionId !== "string" ||
            !research.request.parallelConnectionId ||
            research.request.parallelConnectionId.length > 200)) ||
        research.request.input.research !== true ||
        research.request.input.parallelOnly !== true ||
        research.request.input.officialDocs !== false ||
        typeof research.request.input.question !== "string" ||
        !research.request.input.question.trim() ||
        research.request.input.question.length > 4000 ||
        !Array.isArray(research.request.input.conversation) ||
        research.request.input.conversation.length > 8 ||
        !research.request.input.conversation.every(
          (turn) =>
            record(turn) &&
            ["user", "assistant"].includes(String(turn.role)) &&
            typeof turn.text === "string" &&
            !!turn.text.trim() &&
            turn.text.length <= 4000,
        ) ||
        (research.jobId !== null && typeof research.jobId !== "string")
      )
        return null;
      const researchSource = research.source as unknown as PreflightReviewSource;
      if (
        typeof researchSource.sourceRevision !== "number" ||
        researchSource.sourceRevision < 1 ||
        research.request.projectId !== researchSource.backendProjectId ||
        research.request.expectedRevision !== researchSource.sourceRevision
      )
        return null;
    }
    const validFinding = (finding: unknown): boolean => {
      if (
        !record(finding) ||
        typeof finding.id !== "string" ||
        typeof finding.title !== "string" ||
        typeof finding.detail !== "string" ||
        finding.origin !== "agentic" ||
        !["error", "warn", "info"].includes(String(finding.severity)) ||
        (finding.elementId !== null && typeof finding.elementId !== "string")
      )
        return false;
      const proposal = finding.suggest;
      return (
        proposal === undefined ||
        (record(proposal) &&
          (MARK_TAGS as readonly unknown[]).includes(proposal.tag) &&
          typeof proposal.text === "string" &&
          (proposal.note === undefined || typeof proposal.note === "string"))
      );
    };
    if (
      value.report !== null &&
      (!record(value.report) ||
        !validSource(value.report.source) ||
        !Array.isArray(value.report.findings) ||
        value.report.findings.length > 40 ||
        !value.report.findings.every(validFinding))
    )
      return null;
    const restored = value as unknown as AssistantSession;
    // Snapshots saved before standalone research existed carry no research fields.
    restored.researchPending = restored.researchPending ?? null;
    restored.researchError = restored.researchError ?? null;
    restored.researchFaultCode = restored.researchFaultCode ?? null;
    // Mention picks predate the mention feature on stored sessions; bounded
    // validation drops anything malformed instead of rejecting the session.
    restored.mentions = normalizeContextRefs(value.mentions);
    // A recovered pending replays only bounded, valid refs; a ref-less request
    // keeps its original key shape (the additive contract pins no refs).
    if (restored.pending) {
      const replay = normalizeContextRefs(restored.pending.request.contextRefs);
      const { contextRefs: rawRefs, ...request } = restored.pending.request;
      restored.pending = {
        ...restored.pending,
        request: replay.length ? { ...request, contextRefs: replay } : request,
      };
    }
    restored.messages = restored.messages.map((message) => ({
      ...message,
      ...(message.sources ? { sources: safeSources(message.sources) } : {}),
    }));
    if (restored.report)
      restored.report.findings = restored.report.findings.map((finding) => ({
        ...finding,
        sources: safeSources(finding.sources),
      }));
    return restored;
  } catch {
    return null;
  }
}

const validContextIncluded = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= ASSISTANT_CONTEXT_REFS_MAX &&
    value.every(
      (entry) =>
        record(entry) &&
        (["setup", "element"] as readonly string[]).includes(String(entry.kind)) &&
        isContextRefId(entry.id) &&
        typeof entry.label === "string" &&
        !!entry.label.trim() &&
        entry.label.length <= 200,
    ));
const validContextUnresolved = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= ASSISTANT_CONTEXT_REFS_MAX &&
    value.every((ref) => isContextRefId(ref)));
