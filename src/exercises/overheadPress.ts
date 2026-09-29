/**
 * Жим над головой (без веса) — вид спереди.
 *
 * Главная ошибка здесь не амплитуда, а компенсация: когда рук не хватает,
 * человек прогибается в пояснице и «дожимает» корпусом. Это заметно только по
 * наклону корпуса относительно линии ног, поэтому правило прогиба стоит выше
 * по приоритету, чем правило амплитуды.
 */

import type { ExerciseSpec } from '../engine/types';
import {
  armElevation,
  armInPlane,
  backArchRule,
  deg,
  elbowAngle,
  handAboveHead,
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
  tracked: ['elbowMean', 'elev', 'elevL', 'elevR', 'wristHead', 'torsoPitch', 'planeMin'],
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
      wristHead: Math.min(handAboveHead(b, 'left'), handAboveHead(b, 'right')),
      torsoPitch: torsoPitch(b),
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

    backArchRule({
      max: 15,
      priority: 80,
      hint: (a) =>
        `Прогиб в пояснице ${deg(a)} — ты дожимаешь корпусом, а не руками. Напряги живот и держи корпус вертикально.`,
    }),

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
      metric: 'elbowMean',
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

    romRule({
      id: 'press-bottom',
      title: 'Не опустил руки',
      metric: 'elbowMean',
      need: 'below',
      limit: 112,
      severity: 'warning',
      blocksRep: false,
      priority: 52,
      highlight: ['elbows'],
      hint: (actual, limit) =>
        `Опускай руки ниже: сгиб локтя ${deg(actual)}, нужно до ${deg(limit)} — локти на уровне плеч.`,
    }),

    tempoRule({ minDescentMs: 380, minRepMs: 900 }),
  ],
};
