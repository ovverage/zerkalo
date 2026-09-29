/** Local pose inference with rotation recovery and fresh-frame scheduling. */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';

import type { Body } from './landmarks';
import { LANDMARK_COUNT, buildFrame } from './landmarks';
import { PoseSmoother } from './smoothing';
import { restoreScreen, restoreWorld } from './rotation';
import type { CameraRotation } from './rotation';
import type { ModelQuality } from '../storage/prefs';



const MODEL_PATHS: Record<ModelQuality, string> = {
  lite: `models/pose_landmarker_lite.task`,
  full: `models/pose_landmarker_full.task`,
  heavy: `models/pose_landmarker_heavy.task`,
};

export type LoadPhase = 'engine' | 'model' | 'init';

export interface LoadProgress {
  phase: LoadPhase;
  detail?: string;
  /** Доля от общего объёма загрузки, 0..1. */
  ratio: number;
  loadedBytes: number;
  totalBytes: number;
}

export type ProgressHandler = (progress: LoadProgress) => void;

export class PoseEngine {
  completedResults = 0;
  private landmarker: PoseLandmarker | null = null;
  private quality: ModelQuality | null = null;
  private readonly smoother = new PoseSmoother();
  private lastTimestamp = -1;
  private lastFrameTime = 0;
  private lastVideoTime = -1;
  private lastAttemptAt = -Infinity;
  private cached: Body | null = null;
  private sampleId = 0;
  private rotation: CameraRotation = 0;
  private searchIndex = 0;
  private lostAt: number | null = null;
  private lastSearchAt = -Infinity;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private readonly screenSmoother = new PoseSmoother();

  constructor(private readonly base: string, private readonly worker = false) {}

  async load(quality: ModelQuality, onProgress?: ProgressHandler): Promise<void> {
    if (this.landmarker && this.quality === quality) return;

    const modelPath = new URL(MODEL_PATHS[quality], this.base).href;
    const wasmDir = new URL('wasm', this.base).href;
    const wasmUrl = `${wasmDir}/${this.worker ? 'vision_wasm_module_internal.wasm' : wasmFileName()}`;
    const [wasmSize, modelSize] = await Promise.all([sizeOf(wasmUrl), sizeOf(modelPath)]);
    const total = wasmSize + modelSize;

    let loaded = 0;
    const report = (phase: LoadPhase, detail?: string): void =>
      onProgress?.({
        phase,
        detail,
        ratio: total > 0 ? Math.min(loaded / total, 1) : 0,
        loadedBytes: loaded,
        totalBytes: total,
      });

    report('engine');

    // Прогреваем кэш браузера: MediaPipe запросит этот же URL и получит его
    // из кэша. Если прогрев не удался — не страшно, скачает сам, просто без
    // индикатора.
    await download(wasmUrl, (chunk) => {
      loaded += chunk;
      report('engine');
    }).catch(() => undefined);

    const modelBuffer = await download(modelPath, (chunk) => {
      loaded += chunk;
      report('model');
    });

    report('init');

    const fileset = await FilesetResolver.forVisionTasks(wasmDir, this.worker);
    report('init', 'runtime');
    const factory = this.worker ? (await import(/* @vite-ignore */ fileset.wasmLoaderPath)).default : null;
    if (this.worker) fileset.wasmLoaderPath = '';
    report('init', 'model');
    // Construct before replacing: a failed download/GPU init keeps the current model usable.
    const create = (delegate: 'GPU' | 'CPU') => {
      if (factory) (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factory;
      return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: modelBuffer
        ? { modelAssetBuffer: modelBuffer.slice(), delegate }
        : { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
      });
    };
    const next = preferCpu() ? await create('CPU') : await create('GPU').catch(() => create('CPU'));
    this.landmarker?.close();
    this.landmarker = next;
    this.quality = quality;
    this.reset();
  }

