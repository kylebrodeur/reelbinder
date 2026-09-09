import { Copy, FileText, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PromptChain } from "@/components/app/prompt-chain";
import { EditorSaveButton } from "@/components/app/save-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CAMERA_META,
  DIRECTION_META,
  MOVEMENT_META,
  PERSPECTIVE_ANGLES,
  TIME_META,
  perspectiveAngleFromCamera,
} from "@/lib/filmmaking";
import { coverageRole } from "@/lib/coverage-edit";
import { slugForScene } from "@/lib/fountain";
import { coverageLabel, framingLabel, LINE_COLOR_BG } from "@/lib/lining";
import { useSlate } from "@/lib/store";
import {
  CAMERA_FOR_FRAMING,
  createScriptReview,
  narrativeForShot,
  type NarrativeKind,
  type ScriptReview,
} from "@/lib/script-linkage";
import type {
  CameraAngle,
  CameraMovement,
  CoverageSize,
  ScreenDirection,
  TimeOfDay,
} from "@/lib/types";
import {
  COVERAGE_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  SCREEN_DIRECTIONS,
  TIMES_OF_DAY,
  isBoardable,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function Inspector({ embedded = false }: { embedded?: boolean }) {
  const [review, setReview] = useState<ScriptReview | null>(null);
  const [reviewError, setReviewError] = useState("");
  const project = useSlate((s) => s.project);
  const selectedId = useSlate((s) => s.selectedId);
  const selectedElementId = useSlate((s) => s.selectedElementId);
  const patchShot = useSlate((s) => s.patchShot);
  const deleteShot = useSlate((s) => s.deleteShot);
  const duplicateShot = useSlate((s) => s.duplicateShot);
  const boardElement = useSlate((s) => s.boardElement);
  const setView = useSlate((s) => s.setView);
  const issues = useSlate((s) => s.issues);
  const shot = project.shots.find((s) => s.id === selectedId);
  const element = project.script.find((e) => e.id === selectedElementId);

  if (!shot) {
    return (
      <aside
        className={
          embedded
            ? "p-4"
            : "hidden min-h-0 w-full shrink-0 border-t border-border bg-card p-6 lg:flex lg:h-full lg:w-80 lg:flex-col lg:border-l lg:border-t-0"
        }
      >
        {element && (isBoardable(element.kind) || element.kind === "scene") ? (
          <div className="space-y-4">
            <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">
              {element.kind}
            </p>
            <p className="text-sm leading-relaxed">{element.text || "Empty beat."}</p>
            <Button onClick={() => boardElement(element.id)}>Board this beat</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a beat in the script, or a frame on the board.
          </p>
        )}
      </aside>
    );
  }

  const shotIssues = issues.filter((i) => i.shotId === shot.id);
  const rule = CAMERA_META[shot.camera]?.rule ?? "";
  const slug = slugForScene(project.script, shot.sceneId);
  const linked = project.script.filter((e) => shot.elementIds.includes(e.id));
  const narrative = linked.length ? narrativeForShot(project.script, shot) : shot;
  const openReview = (kind: NarrativeKind) => {
    const next = createScriptReview(useSlate.getState().project, shot.id, kind);
    if (!next) {
      setView("script");
      return;
    }
    setReviewError("");
    setReview(next);
  };
  const changedBeats = review?.edits.filter((edit) => edit.before !== edit.after).length ?? 0;

  return (
    <aside
      className={
        embedded
          ? "flex min-h-0 h-full flex-col overflow-hidden"
          : "flex min-h-0 max-h-[46vh] w-full shrink-0 flex-col overflow-hidden border-t border-border bg-card lg:max-h-none lg:h-full lg:w-80 lg:border-l lg:border-t-0"
      }
    >
      <div className={cn("flex shrink-0 items-center justify-between gap-2 border-b border-border", embedded ? "bg-muted/20 px-3 py-2" : "px-4 py-3")}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-script text-xs uppercase tracking-wide text-muted-foreground">
            <span className={cn("size-2 rounded-full", LINE_COLOR_BG[shot.lineColor])} />
            <span className="font-semibold text-foreground">{coverageLabel(shot)}</span>
            {shot.location ? <span className="truncate text-muted-foreground">· {shot.location}</span> : ""}
          </p>
          <p className="truncate font-semibold leading-tight text-foreground">{shot.title || "Untitled"}</p>
        </div>
        <div className="flex items-center">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => duplicateShot(shot.id)}
            aria-label="Duplicate"
            title="Duplicate setup"
          >
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => deleteShot(shot.id)}
            aria-label="Delete shot"
            title="Delete setup"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className={embedded ? "px-1 pb-4" : "p-4"}>
          <Tabs defaultValue="shot">
            <TabsList className="w-full">
              <TabsTrigger value="shot" className="flex-1">
                Shot
              </TabsTrigger>
              <TabsTrigger value="prompt" className="flex-1">
                Prompt tuning
              </TabsTrigger>
            </TabsList>
            <TabsContent value="shot" className="space-y-4">
              {slug ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md bg-secondary px-3 py-2 text-left"
                  onClick={() => setView("script")}
                >
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block font-script text-xs uppercase tracking-wide text-muted-foreground">
                      {slug}
                    </span>
                    {linked[0]?.text ? (
                      <span className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                        {linked[0].text}
                      </span>
                    ) : null}
                  </span>
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This frame is not linked to the script yet. Select a beat, then board it.
                </p>
              )}
              <Field label="Title">
                <Input
                  value={shot.title}
                  onChange={(e) => patchShot(shot.id, { title: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Setup">
                  <Input
                    value={shot.setup}
                    onChange={(e) => patchShot(shot.id, { setup: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label="Coverage role">
                  <Select
                    value={coverageRole(shot)}
                    onValueChange={(value) =>
                      patchShot(shot.id, { coverageRole: value as "master" | "angle" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master">Full Coverage (Master · whole scene)</SelectItem>
                      <SelectItem value="angle">Coverage Shot (Angle · lined passage)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Framing">
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
                    <SelectTrigger>
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
                </Field>
                <Field label="Move">
                  <Select
                    value={shot.movement}
                    onValueChange={(v) => patchShot(shot.id, { movement: v as CameraMovement })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_MOVEMENTS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {MOVEMENT_META[a].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Camera angle">
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
                    <SelectTrigger>
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
                </Field>
                <Field label="Screen direction">
                  <Select
                    value={shot.screenDirection}
                    onValueChange={(v) =>
                      patchShot(shot.id, { screenDirection: v as ScreenDirection })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCREEN_DIRECTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {DIRECTION_META[a].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Time of day">
                <Select
                  value={shot.timeOfDay}
                  onValueChange={(v) => patchShot(shot.id, { timeOfDay: v as TimeOfDay })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMES_OF_DAY.map((a) => (
                      <SelectItem key={a} value={a}>
                        {TIME_META[a].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={linked.length ? "Action · screenplay" : "Action · unlinked draft"}>
                <Textarea
                  rows={4}
                  value={narrative.action}
                  readOnly={linked.length > 0}
                  onChange={(e) => patchShot(shot.id, { action: e.target.value })}
                />
                {linked.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => openReview("action")}>
                    {linked.some((element) => element.kind === "action")
                      ? "Edit action beats"
                      : "Add action in Script"}
                  </Button>
                )}
              </Field>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {linked.length
                  ? `Production direction is saved with ${linked.length} linked screenplay beats. Edit the scene heading in Script when the story's time or location changes.`
                  : "Line this setup on the script to attach its production direction to screenplay beats."}
              </p>
              <div className="rounded-md bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {rule}
              </div>
              <Field label={`Duration · ${shot.durationSec}s`}>
                <Slider
                  min={3}
                  max={Math.max(30, shot.durationSec)}
                  step={1}
                  value={[shot.durationSec]}
                  onValueChange={([v]) => patchShot(shot.id, { durationSec: v ?? 6 })}
                />
              </Field>
              <Field label="Location">
                <Input
                  value={shot.location}
                  onChange={(e) => patchShot(shot.id, { location: e.target.value })}
                />
              </Field>
              <Field label="Lighting phrase">
                <Input
                  value={shot.lighting}
                  onChange={(e) => patchShot(shot.id, { lighting: e.target.value })}
                />
              </Field>
              <Field label="Characters on camera">
                <Input
                  value={shot.characters.join(", ")}
                  onChange={(e) =>
                    patchShot(shot.id, {
                      characters: e.target.value
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label={linked.length ? "Dialogue · screenplay" : "Dialogue · unlinked draft"}>
                <Textarea
                  rows={3}
                  value={narrative.dialogue}
                  readOnly={linked.length > 0}
                  onChange={(e) => patchShot(shot.id, { dialogue: e.target.value })}
                />
                {linked.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => openReview("dialogue")}>
                    {linked.some((element) => element.kind === "dialogue")
                      ? "Edit dialogue beats"
                      : "Add dialogue in Script"}
                  </Button>
                )}
              </Field>
              <EditorSaveButton label="Save setup" />
              {shotIssues.length > 0 && (
                <div className="space-y-2">
                  {shotIssues.map((iss) => (
                    <div key={iss.id} className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            iss.severity === "error"
                              ? "error"
                              : iss.severity === "warn"
                                ? "warn"
                                : "outline"
                          }
                        >
                          {iss.severity}
                        </Badge>
                        <p className="text-xs font-medium">{iss.title}</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {iss.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="prompt" className="space-y-4">
              <PromptChain shot={shot} />
              <EditorSaveButton label="Save prompt tuning" />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit screenplay beats</DialogTitle>
            <DialogDescription>
              Review each affected beat. Applying updates the screenplay and every setup that covers
              these beats.
            </DialogDescription>
          </DialogHeader>
          {review?.edits.map((edit, index) => (
            <div key={edit.elementId} className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium">
                Beat {project.script.findIndex((element) => element.id === edit.elementId) + 1} ·{" "}
                {edit.kind}
                {edit.character ? ` · ${edit.character}` : ""}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Current screenplay</p>
                  <p className="whitespace-pre-wrap rounded-md bg-secondary p-3 font-script text-sm">
                    {edit.before || "Empty beat"}
                  </p>
                </div>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Proposed screenplay
                  <Textarea
                    rows={4}
                    className="font-script text-sm text-foreground"
                    value={edit.after}
                    onChange={(event) =>
                      setReview((current) =>
                        current
                          ? {
                              ...current,
                              edits: current.edits.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, after: event.target.value } : item,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          {reviewError && (
            <p className="text-sm text-destructive" role="alert">
              {reviewError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              disabled={!changedBeats}
              onClick={() => {
                if (!review) return;
                const result = useSlate.getState().applyScriptReview(review);
                if (!result.ok) {
                  setReviewError(result.error);
                  return;
                }
                setReview(null);
              }}
            >
              Apply {changedBeats || ""} screenplay {changedBeats === 1 ? "edit" : "edits"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}
