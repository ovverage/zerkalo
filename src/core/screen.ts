/**
 * Базовый экран и маршрутизация.
 *
 * Экраны не знают про класс App напрямую — только про интерфейс AppApi. Это
 * убирает циклическую зависимость и заодно ограничивает то, что экран может
 * сделать с приложением.
 *
 */

import type { Body, LandmarkName } from '../vision/landmarks';
import type { GestureEngine, GestureFrame, GestureName } from '../gestures/uiGestures';
import type { SkeletonOverlay } from '../ui/overlay';
import type { EffectLayer } from '../ui/fx';
import type { VoiceCoach } from '../ui/coach';
import type { SoundKit } from '../ui/sound';
import type { History, NewRecord } from '../storage/history';
import type { SessionResult } from '../engine/session';
import type { ProgressHandler } from '../vision/poseDetector';
import type { ModelQuality } from '../storage/prefs';
import type { WorkoutPlan } from '../exercises/registry';

export type Route =
  | { name: 'welcome'; error?: string }
  | { name: 'tutorial' }
  | { name: 'menu'; section?: 'programs' | 'exercises' }
  | { name: 'settings' }
  | { name: 'preview'; plan: WorkoutPlan }
  | { name: 'workout'; plan: WorkoutPlan }
  | { name: 'results'; result: SessionResult; records: readonly NewRecord[]; savedId?: string }
  | { name: 'history' };

export type SourceKind = 'camera' | 'demo';

export interface AppApi {
  readonly coach: VoiceCoach;
  readonly sound: SoundKit;
  readonly history: History;
  readonly gestures: GestureEngine;
  readonly overlay: SkeletonOverlay;
  readonly fx: EffectLayer;
  readonly video: HTMLVideoElement;
  /** Источник кадров запущен и модель загружена. */
  readonly hasVision: boolean;
  readonly source: SourceKind | null;
  mirrored: boolean;
  go(route: Route): void;
  startSource(kind: SourceKind, onProgress?: ProgressHandler): Promise<void>;
  setModelQuality(quality: ModelQuality, onProgress?: ProgressHandler): Promise<void>;
}

export interface ScreenFrame {
  body: Body | null;
  /** Время кадра, мс (performance.now). */
  t: number;
  /** Интервал с предыдущего кадра, с. */
  dt: number;
  gesture: GestureFrame;
  brightness: number | null;
  fps: number;
}

/** Что экран просит отрисовать поверх видео на этом кадре. */
export interface DrawHints {
  highlight?: ReadonlySet<LandmarkName>;
  /** Приглушить скелет. */
  dim?: boolean;
  /** Не рисовать скелет вообще. */
  hide?: boolean;
  /** Показать рамку, следующую за найденным человеком. */
  guide?: { ok: boolean };
}

export abstract class Screen {
  protected root!: HTMLElement;
  get demoMotion(): import('../demo/simulation').DemoMotion | null { return null; }

  /** Модель можно менять только вне активного движения. */
  get canChangeModel(): boolean { return true; }
  get gestureHint(): string { return ''; }
  /** null отключает выбор кнопок во время упражнения и собственного урока. */
  get gestureNavigation(): { key: string; defaultAction?: string } | null { return null; }
  get navigationGestures(): boolean { return this.gestureNavigation !== null; }
  onBack(): boolean { return false; }

  constructor(protected readonly app: AppApi) {}

  /** Разметка экрана. */
  protected abstract template(): string;

  /** Обработчики по значению data-action. */
  protected actions(): Record<string, () => void> {
    return {};
  }

  mount(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = this.template();
    const handlers = this.actions();
    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const node = target?.closest<HTMLElement>('[data-action]');
      const action = node?.dataset['action'];
      if (!action) return;
      handlers[action]?.();
    });
    this.onMount();
  }

  protected onMount(): void {}

  update(frame: ScreenFrame): DrawHints | void {
    void frame;
  }

  onGesture(gesture: GestureName): void {
    void gesture;
  }

  onVisibilityChange(hidden: boolean, t: number): void {
    void hidden;
    void t;
  }

  unmount(): void {}

  protected q<T extends HTMLElement>(selector: string): T | null {
    return this.root.querySelector<T>(selector);
  }

  /** Обновление текста без перерисовки всего экрана. */
  protected setText(selector: string, text: string): void {
    const node = this.q(selector);
    if (node && node.textContent !== text) node.textContent = text;
  }

  protected setStyle(selector: string, prop: string, value: string): void {
    this.q(selector)?.style.setProperty(prop, value);
  }

  protected toggle(selector: string, className: string, on: boolean): void {
    this.q(selector)?.classList.toggle(className, on);
  }
}
