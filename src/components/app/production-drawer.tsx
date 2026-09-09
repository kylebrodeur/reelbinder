import { CastEditor } from "@/components/app/cast-editor";
import { ProductionCatalog } from "@/components/app/production-item-editor";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { coverageLabel } from "@/lib/lining";
import { originalBoards, originalDiagrams } from "@/lib/originals";
import { useSlate } from "@/lib/store";
import type { BinderAsset, BinderTab } from "@/lib/types";
import { BINDER_TAB_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ProdTab = BinderTab | "originals" | "cast";

const TABS: { id: ProdTab; label: string }[] = [
  { id: "cast", label: "Cast" },
  { id: "cut", label: BINDER_TAB_LABEL.cut },
  { id: "originals", label: "Originals" },
  { id: "diagrams", label: BINDER_TAB_LABEL.diagrams },
  { id: "wardrobe", label: BINDER_TAB_LABEL.wardrobe },
  { id: "props", label: BINDER_TAB_LABEL.props },
  { id: "boards", label: BINDER_TAB_LABEL.boards },
  { id: "breakdown", label: BINDER_TAB_LABEL.breakdown },
  { id: "shots", label: BINDER_TAB_LABEL.shots },
];

export function ProductionDrawer({
  open = true,
  onOpenChange,
  tab: tabProp,
  onTabChange,
  embedded = false,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  tab?: ProdTab;
  onTabChange?: (t: ProdTab) => void;
  embedded?: boolean;
}) {
  const project = useSlate((s) => s.project);
  const [tabLocal, setTabLocal] = useState<ProdTab>("originals");
  const tab = tabProp ?? tabLocal;
  const setTab = onTabChange ?? setTabLocal;
  const assets = (t: BinderTab) => project.binder.filter((a) => a.tab === t);
  const origBoards = originalBoards(project);
  const origDiagrams = originalDiagrams(project);
  const lined = assets("boards").filter((a) => a.url?.includes("lined"));

  const closeDrawer = () => onOpenChange?.(false);

  const content = (
    <div className={cn("flex min-h-0 flex-1 flex-col", embedded ? "h-full" : "")}>
      <div className={cn("shrink-0", embedded ? "px-3 pt-3 pb-2 border-b border-border" : "px-6 pt-6")}>
        <h3 className={cn("font-semibold leading-tight text-foreground", embedded ? "text-sm" : "text-lg")}>
          Production Book
        </h3>
        <p className={cn("text-muted-foreground", embedded ? "text-[11px] mt-0.5" : "text-sm mt-1")}>
          {embedded
            ? "Cast, boards, props, and breakdown. Drag onto stage."
            : "Cast, boards, diagrams, and the breakdown. Working frames stay on the desk."}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as ProdTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className={cn("flex h-auto min-h-9 flex-wrap justify-start gap-0.5 border-b border-border bg-transparent p-1", embedded ? "px-2" : "mx-6")}>
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="text-xs px-2 py-1 data-[state=active]:bg-secondary">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className={cn("min-h-0 flex-1 overflow-auto", embedded ? "px-3 py-3" : "max-h-[64vh] px-6 pb-6")}>
          <TabsContent value="cast" className="pt-2">
            <CastEditor />
          </TabsContent>
          <TabsContent value="cut" className="space-y-3">
            <WorldFields />
            {project.cutUrl ? (
              <div className="overflow-hidden rounded-md border border-border">
                <iframe
                  title="Finished cut"
                  src={project.cutUrl}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No finished cut attached to this script.</p>
            )}
            {assets("cut").map((a) => (
              <p key={a.id} className="text-sm text-muted-foreground">
                {a.caption}
              </p>
            ))}
          </TabsContent>
          <TabsContent value="originals" className="space-y-6">
            <Gallery heading="Original storyboards" items={origBoards} />
            <Gallery heading="Original diagrams" items={origDiagrams} />
            {lined.length ? <Gallery heading="Original lined pages" items={lined} /> : null}
          </TabsContent>
          {(["diagrams", "wardrobe", "boards"] as BinderTab[]).map((t) => (
            <TabsContent key={t} value={t} className="grid gap-4 sm:grid-cols-2">
              {assets(t).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing in {BINDER_TAB_LABEL[t]} yet.</p>
              ) : (
                assets(t).map((a) => <AssetFigure key={a.id} asset={a} />)
              )}
            </TabsContent>
          ))}
          <TabsContent value="props">
            <ProductionCatalog filter="props" onJump={(mark) => { useSlate.getState().selectElement(mark.elementId); useSlate.getState().setView("script"); closeDrawer(); }} />
          </TabsContent>
          <TabsContent value="breakdown">
            <ProductionCatalog onJump={(mark) => { useSlate.getState().selectElement(mark.elementId); useSlate.getState().setView("script"); closeDrawer(); }} />
          </TabsContent>
          <TabsContent value="shots">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2">Setup</th>
                  <th className="py-2 pr-2">Size</th>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {project.shots.map((s) => (
                  <tr key={s.id} className="border-t border-border align-top">
                    <td className="py-2 pr-2 font-script">{s.setup || s.number}</td>
                    <td className="py-2 pr-2">{s.coverageSize}</td>
                    <td className="py-2 pr-2">{s.title}</td>
                    <td className="py-2 text-muted-foreground">{s.notes || coverageLabel(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );

  if (embedded) {
    return <div className="h-full min-h-0 flex flex-col overflow-hidden bg-card">{content}</div>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        {content}
      </DialogContent>
    </Dialog>
  );
}

function Gallery({ heading, items }: { heading: string; items: BinderAsset[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{heading}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((a) => (
          <AssetFigure key={a.id} asset={a} />
        ))}
      </div>
    </section>
  );
}

function AssetFigure({ asset }: { asset: BinderAsset }) {
  return (
    <figure className="overflow-hidden rounded-md border border-border bg-secondary">
      {asset.url ? <img src={asset.url} alt={asset.title} className="max-h-80 w-full object-contain" /> : null}
      <figcaption className="px-3 py-2">
        <p className="text-sm font-medium">{asset.title}</p>
        {asset.caption ? <p className="mt-1 text-xs text-muted-foreground">{asset.caption}</p> : null}
      </figcaption>
    </figure>
  );
}

function WorldFields() {
  const world = useSlate((s) => s.project.world);
  const patchWorld = useSlate((s) => s.patchWorld);
  return (
    <div className="grid gap-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">World lock — persists unless a beat names a change</p>
      <label className="grid gap-1">
        <Label>Place</Label>
        <Textarea rows={2} value={world.place} onChange={(e) => patchWorld({ place: e.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <Label>Lighting</Label>
          <Textarea rows={2} value={world.lighting} onChange={(e) => patchWorld({ lighting: e.target.value })} />
        </label>
        <label className="grid gap-1">
          <Label>Ambience</Label>
          <Textarea rows={2} value={world.ambience} onChange={(e) => patchWorld({ ambience: e.target.value })} />
        </label>
      </div>
      <label className="grid gap-1">
        <Label>Laws</Label>
        <Textarea rows={3} value={world.laws} onChange={(e) => patchWorld({ laws: e.target.value })} />
      </label>
      {world.genesisUrl ? (
        <figure className="overflow-hidden rounded-md border border-border bg-secondary">
          <img src={world.genesisUrl} alt="Room lock" className="max-h-64 w-full object-cover" />
          <figcaption className="px-3 py-2 text-xs text-muted-foreground">Room lock still</figcaption>
        </figure>
      ) : null}
    </div>
  );
}

