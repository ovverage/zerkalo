/**
 * Выпады попеременно — вид спереди.
 *
 * Упражнение со сторонами: каждое повторение привязано к ноге, которая шагнула
 * вперёд. Сторону определяем по выносу стопы вперёд (координата глубины), а не
 * по углам — углы в выпаде почти одинаковые на обеих ногах.
 *
 * Отдельное правило ловит подмену: если стопы не разведены по глубине, человек
 * делает присед и называет его выпадом.
 */

import type { ExerciseSpec, Side } from '../engine/types';
import {
  deg,
  kneeAngle,
  romRule,
  stallRule,
  tempoRule,
  torsoPitch,
  visibilityRule,
} from './common';
import { depth } from '../vision/landmarks';
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

/** Минимальный разнос стоп по глубине, в долях корпуса, чтобы это был выпад. */
const MIN_STAGGER = 0.28;

export const lunge: ExerciseSpec = {
  id: 'lunge',
  name: 'Выпады',
  short: 'Выпады',
  icon: '🚶',
  group: 'legs',
  mode: 'reps',
  view: 'front',
  alternating: true,
  setup: 'Встань лицом к камере в 3 шагах. Шагать нужно вперёд, к камере, — оставь себе место.',
  howTo: [
    'Шагни одной ногой вперёд на длину стопы с запасом',
    'Опускайся, пока переднее бедро не дойдёт до параллели с полом',
    'Корпус держи вертикально, не наклоняйся вперёд',
    'Вернись в исходное положение и смени ногу',
  ],
  required: REQUIRED,
  defaultTarget: 12,
  mets: 5,
  thresholds: { reset: 0.17, attempt: 0.45, valid: 0.84 },
  tracked: ['kneeMean', 'kneeFront', 'stagger', 'torsoPitch'],
  hud: { metric: 'kneeFront', label: 'Колено', unit: '°', decimals: 0 },

  metrics(b) {
    const kneeL = kneeAngle(b, 'left');
    const kneeR = kneeAngle(b, 'right');
    // Положительное значение — вперёд шагнула левая нога.
    const stagger = depth(b, 'left_ankle') - depth(b, 'right_ankle');
    const frontIsLeft = stagger > 0;
    return {
      kneeL,
      kneeR,
      kneeMean: (kneeL + kneeR) / 2,
      kneeFront: frontIsLeft ? kneeL : kneeR,
      kneeBack: frontIsLeft ? kneeR : kneeL,
      stagger,
      staggerAbs: Math.abs(stagger),
      torsoPitch: torsoPitch(b),
    };
  },

  progress(m) {
    return mapRange(m['kneeMean'] ?? 168, 163, 100);
  },

  activeSide(m): Side | null {
    const s = m['stagger'] ?? 0;
    if (Math.abs(s) < 0.12) return null;
    return s > 0 ? 'left' : 'right';
  },

  liveRules: [
    visibilityRule(REQUIRED, 'Не видно ноги целиком — отойди назад, чтобы стопы попали в кадр.', ['legs']),

    stallRule('Опускайся глубже — пока это не выпад, а шаг на месте.'),

    {
      id: 'lunge-not-staggered',
      title: 'Стопы не разведены',
      severity: 'error',
      priority: 88,
      blocksRep: true,
      phases: ['descent', 'bottom'],
      highlight: ['feet'],
      check(ctx) {
        const s = ctx.m['staggerAbs'] ?? 0;
        if (s >= MIN_STAGGER) return null;
        return {
          hint: 'Это присед, а не выпад: шагни одной ногой заметно вперёд, к камере, и только потом опускайся.',
          value: s,
          target: MIN_STAGGER,
        };
      },
    },

    {
      id: 'lunge-lean',
      title: 'Наклон корпуса',
      severity: 'error',
      priority: 70,
      phases: ['descent', 'bottom', 'ascent'],
      highlight: ['torso'],
      check(ctx) {
        const lean = ctx.m['torsoPitch'] ?? 0;
        if (lean <= 24) return null;
        return {
          hint: `Корпус наклонён вперёд на ${deg(lean)} — в выпаде он остаётся вертикальным, до 24°.`,
          value: lean,
          target: 24,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'lunge-depth',
      title: 'Недостаточная глубина',
      metric: 'kneeFront',
      need: 'below',
      limit: 108,
      highlight: ['knees'],
      hint: (actual, limit) =>
        `Не зачтено: переднее колено согнулось до ${deg(actual)}, нужно до ${deg(limit)} — бедро до параллели с полом.`,
    }),

    tempoRule({ minDescentMs: 450, minRepMs: 1100 }),
  ],
};
