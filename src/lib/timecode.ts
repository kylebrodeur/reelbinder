/**
 * Formats a time in seconds as M:SS.s (e.g. 0:04.3, 1:23.0).
 * Used by the timeline transport bar and coverage grid.
 */
export function formatTimecode(sec: number): string {
  const tenths = Math.round(Math.max(0, sec) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
}
