import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  cinemaRequest,
  clearConnectionProbe,
  getCinemaConnections,
  getCinemaHealth,
  testConnection,
  type CinemaConnection,
  type CinemaHealth,
  type ConnectionTestResponse,
} from "@/lib/cinema-client";
import {
  classifyConnectionError,
  clearOAuthUrlParams,
  clearSetupState,
  exchangeOAuthCode,
  loadSetupState,
  parseOAuthCallback,
  saveSetupState,
  setupGoogleOAuth,
  startGoogleOAuth,
  type GoogleSetupState,
} from "@/lib/cinema-onboarding";

/** Settings tabs the dialog owns. External surfaces open the setup flow via openSettingsTab. */
export type SettingsTab = "project" | "appearance" | "app";

export const SLATE_OPEN_SETTINGS_EVENT = "slate:open-settings";

/** Ask the app shell to open Settings on a specific tab, e.g. the App connection setup. */
export function openSettingsTab(tab: SettingsTab = "app"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SLATE_OPEN_SETTINGS_EVENT, { detail: { tab } }));
}

export function ConnectionsControl() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" aria-label="Connections and models" onClick={() => setOpen(true)}>
        <KeyRound />
        <span className="hidden sm:inline">Connections</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Connections & models</DialogTitle>
            <DialogDescription>
              Connect Google Cloud to generate. A personal Parallel key is optional; research without one can use managed service capacity when available.
            </DialogDescription>
          </DialogHeader>
          {open && <ConnectionsPanel />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function connectionName(connection: CinemaConnection) {
  return connection.provider === "parallel"
    ? "Parallel Search"
    : `Google Cloud · ${connection.projectId ?? "project"}`;
}

function expiryDescription(expiresAt: number) {
  const minutes = Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 60_000));
  const remaining = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  const absolute = new Date(expiresAt * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `expires ${absolute} · ${remaining} remaining`;
}

export function ConnectionRow({
  connection,
  probe,
  onTest,
  onRenew,
  onDisconnect,
  disabled,
}: {
  connection: CinemaConnection;
  probe?: { busy: boolean; result?: ConnectionTestResponse; error?: string };
  onTest: (connection: CinemaConnection) => void;
  onRenew: (connection: CinemaConnection) => void;
  onDisconnect: (connection: CinemaConnection) => void;
  disabled?: boolean;
}) {
  const result = probe?.result;
  const verified = Boolean(result && result.results.length > 0 && result.results.every((item) => item.status === "verified"));
  const firstFailure = result?.results.find((item) => item.status === "failed");
  const inconclusiveResult = result?.results.find((item) => item.status === "inconclusive");
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{connectionName(connection)}</p>
        <p className="text-xs text-muted-foreground">
          {probe?.busy
            ? "Testing access…"
            : verified
              ? "Access verified"
              : firstFailure
                ? `${firstFailure.tool} ${firstFailure.code}`
                : inconclusiveResult
                  ? "Access inconclusive"
                  : "Access untested"}{" "}
          · {expiryDescription(connection.expiresAt)}
        </p>
        {result && !probe?.busy && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.results.map((item) => (
              <span
                key={item.tool}
                title={
                  item.status === "verified" && item.code === "400"
                    ? "Reachability verified: the credential reached the model route and it answered an expected HTTP 400 probe (no generation charged)."
                    : item.message
                }
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  item.status === "verified"
                    ? "bg-primary/10 text-primary"
                    : item.status === "inconclusive"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {item.status === "verified"
                  ? `${item.tool}: verified`
                  : `${item.tool}: ${item.status} (${item.code})`}
              </span>
            ))}
          </div>
        )}
        {inconclusiveResult && !probe?.busy && (
          <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
            {inconclusiveResult.tool} model was not found at this location. Verify the model ID and location, then test again.
          </p>
        )}
        {probe?.error && !probe.busy && <p className="mt-1 text-[10px] text-destructive">{probe.error}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={disabled || probe?.busy} onClick={() => onTest(connection)}>
          {probe?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Test
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRenew(connection)}>
          <RefreshCw className="h-3.5 w-3.5" /> Renew
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDisconnect(connection)}>
          <Unplug className="h-3.5 w-3.5" /> Disconnect
        </Button>
      </div>
    </div>
  );
}

