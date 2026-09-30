/** Команды подтверждаются удержанием, повтор — только после отпускания. */
import type { Body } from '../vision/landmarks';
import { height, lateral, vis, minVis, wp } from '../vision/landmarks';
import { clamp, angleDeg } from '../vision/geometry';

export type GestureName = 'cross' | 'previous' | 'next';
export const GESTURE_LABEL: Record<GestureName, string> = {
  cross: 'Крест', previous: 'Левая рука в сторону', next: 'Правая рука в сторону',
};
export interface GestureFrame {
  needsRelease?: boolean;
  fired: GestureName | null;
  hold: number;
  holding: GestureName | null;
}
const EMPTY: GestureFrame = { fired: null, hold: 0, holding: null };
const HOLD_MS = 650;
const GLOBAL_COOLDOWN_MS = 1300;

export class GestureEngine {
  private since: number | null = null;
  private candidate: GestureName | null = null;
  private lastFiredAt = -Infinity;
  private armed = true;
  private neutralSince: number | null = null;

  private lastSampleId: number | undefined;

  update(body: Body | null, t: number, navigation = false): GestureFrame {
    if (!body || (body.sampleId !== undefined && t - body.t > 250)) {
      this.reset();
      this.neutralSince = null;
      return { ...EMPTY, needsRelease: !this.armed };
    }
    // Перерисовка старого результата не подтверждает удержание/отпускание.
    if (body.sampleId !== undefined && body.sampleId === this.lastSampleId) return { ...EMPTY, needsRelease: !this.armed };
    this.lastSampleId = body.sampleId;
    if (!this.armed) {
      const neutral = vis(body, 'left_wrist') >= .5 && vis(body, 'right_wrist') >= .5 &&
        height(body, 'left_wrist') < .1 && height(body, 'right_wrist') < .1;
      this.neutralSince = neutral ? this.neutralSince ?? t : null;
      if (this.neutralSince !== null && t - this.neutralSince >= 250) this.armed = true;
      this.reset();
      return { ...EMPTY, needsRelease: !this.armed };
    }
    const next = isArmsCrossed(body) ? 'cross' : navigation ? navigationPose(body) : null;
    if (!next) { this.reset(); return { ...EMPTY }; }
    if (next !== this.candidate) { this.candidate = next; this.since = t; }
    const held = t - (this.since ?? t);
    const required = next === 'cross' ? HOLD_MS : 800;
    if (held >= required && t - this.lastFiredAt >= GLOBAL_COOLDOWN_MS) {
      this.lastFiredAt = t;
      this.armed = false;
      this.neutralSince = null;
      this.reset();
      return { ...EMPTY, fired: next };
    }
    return { fired: null, holding: next, hold: clamp(held / required, 0, 1) };
  }
  reset(): void { this.since = null; this.candidate = null; }
  /** Переход экрана не снимает требование отпустить предыдущий жест. */
  clearCooldown(): void { this.reset(); }
}

/** Руки скрещены на груди: каждая кисть перешла на противоположную сторону. */
export function isArmsCrossed(body: Body): boolean {
  if (vis(body, 'left_wrist') < 0.5 || vis(body, 'right_wrist') < 0.5) return false;

  const lw = lateral(body, 'left_wrist');
  const rw = lateral(body, 'right_wrist');
  const crossed = lw < -0.03 && rw > 0.03;
  if (!crossed) return false;

  const lh = height(body, 'left_wrist');
  const rh = height(body, 'right_wrist');
  const chest = (h: number) => h > 0.25 && h < 1.05;
  return chest(lh) && chest(rh);
}

/** Одна прямая рука в сторону на уровне плеч; вторая опущена. Не взмах. */
export function navigationPose(body: Body): 'previous' | 'next' | null {
  if (minVis(body, ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
    'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist']) < .65) return null;
  for (const side of ['left', 'right'] as const) {
    const other = side === 'left' ? 'right' : 'left';
    const wrist = `${side}_wrist` as const;
    const h = height(body, wrist);
    const reach = lateral(body, wrist) * (side === 'left' ? 1 : -1);
    if (h > .7 && h < 1.3 && reach > 1.05 && height(body, `${other}_wrist`) < .1 &&
      angleDeg(wp(body, `${side}_shoulder`), wp(body, `${side}_elbow`), wp(body, wrist)) > 155) {
      return side === 'left' ? 'previous' : 'next';
    }
  }
  return null;
}
