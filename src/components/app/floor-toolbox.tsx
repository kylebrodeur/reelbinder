import {
  AppWindow,
  Armchair,
  Box,
  Circle,
  CircleDot,
  Disc,
  DoorOpen,
  GripVertical,
  Hash,
  MoveRight,
  Square,
  SquareDashed,
  Tag,
  Users,
  Video,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOLBOX_GROUPS } from "@/lib/floor";
import { markColor } from "@/lib/marks";
import type { CharacterBible, FloorKind, ScriptMark } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export function FloorToolbox({
  activeKind,
  placingCamera,
  placingFigureId = null,
  characters = [],
  sceneMarks = [],
  projectId,
  onPlace,
  onPlaceFigure,
  onPlaceProp,
  onCamera,
  hasCamera = false,
}: {
  activeKind: FloorKind | null;
  placingCamera: boolean;
  placingFigureId?: string | null;
  characters?: CharacterBible[];
  sceneMarks?: ScriptMark[];
  projectId?: string;
  onPlace: (kind: FloorKind) => void;
  onPlaceFigure?: (id: string, name: string) => void;
  onPlaceProp?: (mark: ScriptMark) => void;
  onCamera: () => void;
  hasCamera?: boolean;
}) {
  const propMarks = sceneMarks.filter(
    (m) =>
      m.tag === "prop" ||
      m.tag === "dressing" ||
      m.tag === "wardrobe" ||
      m.tag === "vehicle" ||
      m.tag === "sfx" ||
      m.tag === "vfx",
  );

  return (
    <div role="toolbar" aria-label="Add to plan" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-card px-2 py-3 text-foreground">
      <div className="flex items-center justify-between">
        <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">Floor Toolbox</p>
        <span className="text-[10px] text-muted-foreground/60">drag / click</span>
      </div>

      {TOOLBOX_GROUPS.map((g) => (
        <div key={g.id}>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((it) => {
              const Icon = KIND_ICONS[it.kind] || Square;
              const active = activeKind === it.kind;
              return (
                <button
                  key={it.kind}
                  type="button"
                  draggable={Boolean(projectId)}
                  onDragStart={(e) => {
                    if (!projectId) return;
                    e.dataTransfer.setData(
                      "application/json",
                      JSON.stringify({
                        projectId,
                        type: "item",
                        kind: it.kind,
                        label: it.label,
                      }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={cn(
                    "group flex flex-col items-center justify-center gap-1 rounded border p-1.5 text-[11px] font-medium transition select-none cursor-grab active:cursor-grabbing",
                    active
                      ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                      : "border-border/60 bg-muted/30 text-foreground/80 hover:border-border hover:bg-muted/70 hover:text-foreground",
                  )}
                  aria-pressed={active}
                  title={`Drag or click to place ${it.label.toLowerCase()}`}
                  onClick={() => onPlace(it.kind)}
                >
                  <Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="truncate max-w-full leading-tight">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Cast placement from production book */}
      {characters.length > 0 && onPlaceFigure ? (
        <div>
          <p className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3" /> Cast
            </span>
          </p>
          <div className="flex flex-col gap-1">
            {characters.map((c) => {
              const active = placingFigureId === c.name.toLowerCase();
              return (
                <button
                  key={c.name}
                  type="button"
                  draggable={Boolean(projectId)}
                  onDragStart={(e) => {
                    if (!projectId) return;
                    e.dataTransfer.setData(
                      "application/json",
                      JSON.stringify({
                        projectId,
                        type: "cast",
                        name: c.name,
                        id: c.name.toLowerCase().replace(/\s+/g, "-"),
                      }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition select-none cursor-grab active:cursor-grabbing text-left",
                    active
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border/50 bg-muted/20 text-foreground/80 hover:border-border hover:bg-muted/60 hover:text-foreground",
                  )}
                  aria-pressed={active}
                  title={`Drag or click to place ${c.name} on the floor`}
                  onClick={() => onPlaceFigure(c.name.toLowerCase(), c.name)}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span className="truncate flex-1">{c.name}</span>
                  <GripVertical className="size-3 shrink-0 text-muted-foreground/40" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Script marks / props placement */}
      {propMarks.length > 0 && onPlaceProp ? (
        <div>
          <p className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center gap-1">
              <Tag className="size-3" /> Props & Set
            </span>
          </p>
          <div className="flex flex-col gap-1">
            {propMarks.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                draggable={Boolean(projectId)}
                onDragStart={(e) => {
                  if (!projectId) return;
                  e.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({
                      projectId,
                      type: "prop",
                      kind: "rect",
                      label: m.text,
                      markId: m.id,
                      productionItemId: m.productionItemId,
                    }),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className="flex items-center gap-1.5 rounded border border-border/50 bg-muted/20 px-2 py-1 text-xs transition select-none cursor-grab active:cursor-grabbing text-left hover:border-border hover:bg-muted/60"
                style={{ color: markColor(m.tag) }}
                title={`Drag or click to place ${m.text} (${m.tag}) on the plan`}
                onClick={() => onPlaceProp(m)}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full border"
                  style={{
                    borderColor: markColor(m.tag),
                    backgroundColor: markColor(m.tag),
                  }}
                />
                <span className="truncate flex-1">{m.text}</span>
                <GripVertical className="size-3 shrink-0 opacity-40" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="pt-1">
        <Button
          size="sm"
          variant={placingCamera ? "secondary" : "outline"}
          className={cn(
            "w-full justify-start gap-2 text-xs",
            placingCamera && "border-primary font-medium",
          )}
          aria-pressed={placingCamera}
          title={hasCamera ? "Select this setup's camera" : "Add the current setup's camera, then click the plan to place it"}
          onClick={onCamera}
        >
          <Video className="size-3.5 text-primary" />
          <span>{hasCamera ? "Camera Placed" : "Add Camera"}</span>
        </Button>
      </div>
    </div>
  );
}

export function kindClass(active: boolean) {
  return cn(active ? "bg-card text-foreground" : "text-muted-foreground");
}
