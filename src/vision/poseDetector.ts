/** Keep heavy inference off the UI thread. At most one camera frame is in flight. */
import type { Body } from './landmarks';
import { PoseEngine } from './poseEngine';
import type { ProgressHandler, LoadProgress } from './poseEngine';
import type { ModelQuality } from '../storage/prefs';
import { InferenceMeter } from './inferenceMeter';
export type { ProgressHandler, LoadProgress, LoadPhase } from './poseEngine';

export class PoseDetector {
  readonly meter = new InferenceMeter();
  failure: string | null = null;
  private frameStartedAt = 0;
  constructor(private readonly loadTimeoutMs = 45000) {}
  private worker: Worker | null = null;
  private fallback: PoseEngine | null = null;
  private cached: Body | null = null;
  private busy = false;
  private ready = false;
  get isReady(): boolean { return this.ready; }
  private lastVideoTime = -1;
  private generation = 0;
  private requestId = 0;
  private pending: { id: number; resolve: () => void; reject: (e: Error) => void; progress?: ProgressHandler } | null = null;
  private readonly base = new URL(import.meta.env.BASE_URL, document.baseURI).href;

  async load(quality: ModelQuality, onProgress?: ProgressHandler): Promise<void> {
    const wasReady = this.ready;
    this.ready = false;
    this.cached = null;
    this.failure = null;
    try {
      if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
        if (!this.worker) this.startWorker();
        const id = ++this.requestId;
        let timer: ReturnType<typeof setTimeout>;
        await new Promise<void>((resolve, reject) => {
          this.pending = { id, resolve, reject, progress: onProgress };
          timer = setTimeout(() => {
            this.pending = null;
            this.worker?.terminate();
            this.worker = null;
            this.failure = 'Время загрузки модели истекло. Выбери Lite или перезапусти камеру.';
            reject(new Error('Модель не запустилась за 45 секунд. Проверь соединение и попробуй ещё раз или открой симуляцию.'));
          }, this.loadTimeoutMs);
          this.worker!.postMessage({ type: 'load', id, base: this.base, quality });
        }).finally(() => clearTimeout(timer));
      } else {
        this.fallback ??= new PoseEngine(this.base);
        await this.fallback.load(quality, onProgress);
      }
      this.reset();
      this.ready = true;
    } catch (e) {
      this.ready = wasReady && (this.worker !== null || this.fallback !== null);
      throw e;
    }
  }

  detect(video: HTMLVideoElement, now: number): Body | null {
    if (!this.ready) return null;
    if (this.fallback) {
      const completed = this.fallback.completedResults;
      const body = this.fallback.detect(video, now);
      if (this.fallback.completedResults !== completed) this.meter.result(performance.now());
      return body;
    }
    if (this.busy && now - this.frameStartedAt > 8000) {
      this.close();
      this.failure = 'Распознавание перестало отвечать. Перезапусти камеру или выбери более лёгкую модель в библиотеке упражнений.';
      return null;
    }
    if (!this.busy && video.currentTime !== this.lastVideoTime && video.videoWidth > 0) {
      this.busy = true;
      this.frameStartedAt = now;
      this.lastVideoTime = video.currentTime;
      const worker = this.worker;
      const generation = this.generation;
      void createImageBitmap(video).then((bitmap) => {
        if (!worker || worker !== this.worker || generation !== this.generation) {
          bitmap.close(); this.busy = false; return;
        }
        worker.postMessage({ type: 'frame', bitmap, t: now, generation }, [bitmap]);
      }).catch(() => { this.busy = false; });
    }
    return this.cached && now - this.cached.t <= 300 ? this.cached : null;
  }

  reset(): void {
    this.generation++;
    this.cached = null;
    this.lastVideoTime = -1;
    this.meter.reset();
    this.fallback?.reset();
    this.worker?.postMessage({ type: 'reset' });
  }

  close(): void {
    this.pending?.reject(new Error('Распознавание остановлено'));
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.fallback?.close();
    this.fallback = null;
    this.ready = false;
    this.busy = false;
    this.reset();
  }

  private startWorker(): void {
    this.worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<{
      type: string; id?: number; progress: LoadProgress; error?: string; body: Body | null; generation?: number;
    }>) => {
      if (data.type === 'result') {
        this.busy = false;
        if (data.generation === this.generation) {
          this.meter.result(performance.now());
          // UI time starts at delivery; no queued old frames can accumulate.
          this.cached = data.body ? { ...data.body, t: performance.now() } : null;
        }
      } else if (this.pending && data.id === this.pending.id) {
        if (data.type === 'progress') this.pending.progress?.(data.progress);
        else {
          const pending = this.pending;
          this.pending = null;
          if (data.type === 'loaded') pending.resolve();
          else pending.reject(new Error(data.error ?? 'Не удалось загрузить модель'));
        }
      }
    };
    this.worker.onerror = () => {
      this.failure = 'Распознавание остановилось. Обнови браузер или выбери модель Lite в библиотеке упражнений.';
      this.pending?.reject(new Error('Не удалось запустить распознавание в фоне. Обнови браузер.'));
      this.pending = null;
      this.busy = false;
      this.cached = null;
      this.ready = false;
      this.worker?.terminate();
      this.worker = null;
    };
  }
}
