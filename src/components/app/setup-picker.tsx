import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { coverageLabel, LINE_COLOR_BG } from "@/lib/lining";
import { useSlate } from "@/lib/store";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SetupPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const project = useSlate((s) => s.project);
  if (!project.shots.length) return null;
  const current = project.shots.find((s) => s.id === selectedId) ?? project.shots[0];
  if (!current) return null;

  const groups: { sceneId: string; heading: string; shots: Shot[] }[] = [];
  for (const shot of project.shots) {
    const sceneId = shot.sceneId ?? "_";
    const last = groups[groups.length - 1];
    if (last && last.sceneId === sceneId) {
      last.shots.push(shot);
      continue;
    }
    const scene = project.script.find((e) => e.id === sceneId);
    groups.push({
      sceneId,
      heading: scene?.text ?? "Coverage",
      shots: [shot],
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="lining-chip h-8 max-w-[12.5rem] shrink-0 gap-1.5 px-2.5"
          aria-label={`Coverage ${coverageLabel(current)}`}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", LINE_COLOR_BG[current.lineColor])} />
          <span className="truncate">{coverageLabel(current)}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="z-[80] max-h-80 min-w-64 overflow-y-auto">
        {groups.map((group) => (
          <DropdownMenuGroup key={group.sceneId}>
            <DropdownMenuLabel className="font-script text-[10px] uppercase tracking-wide">
              {group.heading}
            </DropdownMenuLabel>
            {group.shots.map((shot) => (
              <DropdownMenuItem
                key={shot.id}
                onClick={() => onSelect(shot.id)}
                className={cn("font-script", shot.id === current.id && "bg-accent")}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", LINE_COLOR_BG[shot.lineColor])} />
                <span className="w-[4.5rem] shrink-0 tabular-nums">{coverageLabel(shot)}</span>
                <span className="min-w-0 truncate text-muted-foreground">{shot.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
