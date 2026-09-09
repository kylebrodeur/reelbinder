import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Always-visible original production still. Click to swap with the working frame. */
export function OriginalInset({
  originalUrl,
  originalAlt,
  originalCaption,
  workingLabel = "Working",
  compact = false,
  children,
}: {
  originalUrl?: string | null;
  originalAlt: string;
  originalCaption?: string;
  workingLabel?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const [peek, setPeek] = useState(false);
  if (!originalUrl) return children;

  return (
    <div className="relative">
      {peek ? (
        <img
          src={originalUrl}
          alt={originalAlt}
          className="aspect-video w-full bg-secondary object-contain object-top"
        />
      ) : (
        children
      )}
      {peek ? (
        <>
          {originalCaption ? (
            <p className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-xs rounded-sm bg-card/90 px-1.5 py-0.5 text-xs leading-snug text-muted-foreground">
              {originalCaption}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-1.5 top-1.5 h-7"
            onClick={() => setPeek(false)}
          >
            {workingLabel}
          </Button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setPeek(true)}
          className={cn(
            "absolute overflow-hidden rounded-sm border border-border bg-card shadow-sm",
            compact ? "bottom-1 right-1 w-16" : "bottom-2 right-2 w-32",
          )}
          aria-label={originalAlt}
        >
          <img src={originalUrl} alt="" className="aspect-video w-full object-cover object-top" />
          <span className="absolute inset-x-0 bottom-0 bg-card/90 px-1 py-0.5 text-center text-xs leading-none text-muted-foreground">
            Original
          </span>
        </button>
      )}
    </div>
  );
}
