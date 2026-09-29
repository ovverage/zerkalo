/** Стартовый экран: подключение камеры и звука по действию пользователя,
 * прогресс загрузки модели, вход в симуляцию и библиотеку упражнений. */

import { Screen } from '../../core/screen';
import type { AppApi } from '../../core/screen';
import type { LoadProgress } from '../../vision/poseDetector';
import { esc } from '../../core/dom';
import { loadPrefs } from '../../storage/prefs';

const PHASE_LABEL: Record<LoadProgress['phase'], string> = {
  engine: 'Загружаю движок распознавания',
  model: 'Загружаю модель позы',
  init: 'Запускаю распознавание',
};

export class WelcomeScreen extends Screen {
  private busy = false;
  private disposed = false;

  constructor(
    app: AppApi,
    private readonly error?: string,
  ) {
    super(app);
  }

  protected override template(): string {
    const totals = this.app.history.totals();

    return `
      <div class="screen screen--center welcome">
        <div class="hero">
          ${poseAnimation()}
          <div class="hero__chip">
            <span class="hero__chip-label">повторений</span>
            <span class="hero__digits"><i>0</i><i>1</i><i>2</i><i>3</i></span>
          </div>
        </div>

        <div class="panel panel--wide welcome__panel">
          <div class="brand">
            <h1 class="brand__name">Зеркало</h1>
            <p class="brand__tag">Тренировки с проверкой техники</p>
          </div>

          <ul class="bullets">
            <li><b>Считает повторения</b> и не засчитывает неполные</li>
            <li><b>Подсказывает по технике</b> во время упражнения</li>
            <li><b>Скрести руки</b> для старта или паузы</li>
          </ul>

          ${this.error ? `<div class="alert alert--error">${esc(this.error)}</div>` : ''}

          <div class="loader" data-el="loader" hidden>
            <div class="loader__row">
              <span class="loader__phase" data-el="phase">Готовлюсь…</span>
              <span class="loader__pct" data-el="pct"></span>
            </div>
            <div class="loader__track"><i data-el="fill"></i></div>
            <p class="loader__note">Первый запуск может занять до 45 секунд. Файлы сохраняются в кэше браузера.</p>
          </div>

          <div class="row row--buttons" data-el="buttons">
            <button class="btn btn--primary" data-action="camera">Включить камеру</button>
            <button class="btn btn--ghost" data-action="demo">Демо · симуляция без камеры</button>
          </div>

          <p class="note">
            Видео остаётся на устройстве.
            ${
              totals.sessions > 0
                ? `Уже пройдено тренировок: <b>${totals.sessions}</b>.`
                : 'Для тренировки нужен доступ к камере.'
            }
          </p>

          <button class="btn btn--link" data-action="exercises">Упражнения и видеопоказы →</button>

          ${
            totals.sessions > 0
              ? '<button class="btn btn--link" data-action="history">Посмотреть прогресс</button>'
              : ''
          }
        </div>
      </div>
    `;
  }

  protected override actions(): Record<string, () => void> {
    return {
      camera: () => void this.begin('camera'),
      demo: () => void this.begin('demo'),
      history: () => this.app.go({ name: 'history' }),
      exercises: () => { if (!this.busy) this.app.go({ name: 'menu', section: 'exercises' }); },
    };
  }

  private async begin(kind: 'camera' | 'demo'): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    this.q('[data-el="buttons"]')?.setAttribute('hidden', '');
    this.q('[data-el="loader"]')?.removeAttribute('hidden');

    try {
      await this.app.startSource(kind, (p) => this.showProgress(p));
    } catch (err) {
      if (this.disposed) return;
      this.busy = false;
      const message = err instanceof Error ? err.message : 'Не удалось запустить источник видео.';
      this.app.go({ name: 'welcome', error: message });
      return;
    }

