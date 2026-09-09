import { Textarea } from "@/components/ui/textarea";
import { useSlate } from "@/lib/store";
import type { Shot } from "@/lib/types";

/** Planning stays authored setup data; guidance is never inserted as a template. */
export function KeyFrameGuidance({ projectId, shot, mode, disabled = false }: {
  projectId: string;
  shot: Shot;
  mode: "frame" | "take";
  disabled?: boolean;
}) {
  return (
    <section aria-label="Key-frame planning" className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <p className="font-medium">Plan the key frame and the cut</p>
      <p className="text-muted-foreground">
        {mode === "frame"
          ? "Choose one frozen instant: starting pose, gaze, hands and prop placement. Describe that instant in Image direction; save the wider action plan below."
          : "Start from a readable pose. Describe one feasible action and its end intent in the motion direction below. Fit the action to the selected take length."}
      </p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        <li>Keep faces, wardrobe, props, lighting and screen direction consistent.</li>
        <li>Check contact, weight and travel distance. Avoid impossible transfers or overlapping actions.</li>
        <li>Plan the cut before the target leaves frame; allow extra footage before and after the action for editing handles.</li>
      </ul>
      <p className="text-muted-foreground">
        {mode === "frame"
          ? "Capture the Frame plan locally, compare it with the overhead, and approve it before generating a storyboard. The photoreal step uses one selected, placement-reviewed storyboard. A still is one instant, never a montage or time sequence."
          : "Veo receives only the one selected photoreal still as its starting image. End intent remains text direction; this tranche does not send or enforce intermediate or end keyframes and does not claim an animatic workflow."}
      </p>
      {mode === "frame" && (
        <label className="grid gap-1.5">
          Setup planning notes
          <Textarea
            rows={3}
            value={shot.notes}
            disabled={disabled}
            placeholder="Starting pose; key action; end intent; continuity anchors; reference purpose; cut and handles…"
            onChange={(event) => {
              if (disabled) return;
              const current = useSlate.getState();
              const selectedId = current.selectedId ?? current.project.shots[0]?.id;
              if (current.project.id !== projectId || selectedId !== shot.id ||
                  !current.project.shots.some((candidate) => candidate.id === shot.id)) return;
              current.patchShot(shot.id, { notes: event.target.value });
            }}
          />
          <span className="text-muted-foreground">
            These are your existing setup notes, shared with coverage and the prompt chain. They are saved only when you edit. Existing take drafts and pending requests keep their original direction.
          </span>
        </label>
      )}
    </section>
  );
}
