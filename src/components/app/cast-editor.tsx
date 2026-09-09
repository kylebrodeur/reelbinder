import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCharacter } from "@/lib/cast";
import { useSlate } from "@/lib/store";
import type { CharacterBible } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";
import { useEffect, useState } from "react";

export function CastEditor() {
  const project = useSlate((s) => s.project);
  const patchProject = useSlate((s) => s.patchProject);
  const [rows, setRows] = useState<CharacterBible[]>(project.characters);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setRows(project.characters);
    setSaved(true);
  }, [project.id, project.characters]);

  const save = () => {
    const next = rows.map((r) => normalizeCharacter(r)).filter((c): c is CharacterBible => Boolean(c));
    patchProject({ characters: next });
    setRows(next);
    setSaved(true);
  };

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        One card per person. Also-called names lock to the same face in lining,
        overhead, and prompts. Drag any person onto the Stage floor plan.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border p-3 transition-colors hover:border-steel/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-1">
            <div
              draggable={Boolean(row.name?.trim())}
              onDragStart={(e) => {
                if (!row.name?.trim()) return;
                const figureId = row.name.toLowerCase().replace(/\s+/g, "-");
                e.dataTransfer.setData(
                  "application/json",
                  JSON.stringify({
                    type: "cast",
                    projectId: project.id,
                    id: figureId,
                    name: row.name.trim(),
                  }),
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              className={cn(
                "flex items-center gap-1.5 font-medium select-none px-1 py-0.5 rounded",
                row.name?.trim() ? "cursor-grab active:cursor-grabbing hover:bg-secondary text-foreground" : "opacity-50",
              )}
              title={row.name?.trim() ? "Drag cast member onto Stage floor plan" : "Enter a name to drag onto stage"}
            >
              <GripVertical className="size-3.5 text-muted-foreground" />
              <span>{row.name?.trim() || `Person ${i + 1}`}</span>
            </div>
            {row.name?.trim() ? (
              <span className="text-[10px] text-muted-foreground/70">Drag to Stage</span>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Name on the page"
              value={row.name}
              aria-label="Character name"
              onChange={(e) => {
                setSaved(false);
                setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)));
              }}
            />
            <Input
              placeholder="Also called - stage name, nickname"
              value={(row.aliases ?? []).join(", ")}
              aria-label="Also called"
              onChange={(e) => {
                setSaved(false);
                setRows(
                  rows.map((r, j) =>
                    j === i
                      ? {
                          ...r,
                          aliases: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }
                      : r,
                  ),
                );
              }}
            />
          </div>
          <Input
            placeholder="Look — wardrobe, age, hair"
            value={row.look}
            aria-label="Look"
            onChange={(e) => {
              setSaved(false);
              setRows(rows.map((r, j) => (j === i ? { ...r, look: e.target.value } : r)));
            }}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRows([...rows, { name: "", look: "", aliases: [] }])}>
          Add person
        </Button>
        <Button onClick={save} disabled={saved}>
          {saved ? "Cast saved" : "Save cast"}
        </Button>
      </div>
    </div>
  );
}
