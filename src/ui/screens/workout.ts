/**
 * Экран тренировки.
 *
 * Отвечает только за показ: вся логика подсчёта и разбора ошибок живёт в
 * WorkoutSession. Здесь важно другое — не перерисовывать разметку каждый кадр.
 * На 30 кадрах в секунду полная перерисовка панели заметно ест бюджет, поэтому
 * центральная панель пересобирается только при смене состояния, а счётчики и
 * подсказка обновляются точечно.
 */

import { expandGroups } from '../../vision/landmarks';
import type { LandmarkName } from '../../vision/landmarks';
import { Screen } from '../../core/screen';
import type { DrawHints, ScreenFrame } from '../../core/screen';
import type { AppApi } from '../../core/screen';
import type { GestureName } from '../../gestures/uiGestures';
import type { FrameOutcome, SessionState } from '../../engine/session';
import { WorkoutSession } from '../../engine/session';
import type { WorkoutPlan } from '../../exercises/registry';
import { esc, plural, qualityTone } from '../../core/dom';
import { exerciseGuide } from '../../exercises/guides';
import { guideContent, guideVideo, playGuideVideos, stopGuideVideos } from '../exerciseGuide';
import { loadPrefs, savePrefs } from '../../storage/prefs';

export class WorkoutScreen extends Screen {
  private readonly session: WorkoutSession;
  private started = false;
  private readonly measurementModels = new Set<string>();
  private lastState: SessionState | null = null;
  private lastPanelKey = '';
  private lastHintKey = '';
  private lastCountdown = -1;
  private lastStepId: string | null = null;
  private finishing = false;
  private quitAskedAt = -Infinity;
  private helpOpen = false;
  private resumeAfterHelp = false;
  private frameTime = 0;
  private get now(): number { return this.frameTime || performance.now(); }
  private feedbackUntil = 0;
  private feedbackText = '';
  private feedbackTone = '';
  private feedbackHighlight = new Set<LandmarkName>();

  override get demoMotion() {
    return { exerciseId: this.session.currentSpec?.id ?? 'squat', running: this.session.currentState === 'running' };
  }

  constructor(
    app: AppApi,
    plan: WorkoutPlan,
  ) {
    super(app);
    this.session = new WorkoutSession(plan);
  }

  override get canChangeModel(): boolean {
    if (this.helpOpen) return true;
    // Смену модели предлагаем на паузе, чтобы не обрывать измерение повтора.
    const state = this.session.currentState;
    return state === 'paused' || state === 'rest';
  }

  override get gestureNavigation() {
    return this.helpOpen ? { key: 'help', defaultAction: 'close-help' }
      : this.session.currentState === 'paused' ? { key: 'paused', defaultAction: 'resume' } : null;
  }

  override get gestureHint(): string {
    if (this.helpOpen) return 'Крест — закрыть помощь';
    return this.session.currentState === 'paused' ? 'Крест — продолжить' : 'Крест — пауза';
  }

