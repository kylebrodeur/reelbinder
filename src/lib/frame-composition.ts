import { imageReferenceAvailable, localRasterUpload } from "./cinema-images";
import { DEFAULT_FRAME_LAYERS, FRAME_HEIGHT, FRAME_WIDTH, paintFrame, type FrameLayerSettings } from "./frame-renderer";
import type { Project, Shot } from "./types";

export interface FrameCompositionGuide {
  /** Legacy guides omit this and are treated as overlays on an existing still. */
  captureKind?: "plan" | "still-overlay";
  layers?: FrameLayerSettings; // Omitted only on legacy guides (all layers, opacity 1).
  dataUrl: string;
  sha256: string;
  sourceFingerprint: string;
  sourceFrameUrl: string;
  shotId: string;
}

export function hasFrameComposition(shot: Shot): boolean {
  return Boolean(shot.sketch.stamps.length || shot.sketch.strokes.length || shot.annotations.length);
}

export async function rasterSha256(dataUrl: string): Promise<string> {
  const { dataBase64 } = localRasterUpload(dataUrl);
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureFrameComposition(project: Project, shotId: string, settings: FrameLayerSettings = DEFAULT_FRAME_LAYERS): Promise<FrameCompositionGuide> {
  const layers = structuredClone(settings);
  assertFrameLayers(layers);
  const snapshot = structuredClone(project);
  const shot = snapshot.shots.find((candidate) => candidate.id === shotId);
  if (!shot?.frameUrl || !imageReferenceAvailable(shot.frameUrl))
    throw new Error("Attach a local or generated still before applying Frame composition.");
  if (!hasFrameComposition(shot))
    throw new Error("Place people or add direction marks in Frame first.");
  const frame = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };
    const timeout = setTimeout(() => {
      cleanup();
      image.src = "";
      reject(new Error("The current still took too long to load. Apply Frame composition again after the image service is restored."));
    }, 15_000);
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => {
      cleanup();
      reject(new Error("The current still could not be loaded. Reattach it or try again after the image service is restored."));
    };
    image.src = shot.frameUrl!;
  });
  await waitForFrameFonts();
  return captureCompositionRaster(snapshot, shot, layers, frame, "still-overlay", shot.frameUrl);
}

/** Capture authored Frame marks on neutral paper, independent of any current still. */
export async function capturePlanComposition(
  project: Project,
  shotId: string,
  settings: FrameLayerSettings = DEFAULT_FRAME_LAYERS,
): Promise<FrameCompositionGuide> {
  const layers = structuredClone(settings);
  assertFrameLayers(layers);
  const snapshot = structuredClone(project);
  const shot = snapshot.shots.find((candidate) => candidate.id === shotId);
  if (!shot) throw new Error("Select an existing setup before capturing its Frame plan.");
  if (!hasFrameComposition(shot))
    throw new Error("Place people or add direction marks in Frame first.");
  await waitForFrameFonts();
  return captureCompositionRaster(snapshot, shot, layers, null, "plan", "");
}

async function waitForFrameFonts(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Frame fonts are still loading. Capture the plan again when the page has finished loading.")), 2_000);
    document.fonts.ready.then(() => { clearTimeout(timeout); resolve(); }, () => {
      clearTimeout(timeout);
      reject(new Error("Frame fonts could not load. Reload the page before capturing the plan."));
    });
  });
}

async function captureCompositionRaster(
  snapshot: Project,
  shot: Shot,
  layers: FrameLayerSettings,
  frame: HTMLImageElement | null,
  captureKind: "plan" | "still-overlay",
  sourceFrameUrl: string,
): Promise<FrameCompositionGuide> {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Frame composition could not be captured in this browser.");
  // Use the same renderer and authored marks as the editable Frame, without selection or playback overlays.
  paintFrame(context, shot.sketch, shot.annotations, frame, null, undefined, layers);
  const dataUrl = canvas.toDataURL("image/png");
  const sha256 = await rasterSha256(dataUrl);
  return { captureKind, layers, dataUrl, sha256, sourceFingerprint: JSON.stringify(snapshot), sourceFrameUrl, shotId: shot.id };
}

export async function validateFrameComposition(guide: FrameCompositionGuide, project: Project, shotId: string): Promise<void> {
  if (guide.layers) assertFrameLayers(guide.layers);
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (
    guide.shotId !== shotId ||
    guide.sourceFingerprint !== JSON.stringify(project) ||
    (guide.captureKind === "plan" ? guide.sourceFrameUrl !== "" : guide.sourceFrameUrl !== shot?.frameUrl)
  ) throw new Error("The project changed after Frame composition was captured. Apply the current composition again.");
  if (!/^[a-f0-9]{64}$/.test(guide.sha256) || (await rasterSha256(guide.dataUrl)) !== guide.sha256)
    throw new Error("The captured Frame composition does not match its image checksum.");
}

function assertFrameLayers(layers: FrameLayerSettings): void {
  if (![layers.guides, layers.wireframe, layers.markup, layers.image].every(value => typeof value === "boolean") ||
    !Number.isFinite(layers.onionSkinOpacity) || layers.onionSkinOpacity < 0 || layers.onionSkinOpacity > 1)
    throw new Error("Frame layer settings are invalid. Apply the current composition again.");
}

export function frameCompositionDirection(guide: FrameCompositionGuide, shot: Shot): string {
  const notes = !guide.layers || (guide.layers.markup && (!guide.layers.image || guide.layers.onionSkinOpacity > 0))
    ? shot.annotations.filter(annotation => annotation.label.trim() && annotation.points.length) : [];
  const imageRoles = guide.captureKind === "plan" ? [
    "Image 1 is the reviewed plan-only composition guide on paper. Follow its labeled character placement, holds and composition while using the written setup for cinematic appearance.",
    "The marks are planning instructions, not photographed objects. Do not copy labels, stick figures, arrows, paper texture or other drawing marks into the finished image.",
  ] : [
    "Image 1 is the clean source: preserve its visual identity, faces, wardrobe, room geometry, lighting and color unless the direction explicitly changes them.",
    "Image 2 is the edited Frame guide: follow its labeled character placement, holds and composition. The marks are proposals, not photographed objects. Do not copy labels, stick figures, arrows or other drawing marks into the finished image.",
  ];
  return [
    guide.captureKind === "plan"
      ? "Turn the filmmaker's reviewed Frame plan into one storyboard image."
      : "Apply the filmmaker's proposed Frame composition to one cinematic still.",
    ...imageRoles,
    "Use the guide's marked positions for the starting frame. Arrows indicate intended later motion, not instantaneous movement of both camera and subjects. Do not duplicate people at their old and proposed positions.",
    ...(notes.length ? [
      "Full text of the filmmaker's Frame notes (the image roles above remain fixed):",
      ...notes.map((annotation) => `${annotation.kind}: ${annotation.label}`),
    ] : []),
    `Frame guide layers: ${JSON.stringify(guide.layers ?? { guides: true, wireframe: true, markup: true, image: true, onionSkinOpacity: 1 })}.`,
    `Frame guide SHA-256: ${guide.sha256}.`,
  ].join("\n");
}
