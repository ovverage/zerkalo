import assert from 'node:assert/strict';
import test from 'node:test';
import type { Body, LandmarkName } from '../src/vision/landmarks';
import { LANDMARK_INDEX, buildFrame } from '../src/vision/landmarks';
import { checkFraming, isBlocked } from '../src/vision/framing';
import { observe } from '../src/vision/tracking';
import { containTransform } from '../src/vision/viewport';
import { restoreScreen, restoreWorld } from '../src/vision/rotation';
import { squat } from '../src/exercises/squat';
import { pushUp } from '../src/exercises/pushUp';
import { plank } from '../src/exercises/plank';
import type { ExerciseSpec } from '../src/engine/types';
import { WorkoutSession } from '../src/engine/session';
import { RepCounter } from '../src/engine/repCounter';
import { pose, bendFor } from './synthetic';

function reframe(b: Body, x: number, y: number, scale: number, aspect = 1): Body {
  return { ...b, imageAspect: aspect,
    screen: b.screen.map((p) => ({ x: x + (p.x - 0.5) * scale / aspect, y: y + (p.y - 0.5) * scale, z: p.z })) };
}
function hide(b: Body, prefix: string, poison = false): Body {
  const visibility = [...b.visibility], world = [...b.world];
  for (const [name, index] of Object.entries(LANDMARK_INDEX)) {
    if (!name.startsWith(prefix)) continue;
    visibility[index] = 0.12;
    if (poison) world[index] = { x: 0, y: 1, z: -2 };
  }
  return { ...b, visibility, world, frame: buildFrame(world) };
}
function visible(b: Body, names: LandmarkName[]): Body {
  const visibility = b.visibility.map(() => 0.1);
  for (const name of names) visibility[LANDMARK_INDEX[name]] = 0.98;
  return { ...b, visibility };
}
function sessionFor(spec: ExerciseSpec, target = 99) {
  const session = new WorkoutSession({ id: 'test', name: '', description: '', icon: '', minutes: 1,
    restSec: 0, steps: [{ exerciseId: spec.id, target }] });
  let t = 0;
  session.start(t);
  return { session, tick(body: Body | null, ms = 1000 / 30) {
    t += ms;
    return session.update(body, t, 0.5);
  }, get time() { return t; } };
}
function ready(h: ReturnType<typeof sessionFor>, b: Body) {
  let out;
  for (let i = 0; i < 130; i++) out = h.tick(b);
  assert.equal(out?.state, 'running');
}

for (const spec of [squat, pushUp, plank]) {
  test(`${spec.id}: слева/справа, близко к краю и небольшой размер не блокируют подготовку`, () => {
    const b = spec === squat ? pose() : pose({ prone: true, armElevation: 90 });
    for (const [x, y, scale] of [[0.15, 0.5, 0.4], [0.82, 0.6, 0.4], [0.4, 0.83, 0.4], [0.5, 0.5, 0.24]]) {
      const shifted = reframe(b, x!, y!, scale!);
      const issues = checkFraming(shifted, spec, 0.5);
      assert.equal(isBlocked(issues), false, JSON.stringify(issues));
      assert.ok(!issues.some((i) => i.code === 'off-center'));
      const h = sessionFor(spec);
      ready(h, shifted);
    }
  });
}

test('отжимание учитывает видимый локоть, скрытая сторона с ошибочными координатами не искажает измерение', () => {
  const b = hide(pose({ prone: true, armElevation: 90, elbowBend: 92 }), 'right_', true);
  assert.equal(observe(b, pushUp.required, pushUp.tracking).ok, true);
  assert.ok(Math.abs(pushUp.metrics(b).elbowMean! - 92) < 2);
  assert.equal(pushUp.inPosition!(pushUp.metrics(b)), true);
});

test('одной целой цепочки суставов достаточно, смешанных обрывков недостаточно', () => {
  const b = pose({ prone: true });
  assert.equal(observe(hide(b, 'right_'), pushUp.required, 'either-side').ok, true);
  const mixed = visible(b, ['left_shoulder', 'left_elbow', 'right_wrist', 'right_hip', 'right_knee']);
  assert.equal(observe(mixed, pushUp.required, 'either-side').ok, false);
});

