/** Реальные экраны, DOM, жесты, scroll, сессия. Только координаты и звук — фикстуры. */
import '../src/styles/base.css'; import '../src/styles/layout.css'; import '../src/styles/components.css';
import '../src/styles/screens.css'; import '../src/styles/guidance.css'; import '../src/styles/handsfree.css';
import { TutorialScreen } from '../src/ui/screens/tutorial';
import { MenuScreen } from '../src/ui/screens/menu';
import { PreviewScreen } from '../src/ui/screens/preview';
import { WorkoutScreen } from '../src/ui/screens/workout';
import { ResultsScreen } from '../src/ui/screens/results';
import { HistoryScreen } from '../src/ui/screens/history';
import { GestureEngine } from '../src/gestures/uiGestures';
import { HandsFreeControls, collectDwellTargets } from '../src/ui/handsFree';
import { VoiceCoach } from '../src/ui/coach'; import { SoundKit } from '../src/ui/sound';
import type { AppApi, Route, Screen } from '../src/core/screen';
import { pose } from './synthetic'; import { LANDMARK_INDEX as I } from '../src/vision/landmarks';
import type { Body } from '../src/vision/landmarks';
import { DemoSimulation } from '../src/demo/simulation';

const ui = document.querySelector<HTMLElement>('#ui')!, stage = document.querySelector<HTMLElement>('#stage')!;
const report = document.querySelector<HTMLElement>('#report')!;
const controls = new HandsFreeControls(ui, () => {}), engine = new GestureEngine();
let screen: Screen, route: Route, t = 1000;
const trail: string[] = [], saved: unknown[] = [];
const app = {
  coach: new VoiceCoach(), sound: new SoundKit(), hasVision: true, source: 'camera', mirrored: true,
  gestures: engine, history: { totals: () => ({ sessions: 0, streakDays: 0 }), list: () => [], bests: () => [], add: (result: unknown) => { saved.push(result); return { records: [] }; } },
  fx: { float() {}, burst() {}, clear() {} },
  go(next: Route) {
    screen?.unmount(); route = next; engine.clearCooldown(); trail.push(next.name);
    screen = next.name === 'tutorial' ? new TutorialScreen(app) : next.name === 'preview' ? new PreviewScreen(app, next.plan)
      : next.name === 'workout' ? new WorkoutScreen(app, next.plan) : next.name === 'results' ? new ResultsScreen(app, next.result, next.records)
      : next.name === 'history' ? new HistoryScreen(app) : new MenuScreen(app);
    ui.innerHTML = '<div class="screenhost"></div>'; screen.mount(ui.firstElementChild as HTMLElement);
  },
} as unknown as AppApi;
app.coach.setEnabled(false); app.sound.setEnabled(false);
const log = (msg: string) => { report.textContent += `\n✓ ${msg}`; };
const expect = (condition: unknown, msg: string) => { if (!condition) throw Error(msg); log(msg); };
function tick(body: Body | null) {
  t += 1000 / 30;
  const gesture = engine.update(body, t, { container: stage.getBoundingClientRect(), targets: collectDwellTargets(ui), mirrored: true, dwellEnabled: screen.dwellEnabled });
  if (gesture.activatedTargetId) ui.querySelector<HTMLElement>(`[data-dwell="${gesture.activatedTargetId}"]`)?.click();
  if (gesture.fired) screen.onGesture(gesture.fired);
  screen.update({ body, t, dt: 1 / 30, brightness: .5, fps: 60, gesture });
  controls.update(gesture, screen, true, t);
}
const feed = (body: Body | null, n: number) => { for (let i = 0; i < n; i++) tick(body); };
const neutral = () => feed(pose(), 48);
function crossed(): Body {
  const b = pose();
  b.world[I.left_wrist] = { x: -.16, y: -.34, z: -.06 }; b.world[I.right_wrist] = { x: .16, y: -.34, z: -.06 };
  for (const i of [I.left_wrist, I.right_wrist]) { const p = b.world[i]!; b.screen[i] = { ...p, x: .5 + p.x * .45, y: .5 + p.y * .45 }; }
  return b;
}
function gesture(kind: 'confirm' | 'cancel', frames = 30) { neutral(); feed(kind === 'confirm' ? pose({ armElevation: 180 }) : crossed(), frames); }
function pointTo(button: HTMLElement): Body {
  const r = button.getBoundingClientRect(), area = stage.getBoundingClientRect();
  const b = pose(), torso = .225, cx = .5, cy = .275;
  const x = cx - ((r.left + r.width / 2 - area.left) / area.width - .5) * 2.4 * torso;
  const y = cy + ((r.top + r.height / 2 - area.top) / area.height - .48) * 1.9 * torso;
  b.screen[I.left_wrist] = { x, y, z: 0 };
  b.world[I.left_wrist] = { x: (x - .5) / .45, y: (y - .5) / .45, z: 0 };
  return b;
}
function dwell(id: string) {
  neutral();
  const button = ui.querySelector<HTMLElement>(`[data-dwell="${id}"]`);
  if (!button) throw Error(`Нет кнопки ${id}`);
  if (!collectDwellTargets(ui).some(target => target.id === id)) throw Error(`Кнопка ${id} недоступна в видимой области`);
  feed(pointTo(button), 40);
}
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function run() {
  app.go({ name: 'tutorial' }); await paint(); tick(pose());
  gesture('confirm'); gesture('cancel');
  // На узком экране цель обучения может быть ниже первого экрана.
  for (let i = 0; i < 8 && !collectDwellTargets(ui).some(v => v.id === 'tutorial-dwell'); i++) { dwell('nav-down'); await paint(); }
  dwell('tutorial-dwell');
  expect(ui.querySelectorAll('.lesson--done').length === 3, 'три урока засчитаны по выдержанным жестам');
  gesture('confirm', 120); await paint();
  expect(route.name === 'menu', 'удержание подтверждения не проскакивает меню');
  neutral();
  const scroll = ui.querySelector<HTMLElement>('.screen--scroll')!;
  dwell('nav-down'); await paint();
  expect(scroll.scrollTop > 0, 'прокрутка вниз кистью');
  dwell('nav-up'); await paint();
  expect(scroll.scrollTop < 8, 'возврат вверх кистью');
  // Осознанный выбор первой программы, затем отдельное подтверждение старта.
  dwell('workout-motion'); await paint();
  expect(route.name === 'preview', 'выбор программы кистью открывает видеопоказ');
  gesture('confirm'); await paint();
  expect(route.name === 'workout', 'подтверждение открывает тренировку');
  neutral(); feed(pose(), 160);
  expect(!screen.dwellEnabled, 'выбор кнопок отключён во время движения');
  gesture('cancel'); await paint();
  expect(screen.dwellEnabled && ui.textContent?.includes('Пауза'), 'пауза руками крестом');
  dwell('paused-help'); await paint();
  expect(!!ui.querySelector('dialog[open]'), 'помощь открывается кистью');
  feed(crossed(), 60); // Рука ещё не опущена после выбора — ничего не закрывает.
  expect(!!ui.querySelector('dialog[open]'), 'помощь не закрывается без отпускания предыдущего жеста');
  gesture('cancel'); await paint();
  expect(!ui.querySelector('dialog[open]'), 'помощь закрывается жестом, пауза сохраняется');
  gesture('confirm'); feed(pose(), 160);
  expect(!screen.dwellEnabled, 'возобновление повторно проверяет кадр');
  screen.onVisibilityChange(true, t + 50);
  t += 60000;
  screen.onVisibilityChange(false, t);
  tick(pose());
  expect(screen.dwellEnabled && ui.textContent?.includes('Пауза'), 'сворачивание ставит паузу; возврат через минуту не запускает движение');
  gesture('confirm'); feed(pose(), 160);
  expect(!screen.dwellEnabled, 'после возврата можно продолжить жестом с новой проверкой кадра');
  const demo = new DemoSimulation();
  for (let i = 0; i < 4000 && route.name !== 'results'; i++) {
    tick(demo.frame(t + 1000 / 30, screen.demoMotion));
    if (i % 100 === 0) await paint();
  }
  expect(route.name === 'results' && saved.length === 1, 'три движения → результат и сохранение');
  gesture('confirm'); await paint();
  expect(route.name === 'preview', 'новая тренировка начинается с видеопоказа');
  gesture('cancel'); await paint();
  // Доступность последнего упражнения длинного меню без мыши.
  for (let i = 0; i < 24 && !collectDwellTargets(ui).some(v => v.id === 'ex-push-up'); i++) { dwell('nav-down'); await paint(); }
  dwell('ex-push-up'); await paint(); expect(route.name === 'preview', 'выбрано упражнение в конце списка'); gesture('confirm'); await paint(); expect(route.name === 'workout', 'боковое упражнение запущено');
  feed(pose({ prone: true, armElevation: 90, elbowBend: 172 }), 160);
  gesture('cancel'); await paint();
  expect(screen.dwellEnabled, 'из бокового упражнения можно безопасно встать и поставить паузу жестом');
  dwell('paused-help'); await paint(); gesture('cancel'); await paint();
  expect(!ui.querySelector('dialog[open]'), 'возврат из помощи для бокового ракурса');
  expect(document.documentElement.scrollWidth <= innerWidth, 'горизонтального переполнения нет');
  report.textContent += `\nPASS · ${innerWidth}×${innerHeight}\n${trail.join(' → ')}`;
}
void run().catch(error => { report.textContent += `\nFAIL: ${error.message}\n${trail.join(' → ')}`; console.error(error); });
