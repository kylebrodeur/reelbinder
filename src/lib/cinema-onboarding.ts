import { cinemaRequest } from "./cinema-client";

export type GoogleSetupStep = "mode" | "credentials" | "parallel" | "complete";

export interface GoogleSetupState {
  step: GoogleSetupStep;
  mode: "standard";
  setupPath: "operator" | "bring-your-own";
  projectId: string;
  location: string;
  lastError: string | null;
  oauthRedirectUri: string;
  renewalConnectionId: string | null;
}

export const SETUP_STORAGE_KEY = "slate:google-setup-progress";

export function defaultSetupState(): GoogleSetupState {
  return {
    step: "mode",
    mode: "standard",
    setupPath: "operator",
    projectId: "",
    location: "us-central1",
    lastError: null,
    oauthRedirectUri: "",
    renewalConnectionId: null,
  };
}

export function loadSetupState(): GoogleSetupState {
  if (typeof window === "undefined" || !window.sessionStorage) return defaultSetupState();
  try {
    const raw = window.sessionStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return defaultSetupState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const step = ["mode", "credentials", "parallel", "complete"].includes(String(parsed.step))
      ? (parsed.step as GoogleSetupStep)
      : "mode";
    return {
      step,
      mode: "standard",
      setupPath: parsed.setupPath === "bring-your-own" ? "bring-your-own" : "operator",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      location: typeof parsed.location === "string" ? parsed.location : "us-central1",
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      oauthRedirectUri: typeof parsed.oauthRedirectUri === "string" ? parsed.oauthRedirectUri : "",
      renewalConnectionId:
        typeof parsed.renewalConnectionId === "string" ? parsed.renewalConnectionId : null,
    };
  } catch {
    return defaultSetupState();
  }
}

export function parseOAuthCallback(searchParams: URLSearchParams): { code: string; state: string } | null {
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  return code && state ? { code, state } : null;
}

export function clearOAuthUrlParams(): void {
  if (typeof window === "undefined" || !window.history) return;
  const url = new URL(window.location.href);
  for (const key of ["code", "state", "scope", "authuser", "prompt"]) url.searchParams.delete(key);
  window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
}

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

export function startGoogleOAuth(redirectUri: string): Promise<{ authorizationUrl: string; state: string }> {
  return cinemaRequest<{ authorizationUrl: string; state: string }>("/oauth/start", {
    method: "POST",
    body: JSON.stringify({ redirectUri }),
  });
}

export function exchangeOAuthCode({
  code,
  state,
  redirectUri,
}: {
  code: string;
  state: string;
  redirectUri: string;
}): Promise<OAuthExchangeResult> {
  // The exchange chains several Google calls end-to-end (token swap,
  // identity, optional project preparation); it regularly exceeds 20s and
  // the server bounds it inside the gateway's 200s ceiling.
  return cinemaRequest<OAuthExchangeResult>("/oauth/exchange", {
    method: "POST",
    body: JSON.stringify({ code, state, redirectUri }),
    timeoutMs: 150_000,
  });
}

export interface GoogleSetupResult {
  project: { projectId: string; name: string };
  readiness: {
    projectId: string;
    billingEnabled: boolean | null;
    services: Record<string, boolean | null>;
  };
  location: string;
  connectionMode: "operator" | "standard";
}

export function setupGoogleOAuth(
  accessToken: string,
  setupPath: GoogleSetupState["setupPath"],
  projectId?: string,
): Promise<GoogleSetupResult> {
  return cinemaRequest<GoogleSetupResult>("/oauth/setup", {
    method: "POST",
    body: JSON.stringify({ accessToken, setupPath, ...(projectId ? { projectId } : {}) }),
  });
}

export function saveSetupState(state: GoogleSetupState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session storage is optional.
  }
}

export function clearSetupState(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(SETUP_STORAGE_KEY);
  } catch {
    // Session storage is optional.
  }
}

export type ConnectionErrorCategory = "billing" | "permission" | "api_disabled" | "token_expired" | "setup_not_configured" | "network" | "unknown";

export function classifyConnectionError(error: unknown): {
  category: ConnectionErrorCategory;
  message: string;
  guidance: string;
} {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const lower = rawMessage.toLowerCase();
  if (lower.includes("billing") || lower.includes("payment")) {
    return { category: "billing", message: rawMessage, guidance: "Google Cloud needs an active billing account. Link billing to an accessible Cloud project, then run Google setup again." };
  }
  if (lower.includes("403") || lower.includes("permission_denied") || lower.includes("unauthorized") || lower.includes("denied")) {
    return { category: "permission", message: rawMessage, guidance: "Google denied project setup. Authorize an account with permission to view billing and enable required Cloud APIs." };
  }
  if (lower.includes("api has not been used") || lower.includes("not enabled") || lower.includes("disabled") || lower.includes("serviceusage")) {
    return { category: "api_disabled", message: rawMessage, guidance: "A required Google Cloud API could not be enabled automatically. Grant service-usage permission or enable it in Cloud Console, then run setup again." };
  }
  if (lower.includes("token expired") || lower.includes("token_expired")) {
    return { category: "token_expired", message: rawMessage, guidance: "Google authorization expired. Start Google setup again; ReelBinder will renew the session connection when refresh access is available." };
  }
  if (lower.includes("oauth_not_configured") || lower.includes("setup is not configured")) {
    return { category: "setup_not_configured", message: rawMessage, guidance: "This ReelBinder service is missing its Google OAuth client configuration. The operator must set CINEMA_GOOGLE_OAUTH_CLIENT_ID and CINEMA_GOOGLE_OAUTH_CLIENT_SECRET before setup can start." };
  }
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("unavailable")) {
    return { category: "network", message: rawMessage, guidance: "Google Cloud could not be reached. Check the connection and start setup again; no generation was submitted." };
  }
  return { category: "unknown", message: rawMessage, guidance: "Google Cloud setup failed. Review the connection message and start setup again." };
}
