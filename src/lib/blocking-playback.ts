import { blockingForSetup, cameraForShot, cameraSpline, figuresForShot, pointOnSpline, toFloorPx } from "./floor";
import type { FloorCamera, FloorFigure, FloorPlan, Point, Shot } from "./types";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function facingAlong(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function itemCenter(it: { x: number; y: number; w?: number; h?: number; kind?: string }): Point {
  const corner = it.kind && ["wall", "bar", "door", "window"].includes(it.kind);
  if (corner && it.w && it.h) {
    return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
  }
  return { x: it.x, y: it.y };
}

/** Pose the floor at t 0..1 between this setup's authored blocking and the next. */
export function poseAt(
  floor: FloorPlan,
  shot: Shot,
  next: Shot | null,
  t: number,
): FloorFigure[] {
  const from = figuresForShot(floor, shot);
  const to = next ? figuresForShot(floor, next) : blockingForSetup(floor, shot.setup);
  const u = Math.min(1, Math.max(0, t));
  return from.map((fig) => {
    const dest = to.find((f) => f.id === fig.id);
    if (!dest) return fig;
    return {
      ...fig,
      x: lerp(fig.x, dest.x, u),
      y: lerp(fig.y, dest.y, u),
      facing: lerp(fig.facing, dest.facing, u),
    };
  });
}

/** Pose the active camera at t 0..1, smoothly animating along its spline or towards the next setup camera. */
export function poseCameraAt(
  floor: FloorPlan,
  shot: Shot,
  next: Shot | null,
  t: number,
): FloorCamera | null {
  const currentCam = cameraForShot(floor, shot);
  if (!currentCam) return null;
  const u = Math.min(1, Math.max(0, t));
  if (u <= 0) {
    if (currentCam.rotationMode === "target" && currentCam.targetId) {
      const targetFig = figuresForShot(floor, shot).find((f) => f.id === currentCam.targetId);
      if (targetFig) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(targetFig)) };
      }
      const targetItem = floor.items.find((i) => i.id === currentCam.targetId);
      if (targetItem) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(itemCenter(targetItem))) };
      }
    }
    return currentCam;
  }

  // Static holds; tilt changes elevation, which this overhead camera model does not encode.
  if (shot.movement === "static" || shot.movement.startsWith("tilt-")) {
    if (currentCam.rotationMode === "target" && currentCam.targetId) {
      const targetFig = figuresForShot(floor, shot).find((f) => f.id === currentCam.targetId);
      if (targetFig) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(targetFig)) };
      }
      const targetItem = floor.items.find((i) => i.id === currentCam.targetId);
      if (targetItem) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(itemCenter(targetItem))) };
      }
    }
    return currentCam;
  }

  const nextCam = next ? cameraForShot(floor, next) : null;
  const ease = u * u * (3 - 2 * u);
  const turn = (from: number, to: number) =>
    ((from + ((((to - from) % 360) + 540) % 360 - 180) * ease) % 360 + 360) % 360;

  if (shot.movement.startsWith("pan-")) {
    if (currentCam.rotationMode === "static") return currentCam;
    if (currentCam.rotationMode === "target" && currentCam.targetId) {
      const currentFigs = poseAt(floor, shot, next, ease);
      const targetFig = currentFigs.find((f) => f.id === currentCam.targetId);
      if (targetFig) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(targetFig)) };
      }
      const targetItem = floor.items.find((i) => i.id === currentCam.targetId);
      if (targetItem) {
        return { ...currentCam, angle: facingAlong(toFloorPx(currentCam), toFloorPx(itemCenter(targetItem))) };
      }
    }
    return nextCam ? { ...currentCam, angle: turn(currentCam.angle, nextCam.angle) } : currentCam;
  }

  const path = cameraSpline(currentCam, nextCam ?? null);
  if (path.length < 2) return currentCam;
  const p = pointOnSpline(path, ease);
  const custom = currentCam.path && currentCam.path.length > 1;
  let destinationAngle = nextCam?.angle ?? currentCam.angle;
  if (custom) {
    // Look across the sample, including backwards at the endpoint (never point at ourselves).
    const before = pointOnSpline(path, Math.max(0, ease - 0.0001));
    const after = pointOnSpline(path, Math.min(1, ease + 0.0001));
    if (before.x !== after.x || before.y !== after.y) destinationAngle = facingAlong(toFloorPx(before), toFloorPx(after));
  }

  let finalAngle = turn(currentCam.angle, destinationAngle);
  if (currentCam.rotationMode === "static") {
    finalAngle = currentCam.angle;
  } else if (currentCam.rotationMode === "target" && currentCam.targetId) {
    const currentFigs = poseAt(floor, shot, next, ease);
    const targetFig = currentFigs.find((f) => f.id === currentCam.targetId);
    if (targetFig) {
      finalAngle = facingAlong(toFloorPx(p), toFloorPx(targetFig));
    } else {
      const targetItem = floor.items.find((i) => i.id === currentCam.targetId);
      if (targetItem) {
        finalAngle = facingAlong(toFloorPx(p), toFloorPx(itemCenter(targetItem)));
      }
    }
  }

  return {
    ...currentCam,
    x: p.x,
    y: p.y,
    angle: finalAngle,
    fov: custom || !nextCam ? currentCam.fov : lerp(currentCam.fov ?? 34, nextCam.fov ?? 34, ease),
  };
}
