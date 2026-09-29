/**
 * Удержание экрана включённым во время тренировки.
 *
 * Человек стоит в двух-трёх метрах от устройства и ничего не трогает, поэтому
 * телефон через полминуты гасит экран прямо посреди подхода. Wake Lock снимает
 * эту проблему; там, где API недоступен, приложение просто работает как раньше.
 *
 * Блокировка снимается системой при сворачивании вкладки, поэтому её нужно
 * запрашивать заново при возвращении — иначе после первого же переключения окна
 * экран снова начнёт гаснуть.
 */

export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private listening = false;

  get isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    this.listen();
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel?.release();
    } catch {
      /* уже снята системой */
    }
  }

  private async request(): Promise<void> {
    if (!this.wanted || !this.isSupported || this.sentinel) return;
    if (document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Отказ возможен при низком заряде — не повод ломать тренировку.
      this.sentinel = null;
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.request();
    });
  }
}
