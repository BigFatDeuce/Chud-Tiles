import { locale, tr, trn } from '../i18n';
import { useMemo, useState } from 'react';
import { ArrowLeft, ListMusic, Loader2, Pencil, Play, Plus, RefreshCw, Shuffle, Trash2, X } from 'lucide-react';
import type { Playlist, TrackRef } from '@shared/types';
import { platform } from '../platform';
import { useLibrary } from '../store/library';
import { usePlaylists } from '../store/playlists';
import { useQueue } from '../store/queue';
import { go } from '../store/nav';
import { toast, toastError } from '../store/toasts';
import { Cover, fmtTime } from '../components/ui';
import { playSfx } from '../audio/sfx';

// The lists room: lists made here, Chud Music's lists (read from its library, never written back)
// and albums or playlists saved from YouTube Music. A list plays as a queue: the results screen
// offers the next song.

const GROUPS: { origin: Playlist['origin']; title: string; hint: string }[] = [
  { origin: 'chud-tiles', title: tr('Mes listes'), hint: tr('Créées dans Chud Tiles.') },
  { origin: 'youtube', title: tr('YouTube Music'), hint: tr('Albums et playlists enregistrés depuis la salle radio.') },
  { origin: 'chud-music', title: tr('Chud Music'), hint: tr('Lues dans la bibliothèque Chud Music (jamais modifiée).') },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

function shuffled<T>(a: T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function Playlists() {
  const lists = usePlaylists((s) => s.lists);
  const tracks = useLibrary((s) => s.tracks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const lib = platform.library;
  const open = lists.find((l) => l.id === openId) ?? null;

  const refsOf = (p: Playlist): TrackRef[] => p.tracks.map((k) => tracks[k]).filter((t): t is TrackRef => !!t);

  const play = (p: Playlist, from = 0, mix = false) => {
    const refs = mix ? shuffled(refsOf(p)) : refsOf(p);
    if (!refs.length) return toast({ kind: 'error', title: tr('Liste vide'), text: tr('Aucun morceau de cette liste n’est dans les archives.') });
    useQueue.getState().start(p.name, refs, from);
    go({ id: 'song', track: refs[from]! });
  };

  const refreshChud = async () => {
    if (!lib) return;
    setBusy(true);
    try {
      const res = await lib.chudMusic();
      if (!res.found) return toast({ kind: 'error', title: tr('Chud Music introuvable'), text: tr('Aucune bibliothèque Chud Music n’a été trouvée sur cet ordinateur.') });
      await useLibrary.getState().add(res.tracks);
      await usePlaylists.getState().setChudMusic(res.playlists);
      toast({ kind: 'info', title: trn(res.playlists.length, '{n} liste Chud Music', '{n} listes Chud Music'), text: trn(res.tracks.length, '{n} morceau dans les archives.', '{n} morceaux dans les archives.') });
    } catch (e) {
      toastError(e, tr('Lecture de Chud Music impossible'));
    } finally {
      setBusy(false);
    }
  };

  const create = async (name: string) => {
    const n = name.trim();
    if (!n) return setCreating(null);
    const p: Playlist = { id: `chud-tiles:${Date.now().toString(36)}`, name: n, tracks: [], origin: 'chud-tiles', cover: null };
    await usePlaylists.getState().save(p);
    setCreating(null);
    setOpenId(p.id);
  };

  if (open) return <ListView list={open} refs={refsOf(open)} onBack={() => setOpenId(null)} onPlay={(i, mix) => play(open, i, mix)} />;

  return (
    <div className="page-enter">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--cyan)' }}>
            {tr('Salle des listes')}
          </div>
          <h1 style={{ marginTop: 8 }}>{tr('Listes')}</h1>
          <div className="sub">{tr('Une liste se joue à la suite : l’écran des résultats propose le morceau suivant.')}</div>
        </div>
        <div className="row">
          {lib && platform.caps.chudMusic && (
            <button className="btn" disabled={busy} onClick={() => void refreshChud()}>
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Chud Music
            </button>
          )}
          <button className="btn primary" onClick={() => setCreating('')}>
            <Plus size={16} /> {tr('Nouvelle liste')}
          </button>
        </div>
      </div>

      {creating !== null && (
        <form
          className="panel pad row"
          style={{ marginBottom: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void create(creating);
          }}
        >
          <ListMusic size={18} color="var(--cyan)" />
          <input className="grow" autoFocus placeholder={tr('Nom de la liste')} value={creating} maxLength={80} onChange={(e) => setCreating(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
          <button className="btn small primary" type="submit">
            {tr('Créer')}
          </button>
          <button className="btn small ghost icon" type="button" aria-label={tr('Annuler')} onClick={() => setCreating(null)}>
            <X size={15} />
          </button>
        </form>
      )}

      {GROUPS.map((g) => {
        const of = lists.filter((l) => l.origin === g.origin).sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
        if (!of.length && g.origin !== 'chud-tiles') return null;
        return (
          <section key={g.origin} style={{ marginBottom: 26 }}>
            <div className="section-head">
              <h3>{g.title}</h3>
              <span className="muted">{g.hint}</span>
            </div>
            {of.length === 0 ? (
              <p className="tip">{tr('Aucune liste pour l’instant. Créez-en une, ou enregistrez un album depuis la salle radio.')}</p>
            ) : (
              <div className="col-grid">
                {of.map((p) => {
                  const refs = refsOf(p);
                  return (
                    <button
                      key={p.id}
                      className="col-card"
                      onClick={() => {
                        playSfx('click');
                        setOpenId(p.id);
                      }}
                      onMouseEnter={() => playSfx('hover', 0.3)}
                    >
                      <Cover src={p.cover ?? refs.find((r) => r.cover)?.cover ?? null} size="lg" icon="disc" />
                      <b>{p.name}</b>
                      <small>
                        {trn(refs.length, '{n} morceau', '{n} morceaux')}
                        {refs.length < p.tracks.length ? ` · ${trn(p.tracks.length - refs.length, '{n} absent', '{n} absents')}` : ''}
                      </small>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ListView({ list, refs, onBack, onPlay }: { list: Playlist; refs: TrackRef[]; onBack: () => void; onPlay: (from: number, mix?: boolean) => void }) {
  const tracks = useLibrary((s) => s.tracks);
  const own = list.origin === 'chud-tiles';
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [name, setName] = useState<string | null>(null);
  const total = refs.reduce((s, r) => s + (r.duration ?? 0), 0);

  const candidates = useMemo(() => {
    if (!adding) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    const inList = new Set(list.tracks);
    return Object.values(tracks)
      .filter((t) => !inList.has(t.key) && words.every((w) => norm(`${t.title} ${t.artist ?? ''} ${t.album ?? ''}`).includes(w)))
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 40);
  }, [adding, q, tracks, list.tracks]);

  const save = (patch: Partial<Playlist>) => void usePlaylists.getState().save({ ...list, ...patch });

  return (
    <div className="page-enter">
      <div className="page-head">
        <div className="row" style={{ gap: 20, alignItems: 'flex-end' }}>
          <Cover src={list.cover ?? refs.find((r) => r.cover)?.cover ?? null} size="lg" icon="disc" />
          <div>
            <button className="btn small ghost" onClick={onBack} style={{ marginBottom: 10 }}>
              <ArrowLeft size={15} /> {tr('Listes')}
            </button>
            <div className="label" style={{ color: 'var(--cyan)' }}>
              {list.origin === 'chud-music' ? tr('Liste Chud Music') : list.origin === 'youtube' ? tr('YouTube Music') : tr('Ma liste')}
            </div>
            {name !== null ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) save({ name: name.trim() });
                  setName(null);
                }}
              >
                <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => setName(null)} style={{ fontSize: 24, marginTop: 8 }} />
              </form>
            ) : (
              <h1 style={{ marginTop: 8 }}>
                {list.name}
                {own && (
                  <button className="btn small icon ghost" aria-label={tr('Renommer')} onClick={() => setName(list.name)} style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                    <Pencil size={14} />
                  </button>
                )}
              </h1>
            )}
            <div className="sub">
              {trn(refs.length, '{n} morceau', '{n} morceaux')}
              {total ? ` · ${fmtTime(total)}` : ''}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!refs.length} onClick={() => onPlay(0)}>
            <Play size={16} /> {tr('Jouer')}
          </button>
          <button className="btn" disabled={refs.length < 2} onClick={() => onPlay(0, true)}>
            <Shuffle size={16} /> {tr('Mélanger')}
          </button>
          {own && (
            <button className="btn" onClick={() => setAdding((a) => !a)}>
              <Plus size={16} /> {tr('Ajouter')}
            </button>
          )}
          {list.origin !== 'chud-music' && (
            <button
              className="btn ghost icon"
              aria-label={tr('Supprimer la liste')}
              title={tr('Supprimer la liste (les morceaux restent dans les archives)')}
              onClick={() => {
                if (!window.confirm(tr('Supprimer la liste « {name} » ? Les morceaux restent dans les archives.', { name: list.name }))) return;
                void usePlaylists.getState().remove(list.id);
                onBack();
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="panel lib-panel" style={{ marginBottom: 16 }}>
          <div className="lib-tools">
            <input className="grow" autoFocus placeholder={tr('Chercher dans les archives…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn small ghost icon" aria-label={tr('Fermer')} onClick={() => setAdding(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="lib-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {candidates.length === 0 ? (
              <p className="tip" style={{ padding: 12 }}>
                {tr('Aucun morceau à ajouter.')}
              </p>
            ) : (
              candidates.map((t) => (
                <div key={t.key} className="track-row" onClick={() => save({ tracks: [...list.tracks, t.key], cover: list.cover ?? t.cover ?? null })}>
                  <Cover src={t.cover} />
                  <div className="t">
                    <b>{t.title}</b>
                    <small>{t.artist ?? (t.source === 'youtube' ? tr('YouTube') : tr('Fichier local'))}</small>
                  </div>
                  <span className="muted num">{fmtTime(t.duration)}</span>
                  <Plus size={15} color="var(--cyan)" />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="panel lib-panel">
        {refs.length === 0 ? (
          <p className="tip" style={{ padding: 12 }}>
            {own ? tr('Liste vide : « Ajouter » pour y mettre des morceaux des archives.') : tr('Aucun morceau de cette liste n’est dans les archives.')}
          </p>
        ) : (
          <div className="lib-list">
            {refs.map((t, i) => (
              <div key={`${t.key}-${i}`} className="track-row" onClick={() => onPlay(i)} onMouseEnter={() => playSfx('hover', 0.3)}>
                <span className="muted num" style={{ width: 26, textAlign: 'right' }}>
                  {i + 1}
                </span>
                <Cover src={t.cover} />
                <div className="t">
                  <b>{t.title}</b>
                  <small>{[t.artist, t.album].filter(Boolean).join(' · ') || (t.source === 'youtube' ? tr('YouTube') : tr('Fichier local'))}</small>
                </div>
                <div className="lib-meta">
                  {t.source === 'youtube' && <span className="chip">{tr('YouTube')}</span>}
                  <span className="muted num">{fmtTime(t.duration)}</span>
                </div>
                {own && (
                  <button
                    className="btn small icon ghost"
                    aria-label={tr('Retirer de la liste')}
                    onClick={(e) => {
                      e.stopPropagation();
                      save({ tracks: list.tracks.filter((k) => k !== t.key) });
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
