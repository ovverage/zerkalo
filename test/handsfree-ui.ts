/** Integration: only synthetic body input after camera permission; real screens, gestures and engine. */
import '../src/styles/base.css'; import '../src/styles/layout.css'; import '../src/styles/components.css';
import '../src/styles/screens.css'; import '../src/styles/guidance.css'; import '../src/styles/handsfree.css'; import '../src/styles/mobile.css';
import { TutorialScreen } from '../src/ui/screens/tutorial';
import { MenuScreen } from '../src/ui/screens/menu';
import { PreviewScreen } from '../src/ui/screens/preview';
import { WorkoutScreen } from '../src/ui/screens/workout';
import { ResultsScreen } from '../src/ui/screens/results';
import { HistoryScreen } from '../src/ui/screens/history';
import { SettingsScreen } from '../src/ui/screens/settings';
import type { GestureName } from '../src/gestures/uiGestures';
import { GestureEngine } from '../src/gestures/uiGestures';
import { HandsFreeControls } from '../src/ui/handsFree';
import { BottomNavigation } from '../src/ui/navigation';
import { VoiceCoach } from '../src/ui/coach'; import { SoundKit } from '../src/ui/sound';
import type { AppApi, Route, Screen } from '../src/core/screen';
import { pose } from './synthetic'; import { LANDMARK_INDEX as I } from '../src/vision/landmarks';
import type { Body } from '../src/vision/landmarks';
import type { SessionResult } from '../src/engine/session';
import type { StoredSession } from '../src/storage/history';
import { DemoSimulation } from '../src/demo/simulation';

