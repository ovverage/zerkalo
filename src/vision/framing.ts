/** Проверяем видимость нужных суставов, а не положение человека в кадре. */

import type { Body, LandmarkName } from './landmarks';
import { LANDMARK_INDEX, sp } from './landmarks';

import { observe } from './tracking';
import type { TrackingMode } from './tracking';

export type FramingSeverity = 'block' | 'warn';

export interface FramingIssue {
  code: string;
  hint: string;
  severity: FramingSeverity;
}

/** Русские названия частей тела для подсказок о перекрытии. */
const PART_LABEL: Partial<Record<LandmarkName, string>> = {
  nose: 'голову',
  left_shoulder: 'плечи',
  right_shoulder: 'плечи',
  left_elbow: 'локти',
  right_elbow: 'локти',
  left_wrist: 'кисти',
  right_wrist: 'кисти',
  left_hip: 'бёдра',
  right_hip: 'бёдра',
  left_knee: 'колени',
  right_knee: 'колени',
  left_ankle: 'стопы',
  right_ankle: 'стопы',
  left_foot_index: 'носки',
  right_foot_index: 'носки',
};

export interface FramingOptions {
  view: 'front' | 'side';
  tracking?: TrackingMode;
  required: readonly LandmarkName[];
}

export function checkFraming(
  body: Body | null,
  { view, required, tracking }: FramingOptions,
  brightness: number | null,
): FramingIssue[] {
  const issues: FramingIssue[] = [];

  if (brightness !== null && brightness < 0.16) {
    issues.push({
      code: 'dark',
      hint: 'Слишком темно — включи свет или встань лицом к окну, иначе камера не видит контуры.',
      severity: 'warn',
    });
  }

  if (!body) {
    issues.push({
      code: 'no-pose',
      hint: 'Покажись в любой части кадра. Для упражнения должны быть видны рабочие суставы; камера найдёт тебя автоматически.',
      severity: 'block',
    });
    return issues;
  }

  const observation = observe(body, required, tracking);
  if (!observation.ok) {
    const hidden = new Set(observation.missing.map((name) => PART_LABEL[name]).filter(Boolean));
    issues.push({
      code: 'partial',
      hint: `Не удаётся отследить ${[...hidden].join(' и ') || 'суставы'}. Покажи их камере или немного измени ракурс. В центре стоять не нужно.`,
      severity: 'block',
    });
  }
  const box = boundingBox(body);
  if (observation.ok && Math.max(box.width, box.height) < 0.22) {
    issues.push({ code: 'too-far', hint: 'Можно подойти чуть ближе — так суставы будут видны точнее.', severity: 'warn' });
  }

  const facing = facingRatio(body);
  if (tracking !== 'either-side' && view === 'front' && facing < 0.35) {
    issues.push({
      code: 'turn-front',
      hint: 'Спереди будет лучше видно обе стороны тела.',
      severity: 'warn',
    });
  }
  if (view === 'side' && facing > 0.75) {
    issues.push({
      code: 'turn-side',
      hint: 'Сбоку или под углом лучше видно сгиб локтя и линию спины.',
      severity: 'warn',
    });
  }

  return issues;
}

export const isBlocked = (issues: readonly FramingIssue[]): boolean =>
  issues.some((i) => i.severity === 'block');

/**
 * Насколько человек развёрнут к камере: 1 — строго лицом, 0 — строго в профиль.
 *
 * Считаем по координатам кадра, а не по метрическим: в 3D расстояние между
 * плечами не меняется при повороте, а в проекции — сжимается. Это единственный
 * надёжный признак ориентации.
 */
export function facingRatio(body: Body): number {
  const ls = sp(body, 'left_shoulder');
  const rs = sp(body, 'right_shoulder');
  const lh = sp(body, 'left_hip');
  const rh = sp(body, 'right_hip');

  const shoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

  const aspect = body.imageAspect ?? 1;
  const shoulderSpan = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  // Делим на полную длину корпуса на экране, а не на её вертикальную
  // составляющую: у лежащего человека вертикальная почти нулевая, и упражнения
  // в упоре лёжа навсегда получали бы «повернись боком».
  const torso = Math.hypot((shoulder.x - hip.x) * aspect, shoulder.y - hip.y);
  if (torso < 1e-4) return 1;
  return Math.min(shoulderSpan / torso, 1.5) / 1.1;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function boundingBox(body: Body): Box {
  let left = 1;
  let right = 0;
  let top = 1;
  let bottom = 0;
  for (let i = 0; i < body.screen.length; i += 1) {
    if ((body.visibility[i] ?? 0) < 0.35) continue;
    const p = body.screen[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  if (right < left || bottom < top) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/**
 * Средняя яркость кадра. Считаем по уменьшенной до 32×32 копии не чаще раза в
 * 400 мс — на каждом кадре это лишняя работа для GPU.
 */
export class BrightnessProbe {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private value: number | null = null;
  private lastAt = 0;

  constructor() {
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  sample(video: HTMLVideoElement, now: number): number | null {
    if (!this.ctx || video.videoWidth === 0) return this.value;
    if (now - this.lastAt < 400) return this.value;
    this.lastAt = now;
    this.ctx.drawImage(video, 0, 0, 32, 32);
    const { data } = this.ctx.getImageData(0, 0, 32, 32);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    }
    this.value = sum / (data.length / 4) / 255;
    return this.value;
  }
}

/** Индекс точки — для отладочной отрисовки и тестов. */
export const indexOf = (name: LandmarkName): number => LANDMARK_INDEX[name];
