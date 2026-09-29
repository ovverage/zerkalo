/**
 * Автомат тренировки — от постановки камеры до итогов.
 *
 * Каждое упражнение проходит цикл: setup (проверка кадра) → countdown → running →
 * rest. Выход в running возможен только когда кадр действительно пригоден: это и
 * есть первая линия режима «ошибка» — большинство проблем распознавания
 * решаются до начала движения.
 */

import type { Body, LandmarkName } from '../vision/landmarks';
import type { FramingIssue } from '../vision/framing';
import { checkFraming, isBlocked } from '../vision/framing';
import type { WorkoutPlan, WorkoutStep } from '../exercises/registry';
import { requireExercise } from '../exercises/registry';

import type { CoachMessage } from './formAnalyzer';
import { FormAnalyzer } from './formAnalyzer';
import { HoldTracker } from './holdTracker';
import { RepCounter } from './repCounter';
import type { ExerciseSpec, FrameContext, RepRecord, ScoredViolation, Side } from './types';
import { CorrectionTracker } from './corrections';
import type { Correction } from './corrections';

export type SessionState = 'idle' | 'setup' | 'countdown' | 'running' | 'rest' | 'paused' | 'done';

const COUNTDOWN_MS = 3000;
/** Сколько кадр должен быть пригоден подряд, прежде чем начнётся отсчёт. */
const FRAMING_STABLE_MS = 600;
const TRACKING_GRACE_MS = 450;
/** Вес по умолчанию для оценки калорий, кг. */
const DEFAULT_WEIGHT_KG = 70;
/** Как часто повторять вслух «прими исходное положение». */
const POSITION_SPEAK_COOLDOWN_MS = 10_000;

export interface RepEvent {
  corrections: readonly Correction[];
  rec: RepRecord;
  /** Самое важное нарушение — его показываем и озвучиваем. */
  feedback: ScoredViolation | null;
}

export interface FrameOutcome {
  remainingSec?: number;
  state: SessionState;
  spec: ExerciseSpec | null;
  ctx: FrameContext | null;
  message: CoachMessage | null;
  highlight: Set<LandmarkName>;
  framing: readonly FramingIssue[];
  /** Сделано: повторений или зачтённых секунд. */
  done: number;
  target: number;
  /** Доля выполнения текущего упражнения, 0..1. */
  completion: number;
  repEvent: RepEvent | null;
  /** Осталось секунд: отдыха или отсчёта перед началом. */
  countdownSec: number;
  /** Текущее качество выполнения упражнения, 0..100. */
  quality: number;
  stepIndex: number;
  stepCount: number;
}

export interface Mistake {
  ruleId: string;
  title: string;
  count: number;
  hint: string;
}

export interface ExerciseResult {
  fixedErrors: number;
  exerciseId: string;
  name: string;
  icon: string;
  mode: 'reps' | 'hold';
  target: number;
  /** Зачтённые повторения или секунды. */
  done: number;
  /** Все попытки, включая незачтённые. */
  attempts: number;
  avgQuality: number;
  durationMs: number;
  mistakes: readonly Mistake[];
  /** Качество каждого повторения по порядку — для графика. */
  qualitySeries: readonly number[];
  kcal: number;
}

export interface SessionResult {
  fixedErrors: number;
  challenge: boolean;
  source?: 'camera' | 'simulation';
  workoutId: string;
  workoutName: string;
  startedAt: number;
  durationMs: number;
  exercises: readonly ExerciseResult[];
  totalReps: number;
  totalHoldSec: number;
  avgQuality: number;
  kcal: number;
  /** Итоговый балл: качество техники и полнота выполнения. */
  score: number;
  topMistakes: readonly Mistake[];
}

/** Состояние одного шага программы во время выполнения. */
interface ActiveStep {
  corrections: CorrectionTracker;
  step: WorkoutStep;
  spec: ExerciseSpec;
  counter: RepCounter;
  analyzer: FormAnalyzer;
  hold: HoldTracker;
  counted: number;
  attempts: number;
  qualities: number[];
  mistakes: Map<string, Mistake>;
  startedAt: number;
  lastSide: Side | null;
  framingOkSince: number | null;
  /** Когда последний раз озвучивали «прими исходное положение». */
  positionSpokeAt: number;
  missingSince: number | null;
  lastSampleId: number | null;
  lastGoodAt: number | null;
}

