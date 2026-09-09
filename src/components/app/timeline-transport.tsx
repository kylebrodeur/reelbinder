import {
  ArrowLeft,
  ArrowRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimecode } from "@/lib/timecode";

export interface TimelineTransportProps {
  /** Total duration in seconds */
  duration: number;
  /** Current playhead time in seconds */
  time: number;
  playing: boolean;
  muted?: boolean;
  /** Zoom percentage 50–250 */
  zoom: number;
  /** When true, disables playback controls (navigation-only mode) */
  navigationOnly?: boolean;
  mediaError?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek: (t: number) => void;
  onPrevClip: () => void;
  onNextClip: () => void;
  onZoom: (z: number) => void;
  onToggleMute?: () => void;
  /** Optional camera movement & setup controls */
  cameraControls?: React.ReactNode;
  rehearsal?: boolean;
}

export function TimelineTransport({
  duration,
  time,
  playing,
  muted = false,
  zoom,
  navigationOnly = false,
  mediaError,
  onPlay,
  onPause,
  onSeek,
  onPrevClip,
  onNextClip,
  onZoom,
  onToggleMute,
  cameraControls,
  rehearsal = false,
}: TimelineTransportProps) {
  const disabled = !duration;

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 py-1.5"
      role="group"
      aria-label="Timeline transport"
    >
      {/* Skip to start */}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Go to start"
        disabled={disabled}
        onClick={() => onSeek(0)}
      >
        <SkipBack />
      </Button>

      {/* Previous clip */}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous clip"
        disabled={disabled || time <= 0}
        onClick={onPrevClip}
      >
        <ArrowLeft />
      </Button>

      {/* Play / Pause */}
      {(!navigationOnly || rehearsal) && onPlay && onPause && (
        <Button
          size="sm"
          variant={playing ? "default" : "secondary"}
          disabled={disabled || Boolean(mediaError)}
          onClick={playing ? onPause : onPlay}
        >
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : rehearsal ? "Play Move" : "Play"}
        </Button>
      )}

      {/* Mute toggle */}
      {!navigationOnly && onToggleMute && (
        <Button
          size="sm"
          variant="ghost"
          className="px-2"
          aria-label={muted ? "Unmute preview" : "Mute preview"}
          aria-pressed={!muted}
          title={muted ? "Unmute preview" : "Mute preview"}
          onClick={onToggleMute}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
      )}

      {/* Next clip */}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next clip"
        disabled={disabled || time >= duration}
        onClick={onNextClip}
      >
        <ArrowRight />
      </Button>

      {/* Skip to end */}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Go to end"
        disabled={disabled}
        onClick={() => onSeek(duration)}
      >
        <SkipForward />
      </Button>

      {/* Timecode */}
      <span
        className="px-2 font-mono text-xs tabular-nums"
        aria-label="Playback time"
      >
        {formatTimecode(time)} / {formatTimecode(duration)}
      </span>

      {/* Camera movement & rehearsal controls */}
      {cameraControls}

      {/* Zoom slider */}
      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <ZoomIn className="size-3.5" />
        Zoom
        <input
          aria-label="Timeline zoom"
          type="range"
          min={50}
          max={250}
          step={10}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          className="w-24 accent-foreground"
        />
        <span className="w-8 font-mono">{zoom}%</span>
      </label>
    </div>
  );
}

/** Playhead scrubber row — placed below the transport bar */
export function TimelinePlayhead({
  duration,
  time,
  onSeek,
  uncoveredBeats,
}: {
  duration: number;
  time: number;
  onSeek: (t: number) => void;
  uncoveredBeats?: number;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <label htmlFor="shared-playhead" className="text-xs text-muted-foreground">
        Playhead
      </label>
      <input
        id="shared-playhead"
        aria-label="Cut playhead"
        type="range"
        min={0}
        max={duration || 1}
        step={1 / 24}
        value={Math.min(time, duration)}
        disabled={!duration}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-foreground"
      />
      {uncoveredBeats ? (
        <span className="text-xs text-muted-foreground">{uncoveredBeats} uncovered beats</span>
      ) : null}
    </div>
  );
}
