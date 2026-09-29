/**
 * Звуки на Web Audio API — без звуковых файлов.
 *
 * Синтез вместо сэмплов: ничего не нужно загружать, задержка нулевая, и звук
 * повторения точно совпадает с моментом засчёта.
 */

type Wave = OscillatorType;

export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;

  /** Браузеры разрешают звук только после действия пользователя. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.22 : 0;
  }

  /** Короткий щелчок — зачтённое повторение. */
  rep(): void {
    this.blip(880, 0.07, 'triangle');
    this.blip(1320, 0.06, 'sine', 0.03);
  }

  /** Глухой сигнал — повторение не зачтено. */
  reject(): void {
    this.blip(196, 0.16, 'sawtooth', 0, 0.5);
  }

  /** Предупреждение о технике. */
  warn(): void {
    this.blip(330, 0.1, 'square', 0, 0.35);
  }

  /** Тик отсчёта перед началом. */
  tick(): void {
    this.blip(660, 0.05, 'sine', 0, 0.5);
  }

  /** Упражнение выполнено. */
  stage(): void {
    [523, 659, 784].forEach((f, i) => this.blip(f, 0.16, 'sine', i * 0.09));
  }

  /** Тренировка завершена. */
  finish(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.24, 'triangle', i * 0.12));
  }

  private blip(freq: number, dur: number, wave: Wave, delay = 0, gain = 1): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);

    // Мягкая атака и экспоненциальный спад: без них слышны щелчки на краях.
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}
