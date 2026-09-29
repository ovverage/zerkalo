import { Screen } from '../../core/screen';
import type { DrawHints } from '../../core/screen';
import { loadPrefs, savePrefs } from '../../storage/prefs';
import type { ModelQuality } from '../../storage/prefs';

const MODELS: { id: ModelQuality; name: string; hint: string }[] = [
  { id: 'lite', name: 'Быстрая', hint: 'Меньше нагрузка на телефон' },
  { id: 'full', name: 'Баланс', hint: 'Скорость и детализация' },
  { id: 'heavy', name: 'Подробная', hint: 'Для производительных устройств' },
];

export class SettingsScreen extends Screen {
  private busy = false;
  protected override template(): string {
    const prefs = loadPrefs();
    return `<div class="screen screen--scroll settings">
      <header class="menu__head"><div><p class="guide-eyebrow">Звук и управление</p><h2 class="menu__title">Настройки</h2></div></header>
      <section class="settings-group"><h3>Звук и камера</h3>
        ${this.switchRow('voice', 'Голос тренера', 'Только важное, с паузой от 10 секунд', prefs.voice)}
        ${this.switchRow('sound', 'Звуки повторений', 'Короткий сигнал зачёта и завершения', prefs.sound)}
        ${this.switchRow('mirrored', 'Зеркальное отражение', 'Как в привычной фронтальной камере', prefs.mirrored)}
      </section>
      <section class="settings-group"><h3>Распознавание</h3><p class="settings-note">Если телефон нагревается или видео тормозит, выбери быструю модель.</p>
        <div class="model-options" role="group" aria-label="Модель распознавания">${MODELS.map(m => `<button data-action="model-${m.id}" aria-pressed="${prefs.model === m.id}"><span class="model-radio" aria-hidden="true"></span><span><b>${m.name}</b><small>${m.hint}</small></span><span class="model-code">${m.id}</span></button>`).join('')}</div>
        <p class="settings-status" data-el="model-status" role="status"></p>
      </section>
      <section class="settings-group"><h3>Управление</h3><p class="settings-note">Скрести руки на груди: начать, поставить паузу или продолжить. Между командами опусти руки. Поднятые руки не вызывают команд.</p><button class="settings-link" data-action="tutorial">Как пользоваться жестом <span>→</span></button></section>
      <section class="settings-about"><b>Зеркало <span>1.2.0</span></b><p>Кадры остаются на устройстве. История хранится только здесь.</p><button class="btn btn--link" data-action="camera">${this.app.hasVision ? 'На стартовый экран' : 'Подключить камеру'}</button></section>
    </div>`;
  }
  private switchRow(key: string, title: string, hint: string, on: boolean): string {
    return `<button class="setting-row" role="switch" aria-checked="${on}" data-action="${key}"><span><b>${title}</b><small>${hint}</small></span><i class="setting-switch" aria-hidden="true"></i></button>`;
  }
  protected override actions(): Record<string, () => void> {
    return {
      voice: () => this.flip('voice'), sound: () => this.flip('sound'), mirrored: () => this.flip('mirrored'),
      tutorial: () => this.app.go({ name: 'tutorial' }), camera: () => this.app.go({ name: 'welcome' }),
      ...Object.fromEntries(MODELS.map(m => [`model-${m.id}`, () => void this.selectModel(m.id)])),
    };
  }
  private flip(key: 'voice' | 'sound' | 'mirrored'): void {
    const prefs = loadPrefs(), next = { ...prefs, [key]: !prefs[key] };
    savePrefs(next);
    if (key === 'voice') this.app.coach.setEnabled(next.voice);
    if (key === 'sound') this.app.sound.setEnabled(next.sound);
    if (key === 'mirrored') this.app.mirrored = next.mirrored;
    this.q(`[data-action="${key}"]`)?.setAttribute('aria-checked', String(next[key]));
  }
  private async selectModel(model: ModelQuality): Promise<void> {
    if (this.busy || loadPrefs().model === model) return;
    this.busy = true;
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('.model-options button');
    buttons.forEach(b => { b.disabled = true; });
    this.setText('[data-el="model-status"]', 'Подготавливаю модель…');
    try {
      await this.app.setModelQuality(model, p => this.setText('[data-el="model-status"]', `Подготовка · ${Math.round(p.ratio * 100)}%`));
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset['action'] === `model-${model}`)));
      this.setText('[data-el="model-status"]', 'Готово. Модель выбрана.');
    } catch {
      this.setText('[data-el="model-status"]', 'Не удалось загрузить модель. Попробуй снова или подключи камеру со стартового экрана.');
    } finally { this.busy = false; buttons.forEach(b => { b.disabled = false; }); }
  }
  override update(): DrawHints { return { hide: true }; }

}
