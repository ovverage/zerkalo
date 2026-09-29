/**
 * Меню: программы, отдельные упражнения, настройки, прогресс.
 *
 * Все кнопки помечены data-dwell, поэтому выбираются удержанием кисти. Обычный
 * клик мышью тоже работает — обработчик один и тот же.
 */

import { Screen } from '../../core/screen';
import type { DrawHints, ScreenFrame } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import { esc, plural } from '../../core/dom';
import {
  EXERCISES,
  GROUP_LABEL,
  WORKOUTS,
  requireExercise,
  singleExerciseWorkout,
  workoutById,
} from '../../exercises/registry';
import { loadPrefs, savePrefs } from '../../storage/prefs';
import type { ModelQuality } from '../../storage/prefs';
import { exerciseGuide, exerciseMedia } from '../../exercises/guides';

export class MenuScreen extends Screen {
  private get workouts() { return this.app.source === 'demo' ? WORKOUTS.filter(w => w.id === 'motion' || w.id === 'repair') : WORKOUTS; }
  private get exercises() { return this.app.source === 'demo' ? EXERCISES.slice(0, 3) : EXERCISES; }
  protected override template(): string {
    const totals = this.app.history.totals();
    const prefs = loadPrefs();

    return `
      <div class="screen screen--scroll menu">
        <header class="menu__head">
          <div>
            <p class="guide-eyebrow">${this.app.source === 'demo' ? 'Знакомство с интерфейсом' : this.app.hasVision ? '● Камера подключена' : 'Библиотека движений'}</p>
            <h2 class="menu__title">Выбери тренировку</h2>
            <p class="menu__lead">Сначала — видеопоказ и настройка камеры. Затем — тренировка в твоём темпе.</p>
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
                      data-dwell="workout-${w.id}" data-action="workout-${w.id}">
                <span class="card__icon">${w.icon}</span>
                <span class="card__name">${esc(w.name)}</span>
                <span class="card__meta">${w.minutes} мин · ${w.steps.length} ${plural(w.steps.length, 'упражнение', 'упражнения', 'упражнений')}</span>
                <span class="card__desc">${esc(w.description)}</span>
                <span class="card__list">${esc(names)}</span>
                ${side ? '<span class="card__badge">камера сбоку</span>' : ''}
              </button>`;
          }).join('')}
        </div>

        <h3 class="menu__sub">Отдельное упражнение <span>${this.exercises.length} движений с видеопоказом</span></h3>
        <div class="chips">
          ${this.exercises.map(
            (e) => `
            <button class="chip" data-dwell="ex-${e.id}" data-action="ex-${e.id}">
              <span class="chip__visual"><img src="${exerciseMedia(e.id, 'svg')}" alt="" loading="lazy"><span class="chip__play">▶ Видеопоказ</span></span>
              <span class="chip__body"><span class="chip__group">${GROUP_LABEL[e.group]}</span>
                <span class="chip__name">${esc(e.short)}</span>
                <span class="chip__camera">${esc(exerciseGuide(e.id).camera)}</span></span>
            </button>`,
          ).join('')}
        </div>

        <footer class="menu__foot">
          <button class="toggle ${prefs.voice ? 'toggle--on' : ''}" data-dwell="t-voice" data-action="voice">
            <span data-el="voiceLabel">${prefs.voice ? '🔊 Голос: только важное · ≥10 с' : '🔇 Голос выключен'}</span>
          </button>
          <button class="toggle ${prefs.sound ? 'toggle--on' : ''}" data-dwell="t-sound" data-action="sound">
            🎵 Звуки
          </button>
          <button class="toggle ${prefs.mirrored ? 'toggle--on' : ''}" data-dwell="t-mirror" data-action="mirror">
            🪞 Зеркало
          </button>
          <button class="toggle ${prefs.model !== 'lite' ? 'toggle--on' : ''}"
                  data-dwell="t-model" data-action="model"
                  title="Нажми для переключения: Heavy → Full → Lite. Если видео тормозит, выбери более лёгкую модель.">
            🧠 <span data-el="modelLabel">${MODEL_LABEL[prefs.model]}</span>
          </button>
          <button class="toggle" data-dwell="t-history" data-action="history">📈 Прогресс</button>
          <button class="toggle" data-dwell="t-tutorial" data-action="tutorial">👋 Жесты</button>
        </footer>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    const map: Record<string, () => void> = {
      history: () => this.app.go({ name: 'history' }),
      tutorial: () => this.app.go({ name: 'tutorial' }),
      voice: () => this.flip('voice'),
      sound: () => this.flip('sound'),
      mirror: () => this.flip('mirrored'),
      model: () => void this.switchModel(),
    };

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

  override onGesture(gesture: GestureName): void {
    if (gesture === 'confirm') {
      const first = WORKOUTS[0];
      if (first) this.startWorkout(first.id);
    }
  }

  private startWorkout(id: string): void {
    const plan = workoutById(id);
    if (plan) this.app.go({ name: 'preview', plan });
  }

  /**
   * Переключение модели перезагружает распознавание, поэтому кнопка на это время
   * блокируется и показывает прогресс: иначе непонятно, почему приложение
   * несколько секунд не видит позу.
   */
  private async switchModel(): Promise<void> {
    const button = this.q<HTMLButtonElement>('[data-action="model"]');
    if (!button || button.disabled) return;

    const previous = loadPrefs().model;
    const next: ModelQuality = previous === 'heavy' ? 'full' : previous === 'full' ? 'lite' : 'heavy';
    const label = this.q('[data-el="modelLabel"]');

    button.disabled = true;
    try {
      await this.app.setModelQuality(next, (p) => {
        if (label) label.textContent = `Загрузка ${Math.round(p.ratio * 100)}%`;
      });
      if (label) label.textContent = MODEL_LABEL[next];
      button.classList.toggle('toggle--on', next !== 'lite');
    } catch {
      if (label) label.textContent = this.app.hasVision ? `${MODEL_LABEL[previous]} · переключение не удалось` : 'Не удалось загрузить · запусти камеру заново';
      this.app.coach.say('Не удалось загрузить модель.', 'high');
    } finally {
      button.disabled = false;
    }
  }

  private flip(key: 'voice' | 'sound' | 'mirrored'): void {
    const prefs = loadPrefs();
    const next = { ...prefs, [key]: !prefs[key] };
    savePrefs(next);

    if (key === 'voice') {
      this.app.coach.setEnabled(next.voice);
      this.setText('[data-el="voiceLabel"]', next.voice ? '🔊 Голос: только важное · ≥10 с' : '🔇 Голос выключен');
    }
    if (key === 'sound') this.app.sound.setEnabled(next.sound);
    if (key === 'mirrored') this.app.mirrored = next.mirrored;

    const selector = key === 'mirrored' ? '[data-action="mirror"]' : `[data-action="${key}"]`;
    this.q(selector)?.classList.toggle('toggle--on', next[key]);
  }
}

const MODEL_LABEL: Record<ModelQuality, string> = { heavy: 'Максимальная точность · Heavy', full: 'Баланс · Full', lite: 'Быстрая · Lite' };