const ui = document.querySelector<HTMLElement>('#ui')!;
const report = document.querySelector<HTMLElement>('#report')!;
const controls = new HandsFreeControls(ui, () => {}), engine = new GestureEngine();
const navigation = new BottomNavigation(route => app.go(route));
let screen: Screen, route: Route, t = 1000;
const trail: string[] = [], saved: StoredSession[] = [];
// Simulate native SystemBars CSS insets; WebView device testing is separate.
if (new URLSearchParams(location.search).has('insets')) {
  document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
  document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
}
const app = {
  coach: new VoiceCoach(), sound: new SoundKit(), hasVision: true, source: 'camera', mirrored: true,
  gestures: engine, history: { totals: () => ({ sessions: 0, streakDays: 0 }), list: () => [...saved].reverse(), bests: () => [], add: (result: SessionResult) => { const session = { ...result, attempts: result.exercises.reduce((n, e) => n + e.attempts, 0), id: String(saved.length), at: saved.length } as unknown as StoredSession; saved.push(session); return { records: [], session }; } },
  fx: { float() {}, burst() {}, clear() {} },
  go(next: Route) {
    screen?.unmount(); route = next; engine.clearCooldown(); trail.push(next.name);
    screen = next.name === 'tutorial' ? new TutorialScreen(app) : next.name === 'preview' ? new PreviewScreen(app, next.plan)
      : next.name === 'workout' ? new WorkoutScreen(app, next.plan) : next.name === 'results' ? new ResultsScreen(app, next.result, next.records, next.savedId)
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
  const gesture = engine.update(body, t, screen.navigationGestures);
  if (gesture.fired) controls.dispatch(gesture.fired, screen, t);
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
function sideArm(side: 'left' | 'right'): Body {
  const b = pose({ armElevation: 90 }), rest = pose();
  for (const index of side === 'left' ? [14, 16] : [13, 15]) { b.world[index] = rest.world[index]!; b.screen[index] = rest.screen[index]!; }
  return b;
}
function gesture(name: GestureName = 'cross', frames = 30) {
  neutral(); feed(name === 'cross' ? crossed() : sideArm(name === 'previous' ? 'left' : 'right'), frames);
}
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function choose(selector: string, activate = true) {
  for (let i = 0; i < 90; i++) {
    const selected = ui.querySelector('.gesture-selected');
    if (selected?.matches(selector)) { if (activate) gesture(); await paint(); return; }
    gesture('next');
  }
  throw Error(`Gesture target inaccessible: ${selector}; selected=${controls.navigation.label}`);
}
function layout(label: string) {
  expect(document.documentElement.scrollWidth <= innerWidth, `${label}: нет горизонтального обрезания`);
  const nav = navigation.element.getBoundingClientRect(), host = ui.querySelector('.screenhost')!.getBoundingClientRect();
  if (!navigation.element.hidden) expect(host.bottom <= nav.top && nav.bottom <= innerHeight - (location.search ? 24 : 0), `${label}: навигация не закрывает контент и системную панель`);
}
async function run() {
  // The only external route transition represents camera permission granted.
  app.go({ name: 'tutorial' }); await paint(); tick(pose());
  expect(ui.querySelectorAll('.lesson').length === 3 && !ui.querySelector('[data-action="dwell"]'), 'три разных движения, задания с ладонью нет');
  gesture(); gesture('previous'); gesture('next');
  expect(ui.querySelectorAll('.lesson--done').length === 3, 'крест и обе навигационные команды пройдены');
  gesture('cross', 120); await paint();
  expect(route.name === 'menu', 'удержание подтверждения не проскакивает меню');
  expect(!ui.textContent?.includes('Камера подключена'), 'на главной нет статуса камеры');
  expect(ui.querySelector('.gesture-selected')?.matches('[data-action="workout-repair"]'), '75 секунд — главный сценарий');
  layout('Тренировки');
  gesture(); await paint(); tick(pose());
  expect(route.name === 'preview', 'выбор программы крестом');
  await choose('[data-gesture-label="Положение камеры"]', false);
  const guide = ui.querySelector('.gesture-selected')!.getBoundingClientRect();
  expect(guide.top >= 0 && guide.bottom <= innerHeight, 'длинный видеопоказ прокручивается выбором раздела');
  await choose('[data-gesture-scroll="down"]');
  await choose('[data-action="start"]'); feed(pose(), 160);
  expect(!screen.navigationGestures, 'выбор кнопок отключён во время упражнения');
  gesture('next'); feed(pose({ armElevation: 180 }), 90);
  expect(!screen.navigationGestures, 'рука в сторону и руки вверх не прерывают выполнение');
  gesture(); await paint();
  expect(screen.navigationGestures && ui.textContent?.includes('Пауза'), 'крест ставит паузу');
  await choose('[data-action="help"]');
  expect(!!ui.querySelector('dialog[open]'), 'помощь открыта жестами');
  if (new URLSearchParams(location.search).has('help')) { report.hidden = true; return; }
  await choose('[data-gesture-label="Как двигаться"]', false);
  await choose('[data-action="close-help"]');
  expect(!ui.querySelector('dialog[open]') && screen.navigationGestures, 'закрытие помощи возвращает на паузу');
  gesture(); feed(pose(), 160);
  expect(!screen.navigationGestures, 'крест продолжает после помощи');
  screen.onVisibilityChange(true, t + 50); t += 60000; screen.onVisibilityChange(false, t); tick(pose());
  expect(screen.navigationGestures, 'после сворачивания остаётся пауза');
  gesture(); feed(pose(), 160);
  const demo = new DemoSimulation();
  for (let i = 0; i < 4500 && route.name !== 'results'; i++) tick(demo.frame(t + 1000 / 30, screen.demoMotion));
  await paint();
  expect(route.name === 'results' && saved.length === 1, '75 секунд → результаты с сохранением');
  expect(ui.textContent?.includes('Получилось исправить'), 'результат называет измеренное исправление');
  layout('Итоги');
  gesture(); await paint();
  await choose('[data-action="start"]'); feed(pose(), 160);
  for (let i = 0; i < 4500 && route.name !== 'results'; i++) tick(demo.frame(t + 1000 / 30, screen.demoMotion));
  await paint();
  expect(!!ui.querySelector('.attempt-comparison'), 'две полные попытки показывают сравнение');
  await choose('[data-gesture-label="Сравнение попыток"]', false);
  const reading = ui.querySelector<HTMLElement>('.results')!;
  if (ui.querySelector('.attempt-comparison')!.getBoundingClientRect().height > reading.clientHeight) {
    const before = reading.scrollTop; gesture('next');
    expect(reading.scrollTop > before && ui.querySelector('.gesture-selected')?.matches('.attempt-comparison'), 'длинный раздел читается по частям, выбор не перескакивает');
  }
  if (new URLSearchParams(location.search).has('comparison')) { report.hidden = true; return; }
  await choose('[data-action="menu"]');
  expect(route.name === 'menu', 'возврат с результата без касаний');
  await choose('[data-action="workout-motion"]');
  await choose('[data-action="start"]'); feed(pose(), 160);
  for (let i = 0; i < 4500 && route.name !== 'results'; i++) tick(demo.frame(t + 1000 / 30, screen.demoMotion));
  await paint();
  expect(route.name === 'results' && saved.length === 3, 'все три движения MOTION → результат');
  gesture(); await paint();
  expect(route.name === 'preview', 'повтор начинается с видеопоказа');
  await choose('[data-action="back"]');
  await choose('[data-tab="exercises"]'); layout('Упражнения');
  expect(ui.querySelectorAll('.chip').length === 11, 'все 11 упражнений доступны');
  await choose('[data-action="ex-push-up"]'); await choose('[data-action="start"]');
  feed(null, 20); await paint();
  const setup = ui.querySelector<HTMLElement>('.setup--compact')!;
  expect(setup.getBoundingClientRect().height <= Math.min(128, innerHeight / 4), 'подготовка занимает не больше четверти экрана');
  if (new URLSearchParams(location.search).has('setup')) { report.hidden = true; return; }
  gesture(); await paint();
  await choose('[data-action="quit"]'); gesture(); await paint();
  expect(route.name === 'results', 'завершение подтверждается отдельным крестом после отпускания');
  await choose('[data-action="menu"]');
  await choose('[data-tab="settings"]'); layout('Настройки');
  await choose('[data-tab="history"]'); layout('Прогресс');
  await choose('[data-tab="programs"]');
  expect(!document.querySelector('.hand-cursor'), 'курсора ладони нет на всём маршруте');
  report.textContent += `\nPASS · ${innerWidth}×${innerHeight}${location.search ? ' · insets 24/24' : ''} · NO TOUCH\n${trail.join(' → ')}`;
}
void run().catch(error => { report.textContent += `\nFAIL: ${error.message}\n${trail.join(' → ')}`; console.error(error); });
