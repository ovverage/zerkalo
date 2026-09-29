/**
 * Именованный доступ к 33 точкам MediaPipe Pose и система координат тела.
 *
 * Названия left/right — со стороны человека, не со стороны экрана. Видео мы
 * зеркалим, поэтому «левая рука» в подсказке = настоящая левая рука пользователя.
 */

import type { Vec3 } from './geometry';
import { cross, dist, len, mid, normalize, scale, sub } from './geometry';

export const LANDMARK_INDEX = {
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
} as const;

export type LandmarkName = keyof typeof LANDMARK_INDEX;

export const LANDMARK_COUNT = 33;

/** Скелет для отрисовки: пары индексов. */
export const SKELETON_EDGES: ReadonlyArray<readonly [LandmarkName, LandmarkName]> = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['left_ankle', 'left_heel'],
  ['left_heel', 'left_foot_index'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['right_ankle', 'right_heel'],
  ['right_heel', 'right_foot_index'],
];

/** Группы для подсветки проблемной части тела в подсказках. */
export const LANDMARK_GROUPS = {
  knees: ['left_knee', 'right_knee'],
  left_knee: ['left_knee'],
  right_knee: ['right_knee'],
  hips: ['left_hip', 'right_hip'],
  torso: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
  arms: ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'],
  left_arm: ['left_shoulder', 'left_elbow', 'left_wrist'],
  right_arm: ['right_shoulder', 'right_elbow', 'right_wrist'],
  elbows: ['left_elbow', 'right_elbow'],
  wrists: ['left_wrist', 'right_wrist'],
  feet: ['left_ankle', 'right_ankle', 'left_foot_index', 'right_foot_index'],
  legs: ['left_hip', 'left_knee', 'left_ankle', 'right_hip', 'right_knee', 'right_ankle'],
  head: ['nose', 'left_ear', 'right_ear'],
} as const satisfies Record<string, readonly LandmarkName[]>;

export type LandmarkGroupName = keyof typeof LANDMARK_GROUPS;

export function expandGroups(groups: readonly LandmarkGroupName[]): Set<LandmarkName> {
  const out = new Set<LandmarkName>();
  for (const g of groups) for (const n of LANDMARK_GROUPS[g]) out.add(n);
  return out;
}

/**
 * Система координат тела. Все оси выводятся из самих точек, а не из осей кадра,
 * поэтому измерения не ломаются при наклоне камеры или повороте корпуса.
 */
export interface BodyFrame {
  /** Направление «вверх по корпусу»: от центра бёдер к центру плеч. */
  up: Vec3;
  /** Направление «вдоль плеч»: от правого плеча к левому. */
  side: Vec3;
  /** Направление «от груди вперёд» (up × side). */
  forward: Vec3;
  /** Длина корпуса в метрах — единица измерения для всех расстояний. */
  torso: number;
  /** Ширина плеч в метрах. */
  shoulderWidth: number;
  /** Ширина бёдер в метрах. */
  hipWidth: number;
  midHip: Vec3;
  midShoulder: Vec3;
}

/** Поза одного кадра: сглаженные метрические точки + сырые координаты кадра. */
export interface Body {
  /** Метрические 3D-координаты (метры, начало между бёдрами), сглаженные. */
  world: readonly Vec3[];
  /** Нормализованные координаты кадра [0..1] — только для отрисовки и курсора. */
  screen: readonly Vec3[];
  /** Достоверность каждой точки [0..1]. */
  visibility: readonly number[];
  frame: BodyFrame;
  /** Camera aspect ratio, needed for metric screen geometry. */
  imageAspect?: number;
  /** Monotonic inference ID; repeated display frames must not add hold time. */
  sampleId?: number;
  /** Время кадра, мс. */
  t: number;
  /** Интервал с предыдущего кадра, с. */
  dt: number;
}

export function wp(body: Body, name: LandmarkName): Vec3 {
  const v = body.world[LANDMARK_INDEX[name]];
  if (!v) throw new Error(`отсутствует точка ${name}`);
  return v;
}

export function sp(body: Body, name: LandmarkName): Vec3 {
  const v = body.screen[LANDMARK_INDEX[name]];
  if (!v) throw new Error(`отсутствует точка ${name}`);
  return v;
}

export function vis(body: Body, name: LandmarkName): number {
  return body.visibility[LANDMARK_INDEX[name]] ?? 0;
}

/** Минимальная достоверность среди перечисленных точек. */
export function minVis(body: Body, names: readonly LandmarkName[]): number {
  let m = 1;
  for (const n of names) m = Math.min(m, vis(body, n));
  return m;
}

export function buildFrame(world: readonly Vec3[]): BodyFrame {
  const ls = world[LANDMARK_INDEX.left_shoulder];
  const rs = world[LANDMARK_INDEX.right_shoulder];
  const lh = world[LANDMARK_INDEX.left_hip];
  const rh = world[LANDMARK_INDEX.right_hip];
  if (!ls || !rs || !lh || !rh) throw new Error('недостаточно точек для системы координат тела');

  const midShoulder = mid(ls, rs);
  const midHip = mid(lh, rh);
  const up = normalize(sub(midShoulder, midHip));
  const rawSide = sub(ls, rs);
  // Ортогонализация Грама — Шмидта: убираем из «вдоль плеч» составляющую вверх.
  const side = normalize(sub(rawSide, scaleAlong(up, rawSide)));

  // Знак векторного произведения зависит от соглашения об осях, а полагаться на
  // соглашение MediaPipe не хочется: направление «вперёд» ориентируем по носу —
  // он всегда впереди грудной клетки. После этого forward гарантированно
  // указывает из груди, и все измерения «вперёд/назад» получают смысл.
  let forward = normalize(cross(up, side));
  const nose = world[LANDMARK_INDEX.nose];
  if (nose && dotRaw(sub(nose, midShoulder), forward) < 0) {
    forward = scale(forward, -1);
  }

  return {
    up,
    side,
    forward,
    torso: Math.max(len(sub(midShoulder, midHip)), 1e-3),
    shoulderWidth: Math.max(dist(ls, rs), 1e-3),
    hipWidth: Math.max(dist(lh, rh), 1e-3),
    midHip,
    midShoulder,
  };
}

const dotRaw = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function scaleAlong(axis: Vec3, v: Vec3): Vec3 {
  const k = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  return { x: axis.x * k, y: axis.y * k, z: axis.z * k };
}

/** Высота точки над центром бёдер в долях длины корпуса. */
export function height(body: Body, name: LandmarkName): number {
  const v = sub(wp(body, name), body.frame.midHip);
  return dotV(v, body.frame.up) / body.frame.torso;
}

/** Смещение точки вдоль линии плеч в долях длины корпуса (положительное — влево). */
export function lateral(body: Body, name: LandmarkName): number {
  const v = sub(wp(body, name), body.frame.midHip);
  return dotV(v, body.frame.side) / body.frame.torso;
}

/** Вынос точки вперёд от плоскости тела в долях длины корпуса. */
export function depth(body: Body, name: LandmarkName): number {
  const v = sub(wp(body, name), body.frame.midHip);
  return dotV(v, body.frame.forward) / body.frame.torso;
}

/** Расстояние между двумя точками в долях длины корпуса. */
export function span(body: Body, a: LandmarkName, b: LandmarkName): number {
  return dist(wp(body, a), wp(body, b)) / body.frame.torso;
}

function dotV(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
