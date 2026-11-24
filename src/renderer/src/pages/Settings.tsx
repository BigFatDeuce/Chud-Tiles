import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Gamepad2, Gauge, Info, Keyboard, MonitorCog, Music2, Radio, RefreshCw, RotateCcw, Database, Download, ShieldCheck, Upload, Trash2, Sliders } from 'lucide-react';
import type { AdblockStatus, UpdateInfo, YtdlpStatus } from '@shared/types';
import { RELEASES_URL } from '@shared/project';
import { platform } from '../platform';
import { DEFAULTS, DEFAULT_KEYS, DEFAULT_PAD, keyName, padName, useSettings, type Settings as S } from '../store/settings';
import { useProfile } from '../store/profile';
import { useLibrary } from '../store/library';
import { laneColors } from '../gfx/playfield';
import { outputLatency } from '../audio/context';
import { engine, type Quality } from '../gfx/engine';
import * as db from '../storage/db';
import { go } from '../store/nav';
import { toast, toastError } from '../store/toasts';
import { Logo, Range, Seg, Toggle } from '../components/ui';
import { playSfx } from '../audio/sfx';
import { fmtNum, lang, LANGS, locale, resolve, systemLang, tr, trn } from '../i18n';

// The station's settings: game, controls (keyboard and gamepad, per number of lanes), audio and
// synchronisation, display, YouTube, data. Every change applies at once and is kept.

