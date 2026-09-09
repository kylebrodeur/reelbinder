import type { BinderAsset, Project, Shot } from "./types";

/** Original production storyboard page that best matches a setup. */
const SETUP_PAGE: Record<string, number> = {
  "1A": 1,
  "1E": 2,
  "1EE": 2,
  "1F": 2,
  "1H": 2,
  "1J": 3,
  "1K": 3,
  "1L": 3,
  "1M": 3,
  "1N": 4,
  "1NN": 4,
  "1P": 4,
  "1Q": 5,
  "1R": 5,
  "1U": 5,
};

export function originalBoards(project: Project): BinderAsset[] {
  return project.binder.filter((a) => a.tab === "boards" && a.url?.includes("storyboard"));
}

export function originalDiagrams(project: Project): BinderAsset[] {
  return project.binder.filter((a) => a.tab === "diagrams" && a.url && !a.url.includes("/boards/"));
}

export function originalBoardFor(project: Project, shot: Shot | null): BinderAsset | undefined {
  const boards = originalBoards(project);
  if (!boards.length) return undefined;
  const setup = (shot?.setup ?? "").toUpperCase();
  if (setup) {
    const hit = boards.find((a) => new RegExp(`\\b${setup}\\b`, "i").test(`${a.title} ${a.caption ?? ""}`));
    if (hit) return hit;
    const page = SETUP_PAGE[setup];
    if (page) {
      const byPage = boards.find((a) => a.url?.includes(`storyboard-${page}`));
      if (byPage) return byPage;
    }
  }
  return boards[0];
}

export function originalOverheadFor(project: Project): BinderAsset | undefined {
  return (
    project.binder.find((a) => a.url?.includes("saloon-overhead")) ??
    originalDiagrams(project)[0]
  );
}
