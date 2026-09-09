import { catalogFloorKind } from "@/lib/stage-format";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronLeft, GitMerge, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { catalogTag, previewProductionMerge, productionCatalog, resolveProductionItem, type ProductionMergeReview } from "@/lib/production-catalog";
import { useSlate } from "@/lib/store";
import type { ProductionScope, ScriptMark } from "@/lib/types";
import { sceneIdOf } from "@/lib/marks";

const selectClass = "min-h-9 w-full rounded-md border border-border bg-background px-2 py-1 text-sm";
export function ProductionCatalog({ filter = "all", onJump }: { filter?: "all" | "props" | "other"; onJump?: (mark: ScriptMark) => void }) {
  const project = useSlate((state) => state.project);
  const [selected, setSelected] = useState<string | null>(null);
  const items = productionCatalog(project).filter(({ item }) => {
    const prop = ["prop", "dressing"].includes(item.tag ?? catalogTag(item.department) ?? "");
    return filter === "all" || (filter === "props" ? prop : !prop);
  });
  if (selected && project.breakdown.some((item) => item.id === selected)) return <ProductionItemEditor key={`${project.id}:${selected}`} itemId={selected} onBack={() => setSelected(null)} onSelect={setSelected} onJump={onJump} />;
  return <section className="space-y-3">
    <p className="text-xs text-muted-foreground">One global item links its notes and every labeled occurrence. Drag items onto the stage floor.</p>
    {!items.length ? <p className="text-sm text-muted-foreground">Tag a prop, person or place on the screenplay to add it here.</p> : <ul className="divide-y divide-border rounded-md border border-border">
      {items.map(({ item, marks, sceneIds, unresolved }) => <li key={item.id} className="group flex items-stretch hover:bg-secondary/60 transition-colors">
        <div
          draggable
          onDragStart={(e) => {
            const kind = catalogFloorKind(item.tag);
            e.dataTransfer.setData(
              "application/json",
              JSON.stringify({
                type: "prop",
                projectId: project.id,
                kind,
                label: item.item,
                productionItemId: item.id,
              }),
            );
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="flex items-center px-2 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing border-r border-border/40"
          title="Drag onto Stage floor plan"
        >
          <GripVertical className="size-4" />
        </div>
        <button type="button" className="flex w-full items-start gap-3 px-3 py-3 text-left" onClick={() => setSelected(item.id)}>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.item}</span><span className="mt-1 block text-xs text-muted-foreground">{item.department} · {marks.length} occurrences · {sceneIds.length} scenes</span>{unresolved.length ? <span className="mt-1 block text-xs text-amber-300">{unresolved.length} anchors to reconnect</span> : null}</span>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </button>
      </li>)}
    </ul>}
  </section>;
}

export function ProductionItemEditor({ itemId, onBack, onSelect, onJump }: { itemId: string; onBack: () => void; onSelect: (id: string) => void; onJump?: (mark: ScriptMark) => void }) {
  const project = useSlate((state) => state.project);
  const edit = useSlate((state) => state.editProductionItem);
  const setOverride = useSlate((state) => state.setProductionOverride);
  const merge = useSlate((state) => state.mergeProductionItems);
  const entry = productionCatalog(project).find((value) => value.item.id === itemId);
  const item = entry?.item;
  const [name, setName] = useState(item?.item ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [scopeKey, setScopeKey] = useState("global");
  const [scopeNotes, setScopeNotes] = useState("");
  const [targetId, setTargetId] = useState("");
  const [review, setReview] = useState<ProductionMergeReview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const scope: ProductionScope | null = scopeKey === "global" ? null : { kind: scopeKey.startsWith("scene:") ? "scene" : "shot", id: scopeKey.slice(scopeKey.indexOf(":") + 1) };
  const shot = scope?.kind === "shot" ? project.shots.find((value) => value.id === scope.id) : undefined;
  const effective = resolveProductionItem(project, itemId, { ...(scope?.kind === "scene" ? { sceneId: scope.id } : {}), ...(scope?.kind === "shot" ? { shotId: scope.id } : {}) });
  const parent = resolveProductionItem(project, itemId, scope?.kind === "shot" ? { sceneId: shot?.sceneId } : {});
  const existingOverride = item?.overrides?.find((value) => value.scope.kind === scope?.kind && value.scope.id === scope?.id);
  useEffect(() => { setName(item?.item ?? ""); setNotes(item?.notes ?? ""); }, [item?.id, item?.item, item?.notes]);
  useEffect(() => { setScopeNotes(effective?.notes ?? ""); }, [scopeKey, effective?.notes]);
  if (!item || !entry) return null;
  const globalDirty = name !== item.item || notes !== (item.notes ?? "");
  const targets = project.breakdown.filter((value) => value.id !== itemId && (value.tag ?? catalogTag(value.department) ?? value.department.toLowerCase()) === (item.tag ?? catalogTag(item.department) ?? item.department.toLowerCase()));
  const report = (result: { ok: true } | { ok: false; error: string }, success: string) => setMessage(result.ok ? success : result.error);
  const scopeLabel = (value: ProductionScope) => value.kind === "scene" ? project.script.find((element) => element.id === value.id)?.text ?? "Deleted scene" : `Shot ${project.shots.find((shot) => shot.id === value.id)?.setup ?? "no longer present"}`;
  const relink = (mark: ScriptMark) => {
    const selectedId = useSlate.getState().selectedElementId;
    const element = project.script.find((value) => value.id === selectedId);
    const start = element?.text.indexOf(mark.text) ?? -1;
    if (!element || start < 0 || element.text.indexOf(mark.text, start + 1) >= 0) { setMessage("Select a screenplay beat containing this exact quote once, then reconnect the occurrence."); return; }
    useSlate.getState().patchMark(mark.id, { elementId: element.id, sceneId: sceneIdOf(project.script, element.id), start, end: start + mark.text.length, anchorStatus: undefined });
    setMessage("Occurrence reconnected to the selected screenplay beat.");
  };
  const jump = (mark: ScriptMark) => {
    if (onJump) onJump(mark);
    else { useSlate.getState().selectElement(mark.elementId); useSlate.getState().setView("script"); }
  };
  return <section className="space-y-4">
    <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft /> All global items</Button>
    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{item.department} · Global item</p><h3 className="mt-1 text-lg font-medium">{item.item}</h3></div>
    <div
      draggable
      onDragStart={(e) => {
        const kind = catalogFloorKind(item.tag);
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            type: "prop",
                projectId: project.id,
            kind,
            label: item.item,
            productionItemId: item.id,
          }),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-1.5 cursor-grab active:cursor-grabbing hover:border-steel/60 transition-colors"
      title="Drag onto Stage floor plan"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <GripVertical className="size-3.5 text-muted-foreground" /> Drag item onto Stage floor
      </span>
      <span className="text-[10px] text-muted-foreground">Drop on Stage</span>
    </div>
    <div className="space-y-3 rounded-md border border-border p-3">
      <label className="grid gap-1 text-xs">Global name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="grid gap-1 text-xs">Global notes<Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="The shared description used throughout this production" /></label>
      <Button size="sm" disabled={!globalDirty || !name.trim()} onClick={() => report(edit(itemId, { item: name.trim(), notes }), "Global item saved. Linked occurrences keep their screenplay wording.")}>Save global item</Button>
      {item.aliases?.length ? <p className="text-xs text-muted-foreground">Also called: {item.aliases.join(", ")}</p> : null}
    </div>
    <section className="space-y-2 rounded-md border border-border p-3">
      <label className="grid gap-1 text-xs">Scope<select className={selectClass} value={scopeKey} onChange={(event) => setScopeKey(event.target.value)}>
        <option value="global">Global item</option>
        {project.script.filter((element) => element.kind === "scene").map((element) => <option key={element.id} value={`scene:${element.id}`}>Scene · {element.text}</option>)}
        {project.shots.map((value) => <option key={value.id} value={`shot:${value.id}`}>Shot · {value.setup || value.number} · {value.title}</option>)}
      </select></label>
      {scope ? <>
        <p className="text-xs text-muted-foreground">Parent: <button type="button" className="text-steel underline underline-offset-2" onClick={() => setScopeKey(parent?.origin.kind === "scene" ? `scene:${parent.origin.id}` : "global")}>{parent?.origin.kind === "scene" ? "Scene notes" : `${item.item} · global notes`}</button></p>
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{parent?.notes || "No parent note yet."}</p>
        <label className="grid gap-1 text-xs">{existingOverride ? "Override here" : "Inherited · edit to override here"}<Textarea rows={3} value={scopeNotes} onChange={(event) => setScopeNotes(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => report(setOverride(itemId, scope, scopeNotes), "Override saved for this scope.")}>Save {scope.kind} override</Button>{existingOverride ? <Button size="sm" variant="outline" onClick={() => report(setOverride(itemId, scope, null), "This scope now uses its parent notes.")}>Use parent</Button> : null}</div>
      </> : <p className="text-xs text-muted-foreground">Scenes and shots use the global notes until you add a specific override.</p>}
    </section>
    <section className="space-y-2"><h4 className="text-sm font-medium">Script occurrences · {entry.marks.length}</h4>
      {entry.marks.map((mark) => <article key={mark.id} className="rounded-md border border-border p-2.5">
        <button type="button" className="text-left text-sm text-steel underline underline-offset-2" disabled={!!mark.anchorStatus} onClick={() => jump(mark)}>“{mark.text}”</button>
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{mark.note || "No occurrence note."}</p>
        <p className="mt-1 text-xs text-muted-foreground">{mark.sceneId ? scopeLabel({ kind: "scene", id: mark.sceneId }) : "Scene unassigned"}{mark.anchorStatus ? ` · ${mark.anchorStatus === "missing" ? "Passage changed" : "Quote occurs more than once"}` : ""}</p>
        <div className="mt-2 flex flex-wrap gap-2">{mark.anchorStatus ? <button type="button" className="text-xs text-steel underline underline-offset-2" onClick={() => relink(mark)}>Relink to selected beat</button> : null}<button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => useSlate.getState().removeMark(mark.id)}>Remove occurrence</button></div>
      </article>)}
      {!entry.marks.length ? <p className="text-xs text-muted-foreground">No labeled occurrences yet. The global item stays available.</p> : null}
    </section>
    {targets.length ? <section className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-medium">Merge duplicate items</h4>
      <label className="grid gap-1 text-xs">Keep this global item<select className={selectClass} value={targetId} onChange={(event) => { setTargetId(event.target.value); setReview(null); }}><option value="">Choose the item to keep…</option>{targets.map((value) => <option key={value.id} value={value.id}>{value.item}</option>)}</select></label>
      <Button size="sm" variant="outline" disabled={!targetId || globalDirty} onClick={() => { try { setReview(previewProductionMerge(project, targetId, [itemId])); setResolutions({}); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare the merge."); } }}><GitMerge /> Review merge</Button>
      {globalDirty ? <p className="text-xs text-muted-foreground">Save the global edits before reviewing a merge.</p> : null}
      {review ? <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
        <p className="text-sm">Merge “{item.item}” into “{project.breakdown.find((value) => value.id === review.targetId)?.item}”. {review.occurrenceCount} occurrences will link to the retained item.</p>
        <p className="text-xs text-muted-foreground">Both names and every original note are retained. Screenplay wording stays editable on the page.</p>
        {review.notes.map((value, index) => <p key={index} className="whitespace-pre-wrap border-l-2 border-border pl-2 text-xs">{value.notes}</p>)}
        {review.conflicts.map((conflict) => <label key={conflict.key} className="grid gap-1 text-xs">Choose effective notes · {scopeLabel(conflict.scope)}<select className={selectClass} value={resolutions[conflict.key] === undefined ? "" : String(conflict.choices.findIndex((choice) => choice.notes === resolutions[conflict.key]))} onChange={(event) => setResolutions((current) => ({ ...current, [conflict.key]: conflict.choices[Number(event.target.value)].notes }))}><option value="" disabled>Choose a note…</option>{conflict.choices.map((choice, index) => <option key={index} value={index}>{choice.notes || "Empty note"}</option>)}</select></label>)}
        <Button size="sm" disabled={review.conflicts.some((conflict) => resolutions[conflict.key] === undefined)} onClick={() => { const result = merge(review, resolutions); if (result.ok) onSelect(review.targetId); else setMessage(result.error); }}>Apply reviewed merge</Button>
      </div> : null}
    </section> : null}
    {item.preservedNotes?.length ? <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-xs">Preserved notes · {item.preservedNotes.length}</summary>{item.preservedNotes.map((value, index) => <div key={index} className="mt-2 border-l border-border pl-2"><p className="whitespace-pre-wrap text-xs">{value.notes}</p><p className="text-xs text-muted-foreground">{value.scope ? scopeLabel(value.scope) : "Earlier global note"}</p></div>)}</details> : null}
    {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
  </section>;
}
