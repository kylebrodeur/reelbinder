export type GoogleSetupStep =
  | "mode"
  | "project"
  | "billing"
  | "apis"
  | "credentials"
  | "parallel"
  | "complete";

export interface GoogleSetupState {
  step: GoogleSetupStep;
  mode: "standard" | "express";
  projectId: string;
  location: string;
  billingConfirmed: boolean;
  vertexConfirmed: boolean;
  ttsConfirmed: boolean;
  parallelSkipped: boolean;
  lastError: string | null;
}

export const SETUP_STORAGE_KEY = "slate:google-setup-progress";

export function defaultSetupState(): GoogleSetupState {
  return {
    step: "mode",
    mode: "standard",
    projectId: "",
    location: "us-central1",
    billingConfirmed: false,
    vertexConfirmed: false,
    ttsConfirmed: false,
    parallelSkipped: false,
    lastError: null,
  };
}

export function loadSetupState(): GoogleSetupState {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return defaultSetupState();
  }
  try {
    const raw = window.sessionStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return defaultSetupState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultSetupState();
    return {
      step: [
        "mode",
        "project",
        "billing",
        "apis",
        "credentials",
        "parallel",
        "complete",
      ].includes(parsed.step)
        ? parsed.step
        : "mode",
      mode: parsed.mode === "express" ? "express" : "standard",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      location:
        typeof parsed.location === "string" ? parsed.location : "us-central1",
      billingConfirmed: Boolean(parsed.billingConfirmed),
      vertexConfirmed: Boolean(parsed.vertexConfirmed),
      ttsConfirmed: Boolean(parsed.ttsConfirmed),
      parallelSkipped: Boolean(parsed.parallelSkipped),
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    };
  } catch {
    return defaultSetupState();
  }
}

export function saveSetupState(state: GoogleSetupState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session storage is optional
  }
}

export function clearSetupState(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(SETUP_STORAGE_KEY);
  } catch {
    // Session storage is optional
  }
}

export type ConnectionErrorCategory =
  | "billing"
  | "permission"
  | "api_disabled"
  | "token_expired"
  | "network"
  | "unknown";

export function classifyConnectionError(error: unknown): {
  category: ConnectionErrorCategory;
  message: string;
  guidance: string;
} {
  const rawMessage =
    error instanceof Error ? error.message : String(error || "");
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("billing") ||
    lower.includes("payment") ||
    lower.includes("billing account")
  ) {
    return {
      category: "billing",
      message: rawMessage,
      guidance:
        "Google Cloud requires an active billing account linked to this project. Open the Google Cloud Console to link your billing account.",
    };
  }

  if (
    lower.includes("403") ||
    lower.includes("permission_denied") ||
    lower.includes("unauthorized") ||
    lower.includes("denied")
  ) {
    return {
      category: "permission",
      message: rawMessage,
      guidance:
        "Your Google account does not have sufficient permissions on this Cloud project. Verify that you are the Project Owner or have Vertex AI User permissions.",
    };
  }

  if (
    lower.includes("api has not been used") ||
    lower.includes("not enabled") ||
    lower.includes("disabled") ||
    lower.includes("serviceusage")
  ) {
    return {
      category: "api_disabled",
      message: rawMessage,
      guidance:
        "A required Google Cloud API is disabled. Open the Cloud Console and enable the Vertex AI API (aiplatform.googleapis.com).",
    };
  }

  if (lower.includes("token expired") || lower.includes("token_expired")) {
    return {
      category: "token_expired",
      message: rawMessage,
      guidance:
        "Your Google OAuth access token has expired. Obtain a fresh access token using gcloud auth print-access-token and renew your connection.",
    };
  }

  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("unavailable")
  ) {
    return {
      category: "network",
      message: rawMessage,
      guidance:
        "Network connection interrupted. Check your internet connection and verify that Google APIs are reachable.",
    };
  }

  return {
    category: "unknown",
    message: rawMessage,
    guidance:
      "Connection failed. Please check your credentials and project settings.",
  };
}
