/**
 * Счётчик повторений — автомат с гистерезисом.
 *
 * Почему не «угол меньше порога → +1»: на границе порога сглаженный сигнал всё
 * равно пересекает её несколько раз, и один присед превращается в три. Здесь
 * вход в движение и возврат в исходное положение — разные пороги (attempt и
 * reset), между ними автомат переключиться не может, поэтому дребезг физически
 * невозможен.
 *
 * Второй принципиальный момент: попытка повторения фиксируется на низком пороге
 * (attempt ≈ 0.38 амплитуды), а зачёт повторения решают правила. Неглубокий
 * присед поэтому не проваливается в тишину — он попадает в статистику как
 * незачтённая попытка с конкретной подсказкой.
 */

import type { Body } from '../vision/landmarks';
import type {
  ExerciseSpec,
  FrameContext,
  MetricExtent,
  Metrics,
  Phase,
  RepDraft,
  Side,
} from './types';
import { observe } from '../vision/tracking';
import { thresholdsOf } from './types';

export interface Tick {
  ctx: FrameContext;
  /** Повторение, завершившееся именно на этом кадре. */
  completed: RepDraft | null;
  /** Принята ли исходная поза упражнения. Пока нет — автомат не двигается. */
  inPosition: boolean;
}

/** Насколько progress должен превысить reset, чтобы считать движение начатым. */
const START_MARGIN = 0.06;
/** Обратный ход от attempt, после которого фиксируется подъём. */
const ASCENT_MARGIN = 0.08;

export class RepCounter {
  private restAngle: number | null = null;
  private phase: Phase = 'idle';
  private phaseAt = 0;
  private prevProgress = 0;
  private velocity = 0;

  /** Экстремумы метрик за паузу между повторениями — см. пояснение в tick(). */
  private topExtremes: Record<string, MetricExtent> = {};
  private active = false;
  private repIndex = 0;
  private repStartedAt = 0;
  private peak = 0;
  private peakAt = 0;
  private sideAtPeak: Side | null = null;
  private extremes: Record<string, MetricExtent> = {};
  private liveViolations = new Set<string>();

  constructor(private readonly spec: ExerciseSpec) {}

  get attempts(): number {
    return this.repIndex;
  }

  tick(body: Body, m: Metrics, t: number, dt: number): Tick {
    const thr = thresholdsOf(this.spec);
    let progress = clamp01(this.spec.progress(m));
    const side = this.spec.activeSide?.(m) ?? null;

    // Ворота стоят здесь, а не у вызывающего кода, чтобы их нельзя было обойти.
    // Без них стоящий человек, шевелящий руками, даёт колебания угла в локте по
    // всей амплитуде — и автомат отсчитывает «отжимания», которых не было.
    if (!observe(body, this.spec.required, this.spec.tracking).ok ||
        (this.spec.inPosition && !this.spec.inPosition(m))) {
      this.abort();
      return {
        ctx: this.contextOf(body, m, 0, side, t, dt),
        completed: null,
        inPosition: false,
      };
    }

    const calibration = this.spec.restCalibration;
    if (calibration) {
      const angle = m[calibration.metric] ?? calibration.ideal;
      if ((this.phase === 'idle' || this.phase === 'top') && angle >= calibration.min) {
        this.restAngle = Math.min(calibration.ideal, Math.max(this.restAngle ?? angle, angle));
      }
      if (this.restAngle !== null) {
        progress = clamp01((this.restAngle - angle) / (this.restAngle - calibration.bottom));
      }
    }

    const instant = dt > 1e-4 ? (progress - this.prevProgress) / dt : 0;
    this.velocity = this.velocity * 0.7 + instant * 0.3;
    this.prevProgress = progress;

    if (this.active) {
      this.trackInto(this.extremes, m);
      if (progress > this.peak) {
        this.peak = progress;
        this.peakAt = t;
        this.sideAtPeak = side;
      }
    }

    // Исходное положение копим отдельно и за всю паузу между повторениями.
    // Повторение начинается уже ПОСЛЕ выхода из исходного положения, поэтому
    // правило «не выпрямил ноги в верхней точке» иначе проверяло бы данные, в
    // которые сама верхняя точка не попала. Одного снимка тут мало: последний
    // кадр фазы top — это уже кадр, которым движение началось.
    if (this.phase === 'top' || this.phase === 'idle') this.trackInto(this.topExtremes, m);

    let completed: RepDraft | null = null;

    switch (this.phase) {
      case 'idle':
        if (progress < thr.reset) this.setPhase('top', t);
        break;

      case 'top':
        if (progress > thr.reset + START_MARGIN) {
          this.beginRep(t, m);
          this.peak = progress;
          this.sideAtPeak = side;
          this.setPhase(progress >= thr.attempt ? 'bottom' : 'descent', t);
        }
        break;

      case 'descent':
        if (progress >= thr.attempt) this.setPhase('bottom', t);
        else if (progress < thr.reset) {
          // Дрожание или неуверенное начало — повторение не начиналось.
          this.discardRep();
          this.setPhase('top', t);
        }
        break;

      case 'bottom':
        if (progress <= thr.reset) {
          completed = this.endRep(t);
          this.setPhase('top', t);
        } else if (progress < thr.attempt - ASCENT_MARGIN) this.setPhase('ascent', t);
        break;

      case 'ascent':
        if (progress >= thr.attempt) {
          this.setPhase('bottom', t); // «доработка» на подъёме — то же повторение
        } else if (progress <= thr.reset) {
          completed = this.endRep(t);
          this.setPhase('top', t);
        }
        break;

      case 'hold':
        break;
    }

    return {
      ctx: this.contextOf(body, m, progress, side, t, dt),
      completed,
      inPosition: true,
    };
  }