test('положение у края допустимо, отсутствующее за кадром рабочее колено — нет', () => {
  const b = hide(pose(), 'right_');
  const screen = [...b.screen];
  screen[LANDMARK_INDEX.left_knee] = { x: -0.01, y: 0.5, z: 0 };
  assert.equal(observe({ ...b, screen }, squat.required, 'either-side').ok, false);
});

test('голова и стопы вне кадра не блокируют отжимания при видимых рабочих суставах', () => {
  const b = visible(pose({ prone: true, armElevation: 90 }), [...pushUp.required]);
  assert.equal(isBlocked(checkFraming(b, pushUp, 0.5)), false);
});

for (const side of ['left_', 'right_']) {
  for (const spec of [squat, pushUp]) {
    test(`${spec.id}: полный подход у края кадра со скрытой ${side} стороной`, () => {
      const h = sessionFor(spec, 3);
      const bodyAt = (angle: number) => reframe(hide(spec === squat
        ? pose({ bend: bendFor(angle) })
        : pose({ prone: true, armElevation: 90, elbowBend: angle }), side), 0.76, 0.65, 0.5, 16 / 9);
      ready(h, bodyAt(172));
      let out;
      for (let rep = 0; rep < 3; rep++) {
        for (let i = 0; i <= 50; i++) {
          const angle = 172 - 84 * Math.sin(i / 50 * Math.PI);
          out = h.tick(bodyAt(angle));
        }
      }
      assert.equal(out?.state, 'done');
      assert.equal(h.session.result().totalReps, 3);
    });
  }
}

test('пропажа во время отсчёта возвращает подготовку', () => {
  const h = sessionFor(squat);
  let out;
  for (let i = 0; i < 25; i++) out = h.tick(pose());
  assert.equal(out?.state, 'countdown');
  for (let i = 0; i < 30; i++) out = h.tick(null);
  assert.equal(out?.state, 'setup');
});

test('краткая потеря сохраняет повторение, длительная не склеивает разные движения', () => {
  for (const lostFrames of [3, 30]) {
    const h = sessionFor(squat);
    ready(h, pose());
    for (let i = 0; i <= 25; i++) h.tick(pose({ bend: bendFor(172 - i * 3.4) }));
    for (let i = 0; i < lostFrames; i++) h.tick(null);
    let out;
    for (let i = 0; i <= 25; i++) out = h.tick(pose({ bend: bendFor(87 + i * 3.4) }));
    assert.equal(out?.done, lostFrames === 3 ? 1 : 0);
  }
});

test('пауза посреди приседа сбрасывает незавершённое повторение', () => {
  const h = sessionFor(squat);
  ready(h, pose());
  for (let i = 0; i <= 25; i++) h.tick(pose({ bend: bendFor(172 - i * 3.4) }));
  h.session.pause(h.time);
  h.session.resume(h.time + 50);
  ready(h, pose({ bend: bendFor(88) }));
  let out;
  for (let i = 0; i <= 25; i++) out = h.tick(pose({ bend: bendFor(88 + i * 3.4) }));
  assert.equal(out?.done, 0);
});

test('низкая достоверность во время выполнения приостанавливает счёт и показывает причину', () => {
  const h = sessionFor(squat);
  ready(h, pose());
  let out;
  for (let i = 0; i < 100; i++) out = h.tick(pose({ bend: 42 * Math.sin(i / 10) ** 2, visibility: 0.2 }));
  assert.equal(out?.done, 0);
  assert.match(out?.message?.hint ?? '', /Покажи камере.*колени/);
});

test('один кадр модели не добавляет время планки при повторной отрисовке', () => {
  const h = sessionFor(plank);
  const b = pose({ prone: true, armElevation: 90 });
  ready(h, b);
  const sample = { ...b, t: h.time + 34, sampleId: 7 };
  const before = h.tick(sample).done;
  let out;
  for (let i = 0; i < 12; i++) out = h.tick(sample, 10);
  assert.equal(out?.done, before);
  for (let i = 0; i < 60; i++) out = h.tick(null);
  assert.equal(out?.done, before);
});

