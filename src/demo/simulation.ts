import { pose, bendFor } from './pose';
import type { Body } from '../vision/landmarks';

export interface DemoMotion { exerciseId: string; running: boolean }

/** Явная симуляция координат. MediaPipe не вызывается, ошибки заданы сценарием.
 * Эти координаты проходят обычные счётчик, анализатор и итоговую статистику. */
export class DemoSimulation {
  private key = '';
  private startedAt = 0;
  private sample = 0;
  private cached: Body | null = null;

  frame(t: number, motion: DemoMotion | null): Body {
    const key = `${motion?.exerciseId}:${motion?.running}`;
    if (key !== this.key) { this.key = key; this.startedAt = t; this.cached = null; }
    if (this.cached && t - this.cached.t < 1000 / 30) return this.cached;
    const elapsed = motion?.running ? Math.max(0, t - this.startedAt - 600) : 0;
    const cycle = Math.floor(elapsed / 3400);
    const phase = (elapsed % 3400) / 3400;
    const progress = phase < 0.12 || phase > 0.88 ? 0 : Math.sin((phase - 0.12) / 0.76 * Math.PI);
    const shallow = cycle === 0;
    const id = motion?.exerciseId;
    const params = id === 'jumping-jack'
      ? { armElevation: 8 + progress * (shallow ? 100 : 160), ankleHalf: 0.1 + progress * 0.23 }
      : id === 'overhead-press'
        ? { armElevation: 78 + progress * 94, elbowBend: 92 + progress * (shallow ? 50 : 83) }
        : { bend: bendFor(180 - progress * (shallow ? 55 : 94)) };
    // Более мелкая проекция сохраняет кисти над головой внутри кадра.
    const b = pose(params);
    this.cached = { ...b, screen: b.screen.map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.8, y: 0.52 + (p.y - 0.5) * 0.8 })), t, dt: 1 / 30, sampleId: ++this.sample };
    return this.cached;
  }
}
