import { locale, tr, trn } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, FilePlus2, RefreshCw, Search as SearchIcon, Star, Trash2, X, Library as LibraryIcon, Disc3, FolderOpen } from 'lucide-react';
import type { TrackRef } from '@shared/types';
import type { PlayRecord } from '@core/game/progress';
import { platform } from '../platform';
import { useLibrary, uniqueSongs } from '../store/library';
import { usePlaylists } from '../store/playlists';
import { useProfile } from '../store/profile';
import { openTrack, pickAndOpen } from '../game/actions';
import * as db from '../storage/db';
import { toast, toastError } from '../store/toasts';
import { Cover, RankBadge, Seg, fmtTime } from '../components/ui';
import { playSfx } from '../audio/sfx';

// The archives: every song the game knows (picked files, scanned folders, Chud Music's library,
// YouTube songs played). Removing a song only forgets it here; the file itself is never touched.

type Source = 'all' | 'local' | 'youtube' | 'fav';
type Sort = 'recent' | 'title' | 'artist' | 'plays' | 'added';

const RANK_ORDER = ['SS', 'S', 'A', 'B', 'C', 'D'];
const PAGE = 120;

function useBestRanks(): Record<string, string> {
  const recent = useProfile((s) => s.recent);
  const [best, setBest] = useState<Record<string, string>>({});
  useEffect(() => {
    void db.all<PlayRecord>('records').then((all) => {
      const out: Record<string, string> = {};
      for (const r of all) {
        if (r.practice || !r.cleared) continue;
        const cur = out[r.trackKey];
        if (!cur || RANK_ORDER.indexOf(r.rank) < RANK_ORDER.indexOf(cur)) out[r.trackKey] = r.rank;
      }
      setBest(out);
    });
  }, [recent]);
  return best;
}

