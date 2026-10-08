import type { Project } from "./types";

/** Exact retired preload URLs. Original /refs/bh and all Google/user assets stay eligible. */
export const RETIRED_DEMO_MEDIA: Readonly<Record<string, string>> = {
  "/boards/bh-1a.jpg": "897a636bc54b6bbda06433eba99f44207c1f6173d64f33f24822ad04be9be2ce",
  "/boards/bh-1e.jpg": "73974645398742d8a3f1ea886afaed49a6d6bee7c0547f01d390064856164ca3",
  "/boards/bh-1ee.jpg": "96ec546e49710367f7ac0b7145079b3eca5fc4c10f0d63c1b5380f54f187051f",
  "/boards/bh-1f.jpg": "462b9e2613dc52b200ee36705ac0e899c9e24c68bcc73d22f442abe2c7ff38f1",
  "/boards/bh-1h.jpg": "34ec6e0a2c6579eaf447ec87773c323c060feb8e81f6ddb90c54768a47d86e30",
  "/boards/bh-1j.jpg": "036dc3cc2f86c0516bd6372c8fe5e74580b80fc96c1a7564f3e73db5e35add66",
  "/boards/bh-1k.jpg": "0eb9e0ff3401a9b0e3543743fa8f5fa798a7113c38b3aea95b979ed894b8cb55",
  "/boards/bh-1q.jpg": "41e9d57fc29c31552b8abdcb7aa0f6f6337bdda7ba673483759d107014da5eff",
  "/boards/bh-1r.jpg": "3c0321d309d3b47f02c5f8ac1e5d9ebd4e9286f84e38c3d232723e0091dcde17",
  "/boards/bh-1u.jpg": "3f2b0001e193e1740221f377c435fd35858f3b9aa57d3a81d05487e0b7bec119",
  "/boards/bh-room.jpg": "a77dd7d502cc17ec88b9b48d666963ef6d6f42fd8ded134ffc4e3c679ac9faf2",
  "/locks/rusty.jpg": "e985034caac233220eaf80b8320825d41d3c8b34199af63d798815a2c516bdf0",
};
export interface RetiredDemoMedia {
  originalUrl: string;
  sha256: string;
  path: string;
  reason: "Owner excluded historical demo media from the hackathon version";
}
export type ProjectWithMediaRetirements = Project & { retiredDemoMedia?: RetiredDemoMedia[] };
export function retiredDemoMediaHash(url: unknown): string | null {
  return typeof url === "string" && Object.hasOwn(RETIRED_DEMO_MEDIA, url) ? RETIRED_DEMO_MEDIA[url] : null;
}

/** Retire operative pointers only. Authored prose, provenance, records and current media survive. */
export function retirePreHackathonDemoMedia(project: Project): ProjectWithMediaRetirements {
  const removals: RetiredDemoMedia[] = [];
  const clean = <T extends object>(value: T, keys: string[], path: string, empty: null | "" | "omit" = null): T => {
    let next = value;
    for (const key of keys) {
      const url = (value as Record<string, unknown>)[key];
      const sha256 = retiredDemoMediaHash(url);
      if (!sha256) continue;
      removals.push({ originalUrl: url as string, sha256, path: `${path}.${key}`, reason: "Owner excluded historical demo media from the hackathon version" });
      next = { ...next };
      if (empty === "omit") delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = empty;
    }
    return next;
  };
  const mapChanged = <T>(values: T[], map: (value: T, index: number) => T): T[] => {
    const next = values.map(map); return next.some((value, index) => value !== values[index]) ? next : values;
  };
  const history = <T extends { id: string; url: string; asset?: { url: string } }>(values: T[] | undefined, path: string): T[] | undefined => values && mapChanged(values, (value) => {
    let next = clean(value, ["url"], `${path}[${value.id}]`, "");
    if (value.asset) { const asset = clean(value.asset, ["url"], `${path}[${value.id}].asset`, ""); if (asset !== value.asset) next = { ...next, asset }; }
    return next;
  });
  const world = clean(project.world, ["genesisUrl"], "world");
  const shots = mapChanged(project.shots, (shot) => {
    let next = clean(shot, ["frameUrl", "videoUrl"], `shots[${shot.id}]`);
    const frameHistory = history(shot.frameHistory, `shots[${shot.id}].frameHistory`);
    const videoHistory = history(shot.videoHistory, `shots[${shot.id}].videoHistory`);
    if (frameHistory !== shot.frameHistory || videoHistory !== shot.videoHistory) next = { ...next, ...(frameHistory ? { frameHistory } : {}), ...(videoHistory ? { videoHistory } : {}) };
    return next;
  });
  const binder = mapChanged(project.binder, (asset) => clean(asset, ["url"], `binder[${asset.id}]`));
  const clips = mapChanged(project.timeline.clips, (clip) => clean(clip, ["sourceFrameUrl", "sourceVideoUrl"], `timeline.clips[${clip.id}]`, "omit"));
  const musicAssets = project.musicAssets && mapChanged(project.musicAssets, (asset) => clean(asset, ["url"], `musicAssets[${asset.assetId}]`, ""));
  const base = clean(project, ["cutUrl"], "project");
  if (!removals.length) return project;
  const existing = (project as ProjectWithMediaRetirements).retiredDemoMedia ?? [];
  const keys = new Set(existing.map((item) => `${item.path}\n${item.originalUrl}`));
  const retiredDemoMedia = [...existing, ...removals.filter((item) => { const key = `${item.path}\n${item.originalUrl}`; if (keys.has(key)) return false; keys.add(key); return true; })];
  return { ...base, world, shots, binder, timeline: clips === project.timeline.clips ? project.timeline : { ...project.timeline, clips }, ...(musicAssets ? { musicAssets } : {}), retiredDemoMedia };
}
