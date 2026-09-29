/** Exercise-aware observation quality. A profile needs one complete side,
 * not a collection of unrelated visible joints from both sides. */
import type { Body, LandmarkName } from './landmarks';
import { sp, vis, wp } from './landmarks';

export type TrackingMode = 'all' | 'either-side';
export const MIN_CONFIDENCE = 0.45;

export function pointConfidence(body: Body, name: LandmarkName): number {
  const p = sp(body, name);
  const w = wp(body, name);
  if (![p.x, p.y, p.z, w.x, w.y, w.z].every(Number.isFinite)) return 0;
  // Near the border is fine. An inferred joint outside the camera is not an observation.
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return 0;
  const v = vis(body, name);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export function chainConfidence(body: Body, names: readonly LandmarkName[]): number {
  return names.length ? Math.min(...names.map((n) => pointConfidence(body, n))) : 0;
}

export function observe(
  body: Body,
  required: readonly LandmarkName[],
  mode: TrackingMode = 'all',
): { ok: boolean; confidence: number; missing: LandmarkName[] } {
  const chains = mode === 'either-side'
    ? ['left_', 'right_'].map((prefix) => required.filter((n) =>
        n.startsWith(prefix) || (!n.startsWith('left_') && !n.startsWith('right_'))))
    : [required];
  const best = [...chains].sort((a, b) => chainConfidence(body, b) - chainConfidence(body, a))[0] ?? [];
  const confidence = chainConfidence(body, best);
  return {
    ok: confidence >= MIN_CONFIDENCE,
    confidence,
    missing: best.filter((n) => pointConfidence(body, n) < MIN_CONFIDENCE),
  };
}

/** Ignore the occluded side instead of averaging it into the measured angle. */
export function combineSides(left: number, right: number, lc: number, rc: number): number {
  const lw = lc >= MIN_CONFIDENCE ? lc * lc : 0;
  const rw = rc >= MIN_CONFIDENCE ? rc * rc : 0;
  if (lw + rw === 0) return lc >= rc ? left : right;
  return (left * lw + right * rw) / (lw + rw);
}
