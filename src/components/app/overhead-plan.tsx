import { prepareStageDrop, stageItemLocked, stageItemCategory, floorLinkDiagnostics, linkFloorMark } from "@/lib/stage-format";
import { toast } from "sonner";
import { FloorInspector } from "@/components/app/floor-inspector";
import { FloorLayers } from "@/components/app/floor-layers";
import { FloorToolbox } from "@/components/app/floor-toolbox";
import {
  Eye,
  Grid3X3,
  Hash,
  Layers,
  Magnet,
  MousePointer2,
  Redo2,
  RotateCw,
  Square,
  Trash2,
  Undo2,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OriginalInset } from "@/components/app/original-inset";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  blockingForSetup,
  cameraColor,
  cameraForShot,
  categoryForItem,
  chevronPoints,
  clampFloorItemPosition,
  clientToFloor,
  facingFrom,
  figuresForShot,
  figureColor,
  FLOOR_H,
  FLOOR_W,
  fovForCoverageSize,
  pathD,
  splineD,
  cameraSpline,
  rotateHandle,
  shortFigureName,
  snapAngle,
  defaultItemSize,
  SET_KINDS,
  layerVisible,
  STRUCTURAL_KINDS,
  toFloorPx,
  wedgePoints,
  type FloorCategory,
} from "@/lib/floor";
import { useHistory } from "@/lib/history";
import { matchCharacter } from "@/lib/cast";
import { coverageLabel } from "@/lib/lining";
import { useSlate } from "@/lib/store";
import type { FloorCamera, FloorFigure, FloorItem, FloorKind, FloorPlan, Shot } from "@/lib/types";
import { uid, cn } from "@/lib/utils";

type Tool = "select" | "rotate" | "erase" | "eyeline";
type Place =
  | { type: "figure"; id: string; name: string }
  | { type: "camera" }
  | { type: "item"; kind: FloorKind; markId?: string; productionItemId?: string; label?: string };
type Drag =
  | { kind: "figure"; id: string; mode: "move" | "rotate" }
  | { kind: "camera"; id: string; mode: "move" | "rotate" }
  | { kind: "item"; id: string; mode: "move" | "rotate" }
  | { kind: "eyeline"; fromId: string; fromKind: "figure" | "camera"; current: { x: number; y: number } };
type Sel =
  | { kind: "figure"; id: string }
  | { kind: "camera"; id: string }
  | { kind: "item"; id: string }
  | null;

function pointerToPlan(event: { clientX: number; clientY: number }, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return clientToFloor(event, svg);
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return {
    x: Math.max(0, Math.min(1, local.x / FLOOR_W)),
    y: Math.max(0, Math.min(1, local.y / FLOOR_H)),
  };
}