export function Library() {
  const tracks = useLibrary((s) => s.tracks);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const best = useBestRanks();
  const lib = platform.library;

  useEffect(() => {
    void lib?.folders().then(setFolders);
  }, [lib]);

  const list = useMemo(() => {
    const words = q
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .split(/\s+/)
      .filter(Boolean);
    const norm = (t: TrackRef) =>
      `${t.title} ${t.artist ?? ''} ${t.album ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    let out = Object.values(tracks).filter((t) => {
      if (source === 'fav' && !t.favorite) return false;
      if (source === 'youtube' && t.source !== 'youtube') return false;
      if (source === 'local' && t.source === 'youtube') return false;
      if (!words.length) return true;
      const s = norm(t);
      return words.every((w) => s.includes(w));
    });
    const by = (f: (t: TrackRef) => string) => (a: TrackRef, b: TrackRef) => f(a).localeCompare(f(b), locale, { sensitivity: 'base' });
    if (sort === 'title') out = out.sort(by((t) => t.title));
    else if (sort === 'artist') out = out.sort((a, b) => by((t) => t.artist ?? '~')(a, b) || by((t) => t.album ?? '')(a, b) || by((t) => t.title)(a, b));
    else if (sort === 'plays') out = out.sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0) || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    else if (sort === 'added') out = out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    else out = out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || by((t) => t.title)(a, b));
    // songs played under several keys are shown once (the most recent or most played copy)
    if (sort === 'recent' || sort === 'plays') {
      const played = uniqueSongs(out.filter((t) => t.lastPlayed));
      out = [...played, ...out.filter((t) => !t.lastPlayed)];
    }
    return out;
  }, [tracks, q, source, sort]);

  useEffect(() => setShown(PAGE), [q, source, sort]);

  const total = Object.keys(tracks).length;

  const scan = async () => {
    if (!lib) return;
    setBusy('scan');
    try {
      const res = await lib.scan();
      await useLibrary.getState().add(res.tracks);
      setFolders(res.folders);
      toast({ kind: 'info', title: trn(res.tracks.length, '{n} morceau trouvé', '{n} morceaux trouvés'), text: res.skipped ? trn(res.skipped, '{n} fichier illisible ignoré.', '{n} fichiers illisibles ignorés.') : undefined });
    } catch (e) {
      toastError(e, tr('Analyse des dossiers impossible'));
    } finally {
      setBusy(null);
    }
  };

  const addFolder = async () => {
    if (!lib) return;
    const f = await lib.addFolder();
    if (f) {
      setFolders(await lib.folders());
      await scan();
    }
  };

  const importChud = async () => {
    if (!lib) return;
    setBusy('chud');
    try {
      const res = await lib.chudMusic();
      if (!res.found) {
        toast({ kind: 'error', title: tr('Chud Music introuvable'), text: tr('Aucune bibliothèque Chud Music n’a été trouvée sur cet ordinateur.') });
        return;
      }
      await useLibrary.getState().add(res.tracks);
      await usePlaylists.getState().setChudMusic(res.playlists);
      toast({ kind: 'info', title: trn(res.tracks.length, '{n} morceau importé de Chud Music', '{n} morceaux importés de Chud Music'), text: res.playlists.length ? trn(res.playlists.length, '{n} liste disponible dans « Listes ».', '{n} listes disponibles dans « Listes ».') : undefined });
    } catch (e) {
      toastError(e, tr('Import Chud Music impossible'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-enter library">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--cyan)' }}>
            {tr('Salle des archives')}
          </div>
          <h1 style={{ marginTop: 8 }}>{tr('Archives')}</h1>
          <div className="sub">
            {total ? `${trn(total, '{n} morceau', '{n} morceaux')} · ` : ''}{tr('vos fichiers restent intacts, rien n’est copié ni modifié')}
          </div>
        </div>
        <span className="grow" />
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          {lib && platform.caps.chudMusic && (
            <button className="btn" onClick={importChud} disabled={!!busy}>
              <Disc3 size={16} className={busy === 'chud' ? 'spin' : ''} /> {tr('Chud Music')}
            </button>
          )}
          {lib && (
            <button className="btn" onClick={addFolder} disabled={!!busy}>
              <FolderPlus size={16} /> {tr('Dossier')}
            </button>
          )}
          <button
            className="btn primary"
            onClick={() => {
              playSfx('click');
              void pickAndOpen();
            }}
          >
            <FilePlus2 size={16} /> {tr('Ajouter des fichiers')}
          </button>
        </div>
      </div>

      {lib && folders.length > 0 && (
        <div className="row wrap folders">
          {folders.map((f) => (
            <span key={f} className="chip" title={f}>
              <FolderOpen size={13} /> {f.split(/[\\/]/).filter(Boolean).slice(-2).join('/')}
              <button
                className="chip-x"
                aria-label={`Retirer ${f}`}
                onClick={async () => {
                  await lib.removeFolder(f);
                  setFolders(await lib.folders());
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button className="btn small ghost" onClick={scan} disabled={!!busy}>
            <RefreshCw size={14} className={busy === 'scan' ? 'spin' : ''} /> {tr('Rescanner')}
          </button>
        </div>
      )}

      <div className="panel lib-panel">
        <div className="lib-tools">
          <div className="search grow" style={{ minWidth: 200 }}>
            <SearchIcon size={17} />
            <input className="input" placeholder={tr('Titre, artiste, album…')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Seg<Source>
            value={source}
            onChange={setSource}
            options={[
              { v: 'all', label: tr('Tout') },
              { v: 'local', label: tr('Fichiers') },
              { v: 'youtube', label: tr('YouTube') },
              { v: 'fav', label: <Star size={13} />, title: tr('Favoris') },
            ]}
          />
          <select className="input select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={tr('Trier par')}>
            <option value="recent">{tr('Joués récemment')}</option>
            <option value="plays">{tr('Plus joués')}</option>
            <option value="title">{tr('Titre')}</option>
            <option value="artist">{tr('Artiste')}</option>
            <option value="added">{tr('Ajout')}</option>
          </select>
        </div>

        {list.length ? (
          <div className="lib-list">
            {list.slice(0, shown).map((t) => (
              <div key={t.key} className="track-row lib-row" onClick={() => openTrack(t)} onMouseEnter={() => playSfx('hover', 0.3)}>
                <Cover src={t.cover ?? null} />
                <div className="t">
                  <b>{t.title}</b>
                  <small>
                    {[t.artist, t.album].filter(Boolean).join(' · ') || (t.source === 'youtube' ? tr('YouTube') : tr('Fichier local'))}
                  </small>
                </div>
                <div className="lib-meta">
                  {best[t.key] && <RankBadge rank={best[t.key]} />}
                  {t.source === 'youtube' && <span className="chip">{tr('YouTube')}</span>}
                  {t.origin === 'chud-music' && <span className="chip">{tr('Chud Music')}</span>}
                  {(t.plays ?? 0) > 0 && <span className="muted num" title={tr('Parties')}>{t.plays}×</span>}
                  <span className="muted num">{fmtTime(t.duration)}</span>
                </div>
                <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <button className={`btn small icon ghost fav ${t.favorite ? 'on' : ''}`} aria-label={t.favorite ? tr('Retirer des favoris') : tr('Ajouter aux favoris')} onClick={() => void useLibrary.getState().toggleFavorite(t.key)}>
                    <Star size={15} fill={t.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="btn small icon ghost danger"
                    aria-label={tr('Retirer des archives')}
                    title={tr('Retirer des archives (le fichier n’est pas supprimé)')}
                    onClick={() => {
                      void useLibrary.getState().remove(t.key);
                      toast({ kind: 'info', title: tr('Retiré des archives'), text: t.title });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {list.length > shown && (
              <button className="btn ghost" style={{ margin: '10px auto 4px', display: 'flex' }} onClick={() => setShown((n) => n + PAGE * 2)}>
                {tr('Afficher plus ({n})', { n: list.length - shown })}
              </button>
            )}
          </div>
        ) : (
          <div className="empty">
            <LibraryIcon size={40} />
            {total ? (
              <span>{tr('Aucun morceau ne correspond.')}</span>
            ) : (
              <>
                <span>{tr('Les archives sont vides.')}</span>
                <span className="tip">
                  {lib
                    ? platform.caps.chudMusic
                      ? tr('Ajoutez des fichiers audio, un dossier de musique ou importez votre bibliothèque Chud Music. Vous pouvez aussi les glisser-déposer dans la fenêtre.')
                      : tr('Ajoutez des fichiers audio ou un dossier de musique. Vous pouvez aussi les glisser-déposer dans la fenêtre.')
                    : tr('Ajoutez des fichiers audio. Vous pouvez aussi les glisser-déposer dans la fenêtre.')}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
