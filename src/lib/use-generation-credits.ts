import { useEffect, useState } from "react";
import { getCinemaJobUsage, type GenerationCredits } from "./cinema-client";

/**
 * Fetch the current visitor's generation-credit usage once per `refreshKey` change.
 * `undefined` = not loaded yet; `null` = no generation identity (or unavailable);
 * object = per-type `{used, limit, remaining}` credits.
 */
export function useGenerationCredits(
  refreshKey: string | undefined,
): GenerationCredits | null | undefined {
  const [credits, setCredits] = useState<GenerationCredits | null | undefined>(undefined);
  useEffect(() => {
    if (!refreshKey) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    setCredits(undefined);
    getCinemaJobUsage()
      .then((usage) => {
        if (!cancelled) setCredits(usage.generationCredits);
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return credits;
}
