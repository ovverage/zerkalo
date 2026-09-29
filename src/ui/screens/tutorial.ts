/** Короткое обучение единственному жесту управления. */
import { Screen } from '../../core/screen';
import type { DrawHints } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import { loadPrefs, savePrefs } from '../../storage/prefs';

export class TutorialScreen extends Screen {
  private done = false;
  private finished = false;
  override get gestureHint(): string { return this.done ? 'Опусти руки и скрести снова' : 'Скрести руки на груди'; }

  protected override template(): string {
    return `<div class="screen screen--top tutorial">
      <div class="panel panel--wide">
        <h2 class="panel__title">Один жест</h2>
        <p class="panel__lead">Скрести руки на груди и задержи примерно на секунду.</p>
        <ul class="lessons"><li class="lesson" data-lesson="cross">
          <span class="lesson__icon" aria-hidden="true">🙅</span>
          <span class="lesson__body"><b class="lesson__title">Старт и пауза</b>
          <span class="lesson__hint">Перед упражнением — начать. Во время — пауза. На паузе — продолжить.</span></span>
          <span class="lesson__check">✓</span>
        </li></ul>
        <p class="note">После команды опусти руки. Поднятые руки ничего не переключают.</p>
        <div class="row row--buttons"><button class="btn btn--primary" data-action="next">К тренировкам</button>
        <button class="btn btn--link" data-action="skip">Пропустить</button></div>
      </div>
    </div>`;
  }
  protected override actions(): Record<string, () => void> { return { next: () => this.leave(), skip: () => this.leave() }; }
  override update(): DrawHints { return { dim: false }; }
  override onGesture(gesture: GestureName): void {
    if (gesture !== 'cross') return;
    if (this.done) { this.leave(); return; }
    this.done = true;
    this.q('[data-lesson="cross"]')?.classList.add('lesson--done');
    this.setText('.panel__lead', 'Получилось. Опусти руки, затем скрести снова или нажми «К тренировкам».');
    this.app.sound.rep();
  }
  private leave(): void {
    if (this.finished) return;
    this.finished = true;
    savePrefs({ ...loadPrefs(), tutorialDone: true });
    this.app.go({ name: 'menu' });
  }
}
