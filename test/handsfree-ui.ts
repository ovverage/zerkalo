/** Integration: one cross gesture + touch navigation, real screens and workout engine. */
import '../src/styles/base.css'; import '../src/styles/layout.css'; import '../src/styles/components.css';
import '../src/styles/screens.css'; import '../src/styles/guidance.css'; import '../src/styles/handsfree.css'; import '../src/styles/mobile.css';
import { TutorialScreen } from '../src/ui/screens/tutorial';
import { MenuScreen } from '../src/ui/screens/menu';
import { PreviewScreen } from '../src/ui/screens/preview';
import { WorkoutScreen } from '../src/ui/screens/workout';
import { ResultsScreen } from '../src/ui/screens/results';
import { HistoryScreen } from '../src/ui/screens/history';
import { SettingsScreen } from '../src/ui/screens/settings';
import { GestureEngine } from '../src/gestures/uiGestures';
import { HandsFreeControls } from '../src/ui/handsFree';
import { BottomNavigation } from '../src/ui/navigation';
import { VoiceCoach } from '../src/ui/coach'; import { SoundKit } from '../src/ui/sound';
import type { AppApi, Route, Screen } from '../src/core/screen';
import { pose } from './synthetic'; import { LANDMARK_INDEX as I } from '../src/vision/landmarks';
import type { Body } from '../src/vision/landmarks';
import { DemoSimulation } from '../src/demo/simulation';

