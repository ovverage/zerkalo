/** Sparse coaching: no queue, no interruption, one utterance per ten seconds. */
export type CoachPriority = 'low' | 'normal' | 'high';
export const VOICE_INTERVAL_MS = 10_000;
const REPEAT_INTERVAL_MS = 30_000;

export interface SpokenFeedback {
  ruleId: string;
  hint: string;
  severity: 'error' | 'warning';
}

export class VoiceCoach {
  private voice: SpeechSynthesisVoice | null = null;
  private enabled = true;
  private readonly supported: boolean;
  private active: SpeechSynthesisUtterance | null = null;
  private watchdog: number | null = null;
  private lastAt = -Infinity;
  private readonly repeated = new Map<string, number>();

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      this.pickVoice();
      window.speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
    }
  }

  get isSupported(): boolean { return this.supported; }
  get isEnabled(): boolean { return this.enabled && this.supported; }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  /** Routine remarks stay on screen; repeat a persistent important error at most every 30 s. */
  feedback(message: SpokenFeedback): boolean {
    if (message.severity !== 'error') return false;
    const now = performance.now();
    if (now - (this.repeated.get(message.ruleId) ?? -Infinity) < REPEAT_INTERVAL_MS) return false;
    const text = SHORT_HINTS[message.ruleId] ?? concise(message.hint);
    if (!this.say(text, 'high')) return false;
    this.repeated.set(message.ruleId, now);
    return true;
  }

  say(text: string, priority: CoachPriority = 'normal'): boolean {
    if (!this.isEnabled || !text || priority === 'low' || this.active) return false;
    const now = performance.now();
    if (now - this.lastAt < VOICE_INTERVAL_MS) return false;

    const utterance = new SpeechSynthesisUtterance(concise(text));
    utterance.lang = 'ru-RU';
    utterance.rate = 1.06;
    utterance.pitch = 1;
    if (this.voice) utterance.voice = this.voice;
    this.active = utterance;
    this.lastAt = now;
    const finish = () => {
      // cancel() may deliver an old end/error event after a new phrase has started.
      if (this.active !== utterance) return;
      this.clearWatchdog();
      this.active = null;
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.watchdog = window.setTimeout(() => {
      if (this.active !== utterance) return;
      this.active = null;
      this.clearWatchdog();
      window.speechSynthesis.cancel();
    }, 1500 + utterance.text.length * 90);
    try { window.speechSynthesis.speak(utterance); }
    catch { finish(); return false; }
    return true;
  }

  stop(): void {
    this.active = null;
    this.clearWatchdog();
    if (this.supported) window.speechSynthesis.cancel();
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private pickVoice(): void {
    const voices = window.speechSynthesis.getVoices();
    this.voice = voices.find((v) => v.lang === 'ru-RU') ?? voices.find((v) => v.lang.startsWith('ru')) ?? null;
  }
}

function concise(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return sentence.length <= 150 ? sentence : `${sentence.slice(0, 147).replace(/\s+\S*$/, '')}.`;
}

const SHORT_HINTS: Record<string, string> = {
  'knee-valgus': 'Разводи колени в сторону носков.',
  'squat-depth': 'Приседай глубже: опускай таз до уровня колен.',
  'pushup-depth': 'Опускай грудь ниже, затем выпрямляй руки.',
  'pushup-sag': 'Напряги живот и подними таз до прямой линии тела.',
  'pushup-pike': 'Опусти таз, держи тело в одну линию.',
  'plank-sag': 'Напряги живот и подними таз. Таймер пока остановлен.',
  'plank-pike': 'Опусти таз до прямой линии. Таймер пока остановлен.',
  'plank-broken-line': 'Вытяни тело в прямую линию от плеч до колен.',
  'not-in-position': 'Прими исходную позу. Её можно посмотреть по кнопке «Как выполнять».',
};
