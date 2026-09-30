/**
 * Реестр упражнений и готовые программы.
 *
 * Добавить упражнение = положить файл рядом и дописать одну строку в EXERCISES.
 * Ни счётчик повторений, ни анализатор ошибок, ни экраны при этом не меняются.
 */

import type { ExerciseSpec, MuscleGroup } from '../engine/types';

import { highKnees } from './highKnees';
import { jumpingJack } from './jumpingJack';
import { kneeToElbow } from './kneeToElbow';
import { lateralRaise } from './lateralRaise';
import { lunge } from './lunge';
import { overheadPress } from './overheadPress';
import { overheadSquat } from './overheadSquat';
import { plank } from './plank';
import { pushUp } from './pushUp';
import { sideBend } from './sideBend';
import { squat } from './squat';

export const EXERCISES: readonly ExerciseSpec[] = [
  squat,
  jumpingJack,
  overheadPress,
  lateralRaise,
  lunge,
  highKnees,
  sideBend,
  kneeToElbow,
  overheadSquat,
  pushUp,
  plank,
];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function exerciseById(id: string): ExerciseSpec | undefined {
  return BY_ID.get(id);
}

export function requireExercise(id: string): ExerciseSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`неизвестное упражнение: ${id}`);
  return spec;
}

export const GROUP_LABEL: Record<MuscleGroup, string> = {
  legs: 'Ноги',
  upper: 'Верх тела',
  core: 'Корпус',
  cardio: 'Кардио',
};

export interface WorkoutStep {
  exerciseId: string;
  /** Повторений или секунд — зависит от режима упражнения. */
  target: number;
}

export interface WorkoutPlan {
  /** Короткий режим завершается по времени активной работы, пауза не входит. */
  durationSec?: number;
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Оценка длительности в минутах, для карточки выбора. */
  minutes: number;
  /** Секунд отдыха между упражнениями. */
  restSec: number;
  steps: readonly WorkoutStep[];
}

/**
 * Программы, которые не требуют переставлять камеру: все упражнения снимаются
 * с одного фронтального положения. Программы с видом сбоку вынесены отдельно и
 * помечены в описании.
 */
export const WORKOUTS: readonly WorkoutPlan[] = [
  {
    id: 'repair', name: 'Зеркало: исправь движение', description: '75 секунд приседаний в удобном темпе. Заметь подсказку, проверь исправление, сравни попытки.',
    icon: '✦', minutes: 1, restSec: 0, durationSec: 75,
    steps: [{ exerciseId: 'squat', target: 999 }],
  },
  {
    id: 'motion', name: 'Три движения · MOTION', description: 'Присед, джампы и жим. По 3 повтора, одна камера спереди.',
    icon: '◉', minutes: 1, restSec: 5,
    steps: [{ exerciseId: 'squat', target: 3 }, { exerciseId: 'jumping-jack', target: 3 }, { exerciseId: 'overhead-press', target: 3 }],
  },
  {
    id: 'quick',
    name: 'Быстрая разминка',
    description: 'Три упражнения, одно положение камеры. Хороший первый запуск.',
    icon: '⚡',
    minutes: 4,
    restSec: 20,
    steps: [
      { exerciseId: 'jumping-jack', target: 16 },
      { exerciseId: 'squat', target: 10 },
      { exerciseId: 'overhead-press', target: 12 },
    ],
  },
  {
    id: 'full-body',
    name: 'Всё тело',
    description: 'Пять упражнений на ноги, верх тела и корпус. Камера стоит спереди.',
    icon: '🔥',
    minutes: 9,
    restSec: 25,
    steps: [
      { exerciseId: 'jumping-jack', target: 20 },
      { exerciseId: 'squat', target: 12 },
      { exerciseId: 'overhead-press', target: 14 },
      { exerciseId: 'lunge', target: 12 },
      { exerciseId: 'side-bend', target: 16 },
    ],
  },
  {
    id: 'cardio',
    name: 'Кардио',
    description: 'Высокий темп: прыжки, бег на месте, скручивания.',
    icon: '💓',
    minutes: 6,
    restSec: 20,
    steps: [
      { exerciseId: 'jumping-jack', target: 24 },
      { exerciseId: 'high-knees', target: 30 },
      { exerciseId: 'knee-to-elbow', target: 16 },
      { exerciseId: 'jumping-jack', target: 24 },
    ],
  },
  {
    id: 'legs',
    name: 'Ноги',
    description: 'Присед, выпады и присед с руками над головой — тест подвижности.',
    icon: '🦵',
    minutes: 7,
    restSec: 30,
    steps: [
      { exerciseId: 'squat', target: 14 },
      { exerciseId: 'lunge', target: 12 },
      { exerciseId: 'overhead-squat', target: 10 },
    ],
  },
  {
    id: 'floor',
    name: 'Упор лёжа',
    description: 'Отжимания и планка. Камеру нужно поставить сбоку, на уровне пола.',
    icon: '🧱',
    minutes: 5,
    restSec: 35,
    steps: [
      { exerciseId: 'push-up', target: 10 },
      { exerciseId: 'plank', target: 40 },
      { exerciseId: 'push-up', target: 8 },
    ],
  },
];

export function workoutById(id: string): WorkoutPlan | undefined {
  if (id.startsWith('single-')) {
    const spec = exerciseById(id.slice(7));
    if (spec) return singleExerciseWorkout(spec);
  }
  return WORKOUTS.find((w) => w.id === id);
}

/** Программа из одного упражнения — для режима «свободная тренировка». */
export function singleExerciseWorkout(spec: ExerciseSpec): WorkoutPlan {
  return {
    id: `single-${spec.id}`,
    name: spec.name,
    description: spec.setup,
    icon: spec.icon,
    minutes: 3,
    restSec: 0,
    steps: [{ exerciseId: spec.id, target: spec.defaultTarget }],
  };
}
