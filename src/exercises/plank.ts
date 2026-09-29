/**
 * Планка — вид сбоку, режим удержания.
 *
 * Единственное упражнение с mode: 'hold'. Секундомер идёт только пока поза
 * правильная: провис таза останавливает время и показывает, что поправить.
 * Поэтому «30 секунд планки» здесь означает 30 секунд именно планки, а не
 * 30 секунд лежания в позе банана.
 */

import type { ExerciseSpec } from '../engine/types';
import { deg, num } from './common';
import { floorMetrics } from '../vision/measurements';

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

export const plank: ExerciseSpec = {
  id: 'plank',
  name: 'Планка',
  short: 'Планка',
  icon: '🧘',
  group: 'core',
  mode: 'hold',
  view: 'side',
  setup: 'Прими планку в любой части кадра. Покажи плечо, локоть, таз и колено хотя бы с одной стороны; удобен вид сбоку или под углом.',
  howTo: [
    'Упор на предплечья, локти под плечами',
    'Тело прямое от плеч до стоп',
    'Таз не провисает и не задран',
    'Держи положение — таймер идёт только в правильной позе',
  ],
  required: REQUIRED,
  tracking: 'either-side',
  defaultTarget: 40,
  mets: 4,
  tracked: ['sag', 'lineAngle', 'upright'],
  hud: { metric: 'lineAngle', label: 'Линия тела', unit: '°', decimals: 0 },

  metrics(b) {
    const floor = floorMetrics(b);
    return { ...floor, sagAbs: Math.abs(floor.sag) };
  },

  // В режиме удержания прогресс показывает, насколько поза близка к идеальной
  // линии: индикатор на экране заполняется, когда тело выпрямлено.
  progress(m) {
    const sag = m['sagAbs'] ?? 1;
    return Math.max(0, 1 - sag / 0.2);
  },

  /** Поза принята: тело горизонтально и примерно прямое. */
  inPosition(m) {
    const line = m['lineAngle'] ?? 0;
    const upright = m['upright'] ?? 1;
    return line > 138 && upright < 0.8 && (m['legUpright'] ?? 1) < 0.85;
  },

  positionHint:
    'Прими планку на предплечьях. Покажи камере плечо, таз и колено — сбоку или под углом.',

  liveRules: [
    {
      id: 'plank-sag',
      title: 'Таз провисает',
      severity: 'error',
      priority: 90,
      blocksRep: true,
      debounceMs: 400,
      highlight: ['hips'],
      check(ctx) {
        const sag = ctx.m['sag'] ?? 0;
        if (sag <= 0.07) return null;
        return {
          hint: `Таз провис на ${num(sag * 100, 0)}% длины корпуса — подкрути его под себя, напряги живот. Таймер стоит.`,
          value: sag,
          target: 0.07,
        };
      },
    },

    {
      id: 'plank-pike',
      title: 'Таз задран',
      severity: 'error',
      priority: 88,
      blocksRep: true,
      debounceMs: 400,
      highlight: ['hips'],
      check(ctx) {
        const sag = ctx.m['sag'] ?? 0;
        if (sag >= -0.07) return null;
        return {
          hint: `Таз задран на ${num(-sag * 100, 0)}% длины корпуса — опусти его до прямой линии. Таймер стоит.`,
          value: -sag,
          target: 0.07,
        };
      },
    },

    {
      id: 'plank-broken-line',
      title: 'Тело не в линию',
      severity: 'error',
      priority: 70,
      blocksRep: true,
      debounceMs: 500,
      highlight: ['torso'],
      check(ctx) {
        const line = ctx.m['lineAngle'] ?? 180;
        if (line >= 162) return null;
        return {
          hint: `Линия тела сломана: угол «плечи — таз — колени» ${deg(line)}, нужно от 162°. Вытянись в одну прямую.`,
          value: line,
          target: 162,
        };
      },
    },
  ],
};
