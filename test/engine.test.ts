/**
 * Тесты движка на синтетических позах.
 *
 * Проверяем то, что нельзя увидеть глазами на демонстрации: что счётчик не
 * задваивает повторения на границе порога, что неполное повторение не
 * засчитывается и получает конкретную подсказку, и что геометрия различает
 * наклон вперёд и наклон в сторону.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RepCounter } from '../src/engine/repCounter';
import { FormAnalyzer } from '../src/engine/formAnalyzer';
import type { ExerciseSpec, RepRecord } from '../src/engine/types';
import { squat } from '../src/exercises/squat';
import { jumpingJack } from '../src/exercises/jumpingJack';
import { pushUp } from '../src/exercises/pushUp';
import { sideBend } from '../src/exercises/sideBend';
import { EXERCISES } from '../src/exercises/registry';
import { lateralTilt, torsoPitch } from '../src/exercises/common';
import { bendFor, pose } from './synthetic';
import type { PoseParams } from './synthetic';

const FRAME_MS = 1000 / 30;

/** Прогоняет последовательность поз через движок и собирает завершённые повторения. */
function run(spec: ExerciseSpec, frames: readonly PoseParams[]): RepRecord[] {
  const counter = new RepCounter(spec);
  const analyzer = new FormAnalyzer(spec);
  const reps: RepRecord[] = [];

  frames.forEach((params, i) => {
    const t = i * FRAME_MS;
    const body = pose(params);
    const m = spec.metrics(body);
    const { ctx, completed } = counter.tick(body, m, t, 1 / 30);
    const verdict = analyzer.evaluate(ctx);
    counter.noteViolations(verdict.activeIds);
    if (completed) reps.push(analyzer.gradeRep(completed));
  });

  return reps;
}

/** Плавное движение от одного набора параметров к другому. */
function ramp(from: PoseParams, to: PoseParams, steps: number): PoseParams[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]) as Set<keyof PoseParams>;
  const out: PoseParams[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = i / steps;
    const frame: PoseParams = {};
    for (const key of keys) {
      const a = from[key];
      const b = to[key];
      // Флаги вроде prone интерполировать нельзя — переносим как есть.
      if (typeof a === 'boolean' || typeof b === 'boolean') {
        frame[key] = ((b ?? a) as boolean) as never;
        continue;
      }
      frame[key] = ((a ?? 0) + ((b ?? 0) - (a ?? 0)) * k) as never;
    }
    out.push(frame);
  }
  return out;
}

const hold = (params: PoseParams, frames: number): PoseParams[] =>
  Array.from({ length: frames }, () => params);

/* ── Геометрия ───────────────────────────────────────────────────────────── */

test('наклон вперёд не путается с боковым наклоном', () => {
  assert.ok(Math.abs(torsoPitch(pose())) < 1.5, 'стоя прямо наклона нет');
  assert.ok(Math.abs(lateralTilt(pose())) < 1.5, 'стоя прямо бокового наклона нет');

  const forward = pose({ lean: 30 });
  assert.ok(torsoPitch(forward) > 26 && torsoPitch(forward) < 34, 'наклон вперёд измерен');
  assert.ok(Math.abs(lateralTilt(forward)) < 4, 'наклон вперёд не даёт бокового');

  const sideways = pose({ tilt: 28 });
  assert.ok(lateralTilt(sideways) > 24 && lateralTilt(sideways) < 32, 'боковой наклон измерен');
  assert.ok(Math.abs(torsoPitch(sideways)) < 4, 'боковой наклон не даёт наклона вперёд');

  const back = pose({ lean: -20 });
  assert.ok(torsoPitch(back) < -16, 'прогиб назад имеет отрицательный знак');
});

/* ── Счётчик повторений ──────────────────────────────────────────────────── */

test('полный присед засчитывается ровно один раз', () => {
  const deep = { bend: bendFor(88) };
  const up = { bend: 0 };
  const reps = run(squat, [
    ...hold(up, 6),
    ...ramp(up, deep, 14),
    ...hold(deep, 3),
    ...ramp(deep, up, 14),
    ...hold(up, 6),
  ]);

  assert.equal(reps.length, 1, 'ровно одно повторение');
  assert.equal(reps[0]?.counted, true, 'повторение зачтено');
  assert.ok((reps[0]?.quality ?? 0) >= 80, `качество ${reps[0]?.quality} должно быть высоким`);
});

test('дрожание на пороге не создаёт лишних повторений', () => {
  // Самый опасный для наивного счётчика случай: сигнал многократно пересекает
  // порог зачёта, оставаясь в нижней точке.
  const bottom = bendFor(95);
  const jitter: PoseParams[] = [];
  for (let i = 0; i < 40; i += 1) {
    jitter.push({ bend: bottom + (i % 2 === 0 ? 1.2 : -1.2) });
  }

  const reps = run(squat, [
    ...hold({ bend: 0 }, 6),
    ...ramp({ bend: 0 }, { bend: bottom }, 12),
    ...jitter,
    ...ramp({ bend: bottom }, { bend: 0 }, 12),
    ...hold({ bend: 0 }, 6),
  ]);

  assert.equal(reps.length, 1, 'дрожание в нижней точке не задваивает счёт');
});

