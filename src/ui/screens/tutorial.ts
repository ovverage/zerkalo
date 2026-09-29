/**
 * Обучение жестам.
 *
 * Экран существует ради одной проблемы: жестовое управление невозможно угадать.
 * Пользователь здесь по очереди выполняет каждый жест и видит, что система его
 * поняла, — после этого остальной интерфейс становится очевидным. Занимает
 * 15–20 секунд и проходится один раз.
 */

import { Screen } from '../../core/screen';
import type { DrawHints, ScreenFrame } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import { loadPrefs, savePrefs } from '../../storage/prefs';

interface Lesson {
  id: 'confirm' | 'cancel' | 'dwell';
  title: string;
  hint: string;
  icon: string;
}

const LESSONS: readonly Lesson[] = [
  {
    id: 'confirm',
    title: 'Подтверждение',
    hint: 'Подними обе руки над головой и задержи на секунду',
    icon: '🙌',
  },
  {
    id: 'cancel',
    title: 'Пауза и отмена',
    hint: 'Скрести руки на груди',
    icon: '🙅',
  },
  {
    id: 'dwell',
    title: 'Выбор кнопки',
    hint: 'Наведи кисть на кнопку ниже и задержи, пока кольцо не заполнится',
    icon: '👆',
  },
];

export class TutorialScreen extends Screen {
  private done = new Set<Lesson['id']>();
  private finished = false;

  protected override template(): string {
    return `
      <div class="screen screen--top tutorial">
        <div class="panel panel--wide">
          <h2 class="panel__title">Управление телом</h2>
          <p class="panel__lead">
            Дальше мышь не понадобится. Выполни три жеста — на каждый система ответит.
          </p>

          <ul class="lessons">
            ${LESSONS.map(
              (l) => `
              <li class="lesson" data-lesson="${l.id}">
                <span class="lesson__icon">${l.icon}</span>
                <span class="lesson__body">
                  <b class="lesson__title">${l.title}</b>
                  <span class="lesson__hint">${l.hint}</span>
                </span>
                <span class="lesson__check">✓</span>
              </li>`,
            ).join('')}
          </ul>

          <div class="tutorial__target-wrap">
            <button class="btn btn--dwell" data-dwell="tutorial-dwell" data-action="dwell">
              Задержи здесь кисть
            </button>
          </div>

          <div class="row row--buttons">
            <button class="btn btn--primary" data-dwell="tutorial-next" data-action="next">
              К тренировкам
            </button>
            <button class="btn btn--link" data-action="skip">Пропустить обучение</button>
          </div>
        </div>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    return {
      dwell: () => this.complete('dwell'),
      next: () => this.leave(),
      skip: () => this.leave(),
    };
  }

  override update(frame: ScreenFrame): DrawHints {
    void frame; // Засчитываем именно выдержанный жест, а не единственный кадр.

    const all = LESSONS.every((l) => this.done.has(l.id));
    this.toggle('.btn--primary', 'btn--pulse', all);
    this.setText(
      '.panel__lead',
      all
        ? 'Готово. Подними руки над головой или задержи кисть на кнопке, чтобы перейти к тренировкам.'
        : 'Дальше мышь не понадобится. Выполни три жеста — на каждый система ответит.',
    );

    return { dim: false };
  }

  override onGesture(gesture: GestureName): void {
    if (gesture === 'confirm') {
      this.complete('confirm');
      if (LESSONS.every((l) => this.done.has(l.id))) this.leave();
    }
    if (gesture === 'cancel') this.complete('cancel');
  }

  private complete(id: Lesson['id']): void {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.q(`[data-lesson="${id}"]`)?.classList.add('lesson--done');
    this.app.sound.rep();
    const lesson = LESSONS.find((l) => l.id === id);
    if (lesson) this.app.coach.say(`${lesson.title} — принято`, 'low');
  }

  private leave(): void {
    if (this.finished) return;
    this.finished = true;
    savePrefs({ ...loadPrefs(), tutorialDone: true });
    this.app.go({ name: 'menu' });
  }
}
