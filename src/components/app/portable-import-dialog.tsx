import { useState, useRef } from "react";
import { Download, FileArchive, Globe, HardDrive, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_ARCHIVE_BYTES } from "@/lib/archive-limits";
import {
  downloadArchiveImportReceipt,
  markArchiveImportApplied,
  type PreparedArchiveImportReceipt,
} from "@/lib/archive-import-receipt";
import { createProjectOpenAttempt } from "@/lib/demo-pack";
import { fetchArchiveFromUrl, pickDeviceArchiveFile, type FetchedArchiveResult } from "@/lib/portable-import";
import { isZipFile, unpackSlateWithReceipt } from "@/lib/slate-pack";
import { parseProjectJson } from "@/lib/slate-snapshot";
import { isSlateText } from "@/lib/slate-md";
import { isFountainText } from "@/lib/fountain";
import { applyLiningSidecar } from "@/lib/lining-sidecar";
import { useSlate } from "@/lib/store";
import type { Project } from "@/lib/types";

export interface PortableImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PortableImportDialog({ open, onOpenChange }: PortableImportDialogProps) {
  const [tab, setTab] = useState<"device" | "link">("device");
  const [url, setUrl] = useState("");
  const [expectedSha256, setExpectedSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [unverifiedResult, setUnverifiedResult] = useState<FetchedArchiveResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAttempt = useRef<ReturnType<typeof createProjectOpenAttempt> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetState = () => {
    setUrl("");
    setExpectedSha256("");
    setBusy(false);
    setProgressStatus("");
    setError("");
    setUnverifiedResult(null);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeAttempt.current?.cancel();
    activeAttempt.current = null;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  };

  const applyProjectArchive = async (
    sourceBytes: Uint8Array | File,
    _archiveSha256?: string,
  ) => {
    let applied = false;
    let preparedReceipt: PreparedArchiveImportReceipt;
    let appliedProject: Project;
    let receiptReady: ReturnType<typeof markArchiveImportApplied>;

    const attempt = createProjectOpenAttempt(
      () => useSlate.getState().project,
      (project) => {
        useSlate.getState().replaceProject(project);
        appliedProject = useSlate.getState().project;
        receiptReady = markArchiveImportApplied(preparedReceipt, appliedProject);
        applied = true;
      },
    );

    activeAttempt.current = attempt;
    try {
      await attempt.open(async (signal) => {
        const payload =
          sourceBytes instanceof Uint8Array
            ? (sourceBytes.buffer as ArrayBuffer)
            : sourceBytes;
        const result = await unpackSlateWithReceipt(payload, { signal });
        preparedReceipt = result.receipt;
        return result.project;
      });

      const receipt = await receiptReady!;
      handleOpenChange(false);
      toast.success(`Opened ${appliedProject!.name}`, {
        action: {
          label: "Download receipt",
          onClick: () => downloadArchiveImportReceipt(receipt),
        },
      });
    } catch (failure: unknown) {
      if (applied) {
        toast.error(
          "The project opened, but its import receipt could not be prepared.",
        );
      } else if (!attempt.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not open project archive.",
        );
      }
    } finally {
      if (activeAttempt.current === attempt) {
        activeAttempt.current = null;
      }
      setBusy(false);
    }
  };

