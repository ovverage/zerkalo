/**
 * Общие метрики тела и фабрики правил.
 *
 * Каждое упражнение описывается своими порогами, но сами измерения и типовые
 * ошибки (недостаточная амплитуда, асимметрия, слишком быстрый темп, потеря
 * точек из кадра) одинаковы. Здесь они собраны один раз, чтобы файлы упражнений
 * состояли только из специфики.
 */

import type { Body, LandmarkGroupName, LandmarkName } from '../vision/landmarks';
import { height, lateral, span, wp } from '../vision/landmarks';
import { observe } from '../vision/tracking';
import type { Vec3 } from '../vision/geometry';
import { angleBetween, angleDeg, dot, mid, normalize, scale, sub, toDeg } from '../vision/geometry';
import type { LiveRule, RepRule, Severity, Side } from '../engine/types';

export const SIDES: readonly Side[] = ['left', 'right'];

const L = <T extends string>(side: Side, part: T) => `${side}_${part}` as LandmarkName;

/* ── Углы в суставах ─────────────────────────────────────────────────────── */

/** Угол в колене: 180° — нога прямая, 90° — бедро параллельно полу. */
export const kneeAngle = (b: Body, s: Side): number =>
  angleDeg(wp(b, L(s, 'hip')), wp(b, L(s, 'knee')), wp(b, L(s, 'ankle')));

/** Угол в локте: 180° — рука прямая. */
export const elbowAngle = (b: Body, s: Side): number =>
  angleDeg(wp(b, L(s, 'shoulder')), wp(b, L(s, 'elbow')), wp(b, L(s, 'wrist')));

/** Угол в тазобедренном суставе: 180° — корпус и бедро на одной линии. */
export const hipAngle = (b: Body, s: Side): number =>
  angleDeg(wp(b, L(s, 'shoulder')), wp(b, L(s, 'hip')), wp(b, L(s, 'knee')));

/** Отклонение плеча от корпуса: 0° — рука прижата, 90° — в сторону, 180° — вверх. */
export function armElevation(b: Body, s: Side): number {
  const upper = sub(wp(b, L(s, 'elbow')), wp(b, L(s, 'shoulder')));
  return 180 - angleBetween(upper, b.frame.up);
}

/** Насколько рука отведена в стороны, а не вперёд: 1 — строго в плоскости тела. */
export function armInPlane(b: Body, s: Side): number {
  const upper = normalize(sub(wp(b, L(s, 'elbow')), wp(b, L(s, 'shoulder'))));
  return 1 - Math.abs(dot(upper, b.frame.forward));
}

/* ── Наклон корпуса ──────────────────────────────────────────────────────── */

/**
 * Наклон корпуса, разложенный на две независимые оси, в градусах.
 *
 * Отсчёт идёт от линии ног, а не от вертикали кадра: гравитацию по координатам
 * камеры определить нельзя (камеру могли наклонить), а линия «стопы → таз» при
 * стоячих упражнениях — надёжная замена вертикали.
 *
 * Разложение обязательно: полный угол между корпусом и ногами смешивает наклон
 * вперёд с наклоном в сторону, и тогда наклоны в сторону выглядели бы как
 * «наклоняешься вперёд». Оси строим относительно линии ног — ортогонализовать их
 * относительно самого корпуса нельзя, потому что frame.up и есть корпус, и любая
 * его проекция на собственные оси тождественно равна нулю.
 */
export function torsoAngles(b: Body): { pitch: number; tilt: number } {
  const ankles = mid(wp(b, 'left_ankle'), wp(b, 'right_ankle'));
  const legUp = normalize(sub(b.frame.midHip, ankles));
  const along = dot(b.frame.up, legUp);

  const forwardRef = orthogonalize(b.frame.forward, legUp);
  const sideRef = orthogonalize(b.frame.side, legUp);

  return {
    pitch: toDeg(Math.atan2(dot(b.frame.up, forwardRef), along)),
    tilt: toDeg(Math.atan2(dot(b.frame.up, sideRef), along)),
  };
}

/** Наклон вперёд (+) или прогиб назад (−) в сагиттальной плоскости. */
export const torsoPitch = (b: Body): number => torsoAngles(b).pitch;

/** Боковой наклон: положительное значение — в левую сторону человека. */
export const lateralTilt = (b: Body): number => torsoAngles(b).tilt;

/** Составляющая v, перпендикулярная axis. */
function orthogonalize(v: Vec3, axis: Vec3): Vec3 {
  return normalize(sub(v, scale(axis, dot(v, axis))));
}

