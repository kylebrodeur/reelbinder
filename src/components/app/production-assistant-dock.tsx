import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Bot,
  Camera,
  Info,
  Copy,
  ExternalLink,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cameraForShot, figuresForShot } from "@/lib/floor";
import { coverageLabel } from "@/lib/lining";
import {
  useProductionAssistant,
  setAssistantDraft,
  clearAssistantCommentContext,
  PRODUCTION_ASSISTANT_OPEN_EVENT,
} from "@/lib/production-assistant-store";
import { useSlate } from "@/lib/store";
import type { FloorPlan, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ContinuityCheck {
  id: string;
  type: "axis_180" | "eyeline" | "coverage" | "ok";
  severity: "warn" | "info" | "pass";
  title: string;
  detail: string;
}

function checkStageContinuity(
  shot: Shot,
  allShots: Shot[],
  floor: FloorPlan,
): ContinuityCheck[] {
  const checks: ContinuityCheck[] = [];
  const sceneShots = allShots.filter((s) => s.sceneId === shot.sceneId);
  const idx = sceneShots.findIndex((s) => s.id === shot.id);
  const prevShot = idx > 0 ? sceneShots[idx - 1] : null;

  const currentCam = cameraForShot(floor, shot);
  const prevCam = prevShot ? cameraForShot(floor, prevShot) : null;
  const currentFigures = figuresForShot(floor, shot);

  // Check 1: 180-degree line-of-action check
  if (currentCam && prevCam && currentFigures.length >= 2) {
    let f1: { x: number; y: number; name?: string } = currentFigures[0];
    let f2: { x: number; y: number; name?: string } = currentFigures[1];
    let explicitEyeline = false;
    
    // Look for an explicit eyeline target
    for (const fig of currentFigures) {
      if (fig.targetId) {
        const target = currentFigures.find(f => f.id === fig.targetId) || 
                       floor.items.find(i => i.id === fig.targetId);
        if (target && 'x' in target && 'y' in target) {
          f1 = fig;
          f2 = {
            x: target.x,
            y: target.y,
            name: "name" in target && typeof target.name === "string" ? target.name : "label" in target && typeof target.label === "string" ? target.label : "target",
          };
          explicitEyeline = true;
          break;
        }
      }
    }

    if (f1 && f2) {
      // Line of action vector: f1 -> f2
      const lineX = f2.x - f1.x;
      const lineY = f2.y - f1.y;

      // Cross product for current camera: (cam.x - f1.x) * lineY - (cam.y - f1.y) * lineX
      const crossCurrent = (currentCam.x - f1.x) * lineY - (currentCam.y - f1.y) * lineX;
      const crossPrev = (prevCam.x - f1.x) * lineY - (prevCam.y - f1.y) * lineX;

      // If signs differ, cameras are on opposite sides of the action line
      if (Math.sign(crossCurrent) !== Math.sign(crossPrev) && Math.abs(crossCurrent) > 0.01 && Math.abs(crossPrev) > 0.01) {
        checks.push({
          id: "axis-cross",
          type: "axis_180",
          severity: "warn",
          title: "180° Rule Violation (Action Axis)",
          detail: `Cameras ${prevShot?.setup} and ${shot.setup} sit on opposite sides of the line between ${f1.name} and ${f2.name || 'target'}. ${explicitEyeline ? 'This compares your explicit eyeline axis.' : 'This compares coverage-list neighbors based on arbitrary positioning, not an authored action axis. Set an eyeline target to be sure.'} Review the intended cut.`,
        });
      }
    }
  }

  // Coverage ordering and travel tokens do not establish edit continuity or gaze.
  const master = sceneShots.find((s) => s.coverageRole === "master" && s.id !== shot.id);
  if (master) {
    checks.push({
      id: "master-reference",
      type: "coverage",
      severity: "info",
      title: `Full Coverage reference (${coverageLabel(master)})`,
      detail: `Setup ${master.setup} is available for comparison. Shared range and staging alignment have not been assessed.`,
    });
  }
  checks.push({
    id: "continuity-unassessed",
    type: "ok",
    severity: "info",
    title: "Continuity not assessed",
    detail: "Coverage order and subject travel do not establish edit adjacency, an action axis or gaze. Review the selected takes and intended cut.",
  });

  return checks;
}

export function ProductionAssistantDock({ shot }: { shot: Shot }) {
  const project = useSlate((s) => s.project);
  const [draft, setDraft] = useState<{ projectId: string; shotId: string; text: string } | null>(null);
  const question = draft?.projectId === project.id && draft.shotId === shot.id ? draft.text : "";
  const currentShot = () => {
    const state = useSlate.getState();
    const selected = state.project.shots.find((item) => item.id === state.selectedId) ?? state.project.shots[0];
    return state.project.id === project.id && selected?.id === shot.id ? selected : undefined;
  };
  const openAssistant = () => {
    if (!currentShot()) return;
    window.dispatchEvent(new CustomEvent(PRODUCTION_ASSISTANT_OPEN_EVENT, { detail: { projectId: project.id } }));
  };

  const assistantSession = useProductionAssistant((s) => s.sessions[project.id]);
  const messages = assistantSession?.messages ?? [];

  const checks = useMemo(
    () => checkStageContinuity(shot, project.shots, project.floor),
    [shot, project.shots, project.floor],
  );

  const synthesizedPrompt = useMemo(() => {
    const parts = [
      `${coverageLabel(shot)} framing, ${shot.camera} camera angle`,
      shot.movement && shot.movement !== "static" ? `${shot.movement} camera motion` : null,
      shot.screenDirection && shot.screenDirection !== "static" ? `subject travel: ${shot.screenDirection}` : null,
      shot.title ? `Scene moment: ${shot.title}` : null,
      shot.action ? `Action: ${shot.action}` : null,
      shot.characters?.length ? `Featuring: ${shot.characters.join(", ")}` : null,
      shot.lighting ? `Lighting: ${shot.lighting}` : null,
      shot.location ? `Location: ${shot.location}` : null,
      shot.timeOfDay ? `Time: ${shot.timeOfDay}` : null,
    ].filter(Boolean);
    return parts.join(". ") + ".";
  }, [shot]);

  const copyPrompt = () => {
    void navigator.clipboard.writeText(synthesizedPrompt);
    toast.success("Prompt copied to clipboard");
  };

  const handleSendQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const selected = currentShot();
    if (!selected || !question.trim()) return;
    const q = question.trim();
    clearAssistantCommentContext(project.id);
    setAssistantDraft(project.id, `Stage & Blocking Question for ${selected.setup} (${selected.title}): ${q}`);
    setDraft(null);
    openAssistant();
    toast.success("Question staged in Production Assistant");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-foreground space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Bot className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold leading-tight">Stage Director Co-Pilot</h3>
          <p className="text-[11px] text-muted-foreground">Setup {shot.setup} · Continuity & Prompt Synthesis</p>
        </div>
      </div>

      {/* Continuity & 180° Line Checks */}
      <div className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Camera className="size-3" /> Director Continuity Checks
        </p>
        <div className="space-y-1.5">
          {checks.map((check) => {
            const isWarn = check.severity === "warn";
            return (
              <div
                key={check.id}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  isWarn
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                    : "border-border bg-card text-foreground",
                )}
              >
                <div className="flex items-start gap-1.5">
                  {isWarn ? (
                    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  ) : (
                    <Info className="size-4 shrink-0 text-muted-foreground mt-0.5" />
                  )}
                  <div>
                    <p className="font-medium text-[11px]">{check.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{check.detail}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dynamic Staged Prompt Synthesizer */}
      <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Sparkles className="size-3 text-amber-500" /> Stage Prompt Synthesizer
          </p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="size-6 p-0" onClick={copyPrompt} title="Copy synthesized prompt">
              <Copy className="size-3" />
            </Button>
          </div>
        </div>
        <p className="text-xs font-mono text-muted-foreground bg-background/80 rounded p-2 border border-border/50 leading-relaxed whitespace-pre-wrap select-all">
          {synthesizedPrompt}
        </p>
        <p className="text-[10px] text-muted-foreground">Copy this suggestion to review it alongside the effective image prompt.</p>
      </div>

      {/* Quick Non-blocking Q&A */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <MessageSquare className="size-3" /> Ask Stage Co-Pilot
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={openAssistant}
          >
            Open Assistant <ExternalLink className="size-2.5 ml-1" />
          </Button>
        </div>
        <form onSubmit={handleSendQuestion} className="flex gap-1.5">
          <Input
            value={question}
            onChange={(e) => setDraft({ projectId: project.id, shotId: shot.id, text: e.target.value })}
            placeholder="Ask about blocking, lighting, continuity…"
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" className="h-8 px-2.5 text-xs" disabled={!question.trim()}>
            <Send className="size-3.5" />
          </Button>
        </form>

        {/* Latest messages preview */}
        {messages.length > 0 ? (
          <div className="max-h-36 overflow-y-auto space-y-1.5 pt-1">
            {messages.slice(-3).map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "rounded p-2 text-xs",
                  msg.role === "assistant" ? "bg-card border border-border" : "bg-primary/10 text-primary",
                )}
              >
                <p className="font-semibold text-[10px] text-muted-foreground mb-0.5">
                  {msg.role === "assistant" ? "Production Assistant" : "You"}
                </p>
                <p className="text-[11px] leading-relaxed">{msg.text}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
