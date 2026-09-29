/** Точка входа: собирает ссылки на элементы страницы и запускает приложение. */

import { App } from './app';

// Шрифт лежит в сборке, а не грузится с Google Fonts: Android-версия работает
// без интернета, а веб-версия не зависит от доступности стороннего CDN.
// Берём только используемые начертания и оба нужных подмножества.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-800.css';

import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/guidance.css';
import './styles/handsfree.css';

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`элемент #${id} не найден в разметке`);
  return el as T;
}

const app = new App({
  stage: need('stage'),
  video: need<HTMLVideoElement>('video'),
  skeleton: need<HTMLCanvasElement>('skeleton'),
  effects: need<HTMLCanvasElement>('effects'),
  ui: need('ui'),
  fps: need('fps'),
});

app.boot();

// Только для разработки: из консоли удобно открыть любой экран без камеры —
// например, __app.go({ name: 'menu' }). В сборку этот блок не попадает.
if (import.meta.env.DEV) {
  (window as unknown as { __app: App }).__app = app;
}

// Горячая перезагрузка не должна оставлять камеру включённой.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.stop());
}
