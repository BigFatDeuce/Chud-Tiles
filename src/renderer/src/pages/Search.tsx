import { tr, trn } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Disc3, Link2, ListMusic, Loader2, Play, Radio, Search as SearchIcon, X } from 'lucide-react';
import type { YtItem, YtSearchKind } from '@shared/types';
import { parseYtLink } from '@shared/links';
import { platform } from '../platform';
import { useLibrary } from '../store/library';
import { go } from '../store/nav';
import { saveYtList, ytTrack } from '../store/playlists';
import { useQueue } from '../store/queue';
import { errorText, toast, toastError } from '../store/toasts';
import { Cover, Seg, fmtTime } from '../components/ui';
import { playSfx } from '../audio/sfx';

// The station's radio room: YouTube Music's catalogue (desktop), or a pasted YouTube link
// (everywhere). Only metadata is read; songs play in YouTube's official player.

const KINDS: { v: YtSearchKind; label: string }[] = [
  { v: 'song', label: tr('Titres') },
  { v: 'video', label: tr('Vidéos') },
  { v: 'album', label: tr('Albums') },
  { v: 'playlist', label: tr('Playlists') },
];

interface Collection {
  kind: 'album' | 'playlist';
  id: string;
  title: string;
  items: YtItem[] | null;
}

let lastSearch: { q: string; kind: YtSearchKind; items: YtItem[] } | null = null;

