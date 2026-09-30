import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutSession } from '../src/engine/session';
import type { RepEvent } from '../src/engine/session';
import { requireExercise, workoutById } from '../src/exercises/registry';
import { pose, bendFor } from './synthetic';
import type { PoseParams } from './synthetic';
import type { Body } from '../src/vision/landmarks';
import { LANDMARK_INDEX } from '../src/vision/landmarks';
import { DemoSimulation } from '../src/demo/simulation';
import { InferenceMeter } from '../src/vision/inferenceMeter';

function ramp(a: PoseParams, b: PoseParams, n = 24): PoseParams[] {
  return Array.from({ length: n }, (_, i) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => {
    const k = key as keyof PoseParams, from = a[k] ?? 0, to = b[k] ?? 0;
    return [k, typeof from === 'boolean' || typeof to === 'boolean' ? to : from + (to - from) * (i + 1) / n];
  })));
}
const hold = (p: PoseParams, n = 14) => Array.from({ length: n }, () => p);
const cycle = (rest: PoseParams, peak: PoseParams) => [...hold(rest), ...ramp(rest, peak), ...hold(peak), ...ramp(peak, rest), ...hold(rest)];
const CASES = [
  { id: 'squat', rest: { bend: 0 }, peak: { bend: bendFor(88) }, shallow: { bend: bendFor(125) }, rule: 'squat-depth', error: { bend: bendFor(88), kneeHalf: .06 }, errorRule: 'knee-valgus', blocking: true,
    similar: { bend: bendFor(88), prone: true }, similarRest: { prone: true }, missing: 'left_knee' },
  { id: 'jumping-jack', rest: { armElevation: 8, ankleHalf: .1 }, peak: { armElevation: 168, ankleHalf: .33 }, shallow: { armElevation: 100, ankleHalf: .33 }, rule: 'jack-arms',
    error: { armElevation: 168, ankleHalf: .19 }, errorRule: 'jack-desync', blocking: true,
    similar: { armElevation: 168, ankleHalf: .1 }, similarRest: { armElevation: 8, ankleHalf: .1 }, missing: 'left_wrist' },
  { id: 'overhead-press', rest: { armElevation: 78, elbowBend: 92 }, peak: { armElevation: 172, elbowBend: 175 }, shallow: { armElevation: 160, elbowBend: 140 }, rule: 'press-lockout',
    error: { armElevation: 172, elbowBend: 175, tilt: 25 }, errorRule: 'press-tilt', blocking: false,
    similar: { armElevation: 172, elbowBend: 180 }, similarRest: { armElevation: 78, elbowBend: 180 }, missing: 'left_wrist' },
] satisfies { id: string; rest: PoseParams; peak: PoseParams; shallow: PoseParams; rule: string; error: PoseParams; errorRule: string; blocking: boolean; similar: PoseParams; similarRest: PoseParams; missing: keyof typeof LANDMARK_INDEX }[];

function runner(id: string, rest: PoseParams) {
  const session = new WorkoutSession({ id, name: id, description: '', icon: '', minutes: 1, restSec: 0, steps: [{ exerciseId: id, target: 100 }] });
  let t = 0;
  const events: RepEvent[] = [];
  session.start(t);
  const feed = (body: Body | null) => {
    t += 1000 / 30;
    const out = session.update(body, t, .5);
    if (out.repEvent) events.push(out.repEvent);
    return out;
  };
  for (let i = 0; i < 130; i++) feed(pose(rest));
  assert.equal(session.currentState, 'running');
  return { session, events, feed, get t() { return t; }, play(frames: PoseParams[]) { for (const frame of frames) feed(pose(frame)); } };
}

