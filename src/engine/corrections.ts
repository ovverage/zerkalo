import type { RepRecord, ExerciseSpec } from './types';

const CONFIRMATIONS: Readonly<Record<string, string>> = {
  'squat-depth': 'Теперь достаточно глубоко — повтор засчитан',
  'press-lockout': 'Оба локтя выпрямлены — повтор засчитан',
  'press-overhead': 'Кисти выше головы — повтор засчитан',
  'press-bottom': 'Руки вернулись к плечам — повтор засчитан',
  'jack-arms': 'Руки подняты полностью — повтор засчитан',
  'jack-stance': 'Стопы разведены достаточно — повтор засчитан',
  'jack-together': 'Руки и ноги сработали вместе — повтор засчитан',
};

const EVIDENCE: Record<string, { title: string; metric?: string; end?: readonly string[] }> = {
  'squat-depth': { title: 'Глубина приседа', metric: 'kneeMean' },
  'press-lockout': { title: 'Разгибание обоих локтей', metric: 'elbowMin' },
  'press-overhead': { title: 'Кисти выше головы', metric: 'wristHead' },
  'press-bottom': { title: 'Возврат локтей к плечам', end: ['elbowL', 'elbowR'] },
  'jack-arms': { title: 'Подъём рук в джампах', metric: 'armElev' },
  'jack-stance': { title: 'Ширина прыжка', metric: 'stance' },
  'jack-together': { title: 'Синхронность рук и ног', metric: 'together' },
};
export interface Correction { ruleId: string; title: string; message: string }

/** Подтверждаем только измеримые правила завершённого повтора.
 * Исчезновение подсказки или потеря позы сами по себе не означают исправления. */
export class CorrectionTracker {
  private pending = new Set<string>();
  private fixed = new Map<string, Correction>();
  constructor(private readonly spec: ExerciseSpec) {}
  get confirmed(): Correction[] { return [...this.fixed.values()]; }
  get count(): number { return this.fixed.size; }

  observe(rep: RepRecord): Correction[] {
    const violations = new Set(rep.violations.map(v => v.ruleId));
    for (const id of violations) if (CONFIRMATIONS[id]) this.pending.add(id);
    if (!rep.counted) return [];
    const corrections: Correction[] = [];
    for (const id of this.pending) {
      if (violations.has(id)) continue;
      const rule = this.spec.repRules?.find(rule => rule.id === id);
      const evidence = EVIDENCE[id]!;
      const values = evidence.metric ? Object.values(rep.extremes[evidence.metric] ?? {})
        : evidence.end!.map(metric => rep.endMetrics[metric]);
      // A missing measurement or a rule from a different exercise is not a pass.
      if (!rule || values.length < 2 || !values.every(Number.isFinite) || rule.check(rep) !== null) continue;
      const correction = { ruleId: id, title: evidence.title, message: CONFIRMATIONS[id]! };
      corrections.push(correction);
      this.pending.delete(id);
      this.fixed.set(id, correction);
    }
    return corrections;
  }
}
