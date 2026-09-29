/** Жим без веса: полный цикл локтей, высота кистей и видимый боковой наклон.
 * По фронтальной камере не выдаём оценку изгиба поясницы. */

import type { ExerciseSpec } from '../engine/types';
import {
  armElevation,
  armInPlane,
  lateralTilt,
  deg,
  elbowAngle,
  handAboveHead,
  num,
  romRule,
  stallRule,
  symmetryRule,
  tempoRule,
  visibilityRule,
} from './common';
import { mapRange } from '../vision/geometry';

const REQUIRED = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'nose',
  'left_ankle',
  'right_ankle',
] as const;

export const overheadPress: ExerciseSpec = {
  id: 'overhead-press',
  name: 'Жим над головой',
  short: 'Жим',
  icon: '🙌',
  group: 'upper',
  mode: 'reps',
  view: 'front',
  setup: 'Встань лицом к камере. Проверь, что поднятые руки остаются в кадре — при необходимости отойди.',
  howTo: [
    'Исходное положение: локти согнуты у плеч, предплечья вертикально',
    'Выжимай руки строго вверх, до полного выпрямления',
    'Кисти уходят выше головы',
    'Корпус остаётся вертикальным — не прогибайся назад',
  ],
  required: REQUIRED,
  defaultTarget: 14,
  mets: 4,
  thresholds: { reset: 0.2, attempt: 0.5, valid: 0.86 },
  tracked: ['elbowMean', 'elbowMin', 'elev', 'elevL', 'elevR', 'wristHead', 'lateralTilt', 'planeMin'],
  hud: { metric: 'elbowMean', label: 'Локоть', unit: '°', decimals: 0 },

  metrics(b) {
    const elevL = armElevation(b, 'left');
    const elevR = armElevation(b, 'right');
    const elbowL = elbowAngle(b, 'left');
    const elbowR = elbowAngle(b, 'right');
    return {
      elevL,
      elevR,
      elev: (elevL + elevR) / 2,
      elbowL,
      elbowR,
      elbowMean: (elbowL + elbowR) / 2,
      elbowMin: Math.min(elbowL, elbowR),
      wristHead: Math.min(handAboveHead(b, 'left'), handAboveHead(b, 'right')),
      lateralTilt: lateralTilt(b),
      planeMin: Math.min(armInPlane(b, 'left'), armInPlane(b, 'right')),
    };
  },

  progress(m) {
    return mapRange(m['elev'] ?? 0, 78, 162);
  },

  liveRules: [
    visibilityRule(
      REQUIRED,
      'Кисти выходят за верхний край кадра — отойди от камеры или наклони её выше.',
      ['wrists'],
    ),

    stallRule('Выжимай руки выше — движение слишком короткое, чтобы засчитать повторение.'),

    {
      id: 'press-tilt', title: 'Корпус наклоняется в сторону', severity: 'warning', priority: 80,
      phases: ['descent', 'bottom', 'ascent'], highlight: ['torso'],
      check(ctx) {
        const tilt = Math.abs(ctx.m['lateralTilt'] ?? 0);
        return tilt > 15 ? { hint: 'Выровняй плечи над тазом. Поднимай руки без наклона корпуса в сторону.', value: tilt, target: 15, unit: '°' } : null;
      },
    },

    {
      id: 'press-forward',
      title: 'Руки уходят вперёд',
      severity: 'warning',
      priority: 58,
      phases: ['descent', 'bottom'],
      highlight: ['elbows'],
      check(ctx) {
        const p = ctx.m['planeMin'] ?? 1;
        if (p >= 0.72) return null;
        return {
          hint: `Руки уводит вперёд — выжимай строго вверх, в плоскости корпуса (сейчас отклонение ${num((1 - p) * 100, 0)}%).`,
          value: p,
        };
      },
    },

    symmetryRule({
      title: 'Одна рука отстаёт',
      left: 'elevL',
      right: 'elevR',
      maxDiff: 16,
      unit: '°',
      highlight: ['arms'],
      hint: (side, diff) =>
        `${side === 'left' ? 'Левая' : 'Правая'} рука отстаёт на ${deg(diff)} — поднимай обе одинаково.`,
    }),
  ],

  repRules: [
    romRule({
      id: 'press-lockout',
      title: 'Не дожал до конца',
      metric: 'elbowMin',
      need: 'above',
      limit: 158,
      highlight: ['elbows'],
      hint: (actual, limit) =>
        `Не зачтено: локоть выпрямился до ${deg(actual)}, нужно ${deg(limit)}. Дожимай руки полностью.`,
    }),

    romRule({
      id: 'press-overhead',
      title: 'Кисти не выше головы',
      metric: 'wristHead',
      need: 'above',
      limit: 0.1,
      highlight: ['wrists'],
      hint: (actual) =>
        actual < 0
          ? 'Кисти остались ниже головы — выведи их строго над макушкой.'
          : 'Подними кисти чуть выше — они должны уйти явно над головой.',
    }),

    {
      id: 'press-bottom',
      title: 'Не опустил руки',
      severity: 'error',
      blocksRep: true,
      priority: 52,
      highlight: ['elbows'],
      check(rep) {
        const actual = Math.max(rep.endMetrics['elbowL'] ?? 180, rep.endMetrics['elbowR'] ?? 180);
        return actual <= 118 ? null : { hint: `Верни согнутые локти к плечам: сейчас ${deg(actual)}, нужно до 118°. Подъём прямых рук — другое движение.`, value: actual, target: 118, unit: '°' };
      },
    },

    tempoRule({ minDescentMs: 380, minRepMs: 900 }),
  ],
};