  protected override template(): string {
    return `
      <div class="screen workout">
        <header class="bar">
          <div class="bar__left">
            <span class="bar__icon" data-el="icon"></span>
            <div>
              <div class="bar__name" data-el="name"></div>
              <div class="bar__step" data-el="step"></div>
              <div class="tracking-status" data-el="tracking" role="status"></div>
              <div class="dots" data-el="dots"></div>
            </div>
          </div>
          <div class="bar__right"><button class="iconbtn" data-action="voice" aria-label="Выключить голос" title="Выключить голос">🔊</button></div>
        </header>
        <div class="workout__body">
        <div class="amp" data-el="amp">
          <div class="amp__track">
            <div class="amp__fill" data-el="ampFill"></div>
            <div class="amp__target" data-el="ampTarget"></div>
          </div>
          <div class="amp__label">амплитуда</div>
        </div>

        <div class="counter" data-el="counter">
          <div class="challenge-clock" data-el="challenge-clock"></div>
          <div class="counter__value" data-el="done">0</div>
          <div class="counter__of" data-el="of"></div>
          <div class="counter__bar"><i data-el="bar"></i></div>
          <div class="counter__meta">
            <span data-el="metric"></span>
            <span class="counter__quality" data-el="quality"></span>
          </div>
        </div>

        <div class="hint hint--hidden" data-el="hint">
          <span class="hint__badge" data-el="hintBadge">!</span>
          <span class="hint__text" data-el="hintText"></span>
          <span class="hint__numbers" data-el="hintNumbers"></span>
        </div>

        <div class="stagepanel stagepanel--hidden" data-el="panel"></div>
        </div>
        <footer class="workout-actions" aria-label="Управление тренировкой">
          <button data-action="help"><span aria-hidden="true">▷</span>Как выполнять</button>
          <button class="workout-actions__primary" data-action="pause"><span data-el="pause-icon" aria-hidden="true">Ⅱ</span><b data-el="pause-label">Пауза</b></button>
          <button data-action="quit"><span aria-hidden="true">□</span><b data-el="quit-label">Завершить</b></button>
        </footer>
        <dialog class="guide-dialog" data-el="help" aria-labelledby="workout-guide-title"></dialog>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    return {
      pause: () => this.session.togglePause(this.now),
      skip: () => this.session.skip(this.now),
      quit: () => this.confirmQuit(),
      resume: () => this.session.resume(this.now),
      help: () => this.openHelp(),
      'close-help': () => this.closeHelp(),
      voice: () => this.toggleVoice(),
    };
  }

  protected override onMount(): void {
    this.app.coach.stop();
    this.renderVoice();
    this.q<HTMLDialogElement>('[data-el="help"]')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeHelp();
    });
  }

  override update(frame: ScreenFrame): DrawHints {
    this.frameTime = frame.t;
    if (!this.started) {
      this.session.start(frame.t);
      this.started = true;
    }

    const out = this.session.update(frame.body, frame.t, frame.brightness);
    if (out.state === 'running' && this.lastState !== 'running') this.measurementModels.add(loadPrefs().model);

    if (out.state === 'done' && !this.finishing) {
      this.complete();
      return { hide: true };
    }

    this.q('.workout')!.setAttribute('data-state', out.state);
    this.setText('[data-el="pause-label"]', out.state === 'paused' ? 'Продолжить' : 'Пауза');
    this.setText('[data-el="pause-icon"]', out.state === 'paused' ? '▷' : 'Ⅱ');
    const tracked = !out.framing.some((f) => f.severity === 'block');
    this.setText('[data-el="tracking"]', out.state === 'running' && !tracked ? 'Счёт приостановлен' : '');
    this.q('[data-el="tracking"]')?.classList.toggle('tracking-status--searching', !tracked);
    this.renderHead(out);
    this.renderCounter(out);
    this.renderHint(out, frame.t);
    this.renderPanel(out);
    if (!this.helpOpen) this.handleEvents(out, frame);

    this.lastState = out.state;

    const running = out.state === 'running';
    return {
      highlight: running && tracked && this.feedbackUntil > frame.t ? this.feedbackHighlight : out.highlight,
      dim: !running,
      hide: out.state === 'rest',
      // Рамка следует за человеком, независимо от положения и ориентации.
      ...(out.state === 'setup' || out.state === 'countdown'
        ? {
            guide: {
              ok: !out.framing.some((f) => f.severity === 'block'),
            },
          }
        : {}),
    };
  }

  override onGesture(gesture: GestureName): void {
    if (gesture !== 'cross') return;
    if (this.helpOpen) { this.closeHelp(); return; }
    if (gesture === 'cross') this.session.togglePause(this.now);
  }

  override onBack(): boolean {
    if (!this.started) { this.session.start(this.now); this.started = true; }
    if (this.helpOpen) this.closeHelp();
    else if (this.session.currentState !== 'paused') this.session.pause(this.now);
    else this.confirmQuit();
    return true;
  }

  override unmount(): void {
    this.app.coach.stop();
    stopGuideVideos(this.root);
    this.q<HTMLDialogElement>('[data-el="help"]')?.close();
  }

  override onVisibilityChange(hidden: boolean, t: number): void {
    this.frameTime = t;
    if (!hidden) {
      playGuideVideos(this.root);
      return;
    }
    if (!this.started) {
      this.session.start(t);
      this.started = true;
    }
    this.session.pause(t);
    this.resumeAfterHelp = false;
    if (this.helpOpen) this.setText('.guide-dialog__foot [data-action="close-help"]', 'Вернуться к паузе');
    this.app.coach.stop();
    stopGuideVideos(this.root);
  }

  private openHelp(): void {
    if (this.helpOpen) return;
    const spec = this.session.currentSpec;
    const dialog = this.q<HTMLDialogElement>('[data-el="help"]');
    if (!spec || !dialog) return;
    this.resumeAfterHelp = this.session.currentState !== 'paused';
    this.session.pause(this.now);
    this.app.coach.stop();
    this.helpOpen = true;
    stopGuideVideos(this.root);
    dialog.innerHTML = `<header class="guide-dialog__head"><div><p class="guide-eyebrow">Тренировка на паузе</p><h2 id="workout-guide-title">${esc(spec.name)}</h2></div>
      <button class="iconbtn" data-action="close-help" aria-label="Закрыть видеопоказ">✕</button></header>
      ${guideContent(spec)}<div class="gesture-pages"><button class="btn btn--ghost" data-gesture-scroll="up">↑ Выше</button><button class="btn btn--ghost" data-gesture-scroll="down">↓ Ниже</button></div><footer class="guide-dialog__foot"><button class="btn btn--primary" data-action="close-help">${this.resumeAfterHelp ? 'Понятно, продолжить' : 'Вернуться к паузе'}</button></footer>`;
    dialog.showModal();
    playGuideVideos(dialog);
  }

  private closeHelp(): void {
    if (!this.helpOpen) return;
    const dialog = this.q<HTMLDialogElement>('[data-el="help"]');
    if (dialog) { stopGuideVideos(dialog); dialog.close(); dialog.innerHTML = ''; }
    this.helpOpen = false;
    if (this.resumeAfterHelp) this.session.resume(this.now);
    this.q<HTMLButtonElement>('[data-action="help"]')?.focus();
  }

  private toggleVoice(): void {
    const prefs = loadPrefs();
    savePrefs({ ...prefs, voice: !prefs.voice });
    this.app.coach.setEnabled(!prefs.voice);
    this.renderVoice();
  }

  private renderVoice(): void {
    const button = this.q('[data-action="voice"]');
    if (!button) return;
    const on = loadPrefs().voice;
    button.textContent = on ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Выключить голос' : 'Включить голос');
    button.setAttribute('title', on ? 'Выключить голос · подсказки не чаще раза в 10 с' : 'Включить голос · только важное');
  }

  /* ── Отрисовка ──────────────────────────────────────────────────────────── */

  private renderHead(out: FrameOutcome): void {
    const spec = out.spec;
    if (!spec || spec.id === this.lastStepId) return;
    this.lastStepId = spec.id;

    this.setText('[data-el="icon"]', spec.icon);
    this.setText('[data-el="name"]', spec.name);
    this.setText(
      '[data-el="step"]',
      this.session.plan.durationSec ? `Исправь движение · ${this.session.plan.durationSec} секунд` : out.stepCount > 1 ? `Упражнение ${out.stepIndex + 1} из ${out.stepCount}` : 'Свободная тренировка',
    );
    this.setText(
      '[data-el="of"]',
      this.session.plan.durationSec ? 'зачтено за попытку' : spec.mode === 'hold' ? `из ${out.target} с` : `из ${out.target}`,
    );

    const dots = this.q('[data-el="dots"]');
    if (dots) {
      dots.innerHTML =
        out.stepCount > 1
          ? Array.from({ length: out.stepCount }, (_, i) => {
              const state = i < out.stepIndex ? 'done' : i === out.stepIndex ? 'now' : 'next';
              return `<i class="dot dot--${state}"></i>`;
            }).join('')
          : '';
    }
  }

  private renderCounter(out: FrameOutcome): void {
    const spec = out.spec;
    if (!spec) return;
    this.setText('[data-el="challenge-clock"]', out.remainingSec !== undefined ? `✦ Осталось ${out.remainingSec} с` : '');

    const done = spec.mode === 'hold' ? Math.floor(out.done) : out.done;
    this.setText('[data-el="done"]', String(done));
    this.setStyle('[data-el="bar"]', 'width', `${Math.round((out.remainingSec !== undefined ? 1 - out.remainingSec / (this.session.plan.durationSec ?? 75) : out.completion) * 100)}%`);

    const ctx = out.ctx;
    if (ctx && spec.hud) {
      const raw = ctx.m[spec.hud.metric];
      const value = raw === undefined ? '—' : raw.toFixed(spec.hud.decimals ?? 0);
      this.setText('[data-el="metric"]', `${spec.hud.label} ${value}${spec.hud.unit}`);
    } else {
      this.setText('[data-el="metric"]', '');
    }

    // До первого повторения «Качество 100%» — пустое обещание, поэтому молчим.
    const quality = this.q('[data-el="quality"]');
    if (quality) {
      const known = out.done > 0 || (spec.mode === 'reps' && out.state === 'running' && out.quality < 100);
      quality.textContent = known ? `Качество ${out.quality}%` : '';
      quality.dataset['tone'] = qualityTone(out.quality);
    }

    // Указатель амплитуды: заполнение — текущий прогресс, метка — порог зачёта.
    const amp = this.q('[data-el="amp"]');
    if (amp) amp.classList.toggle('amp--hidden', out.state !== 'running');
    if (ctx) {
      this.setStyle('[data-el="ampFill"]', 'height', `${Math.round(ctx.progress * 100)}%`);
      const valid = spec.thresholds?.valid ?? 0.85;
      this.setStyle('[data-el="ampTarget"]', 'bottom', `${Math.round(valid * 100)}%`);
    }
  }

  private renderHint(out: FrameOutcome, t: number): void {
    const hint = this.q('[data-el="hint"]');
    if (!hint) return;

    if (out.repEvent) {
      const correction = out.repEvent.corrections[0];
      const feedback = out.repEvent.feedback;
      this.feedbackText = correction?.message ?? (feedback ? `${feedback.blocksRep ? 'Не зачтено' : 'Замечание · повтор зачтён'}: ${feedback.hint}` : 'Повтор засчитан');
      this.feedbackHighlight = expandGroups(correction ? [] : feedback?.highlight ?? []);
      this.feedbackTone = correction || !feedback ? 'success' : feedback.blocksRep ? 'error' : 'warning';
      this.feedbackUntil = t + 4200;
    }
    // Проблема видимости важнее ранее показанного результата повторения.
    const message = out.message;
    if (!out.framing.some(f => f.severity === 'block') && this.feedbackUntil > t && out.state === 'running') {
      this.lastHintKey = '';
      hint.classList.remove('hint--hidden');
      hint.dataset['severity'] = this.feedbackTone;
      this.setText('[data-el="hintBadge"]', this.feedbackTone === 'success' ? '✓' : this.feedbackTone === 'error' ? '✕' : '!');
      this.setText('[data-el="hintText"]', this.feedbackText);
      this.setText('[data-el="hintNumbers"]', '');
      return;
    }
    if (!message) {
      this.lastHintKey = '';
      hint.classList.add('hint--hidden');
      return;
    }

    const key = `${message.ruleId}:${message.hint}`;
    if (key === this.lastHintKey) return;
    this.lastHintKey = key;
    hint.classList.remove('hint--hidden');
    hint.dataset['severity'] = message.severity;
    this.setText('[data-el="hintBadge"]', message.severity === 'error' ? '✕' : '!');
    this.setText('[data-el="hintText"]', message.hint);
    this.setText(
      '[data-el="hintNumbers"]',
      message.value !== undefined && message.target !== undefined
        ? `сейчас ${fmt(message.value)}${message.unit ?? ''} · нужно ${fmt(message.target)}${message.unit ?? ''}`
        : '',
    );
  }

  private renderPanel(out: FrameOutcome): void {
    const panel = this.q('[data-el="panel"]');
    if (!panel) return;

    const key = this.panelKey(out);
    if (key === this.lastPanelKey) {
      if (out.state === 'countdown' || out.state === 'rest') {
        this.setText('[data-el="tick"]', String(out.countdownSec));
      }
      return;
    }
    this.lastPanelKey = key;
    stopGuideVideos(panel);

    if (out.state === 'running') {
      panel.className = 'stagepanel stagepanel--hidden';
      panel.innerHTML = '';
      return;
    }

    // Подготовка и отсчёт не затемняют кадр: на них человек как раз должен
    // видеть себя. Отдых и пауза — наоборот, смотреть там не на что.
    panel.className = `stagepanel stagepanel--${PLACEMENT[out.state] ?? 'center'}`;
    panel.innerHTML = this.panelHtml(out);
    if (!this.helpOpen) playGuideVideos(panel);
  }

  private panelKey(out: FrameOutcome): string {
    switch (out.state) {
      case 'setup':
        return `setup:${out.spec?.id}:${out.framing.map((f) => f.code).join(',')}`;
      case 'countdown':
        return `countdown:${out.spec?.id}`;
      case 'rest':
        return `rest:${out.spec?.id}`;
      case 'paused':
        return 'paused';
      default:
        return out.state;
    }
  }

  private panelHtml(out: FrameOutcome): string {
    const spec = out.spec;

    if (out.state === 'paused') {
      return `
        <div class="stagepanel__inner">
          <h3 class="stagepanel__title">Пауза</h3>
          <p class="stagepanel__lead">Крест — продолжить. Правая рука в сторону — выбрать помощь.</p>
          <button class="btn btn--primary" data-action="resume">Продолжить</button>
          <button class="btn btn--ghost" data-action="help">▶ Как выполнять</button>
          <button class="btn btn--link" data-action="skip">Пропустить упражнение</button>
        </div>`;
    }

    if (out.state === 'rest' && spec) {
      return `
        <div class="stagepanel__inner">
          <h3 class="stagepanel__title">Отдых</h3>
          <div class="tick" data-el="tick">${out.countdownSec}</div>
          <p class="stagepanel__lead">
            Дальше: <b>${esc(spec.name)}</b> — ${
              spec.mode === 'hold' ? `${out.target} с` : `${out.target} ${plural(out.target, 'повторение', 'повторения', 'повторений')}`
            }
          </p>
          ${guideVideo(spec)}
          <p class="stagepanel__note">Камера: ${esc(exerciseGuide(spec.id).camera.toLowerCase())}.</p>
          <button class="btn btn--ghost" data-action="help">Поза и настройка камеры</button>
        </div>`;
    }

    if (out.state === 'countdown' && spec) {
      return `
        <div class="stagepanel__inner">
          <h3 class="stagepanel__title">Начинаем</h3>
          <div class="tick tick--big" data-el="tick">${out.countdownSec}</div>
          <p class="stagepanel__lead">${esc(spec.howTo[0] ?? '')}</p>
        </div>`;
    }

    // setup
    if (!spec) return '';
    const issue = out.framing.find(f => f.severity === 'block') ?? out.framing.find(f => f.severity === 'warn');
    const ready = !out.framing.some(f => f.severity === 'block');
    return `<div class="stagepanel__inner setup setup--compact" role="status">
      <span class="setup__mark" aria-hidden="true">${ready ? '✓' : '◌'}</span>
      <p class="setup__message">${esc(issue?.hint ?? 'Готово. Начинаем…')}</p>
      <button class="setup__help" data-action="help" aria-label="Показать позу и ракурс камеры" title="Поза и камера">?</button>
    </div>`;
  }

  /* ── Звук, голос и эффекты ──────────────────────────────────────────────── */

  private handleEvents(out: FrameOutcome, frame: ScreenFrame): void {
    const spec = out.spec;

    if (out.state !== this.lastState) {
      if (out.state === 'running' && spec) {
        this.app.coach.say(spec.mode === 'hold' ? 'Держи' : 'Начали', 'high');
      }
      if (out.state === 'paused') {
        this.app.coach.stop();
        this.app.coach.say('Пауза', 'high');
      }
      if (out.state === 'rest' && spec) {
        this.app.sound.stage();
        this.app.fx.float('Есть!', '#7ef9ac');
        this.app.coach.say(`Отдых. Дальше — ${spec.name}.`, 'high');
      }
    }

    if (out.state === 'countdown' && out.countdownSec !== this.lastCountdown) {
      this.lastCountdown = out.countdownSec;
      if (out.countdownSec > 0) this.app.sound.tick();
    }

    const event = out.repEvent;
    if (event) {
      const { rec, feedback } = event;
      if (rec.counted) {
        this.app.sound.rep();
        this.app.fx.burst(rec.quality);
        this.flash('good');
        if (rec.quality >= 92) this.app.fx.float('Отлично', '#7ef9ac', 40);
      } else {
        this.app.sound.reject();
        this.app.fx.float('Не зачтено', '#ff4d6d', 34);
        this.flash('bad');
      }
      if (feedback) {
        this.app.coach.feedback(feedback);
      }
    }

    // Покадровые подсказки озвучиваются только когда истёк кулдаун правила —
    // решение об этом принимает анализатор, здесь только исполнение.
    if (out.message?.speak && out.state === 'running') {
      this.app.coach.feedback(out.message);
    }

    void frame;
  }


  private flash(kind: 'good' | 'bad'): void {
    const counter = this.q('[data-el="counter"]');
    if (!counter) return;
    const className = `counter--${kind}`;
    counter.classList.remove('counter--good', 'counter--bad');
    // Перезапуск анимации: без принудительного пересчёта стилей повторное
    // добавление того же класса подряд ничего не проигрывает.
    void counter.offsetWidth;
    counter.classList.add(className);
    window.setTimeout(() => counter.classList.remove(className), 520);
  }

  /**
   * Завершение тренировки необратимо, а нажатие может прийти от неточного ввода
   * — случайного касания. Поэтому первое нажатие только спрашивает, и подтвердить
   * нужно в течение нескольких секунд.
   */
  private confirmQuit(): void {
    const button = this.q('[data-action="quit"]');
    const now = this.now;

    if (now - this.quitAskedAt < QUIT_CONFIRM_MS) {
      this.complete();
      return;
    }

    this.quitAskedAt = now;
    this.setText('[data-el="quit-label"]', 'Ещё раз?');
    if (button) {
      button.classList.add('iconbtn--asking');
      button.setAttribute('title', 'Подтверди ещё раз, чтобы завершить');
      window.setTimeout(() => {
        button.classList.remove('iconbtn--asking');
        this.setText('[data-el="quit-label"]', 'Завершить');
        button.setAttribute('title', 'Завершить');
      }, QUIT_CONFIRM_MS);
    }
    this.app.coach.say('Завершить тренировку? Подтверди ещё раз.', 'high');
  }

  private complete(): void {
    if (this.finishing) return;
    this.finishing = true;

    const result = this.session.finish(this.now);
    result.source = this.app.source === 'demo' ? 'simulation' : 'camera';
    result.model = this.measurementModels.size === 1 ? [...this.measurementModels][0] : undefined;
    const { records, session } = result.source === 'simulation' ? { records: [], session: undefined } : this.app.history.add(result);

    this.app.sound.finish();
    this.app.coach.say('Тренировка завершена', 'high');
    this.app.go({ name: 'results', result, records, savedId: session?.id });
  }
}

/** Сколько времени действует подтверждение завершения. */
const QUIT_CONFIRM_MS = 4000;

/** Как разместить центральную панель в каждом состоянии. */
const PLACEMENT: Partial<Record<SessionState, string>> = {
  setup: 'bottom',
  countdown: 'bare',
  rest: 'center',
  paused: 'center',
};

const fmt = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 10) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(1).replace('.', ',');
  return v.toFixed(2).replace('.', ',');
};
