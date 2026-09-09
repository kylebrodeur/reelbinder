import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { flushSave, getSaveState, subscribeSave, type SaveState } from "@/lib/save";

export function useSaveState(): SaveState {
  const [state, setState] = useState(getSaveState);
  useEffect(() => subscribeSave(setState), []);
  return state;
}

function ago(ts: number | null): string {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function SaveControl({ compact = false }: { compact?: boolean }) {
  const { status, savedAt } = useSaveState();
  const label =
    status === "saving"
      ? "Saving"
      : status === "unsaved"
        ? "Unsaved"
        : status === "error"
          ? "Couldn’t save"
          : "Saved";

  const onSave = () => {
    flushSave();
    const next = getSaveState();
    if (next.status === "saved") toast.success("Saved");
    else if (next.status === "error") toast.error("Could not save this board.");
  };

  return (
    <div className="flex items-center" aria-live="polite">
      <Button
        size={compact ? "icon-sm" : "sm"}
        variant={status === "unsaved" || status === "error" ? "secondary" : "ghost"}
        onClick={onSave}
        aria-label={status === "saved" ? "Project saved" : "Save project"}
        title={status === "saved" && savedAt ? `Saved ${ago(savedAt)}` : label}
      >
        {status === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
        {compact ? null : (
          <span>{status === "unsaved" ? "Save" : status === "error" ? "Retry save" : label}</span>
        )}
      </Button>
    </div>
  );
}

export function EditorSaveButton({
  label = "Save",
  onSave,
}: {
  label?: string;
  onSave?: () => boolean | void;
}) {
  const { status } = useSaveState();
  return (
    <Button
      size="sm"
      variant={status === "unsaved" || status === "error" ? "secondary" : "outline"}
      onClick={() => {
        const ok = onSave?.();
        if (ok === false) return;
        flushSave();
        if (getSaveState().status === "saved") toast.success("Saved");
      }}
    >
      {status === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
      {label}
    </Button>
  );
}