/** Friendly titles per classifier category; the raw code stays in the mono trail below. */
const CONNECTION_ERROR_TITLES: Record<string, string> = {
  billing: "Billing needs attention",
  permission: "Google declined the request",
  api_disabled: "An API isn't enabled yet",
  token_expired: "Your Google sign-in expired",
  setup_not_configured: "This connection isn't set up yet",
  network: "Connection problem",
  unknown: "Something went wrong",
};

export function ConnectionsPanel() {
  const [tab, setTab] = useState<"guided" | "direct">("guided");
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [health, setHealth] = useState<CinemaHealth | null>(null);
  const [setupState, setSetupState] = useState<GoogleSetupState>(() => loadSetupState());
  const [parallelKey, setParallelKey] = useState("");
  const [renewing, setRenewing] = useState<CinemaConnection | null>(null);
  const [probeById, setProbeById] = useState<Record<string, { busy: boolean; result?: ConnectionTestResponse; error?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [classifiedError, setClassifiedError] = useState<{ category: string; message: string; guidance: string } | null>(null);

  const updateSetup = (patch: Partial<GoogleSetupState>) => {
    setSetupState((previous) => {
      const updated = { ...previous, ...patch };
      saveSetupState(updated);
      return updated;
    });
  };

  const reload = async () => {
    const [items, info] = await Promise.all([getCinemaConnections(), getCinemaHealth()]);
    setConnections(items);
    setHealth(info);
  };

  useEffect(() => {
    let active = true;
    void reload().catch((error: Error) => active && setMessage(error.message));
    return () => { active = false; };
  }, []);

  const connectGoogle = async (tokens: { accessToken: string; refreshToken?: string; expiresIn: number }, setup: { project: { projectId: string }; location: string; connectionMode: "operator" | "standard"; readiness?: { billingEnabled: boolean | null; services: Record<string, boolean | null> } }, renewal: CinemaConnection | null) => {
    await cinemaRequest(renewal ? `/connections/${encodeURIComponent(renewal.connectionId)}` : "/connections", {
      method: renewal ? "PUT" : "POST",
      body: JSON.stringify({
        provider: "google-cloud",
        mode: setup.connectionMode,
        accessToken: tokens.accessToken,
        ...(setup.connectionMode === "standard" ? { refreshToken: tokens.refreshToken } : {}),
        projectId: setup.project.projectId,
        location: setup.location,
        expiresAt: Math.floor(Date.now() / 1000) + Math.max(60, tokens.expiresIn),
      }),
    });
    await reload();
    if (renewal) clearConnectionProbe(renewal.connectionId);
    setRenewing(null);
    updateSetup({ step: "parallel", projectId: setup.project.projectId, location: setup.location, renewalConnectionId: null, lastError: null });
    const checksAvailable = setup.readiness?.billingEnabled !== null && Object.values(setup.readiness?.services ?? {}).every((enabled) => enabled !== null);
    const detail = setup.connectionMode === "operator"
      ? "Included monthly credits are enforced for this visitor."
      : checksAvailable
        ? "Billing and required APIs were checked automatically."
        : "Automatic billing and API checks were unavailable for this account.";
    setMessage(`Google Cloud connected to ${setup.project.projectId}. ${detail} Run the no-cost connection test to verify model access.`);
  };

  const beginGoogleOAuth = async (renewal: CinemaConnection | null = renewing, setupPath: GoogleSetupState["setupPath"] = "operator") => {
    setBusy(true);
    setMessage("Opening Google authorization…");
    setClassifiedError(null);
    try {
      // Keep one stable production redirect URI registered on the Google Web client.
      const redirectUri = window.location.origin;
      updateSetup({ step: "credentials", setupPath, oauthRedirectUri: redirectUri, renewalConnectionId: renewal?.connectionId ?? null });
      const result = await startGoogleOAuth(redirectUri);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      const classified = classifyConnectionError(error);
      setClassifiedError(classified);
      setMessage(classified.message);
      setBusy(false);
    }
  };

  useEffect(() => {
    const callback = typeof window === "undefined" ? null : parseOAuthCallback(new URLSearchParams(window.location.search));
    if (!callback) return;
    clearOAuthUrlParams();
    const saved = loadSetupState();
    setTab("guided");
    setBusy(true);
    setMessage(saved.setupPath === "operator" ? "Completing Google authorization for included credits…" : "Completing Google authorization and preparing your Cloud project…");
    void exchangeOAuthCode({ code: callback.code, state: callback.state, redirectUri: saved.oauthRedirectUri })
      .then(async (tokens) => {
        const setup = await setupGoogleOAuth(tokens.accessToken, saved.setupPath, saved.projectId || undefined);
        const currentConnections = await getCinemaConnections();
        const renewal = currentConnections.find((item) => item.connectionId === saved.renewalConnectionId) ?? null;
        await connectGoogle(tokens, setup, renewal);
      })
      .catch((error: unknown) => {
        const classified = classifyConnectionError(error);
        setClassifiedError(classified);
        setMessage(classified.message);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ renewalConnectionId?: string }>).detail;
      const renewal = connections.find((item) => item.connectionId === detail?.renewalConnectionId) ?? null;
      void beginGoogleOAuth(renewal, renewal?.mode === "standard" ? "bring-your-own" : "operator");
    };
    window.addEventListener("slate:start-google-connection", handler);
    return () => window.removeEventListener("slate:start-google-connection", handler);
  }, [connections]);

  const connectParallel = async () => {
    if (!parallelKey.trim()) return;
    setBusy(true);
    setClassifiedError(null);
    try {
      await cinemaRequest("/connections", { method: "POST", body: JSON.stringify({ provider: "parallel", apiKey: parallelKey.trim() }) });
      setParallelKey("");
      await reload();
      updateSetup({ step: "complete" });
      setMessage("Parallel Search connected for this session.");
    } catch (error) {
      const classified = classifyConnectionError(error);
      setClassifiedError(classified);
      setMessage(classified.message);
    } finally { setBusy(false); }
  };

  const runTest = async (connection: CinemaConnection) => {
    setProbeById((previous) => ({ ...previous, [connection.connectionId]: { busy: true } }));
    try {
      const result = await testConnection(connection.connectionId);
      setProbeById((previous) => ({ ...previous, [connection.connectionId]: { busy: false, result } }));
    } catch (error) {
      setProbeById((previous) => ({ ...previous, [connection.connectionId]: { busy: false, error: error instanceof Error ? error.message : "Test failed." } }));
    }
  };

  const disconnect = async (connection: CinemaConnection) => {
    setBusy(true);
    try {
      await cinemaRequest(`/connections/${encodeURIComponent(connection.connectionId)}`, { method: "DELETE" });
      clearConnectionProbe(connection.connectionId);
      await reload();
      setMessage(`${connectionName(connection)} disconnected.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Disconnect failed."); }
    finally { setBusy(false); }
  };

  const resetSetup = () => {
    clearSetupState();
    setSetupState(loadSetupState());
    setRenewing(null);
    setClassifiedError(null);
    setMessage("");
  };

  return (
    <div className="grid gap-5">
      <div className="flex border-b border-border">
        <button type="button" className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "guided" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => setTab("guided")}>Guided Setup</button>
        <button type="button" className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "direct" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => setTab("direct")}>Direct Connection</button>
      </div>

      {tab === "guided" && (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-1 border-b border-border pb-3 text-xs">
            {["1. Sign in", "2. Connect", "3. Research", "4. Done"].map((step) => <span key={step} className="rounded px-2 py-0.5 font-medium text-muted-foreground">{step}</span>)}
          </div>
          {setupState.step === "mode" && (
            <div className="grid gap-4">
              <div><h4 className="text-sm font-semibold">Use included monthly credits</h4><p className="mt-1 text-xs text-muted-foreground leading-relaxed">Sign in with your Google account to get your included monthly credits. Everything runs on ReelBinder's own Cloud project — nothing of yours is touched.</p></div>
              <div className="rounded-lg border border-primary bg-primary/5 p-4"><div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-primary" /> Just sign in</div><p className="mt-1.5 text-xs text-muted-foreground">No API key and no Cloud setup needed.</p></div>
              <div className="flex flex-wrap justify-end gap-2"><Button size="sm" disabled={busy} onClick={() => void beginGoogleOAuth(null, "bring-your-own")} variant="outline">Use your own Cloud project</Button><Button size="sm" disabled={busy} onClick={() => void beginGoogleOAuth(null, "operator")}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Sign in</Button></div>
            </div>
          )}
          {setupState.step === "credentials" && (
            <div className="grid gap-4">
              <div><h4 className="text-sm font-semibold">Sign in with Google</h4><p className="mt-1 text-xs text-muted-foreground">Finish the Google sign-in window to connect. Your regular Google login and 2-step verification stay under your control.</p></div>
              <Button size="sm" disabled={busy} onClick={() => void beginGoogleOAuth(renewing, setupState.setupPath)}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Sign in with Google</Button>
            </div>
          )}
          {setupState.step === "parallel" && (
            <div className="grid gap-4">
              <div><h4 className="text-sm font-semibold">Your Parallel Search key (optional)</h4><p className="mt-1 text-xs text-muted-foreground">Add it to use your own account for research with cited sources. Without one, research uses the included credits when available.</p></div>
              <Input type="password" value={parallelKey} onChange={(event) => setParallelKey(event.target.value)} placeholder="Parallel API key" autoComplete="off" disabled={busy} />
              <div className="flex justify-between"><Button variant="ghost" size="sm" onClick={() => updateSetup({ step: "complete" })}>Continue without a key</Button><Button size="sm" disabled={busy || !parallelKey.trim()} onClick={() => void connectParallel()}>Connect Parallel</Button></div>
            </div>
          )}
          {setupState.step === "complete" && (
            <div className="grid gap-4"><div><h4 className="text-sm font-semibold">You're connected</h4><p className="mt-1 text-xs text-muted-foreground">Test the connection below, then you're ready to create.</p></div><div className="flex justify-between"><Button variant="outline" size="sm" onClick={resetSetup}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset setup</Button><Button size="sm" onClick={() => setTab("direct")}>Manage connections</Button></div></div>
          )}
        </div>
      )}

      {tab === "direct" && (
        <div className="grid gap-3">
          <div className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground"><p className="font-medium text-foreground">Google Cloud</p><p className="mt-1">Sign in with Google to connect or renew. API keys don't support the production features, so they're not offered here.</p></div>
          <Button variant="secondary" disabled={busy} onClick={() => void beginGoogleOAuth(renewing)}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{renewing ? "Renew Google sign-in" : "Sign in with Google"}</Button>
          {renewing && <Button variant="ghost" disabled={busy} onClick={() => setRenewing(null)}>Cancel renewal</Button>}
          <div className="border-t border-border pt-3"><p className="text-xs font-medium">Your Parallel Search key (optional)</p><p className="mt-1 text-[11px] text-muted-foreground">Use your own account for research. Without it, research uses the included credits when available.</p><div className="mt-2 flex gap-2"><Input type="password" value={parallelKey} onChange={(event) => setParallelKey(event.target.value)} placeholder="Parallel API key" autoComplete="off" disabled={busy} /><Button disabled={busy || !parallelKey.trim()} onClick={() => void connectParallel()}>Save</Button></div></div>
        </div>
      )}

      {classifiedError && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"><div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" /> {CONNECTION_ERROR_TITLES[classifiedError.category] ?? "Something went wrong"}</div><p className="mt-1 text-foreground/80">{classifiedError.guidance}</p><p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{classifiedError.message}</p></div>}
      {message && !classifiedError && <p className="rounded-md border border-border p-3 text-sm" role="status">{message}</p>}
      <div className="grid gap-2"><h3 className="text-sm font-medium">This session</h3>{!connections.length ? <p className="text-sm text-muted-foreground">No account connected.</p> : connections.map((connection) => <ConnectionRow key={connection.connectionId} connection={connection} probe={probeById[connection.connectionId]} onTest={runTest} onRenew={(item) => { setRenewing(item); setTab("direct"); }} onDisconnect={(item) => void disconnect(item)} disabled={busy} />)}</div>
      <div className="grid gap-2"><h3 className="text-sm font-medium">Available tools</h3>{health ? Object.entries(health.capabilities).map(([tool, capability]) => <div key={tool} className="border-t border-border py-2"><div className="flex items-center justify-between text-xs"><span className="font-medium capitalize">{tool}</span><span className={capability.status === "configured" ? "text-primary" : "text-muted-foreground"}>{capability.status}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{capability.reason}</p></div>) : <p className="text-xs text-muted-foreground">Loading capability status…</p>}</div>
    </div>
  );
}
