/**
 * Отжимания — вид сбоку.
 *
 * Здесь работает bodyLineSag: знаковое отклонение таза от линии «плечи — колени».
 * Угол «плечи — таз — колени» сам по себе не годится, потому что и провисший, и
 * задранный таз дают угол меньше 180° — различить их можно только по знаку
 * проекции на направление «из груди».
 */

import type { ExerciseSpec } from '../engine/types';
import {
  deg,
  num,
  romRule,
  stallRule,
  tempoRule,
} from './common';
import { bilateralAngle, floorMetrics } from '../vision/measurements';
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
] as const;

const ELBOW_STRAIGHT = 166;
const ELBOW_BOTTOM = 92;
const ELBOW_MIN_DEPTH = 104;

export const pushUp: ExerciseSpec = {
  id: 'push-up',
  name: 'Отжимания',
  short: 'Отжимания',
  icon: '💪',
  group: 'upper',
  mode: 'reps',
  view: 'side',
  setup: 'Прими упор лёжа в любой части кадра. Покажи камере плечо, локоть, кисть, таз и колено; сбоку или под углом их видно лучше.',
  howTo: [
    'Упор лёжа, кисти под плечами',
    'Тело вытянуто в одну линию: плечи, таз и колени',
    'Опускайся, пока локоть не согнётся до 90°',
    'Выжимай себя вверх до полного выпрямления рук',
  ],
  required: REQUIRED,
  tracking: 'either-side',
  defaultTarget: 10,
  mets: 7,
  restCalibration: { metric: 'elbowMean', min: 145, ideal: ELBOW_STRAIGHT, bottom: ELBOW_BOTTOM },
  thresholds: { reset: 0.24, attempt: 0.42, valid: 0.84 },
  tracked: ['elbowMean', 'sag', 'sagAbs', 'lineAngle', 'upright'],
  hud: { metric: 'elbowMean', label: 'Локоть', unit: '°', decimals: 0 },

  metrics(b) {
    const elbows = bilateralAngle(b, ['shoulder', 'elbow', 'wrist']);
    const floor = floorMetrics(b);
    return {
      elbowL: elbows.left,
      elbowR: elbows.right,
      elbowMean: elbows.mean,
      ...floor,
      sagAbs: Math.abs(floor.sag),
    };
  },

  progress(m) {
    return mapRange(m['elbowMean'] ?? ELBOW_STRAIGHT, ELBOW_STRAIGHT, ELBOW_BOTTOM);
  },

  /**
   * Принят ли упор лёжа.
   *
   * Без этой проверки стоящий человек, который просто шевелит руками, даёт
   * колебания угла в локте по всей амплитуде — и движок отсчитывает «отжимания»,
   * которых не было. Различаем позы по вертикальному разносу плеч и таза в
   * кадре: стоя он близок к половине роста, в упоре лёжа — почти нулевой.
   */
  inPosition(m) {
    const line = m['lineAngle'] ?? 0;
    const upright = m['upright'] ?? 1;
    return line > 125 && upright < 0.8 && (m['legUpright'] ?? 1) < 0.85;
  },

  positionHint:
    'Прими упор лёжа и покажи камере линию плечо — таз — колено. Можно снимать сбоку или под углом, в любой части кадра.',

  liveRules: [
    stallRule('Опускайся ниже — такое движение я не считаю за отжимание. Сгибай локти минимум до 120°.'),

    {
      id: 'pushup-sag',
      title: 'Таз провисает',
      severity: 'error',
      priority: 88,
      blocksRep: false,
      highlight: ['hips', 'torso'],
      check(ctx) {
        const sag = ctx.m['sag'] ?? 0;
        if (sag <= 0.09) return null;
        return {
          hint: `Таз провисает к полу на ${num(sag * 100, 0)}% длины корпуса — напряги живот и ягодицы, вытяни тело в одну линию.`,
          value: sag,
          target: 0.09,
        };
      },
    },

    {
      id: 'pushup-pike',
      title: 'Таз задран',
      severity: 'error',
      priority: 86,
      blocksRep: false,
      highlight: ['hips', 'torso'],
      check(ctx) {
        const sag = ctx.m['sag'] ?? 0;
        if (sag >= -0.09) return null;
        return {
          hint: `Таз задран вверх на ${num(-sag * 100, 0)}% длины корпуса — опусти его, тело должно быть прямым от плеч до колен.`,
          value: -sag,
          target: 0.09,
        };
      },
    },
  ],

  repRules: [
    romRule({
      id: 'pushup-depth',
      title: 'Недостаточная глубина',
      metric: 'elbowMean',
      need: 'below',
      limit: ELBOW_MIN_DEPTH,
      highlight: ['elbows'],
      hint: (actual, limit) =>
        `Не зачтено: локоть согнулся до ${deg(actual)}, нужно до ${deg(limit)}. Опускайся, пока грудь не окажется на уровне локтей.`,
    }),

    romRule({
      id: 'pushup-lockout',
      title: 'Не выпрямил руки',
      metric: 'elbowMean',
      need: 'above',
      limit: 158,
      severity: 'warning',
      blocksRep: false,
      priority: 55,
      highlight: ['elbows'],
      hint: (actual, limit) =>
        `В верхней точке выпрямляй руки полностью: разгибание ${deg(actual)}, нужно ${deg(limit)}.`,
    }),

    tempoRule({ minDescentMs: 420, minRepMs: 1000 }),
  ],
};
