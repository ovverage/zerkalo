import { PoseEngine } from './poseEngine';
import type { ModelQuality } from '../storage/prefs';
let engine: PoseEngine | null = null;
self.onmessage = async ({ data }: MessageEvent<
  | { type: 'load'; id: number; base: string; quality: ModelQuality }
  | { type: 'frame'; bitmap: ImageBitmap; t: number; generation: number }
  | { type: 'reset' }
>) => {
  if (data.type === 'load') {
    engine ??= new PoseEngine(data.base, true);
    try {
      await engine.load(data.quality, (progress) => self.postMessage({ type: 'progress', id: data.id, progress }));
      self.postMessage({ type: 'loaded', id: data.id });
    } catch (e) {
      self.postMessage({ type: 'error', id: data.id, error: e instanceof Error ? e.message : String(e) });
    }
  } else if (data.type === 'reset') {
    engine?.reset();
  } else {
    try {
      const body = engine?.detect(data.bitmap, data.t) ?? null;
      self.postMessage({ type: 'result', body, generation: data.generation });
    } catch {
      self.postMessage({ type: 'result', body: null, generation: data.generation });
    } finally { data.bitmap.close(); }
  }
};
