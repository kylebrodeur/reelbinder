import { KeyRound, Loader2, RefreshCw, Unplug } from "lucide-react";
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
  type CinemaConnection,
  type CinemaHealth,
} from "@/lib/cinema-client";

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

export function ConnectionsPanel() {
  const [connections, setConnections] = useState<CinemaConnection[]>([]);
  const [health, setHealth] = useState<CinemaHealth | null>(null);
  const [provider, setProvider] = useState<CinemaConnection["provider"]>("google-cloud");
  const [mode, setMode] = useState<"express" | "standard">("express");
  const [projectId, setProjectId] = useState("");
  const [expiresMinutes, setExpiresMinutes] = useState(30);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [renewing, setRenewing] = useState<CinemaConnection | null>(null);
  const credentialInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([getCinemaConnections(), getCinemaHealth()])
      .then(([items, info]) => {
        if (active) {
          setConnections(items);
          setHealth(info);
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const renewal = renewing;
      const credential =
        provider === "google-cloud" && mode === "standard"
          ? {
              mode,
              accessToken: key.trim(),
              projectId: projectId.trim(),
              location: renewal?.location ?? "us-central1",
              expiresAt: Math.floor(Date.now() / 1000) + expiresMinutes * 60,
            }
          : {
              apiKey: key.trim(),
              ...(provider === "google-cloud" ? { mode } : {}),
              ...(renewal?.projectId === undefined ? {} : { projectId: renewal.projectId }),
              ...(renewal?.location === undefined ? {} : { location: renewal.location }),
            };
      await cinemaRequest(
        renewal ? `/connections/${encodeURIComponent(renewal.connectionId)}` : "/connections",
        {
          method: renewal ? "PUT" : "POST",
          body: JSON.stringify({ provider, ...credential }),
        },
      );
      setKey("");
      setConnections(await getCinemaConnections());
      setRenewing(null);
      setMessage(
        renewal
          ? "Connection renewed for this session."
          : "Connection saved for this session. Model access has not been tested; connecting makes no paid model call.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setKey("");
      setBusy(false);
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
    requestAnimationFrame(() => credentialInput.current?.focus());
  };

  const cancelRenewal = () => {
    setRenewing(null);
    setKey("");
    setMessage("");
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

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
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
              us-central1. Use a newly issued token; ReelBinder does not refresh it.
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
            connected longer than one hour.
          </p>
          <p>Parallel connections stay connected for at most one hour.</p>
          <p>
            Credentials stay out of scripts and exports. Generation and research use your account
            and may incur charges.
          </p>
        </div>
      </form>
      {message && (
        <p className="rounded-md border border-border p-3 text-sm" role="status">
          {message}
        </p>
      )}
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">This session</h3>
        {!connections.length && (
          <p className="text-sm text-muted-foreground">No account connected.</p>
        )}
        {connections.map((connection) => (
          <div
            key={connection.connectionId}
            className="flex items-center justify-between gap-3 border-b border-border py-2"
          >
            <div>
              <p className="text-sm">{connectionName(connection)}</p>
              <p className="text-xs text-muted-foreground">
                Access untested · {expiryDescription(connection.expiresAt)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Renew ${connectionName(connection)}`}
                disabled={busy}
                onClick={() => beginRenewal(connection)}
              >
                <RefreshCw />
                Renew
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void disconnect(connection.connectionId)}
              >
                <Unplug />
                Disconnect
              </Button>
            </div>
          </div>
        ))}
      </div>
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