export class WorkoutSession {
  private state: SessionState = 'idle';
  private stepIndex = 0;
  private active: ActiveStep | null = null;
  private stateEnteredAt = 0;
  private startedAt = 0;
  private endedAt = 0;
  private results: ExerciseResult[] = [];
  private stateBeforePause: SessionState = 'setup';
  private lastOutcome: FrameOutcome | null = null;
  private activeMs = 0;
  private lastTickAt: number | null = null;

  constructor(
    readonly plan: WorkoutPlan,
    private readonly weightKg = DEFAULT_WEIGHT_KG,
  ) {}

  get currentState(): SessionState {
    return this.state;
  }

  get currentSpec(): ExerciseSpec | null {
    return this.active?.spec ?? null;
  }

  get isOver(): boolean {
    return this.state === 'done';
  }

  start(t: number): void {
    this.startedAt = t;
    this.stepIndex = 0;
    this.results = [];
    this.activeMs = 0;
    this.lastTickAt = t;
    this.openStep(t);
  }

  /** Главный вход: вызывается на каждом кадре видео. */
  update(body: Body | null, t: number, brightness: number | null): FrameOutcome {
    this.advanceClock(t);
    if (this.plan.durationSec && this.activeMs >= this.plan.durationSec * 1000 && this.state !== 'done') {
      this.finish(t);
      return this.emptyOutcome();
    }
    const cached = this.lastOutcome;
    if (body?.sampleId !== undefined && body.sampleId === this.active?.lastSampleId &&
        t - body.t <= 250 && this.state === 'running' && cached?.state === 'running') {
      return { ...cached, remainingSec: this.remainingSec(), repEvent: null, message: cached.message ? { ...cached.message, speak: false } : null };
    }
    const out = this.updateFrame(body, t, brightness);
    this.lastOutcome = out;
    return out;
  }

  private updateFrame(body: Body | null, t: number, brightness: number | null): FrameOutcome {
    const step = this.active;

    if (this.state === 'done' || !step) {
      return this.emptyOutcome();
    }

    if (this.state === 'paused') {
      return this.baseOutcome(step, null, null, new Set(), [], 0);
    }

    if (this.state === 'rest') {
      const left = Math.max(0, this.plan.restSec * 1000 - (t - this.stateEnteredAt));
      if (left <= 0) this.openStep(t);
      return this.baseOutcome(step, null, null, new Set(), [], Math.ceil(left / 1000));
    }

    // A cached inference can be drawn again, but never used as a new sample.
    if (body?.sampleId !== undefined && t - body.t > 300) body = null;
    const fresh = body?.sampleId === undefined || body.sampleId !== step.lastSampleId;
    const framing = [
      ...checkFraming(body, { view: step.spec.view, required: step.spec.required, tracking: step.spec.tracking }, brightness),
      ...this.positionIssue(step, body),
    ];

    if (this.state === 'setup') {
      if (isBlocked(framing) || !body) {
        step.framingOkSince = null;
      } else if (step.framingOkSince === null) {
        step.framingOkSince = t;
      }
      const stable = step.framingOkSince !== null && t - step.framingOkSince >= FRAMING_STABLE_MS;
      if (stable) this.setState('countdown', t);
      return this.baseOutcome(step, null, null, new Set(), framing, 0);
    }

    if (this.state === 'countdown') {
      if (isBlocked(framing)) {
        step.missingSince ??= t;
        if (t - step.missingSince > TRACKING_GRACE_MS) {
          step.framingOkSince = null;
          this.setState('setup', t);
        }
        return this.baseOutcome(step, null, null, new Set(), framing, Math.ceil(Math.max(0, COUNTDOWN_MS - (t - this.stateEnteredAt)) / 1000));
      }
      step.missingSince = null;
      const left = Math.max(0, COUNTDOWN_MS - (t - this.stateEnteredAt));
      if (left <= 0) {
        this.setState('running', t);
        step.startedAt = t;
      }
      return this.baseOutcome(step, null, null, new Set(), framing, Math.ceil(left / 1000));
    }

    // Missing/occluded joints suspend measurement immediately. A short gap
    // preserves the current rep; a long gap or pause cannot join unrelated poses.
    if (!body || isBlocked(framing)) {
      step.missingSince ??= t;
      step.lastGoodAt = null;
      step.analyzer.reset();
      if (t - step.missingSince > TRACKING_GRACE_MS) step.counter.abort();
      const issue = framing.find((f) => f.severity === 'block');
      const message = issue ? this.trackingMessage(step, issue, t) : null;
      return this.baseOutcome(step, null, message, new Set(), framing, 0);
    }
    if (!fresh) return this.baseOutcome(step, null, null, new Set(), framing, 0);
    if (step.missingSince !== null && t - step.missingSince > TRACKING_GRACE_MS) step.counter.abort();
    step.missingSince = null;
    step.lastSampleId = body.sampleId ?? null;
    const dt = step.lastGoodAt === null ? 0 : Math.min((t - step.lastGoodAt) / 1000, body.dt, 0.15);
    step.lastGoodAt = t;

    const m = step.spec.metrics(body);
    const { ctx, completed, inPosition } = step.counter.tick(body, m, t, dt);
    if (!inPosition) {
      return this.baseOutcome(step, ctx, this.positionMessage(step, t), new Set(), framing, 0);
    }

    const verdict = step.analyzer.evaluate(ctx);
    step.counter.noteViolations(verdict.activeIds);

    let repEvent: RepEvent | null = null;

    if (step.spec.mode === 'hold') {
      step.hold.tick(!verdict.blocked, inPosition, ctx.dt * 1000, t);
      step.counted = step.hold.seconds;
      for (const id of verdict.activeIds) this.noteMistake(step, id, verdict);
    } else if (completed) {
      const rec = step.analyzer.gradeRep(completed);
      const withSide = this.applyAlternation(step, rec);
      step.attempts += 1;
      step.qualities.push(withSide.quality);
      if (withSide.counted) step.counted += 1;
      for (const v of withSide.violations) this.recordMistake(step, v);
      repEvent = { rec: withSide, feedback: step.analyzer.repFeedback(withSide), corrections: step.corrections.observe(withSide) };
    }

    if (step.counted >= step.step.target) {
      this.closeStep(t);
    }

    return {
      ...this.baseOutcome(step, ctx, verdict.message, verdict.highlight, framing, 0),
      repEvent,
    };
  }

