/**
 * Жестовое управление интерфейсом.
 *
 * Кейс требует управления без клавиатуры и мыши, и это относится не только к
 * упражнениям: меню, старт, пауза и переходы между экранами тоже работают телом.
 * Используется та же модель позы, что и для упражнений, — отдельная модель рук не
 * нужна, положения кистей достаточно.
 *
 * Четыре способа ввода:
 *   confirm — обе кисти выше головы (старт, подтверждение);
 *   cancel  — руки скрещены на груди (пауза, выход);
 *   dwell   — удержание кисти на кнопке 1,1 с (выбор из списка).
 *
 * Взмаха рукой здесь намеренно нет. Он не отличим от махов в самих упражнениях:
 * на jumping jacks кисть проходит по кадру ровно с той же скоростью, и движок
 * выдавал до восьми ложных срабатываний за подход. Действие, которое он
 * запускал — пропуск упражнения, — необратимо, поэтому оно осталось только за
 * кнопкой.
 */

import type { Body } from '../vision/landmarks';
import { height, lateral, sp, vis } from '../vision/landmarks';
import { clamp } from '../vision/geometry';

export type GestureName = 'confirm' | 'cancel';

export const GESTURE_LABEL: Record<GestureName, string> = {
  confirm: 'Обе руки над головой',
  cancel: 'Руки скрещены на груди',
};

export interface DwellTarget {
  id: string;
  rect: DOMRect;
}

export interface CursorPoint {
  /** CSS-пиксели внутри контейнера. */
  x: number;
  y: number;
}

export interface GestureFrame {
  /** После команды надо опустить руки. Потеря позы не считается отпусканием. */
  needsRelease?: boolean;
  cursor: CursorPoint | null;
  /** Заполнение кольца выбора, 0..1. */
  dwell: number;
  dwellTargetId: string | null;
  /** Цель, выбранная на этом кадре. */
  activatedTargetId: string | null;
  /** Жест, сработавший на этом кадре. */
  fired: GestureName | null;
  /** Удержание позы жеста, 0..1 — для визуального отклика. */
  hold: number;
  holding: GestureName | null;
}

export interface GestureOptions {
  container: DOMRect;
  targets: readonly DwellTarget[];
  /** Видео отражено по горизонтали (режим зеркала). */
  mirrored: boolean;
  /** Отключить dwell — например, во время упражнения. */
  dwellEnabled?: boolean;
}

const CONFIRM_HOLD_MS = 750;
const CANCEL_HOLD_MS = 650;
const DWELL_MS = 1100;
/** Курсор ушёл с кнопки — кольцо опустошается быстрее, чем заполнялось. */
const DWELL_DECAY = 2.6;
/** Пауза после любого жеста, чтобы одно движение не сработало дважды. */
const GLOBAL_COOLDOWN_MS = 1300;
/** Курсором управляет только поднятая кисть. */
const CURSOR_MIN_HEIGHT = 0;
const EMPTY: GestureFrame = {
  cursor: null,
  dwell: 0,
  dwellTargetId: null,
  activatedTargetId: null,
  fired: null,
  hold: 0,
  holding: null,
};

export class GestureEngine {
  private confirmSince: number | null = null;
  private cancelSince: number | null = null;
  private dwellSince: number | null = null;
  private dwellId: string | null = null;
  private dwellValue = 0;
  private lastFiredAt = -Infinity;
  private armed = true;
  private neutralSince: number | null = null;

  update(body: Body | null, t: number, opts: GestureOptions): GestureFrame {
    if (!body || (body.sampleId !== undefined && t - body.t > 250)) {
      this.reset();
      this.neutralSince = null;
      return { ...EMPTY, needsRelease: !this.armed };
    }

    const cursor = this.cursorFor(body, opts);
    if (!this.armed) {
      const neutral = !isHandsUp(body) && !isArmsCrossed(body) && !cursor;
      this.neutralSince = neutral ? this.neutralSince ?? t : null;
      if (this.neutralSince !== null && t - this.neutralSince >= 250) this.armed = true;
      this.reset();
      return { ...EMPTY, cursor, needsRelease: !this.armed };
    }

    const cooling = t - this.lastFiredAt < GLOBAL_COOLDOWN_MS;

    const confirm = this.trackHold('confirm', isHandsUp(body), t, CONFIRM_HOLD_MS);
    const cancel = this.trackHold('cancel', isArmsCrossed(body), t, CANCEL_HOLD_MS);

    if (!cooling && confirm.fired) {
      this.fire(t);
      return { ...EMPTY, fired: 'confirm' };
    }
    if (!cooling && cancel.fired) {
      this.fire(t);
      return { ...EMPTY, fired: 'cancel' };
    }

    const dwell =
      opts.dwellEnabled === false || cooling || confirm.progress > 0 || cancel.progress > 0
        ? { dwell: 0, targetId: null, activated: null }
        : this.updateDwell(cursor, opts, t, body.dt);

    if (dwell.activated) this.fire(t);

    const holding = confirm.progress >= cancel.progress ? 'confirm' : 'cancel';

    return {
      cursor,
      dwell: dwell.dwell,
      dwellTargetId: dwell.targetId,
      activatedTargetId: dwell.activated,
      fired: null,
      hold: Math.max(confirm.progress, cancel.progress),
      holding: Math.max(confirm.progress, cancel.progress) > 0 ? holding : null,
    };
  }

