const APPROVED_DEMO = {
  // Approved by Kyle Brodeur on 2026-10-08: the final product + film demonstration.
  url: "https://youtu.be/US3bRz8r0yc",
  title: "ReelBinder — final demonstration: the product workflow and The Bounty Hunter",
};

const supportedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function parseApprovedVideo(value: string): { id: string; canonical: string } | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !supportedHosts.has(url.hostname)) return null;
    const id = url.hostname === "youtu.be" || url.hostname === "www.youtu.be"
      ? url.pathname.slice(1)
      : url.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { id, canonical: url.href } : null;
  } catch {
    return null;
  }
}

/** The approved final demonstration (product walkthrough and the finished film), embedded from YouTube's no-cookie host. */
export function PublicWalkthrough({
  approved = APPROVED_DEMO.url,
  title = APPROVED_DEMO.title,
}: {
  approved?: string;
  title?: string;
}) {
  const video = parseApprovedVideo(approved);
  if (!video) return null;

  return (
    <figure className="my-6">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
        <iframe
          className="absolute inset-0 size-full"
          src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
        <span>
          The final demonstration: the product workflow, then the finished{" "}
          <em>The Bounty Hunter</em> locked final cut.
        </span>
        <a className="underline underline-offset-2" href={video.canonical} rel="noreferrer">
          Watch on YouTube
        </a>
      </figcaption>
    </figure>
  );
}
