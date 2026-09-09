import { ScanSearch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductionCatalog } from "@/components/app/production-item-editor";
import { catalogGroups, markMeta } from "@/lib/marks";
import { usePreflight } from "@/lib/preflight-store";
import { useSlate } from "@/lib/store";
import type { ScriptMark } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BreakdownIndex({
  onJump,
}: {
  onJump: (mark: ScriptMark) => void;
}) {
  const project = useSlate((s) => s.project);
  const selectedElementId = useSlate((s) => s.selectedElementId);
  const selectElement = useSlate((s) => s.selectElement);
  const removeMark = useSlate((s) => s.removeMark);
  const findings = usePreflight((s) => s.findings);
  const busy = usePreflight((s) => s.status === "running");
  const run = usePreflight((s) => s.run);
  const accept = usePreflight((s) => s.accept);
  const reject = usePreflight((s) => s.reject);
  const setReportOpen = usePreflight((s) => s.setReportOpen);
  const groups = catalogGroups(project);
  const steer = groups.filter((g) => g.family === "steer");
  const total = (project.marks ?? []).length;

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden border-t border-border bg-card xl:h-full xl:w-96 xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">Index</p>
          <p className="font-medium leading-tight">
            {total} marks · {groups.length} kinds
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void run()} disabled={busy}>
          <ScanSearch />
          {busy ? "Running…" : "Preflight"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        {findings.length || busy ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Needs direction</p>
              <button type="button" className="text-xs text-steel" onClick={() => setReportOpen(true)}>
                Open report
              </button>
            </div>
            <ul className="space-y-2">
              {findings.slice(0, 4).map((f) => (
                <li key={f.id} className="rounded-md border border-border bg-secondary/50 p-2.5">
                  <p className="text-sm font-medium leading-tight">{f.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.elementId ? (
                      <button type="button" className="text-xs text-steel" onClick={() => selectElement(f.elementId)}>
                        Show
                      </button>
                    ) : null}
                    {f.suggest ? (
                      <button type="button" className="text-xs text-steel" onClick={() => accept(f.id)}>
                        Accept {markMeta(f.suggest.tag).label.toLowerCase()}
                      </button>
                    ) : null}
                    <button type="button" className="text-xs text-muted-foreground" onClick={() => reject(f.id)}>
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {findings.length > 4 ? (
              <button type="button" className="mt-2 text-xs text-steel" onClick={() => setReportOpen(true)}>
                {findings.length - 4} more in the report
              </button>
            ) : null}
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">
            Highlight words on the page, then tag them. Steer is AI direction. Catalog is the breakdown.
          </p>
        )}

        {steer.length ? (
          <KindList title="Steer" groups={steer} selectedElementId={selectedElementId} onJump={onJump} onRemove={removeMark} />
        ) : null}
        <div><p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Global production items</p><ProductionCatalog onJump={onJump} /></div>

        {!total ? (
          <p className="text-sm text-muted-foreground">
            No marks yet. Switch to Mark, select a span, and pick a tag — lock, eyeline, prop, sound.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function KindList({
  title,
  groups,
  selectedElementId,
  onJump,
  onRemove,
}: {
  title: string;
  groups: ReturnType<typeof catalogGroups>;
  selectedElementId: string | null;
  onJump: (mark: ScriptMark) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.tag}>
            <p className="mb-1 flex items-center gap-2 text-xs font-medium">
              <span className="size-2 rounded-full" style={{ background: g.color }} />
              {g.label}
              <span className="text-muted-foreground">{g.items.length}</span>
            </p>
            <ul className="space-y-1">
              {g.items.map((item) => {
                const active = item.marks.some((m) => m.elementId === selectedElementId);
                const mark = item.marks[0];
                if (!mark) return null;
                return (
                  <li
                    key={item.key}
                    className={cn("group flex items-start gap-2 rounded-sm px-1.5 py-1", active && "bg-secondary")}
                  >
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onJump(mark)}>
                      <span className="block truncate text-sm" style={{ color: g.color }}>
                        {item.text}
                      </span>
                      {item.note ? (
                        <span className="block truncate text-xs text-muted-foreground">{item.note}</span>
                      ) : (
                        <span className="block text-xs text-muted-foreground">{item.marks.length} on page</span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Remove mark"
                      className="hidden size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary group-hover:flex"
                      onClick={() => item.marks.forEach((m) => onRemove(m.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
