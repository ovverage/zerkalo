/** Частота новых результатов, включая «поза не найдена». Кадры отрисовки не входят. */
export class InferenceMeter {
  private times: number[] = [];
  result(now: number): void { this.times.push(now); this.trim(now); }
  fps(now: number): number {
    this.trim(now);
    if (this.times.length < 2) return 0;
    return (this.times.length - 1) * 1000 / Math.max(1, now - this.times[0]!);
  }
  reset(): void { this.times = []; }
  private trim(now: number): void { this.times = this.times.filter(t => now - t <= 5000); }
}
