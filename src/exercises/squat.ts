/**
 * Приседания — вид спереди.
 *
 * Пять разных ошибок: недостаточная глубина, сведение колен внутрь (главный
 * фактор травмы), наклон корпуса, узкая постановка стоп и асимметрия.
 */

import type { ExerciseSpec } from '../engine/types';
import {
  deg,
  forwardLeanRule,
  hipBelowKnee,
  kneeValgus,
  num,
  romRule,
  stallRule,
  stanceWidth,
  symmetryRule,
  tempoRule,
  torsoPitch,
} from './common';
import { bilateralAngle } from '../vision/measurements';
import { facingRatio } from '../vision/framing';
import { mapRange } from '../vision/geometry';

const REQUIRED = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

/** Колено прямое. */
const KNEE_STRAIGHT = 168;
/** Бедро параллельно полу — целевая глубина. */
const KNEE_PARALLEL = 92;
/** Порог зачёта по глубине. */
const KNEE_MIN_DEPTH = 102;

export const squat: ExerciseSpec = {
  id: 'squat',
  name: 'Приседания',
  short: 'Присед',
  icon: '🦵',
  group: 'legs',
  mode: 'reps',
  view: 'front',
  setup: 'Встань в любой части кадра: спереди, боком или под углом. Должны быть видны плечо, таз, колено и стопа хотя бы с одной стороны.',
  howTo: [
    'Стопы на ширине плеч, носки слегка развёрнуты наружу',
    'Опускайся, отводя таз назад, пока бедро не дойдёт до параллели с полом',
    'Колени идут в сторону носков, не заваливаются внутрь',
    'Встаёшь, полностью выпрямляя ноги',
  ],
  required: REQUIRED,
  tracking: 'either-side',
  restCalibration: { metric: 'kneeMean', min: 145, ideal: KNEE_STRAIGHT, bottom: KNEE_PARALLEL },
  thresholds: { reset: 0.22, attempt: 0.4, valid: 0.85 },
  defaultTarget: 12,
  mets: 5.5,
  tracked: ['kneeMean', 'kneeL', 'kneeR', 'torsoPitch', 'valgus', 'stance', 'hipOverKnee'],
  hud: { metric: 'kneeMean', label: 'Колено', unit: '°', decimals: 0 },

  metrics(b) {
    const knees = bilateralAngle(b, ['hip', 'knee', 'ankle']);
    const kneeL = knees.both ? knees.left : knees.mean;
    const kneeR = knees.both ? knees.right : knees.mean;
    const frontal = knees.both && facingRatio(b) > 0.5;
    return {
      kneeL,
      kneeR,
      kneeMean: knees.mean,
      torsoPitch: torsoPitch(b),
      valgus: frontal ? kneeValgus(b) : 0,
      stance: frontal ? stanceWidth(b) : 1,
      hipOverKnee: hipBelowKnee(b),
    };
  },

  progress(m) {
    return mapRange(m['kneeMean'] ?? KNEE_STRAIGHT, KNEE_STRAIGHT, KNEE_PARALLEL);
  },

  liveRules: [
    stallRule('Приседай заметно глубже — такое движение я не считаю за повторение. Согни колени хотя бы до 130°.'),

    {
      id: 'knee-valgus',
      title: 'Колени сводятся внутрь',
      severity: 'error',
      priority: 85,
      blocksRep: true,
      phases: ['descent', 'bottom', 'ascent'],
      highlight: ['knees'],
      check(ctx) {
        const v = ctx.m['valgus'] ?? 0;
        if (v <= 0.34) return null;
        return {
          hint: 'Колени заваливаются внутрь — разводи их наружу, в сторону носков. Это главная причина травмы колена.',
          value: v,
        };
      },
    },

    forwardLeanRule({
      max: 50,
      hint: (a) =>
        `Слишком наклоняешься вперёд: корпус на ${deg(a)}, нужно не больше 50°. Держи грудь выше и переноси вес на пятки.`,
    }),

    {
      id: 'narrow-stance',
      title: 'Узкая постановка стоп',
      severity: 'warning',
      priority: 45,
      phases: ['top', 'descent'],
      highlight: ['feet'],
      check(ctx) {
        const s = ctx.m['stance'] ?? 1;
        if (s >= 0.78) return null;
        return {
          hint: `Поставь стопы шире: сейчас ${num(s)} ширины плеч, нужно около 1,0 — иначе не получится сесть глубоко.`,
          value: s,
          target: 1,
        };
      },
    },

    symmetryRule({
      title: 'Разная нагрузка на ноги',
      left: 'kneeL',
      right: 'kneeR',
      maxDiff: 17,
      unit: '°',
      lowerIsMoreWork: true,
      highlight: ['legs'],
      hint: (side, diff) =>
        `${side === 'left' ? 'Левая' : 'Правая'} нога сгибается на ${deg(diff)} меньше — вес уходит на другую. Приседай симметрично.`,
    }),
  ],

  repRules: [
    romRule({
      id: 'squat-depth',
      title: 'Недостаточная глубина',
      metric: 'kneeMean',
      need: 'below',
      limit: KNEE_MIN_DEPTH,
      highlight: ['knees', 'hips'],
      hint: (actual, limit) =>
        `Присед не зачтён: колено согнулось до ${deg(actual)}, нужно минимум до ${deg(limit)}. Опускайся, пока бедро не станет параллельно полу.`,
    }),

    romRule({
      id: 'squat-lockout',
      title: 'Не выпрямил ноги',
      metric: 'kneeMean',
      need: 'above',
      limit: 158,
      severity: 'warning',
      blocksRep: false,
      priority: 55,
      highlight: ['knees'],
      hint: (actual, limit) =>
        `В верхней точке выпрямляй ноги полностью: разгибание ${deg(actual)}, нужно ${deg(limit)} и больше.`,
    }),

    tempoRule({ minDescentMs: 420, minRepMs: 950 }),
  ],
};
