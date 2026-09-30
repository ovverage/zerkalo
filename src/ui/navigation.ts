import type { Route } from '../core/screen';

const ITEMS = [
  { id: 'programs', label: 'Тренировки', path: 'M4 7h16v13H4z M8 4v6m8-6v6M4 12h16', route: { name: 'menu', section: 'programs' } },
  { id: 'exercises', label: 'Упражнения', path: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z', route: { name: 'menu', section: 'exercises' } },
  { id: 'history', label: 'Прогресс', path: 'M5 20V12m7 8V4m7 16V8', route: { name: 'history' } },
  { id: 'settings', label: 'Настройки', path: 'M4 7h7m4 0h5M4 17h3m4 0h9 M11 4v6m-4 4v6', route: { name: 'settings' } },
] satisfies { id: string; label: string; path: string; route: Route }[];

export type InterfacePlatform = 'web' | 'android';

/** Web header or native bottom tabs. Both participate in layout and use the same routes. */
export class AppNavigation {
  readonly element = document.createElement('nav');
  constructor(navigate: (route: Route) => void, private readonly platform: InterfacePlatform) {
    this.element.className = platform === 'android' ? 'bottom-nav' : 'web-nav';
    this.element.setAttribute('aria-label', 'Разделы приложения');
    const items = ITEMS.map(item => `<button data-tab="${item.id}">${platform === 'android' ? `<span class="bottom-nav__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${item.path}"/></svg></span>` : ''}<span>${item.label}</span></button>`).join('');
    this.element.innerHTML = platform === 'android' ? items
      : `<div class="web-nav__inner"><button class="web-nav__brand" data-action="home" data-gesture-exclude aria-label="Зеркало — главная">Зеркало<span aria-hidden="true">/</span></button><div class="web-nav__links">${items}</div></div>`;
    this.element.querySelector('[data-action="home"]')?.addEventListener('click', () => navigate({ name: 'welcome' }));
    for (const item of ITEMS) this.element.querySelector(`[data-tab="${item.id}"]`)!.addEventListener('click', () => navigate(item.route));
  }
  mount(ui: HTMLElement): void {
    if (this.platform === 'android') ui.append(this.element);
    else ui.prepend(this.element);
  }
  update(route: Route): void {
    this.element.hidden = route.name === 'workout' || route.name === 'preview' || route.name === 'tutorial';
    const active = route.name === 'menu' ? route.section ?? 'programs'
      : route.name === 'welcome' ? (this.platform === 'android' ? 'programs' : '') : route.name === 'results' ? 'history' : route.name;
    for (const item of ITEMS) {
      const button = this.element.querySelector(`[data-tab="${item.id}"]`)!;
      if (item.id === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
}
