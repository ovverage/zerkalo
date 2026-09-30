/**
 * Контракты движка.
 *
 * Упражнение — это данные, а не код в общем цикле: набор метрик, функция
 * прогресса и список правил. Счётчик повторений и анализатор ошибок ничего не
 * знают про конкретные упражнения, поэтому новое упражнение добавляется одним
 * файлом в src/exercises и строкой в реестре.
 */

import type { Body, LandmarkGroupName, LandmarkName } from '../vision/landmarks';

export type Metrics = Readonly<Record<string, number>>;

/** Фазы повторения. Для режима удержания используется только 'hold'. */
export type Phase = 'idle' | 'top' | 'descent' | 'bottom' | 'ascent' | 'hold';

export type Severity = 'error' | 'warning';

export type Side = 'left' | 'right';

/** Нарушение техники с готовой подсказкой. */
export interface Violation {
  /** Конкретное указание, что сделать. Не «ошибка», а действие. */
  hint: string;
  /** Измеренное значение — попадает в HUD рядом с подсказкой. */
  value?: number;
  unit?: string;
  /** Целевое значение, чтобы показать «сейчас / нужно». */
  target?: number;
  highlight?: readonly LandmarkGroupName[];
}

/** Состояние кадра, которое видят метрики и правила. */
export interface FrameContext {
  body: Body;
  m: Metrics;
  /** 0 — исходное положение, 1 — конец амплитуды. */
  progress: number;
  phase: Phase;
  /** Сколько мс длится текущая фаза. */
  phaseMs: number;
  /** Максимум progress с начала текущего повторения. */
  peak: number;
  /** Скорость изменения progress, единиц в секунду. */
  velocity: number;
  /** Активная сторона для попеременных упражнений. */
  side: Side | null;
  t: number;
  dt: number;
}

/**
 * Правило, проверяемое каждый кадр: осанка, выравнивание, симметрия.
 * Возвращает null, если всё в порядке.
 */
export interface LiveRule {
  id: string;
  /** Короткий ярлык для таблицы итогов: «Колени внутрь». */
  title: string;
  severity: Severity;
  /** При нескольких нарушениях показывается одно — с наибольшим приоритетом. */
  priority: number;
  /** В каких фазах правило имеет смысл. По умолчанию — во всех. */
  phases?: readonly Phase[];
  /** Пока нарушено — повторение не будет засчитано. */
  blocksRep?: boolean;
  /** Сколько мс нарушение должно держаться, прежде чем мы о нём скажем. */
  debounceMs?: number;
  highlight?: readonly LandmarkGroupName[];
  check(ctx: FrameContext): Violation | null;
}

/**
 * Правило, проверяемое один раз по завершении повторения: амплитуда и темп.
 * Проверять их покадрово бессмысленно — в начале движения амплитуда всегда мала.
 */
export interface RepRule {
  id: string;
  title: string;
  severity: Severity;
  priority: number;
  /** Нарушение означает, что повторение не зачтено. */
  blocksRep?: boolean;
  highlight?: readonly LandmarkGroupName[];
  check(rep: RepDraft): Violation | null;
}

export interface MetricExtent {
  min: number;
  max: number;
}

/** Накопленные данные одного повторения на момент его завершения. */
export interface RepDraft {
  /** Метрики возврата; старый экстремум из подготовки не заменяет завершение. */
  endMetrics: Metrics;
  index: number;
  side: Side | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Время от начала движения до максимальной амплитуды. */
  descentMs: number;
  peak: number;
  /** min/max отслеживаемых метрик за повторение. */
  extremes: Readonly<Record<string, MetricExtent>>;
  /** Идентификаторы покадровых правил, нарушенных в ходе повторения. */
  liveViolations: readonly string[];
}

/** Итог повторения после применения правил и подсчёта качества. */
export interface RepRecord extends RepDraft {
  counted: boolean;
  quality: number;
  violations: readonly ScoredViolation[];
}

export interface ScoredViolation extends Violation {
  ruleId: string;
  title: string;
  severity: Severity;
  hint: string;
  blocksRep: boolean;
}

export interface RepThresholds {
  /** Ниже этого значения поза считается исходной. */
  reset: number;
  /** Выше этого значения фиксируется попытка повторения. */
  attempt: number;
  /** Ориентир полной амплитуды для индикатора прогресса. */
  valid: number;
}

export const DEFAULT_THRESHOLDS: RepThresholds = { reset: 0.16, attempt: 0.5, valid: 0.85 };

export type MuscleGroup = 'legs' | 'upper' | 'core' | 'cardio';

export interface ExerciseSpec {
  id: string;
  name: string;
  /** Компактное имя для HUD. */
  short: string;
  icon: string;
  group: MuscleGroup;
  mode: 'reps' | 'hold';
  /** Как должна стоять камера. */
  view: 'front' | 'side';
  /** Считать стороны отдельно (выпады, подъём колен). */
  alternating?: boolean;
  /** Одной строкой: что сделать с камерой и собой перед началом. */
  setup: string;
  howTo: readonly string[];
  /** Точки, без которых упражнение не анализируется. */
  required: readonly LandmarkName[];
  tracking?: import('../vision/tracking').TrackingMode;
  /** Повторений (mode='reps') или секунд (mode='hold'). */
  defaultTarget: number;
  /** MET для оценки калорий. */
  mets: number;
  thresholds?: Partial<RepThresholds>;
  /** Calibrate the resting angle without relaxing the depth requirement. */
  restCalibration?: { metric: string; min: number; ideal: number; bottom: number };
  /** Метрики кадра. Ключи используются правилами и HUD. */
  metrics(body: Body): Metrics;
  /** Нормированная амплитуда 0..1. */
  progress(m: Metrics): number;
  activeSide?(m: Metrics): Side | null;
  /** Метрики, чьи экстремумы нужны правилам амплитуды и итогам. */
  tracked?: readonly string[];
  /** Что показать в HUD крупной цифрой. */
  hud?: { metric: string; label: string; unit: string; decimals?: number };
  liveRules: readonly LiveRule[];
  repRules?: readonly RepRule[];
  /**
   * Принята ли исходная поза упражнения (упор лёжа, планка и т. п.).
   *
   * Проверяется до счётчика и до подсчёта повторений: без этого стоящий человек,
   * шевелящий руками, даёт колебания угла в локте по всей амплитуде — и движок
   * честно отсчитывает «отжимания», которых не было.
   *
   * Получает метрики, а не контекст кадра: контекст создаётся внутри счётчика,
   * а решение нужно принять раньше.
   */
  inPosition?(m: Metrics): boolean;

  /** Что сказать, пока поза не принята. Обязателен вместе с inPosition. */
  positionHint?: string;
}

export function thresholdsOf(spec: ExerciseSpec): RepThresholds {
  return { ...DEFAULT_THRESHOLDS, ...spec.thresholds };
}
