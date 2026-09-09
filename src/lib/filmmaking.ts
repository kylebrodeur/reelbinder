import type { CameraAngle, CameraMovement, ScreenDirection, TimeOfDay } from "./types";

export const CAMERA_META: Record<
  CameraAngle,
  { label: string; rule: string; prompt: string }
> = {
  "extreme-wide": {
    label: "Extreme wide",
    rule: "Establish geography before you cut in. One read of the space.",
    prompt: "extreme wide establishing shot, vast environment, small subject in frame",
  },
  wide: {
    label: "Wide",
    rule: "Hold the full body and the room. Best first shot of a new location.",
    prompt: "wide shot, full environment visible, subject complete in frame",
  },
  full: {
    label: "Full",
    rule: "Head to toe. Use for action and blocking, not emotion.",
    prompt: "full shot, subject head to toe, clear staging",
  },
  medium: {
    label: "Medium",
    rule: "Waist up. Default coverage. Keep eyeline consistent with the previous shot.",
    prompt: "medium shot, waist up, conversational framing",
  },
  "close-up": {
    label: "Close-up",
    rule: "Face or object only. One idea. Do not crowd the frame with extra characters.",
    prompt: "close-up, face fills the frame, shallow depth of field",
  },
  "extreme-close-up": {
    label: "ECU",
    rule: "A single detail. Hands, eyes, a screen. Cutaway glue for continuity.",
    prompt: "extreme close-up insert, single detail, tactile",
  },
  "low-angle": {
    label: "Low angle",
    rule: "Camera below eyeline. Power, threat, or scale. Match the next shot's height or the jump reads as a mistake.",
    prompt: "low angle shot, camera below subject, heroic or imposing",
  },
  "high-angle": {
    label: "High angle",
    rule: "Camera above eyeline. Vulnerability or overview. Don't pair with a reverse low angle across the 180.",
    prompt: "high angle shot, camera looking down, subject diminished",
  },
  "birds-eye": {
    label: "Bird's eye",
    rule: "Straight down. Graphic, not emotional. Use as a punctuation beat.",
    prompt: "bird's eye view, camera directly overhead, graphic composition",
  },
  dutch: {
    label: "Dutch",
    rule: "Tilted horizon. Unease. One shot, then reset — stacked dutch angles look accidental.",
    prompt: "dutch angle, tilted horizon, uneasy composition",
  },
  pov: {
    label: "POV",
    rule: "We are the character. Hands or a windshield in frame sell it.",
    prompt: "point of view shot, first-person, character's eyeline",
  },
  "over-the-shoulder": {
    label: "OTS",
    rule: "Keep the shoulder on the same side of frame as the previous OTS or you jump the line.",
    prompt: "over the shoulder shot, foreground shoulder softly out of focus",
  },
  insert: {
    label: "Insert",
    rule: "Prop or screen. The cheapest continuity save in AI video.",
    prompt: "insert shot of a specific object, product cinematography, sharp detail",
  },
};

export const PERSPECTIVE_ANGLES: { value: CameraAngle | "neutral"; label: string }[] = [
  { value: "neutral", label: "Neutral / Eye-level" },
  { value: "high-angle", label: "High angle" },
  { value: "low-angle", label: "Low angle" },
  { value: "birds-eye", label: "Bird's eye / Overhead" },
  { value: "dutch", label: "Dutch angle" },
  { value: "pov", label: "POV" },
  { value: "over-the-shoulder", label: "Over the shoulder" },
];

export function perspectiveAngleFromCamera(camera: CameraAngle): CameraAngle | "neutral" {
  if (
    camera === "high-angle" ||
    camera === "low-angle" ||
    camera === "birds-eye" ||
    camera === "dutch" ||
    camera === "pov" ||
    camera === "over-the-shoulder"
  ) {
    return camera;
  }
  return "neutral";
}

export const MOVEMENT_META: Record<CameraMovement, { label: string; prompt: string }> = {
  static: { label: "Static / locked off", prompt: "locked-off camera, no movement" },
  "pan-left": { label: "Pan left", prompt: "slow pan left" },
  "pan-right": { label: "Pan right", prompt: "slow pan right" },
  "tilt-up": { label: "Tilt up", prompt: "tilt up" },
  "tilt-down": { label: "Tilt down", prompt: "tilt down" },
  "dolly-in": { label: "Dolly in", prompt: "smooth dolly in, push toward subject" },
  "dolly-out": { label: "Dolly out", prompt: "smooth dolly out, pull away" },
  tracking: { label: "Tracking / follow", prompt: "tracking shot, camera follows subject, consistent speed" },
  handheld: { label: "Handheld", prompt: "subtle handheld, documentary feel, not shaky-cam" },
  crane: { label: "Crane / jib", prompt: "crane movement, rising reveal" },
  orbit: { label: "Orbit", prompt: "slow orbit around subject" },
};

export const DIRECTION_META: Record<ScreenDirection, { label: string; prompt: string }> = {
  "L-R": { label: "Left → right", prompt: "subject travels screen-left to screen-right" },
  "R-L": { label: "Right → left", prompt: "subject travels screen-right to screen-left" },
  toward: { label: "Toward camera", prompt: "subject moves toward camera" },
  away: { label: "Away from camera", prompt: "subject moves away from camera" },
  static: { label: "No travel", prompt: "subject holds position" },
};

export const TIME_META: Record<TimeOfDay, { label: string; prompt: string }> = {
  dawn: { label: "Dawn", prompt: "dawn, cool blue and first amber, long shadows" },
  day: { label: "Day", prompt: "daylight, clean natural light" },
  "golden-hour": { label: "Golden hour", prompt: "golden hour, warm low sun, long shadows" },
  dusk: { label: "Dusk", prompt: "dusk, blue hour, practical lights coming on" },
  night: { label: "Night exterior", prompt: "night exterior, motivated practicals, wet asphalt reflections" },
  "interior-day": { label: "Interior day", prompt: "interior daylight, window key, soft fill" },
  "interior-night": { label: "Interior night", prompt: "interior night, warm practical lamps, dark falloff" },
};

export const STYLE_PRESETS = [
  {
    id: "cinematic",
    label: "Cinematic",
    prompt:
      "cinematic anamorphic look, shallow depth of field, filmic color, 35mm, no subtitles",
  },
  {
    id: "vlog",
    label: "Vlog / talking head",
    prompt:
      "natural vlog, eye-level, soft key light, authentic, YouTube talking-head, no subtitles",
  },
  {
    id: "product",
    label: "Product / B2B",
    prompt:
      "premium product film, clean lighting, slow camera, restrained grade, commercial, no logos unless specified, no subtitles",
  },
  {
    id: "doc",
    label: "Documentary",
    prompt: "observational documentary, available light, naturalistic, no subtitles",
  },
  {
    id: "music",
    label: "Music video",
    prompt: "music-video pacing, stylized lighting, rhythmic cuts implied, no lyrics on screen",
  },
] as const;

export function cameraPrompt(angle: CameraAngle, movement: CameraMovement): string {
  return `${CAMERA_META[angle].prompt}, ${MOVEMENT_META[movement].prompt}`;
}
