/**
 * Разведение рук в стороны — вид спереди.
 *
 * Упражнение с «потолком»: подниматься выше плеч не нужно. Поэтому здесь есть
 * редкий для тренажёров тип ошибки — перевыполнение, и правило, которое ловит
 * подъём выше нормы.
 */

import type { ExerciseSpec } from '../engine/types';
import {
  armElevation,
  armInPlane,
  deg,
  elbowAngle,
  num,
  romRule,
  stallRule,
  symmetryRule,
  tempoRule,
  torsoPitch,
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
] as const;

const SHOULDER_LEVEL = 88;

export const lateralRaise: ExerciseSpec = {
  id: 'lateral-raise',
  name: 'Разведение рук в стороны',
  short: 'Разведения',
  icon: '🕊️',
  group: 'upper',
  mode: 'reps',
  view: 'front',
  setup: 'Встань лицом к камере и отойди так, чтобы разведённые в стороны руки полностью попадали в кадр.',
  howTo: [
    'Руки вдоль тела, локти почти прямые',
    'Разводи руки в стороны до уровня плеч',
    'Выше плеч не поднимай',
    'Опускай медленно, полностью до бёдер',
  ],
  required: REQUIRED,
  defaultTarget: 14,
  mets: 3.5,
  thresholds: { reset: 0.14, attempt: 0.45, valid: 0.88 },
  tracked: ['elev', 'elevL', 'elevR', 'elbowMean', 'planeMin', 'torsoPitch'],
  hud: { metric: 'elev', label: 'Подъём', unit: '°', decimals: 0 },

  metrics(b) {
    const elevL = armElevation(b, 'left');
    const elevR = armElevation(b, 'right');
    const elbowL = elbowAngle(b, 'left');
    const elbowR = elbowAngle(b, 'right');
    return {
      elevL,
      elevR,
      elev: (elevL + elevR) / 2,
      elbowMean: (elbowL + elbowR) / 2,
      planeMin: Math.min(armInPlane(b, 'left'), armInPlane(b, 'right')),
      torsoPitch: torsoPitch(b),
    };
  },

  progress(m) {
    return mapRange(m['elev'] ?? 0, 14, SHOULDER_LEVEL);
  },

  liveRules: [
    visibilityRule(REQUIRED, 'Кисти выходят за края кадра — отойди дальше от камеры.', ['wrists']),

    stallRule('Поднимай руки выше — движение слишком короткое для зачёта.'),

    {
      id: 'raise-too-high',
      title: 'Выше плеч',
      severity: 'warning',
      priority: 66,
      phases: ['bottom'],
      highlight: ['arms'],
      check(ctx) {
        const e = ctx.m['elev'] ?? 0;
        if (e <= 112) return null;
        return {
          hint: `Руки ушли на ${deg(e)} — останавливайся на уровне плеч, около 90°. Выше работает уже не та мышца.`,
          value: e,
          target: SHOULDER_LEVEL,
        };
      },
    },

    {
      id: 'raise-bent-elbows',
      title: 'Согнутые локти',
      severity: 'warning',
      priority: 54,
      phases: ['descent', 'bottom'],
      highlight: ['elbows'],
      check(ctx) {
        const e = ctx.m['elbowMean'] ?? 180;
        if (e >= 148) return null;
        return {
          hint: `Локти согнуты до ${deg(e)} — держи руки почти прямыми, иначе упражнение теряет смысл.`,
          value: e,
          target: 160,
        };
      },
    },

    {
      id: 'raise-swing',
      title: 'Раскачивание корпусом',
      severity: 'error',
      priority: 74,
      highlight: ['torso'],
      check(ctx) {
        const lean = Math.abs(ctx.m['torsoPitch'] ?? 0);
        if (lean <= 13) return null;
        return {
          hint: `Раскачиваешься корпусом на ${deg(lean)} — поднимай руки за счёт плеч, корпус неподвижен.`,
          value: lean,
          target: 13,
        };
      },
    },

    {
      id: 'raise-forward',
      title: 'Руки вперёд, а не в стороны',
      severity: 'warning',
      priority: 60,
      phases: ['bottom'],
      highlight: ['arms'],
      check(ctx) {
        const p = ctx.m['planeMin'] ?? 1;
        if (p >= 0.78) return null;
        return {
          hint: `Руки уходят вперёд на ${num((1 - p) * 100, 0)}% — разводи строго в стороны, по линии плеч.`,
          value: p,
        };
      },
    },

    symmetryRule({
      title: 'Одна рука ниже',
      left: 'elevL',
      right: 'elevR',
      maxDiff: 13,
      unit: '°',
      highlight: ['arms'],
      hint: (side, diff) =>
        `${side === 'left' ? 'Левая' : 'Правая'} рука ниже на ${deg(diff)} — выравнивай по уровню плеч.`,
    }),
  ],

  repRules: [
    romRule({
      id: 'raise-top',
      title: 'Не довёл до плеч',
      metric: 'elev',
      need: 'above',
      limit: 78,
      highlight: ['arms'],
      hint: (actual, limit) =>
        `Не зачтено: руки поднялись на ${deg(actual)}, нужно ${deg(limit)} — до уровня плеч.`,
    }),

    romRule({
      id: 'raise-bottom',
      title: 'Не опустил руки',
      metric: 'elev',
      need: 'below',
      limit: 26,
      severity: 'warning',
      blocksRep: false,
      priority: 50,
      highlight: ['arms'],
      hint: (actual) => `Опускай руки до конца, к бёдрам: остановился на ${deg(actual)}.`,
    }),

    tempoRule({ minDescentMs: 420, minRepMs: 1000 }),
  ],
};
