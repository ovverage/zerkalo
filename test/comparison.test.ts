import test from 'node:test';
import assert from 'node:assert/strict';
import { comparableAttempt, acceptance } from '../src/storage/comparison';
import { WorkoutSession } from '../src/engine/session';
import { workoutById } from '../src/exercises/registry';
import type { StoredSession } from '../src/storage/history';
import { CorrectionTracker } from '../src/engine/corrections';
import { requireExercise } from '../src/exercises/registry';
import type { RepRecord } from '../src/engine/types';

function sample() {
  const result = new WorkoutSession(workoutById('repair')!).result();
  Object.assign(result, { source: 'camera', model: 'heavy', activeMs: 75000, totalReps: 4, exercises: [{ attempts: 5 }], corrections: [] });
  const stored = { ...result, id: 'before', at: 1, attempts: 6, totalReps: 3 } as unknown as StoredSession;
  return { result, stored };
}
test('сравниваются две полные попытки, текущая запись исключается по ID', () => {
  const { result, stored } = sample();
  assert.equal(comparableAttempt(result, [{ ...stored, id: 'current' }, stored], 'current')?.id, 'before');
  assert.equal(comparableAttempt(result, [stored], 'not-saved')?.id, 'before', 'ошибка записи истории не скрывает предыдущую попытку');
  assert.equal(acceptance(4, 5), 80);
});
test('прерванные, малые, старые, другие модели/правила/программы не сравниваются', () => {
  const { result, stored } = sample();
  for (const mismatch of [{ activeMs: 74000 }, { attempts: 2 }, { measurementVersion: undefined }, { model: 'lite' }, { planKey: 'other' }, { corrections: undefined }, { plannedActiveMs: 60000 }]) {
    assert.equal(comparableAttempt(result, [{ ...stored, ...mismatch }]), null, JSON.stringify(mismatch));
  }
  assert.equal(comparableAttempt({ ...result, model: undefined }, [stored]), null, 'смена модели внутри попытки исключает сравнение');
  assert.equal(comparableAttempt({ ...result, activeMs: 2000 }, [stored]), null);
  assert.equal(comparableAttempt({ ...result, source: 'simulation' }, [stored]), null);
  assert.equal(comparableAttempt({ ...result, exercises: [] }, [stored]), null);
});
test('исправление требует измерений подходящего правила, а не отсутствия нарушения', () => {
  const tracker = new CorrectionTracker(requireExercise('squat'));
  const rec = { counted: false, violations: [{ ruleId: 'squat-depth' }], extremes: {}, endMetrics: {} } as unknown as RepRecord;
  tracker.observe(rec);
  assert.deepEqual(tracker.observe({ ...rec, counted: true, violations: [] }), []);
  assert.deepEqual(tracker.observe({ ...rec, counted: true, violations: [], extremes: { kneeMean: { min: NaN, max: 170 } } }), []);
  const fixed = tracker.observe({ ...rec, counted: true, violations: [], extremes: { kneeMean: { min: 88, max: 170 } } });
  assert.equal(fixed[0]?.ruleId, 'squat-depth');
  assert.equal(tracker.confirmed[0]?.title, 'Глубина приседа');
  assert.equal(new CorrectionTracker(requireExercise('squat')).count, 0, 'новое упражнение не наследует исправления');
});
