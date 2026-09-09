import { Check } from "lucide-react";
import { ConnectionsPanel } from "@/components/app/cinema-connections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSlate } from "@/lib/store";
import { useTheme } from "@/lib/ui-theme";
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
  onOpenWorld,
  onOpenCast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWorld: () => void;
  onOpenCast: () => void;
}) {
  const project = useSlate((state) => state.project);
  const patchProject = useSlate((state) => state.patchProject);
  const { theme, setTheme, themes } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Project details, appearance themes and account connections.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="project">
          <TabsList aria-label="Settings">
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="app">App</TabsTrigger>
          </TabsList>
          <TabsContent value="project" className="space-y-4 pt-2">
            <label className="grid gap-1.5 text-sm">
              Project name
              <Input
                className="h-9"
                value={project.name}
                onChange={(event) => patchProject({ name: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Logline
              <Textarea
                rows={3}
                value={project.logline}
                onChange={(event) => patchProject({ logline: event.target.value })}
                placeholder="What happens, and why does it matter?"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Visual style
              <Textarea
                rows={3}
                value={project.style}
                onChange={(event) => patchProject({ style: event.target.value })}
                placeholder="The look shared by every setup."
              />
              <span className="text-xs text-muted-foreground">
                Applied to the direction used for new generated frames and clips.
              </span>
            </label>
            <div className="border-t border-border pt-4">
              <p className="mb-3 text-sm text-muted-foreground">
                Keep the location, lighting and character details in the Production Book.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenWorld();
                  }}
                >
                  Edit world
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenCast();
                  }}
                >
                  Edit cast
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Changes save automatically in this browser. The header shows the save status.
            </p>
          </TabsContent>
          <TabsContent value="appearance" className="space-y-5 pt-2">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Workspace theme</h4>
              <p className="text-xs text-muted-foreground">
                Select your preferred studio palette. The authentic screenplay paper and storyboard
                backing remain intact across all themes.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {themes.map((t) => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "flex flex-col rounded-lg border p-3 text-left transition-all",
                      active
                        ? "border-steel bg-accent/50 ring-1 ring-steel"
                        : "border-border bg-card/60 hover:border-steel/50 hover:bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{t.name}</span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t.badge}
                        </span>
                      </div>
                      {active && <Check className="size-4 text-steel" />}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t.description}
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 pt-1">
                      <span
                        className="size-3.5 rounded-full border border-white/20 shadow-sm"
                        style={{ backgroundColor: t.swatch.bg }}
                        title="Background"
                      />
                      <span
                        className="size-3.5 rounded-full border border-white/20 shadow-sm"
                        style={{ backgroundColor: t.swatch.card }}
                        title="Surface / Card"
                      />
                      <span
                        className="size-3.5 rounded-full border border-white/20 shadow-sm"
                        style={{ backgroundColor: t.swatch.accent }}
                        title="Accent"
                      />
                      <span
                        className="size-3.5 rounded-full border border-white/20 shadow-sm"
                        style={{ backgroundColor: t.swatch.text }}
                        title="Type"
                      />
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {t.swatch.bg}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="app" className="space-y-5 pt-2">
            <div className="space-y-2 border-b border-border pb-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Your project autosaves in this browser. Export a ReelBinder project archive
                (.reelbinder.zip) from Project files to keep a project copy. Generated media uses
                session-protected links.
              </p>
              <p>
                Connections stay in this cinema session and out of scripts and exports. Setup
                guidance and official provider links appear below.
              </p>
            </div>
            {open && <ConnectionsPanel />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