for (const c of CASES) {
  test(`${c.id}: полный цикл, отказ на короткой амплитуде и измеренное исправление`, () => {
    const r = runner(c.id, c.rest);
    r.play(cycle(c.rest, c.peak));
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0]!.rec.counted, true);
    assert.equal(r.events[0]!.corrections.length, 0, 'без ошибки не выдумываем исправление');
    r.play(cycle(c.rest, c.shallow));
    assert.equal(r.events[1]!.rec.counted, false);
    assert.ok(r.events[1]!.rec.violations.some(v => v.ruleId === c.rule && v.blocksRep));
    r.play(cycle(c.rest, c.peak));
    assert.equal(r.events[2]!.rec.counted, true);
    assert.ok(r.events[2]!.corrections.some(v => v.ruleId === c.rule));
  });
  test(`${c.id}: характерная ошибка с конкретной подсказкой`, () => {
    const r = runner(c.id, c.rest);
    r.play(cycle(c.rest, c.error));
    const rec = r.events[0]!.rec;
    const violation = rec.violations.find(v => v.ruleId === c.errorRule);
    assert.ok(violation, JSON.stringify(rec));
    assert.ok(violation.hint.length > 25);
    assert.equal(rec.counted, !c.blocking);
    if (!c.blocking) assert.equal(violation.severity, 'warning');
  });
  test(`${c.id}: пропавшие суставы не превращаются в ошибку техники`, () => {
    const r = runner(c.id, c.rest);
    r.play(ramp(c.rest, c.peak));
    for (let i = 0; i < 25; i++) {
      const body = pose(c.peak);
      body.visibility[LANDMARK_INDEX[c.missing]] = .1;
      if (c.id === 'squat') body.visibility[LANDMARK_INDEX.right_knee] = .1;
      const out = r.feed(body);
      assert.equal(out.ctx, null);
      assert.ok(out.framing.some(f => f.severity === 'block'));
      assert.equal(out.message?.severity, 'warning');
    }
    r.play(ramp(c.peak, c.rest));
    assert.equal(r.events.length, 0, 'не склеиваем обрыв движения');
    r.play(cycle(c.rest, c.peak));
    assert.equal(r.events.filter(e => e.rec.counted).length, 1);
  });
  test(`${c.id}: дрожание в крайней точке даёт один повтор`, () => {
    const r = runner(c.id, c.rest);
    r.play([...hold(c.rest), ...ramp(c.rest, c.peak)]);
    for (let i = 0; i < 45; i++) {
      const body = pose(c.peak);
      const jitter = (i % 2 ? 1 : -1) * .001;
      const noisy = { ...body, screen: body.screen.map(p => ({ ...p, x: p.x + jitter })) };
      r.feed(noisy);
    }
    r.play([...ramp(c.peak, c.rest), ...hold(c.rest)]);
    assert.equal(r.events.length, 1);
  });
  test(`${c.id}: пауза посреди повтора требует нового полного движения`, () => {
    const r = runner(c.id, c.rest);
    r.play(ramp(c.rest, c.peak));
    r.session.pause(r.t);
    r.play(hold(c.peak, 60));
    r.session.resume(r.t);
    r.play(hold(c.rest, 130));
    assert.equal(r.events.length, 0);
    r.play(cycle(c.rest, c.peak));
    assert.equal(r.events.filter(e => e.rec.counted).length, 1);
  });
  test(`${c.id}: похожее движение не засчитывается`, () => {
    const r = runner(c.id, c.rest);
    r.play(cycle(c.similarRest, c.similar));
    assert.equal(r.events.filter(e => e.rec.counted).length, 0);
  });
}

test('раздельный подъём рук и шаг ногами не заменяют синхронный jumping jack', () => {
  const rest = CASES[1]!.rest, arms = { armElevation: 168, ankleHalf: .1 }, legs = { armElevation: 8, ankleHalf: .33 };
  const r = runner('jumping-jack', rest);
  r.play([...hold(rest), ...ramp(rest, arms), ...hold(arms), ...ramp(arms, legs), ...hold(legs), ...ramp(legs, rest), ...hold(rest)]);
  assert.equal(r.events.filter(e => e.rec.counted).length, 0);
  assert.ok(r.events.some(e => e.rec.violations.some(v => v.ruleId === 'jack-together')));
});

test('симуляция проходит три настоящих анализатора до итогов с исправлениями', () => {
  const session = new WorkoutSession(workoutById('motion')!);
  const demo = new DemoSimulation();
  session.start(0);
  for (let t = 0; t < 100000 && !session.isOver; t += 1000 / 30) {
    const body = demo.frame(t, { exerciseId: session.currentSpec?.id ?? 'squat', running: session.currentState === 'running' });
    session.update(body, t, null);
  }
  assert.equal(session.isOver, true);
  assert.equal(session.result().totalReps, 9);
  assert.ok(session.result().fixedErrors >= 3);
});

