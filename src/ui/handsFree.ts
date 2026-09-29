import type { Screen } from '../core/screen';
import type { GestureFrame } from '../gestures/uiGestures';

/** Постоянная навигация; внутри modal-dialog остаётся в его верхнем слое. */
export class HandsFreeControls {
  private readonly nav = document.createElement('nav');
  private readonly cursor = document.createElement('div');
  private scroll: HTMLElement | null = null;
  private feedbackUntil = 0;
  private feedback = '';

  constructor(private readonly ui: HTMLElement, lighter: () => void) {
    this.nav.className = 'handsfree';
    this.nav.setAttribute('aria-label', 'Управление телом');
    this.nav.innerHTML = `<div class="handsfree__performance"><span></span><button data-dwell="nav-lite" hidden>Ускорить · Lite</button></div><div class="handsfree__status" role="status"></div>
      <div class="handsfree__row"><button data-dwell="nav-up" aria-label="Прокрутить выше">↑ Выше</button>
      <span class="handsfree__hint"></span><button data-dwell="nav-down" aria-label="Прокрутить ниже">↓ Ниже</button></div>
      <div class="handsfree__progress"><i></i></div>`;
    this.cursor.className = 'hand-cursor';
    this.cursor.setAttribute('aria-hidden', 'true');
    this.nav.querySelector('[data-dwell="nav-lite"]')!.addEventListener('click', lighter);
    this.nav.querySelector('[data-dwell="nav-up"]')!.addEventListener('click', () => this.move(-1));
    this.nav.querySelector('[data-dwell="nav-down"]')!.addEventListener('click', () => this.move(1));
  }

  accepted(label: string, now: number): void {
    this.feedback = `✓ ${label}`;
    this.feedbackUntil = now + 1800;
  }

  performance(modelFps: number, renderFps: number, slow: boolean, allowSwitch: boolean, busy: boolean): void {
    this.nav.querySelector('.handsfree__performance span')!.textContent = busy ? 'Переключаю модель…'
      : `Модель: ${modelFps.toFixed(0)} рез/с · экран: ${renderFps.toFixed(0)} к/с${slow && !allowSwitch ? ' · Для ускорения открой паузу' : ''}`;
    const button = this.nav.querySelector<HTMLButtonElement>('[data-dwell="nav-lite"]')!;
    button.hidden = !slow || !allowSwitch;
    button.disabled = busy;
  }

  update(frame: GestureFrame, screen: Screen | null, enabled: boolean, now: number): void {
    const dialog = this.ui.querySelector<HTMLElement>('dialog[open]');
    const host = dialog ?? this.ui;
    if (this.nav.parentElement !== host) host.append(this.nav, this.cursor);
    this.nav.hidden = !enabled;
    this.cursor.hidden = !enabled || !screen?.dwellEnabled || !frame.cursor;
    if (!enabled) return;
    this.scroll = dialog ?? [...this.ui.querySelectorAll<HTMLElement>('.screen--scroll, .screen--top, .stagepanel__inner')]
      .find(node => node.scrollHeight > node.clientHeight + 4) ?? null;
    const scrollable = !!this.scroll && screen?.dwellEnabled !== false;
    for (const [id, unavailable] of [
      ['nav-up', !scrollable || this.scroll!.scrollTop < 4],
      ['nav-down', !scrollable || this.scroll!.scrollTop + this.scroll!.clientHeight >= this.scroll!.scrollHeight - 4],
    ] as const) {
      const button = this.nav.querySelector<HTMLButtonElement>(`[data-dwell="${id}"]`)!;
      button.hidden = !scrollable;
      button.disabled = unavailable;
    }
    this.nav.querySelector('.handsfree__hint')!.textContent = screen?.gestureHint ?? '';
    const message = now < this.feedbackUntil ? this.feedback
      : frame.needsRelease ? 'Опусти руки перед следующей командой'
      : frame.holding ? (frame.holding === 'confirm' ? 'Подтверждение' : 'Пауза / назад') + ' — удерживай'
      : frame.dwellTargetId ? 'Выбор — удерживай кисть 1,1 секунды'
      : 'Одна кисть управляет курсором по всему экрану';
    this.nav.querySelector('.handsfree__status')!.textContent = message;
    (this.nav.querySelector('i') as HTMLElement).style.width = `${100 * Math.max(frame.hold, frame.dwell)}%`;
    if (frame.cursor) {
      this.cursor.style.left = `${frame.cursor.x}px`;
      this.cursor.style.top = `${frame.cursor.y}px`;
      this.cursor.style.setProperty('--progress', `${Math.max(frame.dwell, frame.hold) * 360}deg`);
    }
  }

  private move(direction: number): void {
    this.scroll?.scrollBy({ top: direction * Math.max(160, this.scroll.clientHeight * 0.65), behavior: 'instant' });
  }
}

export function collectDwellTargets(ui: HTMLElement): import('../gestures/uiGestures').DwellTarget[] {
    const scope = ui.querySelector('dialog[open]') ?? ui;
    const nodes = scope.querySelectorAll<HTMLElement>('[data-dwell]');
    const targets: import('../gestures/uiGestures').DwellTarget[] = [];
    for (const node of nodes) {
      const id = node.dataset['dwell'];
      if (!id || node.hasAttribute('disabled') || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') continue;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      // Не выбираем карточки под панелью, за пределами прокрутки или модальным окном.
      const top = document.elementFromPoint(cx, cy);
      if (!top || !node.contains(top)) continue;
      targets.push({ id, rect });
    }
    return targets;
  }