  pause(t: number): void {
    if (this.state === 'paused' || this.state === 'done') return;
    this.advanceClock(t);
    if (this.plan.durationSec && this.activeMs >= this.plan.durationSec * 1000) {
      this.finish(t);
      return;
    }
    this.stateBeforePause = this.state;
    this.active?.counter.abort();
    this.active?.analyzer.reset();
    if (this.active) this.active.lastGoodAt = null;
    this.setState('paused', t);
  }

  resume(t: number): void {
    if (this.state !== 'paused') return;
    this.lastTickAt = t;
    // После паузы возвращаемся к проверке кадра: человек мог отойти.
    this.setState(this.stateBeforePause === 'running' ? 'setup' : this.stateBeforePause, t);
    if (this.active) this.active.framingOkSince = null;
  }

  togglePause(t: number): void {
    if (this.state === 'paused') this.resume(t);
    else this.pause(t);
  }

  /** Пропустить текущее упражнение — результат сохраняется как есть. */
  skip(t: number): void {
    if (!this.active || this.state === 'done') return;
    this.closeStep(t);
  }

  finish(t: number): SessionResult {
    this.advanceClock(t);
    if (this.active && this.state !== 'done') this.closeStep(t, true);
    this.endedAt = t;
    return this.buildResult();
  }

  result(): SessionResult {
    return this.buildResult();
  }

  /* ── Внутреннее ─────────────────────────────────────────────────────────── */

  /** Часы не зависят от FPS; скрытие вкладки останавливает сессию явно. */
  private advanceClock(t: number): void {
    if (this.state === 'running' && this.lastTickAt !== null) {
      this.activeMs += Math.max(0, t - this.lastTickAt);
    }
    this.lastTickAt = Math.max(t, this.lastTickAt ?? t);
  }

  private openStep(t: number): void {
    const step = this.plan.steps[this.stepIndex];
    if (!step) {
      this.setState('done', t);
      this.endedAt = t;
      this.active = null;
      return;
    }
    const spec = requireExercise(step.exerciseId);
    this.active = {
      step,
      spec,
      corrections: new CorrectionTracker(),
      counter: new RepCounter(spec),
      analyzer: new FormAnalyzer(spec),
      hold: new HoldTracker(),
      counted: 0,
      attempts: 0,
      qualities: [],
      mistakes: new Map(),
      startedAt: t,
      lastSide: null,
      framingOkSince: null,
      positionSpokeAt: -Infinity,
      missingSince: null,
      lastSampleId: null,
      lastGoodAt: null,
    };
    this.setState('setup', t);
  }

