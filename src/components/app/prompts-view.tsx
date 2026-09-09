import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { promptForShot, sequencePrompt } from "@/lib/prompts";
import { useSlate } from "@/lib/store";
import { TARGET_LABEL } from "@/lib/types";

export function PromptsView() {
  const project = useSlate((s) => s.project);
  const selectShot = useSlate((s) => s.selectShot);

  const copyAll = async () => {
    await navigator.clipboard.writeText(sequencePrompt(project, project.target));
    toast.success("Full sequence copied");
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Sequence · {TARGET_LABEL[project.target]}
            </p>
            <h2 className="font-display text-3xl">{project.name}</h2>
          </div>
          <Button variant="secondary" onClick={copyAll}>
            <Copy />
            Copy all
          </Button>
        </div>
        {project.shots.map((shot) => (
          <article key={shot.id} className="rounded-xl border border-border bg-card p-4">
            <button
              type="button"
              className="mb-3 flex w-full items-baseline justify-between text-left"
              onClick={() => selectShot(shot.id)}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {String(shot.number).padStart(2, "0")} · {shot.durationSec}s
              </span>
              <span className="font-medium">{shot.title}</span>
            </button>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
              {promptForShot(shot, project, project.target)}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(shot.imaginePrompt)
                    .then(() => toast.success("Imagine copied"))
                }
              >
                Imagine
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(shot.veoPrompt).then(() => toast.success("Veo copied"))
                }
              >
                Veo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(shot.runwayPrompt)
                    .then(() => toast.success("Runway copied"))
                }
              >
                Runway
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
