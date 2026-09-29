import type { RepRecord } from './types';

const CONFIRMATIONS: Readonly<Record<string, string>> = {
  'squat-depth': 'Теперь достаточно глубоко — повтор засчитан',
  'press-lockout': 'Оба локтя выпрямлены — повтор засчитан',
  'press-overhead': 'Кисти выше головы — повтор засчитан',
  'press-bottom': 'Руки вернулись к плечам — повтор засчитан',
  'jack-arms': 'Руки подняты полностью — повтор засчитан',
  'jack-stance': 'Стопы разведены достаточно — повтор засчитан',
  'jack-together': 'Руки и ноги сработали вместе — повтор засчитан',
};

export interface Correction { ruleId: string; message: string }

/** Подтверждаем только измеримые правила завершённого повтора.
 * Исчезновение подсказки или потеря позы сами по себе не означают исправления. */
export class CorrectionTracker {
  private pending = new Set<string>();
  private fixed = new Set<string>();
  get count(): number { return this.fixed.size; }

  observe(rep: RepRecord): Correction[] {
    const violations = new Set(rep.violations.map(v => v.ruleId));
    for (const id of violations) if (CONFIRMATIONS[id]) this.pending.add(id);
    if (!rep.counted) return [];
    const corrections: Correction[] = [];
    for (const id of this.pending) {
      if (violations.has(id)) continue;
      corrections.push({ ruleId: id, message: CONFIRMATIONS[id]! });
      this.pending.delete(id);
      this.fixed.add(id);
    }
    return corrections;
  }
}
