import { MAX_ARCHIVE_BYTES } from "@/lib/archive-limits";
import {
  BookOpen,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
  Layers,
  Pencil,
  Plus,
  Settings,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { EditView } from "@/components/app/edit-view";
import { CoverageDock } from "@/components/app/coverage-dock";
import { FilmEntryDialog } from "@/components/app/film-entry-dialog";
import { RenderView } from "@/components/app/render-view";
import { PreflightControl } from "@/components/app/preflight-control";
import { ProductionDrawer, type ProdTab } from "@/components/app/production-drawer";
import { ScriptView } from "@/components/app/script-view";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { StageView } from "@/components/app/stage-view";
import { PortableImportDialog } from "@/components/app/portable-import-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isFountainText, toFountain } from "@/lib/fountain";
import { createProjectOpenAttempt } from "@/lib/demo-pack";
import { sequencePrompt } from "@/lib/prompts";
import { downloadSlatePack, isZipFile, unpackSlateWithReceipt } from "@/lib/slate-pack";
import { downloadArchiveImportReceipt, markArchiveImportApplied, type PreparedArchiveImportReceipt } from "@/lib/archive-import-receipt";
import { isSlateText } from "@/lib/slate-md";
import { applyLiningSidecar } from "@/lib/lining-sidecar";
import { parseProjectJson } from "@/lib/slate-snapshot";
import { flushSave, hadPersistedProject, markSaveClean } from "@/lib/save";
import { useSlate } from "@/lib/store";
import type { Project, View } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SlateApp() {
  const project = useSlate((s) => s.project);
  const view = useSlate((s) => s.view);
  const setView = useSlate((s) => s.setView);
  const patchProject = useSlate((s) => s.patchProject);
  const replaceProject = useSlate((s) => s.replaceProject);
  const importFountain = useSlate((s) => s.importFountain);
  const importSlate = useSlate((s) => s.importSlate);
  const selectedId = useSlate((s) => s.selectedId);
  const selectShot = useSlate((s) => s.selectShot);
  const moveShot = useSlate((s) => s.moveShot);
  const hydrated = useSlate((s) => s.hydrated);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [prodTab, setProdTab] = useState<ProdTab>("originals");
  const [portableImportOpen, setPortableImportOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const activeImport = useRef<Pick<ReturnType<typeof createProjectOpenAttempt>, "signal" | "cancel"> | null>(null);
  const hadProjectBeforeHydration = useRef(hadPersistedProject());
  const autoOpenedFreshProject = useRef(false);

  useEffect(() => () => activeImport.current?.cancel(), []);

  useEffect(() => {
    const finish = () => {
      useSlate.getState().setHydrated(true);
      useSlate.getState().recheck();
      markSaveClean();
    };
    const unsub = useSlate.persist.onFinishHydration(finish);
    void useSlate.persist.rehydrate();
    const t = window.setTimeout(finish, 200);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || hadProjectBeforeHydration.current || autoOpenedFreshProject.current) return;
    autoOpenedFreshProject.current = true;
    setNewOpen(true);
  }, [hydrated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        flushSave();
        toast.success("Saved");
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target?.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="tablist"]') ||
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      )
        return;
      const shots = useSlate.getState().project.shots;
      const idx = shots.findIndex((s) => s.id === useSlate.getState().selectedId);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        const next = shots[Math.min(shots.length - 1, idx + 1)];
        if (next) selectShot(next.id);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        const prev = shots[Math.max(0, idx - 1)];
        if (prev) selectShot(prev.id);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowLeft" && selectedId) moveShot(selectedId, -1);
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight" && selectedId) moveShot(selectedId, 1);
    };
    const onLeave = () => flushSave();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [selectShot, moveShot, selectedId]);

  const exportPack = () => {
    void downloadSlatePack(project).catch((error) => toast.error(error instanceof Error ? error.message : "Could not create the ReelBinder project archive."));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}-reelbinder-project.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportFountain = () => {
    const blob = new Blob([toFountain(project.name, project.script)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}.fountain`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = (file: File) => {
    activeImport.current?.cancel();
    activeImport.current = null;
    if (isZipFile(file)) {
      if (file.size > MAX_ARCHIVE_BYTES) {
        toast.error("Use a ReelBinder project archive no larger than 512 MiB.");
        return;
      }
      let preparedReceipt: PreparedArchiveImportReceipt;
      let appliedProject: Project;
      let receiptReady: ReturnType<typeof markArchiveImportApplied>;
      const attempt = createProjectOpenAttempt(() => useSlate.getState().project, (project) => {
        replaceProject(project);
        appliedProject = useSlate.getState().project;
        receiptReady = markArchiveImportApplied(preparedReceipt, appliedProject);
      });
      activeImport.current = attempt;
      const notice = toast.loading("Opening ReelBinder project archive…", {
        cancel: { label: "Cancel", onClick: () => attempt.cancel() },
      });
      void (async () => {
        try {
          await attempt.open(async (signal) => {
            const result = await unpackSlateWithReceipt(file, { signal });
            preparedReceipt = result.receipt;
            return result.project;
          });
          const receipt = await receiptReady!;
          if (activeImport.current !== attempt || attempt.signal.aborted) return;
          toast.success(`Opened ${appliedProject!.name}`, {
            action: { label: "Download receipt", onClick: () => downloadArchiveImportReceipt(receipt) },
          });
        } catch (err) {
          if (!attempt.signal.aborted)
            toast.error(appliedProject! ? "The ReelBinder project archive opened, but its import receipt could not be prepared." : err instanceof Error ? err.message : "Could not open that ReelBinder project archive.");
        } finally {
          toast.dismiss(notice);
          if (activeImport.current === attempt) activeImport.current = null;
        }
      })();
      return;
    }
    if (file.size > 128 * 1024 * 1024) {
      toast.error("Use a script smaller than 128 MB.");
      return;
    }
    const reader = new FileReader();
    const controller = new AbortController();
    const importProject = useSlate.getState().project;
    const snapshot = JSON.stringify(importProject);
    const attempt = {
      signal: controller.signal,
      cancel: () => {
        controller.abort();
        if (reader.readyState === FileReader.LOADING) reader.abort();
      },
    };
    activeImport.current = attempt;
    const notice = toast.loading("Opening script…", {
      cancel: { label: "Cancel", onClick: () => attempt.cancel() },
    });
    const finishRead = () => {
      toast.dismiss(notice);
      if (activeImport.current === attempt) activeImport.current = null;
    };
    reader.onabort = finishRead;
    reader.onerror = () => {
      if (!attempt.signal.aborted) toast.error("Could not read that script file.");
      finishRead();
    };
    reader.onload = () => {
      if (attempt.signal.aborted || activeImport.current !== attempt) return;
      try {
        if (JSON.stringify(useSlate.getState().project) !== snapshot) {
          toast.error("Your project changed while the script was opening. Open it again when you are ready to replace the current project.");
          return;
        }
        const text = String(reader.result ?? "");
        if (file.name.endsWith(".jsonl")) {
          try {
            const next = applyLiningSidecar(importProject, text);
            replaceProject(next);
            toast.success(`Sidecar applied · ${next.shots.length} lines`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not apply that lining sidecar.");
          }
          return;
        }
        if (isSlateText(text) || file.name.endsWith(".md") || file.name.endsWith(".slate.md")) {
          const res = importSlate(text);
          if (!res.ok) toast.error(res.error);
          else toast.success(`Loaded ${res.shots} lines from project source`);
          return;
        }
        if (file.name.endsWith(".json") || text.trim().startsWith("{")) {
          try {
            const parsed = parseProjectJson(text);
            replaceProject(parsed);
            toast.success(`Imported ${parsed.shots.length} shots`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not read that JSON.");
          }
          return;
        }
        if (isFountainText(text) || file.name.endsWith(".fountain") || file.name.endsWith(".txt")) {
          const res = importFountain(text);
          if (!res.ok) toast.error(res.error);
          else toast.success(`Boarded ${res.shots} beats from the script`);
          return;
        }
        toast.error("Use a ReelBinder project archive (.reelbinder.zip or .slate.zip), .slate.md, Fountain, or JSON.");
      } finally {
        finishRead();
      }
    };
    reader.readAsText(file);
  };

  const views: { id: View; label: string; icon: typeof FileText }[] = [
    { id: "script", label: "Script", icon: FileText },
    { id: "stage", label: "Stage", icon: Pencil },
    { id: "edit", label: "Edit", icon: Layers },
    { id: "render", label: "Render", icon: Clapperboard },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-col bg-background",
          "h-dvh overflow-hidden",
        )}
        suppressHydrationWarning
      >
        <header className="shrink-0 border-b border-border bg-background px-3 sm:px-4">
          <div className="grid min-h-12 grid-cols-1 items-center gap-1.5 py-1.5 min-[540px]:grid-cols-[minmax(0,1fr)_auto] lg:flex lg:h-12 lg:justify-between lg:gap-4 lg:py-0">
            {/* Left: Brand / Project Menu & Inline Title */}
            <div className="flex min-w-0 items-center gap-2 lg:flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="ReelBinder project menu"
                    className="h-8 shrink-0 gap-1.5 px-2 font-medium hover:bg-secondary/60"
                  >
                    <img
                      src="/brand/reelbinder-mark.svg"
                      alt=""
                      aria-hidden="true"
                      className="size-5 shrink-0"
                    />
                    <span className="font-display text-sm font-semibold leading-none tracking-tight text-foreground">
                      ReelBinder
                    </span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuLabel>Project files</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setNewOpen(true)}>
                    <Plus /> New film
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPortableImportOpen(true)}>
                    <Upload /> Import from device or link
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={exportPack}>
                    <Download /> Download project archive (.reelbinder.zip)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportFountain}>
                    Export screenplay (.fountain)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportJson}>
                    Export project data (.json)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <span className="h-4 w-px shrink-0 bg-border" />

              <input
                value={project.name}
                onChange={(e) => patchProject({ name: e.target.value })}
                className="w-full min-w-0 max-w-[10rem] sm:max-w-[14rem] md:max-w-xs truncate rounded bg-transparent px-1.5 py-0.5 text-xs sm:text-sm font-medium outline-none transition-colors hover:bg-secondary/40 focus:bg-secondary/60 focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Script title"
                placeholder="Untitled project"
              />
            </div>

            {/* Center: Primary Pipeline Mode Switcher */}
            <nav
              aria-label="Workspaces"
              className="flex min-w-0 items-center justify-center rounded-sm border border-border/50 bg-secondary/80 p-0.5 min-[540px]:order-3 min-[540px]:col-span-2 lg:order-none lg:shrink-0"
            >
              {views.map((v) => {
                const active = view === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-label={v.label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setView(v.id)}
                    className={cn(
                      "inline-flex h-7 sm:h-7.5 items-center gap-1.5 rounded-[2px] px-2.5 sm:px-3 text-xs font-medium transition-all outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      active
                        ? "bg-card text-foreground shadow-xs border border-border/50 font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/40",
                    )}
                  >
                    <v.icon className={cn("size-3.5", active ? "text-steel" : "text-muted-foreground")} />
                    <span>{v.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right: Tools & Settings */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 min-[540px]:order-2 sm:gap-1.5 lg:order-none lg:shrink-0 lg:flex-nowrap">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs hover:text-foreground"
                onClick={() => {
                  if (view === "stage") {
                    window.dispatchEvent(new CustomEvent("slate:stage-open-dock", { detail: "book" }));
                  } else {
                    setProdOpen(true);
                  }
                }}
                aria-label="Production book"
                title="Production book"
              >
                <BookOpen className="size-3.5 text-steel" />
                <span className="hidden md:inline">Production book</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="size-3.5" />
              </Button>
            </div>
          </div>

          <input
            ref={importRef}
            type="file"
            accept=".reelbinder.zip,.slate.zip,.zip,.md,.slate.md,.jsonl,.fountain,.txt,.json,text/plain,application/json,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </header>
        <PreflightControl presentation="workspace" />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {view === "script" && <ScriptView />}
            {view === "stage" && <StageView />}
            {view === "edit" && <EditView />}
            {view === "render" && <RenderView />}
          </main>
        </div>
        <CoverageDock />
        <FilmEntryDialog open={newOpen} onOpenChange={setNewOpen} />
        <PortableImportDialog
          open={portableImportOpen}
          onOpenChange={setPortableImportOpen}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onOpenWorld={() => {
            setProdTab("cut");
            setProdOpen(true);
          }}
          onOpenCast={() => {
            setProdTab("cast");
            setProdOpen(true);
          }}
        />
        <ProductionDrawer
          open={prodOpen}
          onOpenChange={setProdOpen}
          tab={prodTab}
          onTabChange={setProdTab}
        />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "bg-card border-border text-foreground",
            },
          }}
        />
        {!hydrated && <span className="sr-only">Loading script</span>}
      </div>
    </TooltipProvider>
  );
}

export function copySequence() {
  return sequencePrompt(useSlate.getState().project, useSlate.getState().project.target);
}