test('пять приседаний подряд дают пять повторений', () => {
  const deep = { bend: bendFor(88) };
  const up = { bend: 0 };
  const frames: PoseParams[] = [...hold(up, 5)];
  for (let i = 0; i < 5; i += 1) {
    frames.push(...ramp(up, deep, 12), ...hold(deep, 2), ...ramp(deep, up, 12), ...hold(up, 4));
  }

  const reps = run(squat, frames);
  assert.equal(reps.length, 5);
  assert.equal(reps.filter((r) => r.counted).length, 5);
});

/* ── Режим «ошибка» ──────────────────────────────────────────────────────── */

test('неглубокий присед не засчитывается и получает подсказку с числами', () => {
  const shallow = { bend: bendFor(125) };
  const up = { bend: 0 };
  const reps = run(squat, [
    ...hold(up, 6),
    ...ramp(up, shallow, 12),
    ...hold(shallow, 3),
    ...ramp(shallow, up, 12),
    ...hold(up, 6),
  ]);

  assert.equal(reps.length, 1, 'попытка зафиксирована, а не проигнорирована');
  const rep = reps[0];
  assert.equal(rep?.counted, false, 'повторение не зачтено');

  const depth = rep?.violations.find((v) => v.ruleId === 'squat-depth');
  assert.ok(depth, 'сработало правило глубины');
  assert.match(
    depth!.hint,
    /согнулось до 12\d°, нужно минимум до 102°/,
    'в подсказке названы и фактическая глубина, и требуемый порог',
  );
});

test('сведённые внутрь колени блокируют зачёт', () => {
  const deep = { bend: bendFor(88), kneeHalf: 0.06 };
  const up = { bend: 0, kneeHalf: 0.06 };
  const reps = run(squat, [
    ...hold(up, 6),
    ...ramp(up, deep, 14),
    ...hold(deep, 8),
    ...ramp(deep, up, 14),
    ...hold(up, 6),
  ]);

  assert.equal(reps.length, 1);
  assert.equal(reps[0]?.counted, false, 'присед с завалом колен не зачтён');
  assert.ok(
    reps[0]?.violations.some((v) => v.ruleId === 'knee-valgus'),
    'сработало правило сведения колен',
  );
});

test('правильный присед не даёт ложных срабатываний', () => {
  const deep = { bend: bendFor(85) };
  const up = { bend: 0 };
  // 26 кадров на спуск — около 0,9 с, обычный тренировочный темп.
  const reps = run(squat, [
    ...hold(up, 8),
    ...ramp(up, deep, 26),
    ...hold(deep, 4),
    ...ramp(deep, up, 26),
    ...hold(up, 8),
  ]);

  assert.equal(reps.length, 1);
  assert.deepEqual(
    reps[0]?.violations.map((v) => v.ruleId),
    [],
    'ни одной ошибки на чистом приседе',
  );
  assert.equal(reps[0]?.quality, 100);
});

test('слишком быстрый темп помечается, но повторение засчитывается', () => {
  const deep = { bend: bendFor(85) };
  const up = { bend: 0 };
  // Спуск и подъём за 4 кадра каждый — примерно 130 мс.
  const reps = run(squat, [
    ...hold(up, 5),
    ...ramp(up, deep, 4),
    ...ramp(deep, up, 4),
    ...hold(up, 5),
  ]);

  assert.equal(reps.length, 1);
  assert.equal(reps[0]?.counted, true, 'быстрый темп не отменяет зачёт');
  assert.ok(
    reps[0]?.violations.some((v) => v.ruleId === 'tempo'),
    'но темп отмечен как замечание',
  );
});

test('наклон в сторону не считается наклоном вперёд', () => {
  const deep = { tilt: 30 };
  const up = { tilt: 0 };
  const reps = run(sideBend, [
    ...hold(up, 6),
    ...ramp(up, deep, 12),
    ...hold(deep, 4),
    ...ramp(deep, up, 12),
    ...hold(up, 6),
  ]);

  assert.equal(reps.length, 1);
  assert.equal(reps[0]?.counted, true, 'чистый боковой наклон зачтён');
  assert.ok(
    !reps[0]?.violations.some((v) => v.ruleId === 'bend-forward-instead'),
    'правило наклона вперёд не сработало',
  );
});

test('jumping jack без полного подъёма рук не засчитывается', () => {
  const low = { armElevation: 100, ankleHalf: 0.3 };
  const start = { armElevation: 8, ankleHalf: 0.1 };
  const reps = run(jumpingJack, [
    ...hold(start, 5),
    ...ramp(start, low, 8),
    ...hold(low, 2),
    ...ramp(low, start, 8),
    ...hold(start, 5),
  ]);

  assert.equal(reps.length, 1);
  assert.equal(reps[0]?.counted, false);
  assert.ok(
    reps[0]?.violations.some((v) => v.ruleId === 'jack-arms'),
    'названа именно ошибка подъёма рук',
  );
});

