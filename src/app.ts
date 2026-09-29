/**
 * Оболочка приложения: источник кадров, главный цикл и маршрутизация экранов.
 *
 * Порядок внутри кадра существенный:
 *   1) распознаём позу;
 *   2) считаем жесты и превращаем удержание кисти в обычный click по кнопке;
 *   3) отдаём кадр экрану — он обновляет свою логику и возвращает, что подсветить;
 *   4) только после этого рисуем скелет, чтобы подсветка соответствовала
 *      подсказке, которую экран показал в этом же кадре.
 */

import { startCamera, startDemoVideo, stopCamera } from './vision/camera';
import { PoseDetector } from './vision/poseDetector';
import type { ProgressHandler } from './vision/poseDetector';
import { BrightnessProbe, boundingBox } from './vision/framing';
import { GestureEngine } from './gestures/uiGestures';
import type { DwellTarget } from './gestures/uiGestures';
import { SkeletonOverlay } from './ui/overlay';
import { EffectLayer } from './ui/fx';
import { VoiceCoach } from './ui/coach';
import { SoundKit } from './ui/sound';
import { History } from './storage/history';
import { loadPrefs, savePrefs } from './storage/prefs';
import type { ModelQuality } from './storage/prefs';
import { ScreenWakeLock } from './core/wakeLock';
import { handleBackButton } from './core/backButton';
import type { AppApi, Route, Screen, SourceKind } from './core/screen';
import { WelcomeScreen } from './ui/screens/welcome';
import { TutorialScreen } from './ui/screens/tutorial';
import { MenuScreen } from './ui/screens/menu';
import { PreviewScreen } from './ui/screens/preview';
import { WorkoutScreen } from './ui/screens/workout';
import { ResultsScreen } from './ui/screens/results';
import { HistoryScreen } from './ui/screens/history';

export interface AppElements {
  stage: HTMLElement;
  video: HTMLVideoElement;
  skeleton: HTMLCanvasElement;
  effects: HTMLCanvasElement;
  ui: HTMLElement;
  fps: HTMLElement;
}

export class App implements AppApi {
  readonly coach = new VoiceCoach();
  readonly sound = new SoundKit();
  readonly history = new History();
  readonly gestures = new GestureEngine();
  readonly overlay: SkeletonOverlay;
  readonly fx: EffectLayer;
  readonly video: HTMLVideoElement;

  private readonly detector = new PoseDetector();
  private readonly wakeLock = new ScreenWakeLock();
  private readonly probe = new BrightnessProbe();
  private readonly els: AppElements;

  private screen: Screen | null = null;
  private stream: MediaStream | null = null;
  private sourceKind: SourceKind | null = null;
  private visionReady = false;
  private raf = 0;
  private lastFrameAt = 0;
  private fps = 0;
  private showFps = false;
  private mirroredValue = true;
  private route: Route = { name: 'welcome' };

