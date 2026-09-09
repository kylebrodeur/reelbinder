import type { Project } from "./types";

export const RETIRED_DEMO_MEDIA: Readonly<Record<string, string>> = {};

export interface RetiredDemoMedia {
  originalUrl: string;
  sha256: string;
  path: string;
  reason: "Owner excluded historical demo media from the public version";
}

export type ProjectWithMediaRetirements = Project & { retiredDemoMedia?: RetiredDemoMedia[] };

export function retiredDemoMediaHash(_url: unknown): string | null {
  return null;
}

export function retirePreHackathonDemoMedia(project: Project): ProjectWithMediaRetirements {
  return project;
}
