/**
 * Тесты сессии тренировки — то, что видит пользователь.
 *
 * Тесты движка проверяют счётчик в отрыве от всего остального. Здесь проверяется
 * цепочка целиком: подготовка → отсчёт → выполнение → отдых. Именно на этом
 * уровне проявился баг, когда упражнение «выполнялось» само, пока человек ещё
 * наводил камеру.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkoutSession } from '../src/engine/session';
import type { FrameOutcome } from '../src/engine/session';
import { workoutById } from '../src/exercises/registry';
import type { WorkoutPlan } from '../src/exercises/registry';
import type { Body } from '../src/vision/landmarks';
import { bendFor, pose } from './synthetic';

const FRAME_MS = 1000 / 30;
const FLOOR = workoutById('floor');

/** Прогоняет сессию заданное число кадров, отдавая последнее состояние. */
function play(
  frames: number,
  bodyAt: (i: number) => Body | null,
  session = new WorkoutSession(FLOOR!),
): { last: FrameOutcome; session: WorkoutSession } {
  session.start(0);
  let last = session.update(null, 0, 0.5);
  for (let i = 1; i <= frames; i += 1) {
    last = session.update(bodyAt(i), i * FRAME_MS, 0.5);
  }
  return { last, session };
}

test('без человека в кадре тренировка стоит на подготовке', () => {
  // 30 секунд пустого кадра: человек ещё наводит камеру.
  const { last } = play(900, () => null);

  assert.equal(last.state, 'setup', 'состояние не ушло дальше подготовки');
  assert.equal(last.spec?.id, 'push-up', 'упражнение не сменилось');
  assert.equal(last.done, 0, 'ничего не засчитано');
});

test('стоящий человек не проходит отжимания, размахивая руками', () => {
  // Ровно сценарий пользователя: человек стоит перед камерой и шевелит руками,
  // угол в локте гуляет по всей амплитуде.
  const { last } = play(900, (i) => pose({ elbowBend: 130 + Math.sin(i / 4) * 45 }));

  assert.equal(last.state, 'setup', 'отсчёт не начался');
  assert.equal(last.spec?.id, 'push-up', 'до планки дело не дошло');
  assert.equal(last.done, 0, 'ни одного повторения');
});

test('в упоре лёжа отжимания считаются и упражнение завершается', () => {
  const step = FLOOR!.steps[0];
  assert.equal(step?.exerciseId, 'push-up');
  const target = step!.target;

  // Полный цикл отжимания — 40 кадров, около 1,3 с.
  const bend = (i: number): number => {
    const phase = i % 40;
    return phase < 20 ? 172 - phase * 4.2 : 88 + (phase - 20) * 4.2;
  };

  const { last, session } = play(
    // Подготовка (~1 с) + отсчёт (3 с) + повторения с запасом.
    150 + 40 * (target + 2),
    (i) => pose({ prone: true, armElevation: 90, elbowBend: bend(i) }),
  );

  const pushUps = session.result().exercises.find((e) => e.exerciseId === 'push-up');
  assert.ok(pushUps, 'упражнение попало в итоги');
  assert.equal(pushUps!.done, target, `зачтено ${pushUps!.done} из ${target}`);
  assert.ok(
    last.state === 'rest' || last.spec?.id === 'plank',
    `после отжиманий идёт отдых и планка, а не ${last.state}/${last.spec?.id}`,
  );
});

test('стоячее упражнение проходится целиком', () => {
  // Проверка кадра теперь меряет габарит по длинной стороне — убеждаемся, что
  // это не сломало обычные упражнения в полный рост.
  const plan: WorkoutPlan = {
    id: 'test-squat',
    name: 'Тест',
    description: '',
    icon: '🦵',
    minutes: 1,
    restSec: 0,
    steps: [{ exerciseId: 'squat', target: 3 }],
  };

  // Полный присед — 44 кадра, около 1,5 с.
  const squatBend = (i: number): number => {
    const phase = i % 44;
    return phase < 22 ? bendFor(170 - phase * 3.8) : bendFor(86 + (phase - 22) * 3.8);
  };

  const session = new WorkoutSession(plan);
  session.start(0);
  let last = session.update(null, 0, 0.5);
  for (let i = 1; i <= 150 + 44 * 5; i += 1) {
    last = session.update(pose({ bend: squatBend(i) }), (i * 1000) / 30, 0.5);
  }

  const squats = session.result().exercises.find((e) => e.exerciseId === 'squat');
  assert.ok(squats, 'присед попал в итоги');
  assert.equal(squats!.done, 3, `зачтено ${squats!.done} из 3`);
  assert.equal(last.state, 'done', 'тренировка завершена');
});

test('низкая достоверность точек не даёт засчитывать повторения', () => {
  // Модель иногда «находит» позу на мебели: точки есть, но достоверность низкая.
  const { last } = play(900, (i) =>
    pose({
      prone: true,
      armElevation: 90,
      elbowBend: 130 + Math.sin(i / 4) * 45,
      visibility: 0.2,
    }),
  );

  assert.equal(last.done, 0, 'ни одного повторения по недостоверным точкам');
});
