export type FrameImageIntent = "storyboard" | "photoreal" | "restyle" | "continue";
export type ImagePurpose = "storyboard" | "photoreal";

export function withFrameImagePurpose<T extends Record<string, unknown>>(
  intent: FrameImageIntent,
  input: T,
): T & { purpose: ImagePurpose } {
  return { ...input, purpose: intent === "storyboard" ? "storyboard" : "photoreal" };
}
