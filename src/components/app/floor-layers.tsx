import { useState, useEffect } from "react";
import {
  AppWindow,
  Armchair,
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Disc,
  DoorOpen,
  Eye,
  EyeOff,
  Focus,
  Hash,
  Lock,
  MoveRight,
  Square,
  SquareDashed,
  Unlock,
  User,
  Video,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { coverageLabel, LINE_COLOR_BG } from "@/lib/lining";
import { categoryForItem, figureColor, FLOOR_CATEGORIES, type FloorCategory } from "@/lib/floor";
import { stageItemCategory } from "@/lib/stage-format";
import type { FloorCamera, FloorFigure, FloorItem, FloorKind, Project, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { FloorSel } from "./floor-inspector";

type LayerTab = "objects" | "setups";

const KIND_ICONS: Record<string, LucideIcon> = {
  wall: SquareDashed,
  door: DoorOpen,
  window: AppWindow,
  bar: Wine,
  table: Disc,
  stool: CircleDot,
  chair: Armchair,
  well: Box,
  mark: Hash,
  rect: Square,
  circle: Circle,
  arrow: MoveRight,
};

const CATEGORY_ORDER: FloorCategory[] = ["cast", "cameras", "furniture", "set", "marks"];

export function FloorLayers({
  shots,
  currentId,
  solo,
  hidden,
  onSelect,
  onSolo,
  onToggle,
  categoryHidden = new Set(),
  categoryLocked = new Set(),
  onToggleCategoryVisibility,
  onToggleCategoryLock,
  embedded = false,
  figures = [],
  cameras = [],
  items = [],
  sel = null,
  soloTarget = null,
  onSelectTarget,
  onToggleSoloTarget,
  onToggleItemLock,
  project,
}: {
  shots: Shot[];
  currentId: string | null;
  solo: boolean;
  hidden: Set<string>;
  onSelect: (id: string) => void;
  onSolo: (v: boolean) => void;
  onToggle: (id: string) => void;
  categoryHidden?: Set<FloorCategory>;
  categoryLocked?: Set<FloorCategory>;
  onToggleCategoryVisibility?: (cat: FloorCategory) => void;
  onToggleCategoryLock?: (cat: FloorCategory) => void;
  embedded?: boolean;
  figures?: FloorFigure[];
  cameras?: FloorCamera[];
  items?: FloorItem[];
  sel?: FloorSel | null;
  soloTarget?: FloorSel | null;
  onSelectTarget?: (target: FloorSel) => void;
  onToggleSoloTarget?: (target: FloorSel) => void;
  onToggleItemLock?: (itemId: string) => void;
  project?: Project;
}) {
  const [tab, setTab] = useState<LayerTab>("objects");
  const [collapsed, setCollapsed] = useState<Set<FloorCategory>>(new Set());

  // Auto-expand folder when an item in it is selected
  useEffect(() => {
    if (!sel) return;
    let targetCat: FloorCategory | null = null;
    if (sel.kind === "figure") targetCat = "cast";
    else if (sel.kind === "camera") targetCat = "cameras";
    else if (sel.kind === "item") {
      const foundItem = items.find((i) => i.id === sel.id);
      if (foundItem) {
        targetCat = project ? stageItemCategory(project, foundItem) : categoryForItem(foundItem.kind);
      }
    }
    if (targetCat) {
      setCollapsed((prev) => {
        if (!prev.has(targetCat!)) return prev;
        const next = new Set(prev);
        next.delete(targetCat!);
        return next;
      });
    }
  }, [sel, items, project]);

  const toggleCollapse = (cat: FloorCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const getItemCategory = (it: FloorItem): FloorCategory =>
    project ? stageItemCategory(project, it) : categoryForItem(it.kind);

  const getCategoryItems = (catId: FloorCategory) => {
    switch (catId) {
      case "cast":
        return figures.map((f) => ({
          id: f.id,
          kind: "figure" as const,
          name: f.name,
          figure: f,
        }));
      case "cameras":
        return cameras.map((c) => ({
          id: c.id,
          kind: "camera" as const,
          name: c.setup ? `Camera ${c.setup}` : "Camera",
          camera: c,
        }));
      default:
        return items
          .filter((it) => getItemCategory(it) === catId)
          .map((it) => ({
            id: it.id,
            kind: "item" as const,
            name: it.label || it.kind,
            item: it,
          }));
    }
  };

  const totalObjects = figures.length + cameras.length + items.length;

  return (
    <aside
      aria-label="Floor plan layers"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-card text-foreground",
        embedded ? "min-h-36 flex-1" : "w-48 shrink-0 border-l border-border",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-2 py-1.5">
        <div className="flex rounded-md bg-secondary/80 p-0.5" role="tablist" aria-label="Layer types">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "objects"}
            onClick={() => setTab("objects")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              tab === "objects" ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Objects {totalObjects > 0 ? `(${totalObjects})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "setups"}
            onClick={() => setTab("setups")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              tab === "setups" ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Setups {shots.length > 0 ? `(${shots.length})` : ""}
          </button>
        </div>
        {tab === "setups" ? (
          <Button
            size="sm"
            variant={solo ? "secondary" : "ghost"}
            className="h-6 px-1.5 text-[10px]"
            aria-pressed={solo}
            onClick={() => onSolo(!solo)}
          >
            Solo
          </Button>
        ) : null}
      </div>

      {tab === "objects" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {CATEGORY_ORDER.map((catId) => {
            const cat = FLOOR_CATEGORIES.find((c) => c.id === catId) ?? {
              id: catId,
              label: catId,
              description: "",
            };
            const catItems = getCategoryItems(catId);
            const isHidden = categoryHidden.has(cat.id);
            const isLocked = categoryLocked.has(cat.id);
            const isCollapsed = collapsed.has(cat.id);

            return (
              <div key={cat.id} className="border-b border-border/70 last:border-b-0">
                {/* Category Header Row */}
                <div
                  className={cn(
                    "flex items-center justify-between px-2 py-1.5 transition-colors select-none",
                    isHidden ? "bg-muted/20 opacity-70" : "hover:bg-secondary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapse(cat.id)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    aria-expanded={!isCollapsed}
                    aria-label={`Toggle ${cat.label} layer folder`}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/80" />
                    ) : (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/80" />
                    )}
                    <span className="truncate text-xs font-semibold text-foreground" title={cat.description}>
                      {cat.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      ({catItems.length})
                    </span>
                  </button>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`${isHidden ? "Show" : "Hide"} ${cat.label}`}
                      title={isHidden ? "Category hidden (click to show)" : "Category visible (click to hide)"}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => onToggleCategoryVisibility?.(cat.id)}
                    >
                      {isHidden ? <EyeOff className="size-3.5 text-muted-foreground/70" /> : <Eye className="size-3.5" />}
                    </button>

                    {onToggleCategoryLock ? (
                      <button
                        type="button"
                        aria-label={`${isLocked ? "Unlock" : "Lock"} ${cat.label}`}
                        title={isLocked ? "Category locked (click to unlock)" : "Lock category"}
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
                          isLocked
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() => onToggleCategoryLock(cat.id)}
                      >
                        {isLocked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Individual Objects in Category */}
                {!isCollapsed ? (
                  catItems.length === 0 ? (
                    <div className="py-1 pl-7 pr-2 text-[11px] italic text-muted-foreground/50">
                      No items on this setup
                    </div>
                  ) : (
                    <ul className="pb-1" role="list" aria-label={`${cat.label} objects`}>
                      {catItems.map((obj) => {
                        const isSelected = sel?.kind === obj.kind && sel.id === obj.id;
                        const isSoloed = soloTarget?.kind === obj.kind && soloTarget.id === obj.id;
                        const itemObj = "item" in obj ? obj.item : undefined;
                        const figObj = "figure" in obj ? obj.figure : undefined;
                        const camObj = "camera" in obj ? obj.camera : undefined;
                        const isItemLocked = itemObj?.locked || isLocked;

                        const ItemIcon =
                          obj.kind === "figure"
                            ? User
                            : obj.kind === "camera"
                              ? Video
                              : itemObj
                                ? KIND_ICONS[itemObj.kind] || Box
                                : Box;

                        return (
                          <li key={`${obj.kind}-${obj.id}`}>
                            <div
                              role="button"
                              tabIndex={0}
                              aria-selected={isSelected}
                              onClick={() => onSelectTarget?.({ kind: obj.kind, id: obj.id })}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                onToggleSoloTarget?.({ kind: obj.kind, id: obj.id });
                              }}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onSelectTarget?.({ kind: obj.kind, id: obj.id });
                                }
                              }}
                              className={cn(
                                "group flex items-center justify-between py-1 pl-6 pr-2 cursor-pointer transition-colors text-xs select-none",
                                isSelected
                                  ? "bg-accent text-accent-foreground font-semibold border-l-2 border-primary"
                                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                                isHidden && "opacity-45",
                              )}
                              title={`${obj.name} · Click to select · Double-click to solo`}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                {figObj ? (
                                  <span
                                    className="size-2.5 shrink-0 rounded-full border border-border"
                                    style={{ backgroundColor: figureColor(figObj.id) }}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ItemIcon
                                    className={cn(
                                      "size-3.5 shrink-0",
                                      camObj
                                        ? "text-primary"
                                        : isSelected
                                          ? "text-foreground"
                                          : "text-muted-foreground",
                                    )}
                                    aria-hidden="true"
                                  />
                                )}

                                <span className="truncate">{obj.name}</span>

                                {camObj?.setup && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                    {camObj.fov ? `${camObj.fov}°` : ""}
                                  </span>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-1">
                                {isSoloed ? (
                                  <span className="rounded border border-amber-500/40 bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                                    SOLO
                                  </span>
                                ) : null}

                                {onToggleSoloTarget ? (
                                  <button
                                    type="button"
                                    aria-label={`Solo ${obj.name}`}
                                    title={isSoloed ? "Soloed (click to exit)" : "Solo this item"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleSoloTarget({ kind: obj.kind, id: obj.id });
                                    }}
                                    className={cn(
                                      "flex size-5 items-center justify-center rounded transition-opacity",
                                      isSoloed
                                        ? "text-amber-500"
                                        : "opacity-0 group-hover:opacity-80 hover:!opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    <Focus className="size-2.5" />
                                  </button>
                                ) : null}

                                {itemObj && onToggleItemLock ? (
                                  <button
                                    type="button"
                                    aria-label={`${itemObj.locked ? "Unlock" : "Lock"} ${obj.name}`}
                                    title={itemObj.locked ? "Item locked" : "Lock item"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleItemLock(itemObj.id);
                                    }}
                                    className={cn(
                                      "flex size-5 items-center justify-center rounded transition-opacity",
                                      itemObj.locked
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "opacity-0 group-hover:opacity-80 hover:!opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {itemObj.locked ? (
                                      <Lock className="size-2.5" />
                                    ) : (
                                      <Unlock className="size-2.5" />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {shots.map((shot) => {
            const active = shot.id === currentId;
            const off = hidden.has(shot.id);
            const dim = solo && !active;
            return (
              <li key={shot.id}>
                <div
                  className={cn(
                    "flex items-center gap-1 border-b border-border px-1.5 py-1",
                    active ? "bg-accent" : "hover:bg-secondary",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`${off ? "Show" : "Hide"} ${coverageLabel(shot)}${dim ? "; hidden by Solo" : ""}`}
                    title={dim ? "Hidden while another setup is soloed" : off ? "Hidden" : "Visible"}
                    className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onToggle(shot.id)}
                  >
                    {off || dim ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(shot.id)}
                    className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", LINE_COLOR_BG[shot.lineColor])} />
                    <span className="min-w-0">
                      <span className="block truncate font-script text-xs font-semibold">{coverageLabel(shot)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{shot.title}</span>
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

