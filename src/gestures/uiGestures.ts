/** Два осознанных жеста: подтверждение и пауза. Выбор в меню — касанием. */
import type { Body } from '../vision/landmarks';
import { height, lateral, vis } from '../vision/landmarks';
import { clamp } from '../vision/geometry';

export type GestureName = 'confirm' | 'cancel';
export const GESTURE_LABEL: Record<GestureName, string> = {
  confirm: 'Обе руки над головой', cancel: 'Руки скрещены на груди',
};
export interface GestureFrame {
  needsRelease?: boolean;
  fired: GestureName | null;
  hold: number;
  holding: GestureName | null;
}
const EMPTY: GestureFrame = { fired: null, hold: 0, holding: null };
const HOLD_MS = { confirm: 750, cancel: 650 };
const GLOBAL_COOLDOWN_MS = 1300;

export class GestureEngine {
  private since: number | null = null;
  private candidate: GestureName | null = null;
  private lastFiredAt = -Infinity;
  private armed = true;
  private neutralSince: number | null = null;

  update(body: Body | null, t: number): GestureFrame {
    if (!body || (body.sampleId !== undefined && t - body.t > 250)) {
      this.reset();
      this.neutralSince = null;
      return { ...EMPTY, needsRelease: !this.armed };
    }
    if (!this.armed) {
      const neutral = vis(body, 'left_wrist') >= .5 && vis(body, 'right_wrist') >= .5 &&
        height(body, 'left_wrist') < .1 && height(body, 'right_wrist') < .1;
      this.neutralSince = neutral ? this.neutralSince ?? t : null;
      if (this.neutralSince !== null && t - this.neutralSince >= 250) this.armed = true;
      this.reset();
      return { ...EMPTY, needsRelease: !this.armed };
    }
    const next = isArmsCrossed(body) ? 'cancel' : isHandsUp(body) ? 'confirm' : null;
    if (!next) { this.reset(); return { ...EMPTY }; }
    if (next !== this.candidate) { this.candidate = next; this.since = t; }
    const held = t - (this.since ?? t);
    if (held >= HOLD_MS[next] && t - this.lastFiredAt >= GLOBAL_COOLDOWN_MS) {
      this.lastFiredAt = t;
      this.armed = false;
      this.neutralSince = null;
      this.reset();
      return { ...EMPTY, fired: next };
    }
    return { fired: null, holding: next, hold: clamp(held / HOLD_MS[next], 0, 1) };
  }
  reset(): void { this.since = null; this.candidate = null; }
  /** Переход экрана не снимает требование отпустить предыдущий жест. */
  clearCooldown(): void { this.reset(); }
}

/** Обе кисти явно выше головы. */
export function isHandsUp(body: Body): boolean {
  if (vis(body, 'left_wrist') < 0.5 || vis(body, 'right_wrist') < 0.5) return false;
  const nose = height(body, 'nose');
  return height(body, 'left_wrist') > nose + 0.06 && height(body, 'right_wrist') > nose + 0.06;
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
