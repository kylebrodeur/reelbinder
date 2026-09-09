import type { PreflightFinding, Shot } from "./types";

/**
 * Compatibility for older local callers. Live artifact work uses cinema-client
 * and an explicit session-scoped Google Cloud connection. These functions never
 * read credentials, create server RPCs, or contact a provider.
 */
type UnavailableResult = {
  ok: false;
  code: "LEGACY_ACTION_UNAVAILABLE";
  error: string;
};
type LegacyResult<T> = ({ ok: true } & T) | UnavailableResult;
type LegacyRequest<T> = { data: T };
type BreakdownShot = Pick<
  Shot,
  | "title"
  | "action"
  | "dialogue"
  | "camera"
  | "movement"
  | "screenDirection"
  | "durationSec"
  | "timeOfDay"
  | "location"
  | "characters"
  | "lighting"
  | "notes"
>;
type BreakdownResult = {
  name: string;
  style: string;
  characters: { name: string; look: string }[];
  shots: BreakdownShot[];
  script?: string;
};

function unavailable(error: string): UnavailableResult {
  return { ok: false, code: "LEGACY_ACTION_UNAVAILABLE", error };
}

export async function breakdownBoard(
  _request: LegacyRequest<{ logline: string; style: string; target: string; count: number }>,
): Promise<LegacyResult<BreakdownResult>> {
  return unavailable("Use New script → Start from an idea with a Google Cloud connection.");
}

export async function polishPrompts(
  _request: LegacyRequest<{ logline: string; style: string; shot: Shot }>,
): Promise<LegacyResult<{ imagine: string; veo: string; runway: string }>> {
  return unavailable(
    "Automatic prompt rewriting is unavailable. Adjust the setup or its prompt tuning directly.",
  );
}

export async function preflightScript(
  _request: LegacyRequest<{
    name: string;
    logline: string;
    script: { id: string; kind: string; text: string }[];
    marks: { tag: string; text: string; note: string; elementId: string }[];
    shots: { setup: string; title: string; elementIds: string[] }[];
    characters: string[];
  }>,
): Promise<LegacyResult<{ findings: PreflightFinding[] }>> {
  return unavailable(
    "Open Preflight and explicitly run local checks or agentic review with a Google Cloud connection.",
  );
}

export async function rewriteShot(
  _request: LegacyRequest<{
    logline: string;
    style: string;
    prev?: string;
    next?: string;
    shot: { title: string; action: string; camera: string; location: string };
  }>,
): Promise<LegacyResult<{ title: string; action: string }>> {
  return unavailable(
    "Automatic shot rewriting is unavailable. Edit the screenplay or selected setup directly.",
  );
}

export async function generateFrame(
  _request: LegacyRequest<{ prompt: string }>,
): Promise<LegacyResult<{ url: string }>> {
  return unavailable("Generate images from Stage → Frame with a Google Cloud connection.");
}

export async function editFrame(
  _request: LegacyRequest<{ prompt: string; imageUrl: string }>,
): Promise<LegacyResult<{ url: string }>> {
  return unavailable(
    "Edit images from Stage → Frame using a local raster reference and Google Cloud connection.",
  );
}

export async function startVideo(
  _request: LegacyRequest<{ prompt: string; imageUrl?: string | null; duration: number }>,
): Promise<LegacyResult<{ url: string | null; requestId: string | null }>> {
  return unavailable(
    "Video generation is unavailable. A supported Cloud video connection and adapter are required.",
  );
}

export async function pollVideo(
  _request: LegacyRequest<{ requestId: string }>,
): Promise<
  LegacyResult<{
    status: string;
    url: string | null;
    error: string | null;
    progress: number | null;
  }>
> {
  return unavailable("Legacy video jobs cannot be resumed in this Google-only build.");
}
