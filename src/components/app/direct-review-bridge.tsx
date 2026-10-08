import { Loader2, RefreshCw, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  describeDirectFailure,
  generateTakeReports,
  listReviewSheets,
  readReviewSheetState,
  rebuildMovingSheet,
  type ReviewSheetSummary,
} from "@/lib/direct-client";

export function DirectReviewBridge({ projectTitle }: { projectTitle: string }) {
  const [sheets, setSheets] = useState<ReviewSheetSummary[] | null>(null);
  const [active, setActive] = useState<ReviewSheetSummary | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<"" | "rebuild" | "reports">("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sheets = await listReviewSheets();
      setSheets(sheets);
      setActive((current) => sheets.find((s) => s.sheetId === current?.sheetId) ?? sheets[0] ?? null);
    } catch (err) {
      setSheets([]);
      setError(describeDirectFailure(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectSheet = async (sheet: ReviewSheetSummary) => {
    setActive(sheet);
    setError(null);
    try {
      const state = await readReviewSheetState(sheet.sheetId);
      setState(state.markdown);
    } catch (err) {
      setState(null);
      setError(describeDirectFailure(err));
    }
  };

  const run = async (action: "rebuild" | "reports") => {
    if (!active) return;
    setBusy(action);
    setError(null);
    try {
      const receipt = action === "rebuild" ? await rebuildMovingSheet(active.sheetId) : await generateTakeReports(active.sheetId);
      const outputs = (receipt.outputs?.sheet ?? receipt.outputs?.reports ?? null) as unknown;
      setStatus(
        `${action === "rebuild" ? "Rebuilt" : "Generated"} ${active.title}: ${
          Array.isArray(outputs) ? `${outputs.length} outputs` : String(outputs ?? "done")
        }`,
      );
    } catch (err) {
      setError(describeDirectFailure(err));
    } finally {
      setBusy("");
    }
  };

  if (sheets === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking local review sheets…
      </p>
    );
  }

  if (!sheets.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No local moving contact sheet is linked to this Cinema service for {projectTitle}.
      </p>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Linked review sheet</p>
          <p className="text-xs text-muted-foreground">{active?.title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sheets.map((sheet) => (
            <Button
              key={sheet.sheetId}
              variant="ghost"
              size="sm"
              className={active?.sheetId === sheet.sheetId ? "bg-secondary" : ""}
              onClick={() => void selectSheet(sheet)}
            >
              {sheet.title}
            </Button>
          ))}
        </div>
      </div>
      {active && (
        <p className="text-xs text-muted-foreground">
          {active.noteCount} notes · {active.verdicts.accepted} accepted · {active.verdicts.rejected} rejected ·{" "}
          {active.verdicts.pending} pending
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy !== "" || !active} onClick={() => void run("rebuild")}>
          {busy === "rebuild" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rebuild moving sheet
        </Button>
        <Button variant="outline" disabled={busy !== "" || !active} onClick={() => void run("reports")}>
          {busy === "reports" ? <Loader2 className="animate-spin" /> : <FileText />} Generate take reports
        </Button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      {state && (
        <pre className="max-h-64 overflow-auto rounded bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {state}
        </pre>
      )}
      {error && (
        <p className="rounded-md border border-destructive/50 p-3 text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}