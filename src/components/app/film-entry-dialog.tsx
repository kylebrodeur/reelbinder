import { MAX_ARCHIVE_BYTES } from "@/lib/archive-limits";
import { Clapperboard, FileUp, Loader2, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConnectionsControl } from "@/components/app/cinema-connections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CinemaJobFailure, CinemaRequestFailure, getCinemaConnections, submitCinemaJob, waitForCinemaJob, type CinemaJobRequest } from "@/lib/cinema-client";
import { createProjectOpenAttempt, fetchDemoManifest, loadDemoPackWithReceipt, type DemoPackManifest } from "@/lib/demo-pack";
import { downloadArchiveImportReceipt, markArchiveImportApplied, type PreparedArchiveImportReceipt } from "@/lib/archive-import-receipt";
import { parseFountain, toFountain } from "@/lib/fountain";
import { isSlateText } from "@/lib/slate-md";
import { isZipFile, unpackSlateWithReceipt } from "@/lib/slate-pack";
import { useSlate } from "@/lib/store";
import type { Project, ScriptElement } from "@/lib/types";

type ScriptDraft = { title: string; logline: string; script: ScriptElement[] };
const PENDING_DRAFT = "slate:pending-script-job";
const DRAFT_REVIEW = "slate:script-draft-review";

