/**
 * Режим удержания (планка, стенка): время идёт, только пока поза правильная.
 *
 * Это не таймер. Если таз провис — секундомер останавливается и показывает, что
 * именно нужно поправить. Итоговое качество — доля времени, проведённого в
 * правильной позе.
 */

export class HoldTracker {
  private goodMs = 0;
  private badMs = 0;
  private inPositionSince: number | null = null;

  /** @param ok поза принята и ни одно правило не нарушено */
  tick(ok: boolean, inPosition: boolean, dtMs: number, t: number): void {
    if (!inPosition) {
      this.inPositionSince = null;
      return;
    }
    if (this.inPositionSince === null) this.inPositionSince = t;
    if (ok) this.goodMs += dtMs;
    else this.badMs += dtMs;
  }

  /** Зачтённые секунды. */
  get seconds(): number {
    return this.goodMs / 1000;
  }

  get brokenSeconds(): number {
    return this.badMs / 1000;
  }

  get quality(): number {
    const total = this.goodMs + this.badMs;
    return total < 1 ? 100 : Math.round((this.goodMs / total) * 100);
  }

  get engaged(): boolean {
    return this.inPositionSince !== null;
  }

  reset(): void {
    this.goodMs = 0;
    this.badMs = 0;
    this.inPositionSince = null;
  }
}
