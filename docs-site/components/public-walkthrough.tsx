import { Card } from "@umami/shiso/components";

const supportedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function getPublicDemoUrl(value = import.meta.env.VITE_REELBINDER_DEMO_URL): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && supportedHosts.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** Leave VITE_REELBINDER_DEMO_URL unset until a public YouTube URL is approved. */
export function PublicWalkthrough() {
  const url = getPublicDemoUrl();
  if (!url) return null;

  return (
    <Card title="Watch the walkthrough" icon="play" href={url}>
      Open the current public ReelBinder walkthrough.
    </Card>
  );
}
