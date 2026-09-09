import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { assemblePrompt, buildLayers } from "@/lib/prompt-chain";
import { useSlate } from "@/lib/store";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PromptChain({ shot }: { shot: Shot }) {
  const project = useSlate((s) => s.project);
  const patchShot = useSlate((s) => s.patchShot);
  const layers = useMemo(() => buildLayers(shot, project), [shot, project]);
  const assembled = useMemo(() => assemblePrompt({ ...shot, rawSource: "" }, project), [shot, project]);
  const overridden = Boolean(shot.rawSource?.trim());
  const [openRaw, setOpenRaw] = useState(overridden);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Prompts are built as a chain — world, then cast, then this setup, then the beat. Edit the
        raw source only when you need to override the chain.
      </p>
      <ol className="space-y-2">
        {layers.map((layer, i) => (
          <li key={layer.id} className="rounded-md border border-border bg-secondary/40 px-3 py-2">
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {String(i + 1).padStart(2, "0")} · {layer.title}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {layer.text}
            </p>
          </li>
        ))}
      </ol>
      <div className="rounded-md border border-border">
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between px-3 py-2 text-left text-xs",
            openRaw ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={() => setOpenRaw((v) => !v)}
        >
          <span>Raw source{overridden ? " · override on" : ""}</span>
          <span>{openRaw ? "Hide" : "Show"}</span>
        </button>
        {openRaw ? (
          <div className="space-y-2 border-t border-border p-3">
            <Textarea
              rows={8}
              className="font-mono text-xs leading-relaxed"
              value={overridden ? shot.rawSource : assembled}
              onChange={(e) => patchShot(shot.id, { rawSource: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(overridden ? shot.rawSource : assembled).then(() => {
                    toast.success("Raw source copied");
                  });
                }}
              >
                Copy raw
              </Button>
              {overridden ? (
                <Button size="sm" variant="ghost" onClick={() => patchShot(shot.id, { rawSource: "" })}>
                  Reset to chain
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
