/**
 * Меню: программы, отдельные упражнения, настройки, прогресс.
 *
 * Две отдельные вкладки для программ и упражнений. Настройки вынесены отдельно.
 */

import type { AppApi } from '../../core/screen';
import { Screen } from '../../core/screen';
import type { DrawHints, ScreenFrame } from '../../core/screen';
import { esc, plural } from '../../core/dom';
import {
  EXERCISES,
  GROUP_LABEL,
  WORKOUTS,
  requireExercise,
  singleExerciseWorkout,
  workoutById,
} from '../../exercises/registry';
import { exerciseGuide, exerciseMedia } from '../../exercises/guides';

export class MenuScreen extends Screen {
  override get gestureNavigation() { return { key: 'menu', defaultAction: 'workout-repair' }; }
  private get workouts() { return this.app.source === 'demo' ? WORKOUTS.filter(w => w.id === 'motion' || w.id === 'repair') : WORKOUTS; }
  private get exercises() { return this.app.source === 'demo' ? EXERCISES.slice(0, 3) : EXERCISES; }
  constructor(app: AppApi, private readonly section: 'programs' | 'exercises' = 'programs') { super(app); }
  protected override template(): string {
    const totals = this.app.history.totals();

    return `
      <div class="screen screen--scroll menu">
        <header class="menu__head">
          <div>
            <h2 class="menu__title">${this.section === 'programs' ? 'Тренировки' : 'Упражнения'}</h2>
            <p class="menu__lead">${this.section === 'programs' ? 'Выбери программу.' : 'Техника и отдельные подходы.'}</p>
          </div>
          ${
            totals.sessions > 0
              ? `<div class="streak">
                   <b>${totals.streakDays}</b>
                   <span>${plural(totals.streakDays, 'день', 'дня', 'дней')} подряд</span>
                 </div>`
              : ''
          }
        </header>

        ${this.section === 'programs' ? `
        <div class="menu-summary"><span>${this.workouts.length} ${plural(this.workouts.length, 'программа', 'программы', 'программ')}</span><span>${this.exercises.length} ${plural(this.exercises.length, 'упражнение', 'упражнения', 'упражнений')}</span></div>
        <h3 class="menu__sub">Готовые программы <span>Несколько упражнений подряд</span></h3>
        <div class="cards">
          ${this.workouts.map((w, i) => {
            const names = w.steps
              .map((s) => requireExercise(s.exerciseId).short)
              .filter((n, idx, arr) => arr.indexOf(n) === idx)
              .join(' · ');
            const side = w.steps.some((s) => requireExercise(s.exerciseId).view === 'side');
            return `
              <button class="card ${i === 0 ? 'card--accent' : ''}"
                      data-action="workout-${w.id}" data-gesture-label="${esc(w.name)}">
                <span class="card__icon">${w.icon}</span>
                <span class="card__name">${esc(w.name)}</span>
                <span class="card__meta">${w.durationSec ? `${w.durationSec} секунд` : `${w.minutes} мин`} · ${w.steps.length} ${plural(w.steps.length, 'упражнение', 'упражнения', 'упражнений')}</span>
                <span class="card__desc">${esc(w.description)}</span>
                <span class="card__list">${esc(names)}</span>
                ${side ? '<span class="card__badge">камера сбоку</span>' : ''}
              </button>`;
          }).join('')}
        </div>

        ` : `
        <h3 class="menu__sub">Видеотека <span>${this.exercises.length} движений с видеопоказом</span></h3>
        <div class="chips">
          ${this.exercises.map(
            (e) => `
            <button class="chip" data-action="ex-${e.id}">
              <span class="chip__visual"><img src="${exerciseMedia(e.id, 'svg')}" alt="" loading="lazy"><span class="chip__play">▶ Видеопоказ</span></span>
              <span class="chip__body"><span class="chip__group">${GROUP_LABEL[e.group]}</span>
                <span class="chip__name">${esc(e.short)}</span>
                <span class="chip__camera">${esc(exerciseGuide(e.id).camera)}</span></span>
            </button>`,
          ).join('')}
        </div>

        `}
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    const map: Record<string, () => void> = {};

    for (const w of WORKOUTS) {
      map[`workout-${w.id}`] = () => this.startWorkout(w.id);
    }
    for (const e of EXERCISES) {
      map[`ex-${e.id}`] = () => this.app.go({ name: 'preview', plan: singleExerciseWorkout(e) });
    }
    return map;
  }

  override update(frame: ScreenFrame): DrawHints {
    void frame;
    // Скелет в меню приглушён: он подтверждает, что камера работает, но не
    // перетягивает внимание с карточек.
    return { hide: true };
  }


  private startWorkout(id: string): void {
    const plan = workoutById(id);
    if (plan) this.app.go({ name: 'preview', plan });
  }

}
