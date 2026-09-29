/**
 * Прогресс: итоги за всё время, личные рекорды и список тренировок.
 * Данные берутся из localStorage — сервера у приложения нет.
 */

import { Screen } from '../../core/screen';
import type { DrawHints } from '../../core/screen';
import { dateLabel, duration, esc, plural, qualityTone } from '../../core/dom';

export class HistoryScreen extends Screen {
  protected override template(): string {
    const totals = this.app.history.totals();
    const sessions = this.app.history.list();
    const bests = this.app.history.bests();

    if (sessions.length === 0) {
      return `
        <div class="screen screen--center history">
          <div class="panel">
            <h2 class="panel__title">Прогресс пуст</h2>
            <p class="panel__lead">Пройди первую тренировку — здесь появятся рекорды и история.</p>
            <button class="btn btn--primary" data-action="back">К тренировкам</button>
          </div>
        </div>`;
    }

    return `
      <div class="screen screen--scroll history">
        <header class="results__head">
          <h2 class="results__title">Прогресс</h2>
          <button class="btn btn--ghost" data-action="back">К тренировкам</button>
        </header>

        <div class="stats">
          <div class="stat">
            <div class="stat__value">${totals.sessions}</div>
            <div class="stat__label">${plural(totals.sessions, 'тренировка', 'тренировки', 'тренировок')}</div>
          </div>
          <div class="stat">
            <div class="stat__value">${totals.reps}</div>
            <div class="stat__label">повторений всего</div>
          </div>
          <div class="stat">
            <div class="stat__value">${totals.minutes}</div>
            <div class="stat__label">минут под нагрузкой</div>
          </div>
          <div class="stat">
            <div class="stat__value">${totals.kcal}</div>
            <div class="stat__label">ккал (оценка)</div>
          </div>
          <div class="stat">
            <div class="stat__value">${totals.bestScore}</div>
            <div class="stat__label">лучший балл</div>
          </div>
          <div class="stat">
            <div class="stat__value">${totals.streakDays}</div>
            <div class="stat__label">${plural(totals.streakDays, 'день', 'дня', 'дней')} подряд</div>
          </div>
        </div>

        <h3 class="results__sub">Личные рекорды</h3>
        <div class="bests">
          ${bests
            .map(
              (b) => `
            <div class="best">
              <span class="best__icon">${b.icon}</span>
              <div class="best__body">
                <b>${esc(b.name)}</b>
                <span class="best__meta">
                  ${b.best}${b.mode === 'hold' ? ' с' : ''} ·
                  <span data-tone="${qualityTone(b.quality)}">качество ${b.quality}%</span>
                </span>
              </div>
            </div>`,
            )
            .join('')}
        </div>

        <h3 class="results__sub">История</h3>
        <div class="sessions">
          ${sessions
            .map(
              (s) => `
            <div class="sessionrow">
              <div class="sessionrow__score" data-tone="${qualityTone(s.avgQuality)}">${s.score}</div>
              <div class="sessionrow__body">
                <b>${esc(s.workoutName)}</b>
                <span class="sessionrow__meta">
                  ${dateLabel(s.at)} · ${s.totalReps} повт. · ${duration(s.durationMs)} ·
                  качество ${s.avgQuality}%
                </span>
              </div>
            </div>`,
            )
            .join('')}
        </div>

        <div class="row row--buttons">
          <button class="btn btn--link btn--danger" data-action="clear">Очистить историю</button>
        </div>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    return {
      back: () => this.app.go({ name: 'menu' }),
      clear: () => {
        // Удаление истории — единственное необратимое действие в приложении,
        // поэтому оно доступно только мышью и требует подтверждения.
        if (!window.confirm('Удалить всю историю тренировок? Отменить это будет нельзя.')) return;
        this.app.history.clear();
        this.app.go({ name: 'history' });
      },
    };
  }

  override update(): DrawHints {
    return { hide: true };
  }

}
