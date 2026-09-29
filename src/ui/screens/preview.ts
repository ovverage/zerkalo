import { Screen } from '../../core/screen';
import type { AppApi, DrawHints, ScreenFrame } from '../../core/screen';
import { checkFraming } from '../../vision/framing';
import type { GestureName } from '../../gestures/uiGestures';
import type { WorkoutPlan } from '../../exercises/registry';
import { requireExercise } from '../../exercises/registry';
import { esc } from '../../core/dom';
import { guideContent, playGuideVideos, stopGuideVideos } from '../exerciseGuide';

export class PreviewScreen extends Screen {
  private index = 0;
  private busy = false;
  private disposed = false;

  constructor(app: AppApi, private readonly plan: WorkoutPlan) { super(app); }

  protected override template(): string {
    return `<div class="screen screen--scroll preview">
      <header class="preview__head">
        <button class="btn btn--ghost" data-action="back" data-dwell="preview-back">← Упражнения</button>
        <span class="preview__quiet">Без звука · в твоём темпе</span>
      </header>
      <div class="preview__title"><p class="guide-eyebrow">${this.plan.steps.length > 1 || this.plan.durationSec ? esc(this.plan.name) : 'Перед началом'}</p>
        <h2 data-el="title"></h2><p>Посмотри движение и подготовь камеру. Старт — когда будешь готов.</p></div>
      ${this.plan.durationSec ? '<p class="alert alert--good">75 секунд в удобном темпе. Выполняй движение как обычно; намеренные ошибки не нужны. Если отклонение возникнет, исправь его по одной подсказке. Если ошибок нет — это хороший результат.</p>' : ''}
      <p class="preview-readiness" data-el="readiness" role="status"></p>
      ${this.plan.steps.length > 1 ? `<nav class="preview__steps" aria-label="Упражнения программы">${this.plan.steps.map((step, i) =>
        `<button class="toggle" data-action="step-${i}" data-dwell="preview-step-${i}" aria-pressed="${i === 0}">${i + 1}. ${esc(requireExercise(step.exerciseId).short)}</button>`).join('')}</nav>` : ''}
      <div data-el="guide"></div>
      <footer class="preview__foot"><p>Тренер озвучивает важные ошибки с паузой от 10 секунд.<br><span>Повтор одной ошибки — не чаще раза в 30 секунд.</span></p>
        <button class="btn btn--primary" data-action="start" data-dwell="preview-start">${this.startLabel()}</button>
        <p class="preview__error" data-el="error" role="status" hidden></p>
      </footer>
    </div>`;
  }

  protected override actions(): Record<string, () => void> {
    const actions: Record<string, () => void> = {
      back: () => { if (!this.busy) this.app.go({ name: 'menu' }); },
      start: () => void this.start(),
    };
    this.plan.steps.forEach((_, i) => { actions[`step-${i}`] = () => { this.index = i; this.renderGuide(); }; });
    return actions;
  }

  protected override onMount(): void { this.app.coach.stop(); this.renderGuide(); }
  override update(frame: ScreenFrame): DrawHints {
    const spec = requireExercise(this.plan.steps[this.index]!.exerciseId);
    const issues = checkFraming(frame.body, { view: spec.view, required: spec.required, tracking: spec.tracking }, frame.brightness);
    const issue = issues.find(f => f.severity === 'block');
    const position = frame.body && spec.inPosition && !spec.inPosition(spec.metrics(frame.body)) ? spec.positionHint : null;
    this.setText('[data-el="readiness"]', this.app.source === 'demo' ? '◉ Готова симуляция. Координаты заданы сценарием; это не проверка камеры.'
      : !this.app.hasVision ? 'Камера ещё не включена. Разреши доступ при старте.'
      : issue ? `◌ ${issue.hint}` : position ? `◌ ${position}` : '✓ Рабочие суставы видны. Можно начинать.');
    return { hide: true };
  }
  override onGesture(gesture: GestureName): void {
    if (gesture === 'confirm' && this.app.hasVision) void this.start();
    if (gesture === 'cancel' && !this.busy) this.app.go({ name: 'menu' });
  }
  override unmount(): void { this.disposed = true; stopGuideVideos(this.root); }

  private renderGuide(): void {
    const step = this.plan.steps[this.index];
    const host = this.q('[data-el="guide"]');
    if (!step || !host) return;
    const spec = requireExercise(step.exerciseId);
    stopGuideVideos(host);
    this.setText('[data-el="title"]', spec.name);
    host.innerHTML = guideContent(spec);
    this.plan.steps.forEach((_, i) => this.q(`[data-action="step-${i}"]`)?.setAttribute('aria-pressed', String(i === this.index)));
    playGuideVideos(host);
  }

  private startLabel(): string {
    return !this.app.hasVision ? 'Включить камеру и начать' : this.plan.steps.length > 1 ? 'Начать программу' : 'Начать упражнение';
  }

  private async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const button = this.q<HTMLButtonElement>('[data-action="start"]');
    const back = this.q<HTMLButtonElement>('[data-action="back"]');
    if (button) button.disabled = true;
    if (back) back.disabled = true;
    this.q('[data-el="error"]')?.setAttribute('hidden', '');
    try {
      if (!this.app.hasVision) {
        await this.app.startSource('camera', (p) => {
          if (!this.disposed) this.setText('[data-action="start"]', `Подготовка камеры · ${Math.round(p.ratio * 100)}%`);
        });
      }
      if (!this.disposed) this.app.go({ name: 'workout', plan: this.plan });
    } catch (error) {
      if (this.disposed) return;
      this.setText('[data-el="error"]', error instanceof Error ? error.message : 'Не удалось включить камеру. Попробуй ещё раз.');
      this.q('[data-el="error"]')?.removeAttribute('hidden');
    } finally {
      this.busy = false;
      if (button) button.disabled = false;
      if (back) back.disabled = false;
      this.setText('[data-action="start"]', this.startLabel());
    }
  }
}