/* ── Проверка исходного положения ────────────────────────────────────────── */

test('стоящий человек не набирает отжиманий, размахивая руками', () => {
  // Ровно тот случай, который поймал пользователь: человек стоит, шевелит
  // руками, угол в локте гуляет по всей амплитуде — и без проверки позы
  // движок отсчитывал «отжимания», которых не было, вплоть до завершения
  // упражнения и перехода к отдыху.
  const frames: PoseParams[] = [];
  for (let i = 0; i < 12; i += 1) {
    frames.push(...ramp({ elbowBend: 175 }, { elbowBend: 80 }, 6));
    frames.push(...ramp({ elbowBend: 80 }, { elbowBend: 175 }, 6));
  }

  assert.equal(pushUp.inPosition?.(pushUp.metrics(pose())), false, 'стоя поза не принята');

  // Проверка не должна зависеть от того, насколько крупно человек в кадре:
  // иначе человек подальше от камеры прошёл бы как лежащий.
  const far = pose();
  const shrunk = {
    ...far,
    screen: far.screen.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.3, y: 0.5 + (p.y - 0.5) * 0.3, z: p.z })),
  };
  assert.equal(pushUp.inPosition?.(pushUp.metrics(shrunk)), false, 'стоя вдали поза тоже не принята');

  const reps = run(pushUp, frames);
  assert.equal(reps.length, 0, 'ни одного повторения в стойке');
});

test('в упоре лёжа отжимание засчитывается', () => {
  const top = { prone: true, armElevation: 90, elbowBend: 172 };
  const bottom = { prone: true, armElevation: 90, elbowBend: 88 };

  assert.equal(pushUp.inPosition?.(pushUp.metrics(pose(top))), true, 'упор лёжа распознан');

  const reps = run(pushUp, [
    ...hold(top, 6),
    ...ramp(top, bottom, 20),
    ...hold(bottom, 3),
    ...ramp(bottom, top, 20),
    ...hold(top, 6),
  ]);

  assert.equal(reps.length, 1, 'ровно одно повторение');
  assert.equal(reps[0]?.counted, true, 'повторение зачтено');
});

test('у каждого упражнения с проверкой позы есть подсказка', () => {
  for (const spec of EXERCISES) {
    if (!spec.inPosition) continue;
    assert.ok(
      spec.positionHint && spec.positionHint.length > 20,
      `${spec.id}: без positionHint пользователь не узнает, что делать`,
    );
  }
});

/* ── Целостность набора упражнений ───────────────────────────────────────── */

test('все упражнения описаны непротиворечиво', () => {
  const ids = new Set<string>();

  for (const spec of EXERCISES) {
    assert.ok(!ids.has(spec.id), `идентификатор ${spec.id} не повторяется`);
    ids.add(spec.id);

    assert.ok(spec.howTo.length >= 3, `${spec.id}: есть инструкция`);
    assert.ok(spec.setup.length > 20, `${spec.id}: есть описание постановки камеры`);
    assert.ok(spec.required.length >= 4, `${spec.id}: перечислены нужные точки`);

    // Опечатка в tracked молча отключила бы правила амплитуды: они читают
    // экстремумы по ключу и при его отсутствии просто возвращают null.
    const tracked = new Set(spec.tracked ?? []);
    const produced = spec.metrics(pose({ bend: 20 }));
    for (const key of tracked) {
      assert.ok(key in produced, `${spec.id}: метрика ${key} из tracked реально вычисляется`);
    }

    if (spec.mode === 'reps') {
      assert.ok(
        (spec.repRules ?? []).some((r) => r.blocksRep),
        `${spec.id}: есть правило, блокирующее зачёт по амплитуде`,
      );
    }

    if (spec.hud) {
      assert.ok(
        tracked.has(spec.hud.metric) || spec.metrics(pose())[spec.hud.metric] !== undefined,
        `${spec.id}: метрика HUD ${spec.hud.metric} вычисляется`,
      );
    }

    // Метрики должны считаться на любой позе без исключений.
    const m = spec.metrics(pose({ bend: 20, lean: 10, armElevation: 90 }));
    for (const [key, value] of Object.entries(m)) {
      assert.ok(Number.isFinite(value), `${spec.id}: метрика ${key} конечна`);
    }

    const p = spec.progress(m);
    assert.ok(p >= 0 && p <= 1, `${spec.id}: прогресс в диапазоне 0..1`);
  }
});

test('в исходном положении прогресс близок к нулю', () => {
  const standing = pose();
  for (const spec of EXERCISES) {
    if (spec.view === 'side' || spec.mode === 'hold') continue;
    const p = spec.progress(spec.metrics(standing));
    assert.ok(p < 0.3, `${spec.id}: стоя прогресс ${p.toFixed(2)} должен быть низким`);
  }
});
