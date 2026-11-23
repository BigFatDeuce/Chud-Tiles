import { createRoot } from 'react-dom/client';
import '@fontsource-variable/oxanium';
import '@fontsource-variable/space-grotesk';
import './styles/app.css';
import { App } from './App';
import { engine, type Quality } from './gfx/engine';
import { useSettings } from './store/settings';
import { useNav } from './store/nav';
import { currentSession } from './game/session';
import { openDropped } from './game/actions';
import { calibration } from './pages/Calibration';
import { currentHost } from './yt/host';
import { lang, missingKeys } from './i18n';
import { platform } from './platform';

// Start-up: the universe first (it is visible behind the interface from the first image), then
// the interface. "Auto" quality starts high on a capable GPU, medium otherwise.

function autoQuality(): Quality {
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return 'low';
  return cores >= 8 ? 'high' : 'medium';
}

const s = useSettings.getState();
const safe = platform.safeMode.on;
if (safe) document.body.classList.add('lowfx', 'safe');
const canvas = document.getElementById('cosmos') as HTMLCanvasElement;
try {
  engine.mount(canvas, safe ? 'low' : s.quality === 'auto' ? autoQuality() : s.quality);
  // a few seconds of images without trouble: this start counts as a good one
  setTimeout(() => platform.healthy?.(), 8000);
} catch (e) {
  console.error('WebGL indisponible', e);
  document.body.classList.add('lowfx');
  // no WebGL from the graphics card: the processor can draw it (safe mode)
  if (!safe && platform.restart && platform.kind === 'electron') platform.restart('safe', 'crash');
}
createRoot(document.getElementById('root')!).render(<App />);

// test hooks (end-to-end tests drive the game through these)
(window as unknown as { __ct: unknown }).__ct = {
  engine,
  session: () => currentSession,
  settings: useSettings,
  nav: useNav,
  calibration,
  /** Language of the interface, and the texts shown without a translation. */
  i18n: { lang, missing: missingKeys },
  /** The YouTube player host, once created. */
  yt: () => currentHost(),
  /** Opens an audio file by URL as if it had been dropped on the window. */
  openUrl: async (url: string, name: string) => {
    const r = await fetch(url);
    const b = await r.blob();
    await openDropped([new File([b], name, { type: b.type || 'audio/wav', lastModified: 1 })]);
  },
  /**
   * Draws images at about 60 per second for `seconds`, without requestAnimationFrame: a page in a
   * hidden tab gets almost no animation frames, but message events still run.
   */
  pump: (seconds: number) =>
    new Promise<number>((resolve) => {
      const ch = new MessageChannel();
      const end = performance.now() + seconds * 1000;
      let last = 0;
      let n = 0;
      ch.port1.onmessage = () => {
        const now = performance.now();
        if (now >= end) {
          ch.port1.close();
          resolve(n);
          return;
        }
        if (now - last >= 16) {
          last = now;
          engine.step();
          n++;
        }
        ch.port2.postMessage(0);
      };
      ch.port2.postMessage(0);
    }),
};
