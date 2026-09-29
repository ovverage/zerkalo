/**
 * Бег с высоким подъёмом колен — вид спереди, попеременно.
 *
 * Самое быстрое упражнение в наборе: повторение занимает около 400 мс. Здесь
 * особенно важен гистерезис счётчика — при таком темпе наивная проверка порога
 * даёт кратное завышение счёта.
 */

import type { ExerciseSpec, Side } from '../engine/types';
import { deg, kneeAboveHip, num, romRule, torsoPitch, visibilityRule } from './common';
import { height } from '../vision/landmarks';
import { mapRange } from '../vision/geometry';

const REQUIRED = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
] as const;

/** Высота колена относительно таза, при которой подъём считается полным. */
const KNEE_TARGET = -0.08;

export const highKnees: ExerciseSpec = {
  id: 'high-knees',
  name: 'Бег с высоким подъёмом колен',
  short: 'Колени',
  icon: '🏃',
  group: 'cardio',
  mode: 'reps',
  view: 'front',
  alternating: true,
  setup: 'Встань лицом к камере так, чтобы в кадре был виден таз и колени в верхней точке.',
  howTo: [
    'Бег на месте, колено поднимается до уровня таза',
    'Корпус вертикальный, не отклоняйся назад',
    'Активно работай руками, локти согнуты',
    'Приземляйся на переднюю часть стопы',
  ],
  required: REQUIRED,
  defaultTarget: 30,
  mets: 8.5,
  thresholds: { reset: 0.16, attempt: 0.42, valid: 0.8 },
  tracked: ['kneeHigh', 'torsoPitch', 'wristHigh'],
  hud: { metric: 'kneeHighPct', label: 'Колено', unit: '%', decimals: 0 },

  metrics(b) {
    const left = kneeAboveHip(b, 'left');
    const right = kneeAboveHip(b, 'right');
    const kneeHigh = Math.max(left, right);
    return {
      kneeL: left,
      kneeR: right,
      kneeHigh,
      kneeHighPct: mapRange(kneeHigh, -0.5, KNEE_TARGET) * 100,
      lead: left - right,
      torsoPitch: torsoPitch(b),
      wristHigh: Math.max(height(b, 'left_wrist'), height(b, 'right_wrist')),
    };
  },

  progress(m) {
    return mapRange(m['kneeHigh'] ?? -0.5, -0.46, KNEE_TARGET);
  },

  activeSide(m): Side | null {
    const lead = m['lead'] ?? 0;
    if (Math.abs(lead) < 0.04) return null;
    return lead > 0 ? 'left' : 'right';
  },

  liveRules: [
    visibilityRule(REQUIRED, 'Не видно колени в верхней точке — отойди назад или наклони камеру ниже.', ['knees']),

    {
      id: 'knees-lean-back',
      title: 'Отклонение назад',
      severity: 'error',
      priority: 76,
      highlight: ['torso'],
      check(ctx) {
        const lean = -(ctx.m['torsoPitch'] ?? 0);
        if (lean <= 16) return null;
        return {
          hint: `Отклоняешься назад на ${deg(lean)} — так колено поднимается за счёт корпуса. Держи спину вертикально.`,
          value: lean,
          target: 16,
        };
      },
    },

    {
      id: 'knees-idle-arms',
      title: 'Руки не работают',
      severity: 'warning',
      priority: 34,
      debounceMs: 1800,
      highlight: ['arms'],
      check(ctx) {
        const w = ctx.m['wristHigh'] ?? -1;
        if (w > -0.26) return null;
        return {
          hint: 'Руки висят — согни локти и двигай ими в такт бегу, иначе теряется половина нагрузки.',
          value: w,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'knees-height',
      title: 'Колено ниже таза',
      metric: 'kneeHigh',
      need: 'above',
      limit: -0.16,
      highlight: ['knees'],
      hint: (actual) =>
        `Не зачтено: колено поднялось на ${num(mapRange(actual, -0.5, KNEE_TARGET) * 100, 0)}% нужной высоты. Поднимай до уровня таза.`,
    }),
  ],
};
