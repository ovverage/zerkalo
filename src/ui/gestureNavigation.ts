import type { Screen } from '../core/screen';
import type { GestureName } from '../gestures/uiGestures';

/** The same buttons serve touch, keyboard and gestures; no duplicate action map. */
export class GestureNavigation {
  private screen: Screen | null = null;
  private context = '';
  private selected: HTMLElement | null = null;
  private targets: HTMLElement[] = [];
  constructor(private readonly ui: HTMLElement) {
    ui.addEventListener('click', event => {
      const node = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-gesture-scroll]');
      if (node) this.scroll(node.dataset['gestureScroll']!);
    });
  }
  private scroll(direction: string): void {
    const host = this.ui.querySelector<HTMLElement>('dialog[open]') ?? this.ui.querySelector<HTMLElement>('.screen--scroll');
    host?.scrollBy({ top: host.clientHeight * (direction === 'down' ? .7 : -.7), behavior: 'instant' });
  }

  get label(): string {
    return this.selected?.dataset['gestureLabel'] ?? this.selected?.getAttribute('aria-label') ??
      this.selected?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 85) ?? '';
  }
  get active(): boolean { return this.selected !== null; }

  sync(screen: Screen | null, enabled: boolean): void {
    const config = enabled ? screen?.gestureNavigation : null;
    if (!config) { this.clear(); this.context = ''; this.screen = screen; return; }
    const scope = this.ui.querySelector('dialog[open]') ?? this.ui;
    const seen = new Set<string>();
    this.targets = [...scope.querySelectorAll<HTMLElement>('button[data-action], button[data-tab], [data-gesture-scroll], [data-gesture-section], [data-gesture-performance]')]
      .filter(node => {
        const style = getComputedStyle(node);
        if (node.hasAttribute('data-gesture-exclude') || node.closest('[hidden]') || node.matches(':disabled') || !node.getClientRects().length || style.visibility === 'hidden') return false;
        // Paused controls also appear in the footer. One command per action.
        const key = node.dataset['action'] === 'pause' ? 'resume' : node.dataset['action'];
        if (key && seen.has(key)) return false;
        if (key) seen.add(key);
        return true;
      });
    if (screen !== this.screen || config.key !== this.context || !this.targets.includes(this.selected!)) {
      this.screen = screen; this.context = config.key;
      this.select(this.targets.find(node => node.dataset['action'] === config.defaultAction) ?? this.targets[0] ?? null, false);
    }
  }

  handle(gesture: GestureName): boolean {
    if (!this.selected || !this.targets.length) return false;
    if (gesture !== 'cross') {
      // Read a tall section in pages before moving focus past it.
      if (this.selected.hasAttribute('data-gesture-section')) {
        const host = this.selected.closest<HTMLElement>('dialog, .screen--scroll');
        if (host) {
          const rect = this.selected.getBoundingClientRect(), view = host.getBoundingClientRect();
          const sticky = [...host.querySelectorAll<HTMLElement>('.handsfree, .preview__foot')]
            .filter(node => getComputedStyle(node).position === 'sticky').reduce((h, node) => h + node.offsetHeight, 0);
          const upper = view.top + 12, lower = view.bottom - sticky - 12;
          const distance = gesture === 'next' ? rect.bottom - lower : rect.top - upper;
          if ((gesture === 'next' && distance > 8) || (gesture === 'previous' && distance < -8)) {
            const before = host.scrollTop;
            host.scrollBy({ top: Math.sign(distance) * Math.min(Math.abs(distance), Math.max(80, (lower - upper) * .7)), behavior: 'instant' });
            if (host.scrollTop !== before) return true;
          }
        }
      }
      const index = this.targets.indexOf(this.selected);
      this.select(this.targets[(index + (gesture === 'next' ? 1 : -1) + this.targets.length) % this.targets.length]!, true);
    } else {
      const scroll = this.selected.dataset['gestureScroll'];
      if (scroll) {
        this.scroll(scroll);
      } else if (this.selected.hasAttribute('data-gesture-section')) {
        this.selected.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else this.selected.click();
    }
    return true;
  }
  private select(node: HTMLElement | null, scroll: boolean): void {
    this.clear(); this.selected = node;
    node?.classList.add('gesture-selected');
    if (scroll && !node?.dataset['gestureScroll']) node?.scrollIntoView({ block: node.hasAttribute('data-gesture-section') ? 'start' : 'nearest', inline: 'nearest', behavior: 'instant' });
  }
  private clear(): void { this.selected?.classList.remove('gesture-selected'); this.selected = null; }
}