/* ── Производные метрики ─────────────────────────────────────────────────── */

/** Высота таза относительно колен в долях корпуса: <0 — таз ниже колен. */
export function hipBelowKnee(b: Body): number {
  const knees = (height(b, 'left_knee') + height(b, 'right_knee')) / 2;
  return -knees; // высота таза равна нулю по определению системы координат
}

/** Расстояние между стопами в ширинах плеч. */
export const stanceWidth = (b: Body): number =>
  span(b, 'left_ankle', 'right_ankle') / (b.frame.shoulderWidth / b.frame.torso);

/** Сведение колен внутрь относительно стоп, в ширинах бёдер. Больше — хуже. */
export function kneeValgus(b: Body): number {
  const kneeSpan = Math.abs(lateral(b, 'left_knee') - lateral(b, 'right_knee'));
  const ankleSpan = Math.abs(lateral(b, 'left_ankle') - lateral(b, 'right_ankle'));
  const hipUnit = b.frame.hipWidth / b.frame.torso;
  return (ankleSpan - kneeSpan) / Math.max(hipUnit, 1e-3);
}

/** Высота кисти относительно носа в долях корпуса: >0 — кисть выше головы. */
export const handAboveHead = (b: Body, s: Side): number =>
  height(b, L(s, 'wrist')) - height(b, 'nose');

/** Высота кисти относительно плеча в долях корпуса. */
export const handAboveShoulder = (b: Body, s: Side): number =>
  height(b, L(s, 'wrist')) - height(b, L(s, 'shoulder'));

/** Высота колена относительно таза в долях корпуса: >0 — колено выше таза. */
export const kneeAboveHip = (b: Body, s: Side): number => height(b, L(s, 'knee'));

/* ── Форматирование чисел для подсказок ──────────────────────────────────── */

export const deg = (v: number): string => `${Math.round(v)}°`;
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const num = (v: number, decimals = 1): string => v.toFixed(decimals).replace('.', ',');

/* ── Фабрики правил ──────────────────────────────────────────────────────── */

export interface RomConfig {
  id?: string;
  title: string;
  /** Ключ отслеживаемой метрики (обязан быть в spec.tracked). */
  metric: string;
  /** 'below' — метрика должна опуститься ниже limit, 'above' — подняться выше. */
  need: 'below' | 'above';
  limit: number;
  /** Текст подсказки: получает фактическое значение и порог. */
  hint: (actual: number, limit: number) => string;
  highlight?: readonly LandmarkGroupName[];
  severity?: Severity;
  priority?: number;
  blocksRep?: boolean;
}

/**
 * Правило амплитуды. Проверяется по завершении повторения: во время движения
 * амплитуда закономерно мала, и покадровая проверка ругалась бы на каждый спуск.
 */
export function romRule(cfg: RomConfig): RepRule {
  return {
    id: cfg.id ?? `rom-${cfg.metric}`,
    title: cfg.title,
    severity: cfg.severity ?? 'error',
    priority: cfg.priority ?? 90,
    blocksRep: cfg.blocksRep ?? true,
    highlight: cfg.highlight,
    check(rep) {
      const ext = rep.extremes[cfg.metric];
      if (!ext) return null;
      const actual = cfg.need === 'below' ? ext.min : ext.max;
      const ok = cfg.need === 'below' ? actual <= cfg.limit : actual >= cfg.limit;
      if (ok) return null;
      return {
        hint: cfg.hint(actual, cfg.limit),
        value: actual,
        target: cfg.limit,
        highlight: cfg.highlight,
      };
    },
  };
}

export interface TempoConfig {
  /** Минимальное время от начала движения до максимальной амплитуды, мс. */
  minDescentMs?: number;
  /** Минимальная длительность всего повторения, мс. */
  minRepMs?: number;
  hint?: string;
  priority?: number;
}

/** Слишком быстрый темп: мышцы не работают, а зачёт формально проходит. */
export function tempoRule({
  minDescentMs = 450,
  minRepMs = 900,
  hint = 'Слишком быстро. Опускайся на два счёта и вставай на два — так работают мышцы, а не инерция.',
  priority = 40,
}: TempoConfig = {}): RepRule {
  return {
    id: 'tempo',
    title: 'Слишком быстрый темп',
    severity: 'warning',
    priority,
    blocksRep: false,
    check(rep) {
      if (rep.descentMs >= minDescentMs && rep.durationMs >= minRepMs) return null;
      return {
        hint,
        value: Math.round(rep.durationMs),
        target: minRepMs,
        unit: 'мс',
      };
    },
  };
}

