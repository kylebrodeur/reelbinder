import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface SourceRangeSeekbarProps {
  sourceIn: number;
  sourceOut: number;
  sourceDuration?: number;
  onApply: (sourceIn: number, sourceOut: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onSeek?: (time: number) => void;
}

const MIN_EXCERPT = 0.05;
const COMMIT_EPSILON = 0.001;

function isValidRange(sourceIn: number, sourceOut: number, duration: number) {
  return (
    Number.isFinite(sourceIn) &&
    Number.isFinite(sourceOut) &&
    sourceIn >= 0 &&
    sourceOut - sourceIn >= MIN_EXCERPT &&
    sourceOut <= duration + COMMIT_EPSILON
  );
}

export function SourceRangeSeekbar({
  sourceIn,
  sourceOut,
  sourceDuration,
  onApply,
  onDraggingChange,
  onSeek,
}: SourceRangeSeekbarProps) {
  // Measured media duration when available; the current sourceOut is only a
  // conservative bound, not a verified total duration.
  const duration =
    sourceDuration && Number.isFinite(sourceDuration) && sourceDuration > 0
      ? sourceDuration
      : sourceOut;
  // Position math must survive degenerate ranges (zero-width track math).
  const span = Number.isFinite(duration) && duration >= MIN_EXCERPT ? duration : MIN_EXCERPT;

  const [draftIn, setDraftIn] = useState(sourceIn);
  const [draftOut, setDraftOut] = useState(sourceOut);
  // Ref-backed drafts mirror the state so pointerup in the same batch as the
  // last pointermove still reads the final position.
  const draftInRef = useRef(sourceIn);
  const draftOutRef = useRef(sourceOut);
  const activeRef = useRef<"in" | "out" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const setIn = (value: number) => {
    draftInRef.current = value;
    setDraftIn(value);
  };
  const setOut = (value: number) => {
    draftOutRef.current = value;
    setDraftOut(value);
  };

  useEffect(() => {
    activeRef.current = null;
    onDraggingChange?.(false);
    draftInRef.current = sourceIn;
    draftOutRef.current = sourceOut;
    setDraftIn(sourceIn);
    setDraftOut(sourceOut);
    // Reset any in-flight drag when the bound clip/range changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIn, sourceOut, duration]);

  const handlePointerDown = (marker: "in" | "out", event: React.PointerEvent) => {
    event.preventDefault();
    activeRef.current = marker;
    onDraggingChange?.(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek?.(marker === "in" ? draftInRef.current : draftOutRef.current);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const active = activeRef.current;
    const track = trackRef.current;
    if (!active || !track) return;

    const rect = track.getBoundingClientRect();
    if (!(rect.width > 0) || !Number.isFinite(rect.width)) return;
    const pos = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = pos * span;
    if (!Number.isFinite(time)) return;

    if (active === "in") {
      const val = Math.min(time, draftOutRef.current - MIN_EXCERPT);
      if (!Number.isFinite(val)) return;
      setIn(val);
      onSeek?.(val);
    } else {
      const val = Math.max(time, draftInRef.current + MIN_EXCERPT);
      if (!Number.isFinite(val)) return;
      setOut(val);
      onSeek?.(val);
    }
  };

  const revert = () => {
    activeRef.current = null;
    onDraggingChange?.(false);
    draftInRef.current = sourceIn;
    draftOutRef.current = sourceOut;
    setDraftIn(sourceIn);
    setDraftOut(sourceOut);
  };

  const commit = () => {
    if (!activeRef.current) return;
    const next = { sourceIn: draftInRef.current, sourceOut: draftOutRef.current };
    if (!isValidRange(next.sourceIn, next.sourceOut, duration)) {
      // Never commit invalid math; revert to the last stored range.
      revert();
      return;
    }
    activeRef.current = null;
    onDraggingChange?.(false);
    // A plain marker click must not add an undo state or alter the range.
    const changed =
      Math.abs(next.sourceIn - sourceIn) > COMMIT_EPSILON ||
      Math.abs(next.sourceOut - sourceOut) > COMMIT_EPSILON;
    if (changed) onApply(next.sourceIn, next.sourceOut);
  };

  const handleKeyDown = (marker: "in" | "out", event: React.KeyboardEvent) => {
    let next = marker === "in" ? draftInRef.current : draftOutRef.current;
    const step = event.shiftKey ? 1 : 0.05;

    if (event.key === "ArrowLeft") next -= step;
    else if (event.key === "ArrowRight") next += step;
    else if (event.key === "Home") next = marker === "in" ? 0 : draftInRef.current + MIN_EXCERPT;
    else if (event.key === "End") next = marker === "out" ? span : draftOutRef.current - MIN_EXCERPT;
    else return;

    event.preventDefault();
    if (!Number.isFinite(next)) return;
    if (marker === "in") {
      const val = Math.max(0, Math.min(next, draftOutRef.current - MIN_EXCERPT));
      if (!isValidRange(val, draftOutRef.current, duration)) return;
      setIn(val);
      onApply(val, draftOutRef.current);
    } else {
      const val = Math.max(draftInRef.current + MIN_EXCERPT, Math.min(next, span));
      if (!isValidRange(draftInRef.current, val, duration)) return;
      setOut(val);
      onApply(draftInRef.current, val);
    }
  };

  const inPos = Math.max(0, Math.min(100, (draftIn / span) * 100));
  const outPos = Math.max(0, Math.min(100, (draftOut / span) * 100));

  return (
    <div className="border-t border-zinc-800/60 bg-zinc-900/40 px-3.5 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[9px] font-mono text-zinc-400">
        <span>In {draftIn.toFixed(2)}s</span>
        <span>Out {draftOut.toFixed(2)}s</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-6 w-full touch-none rounded border border-zinc-800/40 bg-zinc-950 select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={commit}
        onPointerCancel={revert}
        onLostPointerCapture={revert}
      >
        <div
          className="absolute top-0 bottom-0 border-x border-primary/40 bg-primary/25"
          style={{ left: `${inPos}%`, width: `${Math.max(0, outPos - inPos)}%` }}
        />

        {/* In Marker */}
        <div
          role="slider"
          aria-label="Source In"
          aria-valuemin={0}
          aria-valuemax={draftOut - MIN_EXCERPT}
          aria-valuenow={draftIn}
          tabIndex={0}
          className={cn(
            "group absolute top-0 bottom-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center outline-none",
            activeRef.current === "in" && "z-20",
          )}
          style={{ left: `${inPos}%` }}
          onPointerDown={(e) => handlePointerDown("in", e)}
          onKeyDown={(e) => handleKeyDown("in", e)}
        >
          <div
            className={cn(
              "h-4 w-1 bg-zinc-400 transition-colors group-hover:bg-primary group-focus:bg-primary",
              activeRef.current === "in" && "w-1.5 bg-white",
            )}
          />
        </div>

        {/* Out Marker */}
        <div
          role="slider"
          aria-label="Source Out"
          aria-valuemin={draftIn + MIN_EXCERPT}
          aria-valuemax={span}
          aria-valuenow={draftOut}
          tabIndex={0}
          className={cn(
            "group absolute top-0 bottom-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center outline-none",
            activeRef.current === "out" && "z-20",
          )}
          style={{ left: `${outPos}%` }}
          onPointerDown={(e) => handlePointerDown("out", e)}
          onKeyDown={(e) => handleKeyDown("out", e)}
        >
          <div
            className={cn(
              "h-4 w-1 bg-zinc-400 transition-colors group-hover:bg-primary group-focus:bg-primary",
              activeRef.current === "out" && "w-1.5 bg-white",
            )}
          />
        </div>
      </div>
    </div>
  );
}
