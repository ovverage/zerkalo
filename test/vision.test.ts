import assert from 'node:assert/strict';
import test from 'node:test';
import { PoseDetector } from '../src/vision/poseDetector';
import { loadPrefs, savePrefs } from '../src/storage/prefs';
import { pose } from './synthetic';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: any[] = [];
  fail = false;
  constructor() { FakeWorker.latest = this; }
  postMessage(data: any) {
    this.messages.push(data);
    if (data.type === 'load') queueMicrotask(() => this.reply(this.fail
      ? { type: 'error', id: data.id, error: 'download failed' }
      : { type: 'loaded', id: data.id }));
  }
  reply(data: unknown) { this.onmessage?.({ data }); }
  terminate() {}
}

function environment() {
  const keys = ['Worker', 'OffscreenCanvas', 'createImageBitmap', 'document'] as const;
  const saved = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    Worker: FakeWorker, OffscreenCanvas: class {}, document: { baseURI: 'http://localhost/' },
    createImageBitmap: async () => ({ close() {} }),
  });
  return () => { for (const key of keys) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  } };
}

test('фоновое распознавание держит один кадр в работе и отбрасывает результат до сброса', async () => {
  const restore = environment();
  const detector = new PoseDetector();
  try {
    await detector.load('heavy');
    const worker = FakeWorker.latest;
    const video = { currentTime: 1, videoWidth: 1280 } as HTMLVideoElement;
    assert.equal(detector.detect(video, performance.now()), null);
    await Promise.resolve();
    const frame = worker.messages.find((m) => m.type === 'frame');
    assert.ok(frame);
    for (let i = 0; i < 10; i++) detector.detect({ ...video, currentTime: i + 2 } as HTMLVideoElement, performance.now());
    assert.equal(worker.messages.filter((m) => m.type === 'frame').length, 1);
    worker.reply({ type: 'result', generation: frame.generation, body: { ...pose(), sampleId: 1 } });
    const result = detector.detect(video, performance.now());
    assert.equal(result?.sampleId, 1);
    detector.reset();
    worker.reply({ type: 'result', generation: frame.generation, body: { ...pose(), sampleId: 2 } });
    assert.equal(detector.detect(video, performance.now()), null);
  } finally { detector.close(); restore(); }
});

test('неудачная смена модели оставляет предыдущий распознаватель работоспособным', async () => {
  const restore = environment();
  const detector = new PoseDetector();
  try {
    await detector.load('heavy');
    FakeWorker.latest.fail = true;
    await assert.rejects(detector.load('full'), /download failed/);
    detector.detect({ currentTime: 1, videoWidth: 1280 } as HTMLVideoElement, performance.now());
    await Promise.resolve();
    assert.equal(FakeWorker.latest.messages.filter((m) => m.type === 'frame').length, 1);
  } finally { detector.close(); restore(); }
});

test('Heavy становится новой настройкой по умолчанию, осознанный выбор Full или Lite сохраняется', () => {
  let raw: string | null = null;
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => raw, setItem: (_: string, value: string) => { raw = value; },
  } });
  try {
    assert.equal(loadPrefs().model, 'heavy');
    raw = JSON.stringify({ model: 'full', voice: false });
    assert.equal(loadPrefs().model, 'heavy');
    assert.equal(loadPrefs().voice, false);
    savePrefs({ ...loadPrefs(), model: 'full' });
    assert.equal(loadPrefs().model, 'full');
    raw = JSON.stringify({ model: 'lite' });
    assert.equal(loadPrefs().model, 'lite');
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
