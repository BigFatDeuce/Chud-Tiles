import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Trophy, Compass, Library, ListMusic, Maximize2, Minus, Radio, Settings, ShieldAlert, Square, X } from 'lucide-react';
import { platform } from '../platform';
import { useNav, go, type Page } from '../store/nav';
import { useProfile } from '../store/profile';
import { useSettings } from '../store/settings';
import { levelOf } from '@core/game/progress';
import { engine } from '../gfx/engine';
import { playSfx } from '../audio/sfx';
import { Logo } from './ui';
import { tr } from '../i18n';

const ITEMS: { id: Page['id']; label: string; icon: ReactNode; when?: () => boolean }[] = [
  { id: 'home', label: tr('Pont'), icon: <Compass size={21} /> },
  { id: 'library', label: tr('Archives'), icon: <Library size={21} /> },
  { id: 'search', label: tr('YouTube'), icon: <Radio size={21} /> },
  { id: 'playlists', label: tr('Listes'), icon: <ListMusic size={21} /> },
  { id: 'stats', label: tr('Carnet'), icon: <BarChart3 size={21} /> },
  { id: 'leaderboard', label: tr('Classement'), icon: <Trophy size={21} /> },
];

export function Titlebar() {
  const win = platform.window;
  const profile = useProfile((s) => s.profile);
  const lv = levelOf(profile.xp);
  return (
    <div className="titlebar">
      <span className="brand-mini">{tr('CHUD TILES')}</span>
      <span className="grow" />
      {platform.safeMode.on && (
        <button className="chip gold" onClick={() => go({ id: 'settings', tab: 'display' })} title={tr('Rendu logiciel, effets réduits')}>
          <ShieldAlert size={13} /> {tr('Mode sans échec')}
        </button>
      )}
      <span className="chip" title={tr('Niveau d\'équipage')}>
        {tr('Niv.')} <b className="num">{lv.level}</b>
      </span>
      {win ? (
        <div className="win">
          <button aria-label={tr('Plein écran')} onClick={() => win.isFullscreen().then((f) => win.setFullscreen(!f))}>
            <Maximize2 size={14} />
          </button>
          <button aria-label={tr('Réduire')} onClick={() => win.minimize()}>
            <Minus size={16} />
          </button>
          <button aria-label={tr('Agrandir')} onClick={() => win.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button aria-label={tr('Fermer')} className="close" onClick={() => win.close()}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <span style={{ width: 12 }} />
      )}
    </div>
  );
}

export function Nav() {
  const page = useNav((s) => s.page);
  const online = useSettings((s) => s.online);
  const active = page.id === 'song' || page.id === 'results' ? 'library' : page.id === 'calibration' ? 'settings' : page.id;
  return (
    <nav className="nav" aria-label={tr('Navigation')}>
      <div className="logo">
        <Logo size={42} />
      </div>
      {ITEMS.filter((it) => online || it.id !== 'leaderboard').map((it) => (
        <button
          key={it.id}
          className={`nav-item ${active === it.id ? 'active' : ''}`}
          onMouseEnter={() => playSfx('hover', 0.5)}
          onClick={() => {
            if (page.id !== it.id) {
              playSfx('click', 0.7);
              go({ id: it.id } as Page);
            }
          }}
        >
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
      <div className="spacer" />
      <button
        className={`nav-item ${active === 'settings' ? 'active' : ''}`}
        onMouseEnter={() => playSfx('hover', 0.5)}
        onClick={() => {
          if (page.id !== 'settings') {
            playSfx('click', 0.7);
            go({ id: 'settings' });
          }
        }}
      >
        <Settings size={21} />
        <span>{tr('Réglages')}</span>
      </button>
    </nav>
  );
}

/** True while the camera flies between places (pages fade a little during the jump). */
export function useWarping(): boolean {
  const [w, setW] = useState(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = engine.cosmos.warp > 0.35;
      setW((prev) => (prev !== now ? now : prev));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return w;
}