export function OverheadPlan({
  shot,
  editable = true,
  compact = false,
  originalUrl = null,
  className,
  selectedFigureId = null,
  onSelectFigure,
  previewFigures = null,
  previewCam = null,
  playing = false,
  fill = false,
  layerShots = [],
  solo = true,
  hiddenShotIds = [],
  onSolo,
  onToggleLayer,
  onSelectShot,
}: {
  shot: Shot | null;
  editable?: boolean;
  compact?: boolean;
  originalUrl?: string | null;
  className?: string;
  selectedFigureId?: string | null;
  onSelectFigure?: (id: string | null) => void;
  previewFigures?: FloorFigure[] | null;
  previewCam?: FloorCamera | null;
  playing?: boolean;
  fill?: boolean;
  layerShots?: Shot[];
  solo?: boolean;
  hiddenShotIds?: string[];
  onSolo?: (v: boolean) => void;
  onToggleLayer?: (id: string) => void;
  onSelectShot?: (id: string) => void;
}) {
  const project = useSlate((s) => s.project);
  const patchFloor = useSlate((s) => s.patchFloor);
  const setBlocking = useSlate((s) => s.setBlocking);
  const capture = useHistory((s) => s.capture);
  const undo = useHistory((s) => s.undo);
  const redo = useHistory((s) => s.redo);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const floor = project.floor;
  const figures = previewFigures?.length ? previewFigures : figuresForShot(floor, shot);
  const activeCam = previewCam ?? cameraForShot(floor, shot);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [place, setPlace] = useState<Place | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [soloTarget, setSoloTarget] = useState<Sel>(null);
  const [sidebarTab, setSidebarTab] = useState<"inspector" | "layers">("inspector");

  useEffect(() => {
    setSoloTarget(null);
  }, [shot?.id]);

  const [storedCategoryHidden, setCategoryHidden] = useState<Set<FloorCategory>>(new Set());
  const [storedCategoryLocked, setCategoryLocked] = useState<Set<FloorCategory>>(new Set());
  const [preferenceProjectId, setPreferenceProjectId] = useState(project.id);
  const categoryHidden = preferenceProjectId === project.id ? storedCategoryHidden : new Set<FloorCategory>();
  const categoryLocked = preferenceProjectId === project.id ? storedCategoryLocked : new Set<FloorCategory>();
  useEffect(() => {
    setPreferenceProjectId(project.id); setCategoryHidden(new Set()); setCategoryLocked(new Set());
    setSel(null); setSoloTarget(null); setDrag(null); setPlace(null);
  }, [project.id]);
  const [rotatingAngle, setRotatingAngle] = useState<number | null>(null);
  const [snapAngleEnabled, setSnapAngleEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number; captured: boolean } | null>(null);
  const live = useRef({ figures, floor, shot, tool, place, sel, soloTarget, projectId: project.id, categoryLocked });
  live.current = { figures, floor, shot, tool, place, sel, soloTarget, projectId: project.id, categoryLocked };

  const isItemLocked = (it: FloorItem) => stageItemLocked(project, it, categoryLocked);

  const targetLocked = (target: Sel) => {
    const current = useSlate.getState().project;
    if (!editable || playing || current.id !== project.id || live.current.projectId !== project.id) return true;
    const activeSolo = live.current?.soloTarget;
    if (activeSolo && (activeSolo.kind !== target?.kind || activeSolo.id !== target?.id)) return true;
    if (target?.kind === "item") {
      const item = current.floor.items.find((entry) => entry.id === target.id);
      return !item || stageItemLocked(current, item, live.current.categoryLocked);
    }
    return target?.kind === "figure" ? live.current.categoryLocked.has("cast") : target?.kind === "camera" ? live.current.categoryLocked.has("cameras") : false;
  };
  const select = (next: Sel) => {
    setSel(next);
    onSelectFigure?.(next?.kind === "figure" ? next.id : null);
  };

  const handleDoubleClick = (target: Sel) => (e: React.MouseEvent) => {
    if (!editable || playing) return;
    e.stopPropagation();
    e.preventDefault();
    setSoloTarget((prev) =>
      prev?.kind === target?.kind && prev?.id === target?.id ? null : target,
    );
    select(target);
  };

  useEffect(() => {
    if (selectedFigureId && figures.some((f) => f.id === selectedFigureId)) {
      setSel({ kind: "figure", id: selectedFigureId });
    } else if (!selectedFigureId) {
      setSel((current) => (current?.kind === "figure" ? null : current));
    }
  }, [selectedFigureId]);

  const writeFigures = (next: FloorFigure[], shotId?: string) => {
    const id = shotId ?? live.current.shot?.id;
    if (!id) return;
    setBlocking(id, { figures: next });
  };

  const eraseTarget = (target: Sel) => {
    const cur = live.current;
    if (!target || targetLocked(target)) return;
    if (target.kind === "figure" && cur.shot) {
      capture("Edit plan");
      writeFigures(
        cur.figures.filter((f) => f.id !== target.id),
        cur.shot.id,
      );
      select(null);
      return;
    }
    if (target.kind === "item") {
      const it = cur.floor.items.find((x) => x.id === target.id);
      if (!it || isItemLocked(it)) return;
      capture("Edit plan");
      patchFloor({ items: cur.floor.items.filter((x) => x.id !== target.id) });
      select(null);
      return;
    }
    if (target.kind === "camera") {
      const cam = cur.floor.cameras.find((x) => x.id === target.id);
      if (!cam || cur.categoryLocked.has("cameras")) return;
      capture("Edit plan");
      patchFloor({ cameras: cur.floor.cameras.filter((c) => c.id !== target.id) });
      select(null);
    }
  };

  useEffect(() => {
    if (!editable) return;
    const move = (e: PointerEvent) => {
      const svg = svgRef.current;
      const d = drag;
      if (!svg || !d) return;
      if (d.kind !== "eyeline" && targetLocked(d)) return;
      if (!dragOrigin.current) return;
      if (!dragOrigin.current.captured) {
        if (Math.hypot(e.clientX - dragOrigin.current.x, e.clientY - dragOrigin.current.y) < 3)
          return;
        capture("Edit plan");
        dragOrigin.current.captured = true;
      }
      const p = pointerToPlan(e, svg);
      const { figures: figs, floor: fl, shot: sh } = live.current;
      if (d.kind === "figure" && sh) {
        if (d.mode === "rotate") {
          const fig = figs.find((f) => f.id === d.id);
          if (!fig) return;
          const rawAngle = facingFrom(fig, p);
          const angle = snapAngleEnabled ? snapAngle(rawAngle, 15) : Math.round(rawAngle);
          setRotatingAngle(angle);
          writeFigures(figs.map((f) => (f.id === d.id ? { ...f, facing: angle } : f)));
          return;
        }
        writeFigures(figs.map((f) => (f.id === d.id ? { ...f, x: p.x, y: p.y } : f)));
        return;
      }
      if (d.kind === "eyeline") {
        setDrag({ ...d, current: p });
        return;
      }
      if (d.kind === "camera") {
        const cam = fl.cameras.find((c) => c.id === d.id);
        if (!cam) return;
        if (d.mode === "rotate") {
          const rawAngle = facingFrom(cam, p);
          const angle = snapAngleEnabled ? snapAngle(rawAngle, 15) : Math.round(rawAngle);
          setRotatingAngle(angle);
          patchFloor({
            cameras: fl.cameras.map((c) =>
              c.id === d.id ? { ...c, angle } : c,
            ),
          });
          return;
        }
        patchFloor({
          cameras: fl.cameras.map((c) => (c.id === d.id ? { ...c, x: p.x, y: p.y } : c)),
        });
        return;
      }
      if (d.kind === "item") {
        const it = fl.items.find((i) => i.id === d.id);
        if (!it) return;
        if (d.mode === "rotate") {
          const rawAngle = facingFrom({ x: it.x, y: it.y }, p);
          const angle = snapAngleEnabled ? snapAngle(rawAngle, 15) : Math.round(rawAngle);
          setRotatingAngle(angle);
          patchFloor({
            items: fl.items.map((i) => (i.id === d.id ? { ...i, rotation: angle } : i)),
          });
          return;
        }
        if (isItemLocked(it)) return;
        patchFloor({
          items: fl.items.map((i) => (i.id === d.id ? { ...i, x: p.x, y: p.y } : i)),
        });
      }
    };
    const up = () => {
      if (drag?.kind === "eyeline") {
        capture("Set eyeline target");
        const { figures: figs, floor: fl } = live.current;
        const p = drag.current;
        let bestTarget: string | undefined = undefined;
        let bestDist = 15; // Hit radius

        // Check figures
        for (const f of figs) {
          if (f.id === drag.fromId) continue;
          const dist = Math.hypot(f.x - p.x, f.y - p.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestTarget = f.id;
          }
        }

        // Check cameras
        if (!bestTarget) {
          for (const c of fl.cameras) {
            if (c.id === drag.fromId) continue;
            const dist = Math.hypot(c.x - p.x, c.y - p.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = c.id;
            }
          }
        }

        // Check items
        if (!bestTarget) {
          for (const i of fl.items) {
            const dist = Math.hypot(i.x - p.x, i.y - p.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = i.id;
            }
          }
        }

        if (drag.fromKind === "figure") {
          writeFigures(figs.map((f) => {
            if (f.id === drag.fromId) {
              const updated = { ...f, targetId: bestTarget };
              if (bestTarget && snapAngleEnabled) {
                const target = figs.find(t => t.id === bestTarget) ||
                               fl.cameras.find(c => c.id === bestTarget) ||
                               fl.items.find(i => i.id === bestTarget);
                if (target && 'x' in target && 'y' in target) {
                  updated.facing = Math.round(facingFrom(f, { x: target.x, y: target.y }));
                }
              } else if (!bestTarget) {
                // Point to arbitrary location
                updated.facing = Math.round(facingFrom(f, p));
              }
              return updated;
            }
            return f;
          }));
        } else if (drag.fromKind === "camera") {
          patchFloor({
            cameras: fl.cameras.map((c) => {
              if (c.id === drag.fromId) {
                const updated = { ...c, targetId: bestTarget };
                if (bestTarget && snapAngleEnabled) {
                  const target = figs.find(t => t.id === bestTarget) ||
                                 fl.cameras.find(cam => cam.id === bestTarget) ||
                                 fl.items.find(i => i.id === bestTarget);
                  if (target && 'x' in target && 'y' in target) {
                    updated.angle = Math.round(facingFrom(c, { x: target.x, y: target.y }));
                  }
                } else if (!bestTarget) {
                  updated.angle = Math.round(facingFrom(c, p));
                }
                return updated;
              }
              return c;
            })
          });
        }
      }
      setDrag(null);
      setRotatingAngle(null);
      dragOrigin.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, editable, playing, patchFloor, categoryLocked, project.id]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const target = e.target as HTMLElement | null;
    if (!target || !rootRef.current?.contains(target)) return;
    if (e.key === "Escape") {
      if (live.current?.soloTarget) {
        e.stopPropagation();
        setSoloTarget(null);
        return;
      }
      if (!live.current.sel && !live.current.place && live.current.tool === "select") return;
      e.stopPropagation();
      select(null);
      setPlace(null);
      setTool("select");
      setDrag(null);
      dragOrigin.current = null;
      svgRef.current?.focus();
      return;
    }
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      if (!live.current.sel) return;
      e.preventDefault();
      e.stopPropagation();
      eraseTarget(live.current.sel);
    }
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editable || playing || useSlate.getState().project.id !== project.id || e.button !== 0) return;
    const p = pointerToPlan(e, e.currentTarget);
    if (place) {
      const category = place.type === "item" ? (place.productionItemId ? "furniture" : categoryForItem(place.kind)) : place.type === "figure" ? "cast" : "cameras";
      if (categoryLocked.has(category)) { toast.error("Stage: unlock this category before placing an item."); return; }
      e.preventDefault();
      capture("Edit plan");
      let placed: Sel = null;
      if (place.type === "figure" && shot) {
        if (!figures.some((f) => f.id === place.id)) {
          writeFigures([
            ...figures,
            { id: place.id, name: place.name, x: p.x, y: p.y, facing: 90 },
          ]);
        } else {
          writeFigures(
            figures.map((f) => (f.id === place.id ? { ...f, x: p.x, y: p.y } : f)),
          );
        }
        placed = { kind: "figure", id: place.id };
      } else if (place.type === "camera" && shot) {
        if (!cameraForShot(floor, shot)) {
          const id = `cam_${shot.setup}_${uid("c")}`;
          patchFloor({
            cameras: [
              ...floor.cameras,
              {
                id,
                shotId: shot.id,
                setup: shot.setup,
                x: p.x,
                y: p.y,
                angle: -90,
                fov: 34,
              },
            ],
          });
          placed = { kind: "camera", id };
        }
      } else if (place.type === "item") {
        const size = defaultItemSize(place.kind);
        const setWide = SET_KINDS.has(place.kind);
        const id = uid("fl");
        const label =
          place.label ||
          (place.kind === "mark"
            ? String(floor.items.filter((i) => i.kind === "mark").length + 1)
            : place.kind === "bar"
              ? "BAR"
              : "");
        const position = clampFloorItemPosition({ kind: place.kind, ...p, ...size });
        patchFloor({
          items: [
            ...floor.items,
            {
              id,
              kind: place.kind,
              ...position,
              ...size,
              rotation: 0,
              label,
              shotId: setWide ? null : (shot?.id ?? null),
              markId: place.markId,
              productionItemId: place.productionItemId,
            },
          ],
        });
        if (position.x !== p.x || position.y !== p.y) {
          toast.message(`Stage: placed ${label || place.kind} inside the floor plan.`);
        }
        placed = { kind: "item", id };
      }
      select(placed);
      setPlace(null);
      setTool("select");
      e.currentTarget.focus();
      return;
    }
    if (e.target === e.currentTarget || (e.target as Element).tagName === "rect") {
      select(null);
      e.currentTarget.focus();
    }
  };

  const begin = (next: { kind: "figure" | "camera" | "item"; id: string; mode?: "move" | "rotate" }, nextSel: Sel) => (e: React.PointerEvent) => {
    if (!editable || playing || e.button !== 0 || place) return;
    e.stopPropagation();
    (e.currentTarget as SVGElement).focus();
    select(nextSel);
    if (tool === "erase") {
      eraseTarget(nextSel);
      return;
    }
    if (tool === "eyeline" && (next.kind === "figure" || next.kind === "camera")) {
      if (svgRef.current) {
        setDrag({ kind: "eyeline", fromId: next.id, fromKind: next.kind, current: pointerToPlan(e, svgRef.current) });
      }
      return;
    }
    const mode = next.mode === "rotate" || tool === "rotate" || e.altKey ? "rotate" : "move";
    dragOrigin.current = { x: e.clientX, y: e.clientY, captured: false };
    setDrag((next.kind === "item" ? { ...next, mode: "move" } : { ...next, mode }) as Drag);
  };

  const resetSetup = () => {
    if (!shot || targetLocked({ kind: "figure", id: "" })) return;
    capture("Edit plan");
    writeFigures(blockingForSetup(floor, shot.setup));
    select(null);
  };

  const unusedHomes = (floor.homes ?? []).filter((h) => !figures.some((f) => f.id === h.id));
  const onPlan = (name: string) => {
    return figures.some(
      (f) =>
        matchCharacter(project.characters, f.name)?.name ===
          matchCharacter(project.characters, name)?.name ||
        f.name.toLowerCase() === name.toLowerCase() ||
        shortFigureName(f.name).toLowerCase() === shortFigureName(name).toLowerCase(),
    );
  };
  const bookExtras = project.characters
    .filter(
      (c) =>
        !onPlan(c.name) &&
        !unusedHomes.some(
          (h) =>
            matchCharacter(project.characters, h.name)?.name === c.name ||
            shortFigureName(h.name).toLowerCase() === shortFigureName(c.name).toLowerCase(),
        ),
    )
    .map((c) => ({
      id: c.name.toLowerCase().replace(/\s+/g, "-"),
      name: shortFigureName(c.name),
    }));
  const hidden = new Set(hiddenShotIds);
  const studio = editable && !compact;
  const sceneShots = layerShots.length
    ? layerShots
    : project.shots.filter((s) => (shot ? s.sceneId === shot.sceneId : true));
  const sceneMarks = project.marks.filter((m) => !shot?.sceneId || m.sceneId === shot.sceneId);
  const visibleItems = floor.items.filter((it) =>
    layerVisible(it.shotId, shot?.id ?? null, solo, hidden) &&
    !categoryHidden.has(stageItemCategory(project, it)),
  );
  const resolveTargetPosition = (targetId: string | null | undefined): { x: number; y: number } | null => {
    if (!targetId) return null;
    const targetFig = figures.find((f) => f.id === targetId);
    if (targetFig) return { x: targetFig.x, y: targetFig.y };
    const targetItem = floor.items.find((i) => i.id === targetId);
    if (targetItem) return { x: targetItem.x, y: targetItem.y };
    return null;
  };

  const visibleCams = floor.cameras
    .filter((c) => {
      if (categoryHidden.has("cameras")) return false;
      if (c.id === activeCam?.id) return true;
      const owner = c.shotId || sceneShots.find((s) => s.setup === c.setup)?.id || null;
      return layerVisible(owner, shot?.id ?? null, solo, hidden);
    })
    .map((c) => {
      const active = c.id === activeCam?.id && activeCam ? activeCam : c;
      if (active.rotationMode === "target" && active.targetId && !previewCam) {
        const targetPos = resolveTargetPosition(active.targetId);
        if (targetPos) {
          const camPx = toFloorPx(active);
          const targetPx = toFloorPx(targetPos);
          return { ...active, angle: Math.round(facingFrom(camPx, targetPx)) };
        }
      }
      return active;
    });

  const currentSetupCam = cameraForShot(floor, shot) ?? null;
  const nextShot = sceneShots.find((s, idx, arr) => arr[idx - 1]?.id === shot?.id) ?? null;
  const nextCam = nextShot ? (cameraForShot(floor, nextShot) ?? null) : null;
  const cameraTrackSpline = currentSetupCam ? cameraSpline(currentSetupCam, nextCam) : [];
  const visibleFigures = categoryHidden.has("cast") ? [] : figures;
  const ghosts =
    solo || !shot || categoryHidden.has("cast")
      ? []
      : sceneShots.flatMap((s) => {
          if (s.id === shot.id || hidden.has(s.id)) return [];
          return figuresForShot(floor, s).map((f) => ({ shot: s, figure: f }));
        });

  const selectedFigure = sel?.kind === "figure" ? figures.find((f) => f.id === sel.id) : undefined;
  const selectedCam =
    sel?.kind === "camera" ? floor.cameras.find((c) => c.id === sel.id) : undefined;
  const selectedItem = sel?.kind === "item" ? floor.items.find((i) => i.id === sel.id) : undefined;
  const soloTargetLabel = soloTarget
    ? soloTarget.kind === "figure"
      ? figures.find((f) => f.id === soloTarget.id)?.name || "Actor"
      : soloTarget.kind === "camera"
        ? `Camera ${floor.cameras.find((c) => c.id === soloTarget.id)?.setup || ""}`
        : floor.items.find((i) => i.id === soloTarget.id)?.label ||
          floor.items.find((i) => i.id === soloTarget.id)?.kind ||
          "Item"
    : null;
  useEffect(() => {
    if (sel && !selectedFigure && !selectedCam && !selectedItem) select(null);
  }, [sel, selectedFigure, selectedCam, selectedItem]);
  const canErase = Boolean(
    !targetLocked(sel) && (selectedFigure ||
    (selectedItem && !STRUCTURAL_KINDS.has(selectedItem.kind)) ||
    (selectedCam && selectedCam.id !== activeCam?.id)),
  );
  const selectFromKeyboard = (target: Sel) => (event: React.KeyboardEvent) => {
    if (!editable || playing || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    setPlace(null);
    select(target);
  };

  const patchSelectedName = (label: string) => {
    if (targetLocked(sel)) return;
    if (sel?.kind === "camera" && selectedCam?.shotId && label !== selectedCam.setup) { toast.error("Choose Linked setup to change this camera’s setup."); return; }
    capture("Edit plan");
    if (sel?.kind === "figure" && shot) {
      writeFigures(figures.map((f) => (f.id === sel.id ? { ...f, name: label } : f)));
    } else if (sel?.kind === "camera") {
      patchFloor({
        cameras: floor.cameras.map((c) => (c.id === sel.id ? { ...c, setup: label } : c)),
      });
    } else if (sel?.kind === "item") {
      patchFloor({ items: floor.items.map((i) => (i.id === sel.id ? { ...i, label } : i)) });
    }
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={onKey}
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-script",
        fill && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      {editable && !compact ? (
        <FloorToolbar
          tool={tool}
          place={place}
          onTool={(t) => {
            setTool(t);
            setPlace(null);
          }}
          onPlace={setPlace}
          unusedHomes={unusedHomes}
          bookExtras={bookExtras}
          onReset={resetSetup}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onErase={() => eraseTarget(sel)}
          canErase={canErase}
          slim={studio}
          shot={shot}
          snapAngleEnabled={snapAngleEnabled}
          onToggleSnapAngle={() => setSnapAngleEnabled((prev) => !prev)}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((prev) => !prev)}
        />
      ) : null}
      <div className={cn(studio && "flex min-h-0 flex-1")}>
        {studio ? (
          <div className="flex min-h-0 w-44 shrink-0 flex-col border-r border-border bg-card text-foreground">
            <FloorToolbox
              activeKind={place?.type === "item" ? place.kind : null}
              placingCamera={place?.type === "camera"}
              placingFigureId={place?.type === "figure" ? place.id : null}
              characters={project.characters}
              sceneMarks={sceneMarks}
              projectId={project.id}
              onPlace={(kind) => {
                setTool("select");
                select(null);
                setPlace({ type: "item", kind });
              }}
              onPlaceFigure={(id, name) => {
                setTool("select");
                select(null);
                setPlace({ type: "figure", id, name });
              }}
              onPlaceProp={(mark) => {
                setTool("select");
                select(null);
                setPlace({
                  type: "item",
                  kind: "rect",
                  markId: mark.id,
                  productionItemId: mark.productionItemId,
                  label: mark.text,
                });
              }}
              onCamera={() => {
                setTool("select");
                if (activeCam) {
                  setPlace(null);
                  select({ kind: "camera", id: activeCam.id });
                } else {
                  select(null);
                  setPlace({ type: "camera" });
                }
              }}
              hasCamera={!!activeCam}
            />
          </div>
        ) : null}
        <div className={cn("relative min-w-0", studio && "flex min-h-0 flex-1 flex-col")}>
          {soloTarget ? (
            <div className="absolute top-2 left-2 z-20 flex items-center gap-2 rounded-full border border-amber-500/40 bg-background/95 px-3 py-1 shadow-md backdrop-blur-xs text-xs">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-semibold text-foreground">
                Solo: {soloTargetLabel}
              </span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                (Move isolated · Double-click or Esc to exit)
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-4 p-0 text-muted-foreground hover:text-foreground ml-0.5"
                onClick={() => setSoloTarget(null)}
                title="Exit solo mode (Esc)"
                aria-label="Exit solo mode"
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : null}
          <OriginalInset
            originalUrl={originalUrl}
            originalAlt="Original production overhead"
            originalCaption="Original production sketch — working plan is generated."
            workingLabel="Plan"
            compact={compact}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${FLOOR_W} ${FLOOR_H}`}
              className={cn(
                "block w-full touch-none",
                fill ? "h-full min-h-0" : "h-auto",
                editable && (place ? "cursor-crosshair" : "cursor-default"),
              )}
              role={editable ? "group" : "img"}
              tabIndex={editable ? 0 : undefined}
              aria-label={`${floor.label || "Overhead"} ${shot ? coverageLabel(shot) : ""}`}
              onPointerDown={onSvgPointerDown}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget || (e.target as Element).tagName === "rect") {
                  setSoloTarget(null);
                }
              }}
              onDragOver={(e) => {
                if (!editable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                if (!editable || playing) return;
                e.preventDefault();
                const raw = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
                try {
                  const state = useSlate.getState();
                  const current = state.project;
                  const expectedShotId = shot?.id ?? null;
                  const liveShotId = live.current.shot?.id ?? null;
                  const selected = current.shots.find((entry) => entry.id === state.selectedId) ?? current.shots[0] ?? null;
                  if (live.current.projectId !== project.id || current.id !== project.id) throw new Error("Stage: the Project changed during the drag. Drag the item again.");
                  if (liveShotId !== expectedShotId || (expectedShotId !== null && selected?.id !== expectedShotId)) throw new Error("Stage: the setup changed during the drag. Drag the item onto the current setup again.");
                  // A deliberate shot=null overview remains set-wide; a selected setup
                  // uses the same first-shot fallback as the Stage workspace.
                  const locks = live.current.categoryLocked;
                  const result = prepareStageDrop(current, project.id, shot?.id ?? null, raw, pointerToPlan(e, e.currentTarget), uid("fl"));
                  if (result.kind === "item") {
                    const placed = result.items[result.items.length - 1];
                    if (stageItemLocked(current, placed, locks)) throw new Error("Stage: unlock this category before placing an item.");
                  } else if (locks.has("cast")) throw new Error("Stage: unlock Cast before placing a person.");
                  capture("Drop onto stage");
                  if (result.kind === "item") {
                    patchFloor({ items: result.items });
                    if (result.clamped) toast.message("Stage: placed the item inside the floor plan.");
                  } else {
                    setBlocking(result.shotId, { figures: result.figures });
                  }
                  select({ kind: result.kind, id: result.id });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Stage: unable to place this item.");
                }
              }}
            >
              <rect width={FLOOR_W} height={FLOOR_H} className="fill-script" />
              {showGrid ? (
                <>
                  <defs>
                    <pattern
                      id="overhead-floor-grid"
                      width="32"
                      height="32"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="16" cy="16" r="0.75" fill="currentColor" className="text-muted-foreground/30" />
                    </pattern>
                  </defs>
                  <rect
                    width={FLOOR_W}
                    height={FLOOR_H}
                    fill="url(#overhead-floor-grid)"
                    pointerEvents="none"
                  />
                </>
              ) : null}
              {visibleItems.map((it) => {
                const isSoloed = soloTarget?.kind === "item" && soloTarget.id === it.id;
                const isDimmed = Boolean(soloTarget && !isSoloed);
                return (
                  <FloorShape
                    key={it.id}
                    item={it}
                    selected={sel?.kind === "item" && sel.id === it.id}
                    soloed={isSoloed}
                    dimmed={isDimmed}
                    editable={editable}
                    onPointerDown={begin(
                      { kind: "item", id: it.id, mode: "move" },
                      { kind: "item", id: it.id },
                    )}
                    onRotate={begin(
                      { kind: "item", id: it.id, mode: "rotate" },
                      { kind: "item", id: it.id },
                    )}
                    onKeyDown={selectFromKeyboard({ kind: "item", id: it.id })}
                    onDoubleClick={handleDoubleClick({ kind: "item", id: it.id })}
                  />
                );
              })}
              {floor.path.length > 1 ? (
                <path
                  d={pathD(floor.path)}
                  fill="none"
                  stroke="var(--color-script-ink)"
                  strokeWidth="0.7"
                  strokeDasharray="2 2"
                  opacity="0.35"
                />
              ) : null}
              {/* Render existing eyelines */}
              {visibleFigures.map((f) => {
                if (!f.targetId) return null;
                const target = visibleFigures.find(t => t.id === f.targetId) ||
                               floor.cameras.find(c => c.id === f.targetId) ||
                               visibleItems.find(i => i.id === f.targetId);
                if (!target || !('x' in target)) return null;
                return (
                  <line
                    key={`eyeline-${f.id}`}
                    x1={f.x}
                    y1={f.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="var(--color-mark-eyeline)"
                    strokeWidth="0.8"
                    strokeDasharray="2 2"
                    opacity="0.6"
                    pointerEvents="none"
                  />
                );
              })}
              {floor.cameras.map((c) => {
                if (!c.targetId) return null;
                const target = visibleFigures.find(t => t.id === c.targetId) ||
                               floor.cameras.find(cam => cam.id === c.targetId) ||
                               visibleItems.find(i => i.id === c.targetId);
                if (!target || !('x' in target)) return null;
                return (
                  <line
                    key={`eyeline-${c.id}`}
                    x1={c.x}
                    y1={c.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="var(--color-mark-eyeline)"
                    strokeWidth="0.8"
                    strokeDasharray="2 2"
                    opacity="0.6"
                    pointerEvents="none"
                  />
                );
              })}
              {/* Render active drag eyeline */}
              {drag?.kind === "eyeline" ? (() => {
                const origin = drag.fromKind === "figure"
                  ? figures.find((fig) => fig.id === drag.fromId)
                  : floor.cameras.find((c) => c.id === drag.fromId);
                if (!origin) return null;
                return (
                  <line
                    x1={origin.x}
                    y1={origin.y}
                    x2={drag.current.x}
                    y2={drag.current.y}
                    stroke="var(--color-mark-eyeline)"
                    strokeWidth="0.8"
                    strokeDasharray="2 2"
                    opacity="0.8"
                    pointerEvents="none"
                  />
                );
              })() : null}
              {cameraTrackSpline.length > 1 && !categoryHidden.has("cameras") && shot?.movement && shot.movement !== "static" && !shot.movement.startsWith("pan-") && !shot.movement.startsWith("tilt-") ? (
                <g className="camera-motion-track">
                  <path
                    d={splineD(cameraTrackSpline)}
                    fill="none"
                    stroke={cameraColor(shot)}
                    strokeWidth="1.2"
                    strokeDasharray="2.5 2"
                    opacity="0.75"
                  />
                  {cameraTrackSpline.map((pt, i) => (
                    <circle
                      key={i}
                      cx={toFloorPx(pt).x}
                      cy={toFloorPx(pt).y}
                      r="1.4"
                      fill={i === 0 ? cameraColor(shot) : "var(--color-script)"}
                      stroke={cameraColor(shot)}
                      strokeWidth="0.8"
                    />
                  ))}
                </g>
              ) : null}
              {/* Target tracking sightlines */}
              {visibleCams.map((c) => {
                if (c.rotationMode !== "target" || !c.targetId) return null;
                const targetPos = resolveTargetPosition(c.targetId);
                if (!targetPos) return null;
                const camPx = toFloorPx(c);
                const tgtPx = toFloorPx(targetPos);
                const camColor = cameraColor(project.shots.find((s) => s.id === c.shotId || s.setup === c.setup) ?? shot);
                const isSelectedOrActive = (sel?.kind === "camera" && sel.id === c.id) || c.id === activeCam?.id;
                return (
                  <g key={`target-line-${c.id}`} pointerEvents="none" opacity={isSelectedOrActive ? 0.85 : 0.45}>
                    <line
                      x1={camPx.x}
                      y1={camPx.y}
                      x2={tgtPx.x}
                      y2={tgtPx.y}
                      stroke={camColor}
                      strokeWidth="0.8"
                      strokeDasharray="2 2"
                    />
                    <circle
                      cx={tgtPx.x}
                      cy={tgtPx.y}
                      r="3.5"
                      fill="none"
                      stroke={camColor}
                      strokeWidth="0.75"
                      strokeDasharray="1.5 1.5"
                    />
                    <circle
                      cx={tgtPx.x}
                      cy={tgtPx.y}
                      r="1"
                      fill={camColor}
                    />
                  </g>
                );
              })}
              {visibleCams.map((c) => {
                const isSoloed = soloTarget?.kind === "camera" && soloTarget.id === c.id;
                const isDimmed = Boolean(soloTarget && !isSoloed);
                return (
                  <CameraMark
                    key={c.id}
                    cam={c}
                    active={c.id === activeCam?.id}
                    selected={sel?.kind === "camera" && sel.id === c.id}
                    soloed={isSoloed}
                    dimmed={isDimmed}
                    shot={project.shots.find((s) => s.id === c.shotId || s.setup === c.setup) ?? shot}
                    compact={compact}
                    editable={editable}
                    onKeyDown={selectFromKeyboard({ kind: "camera", id: c.id })}
                    onPointerDown={begin(
                      { kind: "camera", id: c.id, mode: "move" },
                      { kind: "camera", id: c.id },
                    )}
                    onRotate={begin(
                      { kind: "camera", id: c.id, mode: "rotate" },
                      { kind: "camera", id: c.id },
                    )}
                    onDoubleClick={handleDoubleClick({ kind: "camera", id: c.id })}
                  />
                );
              })}
              {ghosts.map(({ shot: gs, figure: gf }) => (
                <BodyMark
                  key={`ghost-${gs.id}-${gf.id}`}
                  figure={gf}
                  compact
                  selected={false}
                  dimmed={Boolean(soloTarget)}
                  editable={false}
                  opacity={soloTarget ? 0.08 : 0.28}
                  onPointerDown={() => onSelectShot?.(gs.id)}
                  onRotate={() => undefined}
                />
              ))}
              {visibleFigures.map((f) => {
                const isSoloed = soloTarget?.kind === "figure" && soloTarget.id === f.id;
                const isDimmed = Boolean(soloTarget && !isSoloed);
                return (
                  <BodyMark
                    key={f.id}
                    figure={f}
                    compact={compact}
                    selected={
                      (sel?.kind === "figure" && sel.id === f.id) || selectedFigureId === f.id
                    }
                    soloed={isSoloed}
                    dimmed={isDimmed}
                    editable={editable}
                    onKeyDown={selectFromKeyboard({ kind: "figure", id: f.id })}
                    onPointerDown={begin(
                      { kind: "figure", id: f.id, mode: "move" },
                      { kind: "figure", id: f.id },
                    )}
                    onRotate={begin(
                      { kind: "figure", id: f.id, mode: "rotate" },
                      { kind: "figure", id: f.id },
                    )}
                    onDoubleClick={handleDoubleClick({ kind: "figure", id: f.id })}
                  />
                );
              })}
              {/* Floating angle readout badge */}
              {rotatingAngle !== null ? (
                <g pointerEvents="none">
                  <rect
                    x={FLOOR_W / 2 - 12}
                    y={5}
                    width={24}
                    height={8}
                    rx={2}
                    fill="var(--color-card)"
                    stroke="var(--color-border)"
                    strokeWidth={0.8}
                  />
                  <text
                    x={FLOOR_W / 2}
                    y={10.8}
                    textAnchor="middle"
                    fill="var(--color-foreground)"
                    fontSize="4.5"
                    fontWeight="700"
                    fontFamily="monospace"
                  >
                    {Math.round(rotatingAngle)}°
                  </text>
                </g>
              ) : null}
            </svg>
          </OriginalInset>
          {editable && !compact && (place || sel) ? (
            <p
              className="border-t border-script-ink/10 px-2 py-1.5 text-xs text-script-muted"
              role="status"
            >
              {place
                ? `Click the plan to place ${place.type === "item" ? place.kind : place.type === "figure" ? place.name : "camera"}. Escape cancels.`
                : "Drag to move · Drag the round handle to turn · Escape deselects"}
            </p>
          ) : null}
        </div>
        {studio ? (
          <div className="flex min-h-0 w-56 sm:w-60 shrink-0 flex-col overflow-hidden border-l border-border bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-background px-2.5 py-1.5">
              <div className="flex items-center gap-1 rounded-md bg-secondary/80 p-0.5" role="tablist" aria-label="Overhead sidebar tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === "inspector"}
                  onClick={() => setSidebarTab("inspector")}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                    sidebarTab === "inspector"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <MousePointer2 className="size-3.5" />
                  <span>Inspector</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === "layers"}
                  onClick={() => setSidebarTab("layers")}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all",
                    sidebarTab === "layers"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layers className="size-3.5" />
                  <span>Layers</span>
                </button>
              </div>
              {sel ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    select(null);
                    svgRef.current?.focus();
                  }}
                  title="Deselect item (Esc)"
                  aria-label="Deselect item"
                >
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {sidebarTab === "inspector" ? (
                sel ? (
                  <FloorInspector
                    sel={sel}
                    figure={selectedFigure}
                    camera={selectedCam}
                    item={selectedItem}
                    shots={sceneShots}
                    characters={project.characters}
                    marks={sceneMarks}
                    onRename={patchSelectedName}
                    onRotate={(delta) => {
                      if (targetLocked(sel)) return;
                      capture("Rotate plan item");
                      if (sel?.kind === "figure") {
                        writeFigures(figures.map((f) => (f.id === sel.id ? { ...f, facing: snapAngle((f.facing || 0) + delta, 15) } : f)));
                      } else if (sel?.kind === "camera") {
                        patchFloor({
                          cameras: floor.cameras.map((c) => (c.id === sel.id ? { ...c, angle: snapAngle((c.angle || 0) + delta, 15) } : c)),
                        });
                      } else if (sel?.kind === "item") {
                        patchFloor({
                          items: floor.items.map((i) => (i.id === sel.id ? { ...i, rotation: snapAngle((i.rotation || 0) + delta, 15) } : i)),
                        });
                      }
                    }}
                    onToggleLock={() => {
                      if (!editable || playing || useSlate.getState().project.id !== project.id || sel?.kind !== "item") return;
                      capture("Toggle item lock");
                      patchFloor({
                        items: floor.items.map((i) => (i.id === sel.id ? { ...i, locked: !i.locked } : i)),
                      });
                    }}
                    onLinkMark={(markId) => {
                      if (sel?.kind !== "item" || targetLocked(sel)) return;
                      try {
                        const current = useSlate.getState().project;
                        const item = current.floor.items.find((entry) => entry.id === sel.id);
                        if (!item) throw new Error("Stage: this item no longer exists.");
                        const linked = linkFloorMark(current, item, markId);
                        capture("Link script mark");
                        patchFloor({ items: current.floor.items.map((entry) => entry.id === item.id ? linked : entry) });
                      } catch (error) { toast.error(error instanceof Error ? error.message : "Stage: unable to link this occurrence."); }
                    }}
                    onClose={() => {
                      select(null);
                      svgRef.current?.focus();
                    }}
                    canRemove={canErase}
                    disabled={playing}
                    locked={targetLocked(sel)}
                    diagnostics={selectedItem ? floorLinkDiagnostics(project, selectedItem) : []}
                    figures={figures}
                    items={floor.items}
                    isSoloed={Boolean(soloTarget && sel && soloTarget.kind === sel.kind && soloTarget.id === sel.id)}
                    onToggleSolo={() => {
                      if (!sel) return;
                      setSoloTarget((prev) =>
                        prev?.kind === sel.kind && prev?.id === sel.id ? null : sel,
                      );
                    }}
                    onUpdateCameraRotationMode={(mode) => {
                      if (sel?.kind !== "camera" || targetLocked(sel)) return;
                      capture("Edit camera rotation mode");
                      patchFloor({
                        cameras: floor.cameras.map((c) =>
                          c.id === sel.id ? { ...c, rotationMode: mode } : c,
                        ),
                      });
                    }}
                    onUpdateCameraTarget={(targetId) => {
                      if (sel?.kind !== "camera" || targetLocked(sel)) return;
                      capture("Edit camera target");
                      patchFloor({
                        cameras: floor.cameras.map((c) =>
                          c.id === sel.id ? { ...c, targetId } : c,
                        ),
                      });
                    }}
                    onUpdateFigureTarget={(targetId) => {
                      if (sel?.kind !== "figure" || targetLocked(sel)) return;
                      capture("Edit figure eyeline target");
                      writeFigures(
                        figures.map((f) =>
                          f.id === sel.id ? { ...f, targetId: targetId ?? undefined } : f,
                        ),
                      );
                    }}
                    onLinkShot={(shotId) => {
                      if (sel?.kind !== "camera" || targetLocked(sel)) return;
                      if (!sceneShots.some((entry) => entry.id === shotId)) { toast.error("Choose a current setup for this camera."); return; }
                      capture("Edit plan");
                      const linked = sceneShots.find((s) => s.id === shotId);
                      patchFloor({
                        cameras: floor.cameras.map((c) =>
                          c.id === sel.id
                            ? { ...c, shotId: shotId ?? "", setup: linked?.setup || c.setup }
                            : c,
                        ),
                      });
                    }}
                    onLinkSet={(setWide) => {
                      if (sel?.kind !== "item" || targetLocked(sel)) return;
                      capture("Edit plan");
                      patchFloor({
                        items: floor.items.map((i) =>
                          i.id === sel.id ? { ...i, shotId: setWide ? null : (shot?.id ?? null) } : i,
                        ),
                      });
                    }}
                    onRemove={() => eraseTarget(sel)}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
                    <MousePointer2 className="size-8 stroke-[1.5] mb-2 opacity-50" />
                    <p className="text-xs font-medium text-foreground">No item selected</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      Click any camera, actor, or prop on the diagram to inspect and edit its properties.
                    </p>
                  </div>
                )
              ) : (
                <FloorLayers
                  embedded
                  shots={sceneShots}
                  currentId={shot?.id ?? null}
                  solo={solo}
                  hidden={hidden}
                  onSelect={(id) => onSelectShot?.(id)}
                  onSolo={(v) => onSolo?.(v)}
                  onToggle={(id) => onToggleLayer?.(id)}
                  categoryHidden={categoryHidden}
                  categoryLocked={categoryLocked}
                  onToggleCategoryVisibility={(cat) =>
                    setCategoryHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      return next;
                    })
                  }
                  figures={figures}
                  cameras={visibleCams}
                  items={floor.items.filter((it) => layerVisible(it.shotId, shot?.id ?? null, solo, hidden))}
                  sel={sel}
                  soloTarget={soloTarget}
                  onSelectTarget={(target) => select(target)}
                  onToggleSoloTarget={(target) => {
                    if (!target) return;
                    setSoloTarget((prev) => (prev?.kind === target.kind && prev?.id === target.id ? null : target));
                    select(target);
                  }}
                  onToggleItemLock={(itemId) => {
                    if (!editable || playing) return;
                    capture("Toggle item lock");
                    patchFloor({ items: floor.items.map((i) => (i.id === itemId ? { ...i, locked: !i.locked } : i)) });
                  }}
                  project={project}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
      {shot && (!editable || compact) ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-sm bg-card/90 px-1.5 py-0.5 font-script text-xs">
          {coverageLabel(shot)}
        </span>
      ) : null}
    </div>
  );
}

function FloorToolbar({
  tool,
  place,
  onTool,
  onPlace,
  unusedHomes,
  bookExtras,
  onReset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onErase,
  canErase,
  slim = false,
  shot = null,
  snapAngleEnabled = true,
  onToggleSnapAngle,
  showGrid = true,
  onToggleGrid,
}: {
  tool: Tool;
  place: Place | null;
  onTool: (t: Tool) => void;
  onPlace: (p: Place) => void;
  unusedHomes: FloorFigure[];
  bookExtras: { id: string; name: string }[];
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onErase: () => void;
  canErase: boolean;
  slim?: boolean;
  shot?: Shot | null;
  snapAngleEnabled?: boolean;
  onToggleSnapAngle?: () => void;
  showGrid?: boolean;
  onToggleGrid?: () => void;
}) {
  const players = [...unusedHomes, ...bookExtras];
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-foreground">
      <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
        <Undo2 />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
        <Redo2 />
      </Button>
      <Button
        size="sm"
        variant={tool === "select" && !place ? "secondary" : "ghost"}
        aria-label="Select"
        aria-pressed={tool === "select" && !place}
        onClick={() => onTool("select")}
      >
        <MousePointer2 />
        Select
      </Button>
      <Button
        size="sm"
        variant={tool === "rotate" ? "secondary" : "ghost"}
        aria-label="Rotate"
        aria-pressed={tool === "rotate" && !place}
        onClick={() => onTool("rotate")}
      >
        <RotateCw />
        Turn
      </Button>
      <Button
        size="sm"
        variant={tool === "eyeline" ? "secondary" : "ghost"}
        aria-label="Eyeline Tool"
        aria-pressed={tool === "eyeline" && !place}
        onClick={() => onTool("eyeline")}
        title="Draw eyelines between characters"
      >
        <Eye />
        Eyeline
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant={place?.type === "figure" ? "secondary" : "ghost"}
            aria-label="Add player"
            disabled={players.length === 0}
          >
            <UserPlus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[80]">
          <DropdownMenuLabel>On this setup</DropdownMenuLabel>
          {players.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => {
                onTool("select");
                onPlace({ type: "figure", id: p.id, name: p.name });
              }}
            >
              {p.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {!slim ? (
        <>
          <Button
            size="icon-sm"
            variant={place?.type === "camera" ? "secondary" : "ghost"}
            aria-label="Add camera"
            aria-pressed={place?.type === "camera"}
            onClick={() => {
              onTool("select");
              onPlace({ type: "camera" });
            }}
          >
            <Video />
          </Button>
          <Button
            size="icon-sm"
            variant={place?.type === "item" && place.kind === "mark" ? "secondary" : "ghost"}
            aria-label="Add mark"
            aria-pressed={place?.type === "item" && place.kind === "mark"}
            onClick={() => {
              onTool("select");
              onPlace({ type: "item", kind: "mark" });
            }}
          >
            <Hash />
          </Button>
          <Button
            size="icon-sm"
            variant={place?.type === "item" && place.kind === "table" ? "secondary" : "ghost"}
            aria-label="Add table"
            aria-pressed={place?.type === "item" && place.kind === "table"}
            onClick={() => {
              onTool("select");
              onPlace({ type: "item", kind: "table" });
            }}
          >
            <Square />
          </Button>
        </>
      ) : null}
      <Button
        size="icon-sm"
        variant={tool === "erase" ? "secondary" : "ghost"}
        aria-label="Remove selected plan item"
        title="Remove selected item (Delete)"
        disabled={!canErase && tool !== "erase"}
        onClick={() => {
          if (canErase) onErase();
          else onTool("erase");
        }}
      >
        <Trash2 />
      </Button>
      <Button size="sm" variant="ghost" aria-label="Reset blocking" onClick={onReset}>
        Reset
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      {onToggleSnapAngle ? (
        <Button
          size="sm"
          variant={snapAngleEnabled ? "secondary" : "ghost"}
          aria-label="Toggle 15° snap"
          aria-pressed={snapAngleEnabled}
          title={snapAngleEnabled ? "15° rotation snap enabled (click to disable)" : "Free rotation enabled (click to snap to 15°)"}
          onClick={onToggleSnapAngle}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <Magnet className={cn("size-3.5", snapAngleEnabled ? "text-primary" : "text-muted-foreground")} />
          <span className="hidden sm:inline">Snap 15°</span>
        </Button>
      ) : null}

      {onToggleGrid ? (
        <Button
          size="sm"
          variant={showGrid ? "secondary" : "ghost"}
          aria-label="Toggle grid"
          aria-pressed={showGrid}
          title={showGrid ? "Floor grid visible (click to hide)" : "Floor grid hidden (click to show)"}
          onClick={onToggleGrid}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <Grid3X3 className={cn("size-3.5", showGrid ? "text-primary" : "text-muted-foreground")} />
          <span className="hidden sm:inline">Grid</span>
        </Button>
      ) : null}

      {shot ? (
        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-0.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          <span className="font-semibold text-foreground font-script">Setup {shot.setup}</span>
          <span className="opacity-40">·</span>
          <span>{shot.coverageSize || "Coverage"}</span>
          <span className="opacity-40">·</span>
          <span className="capitalize">{shot.movement || "static"}</span>
        </div>
      ) : null}
    </div>
  );
}

function FloorShape({
  item,
  selected,
  soloed = false,
  dimmed = false,
  editable,
  onPointerDown,
  onRotate,
  onKeyDown,
  onDoubleClick,
}: {
  item: FloorItem;
  selected: boolean;
  soloed?: boolean;
  dimmed?: boolean;
  editable: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onRotate?: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const x = item.x * FLOOR_W;
  const y = item.y * FLOOR_H;
  const w = item.w * FLOOR_W;
  const h = item.h * FLOOR_H;
  const ink = "var(--color-script-ink)";
  const hit = {};
  const cornerOrigin = ["wall", "bar", "door", "window"].includes(item.kind);
  const bounds = { x: cornerOrigin ? x : x - w / 2, y: cornerOrigin ? y : y - h / 2, w, h };
  if (item.kind === "arrow") {
    const angle = (item.rotation * Math.PI) / 180,
      len = Math.max(8, w);
    const endX = x + Math.cos(angle) * len,
      endY = y + Math.sin(angle) * len;
    bounds.x = Math.min(x, endX) - 2;
    bounds.y = Math.min(y, endY) - 3;
    bounds.w = Math.abs(endX - x) + 4;
    bounds.h = Math.abs(endY - y) + 6;
  }
  const shape = () => {
    if (item.kind === "wall") {
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke={ink}
          strokeWidth="1.2"
          rx="1.5"
        />
      );
    }
    if (item.kind === "bar") {
      return (
        <g {...hit}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="var(--color-paper)"
            stroke={ink}
            strokeWidth="1.1"
          />
          <text
            x={x + w / 2}
            y={y + h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={ink}
            fontSize="4.2"
            style={{ fontFamily: "var(--font-script)" }}
            transform={`rotate(-90 ${x + w / 2} ${y + h / 2})`}
          >
            {item.label || "BAR"}
          </text>
        </g>
      );
    }
    if (item.kind === "door") {
      return (
        <g>
          <path
            d={`M ${x} ${y + h} Q ${x + w * 0.25} ${y} ${x + w * 0.5} ${y + h}`}
            fill="none"
            stroke={ink}
            strokeWidth="1.1"
          />
          <path
            d={`M ${x + w * 0.5} ${y + h} Q ${x + w * 0.75} ${y} ${x + w} ${y + h}`}
            fill="none"
            stroke={ink}
            strokeWidth="1.1"
          />
          <text
            x={x + w / 2}
            y={y - 1.2}
            textAnchor="middle"
            fill={ink}
            fontSize="3.2"
            style={{ fontFamily: "var(--font-script)" }}
          >
            DOORS
          </text>
        </g>
      );
    }
    if (item.kind === "table") {
      return (
        <ellipse
          cx={x}
          cy={y}
          rx={w / 2}
          ry={h / 2}
          fill="none"
          stroke={ink}
          strokeWidth={selected ? 1.6 : 1}
          {...hit}
        />
      );
    }
    if (item.kind === "stool") {
      return (
        <circle
          cx={x}
          cy={y}
          r={Math.max(w, h) * 0.45}
          fill="none"
          stroke={ink}
          strokeWidth={selected ? 1.3 : 0.8}
          {...hit}
        />
      );
    }
    if (item.kind === "well") {
      return (
        <g>
          <rect
            x={x - w / 2}
            y={y - h / 2}
            width={w}
            height={h}
            fill="none"
            stroke={ink}
            strokeWidth="0.8"
          />
          <text
            x={x}
            y={y + 1}
            textAnchor="middle"
            fill={ink}
            fontSize="3"
            style={{ fontFamily: "var(--font-script)" }}
          >
            {item.label}
          </text>
        </g>
      );
    }
    if (item.kind === "mark") {
      return (
        <g {...hit}>
          <circle
            cx={x}
            cy={y}
            r="3.6"
            fill="var(--color-script)"
            stroke={ink}
            strokeWidth={selected ? 1.5 : 1}
          />
          <text
            x={x}
            y={y + 1.2}
            textAnchor="middle"
            fill={ink}
            fontSize="3.4"
            style={{ fontFamily: "var(--font-script)" }}
          >
            {item.label}
          </text>
        </g>
      );
    }
    if (item.kind === "window") {
      return (
        <g {...hit}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke={ink}
            strokeWidth={selected ? 1.4 : 0.9}
          />
          <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={ink} strokeWidth="0.7" />
          <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={ink} strokeWidth="0.7" />
        </g>
      );
    }
    if (item.kind === "chair") {
      return (
        <g {...hit}>
          <rect
            x={x - w / 2}
            y={y - h / 3}
            width={w}
            height={h * 0.7}
            fill="none"
            stroke={ink}
            strokeWidth={selected ? 1.4 : 0.9}
          />
          <line
            x1={x - w / 2}
            y1={y - h / 3}
            x2={x + w / 2}
            y2={y - h / 3}
            stroke={ink}
            strokeWidth="1.2"
          />
        </g>
      );
    }
    if (item.kind === "rect") {
      return (
        <rect
          x={x - w / 2}
          y={y - h / 2}
          width={w}
          height={h}
          fill="none"
          stroke={ink}
          strokeWidth={selected ? 1.5 : 1}
          {...hit}
        />
      );
    }
    if (item.kind === "circle") {
      return (
        <circle
          cx={x}
          cy={y}
          r={Math.max(w, h) * 0.5}
          fill="none"
          stroke={ink}
          strokeWidth={selected ? 1.5 : 1}
          {...hit}
        />
      );
    }
    if (item.kind === "arrow") {
      const rad = (item.rotation * Math.PI) / 180;
      const len = Math.max(8, item.w * FLOOR_W);
      const x2 = x + Math.cos(rad) * len;
      const y2 = y + Math.sin(rad) * len;
      return (
        <g {...hit}>
          <line x1={x} y1={y} x2={x2} y2={y2} stroke={ink} strokeWidth={selected ? 1.6 : 1.1} />
          <polygon
            points={`${x2},${y2} ${x2 - Math.cos(rad - 0.4) * 4},${y2 - Math.sin(rad - 0.4) * 4} ${x2 - Math.cos(rad + 0.4) * 4},${y2 - Math.sin(rad + 0.4) * 4}`}
            fill={ink}
          />
          {item.label ? (
            <text
              x={(x + x2) / 2}
              y={(y + y2) / 2 - 2}
              fill={ink}
              fontSize="3.2"
              textAnchor="middle"
            >
              {item.label}
            </text>
          ) : null}
        </g>
      );
    }
    return null;
  };
  return (
    <g
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={`Select ${item.kind}${item.label ? ` ${item.label}` : ""}`}
      aria-pressed={editable ? selected : undefined}
      onPointerDown={editable && !dimmed ? onPointerDown : undefined}
      onDoubleClick={editable ? onDoubleClick : undefined}
      onKeyDown={onKeyDown}
      opacity={dimmed ? 0.2 : 1}
      pointerEvents={dimmed ? "none" : undefined}
      className={
        editable && !dimmed
          ? "cursor-grab outline-none focus:outline-none focus-visible:outline-none"
          : undefined
      }
    >
      {editable ? (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.w}
          height={bounds.h}
          fill={item.kind === "wall" ? "none" : "transparent"}
          stroke="transparent"
          strokeWidth="3"
          pointerEvents={item.kind === "wall" ? "stroke" : "all"}
        />
      ) : null}
      <g
        transform={
          item.rotation && item.kind !== "arrow"
            ? `rotate(${item.rotation} ${bounds.x + bounds.w / 2} ${bounds.y + bounds.h / 2})`
            : undefined
        }
      >
        {shape()}
        {selected && editable && onRotate && item.kind !== "arrow" ? (
          <g
            onPointerDown={(e) => {
              e.stopPropagation();
              onRotate(e);
            }}
            className="cursor-crosshair"
            role="button"
            aria-label={`Rotate ${item.kind}`}
          >
            <line
              x1={bounds.x + bounds.w / 2}
              y1={bounds.y - 1}
              x2={bounds.x + bounds.w / 2}
              y2={bounds.y - 5.5}
              stroke="var(--color-script-ink)"
              strokeWidth="0.8"
              strokeDasharray="1.5 1.5"
            />
            <circle
              cx={bounds.x + bounds.w / 2}
              cy={bounds.y - 5.5}
              r="1.8"
              fill="var(--color-paper)"
              stroke="var(--color-script-ink)"
              strokeWidth="1"
            />
          </g>
        ) : null}
      </g>
      {selected && editable && onRotate && item.kind === "arrow" ? (
        <g
          onPointerDown={(e) => {
            e.stopPropagation();
            onRotate(e);
          }}
          className="cursor-crosshair"
          role="button"
          aria-label="Rotate arrow"
        >
          {(() => {
            const rad = (item.rotation * Math.PI) / 180;
            const len = Math.max(8, item.w * FLOOR_W);
            const x2 = x + Math.cos(rad) * len;
            const y2 = y + Math.sin(rad) * len;
            return (
              <circle
                cx={x2}
                cy={y2}
                r="1.8"
                fill="var(--color-paper)"
                stroke="var(--color-script-ink)"
                strokeWidth="1"
              />
            );
          })()}
        </g>
      ) : null}
      {item.locked ? (
        <circle
          cx={bounds.x + 2}
          cy={bounds.y + 2}
          r="1.2"
          fill="#d97706"
          aria-label="Locked"
        />
      ) : null}
    </g>
  );
}

function CameraMark({
  cam,
  active,
  selected,
  soloed = false,
  dimmed = false,
  shot,
  compact,
  editable,
  onPointerDown,
  onRotate,
  onKeyDown,
  onDoubleClick,
}: {
  cam: FloorCamera;
  active: boolean;
  selected: boolean;
  soloed?: boolean;
  dimmed?: boolean;
  shot: Shot | null;
  compact: boolean;
  editable: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onRotate: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const { x, y } = toFloorPx(cam);
  const color = cameraColor(shot);
  const len = active || selected ? 20 : 14;
  const effectiveFov = cam.fov || (shot ? fovForCoverageSize(shot.coverageSize) : 38);
  const effectiveCam = { ...cam, fov: effectiveFov };
  const handle = rotateHandle(
    { id: cam.id, name: cam.setup, x: cam.x, y: cam.y, facing: cam.angle },
    len,
  );
  const points = wedgePoints(effectiveCam, len)
    .split(" ")
    .map((pair) => pair.split(",").map(Number));
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return (
    <g
      opacity={dimmed ? 0.15 : active || selected ? 1 : compact ? 0.22 : 0.4}
      pointerEvents={dimmed ? "none" : undefined}
      onPointerDown={editable && !dimmed ? onPointerDown : undefined}
      onDoubleClick={editable ? onDoubleClick : undefined}
      onKeyDown={onKeyDown}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={`Select camera ${cam.setup}`}
      aria-pressed={editable ? selected : undefined}
      className={
        editable && !dimmed
          ? "cursor-grab outline-none focus:outline-none focus-visible:outline-none"
          : undefined
      }
    >
      {(active || selected) && points.length >= 3 ? (
        <line
          x1={x}
          y1={y}
          x2={(points[1][0] + points[2][0]) / 2}
          y2={(points[1][1] + points[2][1]) / 2}
          stroke={color}
          strokeWidth="0.8"
          strokeDasharray="1.5 1.5"
          opacity="0.85"
        />
      ) : null}
      <polygon
        points={wedgePoints(effectiveCam, len)}
        fill={color}
        fillOpacity={active ? 0.24 : 0.08}
        stroke={color}
        strokeWidth={active ? 1.4 : selected ? 1.2 : 0.8}
      />
      {active || selected ? (
        <>
          <circle
            cx={x}
            cy={y}
            r="4.2"
            fill="none"
            stroke={color}
            strokeWidth="0.8"
            strokeDasharray="2 1.5"
            opacity="0.85"
          />
          <circle cx={x} cy={y} r="2.4" fill={color} stroke="var(--color-script)" strokeWidth="0.6" />
        </>
      ) : (
        <circle cx={x} cy={y} r={1.6} fill={color} />
      )}
      {active ? (
        <g transform={`translate(${x + 3.4}, ${y - 5.5})`}>
          <rect
            x="-1"
            y="-1"
            width={Math.max(22, cam.setup.length * 3.8 + 14)}
            height="5.4"
            rx="1.2"
            fill={color}
          />
          <text
            x="1.4"
            y="3.2"
            fill="var(--color-script)"
            fontSize="3.2"
            fontWeight="700"
            style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.03em" }}
          >
            ● LIVE {cam.setup}
          </text>
        </g>
      ) : (
        (!compact) && (
          <text
            x={x + 3.4}
            y={y - 2.2}
            fill={color}
            fontSize="3.4"
            fontWeight="400"
            style={{ fontFamily: "var(--font-script)" }}
          >
            {cam.setup}
          </text>
        )
      )}
      {editable && selected ? (
        <circle
          cx={handle.x}
          cy={handle.y}
          r="2.0"
          fill="var(--color-paper)"
          stroke={color}
          strokeWidth="1"
          className="cursor-alias"
          aria-label={`Rotate camera ${cam.setup}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onRotate(e);
          }}
        />
      ) : null}
    </g>
  );
}

