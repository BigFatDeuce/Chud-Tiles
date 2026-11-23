import type { TrackRef } from '@shared/types';

// Tags of a picked or dropped file (title, artist, album, duration, cover), read in the page with
// music-metadata's browser build. The cover is shrunk to a small JPEG data URL so it can be
// stored with the track and survive a restart.

import { AUDIO_EXTENSIONS, isAudioName } from '@shared/audio';

export { AUDIO_EXTENSIONS, isAudioName };
export const AUDIO_ACCEPT = AUDIO_EXTENSIONS.map((e) => '.' + e).join(',') + ',audio/*';

export function fileKey(f: File): string {
  return `file:${f.name}:${f.size}:${f.lastModified}`;
}

function titleFromName(name: string): { title: string; artist: string | null } {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  // "Artist - Title" is the most common naming
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base, artist: null };
}

async function shrinkCover(data: Uint8Array, format: string): Promise<string | null> {
  try {
    const blob = new Blob([data as BlobPart], { type: format || 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

export async function refFromFile(f: File, origin: TrackRef['origin'] = 'pick'): Promise<TrackRef> {
  const guess = titleFromName(f.name);
  const ref: TrackRef = { key: fileKey(f), source: 'file', title: guess.title, artist: guess.artist, album: null, duration: null, size: f.size, mtime: f.lastModified, origin };
  try {
    const { parseBlob } = await import('music-metadata');
    const m = await parseBlob(f, { duration: false, skipCovers: false });
    if (m.common.title) ref.title = m.common.title;
    if (m.common.artist) ref.artist = m.common.artist;
    if (m.common.album) ref.album = m.common.album;
    if (m.format.duration) ref.duration = m.format.duration;
    const pic = m.common.picture?.[0];
    if (pic) ref.cover = await shrinkCover(pic.data, pic.format);
  } catch {
    // unreadable tags: the file name is enough
  }
  return ref;
}
