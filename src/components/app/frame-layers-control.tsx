import { Grid3X3, Image as ImageIcon, Layers, Pencil, PersonStanding } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FrameLayerSettings } from "@/lib/frame-renderer";
export { DEFAULT_FRAME_LAYERS, type FrameLayerSettings } from "@/lib/frame-renderer";

export function FrameLayersControl({
  settings,
  onChange,
  hasImage = false,
  className,
}: {
  settings: FrameLayerSettings;
  onChange: (next: FrameLayerSettings) => void;
  hasImage?: boolean;
  className?: string;
}) {
  const toggle = (key: keyof Omit<FrameLayerSettings, "onionSkinOpacity">) => {
    onChange({ ...settings, [key]: !settings[key] });
  };

  return (
    <div
      role="toolbar"
      aria-label="Viewfinder layers"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border/80 bg-card/95 px-2.5 py-1.5 shadow-sm backdrop-blur-xs text-xs text-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-muted-foreground mr-1">
        <Layers className="size-3.5" />
        <span className="font-script text-[11px] uppercase tracking-wide">Layers</span>
      </div>

      <div className="flex items-center gap-1 border-r border-border/60 pr-2">
        {/* Guides Toggle */}
        <Button
          type="button"
          size="sm"
          variant={settings.guides ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          aria-pressed={settings.guides}
          title={settings.guides ? "Hide framing & thirds guides" : "Show framing & thirds guides"}
          onClick={() => toggle("guides")}
        >
          <Grid3X3 className="size-3.5" />
          <span className="hidden sm:inline">Guides</span>
        </Button>

        {/* Wireframe Figures Toggle */}
        <Button
          type="button"
          size="sm"
          variant={settings.wireframe ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          aria-pressed={settings.wireframe}
          title={settings.wireframe ? "Hide wireframe figures" : "Show wireframe figures"}
          onClick={() => toggle("wireframe")}
        >
          <PersonStanding className="size-3.5" />
          <span className="hidden sm:inline">Figures</span>
        </Button>

        {/* Markup / Pencil Annotations Toggle */}
        <Button
          type="button"
          size="sm"
          variant={settings.markup ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          aria-pressed={settings.markup}
          title={settings.markup ? "Hide drawing markup & arrows" : "Show drawing markup & arrows"}
          onClick={() => toggle("markup")}
        >
          <Pencil className="size-3.5" />
          <span className="hidden sm:inline">Markup</span>
        </Button>

        {/* Image Toggle (if frame image is present) */}
        {hasImage ? (
          <Button
            type="button"
            size="sm"
            variant={settings.image ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            aria-pressed={settings.image}
            title={settings.image ? "Hide generated take" : "Show generated take"}
            onClick={() => toggle("image")}
          >
            <ImageIcon className="size-3.5" />
            <span className="hidden sm:inline">Take</span>
          </Button>
        ) : null}
      </div>

      {/* Onion-Skin Opacity Slider (when both image and wireframe/markup are active) */}
      {hasImage && settings.image ? (
        <div className="flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
          <label htmlFor="onion-skin-range" className="shrink-0 cursor-pointer select-none">
            Overlay: <span className="font-mono font-medium text-foreground">{Math.round(settings.onionSkinOpacity * 100)}%</span>
          </label>
          <input
            id="onion-skin-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.onionSkinOpacity}
            onChange={(e) => onChange({ ...settings, onionSkinOpacity: parseFloat(e.target.value) })}
            className="h-1.5 w-16 cursor-pointer accent-primary sm:w-20"
            title={`Adjust wireframe overlay opacity: ${Math.round(settings.onionSkinOpacity * 100)}%`}
          />
        </div>
      ) : null}
    </div>
  );
}
