/**
 * Визуальные эффекты: вспышка частиц на зачтённом повторении и всплывающий текст.
 *
 * Рисуются на отдельном слое поверх скелета, чтобы не смешивать логику отрисовки
 * позы с декоративной анимацией.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  ttl: number;
  color: string;
  size: number;
}

const GRAVITY = 420;

export class EffectLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d недоступен');
    this.ctx = ctx;
  }

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

  /** Вспышка на зачтённом повторении. Цвет зависит от качества. */
  burst(quality: number): void {
    const x = this.width / 2;
    const y = this.height * 0.42;
    const color = quality >= 85 ? '#7ef9ac' : quality >= 60 ? '#ffd166' : '#ff9f68';
    const count = quality >= 85 ? 34 : 20;

    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 160 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        life: 0,
        ttl: 0.7 + Math.random() * 0.5,
        size: 3 + Math.random() * 4,
        color,
      });
    }
  }

  float(text: string, color: string, size = 46): void {
    this.texts.push({
      text,
      x: this.width / 2,
      y: this.height * 0.4,
      life: 0,
      ttl: 1.1,
      color,
      size,
    });
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);

    for (const p of this.particles) {
      p.life += step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += GRAVITY * step;
      p.vx *= 0.985;
    }
    this.particles = this.particles.filter((p) => p.life < p.ttl);

    for (const t of this.texts) t.life += step;
    this.texts = this.texts.filter((t) => t.life < t.ttl);
  }

  draw(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.particles.length && !this.texts.length) return;

    for (const p of this.particles) {
      const k = 1 - p.life / p.ttl;
      ctx.globalAlpha = k * k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.ttl;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = t.color;
      ctx.font = `800 ${t.size}px "Inter", system-ui, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 18;
      ctx.fillText(t.text, t.x, t.y - k * 70);
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles = [];
    this.texts = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
