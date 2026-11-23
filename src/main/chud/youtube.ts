import { Innertube } from 'youtubei.js';
import { app } from 'electron';
import type { YtItem, YtSearchKind } from '@shared/types';
import { lang, say } from '../i18n';

// Adapted from Chud Music (src/main/youtube.ts): YouTube Music's public catalogue through
// InnerTube (youtubei.js). No account, no cookies, no player or stream data: only metadata —
// titles, artists, durations, thumbnails. Playback always goes through YouTube's official
// embedded player (yt-player.ts). Everything is mapped here into Chud Tiles' own YtItem.

// youtubei.js node classes are loosely typed for our needs: read them through this shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;


let client: Promise<Innertube> | null = null;
function yt(): Promise<Innertube> {
  client ??= Innertube.create({ retrieve_player: false, lang: lang(), location: app.getLocaleCountryCode() || (lang() === 'fr' ? 'FR' : 'US') }).catch((e: unknown) => {
    client = null; // retry on the next call (offline at first try…)
    throw e;
  });
  return client;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|network/i.test(msg)) throw new Error(say('YouTube Music est injoignable : vérifiez la connexion.', 'YouTube Music cannot be reached: check the connection.'));
    throw new Error(say(`Réponse inattendue de YouTube Music (${msg.slice(0, 120)}).`, `Unexpected answer from YouTube Music (${msg.slice(0, 120)}).`));
  }
}

const text = (v: Node): string | null => (v == null ? null : typeof v === 'string' ? v : (v.text ?? null)) || null;

/** Largest thumbnail; YouTube Music image URLs are resized server-side: ask for 544 px. */
function cover(thumbs: Node): string | null {
  const list: Node[] = Array.isArray(thumbs) ? thumbs : (thumbs?.contents ?? []);
  if (!list.length) return null;
  const best = list.reduce((a: Node, b: Node) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
  const url: string = best.url ?? '';
  return url.replace(/=w\d+-h\d+/, '=w544-h544') || null;
}

const compact = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);

function song(s: Node, fallback: { artist?: string | null; album?: string | null; cover?: string | null } = {}): YtItem | null {
  const videoId: string | undefined = s.video_id ?? s.id;
  if (!videoId || typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId)) return null;
  const artists: Node[] = s.artists ?? s.authors ?? [];
  const artist = artists.length ? artists.map((a) => a.name).join(', ') : typeof s.author === 'string' ? s.author : (s.author?.name ?? fallback.artist ?? null);
  const album = s.album?.name ?? fallback.album ?? null;
  return {
    kind: s.item_type === 'video' ? 'video' : 'song',
    id: videoId,
    title: text(s.title) ?? say('Sans titre', 'Untitled'),
    subtitle: [artist, album].filter(Boolean).join(' · '),
    artist,
    album,
    duration: s.duration?.seconds ?? null,
    thumbnail: cover(s.thumbnail ?? s.thumbnails) ?? fallback.cover ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function collection(a: Node, kind: 'album' | 'playlist'): YtItem | null {
  if (!a?.id) return null;
  const artist = a.author?.name ?? a.artists?.[0]?.name ?? null;
  return { kind, id: a.id, title: text(a.title) ?? say('Sans titre', 'Untitled'), subtitle: text(a.subtitle) ?? artist ?? '', artist, duration: null, thumbnail: cover(a.thumbnail ?? a.thumbnails) };
}

export function search(query: string, kind: YtSearchKind = 'song'): Promise<YtItem[]> {
  return guard(async () => {
    const res = await (await yt()).music.search(query, { type: kind });
    const shelf = res.contents?.find((c: Node) => c.type === 'MusicShelf') as Node;
    const items: Node[] = shelf?.contents ?? [];
    if (kind === 'album' || kind === 'playlist') return compact(items.map((i) => collection(i, kind)));
    return compact(items.filter((i) => i.item_type === 'song' || i.item_type === 'video').map((i) => song(i)));
  });
}

export function suggestions(query: string): Promise<string[]> {
  return guard(async () => {
    const sections = await (await yt()).music.getSearchSuggestions(query);
    return sections
      .flatMap((s: Node) => s.contents ?? [])
      .filter((c: Node) => c.type === 'SearchSuggestion')
      .map((c: Node) => text(c.suggestion))
      .filter((x: string | null): x is string => !!x)
      .slice(0, 8);
  });
}

export function album(id: string): Promise<{ title: string; items: YtItem[] }> {
  return guard(async () => {
    const res: Node = await (await yt()).music.getAlbum(id);
    const h = res.header ?? {};
    const title = text(h.title) ?? 'Album';
    const fallback = { artist: text(h.strapline_text_one) ?? h.author?.name ?? null, album: title, cover: cover(h.thumbnail) };
    return { title, items: compact((res.contents ?? []).map((t: Node) => song(t, fallback))) };
  });
}

const songs = (items: Node[]) => compact(items.filter((i) => !i.item_type || i.item_type === 'song' || i.item_type === 'video').map((i) => song(i)));

export function playlist(id: string): Promise<{ title: string; items: YtItem[] }> {
  return guard(async () => {
    let page: Node = await (await yt()).music.getPlaylist(id);
    const title = text(page.header?.title) ?? 'Playlist YouTube';
    const items = songs(page.items ?? page.contents ?? []);
    // long playlists come in pages of ~100: read up to 500 tracks
    while (page.has_continuation && items.length < 500) {
      page = await page.getContinuation();
      items.push(...songs(page.items ?? page.contents?.contents ?? page.contents ?? []));
    }
    return { title, items };
  });
}

export function video(videoId: string): Promise<YtItem | null> {
  return guard(async () => {
    const panel: Node = await (await yt()).music.getUpNext(videoId, false);
    const items: Node[] = (panel.contents ?? []).map((c: Node) => (c.type === 'PlaylistPanelVideoWrapper' ? c.primary : c));
    const own = items.find((c: Node) => c?.video_id === videoId) ?? items[0];
    return own ? song(own) : null;
  });
}

/** YouTube Music's "radio" of a song: what plays next, chosen by YouTube Music. */
export function mix(videoId: string): Promise<YtItem[]> {
  return guard(async () => {
    const panel: Node = await (await yt()).music.getUpNext(videoId, true);
    const items: Node[] = (panel.contents ?? []).map((c: Node) => (c.type === 'PlaylistPanelVideoWrapper' ? c.primary : c)).filter((c: Node) => c?.type === 'PlaylistPanelVideo');
    return compact(items.map((i) => song(i)));
  });
}
