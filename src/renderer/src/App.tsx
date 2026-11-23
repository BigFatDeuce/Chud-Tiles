import { tr } from './i18n';
import { platform } from './platform';
import { toast } from './store/toasts';
import { useEffect, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useNav } from './store/nav';
import { useSettings } from './store/settings';
import { useLibrary } from './store/library';
import { useProfile } from './store/profile';
import { usePlaylists } from './store/playlists';
import { Nav, Titlebar, useWarping } from './components/Shell';
import { Toasts } from './components/ui';
import { Home } from './pages/Home';
import { Song } from './pages/Song';
import { Game } from './pages/Game';
import { Results } from './pages/Results';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Search } from './pages/Search';
import { Playlists } from './pages/Playlists';
import { Calibration } from './pages/Calibration';
import { Editor } from './pages/Editor';
import { openDropped } from './game/actions';
import { engine } from './gfx/engine';
import { setVolumes } from './audio/context';

function useApplySettings(): void {
  const s = useSettings();
  useEffect(() => {
    // safe mode (software rendering): low quality, minimal effects, 60 images per second at most
    const safe = platform.safeMode.on;
    engine.fpsCap = safe ? (s.fpsCap === 0 ? 60 : Math.min(60, s.fpsCap)) : s.fpsCap;
    engine.idleFps = s.menuFps30 || safe ? 30 : 0;
    engine.cosmos.effects = safe ? 0 : s.effects;
    engine.cosmos.reducedMotion = s.reducedMotion;
    engine.playfield.setTilt(s.tilt);
    document.body.classList.toggle('lowfx', safe || s.effects < 1 || s.quality === 'low');
    if (!safe && s.quality !== 'auto') engine.setQuality(s.quality);
  }, [s.fpsCap, s.menuFps30, s.effects, s.reducedMotion, s.tilt, s.quality]);
  useEffect(() => {
    setVolumes(s.volume);
  }, [s.volume]);
}

function useDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const over_ = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length && useNav.getState().page.id !== 'game') void openDropped(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over_);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over_);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

export function App() {
  const page = useNav((s) => s.page);
  const n = useNav((s) => s.n);
  const warping = useWarping();
  const dropping = useDrop();
  useApplySettings();
  useEffect(() => {
    void useLibrary.getState().load();
    void useProfile.getState().load();
    void usePlaylists.getState().load();
    if (platform.safeMode.on)
      toast(
        {
          kind: 'info',
          title: tr('Mode sans échec'),
          text:
            platform.safeMode.reason === 'crash'
              ? tr('L’affichage s’est arrêté au dernier lancement : Chud Tiles dessine sans la carte graphique, effets réduits. Réglages › Affichage pour revenir au mode normal.')
              : tr('Chud Tiles dessine sans la carte graphique, effets réduits. Réglages › Affichage pour revenir au mode normal.'),
        },
        10000,
      );
    const offGpu = platform.onGpuTrouble?.(() =>
      toast({ kind: 'error', title: tr('Pilote graphique instable'), text: tr('La carte graphique a planté plusieurs fois : le prochain démarrage se fera en mode sans échec.') }, 10000),
    );
    // a little parallax with the pointer in menus
    const move = (e: PointerEvent) => engine.cosmos.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      offGpu?.();
    };
  }, []);

  let content: ReactNode;
  switch (page.id) {
    case 'home':
      content = <Home />;
      break;
    case 'song':
      content = <Song key={page.track.key} track={page.track} file={page.file} />;
      break;
    case 'results':
      content = <Results result={page.result} />;
      break;
    case 'library':
      content = <Library />;
      break;
    case 'settings':
      content = <Settings tab={page.tab} />;
      break;
    case 'stats':
      content = <Stats />;
      break;
    case 'search':
      content = <Search query={page.query} />;
      break;
    case 'playlists':
      content = <Playlists />;
      break;
    case 'calibration':
      content = <Calibration />;
      break;
    case 'editor':
      content = <Editor p={page.editor} />;
      break;
    default:
      content = null;
  }

  if (page.id === 'game') {
    return (
      <>
        <Game key={n} game={page.game} />
        <Toasts />
      </>
    );
  }
  return (
    <div className={`shell ${warping ? 'warping' : ''}`}>
      <Titlebar />
      <Nav />
      <main className="page">
        <div className="page-inner" key={n}>
          {content}
        </div>
      </main>
      {dropping && (
        <div className="dropzone">
          <div className="panel">
            <Upload size={36} color="var(--cyan)" />
            <h2 className="display" style={{ letterSpacing: '0.2em', margin: '14px 0 6px' }}>
              {tr('DÉPOSER POUR JOUER')}
            </h2>
            <div className="muted">{tr('MP3, FLAC, WAV, OGG, OPUS, AAC, M4A, AIFF, WMA…')}</div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
