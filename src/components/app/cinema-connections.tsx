import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  cinemaRequest,
  getCinemaConnections,
  getCinemaHealth,
  testConnection,
  type CinemaConnection,
  type CinemaHealth,
  type ConnectionTestResponse,
} from "@/lib/cinema-client";
import {
  classifyConnectionError,
  clearSetupState,
  loadSetupState,
  saveSetupState,
  type GoogleSetupState,
  type GoogleSetupStep,
} from "@/lib/cinema-onboarding";

export function ConnectionsControl() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Connections and models"
        onClick={() => setOpen(true)}
      >
        <KeyRound />
        <span className="hidden sm:inline">Connections</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Connections & models</DialogTitle>
            <DialogDescription>
              Explore and edit without a key. Connect your own accounts when you want to generate or
              research.
            </DialogDescription>
          </DialogHeader>
          {open && <ConnectionsPanel />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function connectionName(connection: CinemaConnection) {
  if (connection.provider === "parallel") return "Parallel Search";
  return connection.mode === "standard"
    ? `Google Cloud · ${connection.projectId ?? "project"}`
    : "Google Cloud Express";
}

function expiryDescription(expiresAt: number) {
  const minutes = Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 60_000));
  const remaining =
    minutes >= 24 * 60
      ? `${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
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
  compact = false,
}: {
  connection: CinemaConnection;
  probe?: { busy: boolean; result?: ConnectionTestResponse; error?: string };
  onTest: (connection: CinemaConnection) => void;
  onRenew: (connection: CinemaConnection) => void;
  onDisconnect: (connection: CinemaConnection) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const result = probe?.result;
  const verified = result && result.results.every((r) => r.status === "verified");
  const firstFailure = result?.results.find((r) => r.status === "failed");
  const statusText = verified
    ? "Access verified"
    : firstFailure
      ? `${firstFailure.tool} ${firstFailure.code}`
      : "Access untested";

  return (
    <div
      className={`flex items-start justify-between gap-3 border-b border-border py-2 ${
        compact ? "text-xs" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={compact ? "font-medium" : "text-sm"}>{connectionName(connection)}</p>
        <p className="text-xs text-muted-foreground">
          {probe?.busy ? "Testing access…" : statusText} · {expiryDescription(connection.expiresAt)}
        </p>
        {result && !probe?.busy && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.results.map((item) => (
              <span
                key={item.tool}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  item.status === "verified"
                    ? "bg-primary/10 text-primary"
                    : "bg-destructive/10 text-destructive"
                }`}
                title={item.message}
              >
                {item.tool}: {item.status}
                {item.status === "failed" && item.code && (
                  <span className="opacity-80">({item.code})</span>
                )}
              </span>
            ))}
          </div>
        )}
        {probe?.error && !probe?.busy && (
          <p className="mt-1 text-[10px] text-destructive">{probe.error}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Test ${connectionName(connection)}`}
          disabled={disabled || probe?.busy}
          onClick={() => onTest(connection)}
        >
          {probe?.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Test
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Renew ${connectionName(connection)}`}
          disabled={disabled}
          onClick={() => onRenew(connection)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Renew
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onDisconnect(connection)}
        >
          <Unplug className="h-3.5 w-3.5" />
          Disconnect
        </Button>
      </div>
    </div>
  );
}

export function ConnectionsPanel() {
  const [tab, setTab] = useState<"guided" | "direct">("guided");
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [health, setHealth] = useState<CinemaHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Guided setup state
  const [setupState, setSetupState] = useState<GoogleSetupState>(() => loadSetupState());

  // Direct connection form state
  const [provider, setProvider] = useState<CinemaConnection["provider"]>("google-cloud");
  const [mode, setMode] = useState<"express" | "standard">("express");
  const [projectId, setProjectId] = useState("");
  const [expiresMinutes, setExpiresMinutes] = useState(60);
  const [key, setKey] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showRefreshableFields, setShowRefreshableFields] = useState(false);
  const [renewing, setRenewing] = useState<CinemaConnection | null>(null);
  const [probeById, setProbeById] = useState<
    Record<string, { busy: boolean; result?: ConnectionTestResponse; error?: string }>
  >({});
  const credentialInput = useRef<HTMLInputElement>(null);

  // Error diagnostics
  const [classifiedError, setClassifiedError] = useState<{
    category: string;
    message: string;
    guidance: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getCinemaConnections(), getCinemaHealth()])
      .then(([items, info]) => {
        if (active) {
          setConnections(items);
          setHealth(info);
          if (items.length > 0 && setupState.step === "mode") {
            setTab("direct");
          }
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateSetup = (patch: Partial<GoogleSetupState>) => {
    setSetupState((prev) => {
      const updated = { ...prev, ...patch };
      saveSetupState(updated);
      return updated;
    });
  };

  const resetSetup = () => {
    clearSetupState();
    const fresh = loadSetupState();
    setSetupState(fresh);
    setClassifiedError(null);
    setMessage("");
  };

  const connectCredential = async (params: {
    provider: CinemaConnection["provider"];
    mode?: "express" | "standard";
    key: string;
    projectId?: string;
    expiresMinutes?: number;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    renewal?: CinemaConnection | null;
  }) => {
    setBusy(true);
    setMessage("");
    setClassifiedError(null);
    try {
      const renewal = params.renewal;
      const credential =
        params.provider === "google-cloud" && params.mode === "standard"
          ? {
              mode: params.mode,
              accessToken: params.key.trim(),
              projectId: params.projectId?.trim() ?? "",
              location: renewal?.location ?? setupState.location ?? "us-central1",
              expiresAt: Math.floor(Date.now() / 1000) + (params.expiresMinutes ?? 60) * 60,
              ...(params.refreshToken?.trim() ? { refreshToken: params.refreshToken.trim() } : {}),
              ...(params.clientId?.trim() ? { clientId: params.clientId.trim() } : {}),
              ...(params.clientSecret?.trim() ? { clientSecret: params.clientSecret.trim() } : {}),
            }
          : {
              apiKey: params.key.trim(),
              ...(params.provider === "google-cloud" ? { mode: params.mode } : {}),
              ...(renewal?.projectId === undefined ? {} : { projectId: renewal.projectId }),
              ...(renewal?.location === undefined ? {} : { location: renewal.location }),
            };

      await cinemaRequest(
        renewal ? `/connections/${encodeURIComponent(renewal.connectionId)}` : "/connections",
        {
          method: renewal ? "PUT" : "POST",
          body: JSON.stringify({ provider: params.provider, ...credential }),
        },
      );

      const updated = await getCinemaConnections();
      setConnections(updated);
      setRenewing(null);
      setMessage(
        renewal
          ? "Connection renewed for this session."
          : "Connection saved for this session. Model access has not been tested; connecting makes no paid model call.",
      );
      return true;
    } catch (error) {
      const classified = classifyConnectionError(error);
      setClassifiedError(classified);
      setMessage(error instanceof Error ? error.message : "Connection failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const directConnect = async () => {
    if (!key.trim()) return;
    const ok = await connectCredential({
      provider,
      mode,
      key,
      projectId,
      expiresMinutes,
      refreshToken,
      clientId,
      clientSecret,
      renewal: renewing,
    });
    if (ok) {
      setKey("");
      setRefreshToken("");
      setClientId("");
      setClientSecret("");
    }
  };

  const beginRenewal = (connection: CinemaConnection) => {
    setRenewing(connection);
    setProvider(connection.provider);
    setMode(connection.mode ?? "express");
    setProjectId(connection.projectId ?? "");
    setExpiresMinutes(60);
    setKey("");
    setMessage("");
    setClassifiedError(null);
    setTab("direct");
    requestAnimationFrame(() => credentialInput.current?.focus());
  };

  const cancelRenewal = () => {
    setRenewing(null);
    setKey("");
    setMessage("");
    setClassifiedError(null);
  };

  const disconnect = async (id: string) => {
    setBusy(true);
    try {
      await cinemaRequest(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
      setConnections(await getCinemaConnections());
      setMessage("Disconnected. Already submitted provider jobs may still finish.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (connection: CinemaConnection) => {
    setProbeById((prev) => ({ ...prev, [connection.connectionId]: { busy: true } }));
    try {
      const result = await testConnection(connection.connectionId);
      setProbeById((prev) => ({
        ...prev,
        [connection.connectionId]: { busy: false, result },
      }));
    } catch (error) {
      setProbeById((prev) => ({
        ...prev,
        [connection.connectionId]: {
          busy: false,
          error: error instanceof Error ? error.message : "Test failed.",
        },
      }));
    }
  };

  const guidedSteps: { id: GoogleSetupStep; label: string }[] = [
    { id: "mode", label: "1. Mode" },
    ...(setupState.mode === "standard"
      ? [
          { id: "project" as GoogleSetupStep, label: "2. Project" },
          { id: "billing" as GoogleSetupStep, label: "3. Billing" },
          { id: "apis" as GoogleSetupStep, label: "4. APIs" },
        ]
      : []),
    { id: "credentials", label: setupState.mode === "standard" ? "5. Credentials" : "2. Credentials" },
    { id: "parallel", label: setupState.mode === "standard" ? "6. Research" : "3. Research" },
    { id: "complete", label: setupState.mode === "standard" ? "7. Done" : "4. Done" },
  ];

  return (
    <div className="grid gap-5">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "guided"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => {
            setTab("guided");
            setClassifiedError(null);
          }}
        >
          Guided Setup
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "direct"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => {
            setTab("direct");
            setClassifiedError(null);
          }}
        >
          Direct Connection
        </button>
      </div>

      {/* Guided Setup View */}
      {tab === "guided" && (
        <div className="grid gap-4">
          {/* Wizard step progress */}
          <div className="flex flex-wrap gap-1 border-b border-border pb-3 text-xs">
            {guidedSteps.map((step) => {
              const isCurrent = setupState.step === step.id;
              return (
                <span
                  key={step.id}
                  className={`rounded px-2 py-0.5 font-medium ${
                    isCurrent
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
          </div>

          {/* Step 1: Mode Selection */}
          {setupState.step === "mode" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">Choose your Google Cloud connection mode</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Select the connection mode that matches your production needs and Google Cloud setup.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                    setupState.mode === "standard"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                  onClick={() => updateSetup({ mode: "standard" })}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Standard OAuth (Recommended)</span>
                    {setupState.mode === "standard" && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    Full production access: Script (Gemini), Preflight analysis, Images (Imagen 3), Video (Veo 2/3), and Music / Voice. Requires a billed Cloud project with Vertex AI.
                  </p>
                </div>
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                    setupState.mode === "express"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                  onClick={() => updateSetup({ mode: "express" })}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Express API Key</span>
                    {setupState.mode === "express" && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    Quick setup for lightweight tasks: Script, Preflight analysis, and Images. Video generation and Music are not available with an API key.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() =>
                    updateSetup({
                      step: setupState.mode === "standard" ? "project" : "credentials",
                    })
                  }
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Project (Standard only) */}
          {setupState.step === "project" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">Step 2: Google Cloud Project</h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Vertex AI models are accessed under a specific Google Cloud project.
                </p>
              </div>
              <div className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                <p>
                  If you do not have a Cloud project yet, create one in the console:
                </p>
                <a
                  href="https://console.cloud.google.com/projectcreate"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary underline"
                >
                  Open Google Cloud Console: Create Project <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <label className="grid gap-1.5 text-sm">
                Google Cloud Project ID
                <Input
                  value={setupState.projectId}
                  onChange={(event) => updateSetup({ projectId: event.target.value.trim() })}
                  placeholder="e.g. my-filmmaking-project"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateSetup({ step: "mode" })}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  size="sm"
                  disabled={!setupState.projectId.trim()}
                  onClick={() => updateSetup({ step: "billing" })}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Billing (Standard only) */}
          {setupState.step === "billing" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">Step 3: Cloud Billing</h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Vertex AI and Cloud Text-to-Speech require an active billing account linked to your project. Google Cloud offers free trial credits for new accounts.
                </p>
              </div>
              <div className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                <p>Verify or link billing in the Google Cloud Console:</p>
                <a
                  href={`https://console.cloud.google.com/billing/linkedaccount?project=${encodeURIComponent(
                    setupState.projectId || "",
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary underline"
                >
                  Open Google Cloud Billing <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={setupState.billingConfirmed}
                  onChange={(e) => updateSetup({ billingConfirmed: e.target.checked })}
                />
                <span>
                  I confirm that project <code className="font-mono text-foreground">{setupState.projectId}</code> has an active billing account linked.
                </span>
              </label>
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateSetup({ step: "project" })}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  size="sm"
                  disabled={!setupState.billingConfirmed}
                  onClick={() => updateSetup({ step: "apis" })}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Required APIs (Standard only) */}
          {setupState.step === "apis" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">Step 4: Enable Required APIs</h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Enable Vertex AI (for Gemini, Imagen, and Veo) and Cloud Text-to-Speech (for audio scratch tracks).
                </p>
              </div>
              <div className="grid gap-3">
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">1. Vertex AI API</span>
                    <a
                      href={`https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=${encodeURIComponent(
                        setupState.projectId || "",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary underline"
                    >
                      Enable in Console <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs cursor-pointer text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={setupState.vertexConfirmed}
                      onChange={(e) => updateSetup({ vertexConfirmed: e.target.checked })}
                    />
                    <span>Vertex AI API is enabled</span>
                  </label>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">2. Cloud Text-to-Speech API</span>
                    <a
                      href={`https://console.cloud.google.com/apis/library/texttospeech.googleapis.com?project=${encodeURIComponent(
                        setupState.projectId || "",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary underline"
                    >
                      Enable in Console <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs cursor-pointer text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={setupState.ttsConfirmed}
                      onChange={(e) => updateSetup({ ttsConfirmed: e.target.checked })}
                    />
                    <span>Text-to-Speech API is enabled</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateSetup({ step: "billing" })}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  size="sm"
                  disabled={!setupState.vertexConfirmed || !setupState.ttsConfirmed}
                  onClick={() => updateSetup({ step: "credentials" })}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Credentials */}
          {setupState.step === "credentials" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">
                  {setupState.mode === "standard"
                    ? "Step 5: Connect Google Cloud Credentials"
                    : "Step 2: Connect Express API Key"}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {setupState.mode === "standard"
                    ? "Generate an OAuth access token using the Google Cloud CLI, or enter your token below."
                    : "Obtain an API key from Google Cloud Console credentials."}
                </p>
              </div>

              {setupState.mode === "standard" ? (
                <>
                  <div className="rounded-md bg-secondary/50 p-3 text-xs leading-relaxed font-mono">
                    <p className="text-muted-foreground font-sans mb-1">Generate a fresh token via terminal:</p>
                    <p className="select-all">gcloud auth print-access-token</p>
                  </div>
                  <label className="grid gap-1.5 text-sm">
                    OAuth Access Token
                    <Input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="ya29.a0..."
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </label>
                  <div className="grid gap-1.5 text-xs text-muted-foreground">
                    <p>Token validity: up to 60 minutes.</p>
                  </div>
                  {/* Optional Refreshable Auth */}
                  <div className="rounded-md border border-border p-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-xs font-medium text-foreground text-left"
                      onClick={() => setShowRefreshableFields(!showRefreshableFields)}
                    >
                      <span>Auto-refresh credentials (optional)</span>
                      <span className="text-xs text-muted-foreground">
                        {showRefreshableFields ? "Hide" : "Show"}
                      </span>
                    </button>
                    {showRefreshableFields && (
                      <div className="mt-3 grid gap-2.5 pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground">
                          Provide an OAuth refresh token and client credentials so ReelBinder can automatically refresh your token during long sessions without manual re-entry.
                        </p>
                        <label className="grid gap-1 text-xs">
                          Refresh Token
                          <Input
                            type="password"
                            value={refreshToken}
                            onChange={(e) => setRefreshToken(e.target.value)}
                            placeholder="1//0..."
                            autoComplete="off"
                            spellCheck={false}
                            disabled={busy}
                          />
                        </label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-xs">
                            Client ID
                            <Input
                              value={clientId}
                              onChange={(e) => setClientId(e.target.value)}
                              placeholder="...apps.googleusercontent.com"
                              autoComplete="off"
                              spellCheck={false}
                              disabled={busy}
                            />
                          </label>
                          <label className="grid gap-1 text-xs">
                            Client Secret
                            <Input
                              type="password"
                              value={clientSecret}
                              onChange={(e) => setClientSecret(e.target.value)}
                              placeholder="GOCSPX-..."
                              autoComplete="off"
                              spellCheck={false}
                              disabled={busy}
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                    <p>Obtain an API key from Google Cloud Console:</p>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary underline"
                    >
                      Open Google Cloud Credentials <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <label className="grid gap-1.5 text-sm">
                    Google Cloud Express API Key
                    <Input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="AIzaSy..."
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </label>
                </>
              )}

              {/* Error banner with diagnosis */}
              {classifiedError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    <span>Connection Error ({classifiedError.category})</span>
                  </div>
                  <p className="mt-1 text-foreground/80">{classifiedError.guidance}</p>
                  <p className="mt-2 text-muted-foreground font-mono break-all">
                    {classifiedError.message}
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateSetup({
                      step: setupState.mode === "standard" ? "apis" : "mode",
                    })
                  }
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !key.trim()}
                  onClick={async () => {
                    const ok = await connectCredential({
                      provider: "google-cloud",
                      mode: setupState.mode,
                      key,
                      projectId: setupState.projectId,
                      expiresMinutes: 60,
                      refreshToken,
                      clientId,
                      clientSecret,
                    });
                    if (ok) {
                      setKey("");
                      setRefreshToken("");
                      setClientId("");
                      setClientSecret("");
                      updateSetup({ step: "parallel" });
                    }
                  }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Connect Google Cloud
                </Button>
              </div>
            </div>
          )}

          {/* Step 6: Parallel (Optional) */}
          {setupState.step === "parallel" && (
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-semibold">
                  {setupState.mode === "standard" ? "Step 6" : "Step 3"}: Connect Parallel Search (Optional)
                </h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Parallel Search provides cited web and reference research for Preflight scene analysis and pitch decks.
                </p>
              </div>
              <div className="rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                <p>Parallel uses a dedicated research API key:</p>
                <a
                  href="https://platform.parallel.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary underline"
                >
                  Open Parallel AI Platform <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <label className="grid gap-1.5 text-sm">
                Parallel API Key (Optional)
                <Input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="par_..."
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>

              {classifiedError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    <span>Parallel Connection Error</span>
                  </div>
                  <p className="mt-1 text-muted-foreground font-mono break-all">
                    {classifiedError.message}
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    updateSetup({ parallelSkipped: true, step: "complete" });
                    setKey("");
                  }}
                >
                  Skip for now
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !key.trim()}
                  onClick={async () => {
                    const ok = await connectCredential({
                      provider: "parallel",
                      key,
                    });
                    if (ok) {
                      setKey("");
                      updateSetup({ step: "complete" });
                    }
                  }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Connect Parallel
                </Button>
              </div>
            </div>
          )}

          {/* Step 7: Complete */}
          {setupState.step === "complete" && (
            <div className="grid gap-4">
              <div className="rounded-md border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-center gap-2 text-primary font-medium">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Setup Complete</span>
                </div>
                <p className="mt-1 text-xs text-foreground/80 leading-relaxed">
                  Your credentials are connected for this browser session. ReelBinder never saves credentials to disk or scripts.
                </p>
              </div>

              {/* Connected Accounts summary */}
              <div className="grid gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Connected Accounts
                </h4>
                {connections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active connections found.</p>
                ) : (
                  connections.map((conn) => (
                    <ConnectionRow
                      key={conn.connectionId}
                      connection={conn}
                      probe={probeById[conn.connectionId]}
                      onTest={runTest}
                      onRenew={beginRenewal}
                      onDisconnect={(c) => void disconnect(c.connectionId)}
                      disabled={busy}
                      compact
                    />
                  ))
                )}
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetSetup}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset Setup Wizard
                </Button>
                <Button
                  size="sm"
                  onClick={() => setTab("direct")}
                >
                  Manage Connections
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Direct Connection View */}
      {tab === "direct" && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void directConnect();
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Account
            <select
              className="h-10 rounded-md border border-border bg-secondary px-3"
              value={provider === "parallel" ? "parallel" : mode}
              onChange={(event) => {
                const value = event.target.value;
                setProvider(value === "parallel" ? "parallel" : "google-cloud");
                if (value !== "parallel") setMode(value as "express" | "standard");
                setKey("");
                setClassifiedError(null);
              }}
              disabled={busy || !!renewing}
            >
              <option value="express">Google Cloud Express · API key</option>
              <option value="standard">Google Cloud project · access token</option>
              <option value="parallel">Parallel Search</option>
            </select>
          </label>
          <div className="grid gap-1 text-xs leading-relaxed text-muted-foreground">
            {provider === "google-cloud" ? (
              mode === "standard" ? (
                <>
                  <p>
                    <span className="font-medium text-foreground">What you need:</span> your Cloud
                    project ID and a fresh OAuth access token.
                  </p>
                  <p>
                    Use a billed Cloud project with Vertex AI enabled. Video and music require this
                    connection.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Where to get it:</span>{" "}
                    <a
                      className="underline"
                      href="https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read access-token setup
                    </a>{" "}
                    ·{" "}
                    <a
                      className="underline"
                      href="https://console.cloud.google.com/apis/library/aiplatform.googleapis.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Enable Vertex AI
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <span className="font-medium text-foreground">What you need:</span> a Google Cloud
                    Express API key.
                  </p>
                  <p>
                    Use it for script, Preflight and images. AI Studio keys are not supported by this
                    connection.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Where to get it:</span>{" "}
                    <a
                      className="underline"
                      href="https://cloud.google.com/docs/authentication/api-keys"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read API key setup
                    </a>{" "}
                    ·{" "}
                    <a
                      className="underline"
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Google Cloud credentials
                    </a>
                  </p>
                </>
              )
            ) : (
              <>
                <p>
                  <span className="font-medium text-foreground">What you need:</span> a Parallel API
                  key.
                </p>
                <p>
                  Parallel supplies cited research to Preflight. Research calls use your Parallel
                  account.
                </p>
                <p>
                  <span className="font-medium text-foreground">Where to get it:</span>{" "}
                  <a
                    className="underline"
                    href="https://docs.parallel.ai/search/search-quickstart"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read Parallel quickstart
                  </a>{" "}
                  ·{" "}
                  <a
                    className="underline"
                    href="https://platform.parallel.ai/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Parallel platform
                  </a>
                </p>
              </>
            )}
          </div>
          {provider === "google-cloud" && mode === "standard" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                Cloud project ID
                <Input
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy || !!renewing}
                  placeholder="your-project-id"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                Token time remaining (minutes)
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={expiresMinutes}
                  onChange={(event) => setExpiresMinutes(Number(event.target.value))}
                  disabled={busy}
                />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Gemini and image tools use their configured Cloud endpoint; video and music use
                us-central1.
              </p>
            </div>
          )}
          {renewing && (
            <div className="grid gap-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p>Renewing {connectionName(renewing)}.</p>
              <p>
                Enter a replacement {mode === "standard" ? "access token" : "key"}. ReelBinder never
                reveals the saved key.
              </p>
            </div>
          )}
          <label className="grid gap-1.5 text-sm">
            {provider === "google-cloud" && mode === "standard" ? "Access token" : "API key"}
            <Input
              ref={credentialInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={busy}
            />
          </label>

          {/* Optional Refreshable Auth for Standard Direct */}
          {provider === "google-cloud" && mode === "standard" && (
            <div className="rounded-md border border-border p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-xs font-medium text-foreground text-left"
                onClick={() => setShowRefreshableFields(!showRefreshableFields)}
              >
                <span>Auto-refresh credentials (optional)</span>
                <span className="text-xs text-muted-foreground">
                  {showRefreshableFields ? "Hide" : "Show"}
                </span>
              </button>
              {showRefreshableFields && (
                <div className="mt-3 grid gap-2.5 pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Provide an OAuth refresh token and client credentials so ReelBinder can automatically refresh your token during long sessions.
                  </p>
                  <label className="grid gap-1 text-xs">
                    Refresh Token
                    <Input
                      type="password"
                      value={refreshToken}
                      onChange={(e) => setRefreshToken(e.target.value)}
                      placeholder="1//0..."
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs">
                      Client ID
                      <Input
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="...apps.googleusercontent.com"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Client Secret
                      <Input
                        type="password"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="GOCSPX-..."
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {classifiedError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4" />
                <span>Connection Error ({classifiedError.category})</span>
              </div>
              <p className="mt-1 text-foreground/80">{classifiedError.guidance}</p>
              <p className="mt-2 text-muted-foreground font-mono break-all">
                {classifiedError.message}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                busy ||
                !key.trim() ||
                (provider === "google-cloud" &&
                  mode === "standard" &&
                  (!projectId.trim() ||
                    !Number.isInteger(expiresMinutes) ||
                    expiresMinutes < 1 ||
                    expiresMinutes > 60))
              }
            >
              {busy && <Loader2 className="animate-spin" />}
              {renewing ? "Renew connection" : "Save session connection"}
            </Button>
            {renewing && (
              <Button type="button" variant="ghost" disabled={busy} onClick={cancelRenewal}>
                Cancel renewal
              </Button>
            )}
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <p>
              Google Cloud Express keys stay connected for up to one day by default; this visitor
              session or operator policy can shorten that.
            </p>
            <p>
              Google Cloud OAuth access tokens expire at the submitted token time and never stay
              connected longer than one hour (unless configured with refresh credentials).
            </p>
            <p>Parallel connections stay connected for at most one hour.</p>
            <p>
              Credentials stay out of scripts and exports. Generation and research use your account
              and may incur charges.
            </p>
          </div>
        </form>
      )}

      {message && !classifiedError && (
        <p className="rounded-md border border-border p-3 text-sm" role="status">
          {message}
        </p>
      )}

      {/* Session connections list */}
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">This session</h3>
        {!connections.length && (
          <p className="text-sm text-muted-foreground">No account connected.</p>
        )}
        {connections.map((connection) => (
          <ConnectionRow
            key={connection.connectionId}
            connection={connection}
            probe={probeById[connection.connectionId]}
            onTest={runTest}
            onRenew={beginRenewal}
            onDisconnect={(c) => void disconnect(c.connectionId)}
            disabled={busy}
          />
        ))}
      </div>

      {/* Available tools list */}
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Available tools</h3>
        {health ? (
          Object.entries(health.capabilities).map(([tool, capability]) => (
            <div key={tool} className="border-t border-border py-2">
              <p className="text-sm capitalize">
                {tool}{" "}
                <span className="ml-2 text-xs text-muted-foreground">
                  {capability.status.replaceAll("_", " ")}
                </span>
              </p>
              {capability.model && (
                <p className="mt-1 break-all font-mono text-xs">{capability.model}</p>
              )}
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {capability.reason}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Tool status is unavailable until the cinema service is connected.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Configured means the tool is wired. Actual access depends on your connection, project and
          model permissions.
        </p>
      </div>
    </div>
  );
}
