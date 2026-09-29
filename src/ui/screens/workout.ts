/**
 * Экран тренировки.
 *
 * Отвечает только за показ: вся логика подсчёта и разбора ошибок живёт в
 * WorkoutSession. Здесь важно другое — не перерисовывать разметку каждый кадр.
 * На 30 кадрах в секунду полная перерисовка панели заметно ест бюджет, поэтому
 * центральная панель пересобирается только при смене состояния, а счётчики и
 * подсказка обновляются точечно.
 */

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

  override get dwellEnabled(): boolean {
    if (this.helpOpen) return true;
    // Курсор — это кисть человека. Пока он встаёт перед камерой, ждёт отсчёта
    // или выполняет упражнение, поднятая рука не означает «нажми кнопку»: так
    // можно случайно завершить тренировку, ничего не сделав. Выбор кнопок
    // удержанием работает только там, где человек действительно обращается к
    // интерфейсу, — на паузе и на отдыхе. Мышью кнопки доступны всегда.
    const state = this.session.currentState;
    return state === 'paused' || state === 'rest';
  }

  override get gestureHint(): string {
    if (this.helpOpen) return 'Руки крестом или обе вверх → закрыть помощь';
    if (this.dwellEnabled) return 'Кисть → помощь или действие · обе руки вверх → продолжить';
    return this.session.currentSpec?.view === 'side'
      ? 'Для паузы безопасно встань лицом к камере и скрести руки на груди'
      : 'Скрести руки на груди → пауза и помощь';
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
          <div class="bar__right">
            <button class="workout-help" data-dwell="w-help" data-action="help">▶ Как выполнять</button>
            <button class="iconbtn" data-dwell="w-voice" data-action="voice" aria-label="Выключить голос" title="Выключить голос">🔊</button>
            <button class="iconbtn" data-dwell="w-pause" data-action="pause" aria-label="Пауза" title="Пауза">⏸</button>
            <button class="iconbtn" data-dwell="w-skip" data-action="skip" aria-label="Пропустить" title="Пропустить">⏭</button>
            <button class="iconbtn iconbtn--danger" data-dwell="w-quit" data-action="quit" aria-label="Завершить" title="Завершить">⏹</button>
          </div>
        </header>

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

    if (out.state === 'done' && !this.finishing) {
      this.complete();
      return { hide: true };
    }

    const tracked = !out.framing.some((f) => f.severity === 'block');
    this.setText('[data-el="tracking"]', out.state === 'paused' || out.state === 'rest' ? ''
      : tracked ? '● Поза отслеживается' : '◌ Ищу рабочие суставы');
    this.q('[data-el="tracking"]')?.classList.toggle('tracking-status--searching', !tracked);
    this.renderHead(out);
    this.renderCounter(out);
    this.renderHint(out, frame.t);
    this.renderPanel(out);
    if (!this.helpOpen) this.handleEvents(out, frame);

    this.lastState = out.state;

    const running = out.state === 'running';
    return {
      highlight: out.highlight,
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
    if (this.helpOpen) { this.closeHelp(); return; }
    const t = this.now;
    switch (gesture) {
      case 'cancel':
        this.session.togglePause(t);
        break;
      case 'confirm':
        if (this.session.currentState === 'paused') this.session.resume(t);
        break;
    }
  }

  override unmount(): void {
    this.app.coach.stop();
    stopGuideVideos(this.root);
    this.q<HTMLDialogElement>('[data-el="help"]')?.close();
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
      <button class="iconbtn" data-dwell="help-close-top" data-action="close-help" aria-label="Закрыть видеопоказ">✕</button></header>
      ${guideContent(spec)}<footer class="guide-dialog__foot"><button class="btn btn--primary" data-dwell="help-close" data-action="close-help">${this.resumeAfterHelp ? 'Понятно, продолжить' : 'Вернуться к паузе'}</button></footer>`;
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
    this.setStyle('[data-el="bar"]', 'width', `${Math.round(out.completion * 100)}%`);

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
          <p class="stagepanel__lead">Подними обе руки над головой, чтобы продолжить.</p>
          <button class="btn btn--primary" data-dwell="w-resume" data-action="resume">Продолжить</button>
          <button class="btn btn--ghost" data-dwell="paused-help" data-action="help">▶ Как выполнять</button>
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
          <button class="btn btn--ghost" data-dwell="rest-help" data-action="help">Поза и настройка камеры</button>
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
    const blocking = out.framing.filter((f) => f.severity === 'block');
    const warnings = out.framing.filter((f) => f.severity === 'warn');
    const ready = blocking.length === 0;

    return `
      <div class="stagepanel__inner setup">
        <div class="setup__head">
          <b class="setup__name">${esc(spec.name)}</b>
          <span class="setup__note">${esc(spec.setup)}</span>
        </div>
        <button class="setup__video" data-action="help">▶ Видеопоказ и ракурс камеры</button>

        <div class="checks">
          <div class="check ${ready ? 'check--ok' : 'check--bad'}">
            <span class="check__mark">${ready ? '✓' : '…'}</span>
            <span>${ready ? 'Поза найдена — начинаем автоматически' : 'Ищу позу — можно находиться в любой части кадра'}</span>
          </div>
          ${[...blocking, ...warnings]
            .map(
              (f) => `
            <div class="check ${f.severity === 'block' ? 'check--bad' : 'check--warn'}">
              <span class="check__mark">${f.severity === 'block' ? '✕' : '!'}</span>
              <span>${esc(f.hint)}</span>
            </div>`,
            )
            .join('')}
        </div>

        <ol class="howto howto--inline">
          ${spec.howTo.map((h) => `<li>${esc(h)}</li>`).join('')}
        </ol>
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
   * — удержания кисти. Поэтому первое нажатие только спрашивает, и подтвердить
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
    if (button) {
      button.classList.add('iconbtn--asking');
      button.setAttribute('title', 'Нажми ещё раз, чтобы завершить');
      window.setTimeout(() => {
        button.classList.remove('iconbtn--asking');
        button.setAttribute('title', 'Завершить');
      }, QUIT_CONFIRM_MS);
    }
    this.app.coach.say('Завершить тренировку? Нажми ещё раз.', 'high');
  }

  private complete(): void {
    if (this.finishing) return;
    this.finishing = true;

    const result = this.session.finish(this.now);
    result.source = this.app.source === 'demo' ? 'simulation' : 'camera';
    const { records } = result.source === 'simulation' ? { records: [] } : this.app.history.add(result);

    this.app.sound.finish();
    this.app.coach.say('Тренировка завершена', 'high');
    this.app.go({ name: 'results', result, records });
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