export interface SymmetryConfig {
  id?: string;
  title: string;
  /** Метрики левой и правой стороны. */
  left: string;
  right: string;
  /** Допустимая разница. */
  maxDiff: number;
  unit?: string;
  /** side — сторона, которая работает МЕНЬШЕ. */
  hint: (side: Side, diff: number) => string;
  highlight?: readonly LandmarkGroupName[];
  /** true, если меньшее значение метрики означает большую работу (углы сгиба). */
  lowerIsMoreWork?: boolean;
  priority?: number;
}

/**
 * Асимметрия — ошибка, которую человек сам почти никогда не замечает: тело
 * компенсирует нагрузку сильной стороной. Проверяется в нижней точке, где
 * разница максимальна.
 */
export function symmetryRule(cfg: SymmetryConfig): LiveRule {
  return {
    id: cfg.id ?? 'asymmetry',
    title: cfg.title,
    severity: 'warning',
    priority: cfg.priority ?? 50,
    phases: ['bottom'],
    debounceMs: 320,
    highlight: cfg.highlight,
    check(ctx) {
      const l = ctx.m[cfg.left];
      const r = ctx.m[cfg.right];
      if (l === undefined || r === undefined) return null;
      const diff = Math.abs(l - r);
      if (diff <= cfg.maxDiff) return null;
      // Отстающая сторона — та, что работает меньше.
      const lagging: Side = cfg.lowerIsMoreWork ? (l > r ? 'left' : 'right') : l < r ? 'left' : 'right';
      return { hint: cfg.hint(lagging, diff), value: diff, unit: cfg.unit, target: cfg.maxDiff };
    },
  };
}

/**
 * Движение настолько мелкое, что автомат не фиксирует повторение. Без этого
 * правила пользователь, который «приседает» на 10 см, не получает вообще
 * никакой реакции — экран просто молчит.
 */
export function stallRule(hint: string): LiveRule {
  return {
    id: 'stall',
    title: 'Движение слишком мелкое',
    severity: 'error',
    priority: 95,
    phases: ['descent'],
    debounceMs: 1400,
    check(ctx) {
      if (ctx.peak >= 0.34) return null;
      return { hint, value: ctx.peak };
    },
  };
}

/** Точки пропали из кадра посреди упражнения. */
export function visibilityRule(
  required: readonly LandmarkName[],
  hint: string,
  highlight?: readonly LandmarkGroupName[],
): LiveRule {
  return {
    id: 'visibility',
    title: 'Часть тела вне кадра',
    severity: 'error',
    priority: 99,
    blocksRep: true,
    debounceMs: 420,
    highlight,
    check(ctx) {
      const observation = observe(ctx.body, required);
      const v = observation.confidence;
      if (observation.ok) return null;
      return { hint, value: v };
    },
  };
}

/** Наклон корпуса вперёд больше допустимого. */
export function forwardLeanRule(cfg: {
  max: number;
  hint: (actual: number) => string;
  phases?: LiveRule['phases'];
  priority?: number;
  severity?: Severity;
  highlight?: readonly LandmarkGroupName[];
}): LiveRule {
  return {
    id: 'forward-lean',
    title: 'Наклон корпуса вперёд',
    severity: cfg.severity ?? 'error',
    priority: cfg.priority ?? 70,
    phases: cfg.phases ?? ['descent', 'bottom', 'ascent'],
    highlight: cfg.highlight ?? ['torso'],
    check(ctx) {
      const lean = ctx.m['torsoPitch'];
      if (lean === undefined || lean <= cfg.max) return null;
      return { hint: cfg.hint(lean), value: lean, unit: '°', target: cfg.max };
    },
  };
}

/** Прогиб назад — типичная компенсация при жиме над головой. */
export function backArchRule(cfg: {
  max: number;
  hint: (actual: number) => string;
  priority?: number;
}): LiveRule {
  return {
    id: 'back-arch',
    title: 'Прогиб в спине',
    severity: 'error',
    priority: cfg.priority ?? 72,
    highlight: ['torso'],
    check(ctx) {
      const lean = ctx.m['torsoPitch'];
      if (lean === undefined) return null;
      const arch = -lean;
      if (arch <= cfg.max) return null;
      return { hint: cfg.hint(arch), value: arch, unit: '°', target: cfg.max };
    },
  };
}
