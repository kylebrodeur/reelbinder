const supportedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/**
 * Optional public walkthrough. Leave VITE_REELBINDER_DEMO_URL unset until a
 * public YouTube URL is approved; callers render no link when it is absent or
 * unsuitable for the public site.
 */
export function getPublicDemoUrl(value = import.meta.env.VITE_REELBINDER_DEMO_URL): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && supportedHosts.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}