    if (this.disposed) return;
    this.app.go(kind === 'demo' || loadPrefs().tutorialDone ? { name: 'menu' } : { name: 'tutorial' });
  }

  override unmount(): void { this.disposed = true; }

  private showProgress(p: LoadProgress): void {
    const pct = Math.round(p.ratio * 100);
    this.setText('[data-el="phase"]', PHASE_LABEL[p.phase]);
    this.setText('[data-el="pct"]', p.phase === 'init' ? '' : `${pct}%`);
    this.setStyle('[data-el="fill"]', 'width', `${p.phase === 'init' ? 100 : pct}%`);
    this.toggle('[data-el="fill"]', 'loader__fill--done', p.phase === 'init');
  }
}

/* ── Анимация на стартовом экране ────────────────────────────────────────── */

interface Joint {
  x: number;
  y: number;
}

type Skeleton = Record<string, Joint>;

/**
 * Три фазы приседа. Анимация — перекрёстное затухание между ними: так движение
 * читается однозначно, а сам рисунок повторяет то, что человек увидит на экране
 * во время тренировки.
 */
const POSES: readonly Skeleton[] = [
  {
    head: { x: 100, y: 40 },
    ls: { x: 82, y: 68 },
    rs: { x: 118, y: 68 },
    le: { x: 76, y: 98 },
    re: { x: 124, y: 98 },
    lw: { x: 74, y: 126 },
    rw: { x: 126, y: 126 },
    lh: { x: 90, y: 122 },
    rh: { x: 110, y: 122 },
    lk: { x: 88, y: 172 },
    rk: { x: 112, y: 172 },
    la: { x: 87, y: 220 },
    ra: { x: 113, y: 220 },
  },
  {
    head: { x: 100, y: 54 },
    ls: { x: 83, y: 82 },
    rs: { x: 117, y: 82 },
    le: { x: 78, y: 110 },
    re: { x: 122, y: 110 },
    lw: { x: 82, y: 134 },
    rw: { x: 118, y: 134 },
    lh: { x: 91, y: 134 },
    rh: { x: 109, y: 134 },
    lk: { x: 84, y: 176 },
    rk: { x: 116, y: 176 },
    la: { x: 87, y: 220 },
    ra: { x: 113, y: 220 },
  },
  {
    head: { x: 100, y: 78 },
    ls: { x: 84, y: 104 },
    rs: { x: 116, y: 104 },
    le: { x: 80, y: 128 },
    re: { x: 120, y: 128 },
    lw: { x: 90, y: 144 },
    rw: { x: 110, y: 144 },
    lh: { x: 92, y: 154 },
    rh: { x: 108, y: 154 },
    lk: { x: 79, y: 180 },
    rk: { x: 121, y: 180 },
    la: { x: 87, y: 220 },
    ra: { x: 113, y: 220 },
  },
];

const BONES: ReadonlyArray<readonly [string, string]> = [
  ['ls', 'rs'],
  ['ls', 'le'],
  ['le', 'lw'],
  ['rs', 're'],
  ['re', 'rw'],
  ['ls', 'lh'],
  ['rs', 'rh'],
  ['lh', 'rh'],
  ['lh', 'lk'],
  ['lk', 'la'],
  ['rh', 'rk'],
  ['rk', 'ra'],
];

function poseAnimation(): string {
  const groups = POSES.map((skeleton, i) => {
    const bones = BONES.map(([a, b]) => {
      const p = skeleton[a];
      const q = skeleton[b];
      if (!p || !q) return '';
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" />`;
    }).join('');

    const joints = Object.entries(skeleton)
      .filter(([name]) => name !== 'head')
      .map(([, j]) => `<circle cx="${j.x}" cy="${j.y}" r="4" />`)
      .join('');

    const head = skeleton['head'];

    return `<g class="hero__pose hero__pose--${i}">
      ${bones}
      ${joints}
      ${head ? `<circle class="hero__head" cx="${head.x}" cy="${head.y}" r="14" />` : ''}
    </g>`;
  }).join('');

  return `
    <svg class="hero__svg" viewBox="0 0 200 240" aria-hidden="true">
      <line class="hero__floor" x1="46" y1="228" x2="154" y2="228" />
      ${groups}
    </svg>`;
}