  reset(): void {
    this.confirmSince = null;
    this.cancelSince = null;
    this.dwellSince = null;
    this.dwellId = null;
    this.dwellValue = 0;
  }

  /** Новый экран не даёт удерживаемому жесту запустить следующую команду. */
  clearCooldown(): void {
    this.reset();
  }

  private fire(t: number): void {
    this.lastFiredAt = t;
    this.armed = false;
    this.neutralSince = null;
    this.reset();
  }

  private trackHold(
    kind: 'confirm' | 'cancel',
    active: boolean,
    t: number,
    needMs: number,
  ): { progress: number; fired: boolean } {
    const key = kind === 'confirm' ? 'confirmSince' : 'cancelSince';
    if (!active) {
      this[key] = null;
      return { progress: 0, fired: false };
    }
    if (this[key] === null) this[key] = t;
    const held = t - (this[key] as number);
    return { progress: clamp(held / needMs, 0, 1), fired: held >= needMs };
  }

  private cursorFor(body: Body, opts: GestureOptions): CursorPoint | null {
    const left = { name: 'left_wrist' as const, h: height(body, 'left_wrist') };
    const right = { name: 'right_wrist' as const, h: height(body, 'right_wrist') };
    const pick = left.h > right.h ? left : right;
    if (pick.h < CURSOR_MIN_HEIGHT) return null;
    if (vis(body, pick.name) < 0.5) return null;

    const p = sp(body, pick.name);
    const ls = sp(body, 'left_shoulder'), rs = sp(body, 'right_shoulder');
    const lh = sp(body, 'left_hip'), rh = sp(body, 'right_hip');
    const cx = (ls.x + rs.x) / 2, cy = (ls.y + rs.y) / 2;
    const aspect = body.imageAspect ?? 1;
    const torso = Math.hypot((cx - (lh.x + rh.x) / 2) * aspect, cy - (lh.y + rh.y) / 2);
    if (torso < 0.035) return null;
    // Относительно плеч, а не края видео: весь экран доступен и в углу кадра,
    // и на телефоне с полосами вокруг горизонтального изображения камеры.
    const dx = (p.x - cx) * aspect / torso * (opts.mirrored ? -1 : 1);
    return {
      x: clamp(0.5 + dx / 2.4, 0.015, 0.985) * opts.container.width,
      y: clamp(0.48 + (p.y - cy) / torso / 1.9, 0.015, 0.985) * opts.container.height,
    };
  }

  private updateDwell(
    cursor: CursorPoint | null,
    opts: GestureOptions,
    t: number,
    dt: number,
  ): { dwell: number; targetId: string | null; activated: string | null } {
    const hit = cursor ? findTarget(cursor, opts) : null;

    if (!hit) {
      this.dwellSince = null;
      this.dwellId = null;
      this.dwellValue = Math.max(0, this.dwellValue - dt * DWELL_DECAY);
      return { dwell: this.dwellValue, targetId: null, activated: null };
    }

    if (this.dwellId !== hit.id) {
      this.dwellId = hit.id;
      this.dwellSince = t;
    }
    const held = t - (this.dwellSince ?? t);
    this.dwellValue = clamp(held / DWELL_MS, 0, 1);

    if (held >= DWELL_MS) {
      const id = hit.id;
      this.dwellSince = null;
      this.dwellId = null;
      this.dwellValue = 0;
      return { dwell: 1, targetId: id, activated: id };
    }

    return { dwell: this.dwellValue, targetId: hit.id, activated: null };
  }
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

function findTarget(cursor: CursorPoint, opts: GestureOptions): DwellTarget | null {
  const { container } = opts;
  for (const target of opts.targets) {
    const r = target.rect;
    // Прямоугольники приходят в координатах окна — переводим в координаты контейнера.
    const x0 = r.left - container.left;
    const y0 = r.top - container.top;
    if (cursor.x >= x0 && cursor.x <= x0 + r.width && cursor.y >= y0 && cursor.y <= y0 + r.height) {
      return target;
    }
  }
  return null;
}
