import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceCoach } from '../src/ui/coach';

let now = 0;
let utterances: FakeUtterance[];
let timers: Map<number, () => void>;
let originalPerformance: PropertyDescriptor | undefined;
let coach: VoiceCoach;
class FakeUtterance {
  lang = ''; rate = 1; pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const globals = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  now = 0; utterances = []; timers = new Map();
  originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globals['SpeechSynthesisUtterance'] = FakeUtterance;
  let nextTimer = 0;
  globals['window'] = {
    speechSynthesis: { getVoices: () => [], addEventListener: () => {}, cancel: () => {}, speak: (u: FakeUtterance) => utterances.push(u) },
    setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  coach = new VoiceCoach();
});
afterEach(() => {
  coach.stop();
  if (originalPerformance) Object.defineProperty(globalThis, 'performance', originalPerformance);
  delete globals['window']; delete globals['SpeechSynthesisUtterance'];
});
const error = (ruleId: string, hint = 'Поправь положение. Числовая подробность.') => ({ ruleId, hint, severity: 'error' as const });
const end = () => utterances.at(-1)?.onend?.();

test('разные ошибки и команды используют общую паузу 10 секунд', () => {
  assert.equal(coach.feedback(error('a')), true); end();
  now = 9999;
  assert.equal(coach.feedback(error('b')), false);
  assert.equal(coach.say('Начали', 'high'), false);
  now = 10000;
  assert.equal(coach.feedback(error('b')), true);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0]?.text, 'Поправь положение.');
});
test('обычные предупреждения молчат и не попадают в очередь', () => {
  assert.equal(coach.feedback({ ...error('warning'), severity: 'warning' }), false);
  assert.equal(coach.say('Так держать', 'low'), false);
  assert.equal(coach.feedback(error('a')), true);
  now = 20000;
  assert.equal(coach.feedback(error('b')), false);
  end();
  assert.equal(utterances.length, 1);
  assert.equal(timers.size, 0);
  assert.equal(coach.feedback(error('c')), true);
  assert.equal(utterances.at(-1)?.text, 'Поправь положение.');
});
test('изменение чисел в одной ошибке не обходит интервал повторения 30 секунд', () => {
  assert.equal(coach.feedback(error('depth', 'Угол 130 градусов')), true); end();
  now = 10000;
  assert.equal(coach.feedback(error('depth', 'Угол 128 градусов')), false);
  now = 29999;
  assert.equal(coach.feedback(error('depth', 'Угол 132 градуса')), false);
  now = 30000;
  assert.equal(coach.feedback(error('depth', 'Угол 131 градус')), true);
});
test('пауза и переключение голоса не сбрасывают общий интервал', () => {
  coach.feedback(error('a'));
  coach.stop(); coach.setEnabled(false); coach.setEnabled(true);
  now = 9999;
  assert.equal(coach.feedback(error('b')), false);
  now = 10000;
  assert.equal(coach.feedback(error('b')), true);
});
test('событие отменённой фразы не снимает блокировку новой фразы', () => {
  coach.feedback(error('a')); const old = utterances[0]!;
  coach.stop(); now = 10000; coach.feedback(error('b'));
  old.onend?.(); now = 20000;
  assert.equal(coach.feedback(error('c')), false);
  end(); assert.equal(coach.feedback(error('c')), true);
});
test('выключенный или недоступный синтез речи не мешает тренировке', () => {
  coach.setEnabled(false);
  assert.equal(coach.feedback(error('a')), false);
  const savedWindow = globals['window'];
  delete globals['window'];
  const unavailable = new VoiceCoach();
  assert.equal(unavailable.isSupported, false);
  assert.equal(unavailable.feedback(error('a')), false);
  unavailable.stop();
  globals['window'] = savedWindow;
});