test('автокалибровка верхней точки позволяет считать при оценке прямой руки в 148°', () => {
  const h = sessionFor(pushUp);
  const top = pose({ prone: true, armElevation: 90, elbowBend: 148 });
  ready(h, top);
  let out;
  for (let i = 0; i <= 60; i++) {
    out = h.tick(pose({ prone: true, armElevation: 90, elbowBend: 148 - 60 * Math.sin(i / 60 * Math.PI) }));
  }
  assert.equal(out?.done, 1);
});

test('редкие кадры не пропускают завершение повторения и одиночный выброс не считается', () => {
  const counter = new RepCounter(squat);
  let completed = 0;
  for (const [i, angle] of [172, 90, 172, 172].entries()) {
    const b = pose({ bend: bendFor(angle) });
    if (counter.tick(b, squat.metrics(b), i * 250, 0.25).completed) completed++;
  }
  assert.equal(completed, 1);
  const noise = new RepCounter(squat);
  for (const [i, angle] of [172, 90, 172, 172].entries()) {
    const b = pose({ bend: bendFor(angle) });
    assert.equal(noise.tick(b, squat.metrics(b), i * 33, 0.033).completed, null);
  }
});

test('широкий кадр в вертикальном экране полностью виден; скелет использует тот же масштаб', () => {
  const tf = containTransform(1920, 1080, 390, 844);
  assert.equal(tf.dx, 0);
  assert.ok(Math.abs(tf.scale * 1920 - 390) < 1e-6);
  assert.ok(tf.dy > 300);
});

test('восстановление координат после поиска в повёрнутом кадре учитывает пропорции камеры', () => {
  const original = { x: 0.17, y: 0.73, z: -0.2 };
  for (const rotation of [90, -90] as const) {
    const aspect = 16 / 9;
    const rotated = rotation === 90
      ? { x: 1 - original.y, y: original.x, z: original.z * aspect }
      : { x: original.y, y: 1 - original.x, z: original.z * aspect };
    const recovered = restoreScreen(rotated, rotation, aspect);
    assert.ok(Math.abs(recovered.x - original.x) < 1e-9);
    assert.ok(Math.abs(recovered.y - original.y) < 1e-9);
    assert.equal(recovered.z, original.z);
    const w = rotation === 90 ? { x: -2, y: 1, z: 3 } : { x: 2, y: -1, z: 3 };
    assert.deepEqual(restoreWorld(w, rotation), { x: 1, y: 2, z: 3 });
  }
});

test('стоящий человек с наклоном корпуса не становится отжимающимся', () => {
  for (const lean of [35, 45, 55, 65]) {
    const b = pose({ lean, elbowBend: 90 });
    assert.equal(pushUp.inPosition!(pushUp.metrics(b)), false, `наклон ${lean}`);
    assert.equal(plank.inPosition!(plank.metrics(b)), false, `наклон ${lean}`);
  }
});

test('видимые суставы проходят при наклонённой камере и разном соотношении сторон', () => {
  const base = pose({ prone: true, armElevation: 90, elbowBend: 92 });
  for (const aspect of [9 / 16, 4 / 3, 16 / 9]) {
    const angle = 35 * Math.PI / 180;
    const rotated = base.world.map((p) => ({
      x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: p.x * Math.sin(angle) + p.y * Math.cos(angle), z: p.z,
    }));
    const b: Body = { ...base, world: rotated, frame: buildFrame(rotated), imageAspect: aspect,
      screen: rotated.map((p) => ({ x: 0.5 + p.x * 0.22 / aspect, y: 0.5 + p.y * 0.22, z: p.z })) };
    assert.equal(pushUp.inPosition!(pushUp.metrics(b)), true);
    assert.equal(isBlocked(checkFraming(b, pushUp, 0.5)), false);
  }
});