export function FilmEntryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const [mode, setMode] = useState<"demo" | "import" | "idea">("demo");
  const [pages, setPages] = useState("");
  const [idea, setIdea] = useState("");
  const [direction, setDirection] = useState("One short scene, two characters, one location. Leave room for visual storytelling.");
  const [draft, setDraft] = useState<ScriptDraft | null>(null);
  const [draftPages, setDraftPages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmedCharge, setConfirmedCharge] = useState(false);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const request = useRef<CinemaJobRequest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [demoManifest, setDemoManifest] = useState<DemoPackManifest | null>(null);
  const [checkingDemo, setCheckingDemo] = useState(false);
  const [opening, setOpening] = useState(false);
  const openAttempt = useRef<ReturnType<typeof createProjectOpenAttempt> | null>(null);
  const working = busy || opening;
  const changeOpen = (value: boolean) => {
    if (!value) {
      openAttempt.current?.cancel();
      openAttempt.current = null;
      setOpening(false);
    }
    onOpenChange(value);
  };
  useEffect(() => {
    if (!open) { setOpening(false); return; }
    const controller = new AbortController();
    setCheckingDemo(true); setDemoManifest(null);
    // Opening the dialog checks only the small descriptor. Media waits for an explicit Open.
    void fetchDemoManifest({ signal: controller.signal }).then((manifest) => {
      if (!controller.signal.aborted) setDemoManifest(manifest);
    }).catch(() => {
      // Keep import/example entry available; report an unavailable demo only if asked to open it.
    }).finally(() => {
      if (!controller.signal.aborted) setCheckingDemo(false);
    });
    return () => {
      controller.abort();
      openAttempt.current?.cancel();
      openAttempt.current = null;
    };
  }, [open]);
  useEffect(() => {
    try {
      setJobId(sessionStorage.getItem(PENDING_DRAFT));
      const saved = sessionStorage.getItem(DRAFT_REVIEW);
      if (saved && saved.length < 2_000_000) {
        const review = JSON.parse(saved);
        if (typeof review.pages === "string" && typeof review.draft?.title === "string" && typeof review.draft?.logline === "string" && Array.isArray(review.draft?.script)) {
          setDraft(review.draft); setDraftPages(review.pages);
        }
      }
    } catch { /* The server job remains recoverable if local draft storage is unavailable. */ }
  }, []);
  useEffect(() => {
    if (draft) {
      try { sessionStorage.setItem(DRAFT_REVIEW, JSON.stringify({ draft, pages: draftPages })); } catch { /* Keep server job ID as fallback. */ }
    }
  }, [draft, draftPages]);
  const clearDraft = () => {
    setDraft(null); setJobId(null); request.current = null; setConfirmedCharge(false);
    try { sessionStorage.removeItem(PENDING_DRAFT); sessionStorage.removeItem(DRAFT_REVIEW); } catch { /* Session storage is optional. */ }
  };

  const finish = (view: "script" | "edit" = "script") => { useSlate.getState().setView(view); changeOpen(false); };
  const beginOpen = (onApplied?: (project: Project) => void) => {
    if (busy || openAttempt.current) return null;
    const attempt = createProjectOpenAttempt(() => useSlate.getState().project, (project) => {
      useSlate.getState().replaceProject(project);
      onApplied?.(useSlate.getState().project);
    });
    openAttempt.current = attempt;
    setError(""); setOpening(true);
    return attempt;
  };
  const openDemo = async () => {
    let applied = false;
    let preparedReceipt: PreparedArchiveImportReceipt;
    let appliedProject: Project;
    let receiptReady: ReturnType<typeof markArchiveImportApplied>;
    const attempt = beginOpen((project) => {
      appliedProject = project;
      receiptReady = markArchiveImportApplied(preparedReceipt, project);
      applied = true;
    });
    if (!attempt) return;
    try {
      await attempt.open(async (signal) => {
        const manifest = demoManifest ?? await fetchDemoManifest({ signal });
        signal.throwIfAborted();
        if (openAttempt.current === attempt) setDemoManifest(manifest);
        const result = await loadDemoPackWithReceipt(manifest, { signal });
        preparedReceipt = result.receipt;
        return result.project;
      });
      const project = appliedProject!;
      const hasPicture = project.timeline.clips.some((clip) => clip.track === "picture" &&
        (clip.sourceVideoUrl || clip.sourceFrameUrl || project.shots.find((shot) => shot.id === clip.shotId)?.videoUrl));
      if (openAttempt.current === attempt) finish(hasPicture ? "edit" : "script");
      const receipt = await receiptReady!;
      toast.success("Bounty Hunter planning study opened as your own copy. Undo returns to your previous project.", {
        action: { label: "Download receipt", onClick: () => downloadArchiveImportReceipt(receipt) },
      });
    } catch (failure) {
      if (applied) toast.error("The planning study opened, but its import receipt could not be prepared.");
      else if (openAttempt.current === attempt && !attempt.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Could not open the film study.");
    } finally {
      if (openAttempt.current === attempt) { openAttempt.current = null; setOpening(false); }
    }
  };
  const importText = (text: string, logline?: string) => {
    const store = useSlate.getState();
    const result = isSlateText(text) ? store.importSlate(text) : store.importFountain(text);
    if (!result.ok) { setError(result.error); return false; }
    if (logline) useSlate.getState().patchProject({ logline });
    setError(""); finish(); toast.success("Script opened. Review the beats and line your coverage.");
    return true;
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    let applied = false;
    let preparedReceipt: PreparedArchiveImportReceipt;
    let receiptReady: ReturnType<typeof markArchiveImportApplied>;
    const attempt = beginOpen((project) => {
      receiptReady = markArchiveImportApplied(preparedReceipt, project);
      applied = true;
    });
    if (!attempt) return;
    try {
      const isPack = file.name.toLowerCase().endsWith(".zip");
      if (file.size > (isPack ? MAX_ARCHIVE_BYTES : 128 * 1024 * 1024))
        throw new Error(isPack ? "Use a ReelBinder project archive no larger than 512 MiB." : "Use a script no larger than 128 MiB.");
      if (isZipFile(file)) {
        await attempt.open(async (signal) => {
          const result = await unpackSlateWithReceipt(file, { signal });
          preparedReceipt = result.receipt;
          return result.project;
        });
        if (openAttempt.current === attempt) finish();
        const receipt = await receiptReady!;
        toast.success("ReelBinder project archive opened.", {
          action: { label: "Download receipt", onClick: () => downloadArchiveImportReceipt(receipt) },
        });
      } else {
        if (!/\.(fountain|txt|md)$/i.test(file.name)) throw new Error("Choose a Fountain, text, Markdown or ReelBinder project archive (.reelbinder.zip or .slate.zip).");
        const text = await file.text();
        attempt.signal.throwIfAborted();
        if (openAttempt.current === attempt) setPages(text);
      }
    } catch (failure) {
      if (applied) toast.error("The ReelBinder project archive opened, but its import receipt could not be prepared.");
      else if (openAttempt.current === attempt && !attempt.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Could not import that file.");
    }
    finally { if (openAttempt.current === attempt) { openAttempt.current = null; setOpening(false); } }
  };
  const receiveDraft = (result: ScriptDraft) => {
    if (!Array.isArray(result.script) || !result.script.length || !result.script.every((element) => typeof element.text === "string" && ["scene", "action", "character", "dialogue", "parenthetical", "transition"].includes(element.kind))) throw new Error("The generated screenplay is unreadable. Keep the job ID for review.");
    setDraft(result); setDraftPages(toFountain(result.title, result.script));
    // Keep the completed job recoverable until the director accepts or discards the draft.
    request.current = null;
  };
  const generate = async () => {
    setError(""); setBusy(true); setTerminalFailure(false);
    try {
      if (jobId) { receiveDraft(await waitForCinemaJob<ScriptDraft>(jobId)); return; }
      if (!request.current) {
        const connection = (await getCinemaConnections()).find((item) => item.provider === "google-cloud");
        if (!connection) throw new Error("Open Connections and save your Google Cloud Express key first.");
        request.current = { kind: "script", connectionId: connection.connectionId, idempotencyKey: crypto.randomUUID(), input: { idea: idea.trim(), direction: direction.trim() } };
      }
      receiveDraft(await submitCinemaJob<ScriptDraft>(request.current, (id) => {
        setJobId(id);
        try { sessionStorage.setItem(PENDING_DRAFT, id); } catch { /* The server keeps the job record. */ }
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not draft the screenplay.");
      setTerminalFailure(failure instanceof CinemaJobFailure && failure.code !== "INTERRUPTED_UNCERTAIN");
      if (!jobId && failure instanceof CinemaRequestFailure && failure.status >= 400 && failure.status < 500 && failure.status !== 408) {
        request.current = null;
        setConfirmedCharge(false);
      }
    }
    finally { setBusy(false); }
  };
  const preview = pages.trim() && !isSlateText(pages) ? parseFountain(pages) : null;

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle className="font-display text-3xl">Start a film</DialogTitle><DialogDescription>Return to a scene you know, bring your screenplay, or develop a new idea.</DialogDescription></DialogHeader>
      <div className="flex gap-1 rounded-md bg-secondary p-1" role="group" aria-label="How to start">
        {([{ id: "demo", label: "Start", icon: Clapperboard }, { id: "import", label: "Import script", icon: FileUp }, { id: "idea", label: "From an idea", icon: PenLine }] as const).map((item) => <button type="button" key={item.id} disabled={working} aria-pressed={mode === item.id} onClick={() => { setMode(item.id); setError(""); }} className={`flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-xs focus-visible:outline-2 focus-visible:outline-steel ${mode === item.id ? "bg-card text-foreground" : "text-muted-foreground"}`}><item.icon className="hidden size-4 shrink-0 sm:block" />{item.label}</button>)}
      </div>
      {mode === "demo" && <div className="grid gap-3 py-3">
        <div className="grid gap-3 border-l-2 border-steel pl-4"><div><h3 className="font-display text-2xl">New blank project</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Begin with an empty screenplay workspace and make every production choice yourself.</p></div><Button disabled={working} onClick={() => { useSlate.getState().newBoard(); finish(); }}>New blank project</Button></div>
        <div className="grid gap-3 border-l-2 border-border pl-4"><div><h3 className="font-display text-2xl">Bounty Hunter planning study</h3><p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{demoManifest?.description ?? "Open the approved screenplay and production planning as your own editable copy."}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Planning only: no finished film or accepted media is included.</p>{demoManifest && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{demoManifest.credit}</p>}</div><Button disabled={working || checkingDemo} onClick={() => void openDemo()}>{opening ? <><Loader2 className="animate-spin" />Opening planning study…</> : checkingDemo ? "Checking planning study…" : "Open Bounty Hunter planning study"}</Button></div>
        <div className="grid gap-3 border-l-2 border-border pl-4" aria-disabled="true"><div><h3 className="font-display text-2xl">Open finished study</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">The cleaned accepted archive will be offered here after final review.</p></div><Button disabled>Coming after final review</Button></div>
      </div>}
      {mode === "import" && <div className="grid gap-3">
        <label className="grid gap-2 text-sm">Screenplay<Textarea rows={10} className="font-script leading-relaxed" placeholder={"INT. TAVERN - DAY\n\nA traveler pauses in the doorway."} value={pages} onChange={(event) => { setPages(event.target.value); setError(""); }} /></label>
        {preview && <p className="text-xs text-muted-foreground">Preview: {preview.elements.filter((element) => element.kind === "scene").length} scenes, {preview.elements.length} screenplay elements. Review formatting before opening.</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={working || !pages.trim()} onClick={() => importText(pages)}>Open script</Button><Button variant="outline" disabled={working} onClick={() => fileRef.current?.click()}>Choose file</Button></div>
        <p className="text-xs text-muted-foreground">Fountain, plain text, .slate.md, or a ReelBinder project archive (.reelbinder.zip or .slate.zip). An archive opens its saved production workspace; text is previewed here first.</p>
        <input ref={fileRef} type="file" className="hidden" accept=".fountain,.txt,.md,.reelbinder.zip,.slate.zip,.zip" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>}
      {mode === "idea" && <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Google Cloud drafts an editable screenplay.</p><ConnectionsControl /></div>
        {draft ? <><label className="grid gap-2 text-sm">Review your draft<Textarea rows={12} className="font-script leading-relaxed" value={draftPages} onChange={(event) => setDraftPages(event.target.value)} /></label><Button onClick={() => { if (importText(draftPages, draft.logline)) clearDraft(); }}>Use this screenplay</Button><Button variant="ghost" onClick={clearDraft}>Discard draft and start again</Button></> : <>
          <label className="grid gap-2 text-sm">The idea<Textarea rows={3} maxLength={4000} placeholder="A traveler enters an empty tavern. One coin changes the mood." value={idea} disabled={busy || !!jobId || !!request.current} onChange={(event) => setIdea(event.target.value)} /></label>
          <label className="grid gap-2 text-sm">Length, tone and production constraints<Textarea rows={2} maxLength={4000} value={direction} disabled={busy || !!jobId || !!request.current} onChange={(event) => setDirection(event.target.value)} /></label>
          {!jobId && <label className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={confirmedCharge} onChange={(event) => setConfirmedCharge(event.target.checked)} />Use my connected Google account for this draft. Model usage may incur charges.</label>}
          <Button disabled={busy || (!jobId && (!idea.trim() || !confirmedCharge))} onClick={() => void generate()}>{busy ? <><Loader2 className="animate-spin" />Drafting screenplay…</> : jobId ? "Check existing draft job" : request.current ? "Resume draft request" : "Draft screenplay"}</Button>
          {jobId && <p className="break-all text-xs text-muted-foreground">Draft job: {jobId}. Checking this job does not submit a new generation.</p>}
          {terminalFailure && <div className="grid gap-2"><p className="text-xs text-muted-foreground">This job failed. A new request may incur another charge.</p><Button variant="outline" onClick={() => { request.current = null; setJobId(null); setTerminalFailure(false); setConfirmedCharge(false); setError(""); try { sessionStorage.removeItem(PENDING_DRAFT); } catch { /* Resume storage is optional. */ } }}>Start a new draft request</Button></div>}
        </>}
      </div>}
      {error && <p className="rounded-md border border-destructive/50 p-3 text-sm" role="alert">{error}</p>}
      {opening && <Button variant="outline" onClick={() => changeOpen(false)}>Cancel opening</Button>}
    </DialogContent>
  </Dialog>;
}
