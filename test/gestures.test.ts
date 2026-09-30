/**
 * Тесты жестового управления.
 *
 * Жесты интерфейса и движения упражнений делаются одним и тем же телом, поэтому
 * главный риск здесь — ложное срабатывание. Случайный «взмах рукой» пропускал
 * упражнение, а поднятая рука во время подготовки могла задержаться на кнопке
 * завершения и закончить тренировку, которая ещё не начиналась.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GestureEngine, isArmsCrossed } from '../src/gestures/uiGestures';
import type { GestureName } from '../src/gestures/uiGestures';
import { bendFor, pose } from './synthetic';
import type { PoseParams } from './synthetic';

const FRAME_MS = 1000 / 30;

/** Прогоняет позы через движок жестов и собирает всё, что сработало. */
function fired(frames: readonly PoseParams[]) {
  const engine = new GestureEngine();
  const events: GestureName[] = [];

  frames.forEach((params, i) => {
    const frame = engine.update(pose(params), i * FRAME_MS);
    if (frame.fired) events.push(frame.fired);
  });

  return { events };
}

test('приседания не порождают жестов интерфейса', () => {
  const frames: PoseParams[] = [];
  for (let i = 0; i < 300; i += 1) {
    const phase = i % 44;
    frames.push({ bend: bendFor(phase < 22 ? 170 - phase * 3.8 : 86 + (phase - 22) * 3.8) });
  }

  const { events } = fired(frames);
  assert.deepEqual(events, [], `сработали жесты: ${events.join(', ')}`);
});

test('jumping jacks не пропускают упражнение случайным жестом', () => {
  // Руки ходят от бёдер до положения над головой — самое опасное движение для
  // жестов. Именно на нём взмах рукой давал восемь ложных срабатываний, каждое
  // из которых пропускало упражнение. Взмах из-за этого убран совсем.
  const frames: PoseParams[] = [];
  for (let i = 0; i < 300; i += 1) {
    const phase = i % 20;
    const elev = phase < 10 ? phase * 17 : (20 - phase) * 17;
    frames.push({ armElevation: elev, ankleHalf: 0.17 + (elev / 170) * 0.25 });
  }

  const { events } = fired(frames);
  assert.deepEqual(events, []);
});

test('поднятые руки не вызывают команд даже при длительном удержании', () => {
  assert.deepEqual(fired(Array.from({ length: 300 }, () => ({ armElevation: 180 }))).events, []);
  assert.equal(isArmsCrossed(pose()), false);
});

function crossed() {
  const body = pose();
  body.world[15] = { x: -.16, y: -.34, z: -.06 };
  body.world[16] = { x: .16, y: -.34, z: -.06 };
  return body;
}

test('удержанный жест не запускает цепочку экранов даже после сброса экрана и потери позы', () => {
  const engine = new GestureEngine();
  const events: string[] = [];
  for (let t = 0; t < 9000; t += FRAME_MS) {
    const body = t > 2500 && t < 3100 ? null : crossed();
    const frame = engine.update(body, t);
    if (frame.fired) { events.push(frame.fired); engine.clearCooldown(); }
  }
  assert.deepEqual(events, ['cross']);
  for (let t = 9000; t < 9600; t += FRAME_MS) engine.update(pose(), t);
  for (let t = 9600; t < 11000; t += FRAME_MS) {
    const frame = engine.update(crossed(), t);
    if (frame.fired) events.push(frame.fired);
  }
  assert.deepEqual(events, ['cross', 'cross']);
});

test('одна поднятая ладонь не выбирает кнопки и не создаёт команд', () => {
  const engine = new GestureEngine();
  const oneHand = pose({ armElevation: 90 });
  const neutral = pose();
  oneHand.world[16] = neutral.world[16]!;
  oneHand.screen[16] = neutral.screen[16]!;
  for (let t = 0; t < 5000; t += FRAME_MS) {
    const frame = engine.update(oneHand, t);
    assert.equal(frame.fired, null);
    assert.equal(frame.holding, null);
  }
});

test('краткое скрещение не ставит паузу, удержание и отпускание дают по одной команде', () => {
  const engine = new GestureEngine();
  const crossed = pose();
  crossed.world[15] = { x: -.16, y: -.34, z: -.06 };
  crossed.world[16] = { x: .16, y: -.34, z: -.06 };
  assert.equal(isArmsCrossed(crossed), true);
  const events: string[] = [];
  for (let t = 0; t < 6500; t += FRAME_MS) {
    const body = t < 300 || (t > 900 && t < 4000) || t > 4900 ? crossed : pose();
    const frame = engine.update(body, t);
    if (frame.fired) events.push(frame.fired);
  }
  assert.deepEqual(events, ['cross', 'cross']);
});

function sideArm(side: 'left' | 'right') {
  const body = pose({ armElevation: 90 });
  const rest = pose();
  for (const index of side === 'left' ? [14, 16] : [13, 15]) {
    body.world[index] = rest.world[index]!; body.screen[index] = rest.screen[index]!;
  }
  return body;
}

test('разные руки дают предыдущий/следующий пункт только при разрешённой навигации', () => {
  for (const side of ['left', 'right'] as const) {
    for (const navigation of [false, true]) {
      const engine = new GestureEngine(), events: GestureName[] = [];
      for (let t = 0; t < 2500; t += FRAME_MS) {
        const frame = engine.update(sideArm(side), t, navigation);
        if (frame.fired) events.push(frame.fired);
      }
      assert.deepEqual(events, navigation ? [side === 'left' ? 'previous' : 'next'] : []);
    }
  }
});

test('выбор требует отпускания; смена экрана, потеря тела и другая рука его не заменяют', () => {
  const engine = new GestureEngine(), events: string[] = [];
  for (let t = 0; t < 7000; t += FRAME_MS) {
    const body = t < 2000 ? sideArm('left') : t < 2600 ? null : t < 4200 ? sideArm('right') : t < 4900 ? pose() : sideArm('right');
    const frame = engine.update(body, t, true);
    if (frame.fired) { events.push(frame.fired); engine.clearCooldown(); }
  }
  assert.deepEqual(events, ['previous', 'next']);
});

test('джамп, жим, обе руки в стороны и неуверенные суставы не выбирают пункты даже в меню', () => {
  const poses = [pose({ armElevation: 90 }), pose({ armElevation: 172, elbowBend: 175 }), pose({ armElevation: 168, ankleHalf: .33 }), sideArm('left')];
  poses[3]!.visibility[15] = .4;
  for (const body of poses) {
    const engine = new GestureEngine();
    for (let t = 0; t < 2500; t += FRAME_MS) assert.equal(engine.update(body, t, true).fired, null);
  }
});

test('один результат модели не подтверждает удержание и не отпускает команду', () => {
  const engine = new GestureEngine();
  const frozen = { ...crossed(), sampleId: 1, t: 0 };
  for (let t = 0; t < 2000; t += 10) assert.equal(engine.update(frozen, t).fired, null);
  let count = 0;
  for (let t = 2000; t < 3100; t += 50) if (engine.update({ ...crossed(), sampleId: t, t }, t).fired) count++;
  assert.equal(count, 1);
  const release = { ...pose(), sampleId: 9999, t: 3100 };
  for (let t = 3100; t < 3800; t += 10) engine.update(release, t);
  for (let t = 3800; t < 6000; t += 50) assert.equal(engine.update({ ...crossed(), sampleId: t, t }, t).fired, null);
});
