/** Настройки пользователя в localStorage: звук, голос, зеркало, обучение. */

const KEY = 'zerkalo.prefs.v1';

/**
 * 'heavy' — по умолчанию; 'full' — баланс нагрузки и качества;
 * 'lite' легче и быстрее — для слабых устройств.
 */
export type ModelQuality = 'lite' | 'full' | 'heavy';

export interface Prefs {
  sound: boolean;
  voice: boolean;
  mirrored: boolean;
  tutorialDone: boolean;
  model: ModelQuality;
  visionVersion: number;
}

const DEFAULTS: Prefs = {
  sound: true,
  voice: true,
  mirrored: true,
  tutorialDone: false,
  model: 'heavy',
  visionVersion: 2,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULTS };
    const p = parsed as Partial<Record<keyof Prefs, unknown>>;
    return {
      sound: typeof p.sound === 'boolean' ? p.sound : DEFAULTS.sound,
      voice: typeof p.voice === 'boolean' ? p.voice : DEFAULTS.voice,
      mirrored: typeof p.mirrored === 'boolean' ? p.mirrored : DEFAULTS.mirrored,
      tutorialDone: typeof p.tutorialDone === 'boolean' ? p.tutorialDone : DEFAULTS.tutorialDone,
      model: p.model === 'lite' || p.model === 'heavy' || (p.model === 'full' && p.visionVersion === 2)
        ? p.model : DEFAULTS.model,
      visionVersion: 2,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* приватный режим: настройки не сохранятся, приложение работает */
  }
}
