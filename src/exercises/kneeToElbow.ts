/**
 * Колено к локтю (косые скручивания стоя) — вид спереди, попеременно.
 *
 * Перекрёстное движение: левый локоть идёт к правому колену. Прогресс считаем по
 * расстоянию между ними — метрика, которая напрямую выражает цель упражнения, в
 * отличие от углов в суставах.
 */

import type { ExerciseSpec, Side } from '../engine/types';
import { deg, kneeAboveHip, num, romRule, torsoPitch, visibilityRule } from './common';
import { span } from '../vision/landmarks';
import { mapRange } from '../vision/geometry';

const REQUIRED = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
] as const;

/** Целевое расстояние «локоть — колено» в долях длины корпуса. */
const GAP_TARGET = 0.3;

export const kneeToElbow: ExerciseSpec = {
  id: 'knee-to-elbow',
  name: 'Колено к локтю',
  short: 'Скручивания',
  icon: '🌀',
  group: 'core',
  mode: 'reps',
  view: 'front',
  alternating: true,
  setup: 'Встань лицом к камере, руки за голову или у висков, локти разведены в стороны.',
  howTo: [
    'Руки у висков, локти широко в стороны',
    'Поднимай колено и одновременно веди к нему противоположный локоть',
    'Скручивайся корпусом, а не просто наклоняйся вперёд',
    'Вернись прямо и повтори на другую сторону',
  ],
  required: REQUIRED,
  defaultTarget: 16,
  mets: 4,
  thresholds: { reset: 0.17, attempt: 0.45, valid: 0.82 },
  tracked: ['gap', 'kneeHigh', 'pitch'],
  hud: { metric: 'gapPct', label: 'Сближение', unit: '%', decimals: 0 },

  metrics(b) {
    const leftCross = span(b, 'left_elbow', 'right_knee');
    const rightCross = span(b, 'right_elbow', 'left_knee');
    const gap = Math.min(leftCross, rightCross);
    return {
      gap,
      gapPct: mapRange(gap, 1.0, GAP_TARGET) * 100,
      // Положительное — работает левый локоть с правым коленом.
      lead: rightCross - leftCross,
      kneeHigh: Math.max(kneeAboveHip(b, 'left'), kneeAboveHip(b, 'right')),
      pitch: torsoPitch(b),
    };
  },

  progress(m) {
    return mapRange(m['gap'] ?? 1, 0.95, GAP_TARGET);
  },

  activeSide(m): Side | null {
    const lead = m['lead'] ?? 0;
    if (Math.abs(lead) < 0.05) return null;
    return lead > 0 ? 'left' : 'right';
  },

  liveRules: [
    visibilityRule(REQUIRED, 'Не видно колени или локти — отойди назад, чтобы корпус и ноги были в кадре.', ['knees', 'elbows']),

    {
      id: 'crunch-forward-collapse',
      title: 'Наклон вперёд вместо скручивания',
      severity: 'error',
      priority: 84,
      blocksRep: true,
      phases: ['descent', 'bottom'],
      highlight: ['torso'],
      check(ctx) {
        const pitch = ctx.m['pitch'] ?? 0;
        if (pitch <= 42) return null;
        return {
          hint: `Складываешься вперёд на ${deg(pitch)} — это не скручивание. Поднимай колено выше и разворачивай корпус, а не наклоняй его.`,
          value: pitch,
          target: 42,
        };
      },
    },

    {
      id: 'crunch-low-knee',
      title: 'Колено не поднимается',
      severity: 'warning',
      priority: 62,
      phases: ['bottom'],
      highlight: ['knees'],
      check(ctx) {
        const k = ctx.m['kneeHigh'] ?? -1;
        if (k > -0.3) return null;
        return {
          hint: 'Колено почти не поднимается — сближение идёт только за счёт локтя. Поднимай колено к тазу.',
          value: k,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'crunch-gap',
      title: 'Локоть не дошёл до колена',
      metric: 'gap',
      need: 'below',
      limit: 0.42,
      highlight: ['elbows', 'knees'],
      hint: (actual) =>
        `Не зачтено: сближение ${num(mapRange(actual, 1.0, GAP_TARGET) * 100, 0)}% от нужного. Доводи локоть к колену.`,
    }),
  ],
};
