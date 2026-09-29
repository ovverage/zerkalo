import test from 'node:test';
import assert from 'node:assert/strict';
import { startCamera, CameraError } from '../src/vision/camera';

for (const [name, reason, hint] of [
  ['NotAllowedError', 'denied', /разрешите доступ/],
  ['NotFoundError', 'not-found', /симуляцию/],
  ['NotReadableError', 'in-use', /занята/],
] as const) {
  test(`отказ камеры ${name}: причина и действие вместо зависшей загрузки`, async () => {
    const saved = ['window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
      getUserMedia: async () => { throw new DOMException('fixture', name); },
    } } });
    try {
      await assert.rejects(startCamera({} as HTMLVideoElement), (error: unknown) => error instanceof CameraError && error.reason === reason && hint.test(error.message));
    } finally {
      for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
    }
  });
}
