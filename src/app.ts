/**
 * Оболочка приложения: источник кадров, главный цикл и маршрутизация экранов.
 *
 * Порядок внутри кадра существенный:
 *   1) распознаём позу;
 *   2) проверяем жест скрещённых рук;
 *   3) отдаём кадр экрану — он обновляет свою логику и возвращает, что подсветить;
 *   4) только после этого рисуем скелет, чтобы подсветка соответствовала
 *      подсказке, которую экран показал в этом же кадре.
 */

import { startCamera, stopCamera } from './vision/camera';
import { PoseDetector } from './vision/poseDetector';
import type { ProgressHandler } from './vision/poseDetector';
import { BrightnessProbe, boundingBox } from './vision/framing';
import { GestureEngine } from './gestures/uiGestures';
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
import { HandsFreeControls } from './ui/handsFree';
import { BottomNavigation } from './ui/navigation';
import { SettingsScreen } from './ui/screens/settings';
import { DemoSimulation } from './demo/simulation';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

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
  private readonly handsFree: HandsFreeControls;
  private readonly navigation: BottomNavigation;
  private readonly simulation = new DemoSimulation();
  private slowSince: number | null = null;
  private visionStartedAt = 0;
  private switchingModel = false;
  private nativeStateListener: Promise<PluginListenerHandle> | null = null;

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
    this.navigation = new BottomNavigation(route => this.go(route));
    this.handsFree = new HandsFreeControls(els.ui, () => {
      if (this.switchingModel) return;
      this.switchingModel = true;
      void this.setModelQuality('lite').catch(error => {
        this.handsFree.accepted(error instanceof Error ? error.message : 'Не удалось переключить модель', performance.now());
      }).finally(() => { this.switchingModel = false; });
    });
    this.video = els.video;
    this.overlay = new SkeletonOverlay(els.skeleton);
    this.fx = new EffectLayer(els.effects);

    const prefs = loadPrefs();
    this.coach.setEnabled(prefs.voice);
    this.sound.setEnabled(prefs.sound);
    this.mirrored = prefs.mirrored;

    document.addEventListener('visibilitychange', () => {
      this.screen?.onVisibilityChange(document.hidden, performance.now());
      if (document.hidden) this.coach.stop();
      this.lastFrameAt = 0;
    });

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
    if (Capacitor.isNativePlatform()) {
      this.nativeStateListener = NativeApp.addListener('appStateChange', ({ isActive }) => {
        this.screen?.onVisibilityChange(!isActive, performance.now());
        if (!isActive) this.coach.stop();
      });
    }
    this.go({ name: 'welcome' });
    this.loop(performance.now());
  }

  /**
   * Кнопка «назад» на Android. С экранов внутри приложения возвращает в меню,
   * с меню и стартового экрана — отдаёт управление системе, чтобы приложение
   * закрылось как обычно.
   */
  private goBack(): boolean {
    if (this.screen?.onBack()) return true;
    switch (this.route.name) {
      case 'welcome':
        return false;
      case 'menu':
        if (this.route.section !== 'exercises') return false;
        this.go({ name: 'menu' });
        return true;
      default:
        this.go({ name: 'menu' });
        return true;
    }
  }

  async startSource(kind: SourceKind, onProgress?: ProgressHandler): Promise<void> {
    // Звук разрешается только внутри обработчика действия пользователя, а сюда
    // мы попадаем именно из него.
    this.sound.unlock();

    if (kind === 'camera' && this.sourceKind === 'camera' && this.visionReady) return;
    if (kind === 'camera') {
      stopCamera(this.stream);
      this.stream = null;
      const started = await startCamera(this.video);
      this.stream = started.stream;
      try { await this.detector.load(loadPrefs().model, onProgress); }
      catch (error) { stopCamera(this.stream); this.stream = null; throw error; }
    } else {
      stopCamera(this.stream);
      this.stream = null;
      this.video.pause();
      this.video.srcObject = null;
    }

    this.sourceKind = kind;
    this.visionReady = true;
    this.visionStartedAt = performance.now();
    this.els.stage.classList.add('stage--live');
    this.els.stage.classList.toggle('stage--demo', kind === 'demo');
  }

  /**
   * Переключение модели распознавания. Требует пересоздать landmarker, поэтому
   * на время загрузки распознавание недоступно — экран продолжает работать,
   * просто не видит позу.
   */
  async setModelQuality(quality: ModelQuality, onProgress?: ProgressHandler): Promise<void> {
    if (!this.visionReady || this.sourceKind === 'demo') {
      savePrefs({ ...loadPrefs(), model: quality });
      this.slowSince = null;
      this.visionStartedAt = performance.now();
      return;
    }

    this.visionReady = false;
    try {
      await this.detector.load(quality, onProgress);
      savePrefs({ ...loadPrefs(), model: quality });
    } finally {
      this.visionReady = this.detector.isReady;
    }
  }

  go(route: Route): void {
    // Экран держим включённым только на тренировке: в меню и на итогах человек
    // рядом с устройством, и удерживать подсветку незачем.
    if (route.name === 'workout') void this.wakeLock.acquire();
    else void this.wakeLock.release();

    this.route = route;
    this.els.stage.classList.toggle('stage--browsing', route.name !== 'workout' && route.name !== 'tutorial');
    this.els.stage.dataset['route'] = route.name;
    this.screen?.unmount();
    this.gestures.clearCooldown();
    this.fx.clear();
    this.screen = this.create(route);
    this.els.ui.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'screenhost';
    this.els.ui.appendChild(host);
    this.screen.mount(host);
    this.navigation.update(route);
    this.els.ui.append(this.handsFree.element, this.navigation.element);
    if (document.hidden) this.screen.onVisibilityChange(true, performance.now());
    if (this.sourceKind === 'demo' && route.name !== 'welcome') {
      const banner = document.createElement('aside');
      banner.className = 'source-banner';
      banner.innerHTML = '<span><b>СИМУЛЯЦИЯ</b> · без камеры и распознавания</span><button>К камере</button>';
      banner.querySelector('button')!.addEventListener('click', () => {
        this.visionReady = false;
        this.sourceKind = null;
        this.els.stage.classList.remove('stage--demo', 'stage--live');
        this.go({ name: 'welcome' });
      });
      host.querySelector('.screen')?.prepend(banner);
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    stopCamera(this.stream);
    this.detector.close();
    void this.nativeStateListener?.then(listener => listener.remove());
    void this.wakeLock.release();
  }

  private create(route: Route): Screen {
    switch (route.name) {
      case 'welcome':
        return new WelcomeScreen(this, route.error);
      case 'tutorial':
        return new TutorialScreen(this);
      case 'menu':
        return new MenuScreen(this, route.section);
      case 'settings':
        return new SettingsScreen(this);
      case 'preview':
        return new PreviewScreen(this, route.plan);
      case 'workout':
        return new WorkoutScreen(this, route.plan);
      case 'results':
        return new ResultsScreen(this, route.result, route.records, route.savedId);
      case 'history':
        return new HistoryScreen(this);
    }
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;

    const dt = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.25) : 1 / 60;
    this.lastFrameAt = now;
    this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

    this.overlay.resize();
    this.fx.resize();

    const demo = this.sourceKind === 'demo';
    const ready = this.visionReady && (demo || this.video.readyState >= 2);
    const body = demo ? this.simulation.frame(now, this.screen?.demoMotion ?? null)
      : ready ? this.detector.detect(this.video, now) : null;
    const brightness = ready && !demo ? this.probe.sample(this.video, now) : null;
    if (this.detector.failure && !demo && this.visionReady) {
      this.visionReady = false;
      stopCamera(this.stream);
      this.go({ name: 'welcome', error: this.detector.failure });
    }
    const inferenceFps = this.detector.meter.fps(now);
    const slow = !demo && ready && now - this.visionStartedAt > 5000 && inferenceFps < 10;
    this.slowSince = slow ? this.slowSince ?? now : null;
    this.handsFree.performance(inferenceFps, this.fps,
      this.slowSince !== null && now - this.slowSince > 5000 && loadPrefs().model !== 'lite',
      this.screen?.canChangeModel ?? false, this.switchingModel);

    const gesture = this.gestures.update(demo ? null : body, now, this.screen?.navigationGestures);
    if (gesture.fired) {
      this.handsFree.dispatch(gesture.fired, this.screen, now);
    }

    const hints = this.screen?.update({ body, t: now, dt, gesture, brightness, fps: this.fps }) ?? {};
    this.handsFree.update(gesture, this.screen, this.hasVision && !demo, now);

    // Слои рисуем в одном месте и в фиксированном порядке: подсказка
    // кадрирования снизу, скелет поверх неё.
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

    this.fx.update(dt);
    this.fx.draw();

    if (this.showFps) {
      this.els.fps.textContent = `${this.fps.toFixed(0)} FPS · ${body ? 'поза найдена' : 'позы нет'}`;
    }
  };


}

const EMPTY_SET = new Set<never>();
