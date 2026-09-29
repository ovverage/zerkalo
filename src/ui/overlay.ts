/**
 * Отрисовка скелета поверх видео — основная обратная связь «система тебя видит».
 *
 * Точки, попавшие в подсветку активного нарушения, рисуются красным с пульсацией:
 * пользователь читает одну текстовую подсказку, но сразу видит, к какой части
 * тела она относится.
 */

import type { Body, LandmarkName } from '../vision/landmarks';
import { LANDMARK_INDEX, SKELETON_EDGES } from '../vision/landmarks';
import type { Box } from '../vision/framing';
import { containTransform } from '../vision/viewport';
import type { CursorPoint } from '../gestures/uiGestures';

export interface DrawOptions {
  /** Видео отражено по горизонтали. */
  mirrored: boolean;
  highlight: ReadonlySet<LandmarkName>;
  /** Приглушить скелет — например, во время отдыха. */
  dim?: boolean;
  t: number;
}

const COLOR_BONE = 'rgba(110, 231, 255, 0.85)';
const COLOR_BONE_DIM = 'rgba(110, 231, 255, 0.28)';
const COLOR_JOINT = '#e8fdff';
const COLOR_BAD = '#ff4d6d';
const MIN_VISIBILITY = 0.4;

export class SkeletonOverlay {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d недоступен');
    this.ctx = ctx;
  }

  /** Подгоняет буфер под размер элемента с учётом плотности пикселей. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  draw(body: Body, video: HTMLVideoElement, opts: DrawOptions): void {
    const { ctx } = this;

    const tf = containTransform((video.videoWidth || 1000), (video.videoHeight || 1000), this.width, this.height);
    const project = (name: LandmarkName): { x: number; y: number; v: number } | null => {
      const i = LANDMARK_INDEX[name];
      const p = body.screen[i];
      const v = body.visibility[i] ?? 0;
      if (!p) return null;
      const nx = opts.mirrored ? 1 - p.x : p.x;
      return {
        x: tf.dx + nx * (video.videoWidth || 1000) * tf.scale,
        y: tf.dy + p.y * (video.videoHeight || 1000) * tf.scale,
        v,
      };
    };

    const boneColor = opts.dim ? COLOR_BONE_DIM : COLOR_BONE;
    const joint = Math.max(4, Math.min(this.width, this.height) * 0.008);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [a, b] of SKELETON_EDGES) {
      const pa = project(a);
      const pb = project(b);
      if (!pa || !pb) continue;
      if (pa.v < MIN_VISIBILITY || pb.v < MIN_VISIBILITY) continue;

      const bad = opts.highlight.has(a) && opts.highlight.has(b);
      ctx.strokeStyle = bad ? COLOR_BAD : boneColor;
      ctx.lineWidth = bad ? joint * 1.1 : joint * 0.7;
      ctx.shadowColor = bad ? COLOR_BAD : 'rgba(110, 231, 255, 0.6)';
      ctx.shadowBlur = opts.dim ? 0 : bad ? 18 : 10;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Пульсация подсвеченных точек: 1,6 Гц — заметно, но не раздражает.
    const pulse = 0.65 + 0.35 * Math.sin(opts.t / 1000 * Math.PI * 3.2);

    for (const name of Object.keys(LANDMARK_INDEX) as LandmarkName[]) {
      if (SKIP_JOINTS.has(name)) continue;
      const p = project(name);
      if (!p || p.v < MIN_VISIBILITY) continue;
      const bad = opts.highlight.has(name);

      ctx.beginPath();
      ctx.fillStyle = bad ? COLOR_BAD : COLOR_JOINT;
      ctx.shadowColor = bad ? COLOR_BAD : 'rgba(232, 253, 255, 0.7)';
      ctx.shadowBlur = opts.dim ? 0 : bad ? 22 : 8;
      ctx.arc(p.x, p.y, bad ? joint * (1.1 + 0.5 * pulse) : joint * 0.62, 0, Math.PI * 2);
      ctx.fill();

      if (bad && !opts.dim) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 77, 109, ${0.5 * pulse})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ctx.arc(p.x, p.y, joint * (2.4 + pulse), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;
  }

  /** The guide follows the detected person; there is no fixed target silhouette. */
  drawGuide(ok: boolean, box: Box | null, video: HTMLVideoElement): void {
    if (!box || box.width <= 0 || box.height <= 0) return;
    const { ctx } = this;
    const tf = containTransform((video.videoWidth || 1000), (video.videoHeight || 1000), this.width, this.height);
    const width = (video.videoWidth || 1000) * tf.scale;
    const height = (video.videoHeight || 1000) * tf.scale;
    const x = tf.dx + (this.mirroredBox ? 1 - box.right : box.left) * width;
    const y = tf.dy + box.top * height;
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ok ? 'rgba(126, 249, 172, 0.85)' : 'rgba(255, 209, 102, 0.85)';
    roundRect(ctx, x - 6, y - 6, box.width * width + 12, box.height * height + 12, 14);
    ctx.stroke();
    ctx.restore();
  }

  /** Зеркалить ли рамку найденного человека — задаётся перед drawGuide. */
  mirroredBox = true;

  /** Курсор жестового управления: точка и кольцо удержания. */
  drawCursor(cursor: CursorPoint, dwell: number, active: boolean): void {
    const { ctx } = this;
    const r = Math.max(14, Math.min(this.width, this.height) * 0.024);

    ctx.beginPath();
    ctx.fillStyle = active ? 'rgba(126, 249, 172, 0.95)' : 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = active ? 'rgba(126, 249, 172, 0.9)' : 'rgba(255,255,255,0.6)';
    ctx.shadowBlur = 16;
    ctx.arc(cursor.x, cursor.y, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 3;
    ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (dwell > 0.001) {
      ctx.beginPath();
      ctx.strokeStyle = '#7ef9ac';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.arc(cursor.x, cursor.y, r, -Math.PI / 2, -Math.PI / 2 + dwell * Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Точки лица, кроме носа, только засоряют картинку. */
const SKIP_JOINTS = new Set<LandmarkName>([
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'mouth_left',
  'mouth_right',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
]);

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