  const handleDeviceFile = async (file?: File | null) => {
    if (!file) return;
    setError("");
    setBusy(true);

    if (isZipFile(file)) {
      if (file.size > MAX_ARCHIVE_BYTES) {
        setError("ReelBinder project archives are bounded at 512 MiB.");
        setBusy(false);
        return;
      }
      await applyProjectArchive(file);
      return;
    }

    if (file.size > 128 * 1024 * 1024) {
      setError("Script files must be smaller than 128 MiB.");
      setBusy(false);
      return;
    }

    try {
      const text = await file.text();
      const currentProject = useSlate.getState().project;

      if (file.name.endsWith(".jsonl")) {
        const next = applyLiningSidecar(currentProject, text);
        useSlate.getState().replaceProject(next);
        handleOpenChange(false);
        toast.success(`Applied lining sidecar (${next.shots.length} lines)`);
        return;
      }

      if (
        isSlateText(text) ||
        file.name.endsWith(".md") ||
        file.name.endsWith(".slate.md")
      ) {
        const res = useSlate.getState().importSlate(text);
        if (!res.ok) throw new Error(res.error);
        handleOpenChange(false);
        toast.success(`Loaded ${res.shots} lines from project source`);
        return;
      }

      if (file.name.endsWith(".json") || text.trim().startsWith("{")) {
        const parsed = parseProjectJson(text);
        useSlate.getState().replaceProject(parsed);
        handleOpenChange(false);
        toast.success(`Imported project: ${parsed.shots.length} shots`);
        return;
      }

      if (
        isFountainText(text) ||
        file.name.endsWith(".fountain") ||
        file.name.endsWith(".txt")
      ) {
        const res = useSlate.getState().importFountain(text);
        if (!res.ok) throw new Error(res.error);
        handleOpenChange(false);
        toast.success(`Boarded ${res.shots} beats from script`);
        return;
      }

      throw new Error(
        "Supported files: .reelbinder.zip, .slate.zip, .fountain, .md, .slate.md, .jsonl, .json, or .txt",
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not import file.");
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = async () => {
    try {
      const file = await pickDeviceArchiveFile();
      if (file) {
        await handleDeviceFile(file);
        return;
      }
    } catch {
      // Fall through to file input click
    }
    fileInputRef.current?.click();
  };

  const handleFetchUrl = async () => {
    setError("");
    setUnverifiedResult(null);
    setBusy(true);
    setProgressStatus("Connecting to remote host…");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await fetchArchiveFromUrl(url, {
        expectedSha256: expectedSha256.trim() || undefined,
        signal: controller.signal,
        onProgress: (received, total) => {
          if (total) {
            const pct = Math.round((received / total) * 100);
            setProgressStatus(
              `Downloading archive: ${(received / (1024 * 1024)).toFixed(1)} / ${(total / (1024 * 1024)).toFixed(1)} MiB (${pct}%)`,
            );
          } else {
            setProgressStatus(
              `Downloading archive: ${(received / (1024 * 1024)).toFixed(1)} MiB`,
            );
          }
        },
      });

      if (result.verifiedMatch) {
        setProgressStatus("Unpacking verified archive…");
        await applyProjectArchive(result.bytes, result.sha256);
      } else {
        setUnverifiedResult(result);
        setBusy(false);
        setProgressStatus("");
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch remote archive.",
        );
      }
      setBusy(false);
      setProgressStatus("");
    }
  };

  const handleConfirmUnverified = async () => {
    if (!unverifiedResult) return;
    setBusy(true);
    setProgressStatus("Unpacking archive…");
    await applyProjectArchive(unverifiedResult.bytes, unverifiedResult.sha256);
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    activeAttempt.current?.cancel();
    resetState();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <FileArchive className="size-6 text-steel" />
            Import from device or link
          </DialogTitle>
          <DialogDescription>
            Open an existing film project from a local archive file or a secure direct HTTPS link.
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-md bg-secondary p-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "device"}
            disabled={busy}
            onClick={() => {
              setTab("device");
              setError("");
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-sm py-1.5 text-xs font-medium ${
              tab === "device"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <HardDrive className="size-4" />
            From device
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "link"}
            disabled={busy}
            onClick={() => {
              setTab("link");
              setError("");
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-sm py-1.5 text-xs font-medium ${
              tab === "link"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="size-4" />
            From link
          </button>
        </div>

        {tab === "device" && (
          <div className="grid gap-4 py-2">
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 text-center hover:border-steel/60 transition-colors cursor-pointer"
              onClick={() => !busy && void handlePickFile()}
            >
              <Download className="size-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">
                Choose a project archive or screenplay
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Supports .reelbinder.zip, .slate.zip, .fountain, .slate.md, and .json
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePickFile();
                }}
              >
                Choose file
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".reelbinder.zip,.slate.zip,.zip,.fountain,.txt,.md,.slate.md,.json,.jsonl"
              className="hidden"
              onChange={(e) => {
                void handleDeviceFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {tab === "link" && (
          <div className="grid gap-4 py-2">
            <label className="grid gap-1.5 text-sm">
              <span>Direct HTTPS archive URL</span>
              <Input
                type="url"
                placeholder="https://storage.googleapis.com/.../project.reelbinder.zip"
                value={url}
                disabled={busy || !!unverifiedResult}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError("");
                  setUnverifiedResult(null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                Direct HTTPS and signed object-storage URLs are supported. Fetch runs entirely inside your browser with credentials omitted.
              </span>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span>Expected SHA-256 (optional)</span>
              <Input
                type="text"
                placeholder="64-character hex checksum"
                value={expectedSha256}
                disabled={busy || !!unverifiedResult}
                onChange={(e) => {
                  setExpectedSha256(e.target.value);
                  setError("");
                }}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground">
                If provided, ReelBinder verifies the exact hash before opening the project.
              </span>
            </label>

            {!unverifiedResult ? (
              <div className="flex gap-2">
                <Button
                  disabled={busy || !url.trim()}
                  onClick={() => void handleFetchUrl()}
                >
                  {busy && <Loader2 className="animate-spin mr-2 size-4" />}
                  Fetch and import
                </Button>
                {busy && (
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
                <div className="flex items-start gap-2 text-amber-300">
                  <ShieldAlert className="size-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm">Unverified Remote Source</p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      No expected checksum was specified. ReelBinder calculated the following hash for the downloaded bytes:
                    </p>
                    <p className="mt-1 font-mono break-all text-foreground bg-background/60 p-2 rounded border border-border">
                      {unverifiedResult.sha256}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      Size: {(unverifiedResult.byteSize / (1024 * 1024)).toFixed(2)} MiB · Source: {unverifiedResult.redactedUrl}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleConfirmUnverified()}
                  >
                    {busy && <Loader2 className="animate-spin mr-2 size-4" />}
                    Confirm and open project
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={resetState}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {progressStatus && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-steel" />
            {progressStatus}
          </p>
        )}

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive leading-relaxed" role="alert">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