  /**
   * Один кадр. Возвращает null, если человек не найден — вызывающий код сам
   * решает, что показать (подсказку про кадрирование).
   */
  detect(video: HTMLVideoElement | ImageBitmap, nowMs: number): Body | null {
    if (!this.landmarker) return null;
    // Video is usually 30 FPS while the display can be 60/120. Do not infer twice.
    const videoTime = 'currentTime' in video ? video.currentTime : nowMs;
    if (videoTime === this.lastVideoTime || nowMs - this.lastAttemptAt < 1000 / 30) {
      return this.cached && nowMs - this.cached.t <= 250 ? this.cached : null;
    }
    this.lastVideoTime = videoTime;
    this.lastAttemptAt = nowMs;

    let result = this.infer(video, this.rotation, nowMs);
    if (!usable(result)) {
      this.lostAt ??= nowMs;
      // Search all of the frame in another orientation. Once found, retain that
      // orientation so the VIDEO tracker sees a continuous stream of coordinates.
      if (nowMs - this.lostAt >= 350 && nowMs - this.lastSearchAt >= 650) {
        const rotations: CameraRotation[] = [0, 90, -90];
        let candidate = rotations[this.searchIndex++ % rotations.length]!;
        if (candidate === this.rotation) candidate = rotations[this.searchIndex++ % rotations.length]!;
        this.lastSearchAt = nowMs;
        const recovered = this.infer(video, candidate, nowMs);
        if (usable(recovered)) {
          this.rotation = candidate;
          this.smoother.reset();
          this.screenSmoother.reset();
          result = recovered;
        }
      }
    }
    this.completedResults += 1;
    if (!usable(result)) {
      this.cached = null;
      if (nowMs - (this.lostAt ?? nowMs) > 450) {
        this.smoother.reset();
        this.screenSmoother.reset();
      }
      return null;
    }
    this.lostAt = null;
    const world = result.worldLandmarks[0]!;
    const screen = result.landmarks[0]!;
    const dt = this.lastFrameTime ? Math.min((nowMs - this.lastFrameTime) / 1000, 0.2) : 1 / 30;
    this.lastFrameTime = nowMs;
    const aspect = 'videoWidth' in video ? video.videoWidth / video.videoHeight : video.width / video.height;
    const smoothedWorld = this.smoother.smooth(world.map((p) => restoreWorld(p, this.rotation)), dt);
    const smoothedScreen = this.screenSmoother.smooth(screen.map((p) => restoreScreen(p, this.rotation, aspect)), dt);
    this.cached = {
      world: smoothedWorld,
      screen: smoothedScreen,
      visibility: screen.map((p) => p.visibility ?? 0),
      frame: buildFrame(smoothedWorld),
      imageAspect: aspect,
      sampleId: ++this.sampleId,
      t: nowMs,
      dt,
    };
    return this.cached;
  }

  private infer(video: HTMLVideoElement | ImageBitmap, rotation: CameraRotation, now: number): PoseLandmarkerResult | null {
    this.lastTimestamp = Math.max(now, this.lastTimestamp + 1);
    try {
      if (rotation === 0) return this.landmarker!.detectForVideo(video, this.lastTimestamp);
      this.canvas ??= this.worker ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      const canvas = this.canvas;
      const width = 'videoWidth' in video ? video.videoWidth : video.width;
      const height = 'videoHeight' in video ? video.videoHeight : video.height;
      if (canvas.width !== height || canvas.height !== width) {
        canvas.width = height;
        canvas.height = width;
      }
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(video, -width / 2, -height / 2);
      return this.landmarker!.detectForVideo(canvas, this.lastTimestamp);
    } catch {
      return null;
    }
  }

  reset(): void {
    this.smoother.reset();
    this.screenSmoother.reset();
    this.cached = null;
    this.lastFrameTime = 0;
    this.lastVideoTime = -1;
    this.lastAttemptAt = -Infinity;
    this.rotation = 0;
    this.lostAt = null;
    this.searchIndex = 0;
    this.lastSearchAt = -Infinity;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.quality = null;
    this.reset();
  }

}

function usable(result: PoseLandmarkerResult | null): result is PoseLandmarkerResult {
  const screen = result?.landmarks[0];
  const world = result?.worldLandmarks[0];
  if (!screen || !world || screen.length < LANDMARK_COUNT || world.length < LANDMARK_COUNT) return false;
  if (![...screen, ...world].every((p) => [p.x, p.y, p.z].every(Number.isFinite))) return false;
  return [11, 12, 23, 24].filter((i) => (screen[i]?.visibility ?? 0) >= 0.45).length >= 2;
}

/**
 * Без SIMD браузеру нужна другая сборка рантайма, и она заметно легче. Проверку
 * делаем тем же способом, что и сам MediaPipe: пробуем собрать модуль с
 * SIMD-инструкцией.
 */
function wasmFileName(): string {
  const SIMD_PROBE = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
    15, 253, 98, 11,
  ]);
  try {
    return WebAssembly.validate(SIMD_PROBE)
      ? 'vision_wasm_internal.wasm'
      : 'vision_wasm_nosimd_internal.wasm';
  } catch {
    return 'vision_wasm_nosimd_internal.wasm';
  }
}

/** Размер файла по HEAD-запросу — нужен, чтобы знать знаменатель прогресса. */
async function sizeOf(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return Number(res.headers.get('content-length') ?? 0);
  } catch {
    return 0;
  }
}

/** Скачивает файл, сообщая о каждом полученном куске. */
async function download(url: string, onChunk: (bytes: number) => void): Promise<Uint8Array | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`не удалось загрузить ${url}: ${res.status}`);

  if (!res.body) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    onChunk(buffer.byteLength);
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    size += value.byteLength;
    onChunk(value.byteLength);
  }

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Software WebGL can spend tens of seconds compiling Heavy. WASM is faster there. */
function preferCpu(): boolean {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(renderer);
  } catch { return false; }
}
