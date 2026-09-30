import type { Screen } from '../core/screen';
import { GESTURE_LABEL } from '../gestures/uiGestures';
import { GestureNavigation } from './gestureNavigation';
import type { GestureName, GestureFrame } from '../gestures/uiGestures';

/** Compact feedback for the cross gesture. No pointer, targets or hover clicks. */
export class HandsFreeControls {
  readonly element = document.createElement('aside');
  private feedbackUntil = 0;
  private feedback = '';
  private slow = false;
  readonly navigation: GestureNavigation;
  constructor(private readonly ui: HTMLElement, lighter: () => void) {
    this.navigation = new GestureNavigation(ui);
    this.element.className = 'handsfree';
    this.element.setAttribute('aria-label', 'Жест управления');
    this.element.innerHTML = `<div class="handsfree__status" role="status"></div><div class="handsfree__directions" hidden>Рука в сторону: левая ← / правая → · выбор и чтение</div><div class="handsfree__progress"><i></i></div>
      <div class="handsfree__performance" hidden><span></span><button data-gesture-performance aria-label="Переключить на быструю модель">Ускорить</button></div>`;
    this.element.querySelector('button')!.addEventListener('click', lighter);
  }
  dispatch(gesture: GestureName, screen: Screen | null, now: number): void {
    this.navigation.sync(screen, true);
    const label = gesture === 'cross' && this.navigation.active ? this.navigation.label : GESTURE_LABEL[gesture];
    this.accepted(label, now);
    if (!this.navigation.handle(gesture)) screen?.onGesture(gesture);
  }
  accepted(label: string, now: number): void { this.feedback = `✓ ${label}`; this.feedbackUntil = now + 1800; }
  performance(modelFps: number, renderFps: number, slow: boolean, allowSwitch: boolean, busy: boolean): void {
    this.slow = slow;
    const row = this.element.querySelector<HTMLElement>('.handsfree__performance')!;
    row.hidden = !slow && !busy;
    row.title = `Модель: ${modelFps.toFixed(0)} результатов/с · интерфейс: ${renderFps.toFixed(0)} кадров/с`;
    row.querySelector('span')!.textContent = busy ? 'Меняю модель…' : allowSwitch ? 'Камера работает медленно' : 'Для ускорения поставь паузу';
    row.querySelector('button')!.hidden = !allowSwitch;
    row.querySelector('button')!.disabled = busy;
  }
  update(frame: GestureFrame, screen: Screen | null, enabled: boolean, now: number): void {
    const dialog = this.ui.querySelector<HTMLElement>('dialog[open]');
    const host = dialog ?? this.ui;
    if (this.element.parentElement !== host) {
      if (dialog) dialog.append(this.element);
      else this.ui.insertBefore(this.element, this.ui.querySelector('.bottom-nav'));
    }
    this.element.hidden = !enabled || (!screen?.gestureHint && !screen?.gestureNavigation && !this.slow);
    this.navigation.sync(screen, enabled);
    this.element.querySelector<HTMLElement>('.handsfree__directions')!.hidden = !this.navigation.active;
    if (this.element.hidden) return;
    const active = now < this.feedbackUntil || frame.needsRelease || !!frame.holding;
    this.element.classList.toggle('handsfree--active', !!active);
    this.element.classList.toggle('handsfree--slow', this.slow);
    const text = now < this.feedbackUntil ? this.feedback
      : frame.needsRelease ? 'Опусти руки перед следующим жестом'
      : frame.holding ? `${GESTURE_LABEL[frame.holding]} · удерживай`
      : this.navigation.active ? `Крест → ${this.navigation.label}` : screen?.gestureHint ?? '';
    this.element.querySelector('.handsfree__status')!.textContent = text;
    (this.element.querySelector('i') as HTMLElement).style.width = `${100 * frame.hold}%`;
  }
}
