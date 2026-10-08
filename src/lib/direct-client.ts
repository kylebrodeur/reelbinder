import { CinemaRequestFailure, cinemaRequest } from "@/lib/cinema-client";

export interface DirectReceipt {
  tool: string;
  input: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  status: "succeeded" | "failed";
  outputs: Record<string, unknown>;
  evidenceLevel: "configured-root" | "owned-media" | "filesystem";
}

export interface ReviewSheetSummary {
  sheetId: string;
  title: string;
  noteCount: number;
  verdicts: { accepted: number; rejected: number; pending: number };
  lastModified: number;
}

export interface ReviewSheetState {
  markdown: string;
}

export interface DirectFrameOutput {
  frame: {
    assetId?: string;
    url?: string;
    sha256: string;
    byteSize: number;
    mimeType: "image/jpeg";
  };
}

const SHEET_ID_PATTERN = /^[a-f0-9]{24}$/;

function assertSheetId(sheetId: string): void {
  if (!SHEET_ID_PATTERN.test(sheetId)) throw new Error("A review sheet ID is required.");
}

export async function listReviewSheets(): Promise<ReviewSheetSummary[]> {
  const receipt = await cinemaRequest<DirectReceipt & { outputs: { sheets: ReviewSheetSummary[] } }>(
    "/direct/sheets",
  );
  return receipt.outputs.sheets;
}

export async function readReviewSheetState(sheetId: string): Promise<ReviewSheetState> {
  assertSheetId(sheetId);
  const receipt = await cinemaRequest<DirectReceipt & { outputs: ReviewSheetState }>(
    `/direct/sheets/${encodeURIComponent(sheetId)}/state`,
  );
  return receipt.outputs;
}

export async function rebuildMovingSheet(sheetId: string): Promise<DirectReceipt> {
  assertSheetId(sheetId);
  return cinemaRequest<DirectReceipt>(`/direct/sheets/${encodeURIComponent(sheetId)}/moving-sheet`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function generateTakeReports(sheetId: string): Promise<DirectReceipt> {
  assertSheetId(sheetId);
  return cinemaRequest<DirectReceipt>(`/direct/sheets/${encodeURIComponent(sheetId)}/take-reports`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function probeOwnedMedia(assetId: string): Promise<DirectReceipt> {
  return cinemaRequest<DirectReceipt>("/direct/probe", {
    method: "POST",
    body: JSON.stringify({ assetId }),
  });
}

export async function validateOwnedMedia(assetId: string): Promise<DirectReceipt> {
  return cinemaRequest<DirectReceipt>("/direct/validate", {
    method: "POST",
    body: JSON.stringify({ assetId }),
  });
}

export async function extractOwnedFrame(
  assetId: string,
  atSec: number,
  width?: number,
  height?: number,
): Promise<DirectReceipt & { outputs: DirectFrameOutput }> {
  return cinemaRequest<DirectReceipt & { outputs: DirectFrameOutput }>("/direct/frame", {
    method: "POST",
    body: JSON.stringify({ assetId, atSec, width, height }),
  });
}

export function describeDirectFailure(error: unknown): string {
  if (error instanceof CinemaRequestFailure) {
    if (error.code === "DIRECT_UNAVAILABLE") return "Direct review tooling is not connected to this Cinema service.";
    if (error.code === "SHEET_NOT_FOUND") return "The linked review sheet is no longer available.";
    if (error.code === "ASSET_NOT_FOUND") return "That media is no longer owned by this session.";
    if (error.code === "TOOL_LIMIT_EXCEEDED") return "That review batch exceeds the local tool limit.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The local review tool could not complete this action.";
}