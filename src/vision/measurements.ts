/** Measurements use reliable limb chains and preserve the camera aspect ratio. */
import type { Body, LandmarkName } from './landmarks';
import { sp, wp } from './landmarks';
import { angleDeg, dist, dot, len, scale, sub } from './geometry';
import type { Side } from '../engine/types';
import { chainConfidence, combineSides } from './tracking';
import { facingRatio } from './framing';

export const joint = (side: Side, part: string): LandmarkName => `${side}_${part}` as LandmarkName;
export const chain = (side: Side, parts: readonly string[]): LandmarkName[] => parts.map((p) => joint(side, p));
export const screenPoint = (b: Body, name: LandmarkName) => {
  const p = sp(b, name);
  return { x: p.x * (b.imageAspect ?? 1), y: p.y, z: 0 };
};

export function limbAngle(b: Body, side: Side, parts: readonly [string, string, string]): number {
  const names = parts.map((p) => joint(side, p)) as [LandmarkName, LandmarkName, LandmarkName];
  const [a, c, d] = names;
  const world = angleDeg(wp(b, a), wp(b, c), wp(b, d));
  const pa = screenPoint(b, a), pc = screenPoint(b, c), pd = screenPoint(b, d);
  const torso = dist(screenPoint(b, joint(side, 'shoulder')), screenPoint(b, joint(side, 'hip')));
  // A foreshortened limb cannot provide a reliable projected angle.
  if (torso < 0.02 || Math.min(dist(pa, pc), dist(pc, pd)) / torso < 0.22) return world;
  const profileWeight = Math.max(0, Math.min(0.8, (0.65 - facingRatio(b)) * 1.5));
  return world * (1 - profileWeight) + angleDeg(pa, pc, pd) * profileWeight;
}

export function bilateralAngle(b: Body, parts: readonly [string, string, string]) {
  const left = limbAngle(b, 'left', parts), right = limbAngle(b, 'right', parts);
  const lc = chainConfidence(b, chain('left', parts));
  const rc = chainConfidence(b, chain('right', parts));
  const mean = combineSides(left, right, lc, rc);
  return { left, right, mean, both: lc >= 0.6 && rc >= 0.6 };
}

/** Use one coherent side for floor posture; never invent the far-side joints. */
export function floorMetrics(b: Body) {
  const parts = ['shoulder', 'hip', 'knee', 'elbow'];
  const lc = chainConfidence(b, chain('left', parts));
  const rc = chainConfidence(b, chain('right', parts));
  const side = lc >= rc ? 'left' : 'right';
  const shoulder = wp(b, joint(side, 'shoulder'));
  const hip = wp(b, joint(side, 'hip'));
  const knee = wp(b, joint(side, 'knee'));
  const torso = sub(shoulder, hip);
  const a = screenPoint(b, joint(side, 'shoulder'));
  const c = screenPoint(b, joint(side, 'hip'));
  const projectedLength = dist(a, c);
  const screenUpright = projectedLength > 0.015 ? Math.abs(a.y - c.y) / projectedLength : 1;
  const worldUpright = Math.abs(torso.y) / Math.max(len(torso), 1e-4);
  const thigh = sub(knee, hip);
  const screenKnee = screenPoint(b, joint(side, 'knee'));
  const legUpright = Math.min(Math.abs(thigh.y) / Math.max(len(thigh), 1e-4),
    Math.abs(screenKnee.y - c.y) / Math.max(dist(screenKnee, c), 1e-4));
  const chord = sub(knee, shoulder);
  const along = dot(sub(hip, shoulder), chord) / Math.max(dot(chord, chord), 1e-4);
  const deviation = sub(sub(hip, shoulder), scale(chord, along));
  return {
    lineAngle: angleDeg(shoulder, hip, knee),
    legUpright,
    upright: Math.min(screenUpright, worldUpright),
    sag: dot(deviation, b.frame.forward) / Math.max(len(torso), 0.01),
  };
}
