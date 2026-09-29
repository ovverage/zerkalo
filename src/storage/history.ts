/**
 * Прогресс пользователя в localStorage: история тренировок, личные рекорды и
 * серия дней. Сервера нет, поэтому всё живёт в браузере.
 *
 * Данные читаются защищённо: любая запись, не прошедшая проверку, отбрасывается.
 * Иначе один испорченный ключ (например, после ручной правки в DevTools) навсегда
 * ломал бы экран истории.
 */

import type { SessionResult } from '../engine/session';

const KEY = 'zerkalo.history.v1';
const MAX_SESSIONS = 60;

export interface StoredExercise {
  exerciseId: string;
  name: string;
  icon: string;
  mode: 'reps' | 'hold';
  done: number;
  target: number;
  avgQuality: number;
}

export interface StoredSession {
  id: string;
  workoutId: string;
  workoutName: string;
  at: number;
  durationMs: number;
  totalReps: number;
  totalHoldSec: number;
  avgQuality: number;
  score: number;
  kcal: number;
  exercises: StoredExercise[];
}

export interface PersonalBest {
  exerciseId: string;
  name: string;
  icon: string;
  mode: 'reps' | 'hold';
  best: number;
  quality: number;
  at: number;
}

export interface NewRecord {
  kind: 'exercise' | 'score';
  label: string;
  value: number;
  previous: number;
}

export interface Totals {
  sessions: number;
  reps: number;
  minutes: number;
  kcal: number;
  bestScore: number;
  streakDays: number;
}

export class History {
  /** Все сохранённые тренировки, новые первыми. */
  list(): StoredSession[] {
    return this.read().sort((a, b) => b.at - a.at);
  }

  /** Сохраняет тренировку и возвращает установленные рекорды. */
  add(result: SessionResult): { session: StoredSession; records: NewRecord[] } {
    const session: StoredSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workoutId: result.workoutId,
      workoutName: result.workoutName,
      at: Date.now(),
      durationMs: result.durationMs,
      totalReps: result.totalReps,
      totalHoldSec: result.totalHoldSec,
      avgQuality: result.avgQuality,
      score: result.score,
      kcal: result.kcal,
      exercises: result.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        name: e.name,
        icon: e.icon,
        mode: e.mode,
        done: e.done,
        target: e.target,
        avgQuality: e.avgQuality,
      })),
    };

    // Рекорды считаем до записи новой сессии, иначе она побьёт сама себя.
    const records = this.findRecords(session);

    const all = this.read();
    all.push(session);
    this.write(all.slice(-MAX_SESSIONS));

    return { session, records };
  }

  bests(): PersonalBest[] {
    const map = new Map<string, PersonalBest>();
    for (const s of this.read()) {
      for (const e of s.exercises) {
        if (e.done <= 0) continue;
        const cur = map.get(e.exerciseId);
        if (!cur || e.done > cur.best) {
          map.set(e.exerciseId, {
            exerciseId: e.exerciseId,
            name: e.name,
            icon: e.icon,
            mode: e.mode,
            best: e.done,
            quality: e.avgQuality,
            at: s.at,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.best - a.best);
  }

  totals(): Totals {
    const all = this.read();
    return {
      sessions: all.length,
      reps: all.reduce((a, s) => a + s.totalReps, 0),
      minutes: Math.round(all.reduce((a, s) => a + s.durationMs, 0) / 60_000),
      kcal: Math.round(all.reduce((a, s) => a + s.kcal, 0)),
      bestScore: all.reduce((a, s) => Math.max(a, s.score), 0),
      streakDays: streak(all.map((s) => s.at)),
    };
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* приватный режим — просто нечего удалять */
    }
  }

  private findRecords(session: StoredSession): NewRecord[] {
    const records: NewRecord[] = [];
    const bests = new Map(this.bests().map((b) => [b.exerciseId, b.best]));

    for (const e of session.exercises) {
      if (e.done <= 0) continue;
      const prev = bests.get(e.exerciseId) ?? 0;
      if (e.done > prev) {
        records.push({
          kind: 'exercise',
          label: e.name,
          value: e.done,
          previous: prev,
        });
      }
    }

    const prevScore = this.read().reduce((a, s) => Math.max(a, s.score), 0);
    if (session.score > prevScore && this.read().length > 0) {
      records.push({ kind: 'score', label: 'Итоговый балл', value: session.score, previous: prevScore });
    }

    return records;
  }

  private read(): StoredSession[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isSession);
    } catch {
      return [];
    }
  }

  private write(sessions: StoredSession[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions));
    } catch {
      /* квота или приватный режим: прогресс просто не сохранится */
    }
  }
}

function isSession(v: unknown): v is StoredSession {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['at'] === 'number' &&
    typeof s['score'] === 'number' &&
    Array.isArray(s['exercises'])
  );
}

/** Серия: сколько дней подряд, считая от сегодня или вчера, были тренировки. */
function streak(timestamps: readonly number[]): number {
  if (!timestamps.length) return 0;
  const days = new Set(timestamps.map((t) => dayKey(new Date(t))));
  const today = new Date();

  // Серию не обрывает «сегодня ещё не тренировался»: начинаем со вчера.
  let cursor = days.has(dayKey(today)) ? today : new Date(today.getTime() - 86_400_000);
  if (!days.has(dayKey(cursor))) return 0;

  let count = 0;
  while (days.has(dayKey(cursor))) {
    count += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return count;
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