test('75 секунд: пауза не расходует таймер, отсутствие ошибок не создаёт исправлений', () => {
  const session = new WorkoutSession(workoutById('repair')!);
  session.start(0);
  let t = 0;
  const advance = (n: number) => { for (let i = 0; i < n; i++) { t += 100; session.update(pose(), t, .5); } };
  advance(100);
  session.pause(t);
  advance(800);
  assert.equal(session.isOver, false);
  session.resume(t);
  advance(750);
  assert.equal(session.isOver, true);
  const result = session.result();
  assert.equal(result.fixedErrors, 0);
  assert.equal(result.totalReps, 0);
  assert.equal(result.avgQuality, 0);
});

test('частота новых результатов не растёт от перерисовок и падает при остановке модели', () => {
  const meter = new InferenceMeter();
  for (let i = 0; i <= 40; i++) meter.result(i * 100);
  assert.equal(meter.fps(4000), 10);
  for (let i = 0; i < 200; i++) meter.fps(4000);
  assert.equal(meter.fps(4000), 10);
  assert.ok(meter.fps(5000) < 10);
  assert.equal(meter.fps(10000), 0);
});

test('75 секунд остаются 75 секундами при одном обновлении в секунду', () => {
  const session = new WorkoutSession(workoutById('repair')!);
  session.start(0);
  let t = 0;
  while (session.currentState !== 'running' && t < 10000) {
    t += 1000;
    session.update(pose(), t, .5);
  }
  assert.equal(session.currentState, 'running');
  const beganAt = t;
  for (let sec = 1; sec < 75; sec++) {
    const out = session.update(pose(), beganAt + sec * 1000, .5);
    assert.equal(out.state, 'running');
    assert.equal(out.remainingSec, 75 - sec);
  }
  assert.equal(session.update(pose(), beganAt + 75000, .5).state, 'done');
});

test('пауза между кадрами учитывает точное время и исключает минуту без обновлений', () => {
  const session = new WorkoutSession(workoutById('repair')!);
  session.start(0);
  for (let t = 0; t <= 4000; t += 100) session.update(pose(), t, .5);
  session.pause(4600); // 1 секунда выполнения, включая 600 мс после последнего кадра.
  const paused = session.update(null, 64600, .5);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.remainingSec, 74);
  session.resume(64600);
  for (let t = 64600; t <= 68200; t += 100) session.update(pose(), t, .5);
  assert.equal(session.currentState, 'running');
  assert.equal(session.update(pose(), 142199, .5).state, 'running');
  assert.equal(session.update(pose(), 142200, .5).state, 'done');
});

for (const c of CASES) {
  test(`${c.id}: повторные и устаревшие результаты не создают повтор/исправление`, () => {
    const r = runner(c.id, c.rest);
    r.play(cycle(c.rest, c.shallow));
    const errorsBefore = r.events.length;
    const peak = { ...pose(c.peak), sampleId: 1, t: r.t + 1000 / 30 };
    for (let i = 0; i < 90; i++) r.feed(peak);
    assert.equal(r.events.length, errorsBefore);
    r.play(hold(c.rest, 40));
    assert.equal(r.events.length, errorsBefore, 'старый пик не склеивается с новой исходной позой');
    r.play(cycle(c.rest, c.peak));
    assert.ok(r.events.at(-1)!.corrections.some(fix => fix.ruleId === c.rule));
    const result = r.session.finish(r.t);
    assert.ok(result.corrections.some(fix => fix.ruleId === c.rule && fix.title.length > 5));
  });
}

test('ошибка амплитуды сохраняет нужные суставы для подсветки завершённого повтора', () => {
  const r = runner('squat', CASES[0]!.rest);
  r.play(cycle(CASES[0]!.rest, CASES[0]!.shallow));
  assert.deepEqual(r.events[0]!.feedback?.highlight, ['knees', 'hips']);
});
