import { pollVideo } from "./ai";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForVideo(
  requestId: string,
  onTick?: (status: string, progress: number | null) => void,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  for (let i = 0; i < 45; i++) {
    await sleep(i === 0 ? 2500 : 4000);
    const res = await pollVideo({ data: { requestId } });
    if (!res.ok) return res;
    onTick?.(res.status, res.progress);
    if ((res.status === "done" || res.status === "completed") && res.url) {
      return { ok: true, url: res.url };
    }
    if (res.status === "failed" || res.status === "expired" || res.status === "error") {
      return { ok: false, error: res.error || `Clip ${res.status}.` };
    }
  }
  return { ok: false, error: "Timed out waiting for Imagine. Try again on this shot." };
}
