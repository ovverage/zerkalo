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

import { GestureEngine, isArmsCrossed, isHandsUp } from '../src/gestures/uiGestures';
import type { GestureName } from '../src/gestures/uiGestures';
import { bendFor, pose } from './synthetic';
import type { PoseParams } from './synthetic';

const FRAME_MS = 1000 / 30;

/** Контейнер размером с кадр; жестам нужны только ширина и высота. */
const CONTAINER = { left: 0, top: 0, width: 1280, height: 720 } as DOMRect;

/** Прогоняет позы через движок жестов и собирает всё, что сработало. */
function fired(frames: readonly PoseParams[], targets: { id: string; rect: DOMRect }[] = []) {
  const engine = new GestureEngine();
  const events: GestureName[] = [];
  const activated: string[] = [];

  frames.forEach((params, i) => {
    const frame = engine.update(pose(params), i * FRAME_MS, {
      container: CONTAINER,
      targets,
      mirrored: true,
    });
    if (frame.fired) events.push(frame.fired);
    if (frame.activatedTargetId) activated.push(frame.activatedTargetId);
  });

  return { events, activated };
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
  // Руки действительно поднимаются над головой, поэтому «подтверждение» здесь
  // сработать может — но оно ничего не ломает: во время упражнения экран его
  // игнорирует, а на паузе оно означает «продолжить».
  assert.ok(
    events.every((e) => e === 'confirm'),
    `других жестов быть не должно: ${events.join(', ')}`,
  );
});

test('осознанные жесты распознаются', () => {
  const up = pose({ armElevation: 180 });
  assert.equal(isHandsUp(up), true, 'руки над головой');

  const standing = pose();
  assert.equal(isHandsUp(standing), false, 'опущенные руки — не жест');
  assert.equal(isArmsCrossed(standing), false, 'опущенные руки не скрещены');
});

test('кнопка выбирается только удержанием кисти на ней', () => {
  // Кнопка в правом верхнем углу — там же, где в приложении «завершить».
  const button = { id: 'quit', rect: { left: 1180, top: 20, width: 80, height: 80 } as DOMRect };

  // Человек просто стоит: кисти внизу, курсора нет вообще.
  const standing = Array.from({ length: 120 }, () => ({}) as PoseParams);
  assert.deepEqual(fired(standing, [button]).activated, [], 'стоя кнопка не нажимается');

  // Руки над головой: курсор есть, но не на кнопке.
  const handsUp = Array.from({ length: 120 }, () => ({ armElevation: 180 }) as PoseParams);
  assert.deepEqual(fired(handsUp, [button]).activated, [], 'поднятая рука не попадает на кнопку');
});
