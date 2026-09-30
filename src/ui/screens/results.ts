/**
 * Итоги тренировки — конец законченного сценария.
 *
 * Показываем не только «сколько», но и «как»: качество по упражнениям, разбор
 * частых ошибок и график качества по повторениям. График важен содержательно —
 * по нему видно, техника разваливалась к концу подхода или ошибка была системной
 * с самого начала.
 */

import { Screen } from '../../core/screen';
import type { AppApi, DrawHints } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import type { ExerciseResult, SessionResult } from '../../engine/session';
import type { NewRecord } from '../../storage/history';
import { duration, esc, plural, qualityTone } from '../../core/dom';
import { comparableAttempt, attemptsIn, acceptance } from '../../storage/comparison';
import { workoutById } from '../../exercises/registry';

export class ResultsScreen extends Screen {
  override get gestureNavigation() { return { key: 'results', defaultAction: 'again' }; }
  constructor(
    app: AppApi,
    private readonly result: SessionResult,
    private readonly records: readonly NewRecord[],
    private readonly savedId?: string,
  ) {
    super(app);
  }

  protected override template(): string {
    const r = this.result;
    const tone = qualityTone(r.avgQuality);

    return `
      <div class="screen screen--scroll results">
        ${r.source === 'simulation' ? '<p class="alert">Демонстрационные результаты не записываются в личную историю и не подтверждают точность модели.</p>' : ''}
        <header class="results__head">
          <div class="score" data-tone="${tone}">
            ${scoreRing(r.score)}
            <div class="score__value">${r.score}</div>
            <div class="score__label">баллов</div>
          </div>
          <div>
            <h2 class="results__title">${esc(r.workoutName)}</h2>
            <p class="results__lead">${this.verdict()}</p>
          </div>
        </header>

        ${this.recordsHtml()}

        <div class="stats" data-gesture-section data-gesture-label="Показатели тренировки">
          ${stat(String(r.totalReps), plural(r.totalReps, 'повторение', 'повторения', 'повторений'))}
          ${r.totalHoldSec > 0 ? stat(`${r.totalHoldSec} с`, 'удержание') : ''}
          ${attemptsIn(r) ? stat(`${acceptance(r.totalReps, attemptsIn(r))}%`, `зачтено из ${attemptsIn(r)} попыток`) : ''}
          ${stat(duration(r.durationMs), 'время')}
          ${stat(`${r.avgQuality}%`, 'качество техники')}
          ${r.challenge ? stat(String(r.fixedErrors), 'исправленных правил амплитуды') : ''}
          ${stat(`${r.kcal}`, 'ккал (оценка)')}
        </div>
        <p class="quality-explanation">Качество — средняя оценка завершённых попыток: 100 минус 20 за ошибку и 9 за замечание, минимум 0. Это совпадение с правилами приложения, а не медицинская оценка. Итоговый балл: 60% качества + 40% выполнения плана${r.challenge ? ' по времени' : ''}.</p>
        ${this.comparisonHtml()}

        <h3 class="results__sub">По упражнениям</h3>
        <div class="exlist">
          ${r.exercises.map((e) => this.exerciseHtml(e)).join('')}
        </div>

        ${this.correctionsHtml()}
        ${this.mistakesHtml()}

        <div class="gesture-pages" aria-label="Чтение экрана"><button class="btn btn--ghost" data-gesture-scroll="up">↑ Выше</button><button class="btn btn--ghost" data-gesture-scroll="down">↓ Ниже</button></div><div class="row row--buttons">
          <button class="btn btn--primary" data-action="again">Ещё раз</button>
          <button class="btn btn--ghost" data-action="menu">К тренировкам</button>
          <button class="btn btn--link" data-action="history">Прогресс</button>
        </div>
        <p class="note">Крест подтверждает выделенный пункт. Левая и правая рука в сторону меняют выбор.</p>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    return {
      again: () => this.again(),
      menu: () => this.app.go({ name: 'menu' }),
      history: () => this.app.go({ name: 'history' }),
    };
  }

  protected override onMount(): void {
    const r = this.result;
    const lead =
      this.records.length > 0
        ? `Итог ${r.score} баллов. Новый личный рекорд!`
        : `Итог ${r.score} баллов, качество техники ${r.avgQuality} процентов.`;
    this.app.coach.say(lead, 'high');
  }

  override update(): DrawHints {
    return { hide: true };
  }

  override get gestureHint(): string { return 'Крест — повторить'; }
  override onGesture(gesture: GestureName): void {
    if (gesture === 'cross') this.again();
  }

  private again(): void {
    const plan = workoutById(this.result.workoutId);
    if (plan) this.app.go({ name: 'preview', plan });
    else this.app.go({ name: 'menu' });
  }

  private verdict(): string {
    const r = this.result;
    if (!r.exercises.some(e => e.attempts > 0 || e.done > 0)) return 'Пока нет завершённых движений для оценки. Проверь видимость суставов и попробуй снова.';
    if (r.avgQuality >= 90) return 'Движения соответствуют проверяемым правилам. Хороший результат.';
    if (r.avgQuality >= 75) return 'Хорошая работа. Ниже — что стоит поправить в следующий раз.';
    if (r.avgQuality >= 55) return 'Объём есть, техника просаживается. Разбор ошибок ниже.';
    return 'Сделай меньше повторений, но чище — техника важнее количества.';
  }

  private comparisonHtml(): string {
    const r = this.result;
    if (!r.challenge || r.source === 'simulation') return '';
    const previous = comparableAttempt(r, this.app.history.list(), this.savedId);
    if (!previous) return '<p class="alert" data-gesture-section data-gesture-label="Условия сравнения">Сравнение появится после двух полных попыток по 75 секунд, минимум по 3 завершённых движения. Нужны одинаковая программа, модель и версия правил. Незачтённые попытки тоже учитываются.</p>';
    const before = acceptance(previous.totalReps, previous.attempts!);
    const now = acceptance(r.totalReps, attemptsIn(r));
    const names = (items: readonly { title: string }[]) => items.length ? items.map(c => esc(c.title)).join(' · ') : 'Не было подтверждённых исправлений';
    return `<section class="attempt-comparison" data-gesture-section data-gesture-label="Сравнение попыток"><h3>Две попытки · по 75 секунд</h3>
      <p>Та же программа, модель и правила. Изменение доли зачёта: ${now - before >= 0 ? '+' : ''}${now - before} п.п.</p>
      <div class="attempt-comparison__grid"><article><h4>Предыдущая</h4><b>${previous.totalReps} повт.</b><p>${before}% зачтено · ${previous.totalReps} из ${previous.attempts}</p><p>Исправления: ${names(previous.corrections!)}</p></article>
      <article><h4>Сейчас</h4><b>${r.totalReps} повт.</b><p>${now}% зачтено · ${r.totalReps} из ${attemptsIn(r)}</p><p>Исправления: ${names(r.corrections)}</p></article></div>
      <p class="note">Сравнивай при похожих условиях съёмки. Больше исправлений не значит лучше: выполнить без ошибок — хороший результат.</p></section>`;
  }

  private correctionsHtml(): string {
    if (!this.result.corrections.length) return '';
    return `<section class="alert alert--good" data-gesture-section data-gesture-label="Подтверждённые исправления"><h3>Получилось исправить</h3><ul>${this.result.corrections.map(c => `<li><b>${esc(c.title)}</b> — ${esc(c.message)}</li>`).join('')}</ul><p>Каждое правило проверено в следующем зачтённом повторе. Это исправления за попытку; замечания ниже могут относиться к более ранним повторам.</p></section>`;
  }

  private recordsHtml(): string {
    if (this.records.length === 0) return '';
    return `
      <div class="alert alert--record">
        <b>Новый рекорд!</b>
        ${this.records
          .map((rec) =>
            rec.previous > 0
              ? `${esc(rec.label)}: ${rec.value} (было ${rec.previous})`
              : `${esc(rec.label)}: ${rec.value}`,
          )
          .join(' · ')}
      </div>`;
  }

  private exerciseHtml(e: ExerciseResult): string {
    const unit = e.mode === 'hold' ? 'с' : '';
    const missed = e.mode === 'reps' ? Math.max(e.attempts - e.done, 0) : 0;

    return `
      <div class="exrow" data-gesture-section data-gesture-label="${esc(e.name)}: результат">
        <span class="exrow__icon">${e.icon}</span>
        <div class="exrow__body">
          <div class="exrow__top">
            <b class="exrow__name">${esc(e.name)}</b>
            <span class="exrow__count">${e.done}${unit}${this.result.challenge ? ' повт.' : ` / ${e.target}${unit}`}</span>
          </div>
          <div class="exrow__bar">
            <i style="width:${Math.round(Math.min(e.done / Math.max(this.result.challenge ? e.attempts : e.target, 1), 1) * 100)}%"></i>
          </div>
          <div class="exrow__meta">
            <span data-tone="${qualityTone(e.avgQuality)}">качество ${e.avgQuality}%</span>
            ${missed > 0 ? `<span data-tone="bad">не зачтено ${missed}</span>` : ''}
            ${e.mistakes[0] ? `<span class="exrow__top-mistake">чаще всего: ${esc(e.mistakes[0].title)}</span>` : ''}
          </div>
          ${sparkline(e.qualitySeries)}
        </div>
      </div>`;
  }

  private mistakesHtml(): string {
    const top = this.result.topMistakes;
    if (top.length === 0) {
      return `
        <div class="alert alert--good">
          ${this.result.totalReps + this.result.totalHoldSec > 0 ? 'В завершённых движениях проверяемых ошибок не обнаружено. Хорошая работа.' : 'Недостаточно завершённых движений для вывода о технике.'}
        </div>`;
    }

    return `
      <h3 class="results__sub">Над чем работать</h3>
      <ol class="mistakes">
        ${top
          .map(
            (m) => `
          <li class="mistake" data-gesture-section data-gesture-label="${esc(m.title)}">
            <div class="mistake__head">
              <b>${esc(m.title)}</b>
              <span class="mistake__count">${m.count} ${plural(m.count, 'раз', 'раза', 'раз')}</span>
            </div>
            <p class="mistake__hint">${esc(m.hint)}</p>
          </li>`,
          )
          .join('')}
      </ol>`;
  }
}

/** Кольцо итогового балла: длина дуги пропорциональна значению. */
function scoreRing(score: number): string {
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(score, 100)) / 100) * circumference;

  return `
    <svg class="score__ring" viewBox="0 0 116 116" aria-hidden="true">
      <circle class="score__ring-track" cx="58" cy="58" r="${r}" />
      <circle class="score__ring-value" cx="58" cy="58" r="${r}"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${(circumference - filled).toFixed(1)}"
              style="--dash-full: ${circumference.toFixed(1)}" />
    </svg>`;
}

const stat = (value: string, label: string): string => `
  <div class="stat">
    <div class="stat__value">${esc(value)}</div>
    <div class="stat__label">${esc(label)}</div>
  </div>`;

/**
 * График качества по повторениям. Рисуем инлайновым SVG: график из десятка точек
 * не стоит подключения библиотеки.
 */
function sparkline(series: readonly number[]): string {
  if (series.length < 2) return '';
  const w = 240;
  const h = 34;
  const step = w / (series.length - 1);

  const points = series
    .map((q, i) => `${(i * step).toFixed(1)},${(h - (q / 100) * h).toFixed(1)}`)
    .join(' ');

  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${h * 0.15}" x2="${w}" y2="${h * 0.15}" class="spark__ref" />
      <polyline points="${points}" class="spark__line" />
      ${series
        .map((q, i) => {
          const cx = (i * step).toFixed(1);
          const cy = (h - (q / 100) * h).toFixed(1);
          return `<circle cx="${cx}" cy="${cy}" r="2.4" class="spark__dot" data-tone="${qualityTone(q)}" />`;
        })
        .join('')}
    </svg>`;
}