  private closeStep(t: number, final = false): void {
    const step = this.active;
    if (!step) return;

    const durationMs = Math.max(t - step.startedAt, 0);
    const isHold = step.spec.mode === 'hold';
    const avgQuality = isHold
      ? step.hold.quality
      : step.qualities.length
        ? Math.round(step.qualities.reduce((a, b) => a + b, 0) / step.qualities.length)
        : 0;

    this.results.push({
      fixedErrors: step.corrections.count,
      exerciseId: step.spec.id,
      name: step.spec.name,
      icon: step.spec.icon,
      mode: step.spec.mode,
      target: step.step.target,
      done: isHold ? Math.round(step.hold.seconds) : step.counted,
      attempts: isHold ? 0 : step.attempts,
      avgQuality,
      durationMs,
      mistakes: [...step.mistakes.values()].sort((a, b) => b.count - a.count),
      qualitySeries: [...step.qualities],
      kcal: this.kcalFor(step.spec.mets, durationMs),
    });

    this.stepIndex += 1;

    if (final || this.stepIndex >= this.plan.steps.length) {
      this.setState('done', t);
      this.endedAt = t;
      this.active = null;
      return;
    }

    if (this.plan.restSec > 0) {
      // Отдых показывается на фоне уже следующего упражнения, поэтому шаг
      // открываем сразу, но переводим состояние в rest.
      this.openStep(t);
      this.setState('rest', t);
    } else {
      this.openStep(t);
    }
  }

  /**
   * Пока исходная поза не принята, это блокирующая проблема кадра: отсчёт не
   * начнётся, а на экране подготовки появится та же подсказка, что и остальные
   * проверки.
   */
  private positionIssue(step: ActiveStep, body: Body | null): FramingIssue[] {
    if (!body || !step.spec.inPosition || !step.spec.positionHint) return [];
    const ok = step.spec.inPosition(step.spec.metrics(body));
    if (ok) return [];
    return [{ code: 'position', hint: step.spec.positionHint, severity: 'block' }];
  }

  private trackingMessage(step: ActiveStep, issue: FramingIssue, t: number): CoachMessage {
    const speak = t - step.positionSpokeAt >= POSITION_SPEAK_COOLDOWN_MS;
    if (speak) step.positionSpokeAt = t;
    return {
      ruleId: `tracking-${issue.code}`,
      title: 'Восстанавливаю отслеживание',
      severity: 'warning',
      hint: issue.hint,
      speak,
    };
  }

  /** Подсказка про исходное положение с собственным кулдауном на озвучку. */
  private positionMessage(step: ActiveStep, t: number): CoachMessage | null {
    const hint = step.spec.positionHint;
    if (!hint) return null;
    const speak = t - step.positionSpokeAt >= POSITION_SPEAK_COOLDOWN_MS;
    if (speak) step.positionSpokeAt = t;
    return {
      ruleId: 'not-in-position',
      title: 'Исходное положение не принято',
      severity: 'error',
      hint,
      speak,
    };
  }

  /**
   * Попеременные упражнения: два повторения подряд на одну сторону — ошибка,
   * которую нельзя увидеть в пределах одного повторения.
   */
  private applyAlternation(step: ActiveStep, rec: RepRecord): RepRecord {
    if (!step.spec.alternating || !rec.side) return rec;

    const repeated = step.lastSide !== null && step.lastSide === rec.side;
    step.lastSide = rec.side;
    if (!repeated) return rec;

    const violation: ScoredViolation = {
      ruleId: 'same-side-twice',
      title: 'Две стороны подряд',
      severity: 'warning',
      hint: `Два повторения подряд на ${rec.side === 'left' ? 'левую' : 'правую'} сторону — чередуй стороны.`,
      blocksRep: false,
    };

    return {
      ...rec,
      violations: [...rec.violations, violation],
      quality: Math.max(0, rec.quality - 9),
    };
  }

  private recordMistake(step: ActiveStep, v: ScoredViolation): void {
    const cur = step.mistakes.get(v.ruleId);
    if (cur) cur.count += 1;
    else step.mistakes.set(v.ruleId, { ruleId: v.ruleId, title: v.title, count: 1, hint: v.hint });
  }