export function Search({ query }: { query?: string }) {
  const yt = platform.youtube;
  const lib = useLibrary();
  const [q, setQ] = useState(query ?? lastSearch?.q ?? '');
  const [kind, setKind] = useState<YtSearchKind>(lastSearch?.kind ?? 'song');
  /** Results with the kind they were searched for (a kind change keeps them until the new ones). */
  const [res, setRes] = useState<{ kind: YtSearchKind; items: YtItem[] } | null>(lastSearch ? { kind: lastSearch.kind, items: lastSearch.items } : null);
  const items = res?.items ?? null;
  const shownKind = res?.kind ?? kind;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugg, setSugg] = useState<string[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [col, setCol] = useState<Collection | null>(null);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    if (query) void run(query, kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // suggestions while typing (desktop)
  useEffect(() => {
    if (!yt || !q.trim() || parseYtLink(q)) {
      setSugg([]);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(() => {
      yt.suggestions(q.trim()).then(
        (s) => id === seq.current && setSugg(s),
        () => undefined,
      );
    }, 180);
    return () => clearTimeout(timer);
  }, [q, yt]);

  const openSong = async (it: YtItem) => {
    const ref = ytTrack(it);
    await lib.add([ref]);
    useQueue.getState().sync(ref.key);
    playSfx('click');
    go({ id: 'song', track: lib.tracks[ref.key] ?? ref });
  };

  const openLink = async (text: string): Promise<boolean> => {
    const link = parseYtLink(text);
    if (!link) return false;
    setError(null);
    if (link.kind === 'video' || (!yt && link.videoId)) {
      const id = link.kind === 'video' ? link.id : link.videoId!;
      let it: YtItem | null = null;
      if (yt) it = await yt.video(id).catch(() => null);
      await openSong(it ?? { kind: 'video', id, title: tr('Vidéo YouTube'), subtitle: '', artist: null, duration: null, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
      return true;
    }
    if (!yt) {
      setError(tr('Dans le navigateur, ouvrez une vidéo de la playlist (son lien direct) : la lecture des listes demande l’application de bureau.'));
      return true;
    }
    void openCollection({ kind: 'playlist', id: link.id, title: tr('Playlist YouTube'), items: null });
    return true;
  };

  async function run(text: string, k: YtSearchKind): Promise<void> {
    const t = text.trim();
    if (!t) return;
    setShowSugg(false);
    if (await openLink(t)) return;
    if (!yt) {
      setError(tr('Collez le lien d’une vidéo YouTube ou YouTube Music. La recherche dans le catalogue est disponible dans l’application de bureau.'));
      return;
    }
    setBusy(true);
    setError(null);
    setCol(null);
    try {
      const found = await yt.search(t, k);
      setRes({ kind: k, items: found });
      lastSearch = { q: t, kind: k, items: found };
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function openCollection(c: Collection): Promise<void> {
    if (!yt || (c.kind !== 'album' && c.kind !== 'playlist')) return;
    setCol(c);
    try {
      const got = c.kind === 'album' ? await yt.album(c.id) : await yt.playlist(c.id);
      setCol({ ...c, title: got.title || c.title, items: got.items });
    } catch (e) {
      setCol(null);
      toastError(e, tr('Liste illisible'));
    }
  }

  const playAll = async (c: Collection, from = 0) => {
    if (!c.items?.length) return;
    const refs = c.items.map(ytTrack);
    await lib.add(refs);
    useQueue.getState().start(c.title, refs, from);
    go({ id: 'song', track: refs[from] });
  };

  const radio = async (it: YtItem) => {
    if (!yt) return;
    try {
      const mix = await yt.mix(it.id);
      const refs = [ytTrack(it), ...mix.filter((m) => m.id !== it.id).map(ytTrack)];
      await lib.add(refs);
      useQueue.getState().start(`Radio · ${it.title}`, refs, 0);
      toast({ kind: 'info', title: tr('Radio lancée'), text: trn(refs.length, '{n} morceau à la suite de « {title} ».', '{n} morceaux à la suite de « {title} ».', { title: it.title }) });
      go({ id: 'song', track: refs[0] });
    } catch (e) {
      toastError(e, tr('Radio indisponible'));
    }
  };

  const songRow = (it: YtItem, i: number, onPlay: () => void) => (
    <div key={`${it.id}-${i}`} className="track-row" onClick={onPlay} onMouseEnter={() => playSfx('hover', 0.3)}>
      <Cover src={it.thumbnail} />
      <div className="t">
        <b>{it.title}</b>
        <small>{it.subtitle || it.artist || tr('YouTube')}</small>
      </div>
      <div className="lib-meta">
        {lib.tracks[`yt:${it.id}`]?.plays ? <span className="muted num">{lib.tracks[`yt:${it.id}`]!.plays}×</span> : null}
        <span className="muted num">{fmtTime(it.duration)}</span>
      </div>
      <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
        {yt && (
          <button className="btn small icon ghost" title={tr('Radio : enchaîner des morceaux proches')} aria-label={tr('Radio')} onClick={() => void radio(it)}>
            <Radio size={15} />
          </button>
        )}
        <button className="btn small icon ghost" aria-label={tr('Jouer')} onClick={onPlay}>
          <Play size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="page-enter search-page">
      <div className="page-head">
        <div>
          <div className="label" style={{ color: 'var(--cyan)' }}>
            {tr('Salle radio')} · {yt ? 'YouTube Music' : 'YouTube'}
          </div>
          <h1 style={{ marginTop: 8 }}>{yt ? tr('Capter une fréquence') : tr('Lien YouTube')}</h1>
          <div className="sub">{tr('Lecture par le lecteur officiel YouTube — rien n’est téléchargé.')}</div>
        </div>
      </div>

      <form
        className="search-bar panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q, kind);
        }}
      >
        {parseYtLink(q) ? <Link2 size={18} color="var(--cyan)" /> : <SearchIcon size={18} color="var(--ink-3)" />}
        <input
          ref={input}
          className="grow"
          value={q}
          placeholder={yt ? tr('Titre, artiste, album… ou lien YouTube') : 'https://music.youtube.com/watch?v=…'}
          onChange={(e) => {
            setQ(e.target.value);
            setShowSugg(true);
          }}
          onFocus={() => setShowSugg(true)}
          onBlur={() => setTimeout(() => setShowSugg(false), 150)}
          aria-label={tr('Recherche')}
        />
        {q && (
          <button type="button" className="btn small icon ghost" aria-label={tr('Effacer')} onClick={() => setQ('')}>
            <X size={15} />
          </button>
        )}
        <button className="btn primary small" type="submit" disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : parseYtLink(q) ? tr('Ouvrir') : tr('Chercher')}
        </button>
        {showSugg && sugg.length > 0 && (
          <div className="suggest panel solid">
            {sugg.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQ(s);
                  void run(s, kind);
                }}
              >
                <SearchIcon size={13} /> {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {yt && !col && (
        <div className="row" style={{ margin: '14px 0' }}>
          <Seg
            value={kind}
            options={KINDS}
            onChange={(k) => {
              setKind(k);
              if (q.trim() && !parseYtLink(q)) void run(q, k);
            }}
          />
        </div>
      )}

      {error && (
        <div className="panel pad" style={{ borderColor: 'rgba(255,79,122,0.4)', marginTop: 14 }}>
          <p className="tip" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {col ? (
        <div className="panel lib-panel" style={{ marginTop: 14 }}>
          <div className="lib-tools">
            <button className="btn small ghost" onClick={() => setCol(null)}>
              <ArrowLeft size={15} /> {tr('Résultats')}
            </button>
            <b className="grow" style={{ fontFamily: 'var(--display)', letterSpacing: '0.06em' }}>
              {col.kind === 'album' ? <Disc3 size={15} style={{ verticalAlign: -2 }} /> : <ListMusic size={15} style={{ verticalAlign: -2 }} />} {col.title}
            </b>
            {col.items && (
              <>
                <span className="muted">{trn(col.items.length, '{n} morceau', '{n} morceaux')}</span>
                <button
                  className="btn small"
                  onClick={() =>
                    void saveYtList(col.id, col.title, col.items!).then(() => toast({ kind: 'info', title: tr('Liste enregistrée'), text: tr('« {name} » est dans Listes.', { name: col.title }) }), (e) => toastError(e))
                  }
                >
                  <Bookmark size={14} /> {tr('Enregistrer')}
                </button>
                <button className="btn small primary" onClick={() => void playAll(col)}>
                  <Play size={14} /> {tr('Tout jouer')}
                </button>
              </>
            )}
          </div>
          {!col.items ? (
            <div className="analysing">
              <Loader2 className="spin" size={18} color="var(--cyan)" />
            </div>
          ) : (
            <div className="lib-list">{col.items.map((it, i) => songRow(it, i, () => void playAll(col, i)))}</div>
          )}
        </div>
      ) : items ? (
        <div className={`panel lib-panel ${busy ? 'busy' : ''}`}>
          {busy && !items.length ? (
            <div className="analysing">
              <Loader2 className="spin" size={18} color="var(--cyan)" />
            </div>
          ) : items.length === 0 ? (
            <p className="tip" style={{ padding: 12 }}>
              {tr('Aucun résultat.')}
            </p>
          ) : shownKind === 'album' || shownKind === 'playlist' ? (
            <div className="col-grid">
              {items.map((it) => (
                <button key={it.id} className="col-card" onClick={() => void openCollection({ kind: it.kind as 'album' | 'playlist', id: it.id, title: it.title, items: null })} onMouseEnter={() => playSfx('hover', 0.3)}>
                  <Cover src={it.thumbnail} size="lg" icon="disc" />
                  <b>{it.title}</b>
                  <small>{it.subtitle}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="lib-list">{items.map((it, i) => songRow(it, i, () => void openSong(it)))}</div>
          )}
        </div>
      ) : (
        !error && (
          <div className="panel pad" style={{ marginTop: 6 }}>
            <p className="tip" style={{ margin: 0 }}>
              {yt
                ? tr('Cherchez un morceau : sa première partie se joue en direct (notes écrites pendant l’écoute), ou laissez la station l’écouter une fois pour une partition complète.')
                : tr('Collez le lien d’une vidéo YouTube ou YouTube Music. Dans le navigateur, la station écoute le morceau par le partage de cet onglet ; la version bureau (Windows, Linux, macOS) n’a pas besoin de ce partage.')}
            </p>
          </div>
        )
      )}
    </div>
  );
}
