import type { SessionResult } from '../engine/session';
import type { StoredSession } from './history';

export const attemptsIn = (result: SessionResult): number => result.exercises.reduce((sum, e) => sum + e.attempts, 0);
export function comparableAttempt(result: SessionResult, history: readonly StoredSession[], savedId?: string): StoredSession | null {
  if (result.source !== 'camera' || !result.challenge || !result.model || result.plannedActiveMs !== 75_000 ||
      result.activeMs < result.plannedActiveMs || attemptsIn(result) < 3) return null;
  // The freshly saved row is excluded by identity, never by its array position.
  return history.find(s => s.id !== savedId && s.challenge && s.workoutId === result.workoutId &&
    s.measurementVersion === result.measurementVersion && s.model === result.model && s.planKey === result.planKey &&
    s.plannedActiveMs === result.plannedActiveMs && (s.activeMs ?? 0) >= result.plannedActiveMs &&
    Number.isInteger(s.attempts) && s.attempts! >= 3 && s.totalReps <= s.attempts! && Array.isArray(s.corrections)) ?? null;
}
export const acceptance = (reps: number, attempts: number): number => attempts ? Math.round(reps / attempts * 100) : 0;
