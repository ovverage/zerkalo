/**
 * Фильтр «One Euro» — сглаживание координат и углов.
 *
 * Без него счётчик повторений накручивает лишние срабатывания на дрожании
 * координат: точка колена гуляет на ±2° даже когда человек стоит неподвижно.
 * Обычный экспоненциальный фильтр пришлось бы настраивать компромиссно — либо
 * дрожит, либо отстаёт. One Euro адаптирует силу сглаживания к скорости
 * движения: в покое фильтрует жёстко, на быстром движении почти не мешает.
 *
 * Casiez, Roussel, Vogel (CHI 2012).
 */

const TWO_PI = Math.PI * 2;

function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private y: number | null = null;

  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  reset(): void {
    this.y = null;
  }
}

export interface OneEuroOptions {
  /** Частота среза в покое: меньше — сильнее сглаживание. */
  minCutoff?: number;
  /** Насколько быстро фильтр «отпускает» при росте скорости. */
  beta?: number;
  /** Частота среза для производной. */
  derivativeCutoff?: number;
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private readonly xf = new LowPass();
  private readonly dxf = new LowPass();
  private prev: number | null = null;

  constructor({ minCutoff = 1.4, beta = 0.35, derivativeCutoff = 1 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = derivativeCutoff;
  }

  filter(x: number, dt: number): number {
    if (!Number.isFinite(x)) return this.prev ?? 0;
    const step = dt > 1e-4 ? dt : 1 / 30;
    const dx = this.prev === null ? 0 : (x - this.prev) / step;
    this.prev = x;
    const dxHat = this.dxf.filter(dx, alphaFor(this.dCutoff, step));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    return this.xf.filter(x, alphaFor(cutoff, step));
  }

  reset(): void {
    this.xf.reset();
    this.dxf.reset();
    this.prev = null;
  }
}

/** Набор фильтров по ключу — для сглаживания нескольких величин сразу. */
export class FilterBank {
  private readonly filters = new Map<string, OneEuroFilter>();

  constructor(private readonly options: OneEuroOptions = {}) {}

  filter(key: string, value: number, dt: number): number {
    let f = this.filters.get(key);
    if (!f) {
      f = new OneEuroFilter(this.options);
      this.filters.set(key, f);
    }
    return f.filter(value, dt);
  }

  reset(): void {
    for (const f of this.filters.values()) f.reset();
  }
}

/**
 * Сглаживание всех 33 точек позы покоординатно.
 *
 * Координаты сглаживаем мягче (minCutoff выше), чем производные метрики:
 * точки и так усреднены моделью, а лишняя инерция здесь заметна как «резиновый»
 * скелет на экране.
 */
export class PoseSmoother {
  private readonly bank = new FilterBank({ minCutoff: 2.2, beta: 0.4 });

  smooth(points: readonly { x: number; y: number; z: number }[], dt: number) {
    return points.map((p, i) => ({
      x: this.bank.filter(`${i}x`, p.x, dt),
      y: this.bank.filter(`${i}y`, p.y, dt),
      z: this.bank.filter(`${i}z`, p.z, dt),
    }));
  }

  reset(): void {
    this.bank.reset();
  }
}

/** Кольцевой буфер для оценки скорости и темпа. */
export class Ring {
  private readonly buf: number[] = [];

  constructor(private readonly size: number) {}

  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }

  get length(): number {
    return this.buf.length;
  }

  at(i: number): number {
    return this.buf[i] ?? 0;
  }

  last(): number {
    return this.buf[this.buf.length - 1] ?? 0;
  }

  min(): number {
    return this.buf.length ? Math.min(...this.buf) : 0;
  }

  max(): number {
    return this.buf.length ? Math.max(...this.buf) : 0;
  }

  mean(): number {
    if (!this.buf.length) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  clear(): void {
    this.buf.length = 0;
  }
}
