/**
 * Наклоны в сторону — вид спереди, попеременно.
 *
 * Упражнение целиком построено на разложении наклона по двум осям: полезное
 * движение идёт по боковой оси, а самая частая ошибка — подмена его наклоном
 * вперёд. Без разделения осей эти два движения неразличимы.
 */

import type { ExerciseSpec, Side } from '../engine/types';
import { deg, lateralTilt, num, romRule, torsoPitch, visibilityRule } from './common';
import { lateral } from '../vision/landmarks';
import { mapRange } from '../vision/geometry';

const REQUIRED = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
  'left_wrist',
  'right_wrist',
  'left_ankle',
  'right_ankle',
] as const;

const TILT_TARGET = 30;

export const sideBend: ExerciseSpec = {
  id: 'side-bend',
  name: 'Наклоны в сторону',
  short: 'Наклоны',
  icon: '🤸',
  group: 'core',
  mode: 'reps',
  view: 'front',
  alternating: true,
  setup: 'Встань лицом к камере, стопы на ширине плеч, руки свободно вдоль тела.',
  howTo: [
    'Стопы на ширине плеч, таз неподвижен',
    'Наклоняйся строго в сторону, скользя ладонью по бедру',
    'Не наклоняйся вперёд и не разворачивай корпус',
    'Вернись в вертикальное положение и наклонись в другую сторону',
  ],
  required: REQUIRED,
  defaultTarget: 16,
  mets: 3,
  thresholds: { reset: 0.15, attempt: 0.45, valid: 0.85 },
  tracked: ['tiltAbs', 'pitchAbs', 'hipShift'],
  hud: { metric: 'tiltAbs', label: 'Наклон', unit: '°', decimals: 0 },

  metrics(b) {
    const tilt = lateralTilt(b);
    const pitch = torsoPitch(b);
    // Таз должен оставаться на месте: следим за смещением стоп относительно
    // центра бёдер — начала системы координат тела.
    const ankleMid = (lateral(b, 'left_ankle') + lateral(b, 'right_ankle')) / 2;
    return {
      tilt,
      tiltAbs: Math.abs(tilt),
      pitch,
      pitchAbs: Math.abs(pitch),
      hipShift: Math.abs(ankleMid),
    };
  },

  progress(m) {
    return mapRange(m['tiltAbs'] ?? 0, 6, TILT_TARGET);
  },

  activeSide(m): Side | null {
    const t = m['tilt'] ?? 0;
    if (Math.abs(t) < 6) return null;
    return t > 0 ? 'left' : 'right';
  },

  liveRules: [
    visibilityRule(REQUIRED, 'Корпус выходит за край кадра при наклоне — отойди дальше от камеры.', ['torso']),

    {
      id: 'bend-forward-instead',
      title: 'Наклон вперёд вместо бока',
      severity: 'error',
      priority: 86,
      blocksRep: true,
      phases: ['descent', 'bottom'],
      highlight: ['torso'],
      check(ctx) {
        const pitch = ctx.m['pitchAbs'] ?? 0;
        const tilt = ctx.m['tiltAbs'] ?? 0;
        if (pitch <= 18 || pitch <= tilt * 0.6) return null;
        return {
          hint: `Наклоняешься вперёд на ${deg(pitch)} вместо наклона в сторону. Двигайся строго в плоскости тела, как между двумя стенами.`,
          value: pitch,
          target: 18,
        };
      },
    },

    {
      id: 'bend-hip-shift',
      title: 'Таз уходит в сторону',
      severity: 'warning',
      priority: 58,
      phases: ['bottom'],
      highlight: ['hips'],
      check(ctx) {
        const shift = ctx.m['hipShift'] ?? 0;
        if (shift <= 0.13) return null;
        return {
          hint: `Таз выталкивается в сторону на ${num(shift * 100, 0)}% длины корпуса — держи его на месте, работает только боковая мышца.`,
          value: shift,
          target: 0.13,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'bend-depth',
      title: 'Малая амплитуда наклона',
      metric: 'tiltAbs',
      need: 'above',
      limit: 23,
      highlight: ['torso'],
      hint: (actual, limit) =>
        `Не зачтено: наклон ${deg(actual)}, нужно ${deg(limit)}. Тянись ладонью ниже по бедру.`,
    }),
  ],
};
