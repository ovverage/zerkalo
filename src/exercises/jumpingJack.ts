/**
 * Jumping jacks — вид спереди.
 *
 * Особенность: прогресс собирается из двух независимых частей — рук и ног.
 * Это позволяет поймать ошибку, которую не видно ни по рукам, ни по ногам
 * отдельно: рассинхрон, когда руки уже вверху, а стопы ещё вместе.
 */

import type { ExerciseSpec } from '../engine/types';
import {
  armElevation,
  deg,
  num,
  romRule,
  stanceWidth,
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
  'left_ankle',
  'right_ankle',
] as const;

const ARM_TARGET = 148;
const STANCE_TARGET = 1.5;

export const jumpingJack: ExerciseSpec = {
  id: 'jumping-jack',
  name: 'Jumping jacks',
  short: 'Джампы',
  icon: '⭐',
  group: 'cardio',
  mode: 'reps',
  view: 'front',
  setup: 'Встань лицом к камере, отойди так, чтобы разведённые руки не выходили за края кадра.',
  howTo: [
    'Исходное положение: стопы вместе, руки вдоль тела',
    'Прыжком разводишь стопы шире плеч и одновременно поднимаешь руки над головой',
    'Руки и ноги двигаются синхронно',
    'Возвращаешься в исходное положение',
  ],
  required: REQUIRED,
  defaultTarget: 20,
  mets: 8,
  thresholds: { reset: 0.18, attempt: 0.45, valid: 0.82 },
  tracked: ['armElev', 'stance', 'desync', 'armPart', 'legPart'],
  hud: { metric: 'armElev', label: 'Руки', unit: '°', decimals: 0 },

  metrics(b) {
    const armElev = (armElevation(b, 'left') + armElevation(b, 'right')) / 2;
    const stance = stanceWidth(b);
    const armPart = mapRange(armElev, 32, ARM_TARGET);
    const legPart = mapRange(stance, 0.62, STANCE_TARGET);
    return {
      armElev,
      stance,
      armPart,
      legPart,
      desync: Math.abs(armPart - legPart),
    };
  },

  progress(m) {
    return 0.5 * (m['armPart'] ?? 0) + 0.5 * (m['legPart'] ?? 0);
  },

  liveRules: [
    visibilityRule(
      REQUIRED,
      'Руки уходят за край кадра — отойди дальше от камеры или опусти её ниже.',
      ['wrists'],
    ),

    {
      id: 'jack-desync',
      title: 'Руки и ноги не в такт',
      severity: 'warning',
      priority: 60,
      phases: ['bottom'],
      debounceMs: 260,
      highlight: ['arms', 'feet'],
      check(ctx) {
        const d = ctx.m['desync'] ?? 0;
        if (d <= 0.34) return null;
        const arms = ctx.m['armPart'] ?? 0;
        const legs = ctx.m['legPart'] ?? 0;
        return {
          hint:
            arms > legs
              ? 'Руки опережают ноги — разводи стопы одновременно с подъёмом рук.'
              : 'Ноги опережают руки — поднимай руки одновременно с прыжком.',
          value: d,
        };
      },
    },

    {
      id: 'jack-stiff-arms',
      title: 'Руки не доходят вверх',
      severity: 'warning',
      priority: 50,
      phases: ['bottom'],
      highlight: ['arms'],
      check(ctx) {
        const e = ctx.m['armElev'] ?? 0;
        if (e >= 120) return null;
        return {
          hint: `Руки идут только до ${deg(e)} — поднимай их над головой, а не в стороны.`,
          value: e,
          target: ARM_TARGET,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'jack-arms',
      title: 'Руки не над головой',
      metric: 'armElev',
      need: 'above',
      limit: 138,
      highlight: ['arms'],
      hint: (actual, limit) =>
        `Не зачтено: руки поднялись до ${deg(actual)}, нужно ${deg(limit)}. Ладони должны сойтись над головой.`,
    }),

    romRule({
      id: 'jack-stance',
      title: 'Узкий прыжок',
      metric: 'stance',
      need: 'above',
      limit: 1.32,
      highlight: ['feet'],
      hint: (actual, limit) =>
        `Прыгай шире: стопы разошлись на ${num(actual)} ширины плеч, нужно ${num(limit)}.`,
    }),

    romRule({
      id: 'jack-return',
      title: 'Не собрал стопы',
      metric: 'stance',
      need: 'below',
      limit: 0.85,
      severity: 'warning',
      blocksRep: false,
      priority: 48,
      highlight: ['feet'],
      hint: (actual) =>
        `Возвращай стопы вместе: минимум между прыжками ${num(actual)} ширины плеч — амплитуда теряется.`,
    }),

    tempoRule({
      minDescentMs: 180,
      minRepMs: 480,
      hint: 'Слишком частые мелкие прыжки — делай полное движение, руки до конца вверх.',
      priority: 35,
    }),
  ],
};
