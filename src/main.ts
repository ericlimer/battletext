import { Display } from './engine/display';
import { Input } from './engine/input';
import { UI } from './engine/ui';
import { App, setApp } from './screens/app';
import { TitleScreen } from './screens/title';
import { quickSkirmish } from './screens/skirmish';
import { ArtSheetScreen } from './screens/portrait';
import { initTelemetry, track, currentScreen } from './game/telemetry';

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "JetBrains Mono"'), document.fonts.load('bold 16px "JetBrains Mono"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* offline: fall back to system monospace */ }
  document.getElementById('boot')?.remove();
  const d = new Display(canvas);
  const inp = new Input(d);
  const ui = new UI(d, inp);
  const app = new App(d, ui, inp);
  setApp(app);
  (window as any).__app = app;
  void initTelemetry();
  window.addEventListener('resize', () => d.resize());
  const params = new URLSearchParams(location.search);
  if (params.has('artsheet')) { const sh = new ArtSheetScreen(); sh.page = +(params.get('page') ?? 0); app.push(sh); }
  else if (params.has('skirmish')) quickSkirmish(params.get('skirmish') || 'battle', +(params.get('seed') ?? 1));
  else app.push(new TitleScreen());
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    try {
      app.frame(dt);
      d.flush();
    } catch (e) {
      console.error(e);
      (window as any).__lastError = String((e as Error).stack ?? e);
      track('error', { msg: String((e as Error).stack ?? e).slice(0, 500), screen: currentScreen() });
    }
    inp.endFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
