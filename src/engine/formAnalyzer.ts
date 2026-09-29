/**
 * Анализатор техники — режим «ошибка».
 *
 * Три проблемы, которые он решает помимо самой проверки правил:
 *
 * 1. Дребезг. Правило, нарушенное на одном кадре, — это чаще всего шум модели,
 *    а не ошибка человека. Подсказка появляется только если нарушение держится
 *    debounceMs (по умолчанию 260 мс).
 * 2. Спам. Одновременно могут нарушаться три правила. Показываем одну подсказку
 *    — с наибольшим приоритетом, — но подсвечиваем красным все проблемные части
 *    тела: читать одно, видеть всё.
 * 3. Повторы. Одна и та же фраза, произнесённая пять раз за десять секунд,
 *    бесполезна. У каждого правила свой кулдаун на озвучку.
 */

import type { LandmarkName } from '../vision/landmarks';
import { expandGroups } from '../vision/landmarks';
import type {
  ExerciseSpec,
  FrameContext,
  LiveRule,
  RepDraft,
  RepRecord,
  ScoredViolation,
  Severity,
  Violation,
} from './types';

const DEFAULT_DEBOUNCE_MS = 260;
const SPEAK_COOLDOWN_MS = 10_000;

const PENALTY: Record<Severity, number> = { error: 20, warning: 9 };

export interface CoachMessage {
  ruleId: string;
  title: string;
  severity: Severity;
  hint: string;
  value?: number;
  unit?: string;
  target?: number;
  /** Подсказку нужно озвучить: кулдаун этого правила истёк. */
  speak: boolean;
}

export interface FrameVerdict {
  /** Единственная подсказка для показа. */
  message: CoachMessage | null;
  /** Точки для красной подсветки — по всем активным нарушениям. */
  highlight: Set<LandmarkName>;
  /** Хотя бы одно активное нарушение блокирует зачёт повторения. */
  blocked: boolean;
  activeIds: readonly string[];
}

interface RuleState {
  since: number | null;
  lastSpokeAt: number;
  lastHint: string;
  hits: number;
}

export class FormAnalyzer {
  private readonly state = new Map<string, RuleState>();

  constructor(private readonly spec: ExerciseSpec) {}

  evaluate(ctx: FrameContext): FrameVerdict {
    const candidates: Array<{ rule: LiveRule; v: Violation; heldMs: number }> = [];

    for (const rule of this.spec.liveRules) {
      const st = this.stateOf(rule.id);

      if (rule.phases && !rule.phases.includes(ctx.phase)) {
        st.since = null;
        continue;
      }

      let v: Violation | null = null;
      try {
        v = rule.check(ctx);
      } catch {
        v = null; // недостающая точка — не повод валить кадр
      }

      if (!v) {
        st.since = null;
        continue;
      }

      if (st.since === null) st.since = ctx.t;
      const heldMs = ctx.t - st.since;
      if (heldMs < (rule.debounceMs ?? DEFAULT_DEBOUNCE_MS)) continue;

      st.lastHint = v.hint;
      candidates.push({ rule, v, heldMs });
    }

    if (candidates.length === 0) {
      return { message: null, highlight: new Set(), blocked: false, activeIds: [] };
    }

    candidates.sort((a, b) => {
      if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
      if (a.rule.severity !== b.rule.severity) return a.rule.severity === 'error' ? -1 : 1;
      return b.heldMs - a.heldMs;
    });

    const highlight = new Set<LandmarkName>();
    for (const c of candidates) {
      const groups = c.v.highlight ?? c.rule.highlight;
      if (groups) for (const n of expandGroups(groups)) highlight.add(n);
    }

    const top = candidates[0]!;
    const st = this.stateOf(top.rule.id);
    const speak = top.rule.severity === 'error' && ctx.t - st.lastSpokeAt >= SPEAK_COOLDOWN_MS;
    if (speak) {
      st.lastSpokeAt = ctx.t;
      st.hits += 1;
    }

    return {
      message: {
        ruleId: top.rule.id,
        title: top.rule.title,
        severity: top.rule.severity,
        hint: top.v.hint,
        value: top.v.value,
        unit: top.v.unit,
        target: top.v.target,
        speak,
      },
      highlight,
      blocked: candidates.some((c) => c.rule.blocksRep),
      activeIds: candidates.map((c) => c.rule.id),
    };
  }

  /**
   * Итог повторения: правила амплитуды и темпа + покадровые нарушения,
   * накопленные за это повторение.
   */
  gradeRep(draft: RepDraft): RepRecord {
    const violations: ScoredViolation[] = [];

    for (const rule of this.spec.repRules ?? []) {
      let v: Violation | null = null;
      try {
        v = rule.check(draft);
      } catch {
        v = null;
      }
      if (!v) continue;
      violations.push({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        hint: v.hint,
        blocksRep: rule.blocksRep === true,
      });
    }

    for (const id of draft.liveViolations) {
      const rule = this.spec.liveRules.find((r) => r.id === id);
      if (!rule) continue;
      violations.push({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        hint: this.stateOf(rule.id).lastHint,
        blocksRep: rule.blocksRep === true,
      });
    }

    const penalty = violations.reduce((sum, v) => sum + PENALTY[v.severity], 0);

    return {
      ...draft,
      counted: !violations.some((v) => v.blocksRep),
      quality: Math.max(0, 100 - penalty),
      violations,
    };
  }

  /** Подсказка по завершённому повторению — самая важная из нарушенных. */
  repFeedback(rec: RepRecord): ScoredViolation | null {
    if (rec.violations.length === 0) return null;
    const blocking = rec.violations.filter((v) => v.blocksRep);
    const pool = blocking.length ? blocking : rec.violations;
    return pool.reduce((a, b) => (PENALTY[b.severity] > PENALTY[a.severity] ? b : a));
  }

  reset(): void {
    this.state.clear();
  }

  private stateOf(id: string): RuleState {
    let st = this.state.get(id);
    if (!st) {
      st = { since: null, lastSpokeAt: -Infinity, lastHint: '', hits: 0 };
      this.state.set(id, st);
    }
    return st;
  }
}