const ui = document.querySelector<HTMLElement>('#ui')!;
const report = document.querySelector<HTMLElement>('#report')!;
const controls = new HandsFreeControls(ui, () => {}), engine = new GestureEngine();
const navigation = new BottomNavigation(route => app.go(route));
let screen: Screen, route: Route, t = 1000;
const trail: string[] = [], saved: unknown[] = [];
// Simulate native SystemBars CSS insets; WebView device testing is separate.
if (new URLSearchParams(location.search).has('insets')) {
  document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
  document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
}
const app = {
  coach: new VoiceCoach(), sound: new SoundKit(), hasVision: true, source: 'camera', mirrored: true,
  gestures: engine, history: { totals: () => ({ sessions: 0, streakDays: 0 }), list: () => [], bests: () => [], add: (result: unknown) => { saved.push(result); return { records: [] }; } },
  fx: { float() {}, burst() {}, clear() {} },
  go(next: Route) {
    screen?.unmount(); route = next; engine.clearCooldown(); trail.push(next.name);
    screen = next.name === 'tutorial' ? new TutorialScreen(app) : next.name === 'preview' ? new PreviewScreen(app, next.plan)
      : next.name === 'workout' ? new WorkoutScreen(app, next.plan) : next.name === 'results' ? new ResultsScreen(app, next.result, next.records)
      : next.name === 'history' ? new HistoryScreen(app) : next.name === 'settings' ? new SettingsScreen(app)
      : new MenuScreen(app, next.name === 'menu' ? next.section : 'programs');
    ui.innerHTML = '<div class="screenhost"></div>'; screen.mount(ui.firstElementChild as HTMLElement);
    navigation.update(next); ui.append(controls.element, navigation.element);
  },
} as unknown as AppApi;
app.coach.setEnabled(false); app.sound.setEnabled(false);
const log = (msg: string) => { report.textContent += `\n✓ ${msg}`; };
const expect = (condition: unknown, msg: string) => { if (!condition) throw Error(msg); log(msg); };
function tick(body: Body | null) {
  t += 1000 / 30;
  const gesture = engine.update(body, t);
  if (gesture.fired) screen.onGesture(gesture.fired);
  screen.update({ body, t, dt: 1 / 30, brightness: .5, fps: 60, gesture });
  controls.update(gesture, screen, true, t);
}
const feed = (body: Body | null, n: number) => { for (let i = 0; i < n; i++) tick(body); };
const neutral = () => feed(pose(), 48);
function crossed(): Body {
  const b = pose();
  b.world[I.left_wrist] = { x: -.16, y: -.34, z: -.06 }; b.world[I.right_wrist] = { x: .16, y: -.34, z: -.06 };
  return b;
}
function gesture(frames = 30) { neutral(); feed(crossed(), frames); }
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function tap(selector: string) {
  const button = ui.querySelector<HTMLElement>(selector);
  if (!button) throw Error(`No button ${selector}`);
  button.scrollIntoView({ block: 'nearest' }); await paint();
  const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || !button.contains(hit)) throw Error(`Button obstructed: ${selector}`);
  button.click(); await paint(); tick(pose());
}
function layout(label: string) {
  expect(document.documentElement.scrollWidth <= innerWidth, `${label}: нет горизонтального обрезания`);
  const nav = navigation.element.getBoundingClientRect(), host = ui.querySelector('.screenhost')!.getBoundingClientRect();
  if (!navigation.element.hidden) expect(host.bottom <= nav.top && nav.bottom <= innerHeight - (location.search ? 24 : 0), `${label}: навигация не закрывает контент и системную панель`);
}
async function run() {
  app.go({ name: 'tutorial' }); await paint(); tick(pose());
  expect(ui.querySelectorAll('.lesson').length === 1 && !ui.querySelector('[data-action="dwell"]'), 'один урок креста, задания с ладонью нет');
  gesture();
  expect(ui.querySelectorAll('.lesson--done').length === 1, 'крест засчитывается');
  gesture(120); await paint();
  expect(route.name === 'menu', 'удержание подтверждения не проскакивает меню');
  expect(!ui.textContent?.includes('Камера подключена'), 'на главной нет статуса камеры');
  layout('Тренировки');
  await tap('[data-tab="exercises"]');
  expect(ui.querySelectorAll('.chip').length === 11, 'все 11 упражнений доступны в отдельной вкладке');
  layout('Упражнения');
  await tap('[data-action="ex-push-up"]');
  expect(route.name === 'preview', 'последнее упражнение доступно после обычной прокрутки');
  await tap('[data-action="back"]');
  expect(!!ui.querySelector('[data-tab="exercises"][aria-current="page"]'), 'назад из видеопоказа возвращает во вкладку упражнений');
  await tap('[data-action="ex-push-up"]');
  await tap('[data-action="start"]');
  feed(null, 20); await paint();
  const setup = ui.querySelector<HTMLElement>('.setup--compact')!;
  expect(setup.getBoundingClientRect().height <= Math.min(128, innerHeight / 4), 'подготовка занимает не больше четверти экрана');
  expect(setup.textContent?.includes('Встань в кадр.') && !setup.textContent?.includes('любой части'), 'при поиске позы одна короткая подсказка');
  if (new URLSearchParams(location.search).has('setup')) { report.hidden = true; return; }
  feed(pose({ prone: true, armElevation: 90, elbowBend: 172 }), 160);
  expect(route.name === 'workout', 'боковое упражнение запущено');
  gesture(); await paint();
  expect(screen.canChangeModel && ui.textContent?.includes('Пауза'), 'из боковой позы можно встать и поставить паузу крестом');
  const actions = ui.querySelector('.workout-actions')!.getBoundingClientRect();
  expect(actions.bottom <= innerHeight && actions.top > 0, 'нижние кнопки тренировки видны');
  await tap('.workout-actions [data-action="help"]');
  expect(!!ui.querySelector('dialog[open]'), 'видеопомощь открывается');
  gesture(); await paint();
  expect(!ui.querySelector('dialog[open]'), 'крест закрывает помощь');
  expect(screen.onBack(), 'системный «назад» обрабатывается тренировкой');
  app.go({ name: 'menu' }); await paint(); tick(pose());
  await tap('[data-tab="settings"]'); layout('Настройки');
  expect(!!ui.querySelector('[role="switch"]'), 'настройки вынесены в отдельный экран');
  await tap('[data-tab="history"]'); layout('Прогресс');
  await tap('[data-tab="programs"]'); await tap('[data-action="workout-motion"]');
  gesture(); await paint(); feed(pose(), 160);
  expect(!screen.canChangeModel, 'старт крестом');
  neutral(); feed(pose({ armElevation: 180 }), 90);
  expect(!screen.canChangeModel, 'поднятые руки не останавливают тренировку');
  gesture(); tick(pose());
  expect(screen.canChangeModel && ui.textContent?.includes('Пауза'), 'крест ставит паузу, не теряя тренировку');
  neutral(); feed(pose({ armElevation: 180 }), 90);
  expect(screen.canChangeModel, 'поднятые руки не снимают паузу');
  gesture(); feed(pose(), 160);
  screen.onVisibilityChange(true, t + 50); t += 60000; screen.onVisibilityChange(false, t); tick(pose());
  expect(screen.canChangeModel, 'после сворачивания остаётся пауза');
  gesture(); feed(pose(), 160);
  const demo = new DemoSimulation();
  for (let i = 0; i < 4000 && route.name !== 'results'; i++) {
    tick(demo.frame(t + 1000 / 30, screen.demoMotion));
    if (i % 100 === 0) await paint();
  }
  expect(route.name === 'results' && saved.length === 1, 'три движения → результат и сохранение'); layout('Итоги');
  gesture(); await paint();
  expect(route.name === 'preview', 'повторная тренировка начинается с видеопоказа');
  expect(!document.querySelector('.hand-cursor'), 'курсора ладони нет на всём маршруте');
  report.textContent += `\nPASS · ${innerWidth}×${innerHeight}${location.search ? ' · insets 24/24' : ''}\n${trail.join(' → ')}`;
}
void run().catch(error => { report.textContent += `\nFAIL: ${error.message}\n${trail.join(' → ')}`; console.error(error); });
