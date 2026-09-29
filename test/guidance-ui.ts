/** Manual browser fixture: production screens, white camera background, no camera permission or saved results. */
import '../src/styles/base.css';
import '../src/styles/layout.css';
import '../src/styles/components.css';
import '../src/styles/screens.css';
import '../src/styles/guidance.css';
import { MenuScreen } from '../src/ui/screens/menu';
import { PreviewScreen } from '../src/ui/screens/preview';
import { WorkoutScreen } from '../src/ui/screens/workout';
import type { AppApi, Route, Screen, ScreenFrame } from '../src/core/screen';
import { VoiceCoach } from '../src/ui/coach';
import { SoundKit } from '../src/ui/sound';

const host = document.querySelector<HTMLDivElement>('#ui')!;
let screen: Screen;
const app = {
  coach: new VoiceCoach(), sound: new SoundKit(), hasVision: true, source: 'demo', mirrored: true,
  history: { totals: () => ({ sessions: 0, streakDays: 0 }), add: () => ({ records: [] }) },
  fx: { float: () => {}, burst: () => {} },
  go(route: Route) {
    screen?.unmount();
    screen = route.name === 'preview' ? new PreviewScreen(app, route.plan)
      : route.name === 'workout' ? new WorkoutScreen(app, route.plan) : new MenuScreen(app);
    host.innerHTML = '<div class="screenhost"></div>';
    screen.mount(host.firstElementChild as HTMLElement);
  },
} as unknown as AppApi;
app.coach.setEnabled(false); app.sound.setEnabled(false);
app.go({ name: 'menu' });
function frame(t: number) {
  screen.update({ body: null, t, dt: 1 / 60, brightness: 255, fps: 60, gesture: {} } as ScreenFrame);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
