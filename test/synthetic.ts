/**
 * Синтетические позы для тестов.
 *
 * Скелет строится из параметров (угол в колене, наклон корпуса, сведение колен),
 * поэтому движок можно проверять без камеры и без записанного видео: мы точно
 * знаем, какое движение подаём на вход, и можем сравнить с тем, что насчитал
 * счётчик.
 *
 * Система координат повторяет MediaPipe world landmarks: начало между бёдрами,
 * ось Y направлена вниз, Z — от камеры.
 */

import type { Body } from '../src/vision/landmarks';
import { LANDMARK_COUNT, LANDMARK_INDEX, buildFrame } from '../src/vision/landmarks';
import type { Vec3 } from '../src/vision/geometry';

const TORSO = 0.5;
const SHOULDER_HALF = 0.19;
const HIP_HALF = 0.09;
const FEMUR = 0.45;
const SHIN = 0.45;

/** Стойка «на ширине плеч»: колени и стопы примерно под плечами. */
const STANCE_HALF = 0.17;

/** Масштаб проекции в кадр: человек ростом 1,6 м занимает около 73% кадра. */
const PROJECT = 0.45;

export interface PoseParams {
  /** Угол сгиба ноги: 0 — стоя прямо, 45 — бедро параллельно полу. */
  bend?: number;
  /** Наклон корпуса вперёд, градусы. */
  lean?: number;
  /** Боковой наклон корпуса, градусы (положительное — влево). */
  tilt?: number;
  /** Полуразнос колен по горизонтали, м. Меньше STANCE_HALF — колени внутрь. */
  kneeHalf?: number;
  /** Полуразнос стоп по горизонтали, м. */
  ankleHalf?: number;
  /** Подъём рук: 0 — вдоль тела, 180 — над головой. */
  armElevation?: number;
  /** Вынос левой стопы вперёд, м (для выпадов). */
  frontFoot?: number;
  /** Угол в локте, градусы: 180 — рука прямая. */
  elbowBend?: number;
  /** Упор лёжа: та же поза, повёрнутая в горизонталь. */
  prone?: boolean;
  visibility?: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Поворот вектора: сначала вперёд на lean (вокруг оси X), затем вбок на tilt
 * (вокруг оси Z). Все три оси корпуса поворачиваются вместе, поэтому голова
 * остаётся над грудью при любом наклоне — иначе определение направления
 * «из груди» по носу давало бы неверный знак.
 */
function rotate(v: Vec3, lean: number, tilt: number): Vec3 {
  const l = rad(lean);
  const t = rad(tilt);
  const y1 = v.y * Math.cos(l) - v.z * Math.sin(l);
  const z1 = v.y * Math.sin(l) + v.z * Math.cos(l);
  return {
    x: v.x * Math.cos(t) - y1 * Math.sin(t),
    y: v.x * Math.sin(t) + y1 * Math.cos(t),
    z: z1,
  };
}

const along = (axis: Vec3, k: number): Vec3 => ({ x: axis.x * k, y: axis.y * k, z: axis.z * k });
const plus = (...vs: Vec3[]): Vec3 =>
  vs.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });

export function pose(params: PoseParams = {}): Body {
  const {
    bend = 0,
    lean = 0,
    tilt = 0,
    kneeHalf = STANCE_HALF,
    ankleHalf = STANCE_HALF,
    armElevation = 0,
    frontFoot = 0,
    elbowBend = 180,
    prone = false,
    visibility = 0.98,
  } = params;

  const pts: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (name: keyof typeof LANDMARK_INDEX, v: Vec3): void => {
    pts[LANDMARK_INDEX[name]] = v;
  };

  // Оси корпуса. В координатах MediaPipe ось Y смотрит вниз, Z — от камеры,
  // поэтому «вверх» это (0, −1, 0), а «из груди» — (0, 0, −1).
  const up = rotate({ x: 0, y: -1, z: 0 }, lean, tilt);
  const fwd = rotate({ x: 0, y: 0, z: -1 }, lean, tilt);
  const side = rotate({ x: 1, y: 0, z: 0 }, lean, tilt);
  const midShoulder = along(up, TORSO);

  set('left_hip', { x: HIP_HALF, y: 0, z: 0 });
  set('right_hip', { x: -HIP_HALF, y: 0, z: 0 });
  set('left_shoulder', plus(midShoulder, along(side, SHOULDER_HALF)));
  set('right_shoulder', plus(midShoulder, along(side, -SHOULDER_HALF)));

  // Голова едет вместе с корпусом: нос выше плеч и впереди груди.
  set('nose', plus(midShoulder, along(up, 0.2), along(fwd, 0.1)));
  set('left_ear', plus(midShoulder, along(up, 0.19), along(side, 0.08)));
  set('right_ear', plus(midShoulder, along(up, 0.19), along(side, -0.08)));

  // Ноги: бедро уходит вперёд на bend, голень — назад на тот же угол, поэтому
  // стопа остаётся под тазом, а угол в колене равен 180 − 2·bend.
  const kneeY = FEMUR * Math.cos(rad(bend));
  const kneeZ = -FEMUR * Math.sin(rad(bend));
  const ankleY = kneeY + SHIN * Math.cos(rad(bend));

  set('left_knee', { x: kneeHalf, y: kneeY, z: kneeZ });
  set('right_knee', { x: -kneeHalf, y: kneeY, z: kneeZ });
  set('left_ankle', { x: ankleHalf, y: ankleY, z: -frontFoot });
  set('right_ankle', { x: -ankleHalf, y: ankleY, z: frontFoot });
  set('left_heel', { x: ankleHalf, y: ankleY + 0.02, z: 0.03 - frontFoot });
  set('right_heel', { x: -ankleHalf, y: ankleY + 0.02, z: 0.03 + frontFoot });
  set('left_foot_index', { x: ankleHalf, y: ankleY + 0.03, z: -0.14 - frontFoot });
  set('right_foot_index', { x: -ankleHalf, y: ankleY + 0.03, z: -0.14 + frontFoot });

  // Руки: прямая рука поворачивается в плоскости корпуса от положения «вдоль
  // тела» (0°) до «над головой» (180°).
  const upperArm = 0.28;
  const foreArm = 0.26;
  for (const which of ['left', 'right'] as const) {
    const sign = which === 'left' ? 1 : -1;
    const shoulder = plus(midShoulder, along(side, sign * SHOULDER_HALF));
    const a = rad(armElevation);
    // 0° — вниз (−up), 90° — в сторону, 180° — вверх (+up).
    const dir = plus(along(up, -Math.cos(a)), along(side, sign * Math.sin(a)));
    const elbow = plus(shoulder, along(dir, upperArm));

    // Предплечье отклоняем от плеча так, чтобы угол в локте равнялся elbowBend.
    // Отклоняем в направлении «из груди» — оно перпендикулярно плоскости руки.
    const e = rad(elbowBend);
    const foreDir = plus(along(dir, -Math.cos(e)), along(fwd, Math.sin(e)));

    set(`${which}_elbow` as const, elbow);
    set(`${which}_wrist` as const, plus(elbow, along(foreDir, foreArm)));
  }

  // Упор лёжа: та же поза, повёрнутая на 90° — плечи и таз оказываются на одной
  // высоте кадра, и код может отличить лежащего человека от стоящего.
  const points = prone ? pts.map(toProne) : pts;

  const frame = buildFrame(points);

  return {
    world: points,
    // Грубая ортографическая проекция: метр тела занимает PROJECT долей кадра,
    // чтобы человек помещался целиком и проходил проверку кадрирования.
    screen: points.map((p) => ({ x: 0.5 + p.x * PROJECT, y: 0.5 + p.y * PROJECT, z: p.z })),
    visibility: new Array(LANDMARK_COUNT).fill(visibility),
    frame,
    t: 0,
    dt: 1 / 30,
  };
}

/**
 * Упор лёжа так, как его видит камера сбоку.
 *
 * Поворот переводит оси стоящего человека в лежащего: «вверх по корпусу» ложится
 * вдоль кадра, линия плеч уходит в глубину (одно плечо закрывает другое),
 * «из груди» смотрит в пол. Поворот на 90° вокруг одной оси тут не годится: он
 * оставил бы плечи разнесёнными по кадру, то есть человека, лежащего лицом к
 * камере, — такой ракурс камерой сбоку не снимается.
 */
const toProne = (p: Vec3): Vec3 => ({ x: p.y, y: -p.z, z: -p.x });

/** Угол в колене для заданного bend. */
export const kneeAngleFor = (bend: number): number => 180 - 2 * bend;

/** Обратное преобразование: какой bend даёт нужный угол в колене. */
export const bendFor = (kneeAngle: number): number => (180 - kneeAngle) / 2;