const TABS = [
  { id: 'game', label: tr('Jeu'), icon: <Sliders size={17} /> },
  { id: 'controls', label: tr('Commandes'), icon: <Keyboard size={17} /> },
  { id: 'audio', label: tr('Audio et synchro'), icon: <Music2 size={17} /> },
  { id: 'display', label: tr('Affichage'), icon: <MonitorCog size={17} /> },
  { id: 'youtube', label: tr('YouTube'), icon: <Radio size={17} /> },
  { id: 'data', label: tr('Données'), icon: <Database size={17} /> },
  { id: 'about', label: tr('À propos'), icon: <Info size={17} /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Row({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="opt-row">
      <div className="what">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

export function Settings({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<TabId>((TABS.find((t) => t.id === initial)?.id ?? 'game') as TabId);
  return (
    <div className="page-enter">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--cyan)' }}>
            {tr('Salle des machines')}
          </div>
          <h1 style={{ marginTop: 8 }}>{tr('Réglages')}</h1>
        </div>
      </div>
      <div className="settings">
        <div className="panel tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => {
                playSfx('click', 0.5);
                setTab(t.id);
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="panel pad settings-body" key={tab}>
          {tab === 'game' && <GameTab />}
          {tab === 'controls' && <ControlsTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'youtube' && <YoutubeTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function GameTab() {
  const s = useSettings();
  return (
    <>
      <h2 className="tab-title">{tr('Jeu')}</h2>
      <Row title={lang === 'fr' ? 'Langue · Language' : 'Language · Langue'} hint={s.lang === 'auto' ? tr('Langue du système : {l}', { l: systemLang() === 'fr' ? 'Français' : 'English' }) : undefined}>
        <Seg
          value={s.lang}
          options={LANGS}
          onChange={(v) => {
            if (v === s.lang) return;
            s.set({ lang: v });
            // the interface is reloaded in the new language (the setting is already saved)
            if (resolve(v) !== lang) setTimeout(() => location.reload(), 60);
          }}
        />
      </Row>
      <Row title={tr('Colonnes par défaut')} hint={tr('Nombre de pistes proposé à l’ouverture d’un morceau')}>
        <Seg value={s.lanes} onChange={(v) => s.set({ lanes: v })} options={[3, 4, 5, 6, 7].map((n) => ({ v: n, label: String(n) }))} />
      </Row>
      <Row title={tr('Vitesse de défilement')} hint={tr('Temps pendant lequel une note est visible avant la ligne (plus court = plus rapide)')}>
        <Range value={s.approach} min={0.5} max={2.5} step={0.05} onChange={(v) => s.set({ approach: v })} label={tr('Vitesse de défilement')} />
        <span className="val">{fmtNum(s.approach, 2)} s</span>
      </Row>
      <Row title={tr('Inclinaison de la piste')} hint={tr('0° : piste à plat, face à vous')}>
        <Range value={s.tilt} min={0} max={45} step={1} onChange={(v) => s.set({ tilt: v })} label={tr('Inclinaison')} />
        <span className="val">{s.tilt}°</span>
      </Row>
      <Row title={tr('Échec possible')} hint={tr('La partie s’arrête quand l’énergie tombe à zéro')}>
        <Toggle on={s.fail} onChange={(v) => s.set({ fail: v })} label={tr('Échec possible')} />
      </Row>
      <Row title={tr('Indication tôt / tard')} hint={tr('Affiche TÔT ou TARD sous le jugement quand une note n’est pas parfaite')}>
        <Toggle on={s.showOffsets} onChange={(v) => s.set({ showOffsets: v })} label={tr('Indication tôt / tard')} />
      </Row>
      <Row title={tr('Sons de frappe')} hint={tr('Un petit son à chaque note réussie')}>
        <Toggle on={s.hitSounds} onChange={(v) => s.set({ hitSounds: v })} label={tr('Sons de frappe')} />
      </Row>
      <Row title={tr('Pause automatique')} hint={tr('Met en pause quand la fenêtre perd le focus')}>
        <Toggle on={s.autoPause} onChange={(v) => s.set({ autoPause: v })} label={tr('Pause automatique')} />
      </Row>
      <Row title={tr('Classement en ligne')} hint={tr('Affiche les classements de chud-tiles.holy-c.men et permet d’y publier vos scores (un pseudo et le score, rien d’autre)')}>
        <Toggle on={s.online} onChange={(v) => s.set({ online: v })} label={tr('Classement en ligne')} />
      </Row>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn small ghost" onClick={() => s.reset(['lanes', 'approach', 'tilt', 'fail', 'showOffsets', 'hitSounds', 'autoPause'])}>
          <RotateCcw size={14} /> {tr('Valeurs par défaut')}
        </button>
      </div>
    </>
  );
}

type Waiting = { kind: 'key' | 'pad'; lane: number; slot: number } | null;

function ControlsTab() {
  const s = useSettings();
  const [lanes, setLanes] = useState(s.lanes);
  const [wait, setWait] = useState<Waiting>(null);
  const [pads, setPads] = useState<string[]>([]);
  const colors = laneColors(lanes);
  const keys = s.keys[lanes] ?? DEFAULT_KEYS[lanes];
  const pad = s.pad[lanes] ?? DEFAULT_PAD[lanes];

  // connected gamepads
  useEffect(() => {
    const list = () => setPads((navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g).map((g) => g.id.replace(/\s*\(.*\)\s*$/, '')));
    list();
    window.addEventListener('gamepadconnected', list);
    window.addEventListener('gamepaddisconnected', list);
    const t = setInterval(list, 1500);
    return () => {
      window.removeEventListener('gamepadconnected', list);
      window.removeEventListener('gamepaddisconnected', list);
      clearInterval(t);
    };
  }, []);

  // capture of the next key or button
  useEffect(() => {
    if (!wait) return;
    const assignKey = (code: string | null) => {
      const next = (s.keys[lanes] ?? DEFAULT_KEYS[lanes]).map((l) => l.slice());
      if (code) for (const l of next) for (let k = l.length - 1; k >= 0; k--) if (l[k] === code) l.splice(k, 1);
      const lane = next[wait.lane];
      if (code) lane[wait.slot] = code;
      else lane.splice(wait.slot, 1);
      next[wait.lane] = lane.filter(Boolean);
      useSettings.getState().set({ keys: { ...useSettings.getState().keys, [lanes]: next } });
    };
    const assignPad = (b: number | null) => {
      const next = (s.pad[lanes] ?? DEFAULT_PAD[lanes]).map((l) => l.slice());
      if (b !== null) for (const l of next) for (let k = l.length - 1; k >= 0; k--) if (l[k] === b) l.splice(k, 1);
      const lane = next[wait.lane];
      if (b !== null) lane[wait.slot] = b;
      else lane.splice(wait.slot, 1);
      next[wait.lane] = lane.filter((x) => x !== undefined);
      useSettings.getState().set({ pad: { ...useSettings.getState().pad, [lanes]: next } });
    };
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setWait(null);
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        if (wait.kind === 'key') assignKey(null);
        else assignPad(null);
        setWait(null);
        return;
      }
      if (wait.kind === 'key') {
        assignKey(e.code);
        playSfx('click', 0.6);
        setWait(null);
      }
    };
    window.addEventListener('keydown', key, { capture: true });
    // gamepad: the first button that goes down after the capture started
    let timer = 0;
    if (wait.kind === 'pad') {
      const down = new Set<string>();
      const snap = () => {
        const out = new Set<string>();
        for (const g of navigator.getGamepads?.() ?? []) if (g) g.buttons.forEach((b, i) => b.pressed && out.add(`${g.index}:${i}`));
        return out;
      };
      for (const k of snap()) down.add(k);
      timer = window.setInterval(() => {
        const now = snap();
        for (const k of now) {
          if (down.has(k)) continue;
          const b = Number(k.split(':')[1]);
          if (b === 9) {
            toast({ kind: 'error', title: tr('Bouton réservé'), text: tr('Start met le jeu en pause.') });
            down.add(k);
            continue;
          }
          assignPad(b);
          playSfx('click', 0.6);
          setWait(null);
          return;
        }
        for (const k of [...down]) if (!now.has(k)) down.delete(k);
      }, 16);
    }
    return () => {
      window.removeEventListener('keydown', key, { capture: true });
      clearInterval(timer);
    };
  }, [wait, lanes, s.keys, s.pad]);

  const cap = (kind: 'key' | 'pad', lane: number, slot: number, label: string | null) => {
    const on = wait && wait.kind === kind && wait.lane === lane && wait.slot === slot;
    return (
      <button key={`${kind}${slot}`} className={`keycap ${on ? 'wait' : ''} ${label ? '' : 'empty'}`} onClick={() => setWait(on ? null : { kind, lane, slot })} title={label ? tr('Cliquer puis appuyer sur la nouvelle touche (Suppr pour effacer)') : tr('Ajouter une touche')}>
        {on ? '…' : (label ?? '+')}
      </button>
    );
  };

  return (
    <>
      <h2 className="tab-title">{tr('Commandes')}</h2>
      <Row title={tr('Nombre de colonnes')} hint={tr('Chaque nombre de colonnes a ses propres touches')}>
        <Seg value={lanes} onChange={(v) => (setLanes(v), setWait(null))} options={[3, 4, 5, 6, 7].map((n) => ({ v: n, label: String(n) }))} />
      </Row>
      <Row title={tr('Touches sous les pistes')} hint={tr('Écrit la touche ou le bouton de chaque piste sous la ligne de frappe, en jeu')}>
        <Seg
          value={s.showKeys}
          onChange={(v) => s.set({ showKeys: v })}
          options={[
            { v: 'off', label: tr('Non') },
            { v: 'auto', label: tr('Auto') },
            { v: 'keyboard', label: tr('Clavier') },
            { v: 'pad', label: tr('Manette') },
          ]}
        />
      </Row>
      <div className="label" style={{ margin: '18px 0 10px' }}>
        <Keyboard size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
        {tr('Clavier')}
      </div>
      <div className="lanes-keys">
        {keys.map((ks, lane) => (
          <div key={lane} className="lane-col">
            <span className="dot" style={{ background: `#${colors[lane].getHexString()}`, boxShadow: `0 0 10px #${colors[lane].getHexString()}` }} />
            {cap('key', lane, 0, ks[0] ? keyName(ks[0]) : null)}
            {cap('key', lane, ks[0] ? 1 : 0, ks[1] ? keyName(ks[1]) : null)}
          </div>
        ))}
      </div>
      <div className="label" style={{ margin: '22px 0 10px' }}>
        <Gamepad2 size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
        {tr('Manette')} {pads.length ? `· ${pads.join(', ')}` : tr('· aucune détectée (appuyez sur un bouton pour la réveiller)')}
      </div>
      <div className="lanes-keys">
        {pad.map((bs, lane) => (
          <div key={lane} className="lane-col">
            <span className="dot" style={{ background: `#${colors[lane].getHexString()}`, boxShadow: `0 0 10px #${colors[lane].getHexString()}` }} />
            {cap('pad', lane, 0, bs[0] !== undefined ? padName(bs[0]) : null)}
            {cap('pad', lane, bs[0] !== undefined ? 1 : 0, bs[1] !== undefined ? padName(bs[1]) : null)}
          </div>
        ))}
      </div>
      <p className="tip" style={{ marginTop: 16 }}>
        {tr('Cliquez sur une touche puis appuyez sur la nouvelle (Échap annule, Suppr efface). Une touche ne sert qu’à une colonne à la fois. En jeu : Échap ou Start pour la pause, Retour arrière pour recommencer. La souris et l’écran tactile jouent aussi : touchez directement la colonne.')}
      </p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          className="btn small ghost"
          onClick={() => {
            const st = useSettings.getState();
            st.set({ keys: { ...st.keys, [lanes]: DEFAULT_KEYS[lanes] }, pad: { ...st.pad, [lanes]: DEFAULT_PAD[lanes] } });
            setWait(null);
          }}
        >
          <RotateCcw size={14} /> {tr('Touches par défaut ({n} colonnes)', { n: lanes })}
        </button>
      </div>
    </>
  );
}

function Offset({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string }) {
  return (
    <>
      <button className="btn small icon" aria-label={`${label} −1 ms`} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <Range value={value} min={min} max={max} step={1} onChange={onChange} label={label} />
      <button className="btn small icon" aria-label={`${label} +1 ms`} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
      <span className="val" style={{ minWidth: 70 }}>
        {value > 0 ? '+' : ''}
        {value} ms
      </span>
    </>
  );
}

function AudioTab() {
  const s = useSettings();
  const [lat, setLat] = useState(0);
  useEffect(() => setLat(outputLatency()), []);
  const vol = (k: keyof S['volume'], v: number) => s.set({ volume: { ...s.volume, [k]: v } });
  return (
    <>
      <h2 className="tab-title">{tr('Audio et synchronisation')}</h2>
      <Row title={tr('Volume général')}>
        <Range value={s.volume.master} min={0} max={1} step={0.01} onChange={(v) => vol('master', v)} label={tr('Volume général')} />
        <span className="val">{Math.round(s.volume.master * 100)} %</span>
      </Row>
      <Row title={tr('Musique')} hint={tr('Fichiers locaux et lecteur YouTube')}>
        <Range value={s.volume.music} min={0} max={1} step={0.01} onChange={(v) => vol('music', v)} label={tr('Volume musique')} />
        <span className="val">{Math.round(s.volume.music * 100)} %</span>
      </Row>
      <Row title={tr('Effets')} hint={tr('Interface, sons de frappe, compte à rebours')}>
        <Range value={s.volume.sfx} min={0} max={1} step={0.01} onChange={(v) => vol('sfx', v)} label={tr('Volume effets')} />
        <span className="val">{Math.round(s.volume.sfx * 100)} %</span>
      </Row>
      <div className="sync-box">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Gauge size={22} color="var(--cyan)" style={{ flex: 'none', marginTop: 2 }} />
          <div className="grow">
            <b>{tr('Calibration de la latence')}</b>
            <div className="tip">
              {tr('Le jeu suit l’horloge de la carte son et tient déjà compte de la latence annoncée par le système ({ms} ms). Un casque Bluetooth, une télévision ou certains écrans ajoutent un retard que seul un test peut mesurer : quelques secondes à taper en rythme.', { ms: Math.round(lat * 1000) })}
            </div>
          </div>
          <button className="btn cyan" onClick={() => go({ id: 'calibration' })}>
            {tr('Calibrer')}
          </button>
        </div>
      </div>
      <Row title={tr('Décalage audio')} hint={tr('+ si vous entendez la musique en retard (vos frappes sont jugées « tard »)')}>
        <Offset value={s.audioOffsetMs} min={-300} max={300} onChange={(v) => s.set({ audioOffsetMs: v })} label={tr('Décalage audio')} />
      </Row>
      <Row title={tr('Décalage visuel')} hint={tr('+ si les notes semblent arriver sur la ligne après le son')}>
        <Offset value={s.visualOffsetMs} min={-150} max={150} onChange={(v) => s.set({ visualOffsetMs: v })} label={tr('Décalage visuel')} />
      </Row>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn small ghost" onClick={() => s.reset(['audioOffsetMs', 'visualOffsetMs', 'volume'])}>
          <RotateCcw size={14} /> {tr('Valeurs par défaut')}
        </button>
      </div>
    </>
  );
}

function DisplayTab() {
  const s = useSettings();
  const [fs, setFs] = useState(false);
  const win = platform.window;
  useEffect(() => {
    if (win) void win.isFullscreen().then(setFs);
    else setFs(!!document.fullscreenElement);
  }, [win]);
  const toggleFs = async () => {
    if (win) {
      win.setFullscreen(!fs);
      setFs(!fs);
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
      setFs(false);
    } else {
      await document.documentElement.requestFullscreen().catch(() => undefined);
      setFs(!!document.fullscreenElement);
    }
  };
  return (
    <>
      <h2 className="tab-title">{tr('Affichage')}</h2>
      <Row title={tr('Plein écran')}>
        <Toggle on={fs} onChange={() => void toggleFs()} label={tr('Plein écran')} />
      </Row>
      <Row title={tr('Qualité graphique')} hint={tr('Auto choisit selon la machine (actuellement : {q})', { q: QUALITY_LABEL[engine.currentQuality] })}>
        <Seg<Quality | 'auto'>
          value={s.quality}
          onChange={(v) => s.set({ quality: v })}
          options={[
            { v: 'auto', label: tr('Auto') },
            { v: 'low', label: tr('Basse') },
            { v: 'medium', label: tr('Moyenne') },
            { v: 'high', label: tr('Haute') },
          ]}
        />
      </Row>
      <Row title={tr('Images par seconde')} hint={tr('Illimité suit la fréquence de l’écran (60, 120, 144, 240 Hz…)')}>
        <Seg
          value={s.fpsCap}
          onChange={(v) => s.set({ fpsCap: v })}
          options={[
            { v: 0, label: tr('Écran') },
            { v: 60, label: '60' },
            { v: 120, label: '120' },
            { v: 144, label: '144' },
            { v: 240, label: '240' },
          ]}
        />
      </Row>
      <Row title={tr('Menus économes')} hint={tr('30 images par seconde hors partie (portables, batterie)')}>
        <Toggle on={s.menuFps30} onChange={(v) => s.set({ menuFps30: v })} label={tr('Menus économes')} />
      </Row>
      <Row title={tr('Effets cosmiques')} hint={tr('Nébuleuses réactives, ondes de choc, étoiles filantes')}>
        <Seg
          value={s.effects}
          onChange={(v) => s.set({ effects: v })}
          options={[
            { v: 1, label: tr('Complets') },
            { v: 0.5, label: tr('Réduits') },
            { v: 0, label: tr('Minimaux') },
          ]}
        />
      </Row>
      <Row title={tr('Mouvements réduits')} hint={tr('Univers plus calme, transitions instantanées')}>
        <Toggle on={s.reducedMotion} onChange={(v) => s.set({ reducedMotion: v })} label={tr('Mouvements réduits')} />
      </Row>
      <Row title={tr('Compteur d’images')} hint={tr('Affiche les images par seconde et la pire image en jeu')}>
        <Toggle on={s.showFps} onChange={(v) => s.set({ showFps: v })} label={tr('Compteur d’images')} />
      </Row>
      {platform.restart && (
        <Row
          title={tr('Mode sans échec')}
          hint={
            platform.safeMode.on
              ? tr('Actif : dessin sans la carte graphique, effets minimaux, 60 images par seconde au plus. Les réglages ci-dessus reprendront au retour du mode normal.')
              : tr('Si l’affichage plante, clignote ou reste noir : dessin sans la carte graphique, effets minimaux.')
          }
        >
          <button className="btn small" onClick={() => platform.restart?.(platform.safeMode.on ? 'normal' : 'safe')}>
            <RotateCcw size={14} /> {platform.safeMode.on ? tr('Redémarrer normalement') : tr('Redémarrer en mode sans échec')}
          </button>
        </Row>
      )}
    </>
  );
}

const QUALITY_LABEL: Record<Quality, string> = { low: tr('basse'), medium: tr('moyenne'), high: tr('haute') };

function YoutubeTab() {
  const s = useSettings();
  const yt = platform.youtube;
  return (
    <>
      <h2 className="tab-title">{tr('YouTube Music')}</h2>
      <p className="tip" style={{ marginTop: -4 }}>
        {s.ytSource === 'download' && platform.ytdlp
          ? tr('Le son des morceaux YouTube est téléchargé une fois avec yt-dlp, puis joué et analysé comme un fichier local : partition complète dès la première partie, sans publicité ni saccade.')
          : tr('La musique est jouée par le lecteur officiel YouTube, sans téléchargement ni extraction du flux. Le jeu écoute ce que le lecteur fait entendre pour écrire la partition.')}
      </p>
      {platform.ytdlp && (
        <Row title={tr('Lecture des morceaux YouTube')} hint={tr('yt-dlp s’installe seul au premier morceau ; en cas d’échec, le lecteur officiel prend le relais')}>
          <Seg
            value={s.ytSource}
            onChange={(v) => s.set({ ytSource: v })}
            options={[
              { v: 'download', label: tr('Télécharger le son') },
              { v: 'player', label: tr('Lecteur officiel en direct') },
            ]}
          />
        </Row>
      )}
      {platform.ytdlp && s.ytSource === 'download' && <YtdlpPanel />}
      <Row title={tr('Première écoute')} hint={s.ytMode === 'live' ? tr('Les notes sont écrites en direct pendant la lecture, avec une petite avance') : tr('Le morceau est d’abord écouté une fois, puis joué avec une partition complète')}>
        <Seg
          value={s.ytMode}
          onChange={(v) => s.set({ ytMode: v })}
          options={[
            { v: 'learn-first', label: tr('Partie normale') },
            { v: 'live', label: tr('Jouer en direct') },
          ]}
        />
      </Row>
      <Row title={tr('Décalage YouTube')} hint={tr('S’ajoute au décalage audio, pour les morceaux YouTube seulement (+ si la musique vous parvient en retard)')}>
        <Offset value={s.ytOffsetMs} min={-300} max={300} onChange={(v) => s.set({ ytOffsetMs: v })} label={tr('Décalage YouTube')} />
      </Row>
      {yt && <AdblockPanel />}
      {!yt && (
        <div className="sync-box" style={{ marginTop: 14 }}>
          <div className="tip">
            {tr('Dans le navigateur, YouTube se joue à partir d’un lien. La recherche YouTube Music, le bloqueur de publicités et l’analyse intégrée au lecteur sont disponibles dans l’application de bureau (Windows, Linux, macOS).')}
          </div>
        </div>
      )}
    </>
  );
}

/** yt-dlp: found or not, install / update, downloaded songs. */
function YtdlpPanel() {
  const y = platform.ytdlp!;
  const [st, setSt] = useState<YtdlpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void y.status().then((x) => alive && setSt(x), () => undefined);
    return () => {
      alive = false;
    };
  }, [y]);
  const install = async () => {
    setBusy(true);
    try {
      setSt(await y.install());
      toast({ kind: 'info', title: tr('yt-dlp est prêt') });
    } catch (e) {
      toastError(e, tr('Installation impossible'));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    await y.clear();
    setSt(await y.status());
  };
  return (
    <div className="sync-box" style={{ marginTop: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Download size={22} color={st?.found ? 'var(--cyan)' : 'var(--gold)'} style={{ flex: 'none', marginTop: 2 }} />
        <div className="grow">
          <b>{!st ? tr('Recherche de yt-dlp…') : st.found ? tr('yt-dlp {v}', { v: st.version ?? '' }) : tr('yt-dlp n’est pas installé')}</b>
          <div className="tip">
            {st?.found
              ? st.own
                ? tr('Installé par Chud Tiles dans son profil.')
                : tr('Trouvé sur le système.')
              : tr('Il sera téléchargé depuis sa page officielle (github.com/yt-dlp) au premier morceau YouTube.')}
            {st && ` ${trn(st.songs, '{n} morceau téléchargé', '{n} morceaux téléchargés')} · ${tr('{mb} Mo', { mb: fmtNum(st.bytes / 1048576, 1) })}`}
          </div>
          <div className="tip" style={{ color: 'var(--gold)' }}>
            {tr('Télécharger le son va à l’encontre des conditions d’utilisation de YouTube : réservé à votre usage personnel, à vos risques.')}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {(!st?.found || st.own) && (
          <button className="btn small" disabled={busy} onClick={() => void install()}>
            <Download size={14} /> {st?.found ? tr('Mettre à jour yt-dlp') : tr('Installer yt-dlp')}
          </button>
        )}
        {!!st?.songs && (
          <button className="btn small ghost" onClick={() => void clear()}>
            <Trash2 size={14} /> {tr('Supprimer les morceaux téléchargés')}
          </button>
        )}
      </div>
    </div>
  );
}

const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : tr('jamais'));

/** The ad blocker of the YouTube session (same lists and principle as Chud Music). */
function AdblockPanel() {
  const ab = platform.youtube!.adblock;
  const [st, setSt] = useState<AdblockStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void ab.status().then((x) => alive && setSt(x));
    const off = ab.onStatus((x) => setSt(x));
    return () => {
      alive = false;
      off();
    };
  }, [ab]);
  if (!st) return null;
  const state = !st.enabled
    ? { text: tr('Désactivé'), color: 'var(--ink-3)' }
    : st.active
      ? { text: tr('Actif'), color: 'var(--cyan)' }
      : st.error
        ? { text: tr('Erreur'), color: 'var(--danger, #ff4f7a)' }
        : st.waiting
          ? { text: tr('En attente (première utilisation de YouTube)'), color: 'var(--gold)' }
          : { text: tr('Préparation…'), color: 'var(--gold)' };
  return (
    <div className="sync-box" style={{ marginTop: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <ShieldCheck size={22} color={state.color} style={{ flex: 'none', marginTop: 2 }} />
        <div className="grow">
          <b>{tr('Bloqueur de publicités')}</b>{' '}
          <span className="chip" style={{ color: state.color, marginLeft: 6 }}>
            {state.text}
          </span>
          <div className="tip">
            {tr('Le même que Chud Music : listes uBlock Origin, appliquées uniquement à la session du lecteur YouTube. Les listes sont vérifiées toutes les heures.')}
            {st.error ? ` ${st.error}` : ''}
          </div>
        </div>
        <Toggle on={st.enabled} onChange={(v) => void ab.setEnabled(v).then(setSt, (e) => toastError(e))} label={tr('Bloqueur de publicités')} />
      </div>
      {st.enabled && (
        <>
          <div className="ab-stats">
            <div>
              <b className="num">{fmtNum(st.blocked)}</b>
              <small>{tr('requêtes bloquées')}</small>
            </div>
            <div>
              <b className="num">{fmtNum(st.adsSeen)}</b>
              <small>{tr('pubs signalées par le lecteur')}</small>
            </div>
            <div>
              <b className="num">{fmtNum(st.filters)}</b>
              <small>{tr('filtres')}</small>
            </div>
            <div>
              <b className="num">{st.lists.length}</b>
              <small>{tr('listes')}</small>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="tip grow">
              {tr('Listes mises à jour : {u} · vérifiées : {c}', { u: fmtDate(st.listsUpdatedAt), c: fmtDate(st.listsCheckedAt) })}
            </span>
            <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>
              {open ? tr('Masquer') : tr('Détails')}
            </button>
            <button className="btn small" disabled={st.checking} onClick={() => void ab.check().catch((e) => toastError(e))}>
              <RefreshCw size={14} className={st.checking ? 'spin' : ''} /> {tr('Vérifier')}
            </button>
          </div>
          {open && (
            <ul className="ab-lists">
              {st.lists.map((l) => (
                <li key={l.id}>
                  <span className="grow">{l.title}</span>
                  <small className="muted">{fmtDate(l.updatedAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DataTab() {
  const [size, setSize] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void db.usage().then(setSize);
  useEffect(refresh, []);
  const ask = (id: string, run: () => Promise<void>) => async () => {
    if (confirm !== id) {
      setConfirm(id);
      setTimeout(() => setConfirm((c) => (c === id ? null : c)), 4000);
      return;
    }
    setConfirm(null);
    try {
      await run();
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const exportAll = async () => {
    const data = {
      app: 'chud-tiles',
      version: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      profile: await db.get('kv', 'profile'),
      records: await db.all('records'),
      tracks: await db.all('tracks'),
      settings: JSON.parse(localStorage.getItem('chud-tiles-settings') ?? 'null'),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chud-tiles-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importAll = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'chud-tiles') throw new Error(tr('Ce fichier n’est pas une sauvegarde Chud Tiles.'));
      if (data.profile) await db.put('kv', data.profile, 'profile');
      for (const r of data.records ?? []) await db.put('records', r);
      for (const t of data.tracks ?? []) await db.put('tracks', t);
      if (data.settings) localStorage.setItem('chud-tiles-settings', JSON.stringify(data.settings));
      await useProfile.getState().load();
      await useLibrary.getState().load();
      toast({ kind: 'gold', title: tr('Sauvegarde restaurée'), text: tr('{p} parties, {t} morceaux. Les réglages s’appliqueront au prochain démarrage.', { p: data.records?.length ?? 0, t: data.tracks?.length ?? 0 }) });
      refresh();
    } catch (e) {
      toastError(e, tr('Restauration impossible'));
    }
  };

  return (
    <>
      <h2 className="tab-title">{tr('Données')}</h2>
      <p className="tip" style={{ marginTop: -4 }}>
        {tr('Tout reste sur cet appareil : profil, historique, archives et analyses des morceaux. Vos fichiers audio ne sont jamais copiés ni modifiés.')}
        {size !== null && ` ${tr('Espace utilisé : {mb} Mo.', { mb: fmtNum(size / 1048576, 1) })}`}
      </p>
      <Row title={tr('Sauvegarder')} hint={tr('Profil, historique, archives et réglages dans un fichier')}>
        <button className="btn small" onClick={() => void exportAll()}>
          <Download size={14} /> {tr('Exporter')}
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> {tr('Restaurer')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importAll(f);
            e.target.value = '';
          }}
        />
      </Row>
      <Row title={tr('Analyses en cache')} hint={tr('Partitions déjà calculées : elles seront refaites à la prochaine ouverture')}>
        <button
          className={`btn small ${confirm === 'cache' ? 'danger' : ''}`}
          onClick={ask('cache', async () => {
            await db.clear('analyses');
            await db.clear('learned');
            toast({ kind: 'info', title: tr('Cache des analyses vidé') });
          })}
        >
          <Trash2 size={14} /> {confirm === 'cache' ? tr('Confirmer ?') : tr('Vider')}
        </button>
      </Row>
      <Row title={tr('Historique et progression')} hint={tr('Parties, records, niveau et succès (les archives sont gardées)')}>
        <button
          className={`btn small ${confirm === 'progress' ? 'danger' : ''}`}
          onClick={ask('progress', async () => {
            await db.clear('records');
            await db.del('kv', 'profile');
            await useProfile.getState().load();
            toast({ kind: 'info', title: tr('Progression remise à zéro') });
          })}
        >
          <Trash2 size={14} /> {confirm === 'progress' ? tr('Confirmer ?') : tr('Effacer')}
        </button>
      </Row>
      <Row title={tr('Archives')} hint={tr('Oublie la liste des morceaux (les fichiers restent sur le disque)')}>
        <button
          className={`btn small ${confirm === 'tracks' ? 'danger' : ''}`}
          onClick={ask('tracks', async () => {
            await db.clear('tracks');
            await db.clear('handles');
            await useLibrary.getState().load();
            toast({ kind: 'info', title: tr('Archives vidées') });
          })}
        >
          <Trash2 size={14} /> {confirm === 'tracks' ? tr('Confirmer ?') : tr('Vider')}
        </button>
      </Row>
      <Row title={tr('Réglages')} hint={tr('Toutes les options reviennent à leur valeur d’origine')}>
        <button
          className={`btn small ${confirm === 'settings' ? 'danger' : ''}`}
          onClick={ask('settings', async () => {
            useSettings.getState().set(DEFAULTS);
            toast({ kind: 'info', title: tr('Réglages par défaut rétablis') });
          })}
        >
          <RotateCcw size={14} /> {confirm === 'settings' ? tr('Confirmer ?') : tr('Rétablir')}
        </button>
      </Row>
    </>
  );
}

function AboutTab() {
  const caps = platform.caps;
  const osName = { windows: 'Windows', linux: 'Linux', mac: 'macOS', web: tr('Navigateur web') }[platform.os];
  return (
    <>
      <h2 className="tab-title">{tr('À propos')}</h2>
      <div className="about">
        <Logo size={128} />
        <div className="display" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.2em', marginTop: 10 }}>
          CHUD TILES
        </div>
        <div className="muted">
          {tr('Version')} {platform.version} · {osName} · {platform.kind === 'electron' ? tr('application de bureau') : tr('version navigateur')}
        </div>
        <div className="row wrap" style={{ marginTop: 14 }}>
          <span className={`chip ${caps.youtube === 'full' ? 'on' : ''}`}>YouTube Music {caps.youtube === 'full' ? tr('complet') : tr('par lien')}</span>
          <span className={`chip ${caps.adblock ? 'on' : ''}`}>{tr('Bloqueur de publicités')} {caps.adblock ? tr('actif') : tr('indisponible')}</span>
          <span className={`chip ${caps.ffmpeg ? 'on' : ''}`}>FFmpeg {caps.ffmpeg ? tr('intégré') : tr('absent')}</span>
          <span className={`chip ${caps.chudMusic ? 'on' : ''}`}>Chud Music {caps.chudMusic ? tr('lisible') : tr('non')}</span>
          <span className="chip on">{tr('Rendu WebGL 2')}</span>
        </div>
        {platform.updates && <UpdateRow />}
        <p className="tip" style={{ marginTop: 18 }}>
          {tr('Lecture YouTube par le lecteur officiel, sans téléchargement ni extraction de flux. Décodage des formats rares par FFmpeg (LGPL). Polices Oxanium et Space Grotesk (SIL Open Font License). Rendu Three.js (MIT). Toutes les images du jeu sont calculées en temps réel : aucune vidéo, aucune image volée.')}
        </p>
      </div>
    </>
  );
}

/** Desktop: check for a new version at launch, or now. */
function UpdateRow() {
  const s = useSettings();
  const [state, setState] = useState<UpdateInfo | null>(null);
  useEffect(() => platform.updates?.onState(setState), []);
  const check = async () => setState((await platform.updates?.check()) ?? null);
  const label =
    !state || state.status === 'idle'
      ? ''
      : state.status === 'checking'
        ? tr('Recherche…')
        : state.status === 'none'
          ? tr('Vous avez la dernière version.')
          : state.status === 'downloading'
            ? tr('Téléchargement de la version {v}… {p} %', { v: state.version ?? '', p: Math.round((state.progress ?? 0) * 100) })
            : state.status === 'ready'
              ? tr('Version {v} prête : elle s’installera à la fermeture du jeu.', { v: state.version ?? '' })
              : state.status === 'available'
                ? tr('Version {v} disponible.', { v: state.version ?? '' })
                : tr('Recherche impossible : {e}', { e: state.error ?? '' });
  return (
    <div className="update-row">
      <Toggle on={s.checkUpdates} onChange={(v) => s.set({ checkUpdates: v })} label={tr('Chercher les mises à jour au lancement')} />
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <button className="btn small" onClick={() => void check()} disabled={state?.status === 'checking' || state?.status === 'downloading'}>
          {tr('Chercher maintenant')}
        </button>
        {state?.status === 'ready' && (
          <button className="btn primary small" onClick={() => platform.updates?.install()}>
            {tr('Redémarrer')}
          </button>
        )}
        {state?.status === 'available' && (
          <button className="btn primary small" onClick={() => platform.openExternal(state.url ?? RELEASES_URL)}>
            {tr('Télécharger')}
          </button>
        )}
        {label && <span className="muted">{label}</span>}
      </div>
    </div>
  );
}
