/** Three distinct commands; each lesson checks the actual held pose. */
import { Screen } from '../../core/screen';
import type { DrawHints } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import { loadPrefs, savePrefs } from '../../storage/prefs';

const LESSONS = [
  { gesture: 'cross', title: 'Крест — подтвердить', hint: 'Скрести руки на груди. В тренировке этот жест ставит паузу и продолжает подход.', icon: '🙅' },
  { gesture: 'previous', title: 'Левая рука — предыдущий пункт', hint: 'Вытяни свою левую руку в сторону на уровне плеча. Правую оставь опущенной.', icon: '←' },
  { gesture: 'next', title: 'Правая рука — следующий пункт', hint: 'Опусти левую руку. Вытяни свою правую руку в сторону на уровне плеча.', icon: '→' },
] as const;

export class TutorialScreen extends Screen {
  private index = 0;
  private finished = false;
  override get navigationGestures(): boolean { return true; }
  override get gestureHint(): string { return LESSONS[this.index]?.title ?? 'Опусти руки. Крест — к тренировкам'; }

  protected override template(): string {
    return `<div class="screen screen--scroll tutorial"><div class="panel panel--wide">
      <p class="guide-eyebrow">Управление с расстояния</p><h2 class="panel__title">Три команды</h2>
      <p class="panel__lead">Удерживай каждый жест около секунды. Между командами опускай обе руки.</p>
      <ul class="lessons">${LESSONS.map((l, i) => `<li class="lesson" data-lesson="${l.gesture}" ${i ? 'hidden' : ''}>
        <span class="lesson__icon" aria-hidden="true">${l.icon}</span><span class="lesson__body"><b class="lesson__title">${i + 1} / 3 · ${l.title}</b><span class="lesson__hint">${l.hint}</span></span><span class="lesson__check">✓</span></li>`).join('')}</ul>
      <p class="note" data-el="lesson-note">Зелёная рамка показывает выбор. Длинный раздел листается теми же командами. Во время упражнения выбор выключен; работает только крест для паузы.</p>
      <div class="row row--buttons"><button class="btn btn--primary" data-action="next">К тренировкам</button><button class="btn btn--link" data-action="skip">Пропустить</button></div>
    </div></div>`;
  }
  protected override actions(): Record<string, () => void> { return { next: () => this.leave(), skip: () => this.leave() }; }
  override update(): DrawHints { return { dim: false }; }
  override onGesture(gesture: GestureName): void {
    if (this.index === LESSONS.length) { if (gesture === 'cross') this.leave(); return; }
    if (gesture !== LESSONS[this.index]?.gesture) return;
    this.q(`[data-lesson="${gesture}"]`)?.classList.add('lesson--done');
    this.index++;
    this.root.querySelectorAll<HTMLElement>('[data-lesson]').forEach((node, i) => { node.hidden = i !== Math.min(this.index, 2); });
    this.setText('.panel__lead', this.index === 3 ? 'Готово. Опусти руки, затем скрести их для перехода к тренировкам.' : 'Получилось. Опусти обе руки и попробуй следующую команду.');
    this.app.sound.rep();
  }
  private leave(): void {
    if (this.finished) return;
    this.finished = true;
    savePrefs({ ...loadPrefs(), tutorialDone: true, tutorialVersion: 2 });
    this.app.go({ name: 'menu' });
  }
}
