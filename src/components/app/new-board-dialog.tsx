import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { breakdownBoard } from "@/lib/ai";
import { STYLE_PRESETS } from "@/lib/filmmaking";
import { isFountainText, linkShotsInOrder, parseFountain, scriptFromShots } from "@/lib/fountain";
import { refreshProjectPrompts } from "@/lib/prompts";
import { SAMPLE_SLATE } from "@/lib/sample-project";
import { isSlateText } from "@/lib/slate-md";
import { isZipFile, unpackSlate } from "@/lib/slate-pack";
import { useSlate } from "@/lib/store";
import type { Target } from "@/lib/types";
import { emptyShot, emptyWorld, emptyFloor, emptyTimeline, TARGET_LABEL, TARGETS } from "@/lib/types";
import { uid } from "@/lib/utils";

export function NewBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const replaceProject = useSlate((s) => s.replaceProject);
  const loadSample = useSlate((s) => s.loadSample);
  const importFountain = useSlate((s) => s.importFountain);
  const importSlate = useSlate((s) => s.importSlate);
  const newBoard = useSlate((s) => s.newBoard);
  const [mode, setMode] = useState<"script" | "logline">("script");
  const [pages, setPages] = useState("");
  const [logline, setLogline] = useState(
    "A 20-second product film: a designer opens a laptop in a quiet studio at dawn and the interface comes alive.",
  );
  const [styleId, setStyleId] = useState<string>("cinematic");
  const [target, setTarget] = useState<Target>("imagine");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const style = STYLE_PRESETS.find((s) => s.id === styleId)?.prompt ?? STYLE_PRESETS[0].prompt;

  const applyFountain = (text: string) => {
    const res = importFountain(text);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onOpenChange(false);
    toast.success(`${res.shots} beats boarded from the script`);
  };

  const runLogline = async () => {
    if (!logline.trim()) {
      toast.error("Write the film in one sentence first.");
      return;
    }
    setBusy(true);
    const res = await breakdownBoard({
      data: { logline: logline.trim(), style, target, count },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    let shots = res.shots.map((s, i) =>
      emptyShot({
        id: uid("shot"),
        number: i + 1,
        title: s.title,
        action: s.action,
        dialogue: s.dialogue,
        camera: s.camera,
        movement: s.movement,
        screenDirection: s.screenDirection,
        durationSec: s.durationSec,
        timeOfDay: s.timeOfDay,
        location: s.location,
        characters: s.characters,
        lighting: s.lighting,
        notes: s.notes,
      }),
    );
    let script = [] as ReturnType<typeof parseFountain>["elements"];
    if (res.script && isFountainText(res.script)) {
      script = parseFountain(res.script).elements;
      shots = linkShotsInOrder(shots, script);
    }
    if (script.length === 0) {
      const syn = scriptFromShots(res.name, shots);
      script = syn.script;
      shots = syn.shots;
    }
    const project = refreshProjectPrompts({
      id: uid("proj"),
      name: res.name,
      logline: logline.trim(),
      style: res.style || style,
      target,
      world: emptyWorld(),
      characters: res.characters,
      script,
      skills: [],
      chain: [],
      cutUrl: null,
      binder: [],
      breakdown: [],
      marks: [],
      floor: emptyFloor(),
      timeline: emptyTimeline(),
      updatedAt: Date.now(),
      shots,
    });
    replaceProject(project);
    onOpenChange(false);
    toast.success(`${project.shots.length} shots linked to the script`);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (isZipFile(file)) {
      void file.arrayBuffer().then(async (buf) => {
        try {
          const project = await unpackSlate(buf);
          replaceProject(project);
          onOpenChange(false);
          toast.success(`Opened ${project.name}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not open that ReelBinder project archive.");
        }
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (file.name.endsWith(".json") || (text.trim().startsWith("{") && !file.name.endsWith(".jsonl"))) {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.shots)) {
            toast.error("That JSON is not a ReelBinder project.");
            return;
          }
          replaceProject(parsed);
          onOpenChange(false);
          toast.success("Project imported");
        } catch {
          toast.error("Could not read that JSON.");
        }
        return;
      }
      if (isSlateText(text) || file.name.endsWith(".md") || file.name.endsWith(".jsonl")) {
        const res = file.name.endsWith(".jsonl") ? importSlate(pages || SAMPLE_SLATE, text) : importSlate(text);
        if (!res.ok) toast.error(res.error);
        else {
          onOpenChange(false);
          toast.success(`${res.shots} lines from project source`);
        }
        return;
      }
      applyFountain(text);
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New script</DialogTitle>
          <DialogDescription>
            Paste a screenplay, import a ReelBinder project archive, or break a logline into coverage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex rounded-md bg-secondary p-1">
          <button
            type="button"
            className={`h-8 flex-1 rounded-sm text-xs ${mode === "script" ? "bg-card text-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("script")}
          >
            Script
          </button>
          <button
            type="button"
            className={`h-8 flex-1 rounded-sm text-xs ${mode === "logline" ? "bg-card text-foreground" : "text-muted-foreground"}`}
            onClick={() => setMode("logline")}
          >
            Logline
          </button>
        </div>
        {mode === "script" ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <Label>Screenplay</Label>
              <Textarea
                rows={10}
                className="font-script text-sm leading-snug"
                placeholder={SAMPLE_SLATE.slice(0, 220)}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (!pages.trim()) {
                    toast.error("Paste a screenplay first.");
                    return;
                  }
                  applyFountain(pages);
                }}
              >
                Board this script
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                Import file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.md,.slate.md,.jsonl,.fountain,.txt,.fdx,.json,text/plain,application/json,application/zip"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                newBoard();
                onOpenChange(false);
              }}
            >
              Start blank
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                loadSample();
                onOpenChange(false);
              }}
            >
              Load sample project
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <Label>Logline</Label>
              <Textarea rows={4} value={logline} onChange={(e) => setLogline(e.target.value)} />
            </label>
            <label className="grid gap-1.5">
              <Label>Style lock</Label>
              <Select value={styleId} onValueChange={setStyleId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_PRESETS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5">
              <Label>Target</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGETS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TARGET_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5">
              <Label>Shots · {count}</Label>
              <Slider min={3} max={8} step={1} value={[count]} onValueChange={([v]) => setCount(v ?? 6)} />
            </label>
            <Button onClick={runLogline} disabled={busy}>
              {busy ? "Writing coverage…" : "Write script and board"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CharacterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const project = useSlate((s) => s.project);
  const patchProject = useSlate((s) => s.patchProject);
  const [rows, setRows] = useState(project.characters);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setRows(project.characters);
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cast</DialogTitle>
          <DialogDescription>
            One look per person in the production book. Also-called names lock to the same face.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <Input
                placeholder="Name"
                value={row.name}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
              />
              <Input
                className="sm:col-span-2"
                placeholder="Wardrobe, age, hair"
                value={row.look}
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, look: e.target.value } : r)))
                }
              />
            </div>
          ))}
          <Button variant="outline" onClick={() => setRows([...rows, { name: "", look: "" }])}>
            Add person
          </Button>
          <Button
            onClick={() => {
              patchProject({ characters: rows.filter((r) => r.name.trim()) });
              onOpenChange(false);
            }}
          >
            Save lock
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