  /** Для режима удержания ошибки копятся по факту активных правил. */
  private noteMistake(step: ActiveStep, ruleId: string, verdict: { message: CoachMessage | null }): void {
    const rule = step.spec.liveRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const cur = step.mistakes.get(ruleId);
    if (cur) return; // в удержании считаем факт, а не число кадров
    step.mistakes.set(ruleId, {
      ruleId,
      title: rule.title,
      count: 1,
      hint: verdict.message?.ruleId === ruleId ? verdict.message.hint : rule.title,
    });
  }

  private kcalFor(mets: number, durationMs: number): number {
    const minutes = durationMs / 60_000;
    return Math.round(((mets * 3.5 * this.weightKg) / 200) * minutes * 10) / 10;
  }

  private setState(state: SessionState, t: number): void {
    this.state = state;
    this.stateEnteredAt = t;
  }

  private baseOutcome(
    step: ActiveStep,
    ctx: FrameContext | null,
    message: CoachMessage | null,
    highlight: Set<LandmarkName>,
    framing: readonly FramingIssue[],
    countdownSec: number,
  ): FrameOutcome {
    const isHold = step.spec.mode === 'hold';
    const done = isHold ? step.hold.seconds : step.counted;
    const quality = isHold
      ? step.hold.quality
      : step.qualities.length
        ? Math.round(step.qualities.reduce((a, b) => a + b, 0) / step.qualities.length)
        : 100;

    return {
      state: this.state,
      remainingSec: this.remainingSec(),
      spec: step.spec,
      ctx,
      message,
      highlight,
      framing,
      done,
      target: step.step.target,
      completion: Math.min(done / Math.max(step.step.target, 1), 1),
      repEvent: null,
      countdownSec,
      quality,
      stepIndex: this.stepIndex,
      stepCount: this.plan.steps.length,
    };
  }

  private emptyOutcome(): FrameOutcome {
    return {
      state: this.state,
      spec: null,
      ctx: null,
      message: null,
      highlight: new Set(),
      framing: [],
      done: 0,
      target: 0,
      completion: 1,
      repEvent: null,
      countdownSec: 0,
      quality: 0,
      stepIndex: this.stepIndex,
      stepCount: this.plan.steps.length,
    };
  }

  private buildResult(): SessionResult {
    const totalReps = this.results
      .filter((r) => r.mode === 'reps')
      .reduce((a, r) => a + r.done, 0);
    const totalHoldSec = this.results
      .filter((r) => r.mode === 'hold')
      .reduce((a, r) => a + r.done, 0);

    const graded = this.results.filter((r) => r.attempts > 0 || r.done > 0);
    const avgQuality = graded.length
      ? Math.round(graded.reduce((a, r) => a + r.avgQuality, 0) / graded.length)
      : 0;

    const completion = this.plan.durationSec ? (totalReps > 0 ? Math.min(this.activeMs / (this.plan.durationSec * 1000), 1) : 0) : this.results.length
      ? this.results.reduce((a, r) => a + Math.min(r.done / Math.max(r.target, 1), 1), 0) /
        this.results.length
      : 0;

    const merged = new Map<string, Mistake>();
    for (const r of this.results) {
      for (const mistake of r.mistakes) {
        const cur = merged.get(mistake.ruleId);
        if (cur) cur.count += mistake.count;
        else merged.set(mistake.ruleId, { ...mistake });
      }
    }

    return {
      fixedErrors: this.results.reduce((sum, result) => sum + result.fixedErrors, 0),
      challenge: !!this.plan.durationSec,
      workoutId: this.plan.id,
      workoutName: this.plan.name,
      startedAt: this.startedAt,
      durationMs: Math.max((this.endedAt || this.startedAt) - this.startedAt, 0),
      exercises: this.results,
      totalReps,
      totalHoldSec: Math.round(totalHoldSec),
      avgQuality,
      kcal: Math.round(this.results.reduce((a, r) => a + r.kcal, 0) * 10) / 10,
      score: Math.round(0.6 * avgQuality + 0.4 * completion * 100),
      topMistakes: [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 3),
    };
  }

  private remainingSec(): number | undefined {
    return this.plan.durationSec ? Math.max(0, Math.ceil(this.plan.durationSec - this.activeMs / 1000)) : undefined;
  }
}