function BodyMark({
  figure,
  compact,
  selected,
  soloed = false,
  dimmed = false,
  editable,
  opacity = 1,
  onPointerDown,
  onRotate,
  onKeyDown,
  onDoubleClick,
}: {
  figure: FloorFigure;
  compact: boolean;
  selected: boolean;
  soloed?: boolean;
  dimmed?: boolean;
  editable: boolean;
  opacity?: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onRotate: (e: React.PointerEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const { x, y } = toFloorPx(figure);
  const handle = rotateHandle(figure);
  return (
    <g
      onPointerDown={editable && !dimmed ? onPointerDown : undefined}
      onDoubleClick={editable ? onDoubleClick : undefined}
      onKeyDown={onKeyDown}
      opacity={dimmed ? 0.18 : opacity}
      pointerEvents={dimmed ? "none" : undefined}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={`Select person ${figure.name}`}
      aria-pressed={editable ? selected : undefined}
      className={
        editable && !dimmed
          ? "cursor-grab outline-none focus:outline-none focus-visible:outline-none"
          : undefined
      }
    >
      {editable ? <circle cx={x} cy={y} r="7" fill="transparent" /> : null}
      {selected ? (
        <>
          <circle
            cx={x}
            cy={y}
            r="5.5"
            fill="none"
            stroke="var(--color-script-ink)"
            strokeWidth="0.8"
            strokeDasharray="1.5 1.5"
            opacity="0.85"
          />
          <line
            x1={x}
            y1={y}
            x2={handle.x}
            y2={handle.y}
            stroke="var(--color-script-ink)"
            strokeWidth="0.8"
            strokeDasharray="1.5 1.5"
            opacity="0.85"
          />
        </>
      ) : null}
      <polygon
        points={chevronPoints(figure)}
        fill={figureColor(figure.id)}
        stroke="var(--color-script)"
        strokeWidth="0.4"
      />
      {!compact ? (
        <text
          x={x}
          y={y + 8.2}
          textAnchor="middle"
          fill="var(--color-script-ink)"
          fontSize="3.4"
          fontWeight="600"
          style={{ fontFamily: "var(--font-script)" }}
        >
          {shortFigureName(figure.name)}
        </text>
      ) : null}
      {editable && selected ? (
        <circle
          cx={handle.x}
          cy={handle.y}
          r="1.8"
          fill="var(--color-paper)"
          stroke="var(--color-script-ink)"
          strokeWidth="1"
          className="cursor-alias"
          aria-label={`Rotate person ${figure.name}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onRotate(e);
          }}
        />
      ) : null}
    </g>
  );
}

export function FloorLegend({ floor }: { floor: FloorPlan }) {
  if (!floor.label) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {floor.label}: Noodles at 1, Rusty at 2, BH home at 3. Stage people per setup.
    </p>
  );
}
