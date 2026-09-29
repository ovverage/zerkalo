import type { Vec3 } from './geometry';
export type CameraRotation = 0 | 90 | -90;

/** Undo a clockwise canvas rotation; z is normalized by input image width. */
export function restoreScreen(p: Vec3, rotation: CameraRotation, aspect: number): Vec3 {
  if (rotation === 90) return { x: p.y, y: 1 - p.x, z: p.z / aspect };
  if (rotation === -90) return { x: 1 - p.y, y: p.x, z: p.z / aspect };
  return { x: p.x, y: p.y, z: p.z };
}
export function restoreWorld(p: Vec3, rotation: CameraRotation): Vec3 {
  if (rotation === 90) return { x: p.y, y: -p.x, z: p.z };
  if (rotation === -90) return { x: -p.y, y: p.x, z: p.z };
  return { x: p.x, y: p.y, z: p.z };
}
