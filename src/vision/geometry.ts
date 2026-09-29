/**
 * Векторная геометрия для анализа позы.
 *
 * Все измерения строятся в собственной системе координат тела (см. BodyFrame),
 * а не в координатах кадра. Благодаря этому пороги не зависят от расстояния до
 * камеры, её наклона и роста человека.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l < 1e-9 ? vec(0, 0, 0) : scale(a, 1 / l);
}

/** Угол ABC в градусах — угол в вершине B между лучами BA и BC. */
export function angleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = normalize(sub(a, b));
  const bc = normalize(sub(c, b));
  return (Math.acos(clamp(dot(ba, bc), -1, 1)) * 180) / Math.PI;
}

/** Угол между двумя направлениями в градусах (0..180). */
export function angleBetween(a: Vec3, b: Vec3): number {
  return (Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1)) * 180) / Math.PI;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Линейная интерполяция из [inLo, inHi] в [0, 1] с отсечением по краям. */
export function mapRange(v: number, inLo: number, inHi: number, outLo = 0, outHi = 1): number {
  if (Math.abs(inHi - inLo) < 1e-9) return outLo;
  const t = clamp((v - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Сглаженная интерполяция — мягче на границах, чем mapRange. */
export function smoothstep(v: number, lo: number, hi: number): number {
  const t = mapRange(v, lo, hi);
  return t * t * (3 - 2 * t);
}

export const toDeg = (rad: number): number => (rad * 180) / Math.PI;
export const round1 = (v: number): number => Math.round(v * 10) / 10;
