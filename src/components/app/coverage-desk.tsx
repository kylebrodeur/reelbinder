import {
  BookOpen,
  Camera,
  Check,
  Clapperboard,
  Eye,
  FileText,
  Highlighter,
  ImageIcon,
  Layers,
  Map,
  MessageSquare,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { OverheadPlan } from "@/components/app/overhead-plan";
import { ProductionDrawer } from "@/components/app/production-drawer";
import { EditorSaveButton } from "@/components/app/save-control";
import { ShotStill } from "@/components/app/shot-still";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DIRECTION_META,
  MOVEMENT_META,
  PERSPECTIVE_ANGLES,
  perspectiveAngleFromCamera,
} from "@/lib/filmmaking";
import { slugForScene } from "@/lib/fountain";
import {
  coverageLabel,
  framingLabel,
  LINE_COLOR_BG,
  nextSetup,
  shotsCovering,
} from "@/lib/lining";
import { coverageRole, effectiveScriptElementIds } from "@/lib/coverage-edit";
import { markColor, markMeta, sceneIdOf } from "@/lib/marks";
import { appendFrameVersions } from "@/lib/cinema-images";
import { fileToJpegDataUrl } from "@/lib/media";
import { originalBoardFor, originalOverheadFor } from "@/lib/originals";
import { newScriptCommentThread } from "@/lib/script-comments";
import { CAMERA_FOR_FRAMING } from "@/lib/script-linkage";
import { useSlate } from "@/lib/store";
import type {
  CameraAngle,
  CameraMovement,
  CatalogTag,
  CoverageSize,
  LineColor,
  MarkTag,
  Project,
  ScriptElement,
  Shot,
} from "@/lib/types";
import {
  CAMERA_MOVEMENTS,
  COVERAGE_SIZES,
  LINE_COLORS,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type DeskTab = "beat" | "controls" | "visuals";

interface DetectedEntity {
  id: string;
  name: string;
  tag: CatalogTag | "cast";
  department: string;
  matchWord: string;
  isMarked: boolean;
  markId?: string;
}

function detectEntitiesOnBeat(
  element: ScriptElement,
  project: Project,
): DetectedEntity[] {
  const list: DetectedEntity[] = [];
  const text = element.text || "";
  const textLower = text.toLowerCase();
  const marksOnEl = (project.marks ?? []).filter((m) => m.elementId === element.id);
  const seenKeys = new Set<string>();

  // 1. Existing marks on this element
  for (const mark of marksOnEl) {
    const key = `${mark.tag}:${mark.text.toLowerCase()}`;
    seenKeys.add(key);
    list.push({
      id: mark.id,
      name: mark.text,
      tag: mark.tag as CatalogTag | "cast",
      department: markMeta(mark.tag).label,
      matchWord: mark.text,
      isMarked: true,
      markId: mark.id,
    });
  }

  // 2. Speaking character (if dialogue)
  if (element.kind === "dialogue" && element.character) {
    const charName = element.character.trim();
    const key = `cast:${charName.toLowerCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      const existingMark = marksOnEl.find(
        (m) => m.tag === "cast" && m.text.toLowerCase() === charName.toLowerCase(),
      );
      list.push({
        id: `char:${charName}`,
        name: charName,
        tag: "cast",
        department: "Cast (Speaker)",
        matchWord: charName,
        isMarked: !!existingMark,
        markId: existingMark?.id,
      });
    }
  }

  // 3. Characters from bible mentioned in text
  for (const char of project.characters ?? []) {
    const names = [char.name, ...(char.aliases ?? [])].filter(Boolean);
    for (const n of names) {
      const key = `cast:${n.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      const idx = textLower.indexOf(n.toLowerCase());
      if (idx >= 0) {
        seenKeys.add(key);
        const matchText = text.slice(idx, idx + n.length);
        const existingMark = marksOnEl.find(
          (m) => m.tag === "cast" && m.text.toLowerCase() === n.toLowerCase(),
        );
        list.push({
          id: `char:${n}`,
          name: n,
          tag: "cast",
          department: "Cast",
          matchWord: matchText,
          isMarked: !!existingMark,
          markId: existingMark?.id,
        });
        break;
      }
    }
  }

  // 4. Breakdown items mentioned in text
  for (const item of project.breakdown ?? []) {
    const names = [item.item, ...(item.aliases ?? [])].filter(Boolean);
    const tag = (item.tag as CatalogTag) ?? "prop";
    for (const n of names) {
      const key = `${tag}:${n.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      const idx = textLower.indexOf(n.toLowerCase());
      if (idx >= 0) {
        seenKeys.add(key);
        const matchText = text.slice(idx, idx + n.length);
        const existingMark = marksOnEl.find(
          (m) => m.tag === tag && m.text.toLowerCase() === n.toLowerCase(),
        );
        list.push({
          id: `item:${item.id}`,
          name: item.item,
          tag,
          department: item.department || markMeta(tag).label,
          matchWord: matchText,
          isMarked: !!existingMark,
          markId: existingMark?.id,
        });
        break;
      }
    }
  }

  return list;
}

export function CoverageDesk({
  tab: controlledTab,
  onTabChange,
  onOpenBreakdown,
  onOpenNotes,
  onMarkMode,
}: {
  tab?: DeskTab;
  onTabChange?: (t: DeskTab) => void;
  onOpenBreakdown?: () => void;
  onOpenNotes?: () => void;
  onMarkMode?: () => void;
} = {}) {
  const project = useSlate((s) => s.project);
  const selectedId = useSlate((s) => s.selectedId);
  const selectedElementId = useSlate((s) => s.selectedElementId);
  const patchShot = useSlate((s) => s.patchShot);
  const deleteShot = useSlate((s) => s.deleteShot);
  const selectShot = useSlate((s) => s.selectShot);
  const selectElement = useSlate((s) => s.selectElement);
  const lineRange = useSlate((s) => s.lineRange);
  const patchElement = useSlate((s) => s.patchElement);
  const addMark = useSlate((s) => s.addMark);
  const removeMark = useSlate((s) => s.removeMark);
  const setView = useSlate((s) => s.setView);

  const [deskTabLocal, setDeskTabLocal] = useState<DeskTab>("beat");
  const deskTab = controlledTab ?? deskTabLocal;
  const setDeskTab = onTabChange ?? setDeskTabLocal;

  const [editingBeat, setEditingBeat] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{
    projectId: string;
    elementId: string;
    sourceText: string;
    text: string;
  } | null>(null);
  const [prodDrawerOpen, setProdDrawerOpen] = useState(false);
  const [showHistoricalBoard, setShowHistoricalBoard] = useState(false);
  const [showHistoricalOverhead, setShowHistoricalOverhead] = useState(false);
  const controlId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const element = project.script.find((e) => e.id === selectedElementId) ?? project.script[0] ?? null;
  const activeNote = noteDraft?.projectId === project.id && noteDraft.elementId === element?.id
    ? noteDraft : null;
  const addingNote = !!activeNote;
  const newNote = activeNote?.text ?? "";
  const shot = project.shots.find((s) => s.id === selectedId) ?? project.shots[0] ?? null;

  const originalOverhead = originalOverheadFor(project);
  const originalBoard = originalBoardFor(project, shot);
  const linkedIds = shot ? new Set(effectiveScriptElementIds(project, shot)) : new Set<string>();
  const linked = project.script.filter((e) => linkedIds.has(e.id));
  const sceneSlug = shot ? slugForScene(project.script, shot.sceneId) : "";

  // Beat details calculation
  const beatIndex = element ? project.script.findIndex((e) => e.id === element.id) : -1;
  const beatSceneSlug = element ? slugForScene(project.script, sceneIdOf(project.script, element.id)) : "";
  const coveringShots = element ? shotsCovering(project, element.id) : [];
  const beatThreads = element
    ? (project.scriptCommentThreads ?? []).filter((t) => t.anchor.elementId === element.id)
    : [];
  const detectedEntities = element ? detectEntitiesOnBeat(element, project) : [];

  const jumpToBeat = (elementId: string) => {
    selectElement(elementId);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-el-id="${CSS.escape(elementId)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shot) return;
    const sourceProjectId = project.id;
    const shotId = shot.id;
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      const current = useSlate.getState().project;
      const currentShot = current.shots.find((candidate) => candidate.id === shotId);
      if (current.id !== sourceProjectId || !currentShot) {
        throw new Error("The project or setup changed before this image was ready. Upload it again.");
      }
      const now = Date.now();
      const result = patchShot(shotId, {
        frameUrl: dataUrl,
        frameKind: "still",
        frameHistory: [
          ...appendFrameVersions(currentShot, [], "still", now),
          { id: `upload_${crypto.randomUUID()}`, url: dataUrl, kind: "still", createdAt: now },
        ],
      });
      if (!result.ok) throw new Error(result.error);
      toast.success("Storyboard still updated; earlier frames are kept in history");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load image file");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddNote = () => {
    if (!noteDraft?.text.trim()) return;
    const state = useSlate.getState();
    const current = state.project;
    const currentElement = current.script.find((candidate) => candidate.id === noteDraft.elementId);
    const currentSelectedId = state.selectedElementId ?? current.script[0]?.id;
    if (current.id !== noteDraft.projectId || currentSelectedId !== noteDraft.elementId ||
        !currentElement || currentElement.text !== noteDraft.sourceText) {
      toast.error("This note belongs to a different or changed beat. Return to the original beat or start a new note.");
      return;
    }
    const quote = noteDraft.sourceText.slice(0, 50);
    if (!quote.trim()) {
      toast.error("Add screenplay text before attaching a note.");
      return;
    }
    const thread = newScriptCommentThread(
      { elementId: noteDraft.elementId, quote, start: 0, end: quote.length },
      noteDraft.text.trim(),
    );
    const res = state.applyScriptCommentChange(noteDraft.projectId, {
      kind: "add-thread",
      thread,
    });
    if (res.ok) {
      setNoteDraft(null);
      toast.success("Note added to beat");
    } else {
      toast.error(res.error || "Could not add note");
    }
  };

  const handleMarkEntity = (entity: DetectedEntity) => {
    if (!element) return;
    const state = useSlate.getState();
    const current = state.project;
    const currentElement = current.script.find((candidate) => candidate.id === element.id);
    if (current.id !== project.id || !currentElement || currentElement.text !== element.text ||
        (state.selectedElementId ?? current.script[0]?.id) !== element.id) {
      toast.error("The selected beat changed. Review its current text before marking.");
      return;
    }
    const query = entity.matchWord.toLowerCase();
    const start = currentElement.text.toLowerCase().indexOf(query);
    if (!query || start < 0) {
      toast.error("This name is not in the beat text. Mark its character cue in the screenplay instead.");
      return;
    }
    const textMatch = currentElement.text.slice(start, start + entity.matchWord.length);
    addMark({
      elementId: currentElement.id,
      tag: entity.tag as MarkTag,
      text: textMatch,
      start,
      end: start + textMatch.length,
      note: "",
    });
    toast.success(`Marked "${textMatch}" as ${markMeta(entity.tag as MarkTag).label}`);
  };

  const handleLineThisBeat = () => {
    if (!element) return;
    lineRange(element.id, element.id, null);
    toast.success("Created new coverage setup for this beat");
    setDeskTab("controls");
  };

  const handleAddToCurrentSetup = () => {
    if (!element || !shot) return;
    if (shot.elementIds.includes(element.id)) return;
    const newIds = [...shot.elementIds, element.id];
    patchShot(shot.id, { elementIds: newIds });
    toast.success(`Added beat to setup ${shot.setup || shot.number}`);
  };

  const role = shot ? coverageRole(shot) : "angle";

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {/* Header with setup/beat identity */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-2.5 bg-secondary/20">
        {deskTab === "beat" && element ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-steel" />
              <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
                Beat {beatIndex + 1} · {element.kind.toUpperCase()}
              </p>
            </div>
            <p className="truncate font-medium leading-tight text-sm mt-0.5">
              {beatSceneSlug || "Screenplay Beat"}
            </p>
          </div>
        ) : shot ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", LINE_COLOR_BG[shot.lineColor])}
              />
              <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
                Setup {shot.setup || shot.number} · {coverageLabel(shot)}
              </p>
            </div>
            <p className="truncate font-medium leading-tight text-sm mt-0.5">{shot.title}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
              Script Details
            </p>
            <p className="text-sm font-medium">Select a beat or line</p>
          </div>
        )}

        {deskTab === "beat" && element ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase border-border text-muted-foreground">
            {element.kind}
          </Badge>
        ) : shot ? (
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] uppercase",
              role === "master" ? "border-amber-500/40 text-amber-400" : "border-border text-muted-foreground",
            )}
          >
            {role === "master" ? "Master" : "Coverage"}
          </Badge>
        ) : null}
      </div>

      {/* Sub-tab Navigation: Beat Details | Line Controls | Storyboard & Diagram */}
      <div className="flex shrink-0 border-b border-border bg-secondary/40 px-2.5 py-1.5">
        <div className="flex items-center gap-1 rounded-md bg-secondary/60 p-0.5 w-full">
          <button
            type="button"
            onClick={() => setDeskTab("beat")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded py-1 text-xs font-medium transition-all cursor-pointer",
              deskTab === "beat"
                ? "bg-card text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileText className="size-3" />
            <span>Beat Details</span>
          </button>
          <button
            type="button"
            onClick={() => setDeskTab("controls")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded py-1 text-xs font-medium transition-all cursor-pointer",
              deskTab === "controls"
                ? "bg-card text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="size-3" />
            <span>Line Controls</span>
          </button>
          <button
            type="button"
            onClick={() => setDeskTab("visuals")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded py-1 text-xs font-medium transition-all cursor-pointer",
              deskTab === "visuals"
                ? "bg-card text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ImageIcon className="size-3" />
            <span>Storyboard</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          TAB 1: BEAT / SECTION DETAILS
          ========================================================================= */}
      {deskTab === "beat" && (
        <div className="shrink-0 space-y-3.5 p-3">
          {element ? (
            <>
              {/* Beat Text Box */}
              <div className="rounded-md border border-border/80 bg-secondary/20 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="size-3 text-steel" />
                    Screenplay Text
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingBeat(!editingBeat)}
                    className="text-[11px] text-steel hover:underline font-medium cursor-pointer"
                  >
                    {editingBeat ? "Done editing" : "Edit text"}
                  </button>
                </div>

                {editingBeat ? (
                  <Textarea
                    rows={3}
                    className="text-xs font-script leading-snug bg-card"
                    value={element.text}
                    onChange={(e) => patchElement(element.id, { text: e.target.value })}
                  />
                ) : (
                  <div
                    className="rounded bg-card/60 p-2 text-xs font-script leading-relaxed text-foreground border border-border/40 cursor-text select-text"
                    onDoubleClick={() => setEditingBeat(true)}
                  >
                    {element.character ? (
                      <p className="font-bold uppercase tracking-wide text-foreground/80 mb-0.5">
                        {element.character}
                      </p>
                    ) : null}
                    <p>{element.text || <span className="italic text-muted-foreground">Empty beat…</span>}</p>
                  </div>
                )}
              </div>

              {/* Notes & Comments Section */}
              <div className="rounded-md border border-border/80 bg-card p-2.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="size-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-foreground">
                      Notes on this Beat
                    </span>
                    {beatThreads.length > 0 && (
                      <Badge variant="default" className="h-4 px-1 text-[10px] font-mono">
                        {beatThreads.length}
                      </Badge>
                    )}
                  </div>
                  {onOpenNotes && (
                    <button
                      type="button"
                      onClick={onOpenNotes}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
                    >
                      Notes tab →
                    </button>
                  )}
                </div>

                {beatThreads.length > 0 ? (
                  <div className="space-y-2">
                    {beatThreads.map((thread) => {
                      const open = thread.status === "open";
                      const lastMessage = thread.messages[thread.messages.length - 1];
                      return (
                        <div
                          key={thread.id}
                          className={cn(
                            "rounded border p-2 text-xs space-y-1",
                            open
                              ? "border-amber-500/30 bg-amber-500/5"
                              : "border-emerald-500/30 bg-emerald-500/5",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 text-[9px] uppercase font-mono px-1",
                                open
                                  ? "border-amber-400/40 text-amber-500 bg-amber-500/10"
                                  : "border-emerald-400/40 text-emerald-500 bg-emerald-500/10",
                              )}
                            >
                              {thread.status}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {thread.anchor.quote && (
                            <p className="text-[11px] italic text-muted-foreground line-clamp-1">
                              “{thread.anchor.quote}”
                            </p>
                          )}
                          {lastMessage && (
                            <p className="text-[11px] text-foreground leading-snug font-sans">
                              <span className="font-semibold text-muted-foreground mr-1">
                                {lastMessage.role === "assistant" ? "Assistant:" : "Note:"}
                              </span>
                              {lastMessage.text}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic">
                    No notes attached to this beat yet.
                  </p>
                )}

                {/* Inline Add Note Composer */}
                {addingNote ? (
                  <div className="space-y-1.5 pt-1">
                    <Textarea
                      rows={2}
                      className="text-xs resize-none bg-secondary/30"
                      placeholder="Add an instruction, question, or revision note…"
                      value={newNote}
                      onChange={(e) => {
                        const text = e.target.value;
                        setNoteDraft((draft) => draft ? { ...draft, text } : null);
                      }}
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setNoteDraft(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!newNote.trim()}
                        onClick={handleAddNote}
                      >
                        Save Note
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 text-xs cursor-pointer border-dashed"
                    onClick={() => {
                      if (element) setNoteDraft({ projectId: project.id, elementId: element.id, sourceText: element.text, text: "" });
                    }}
                  >
                    <Plus className="size-3 mr-1 text-muted-foreground" />
                    Add Note to this Beat
                  </Button>
                )}
              </div>

              {/* Linked Coverage Section */}
              <div className="rounded-md border border-border/80 bg-card p-2.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Clapperboard className="size-3.5 text-steel" />
                    <span className="text-xs font-semibold text-foreground">
                      Linked Coverage Lines
                    </span>
                    <Badge variant="default" className="h-4 px-1 text-[10px] font-mono">
                      {coveringShots.length}
                    </Badge>
                  </div>
                  {shot && (
                    <button
                      type="button"
                      onClick={() => setDeskTab("controls")}
                      className="text-[11px] text-steel hover:underline font-medium cursor-pointer"
                    >
                      Line controls →
                    </button>
                  )}
                </div>

                {coveringShots.length > 0 ? (
                  <div className="space-y-1.5">
                    {coveringShots.map((s) => {
                      const isCur = s.id === shot?.id;
                      const sRole = coverageRole(s);
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "flex items-center justify-between rounded border p-2 text-xs transition-all cursor-pointer group",
                            isCur
                              ? "border-steel/60 bg-steel/10 shadow-2xs"
                              : "border-border bg-secondary/30 hover:border-steel/40 hover:bg-secondary/60",
                          )}
                          onClick={() => {
                            selectShot(s.id);
                            setDeskTab("controls");
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                "size-2.5 shrink-0 rounded-full",
                                LINE_COLOR_BG[s.lineColor],
                              )}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground">
                                  {coverageLabel(s)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="h-3.5 text-[8.5px] uppercase font-mono px-1 text-muted-foreground"
                                >
                                  {sRole === "master" ? "Master" : "Angle"}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {s.notes || `${framingLabel(s.coverageSize)} · ${s.camera}`}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px] px-2 opacity-80 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectShot(s.id);
                              setDeskTab("controls");
                            }}
                          >
                            Controls →
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-border/80 p-2.5 text-center space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      No coverage setup covers this beat yet.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        onClick={handleLineThisBeat}
                      >
                        <Plus className="size-3 mr-1" />
                        Line with New Setup
                      </Button>
                      {shot && !shot.elementIds.includes(element.id) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={handleAddToCurrentSetup}
                        >
                          Add to Setup {shot.setup || shot.number}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* On-Screen & Production Items Section */}
              <div className="rounded-md border border-border/80 bg-card p-2.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-warn" />
                    <span className="text-xs font-semibold text-foreground">
                      On Screen & Production Items
                    </span>
                    <Badge variant="default" className="h-4 px-1 text-[10px] font-mono">
                      {detectedEntities.length}
                    </Badge>
                  </div>
                  {onOpenBreakdown && (
                    <button
                      type="button"
                      onClick={onOpenBreakdown}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
                    >
                      Breakdown tab →
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Characters, props, wardrobe, and dressing identified from your script and production catalog.
                </p>

                {detectedEntities.length > 0 ? (
                  <div className="space-y-1.5">
                    {detectedEntities.map((ent) => {
                      const color = markColor(ent.tag as MarkTag);
                      return (
                        <div
                          key={ent.id}
                          className="flex items-center justify-between rounded border border-border bg-secondary/30 p-1.5 px-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="size-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <div className="min-w-0 truncate">
                              <span className="font-semibold text-foreground truncate block">
                                {ent.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {ent.department}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {ent.isMarked ? (
                              <div className="flex items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className="h-5 text-[9px] border-emerald-500/40 text-emerald-500 bg-emerald-500/10 flex items-center gap-1 px-1.5"
                                >
                                  <Check className="size-2.5" />
                                  Marked
                                </Badge>
                                {ent.markId && (
                                  <button
                                    type="button"
                                    onClick={() => removeMark(ent.markId!)}
                                    title="Unmark entity"
                                    className="text-muted-foreground hover:text-destructive p-1 rounded cursor-pointer"
                                  >
                                    <X className="size-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2 text-steel border-steel/40 hover:bg-steel/10 cursor-pointer"
                                disabled={!ent.matchWord || !element.text.toLowerCase().includes(ent.matchWord.toLowerCase())}
                                title={!element.text.toLowerCase().includes(ent.matchWord.toLowerCase())
                                  ? "This name is not in the beat text. Mark its character cue in the screenplay." : undefined}
                                onClick={() => handleMarkEntity(ent)}
                              >
                                <Plus className="size-2.5 mr-0.5" />
                                Mark
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic">
                    No characters or catalog items detected in this beat text.
                  </p>
                )}

                {/* Mark Tools Quick Actions */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {onMarkMode && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs cursor-pointer"
                      onClick={onMarkMode}
                    >
                      <Highlighter className="size-3 mr-1 text-warn" />
                      Highlight on Page
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => setProdDrawerOpen(true)}
                  >
                    <BookOpen className="size-3 mr-1" />
                    Production Book
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center p-4 text-center">
              <FileText className="size-6 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                Click any section or beat in the screenplay to view its notes, linked coverage lines, and production items.
              </p>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: LINE CONTROLS (Setup Tag, Role, Framing + Move, Camera Angle + Color)
          ========================================================================= */}
      {deskTab === "controls" && (
        <div className="shrink-0 space-y-3 p-3">
          {shot ? (
            <>
              {/* Setup Tag & Coverage Role */}
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${controlId}-setup`} className="text-xs">Setup Tag</Label>
                  <Input id={`${controlId}-setup`}
                    value={shot.setup}
                    placeholder="e.g. A, 1A"
                    className="h-8 font-mono text-xs uppercase"
                    onChange={(e) => patchShot(shot.id, { setup: e.target.value.toUpperCase() })}
                  />
                </div>

                <div className="grid gap-1">
                  <Label htmlFor={`${controlId}-role`} className="text-xs">Coverage Role</Label>
                  <Select
                    value={role}
                    onValueChange={(value) =>
                      patchShot(shot.id, { coverageRole: value as "master" | "angle" })
                    }
                  >
                    <SelectTrigger id={`${controlId}-role`} className="h-8 text-xs" aria-label="Coverage role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master">Full Coverage (Master Shot)</SelectItem>
                      <SelectItem value="angle">Coverage Shot (Alternate Angle)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Framing & Movement Paired Together */}
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${controlId}-framing`} className="text-xs">Framing</Label>
                  <Select
                    value={shot.coverageSize}
                    onValueChange={(v) => {
                      const coverageSize = v as CoverageSize;
                      const curAngle = perspectiveAngleFromCamera(shot.camera);
                      if (curAngle === "neutral") {
                        const cam = CAMERA_FOR_FRAMING[coverageSize] ?? "medium";
                        patchShot(shot.id, { coverageSize, camera: cam });
                      } else {
                        patchShot(shot.id, { coverageSize });
                      }
                    }}
                  >
                    <SelectTrigger id={`${controlId}-framing`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COVERAGE_SIZES.map((size) => (
                        <SelectItem key={size} value={size}>
                          {framingLabel(size)} ({size})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor={`${controlId}-movement`} className="text-xs">Movement</Label>
                  <Select
                    value={shot.movement}
                    onValueChange={(v) => patchShot(shot.id, { movement: v as CameraMovement })}
                  >
                    <SelectTrigger id={`${controlId}-movement`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_MOVEMENTS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {MOVEMENT_META[m]?.label ?? m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Camera Angle (Elevation/Perspective) & Line Color */}
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${controlId}-angle`} className="text-xs">Camera Angle</Label>
                  <Select
                    value={perspectiveAngleFromCamera(shot.camera)}
                    onValueChange={(v) => {
                      if (v === "neutral") {
                        const cam = CAMERA_FOR_FRAMING[shot.coverageSize] ?? "medium";
                        patchShot(shot.id, { camera: cam, coverageSize: shot.coverageSize });
                      } else {
                        patchShot(shot.id, { camera: v as CameraAngle });
                      }
                    }}
                  >
                    <SelectTrigger id={`${controlId}-angle`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSPECTIVE_ANGLES.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <span className="text-xs font-medium">Line Color</span>
                  <div className="flex items-center gap-1.5 h-8" role="group" aria-label="Line color">
                    {LINE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={shot.lineColor === c}
                        onClick={() => patchShot(shot.id, { lineColor: c as LineColor })}
                        className={cn(
                          "size-5 rounded-full transition-transform cursor-pointer",
                          LINE_COLOR_BG[c],
                          shot.lineColor === c
                            ? "scale-110 ring-2 ring-steel ring-offset-2 ring-offset-card"
                            : "opacity-80 hover:opacity-100",
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Line Notes */}
              <div className="grid gap-1">
                <Label htmlFor={`${controlId}-notes`} className="text-xs">Note on this line</Label>
                <Textarea id={`${controlId}-notes`}
                  rows={2}
                  className="text-xs resize-none"
                  value={shot.notes}
                  onChange={(e) => patchShot(shot.id, { notes: e.target.value })}
                  placeholder="Eyeline, lens, what this setup is for…"
                />
              </div>

              {/* Camera & Staging Direction Box with Stage Switcher */}
              <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Camera className="size-3.5 text-steel" />
                    Camera & Staging Direction
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-steel hover:text-foreground font-medium cursor-pointer"
                    onClick={() => {
                      selectShot(shot.id);
                      setView("stage");
                    }}
                  >
                    Open Stage →
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/40 rounded p-2 border border-border/40">
                  <span className="font-medium text-foreground">
                    {PERSPECTIVE_ANGLES.find((a) => a.value === perspectiveAngleFromCamera(shot.camera))?.label}
                  </span>
                  <span>·</span>
                  <span>{framingLabel(shot.coverageSize)}</span>
                  <span>·</span>
                  <span>{MOVEMENT_META[shot.movement]?.label ?? shot.movement}</span>
                  <span>·</span>
                  <span>{DIRECTION_META[shot.screenDirection]?.label ?? shot.screenDirection}</span>
                  <span>·</span>
                  <span>{shot.durationSec || 4}s</span>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Stage diagrams, overhead camera paths, figure blocking, and lens settings are edited on the Stage floor.
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs font-medium cursor-pointer"
                  onClick={() => {
                    selectShot(shot.id);
                    setView("stage");
                  }}
                >
                  Edit 3D Staging & Floor Plan in Stage →
                </Button>
              </div>

              {/* Screenplay Passage Linkage */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {linked.length > 0
                      ? `Covers ${linked.length} screenplay ${linked.length === 1 ? "beat" : "beats"}`
                      : "No beats covered"}
                  </span>
                  {linked.length > 0 && (
                    <button
                      type="button"
                      onClick={() => jumpToBeat(linked[0].id)}
                      className="text-xs text-steel hover:underline font-medium cursor-pointer"
                    >
                      Jump to passage →
                    </button>
                  )}
                </div>
                {linked.length > 0 ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground italic bg-secondary/30 rounded p-1.5 border border-border/40">
                    “{linked[0]?.text?.slice(0, 80)}
                    {linked[0]?.text?.length > 80 ? "…" : ""}”
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Drag the line handles in the margin to link to script beats.
                  </p>
                )}
              </div>

              {/* Action Footer */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <EditorSaveButton label="Save line" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1 text-xs cursor-pointer"
                  onClick={() => setView("stage")}
                >
                  <Pencil className="size-3.5" />
                  Stage this setup
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove line"
                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={() => deleteShot(shot.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center p-4 text-center">
              <Clapperboard className="size-6 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                Draw a line down the left margin of the script to create a setup, or click an existing setup.
              </p>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 3: STORYBOARD & DIAGRAM
          ========================================================================= */}
      {deskTab === "visuals" && (
        <div className="flex-1 space-y-4 p-3">
          {shot ? (
            <>
              {/* Stage Tab Callout */}
              <div className="rounded-md border border-steel/30 bg-steel/10 p-2.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Layers className="size-3.5 text-steel" />
                    Stage Workspace Link
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 text-xs px-2 cursor-pointer"
                    onClick={() => setView("stage")}
                  >
                    Open in Stage →
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Use the Stage tab for deep 2D actor blocking, 3D camera angles, and full canvas storyboard sketching.
                </p>
              </div>

              {/* Storyboard Card */}
              <section className="space-y-2 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Clapperboard className="size-3.5 text-steel" />
                    Storyboard Frame
                  </p>
                  <div className="flex items-center gap-1">
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2 cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-3 mr-1" />
                      Upload Still
                    </Button>
                    {shot.frameUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] px-1.5 text-muted-foreground hover:text-destructive cursor-pointer"
                        title="Remove custom still"
                        onClick={() => {
                          const current = useSlate.getState().project;
                          const currentShot = current.shots.find((candidate) => candidate.id === shot.id);
                          if (current.id !== project.id || !currentShot) {
                            toast.error("The project or setup changed. Select it again.");
                            return;
                          }
                          const result = patchShot(shot.id, {
                            frameUrl: null,
                            frameKind: "storyboard",
                            frameHistory: appendFrameVersions(currentShot, [], "still", Date.now()),
                          });
                          if (!result.ok) toast.error(result.error);
                        }}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-md border border-border bg-paper aspect-video relative group">
                  <ShotStill sketch={shot.sketch} frameUrl={shot.frameUrl} alt={shot.title} />
                  {!shot.frameUrl && !shot.sketch?.stamps?.length && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-paper/60 pointer-events-none">
                      <p className="text-xs text-script-muted font-script uppercase">No frame created yet</p>
                      <p className="text-[11px] text-script-muted mt-0.5">
                        Upload a still image, or open the Stage tab to sketch actors and camera view.
                      </p>
                    </div>
                  )}
                </div>

                {/* Archival Storyboard Accordion */}
                {originalBoard?.url && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowHistoricalBoard(!showHistoricalBoard)}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                    >
                      <span>{showHistoricalBoard ? "Hide demo archival storyboard" : "View demo archival storyboard"}</span>
                    </button>
                    {showHistoricalBoard && (
                      <div className="mt-2 overflow-hidden rounded border border-border bg-secondary/30 p-1.5 space-y-1">
                        <p className="text-[10px] text-muted-foreground italic font-sans">
                          {originalBoard.caption || "Archival production storyboard from original production book."}
                        </p>
                        <img
                          src={originalBoard.url}
                          alt="Archival production storyboard"
                          className="aspect-video w-full object-contain rounded bg-background"
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Scene Overhead Diagram Card */}
              <section className="space-y-2 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Map className="size-3.5 text-steel" />
                      Scene Overhead Diagram
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {sceneSlug || "Current Scene"} · Layer: Setup {shot.setup || shot.number}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] px-2 text-steel cursor-pointer"
                    onClick={() => setView("stage")}
                  >
                    Edit Blocking →
                  </Button>
                </div>

                <div className="overflow-hidden rounded-md border border-border bg-paper aspect-[16/9]">
                  <OverheadPlan shot={shot} compact originalUrl={null} />
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  1 overhead diagram per scene. Each setup acts as an active camera and actor blocking layer over this room layout.
                </p>

                {/* Archival Overhead Reference */}
                {originalOverhead?.url && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowHistoricalOverhead(!showHistoricalOverhead)}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                    >
                      <span>{showHistoricalOverhead ? "Hide demo archival diagram" : "View demo archival diagram"}</span>
                    </button>
                    {showHistoricalOverhead && (
                      <div className="mt-2 overflow-hidden rounded border border-border bg-secondary/30 p-1.5 space-y-1">
                        <img
                          src={originalOverhead.url}
                          alt="Archival overhead diagram"
                          className="aspect-[16/9] w-full object-contain rounded bg-background"
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center p-4 text-center">
              <ImageIcon className="size-6 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                Select a setup to view or upload storyboard frames and overhead blocking.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Production Drawer Modal */}
      <ProductionDrawer open={prodDrawerOpen} onOpenChange={setProdDrawerOpen} />
    </div>
  );
}
