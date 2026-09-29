/**
 * Присед с руками над головой — вид спереди.
 *
 * Комбинированное упражнение и одновременно тест подвижности: если плечи или
 * грудной отдел зажаты, руки при приседе уходят вперёд. Это единственная ошибка
 * в наборе, которую человек физически не может увидеть сам, — на неё и рассчитано
 * главное правило.
 */

import type { ExerciseSpec } from '../engine/types';
import {
  armElevation,
  deg,
  forwardLeanRule,
  kneeAngle,
  kneeValgus,
  romRule,
  stallRule,
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
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

const KNEE_MIN_DEPTH = 106;
const ARMS_UP = 150;

export const overheadSquat: ExerciseSpec = {
  id: 'overhead-squat',
  name: 'Присед с руками над головой',
  short: 'Присед+руки',
  icon: '🏋️',
  group: 'legs',
  mode: 'reps',
  view: 'front',
  setup: 'Встань лицом к камере и отойди так, чтобы поднятые руки и стопы одновременно попадали в кадр.',
  howTo: [
    'Подними прямые руки над головой и держи их там всё повторение',
    'Приседай, пока бедро не дойдёт до параллели с полом',
    'Руки остаются над головой, не уходят вперёд',
    'Колени идут наружу, к носкам',
  ],
  required: REQUIRED,
  defaultTarget: 10,
  mets: 6,
  tracked: ['kneeMean', 'elev', 'torsoPitch', 'valgus'],
  hud: { metric: 'kneeMean', label: 'Колено', unit: '°', decimals: 0 },

  metrics(b) {
    const kneeL = kneeAngle(b, 'left');
    const kneeR = kneeAngle(b, 'right');
    return {
      kneeL,
      kneeR,
      kneeMean: (kneeL + kneeR) / 2,
      elev: (armElevation(b, 'left') + armElevation(b, 'right')) / 2,
      torsoPitch: torsoPitch(b),
      valgus: kneeValgus(b),
    };
  },

  progress(m) {
    return mapRange(m['kneeMean'] ?? 168, 166, 94);
  },

  liveRules: [
    visibilityRule(
      REQUIRED,
      'В кадр не попадают одновременно руки и стопы — отойди дальше от камеры.',
      ['wrists', 'feet'],
    ),

    stallRule('Приседай глубже — движение слишком мелкое для зачёта.'),

    {
      id: 'ohs-arms-drop',
      title: 'Руки уходят вперёд',
      severity: 'error',
      priority: 90,
      blocksRep: true,
      phases: ['descent', 'bottom', 'ascent'],
      highlight: ['arms'],
      check(ctx) {
        const e = ctx.m['elev'] ?? 180;
        if (e >= ARMS_UP) return null;
        return {
          hint: `Руки опустились до ${deg(e)} — при приседе они должны оставаться над головой (${deg(ARMS_UP)} и выше). Разверни грудь и тянись руками вверх.`,
          value: e,
          target: ARMS_UP,
        };
      },
    },

    {
      id: 'ohs-valgus',
      title: 'Колени сводятся внутрь',
      severity: 'error',
      priority: 82,
      blocksRep: true,
      phases: ['descent', 'bottom', 'ascent'],
      highlight: ['knees'],
      check(ctx) {
        const v = ctx.m['valgus'] ?? 0;
        if (v <= 0.34) return null;
        return { hint: 'Колени заваливаются внутрь — разводи их наружу, в сторону носков.', value: v };
      },
    },

    forwardLeanRule({
      max: 42,
      hint: (a) =>
        `Корпус наклонён на ${deg(a)} — в приседе с руками над головой держи его прямее, до 42°, иначе руки неизбежно уйдут вперёд.`,
    }),
  ],

  repRules: [
    romRule({
      id: 'ohs-depth',
      title: 'Недостаточная глубина',
      metric: 'kneeMean',
      need: 'below',
      limit: KNEE_MIN_DEPTH,
      highlight: ['knees'],
      hint: (actual, limit) =>
        `Не зачтено: колено согнулось до ${deg(actual)}, нужно до ${deg(limit)}.`,
    }),

    // Отдельного правила «руки опускались» здесь нет: покадровое ohs-arms-drop
    // уже блокирует зачёт и знает точное значение в момент провала.
    tempoRule({ minDescentMs: 480, minRepMs: 1100 }),
  ],
};