  constructor(els: AppElements) {
    this.els = els;
    this.video = els.video;
    this.overlay = new SkeletonOverlay(els.skeleton);
    this.fx = new EffectLayer(els.effects);

    const prefs = loadPrefs();
    this.coach.setEnabled(prefs.voice);
    this.sound.setEnabled(prefs.sound);
    this.mirrored = prefs.mirrored;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' && e.ctrlKey) {
        this.showFps = !this.showFps;
        this.els.fps.classList.toggle('fps--visible', this.showFps);
      }
    });
  }

  get hasVision(): boolean {
    return this.visionReady;
  }

  get source(): SourceKind | null {
    return this.sourceKind;
  }

  get mirrored(): boolean {
    return this.mirroredValue;
  }

  set mirrored(on: boolean) {
    this.mirroredValue = on;
    this.els.stage.classList.toggle('stage--mirrored', on);
    savePrefs({ ...loadPrefs(), mirrored: on });
  }

  /** Запуск: показываем стартовый экран и включаем цикл отрисовки. */
  boot(): void {
    handleBackButton(() => this.goBack());
    this.go({ name: 'welcome' });
    this.loop(performance.now());
  }

  /**
   * Кнопка «назад» на Android. С экранов внутри приложения возвращает в меню,
   * с меню и стартового экрана — отдаёт управление системе, чтобы приложение
   * закрылось как обычно.
   */
  private goBack(): boolean {
    switch (this.route.name) {
      case 'welcome':
      case 'menu':
        return false;
      default:
        this.go(this.visionReady ? { name: 'menu' } : { name: 'welcome' });
        return true;
    }
  }

  async startSource(kind: SourceKind, onProgress?: ProgressHandler): Promise<void> {
    // Звук разрешается только внутри обработчика действия пользователя, а сюда
    // мы попадаем именно из него.
    this.sound.unlock();

    await this.detector.load(loadPrefs().model, onProgress);

    if (kind === 'camera') {
      const started = await startCamera(this.video);
      this.stream = started.stream;
    } else {
      await startDemoVideo(this.video, `${import.meta.env.BASE_URL}demo/demo.mp4`);
    }

    this.sourceKind = kind;
    this.visionReady = true;
    this.els.stage.classList.add('stage--live');
  }

  /**
   * Переключение модели распознавания. Требует пересоздать landmarker, поэтому
   * на время загрузки распознавание недоступно — экран продолжает работать,
   * просто не видит позу.
   */
  async setModelQuality(quality: ModelQuality, onProgress?: ProgressHandler): Promise<void> {
    if (!this.visionReady) {
      savePrefs({ ...loadPrefs(), model: quality });
      return;
    }

    this.visionReady = false;
    try {
      await this.detector.load(quality, onProgress);
      savePrefs({ ...loadPrefs(), model: quality });
    } finally {
      this.visionReady = true;
    }
  }

  go(route: Route): void {
    // Экран держим включённым только на тренировке: в меню и на итогах человек
    // рядом с устройством, и удерживать подсветку незачем.
    if (route.name === 'workout') void this.wakeLock.acquire();
    else void this.wakeLock.release();

    this.route = route;
    this.els.stage.classList.toggle('stage--browsing', route.name === 'menu' || route.name === 'preview');
    this.screen?.unmount();
    this.gestures.clearCooldown();
    this.fx.clear();
    this.screen = this.create(route);
    this.els.ui.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'screenhost';
    this.els.ui.appendChild(host);
    this.screen.mount(host);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    stopCamera(this.stream);
    this.detector.close();
    void this.wakeLock.release();
  }

  private create(route: Route): Screen {
    switch (route.name) {
      case 'welcome':
        return new WelcomeScreen(this, route.error);
      case 'tutorial':
        return new TutorialScreen(this);
      case 'menu':
        return new MenuScreen(this);
      case 'preview':
        return new PreviewScreen(this, route.plan);
      case 'workout':
        return new WorkoutScreen(this, route.plan);
      case 'results':
        return new ResultsScreen(this, route.result, route.records);
      case 'history':
        return new HistoryScreen(this);
    }
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);

    const dt = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.25) : 1 / 60;
    this.lastFrameAt = now;
    this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

    this.overlay.resize();
    this.fx.resize();

    const ready = this.visionReady && this.video.readyState >= 2;
    const body = ready ? this.detector.detect(this.video, now) : null;
    const brightness = ready ? this.probe.sample(this.video, now) : null;

    const gesture = this.gestures.update(body, now, {
      container: this.els.stage.getBoundingClientRect(),
      targets: this.collectTargets(),
      mirrored: this.mirroredValue,
      dwellEnabled: this.screen?.dwellEnabled ?? true,
    });

    // Жестовый выбор — это тот же click, что и мышью: у кнопки один обработчик.
    if (gesture.activatedTargetId) {
      const node = this.els.ui.querySelector<HTMLElement>(
        `[data-dwell="${cssEscape(gesture.activatedTargetId)}"]`,
      );
      node?.click();
    }
    if (gesture.fired) this.screen?.onGesture(gesture.fired);

    const hints = this.screen?.update({ body, t: now, dt, gesture, brightness, fps: this.fps }) ?? {};

    // Слои рисуем в одном месте и в фиксированном порядке: подсказка
    // кадрирования снизу, скелет поверх неё, курсор жестов сверху.
    this.overlay.clear();

    if (hints.guide && ready) {
      this.overlay.mirroredBox = this.mirroredValue;
      this.overlay.drawGuide(hints.guide.ok, body ? boundingBox(body) : null, this.video);
    }

    if (body && ready && !hints.hide) {
      this.overlay.draw(body, this.video, {
        mirrored: this.mirroredValue,
        highlight: hints.highlight ?? EMPTY_SET,
        dim: hints.dim ?? false,
        t: now,
      });
    }

    if (gesture.cursor && (this.screen?.dwellEnabled ?? true)) {
      this.overlay.drawCursor(gesture.cursor, gesture.dwell, gesture.dwellTargetId !== null);
    }

    this.fx.update(dt);
    this.fx.draw();

    if (this.showFps) {
      this.els.fps.textContent = `${this.fps.toFixed(0)} FPS · ${body ? 'поза найдена' : 'позы нет'}`;
    }
  };

  private collectTargets(): DwellTarget[] {
    const nodes = this.els.ui.querySelectorAll<HTMLElement>('[data-dwell]');
    const targets: DwellTarget[] = [];
    for (const node of nodes) {
      const id = node.dataset['dwell'];
      if (!id || node.hasAttribute('disabled')) continue;
      targets.push({ id, rect: node.getBoundingClientRect() });
    }
    return targets;
  }
}

const EMPTY_SET = new Set<never>();

/** Значения data-dwell мы задаём сами, но селектор всё равно экранируем. */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
