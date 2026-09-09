import { History, Redo2, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHistory } from "@/lib/history";

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function HistoryControl() {
  const past = useHistory((s) => s.past);
  const future = useHistory((s) => s.future);
  const undo = useHistory((s) => s.undo);
  const redo = useHistory((s) => s.redo);
  const jumpTo = useHistory((s) => s.jumpTo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, past.length]);

  const list = [...past].reverse();

  return (
    <div className="flex items-center">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Undo"
        disabled={past.length === 0}
        onClick={() => undo()}
      >
        <Undo2 />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Redo"
        disabled={future.length === 0}
        onClick={() => redo()}
      >
        <Redo2 />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label="History"
            disabled={past.length === 0 && future.length === 0}
          >
            <History />
            <span className="hidden sm:inline">History</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[80] w-64">
          <DropdownMenuLabel>History</DropdownMenuLabel>
          <DropdownMenuItem disabled>Now</DropdownMenuItem>
          {list.map((e) => (
            <DropdownMenuItem key={e.id} onClick={() => jumpTo(e.id)}>
              <span className="flex-1 truncate">{e.label}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">{clock(e.at)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