  private contextOf(
    body: Body,
    m: Metrics,
    progress: number,
    side: Side | null,
    t: number,
    dt: number,
  ): FrameContext {
    return {
      body,
      m,
      progress,
      phase: this.phase,
      phaseMs: t - this.phaseAt,
      peak: this.active ? this.peak : 0,
      velocity: this.velocity,
      side,
      t,
      dt,
    };
  }

  /** Анализатор сообщает, какие покадровые правила нарушены в этом кадре. */
  noteViolations(ids: readonly string[]): void {
    if (!this.active) return;
    for (const id of ids) this.liveViolations.add(id);
  }

  /**
   * Прервать текущее повторение, не трогая счёт попыток. Нужен, когда движок
   * перестал получать кадры упражнения — например, человек вышел из исходного
   * положения: незавершённое повторение надо выбросить, а счёт сохранить.
   */
  abort(): void {
    this.restAngle = null;
    this.phase = 'idle';
    this.prevProgress = 0;
    this.velocity = 0;
    this.topExtremes = {};
    this.discardRep();
  }

  reset(): void {
    this.restAngle = null;
    this.phase = 'idle';
    this.phaseAt = 0;
    this.prevProgress = 0;
    this.velocity = 0;
    this.topExtremes = {};
    this.discardRep();
    this.repIndex = 0;
  }

  private setPhase(phase: Phase, t: number): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.phaseAt = t;
  }

  private beginRep(t: number, m: Metrics): void {
    this.active = true;
    this.repStartedAt = t;
    this.peak = 0;
    this.peakAt = t;
    this.sideAtPeak = null;
    this.liveViolations = new Set();
    // Повторение наследует диапазон исходного положения и начинает копить свой.
    this.extremes = this.topExtremes;
    this.topExtremes = {};
    this.trackInto(this.extremes, m);
  }

  private discardRep(): void {
    this.active = false;
    this.peak = 0;
    this.extremes = {};
    this.liveViolations = new Set();
  }

  private endRep(t: number): RepDraft | null {
    if (!this.active) return null;
    if (t - this.repStartedAt < 180) {
      this.discardRep();
      return null;
    }
    this.repIndex += 1;
    const draft: RepDraft = {
      index: this.repIndex,
      side: this.sideAtPeak,
      startedAt: this.repStartedAt,
      endedAt: t,
      durationMs: t - this.repStartedAt,
      descentMs: Math.max(this.peakAt - this.repStartedAt, 0),
      peak: this.peak,
      extremes: this.extremes,
      liveViolations: [...this.liveViolations],
    };
    this.active = false;
    return draft;
  }

  private trackInto(target: Record<string, MetricExtent>, m: Metrics): void {
    const keys = this.spec.tracked;
    if (!keys) return;
    for (const key of keys) {
      const v = m[key];
      if (v === undefined || !Number.isFinite(v)) continue;
      const cur = target[key];
      if (!cur) target[key] = { min: v, max: v };
      else {
        if (v < cur.min) cur.min = v;
        if (v > cur.max) cur.max = v;
      }
    }
  }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
