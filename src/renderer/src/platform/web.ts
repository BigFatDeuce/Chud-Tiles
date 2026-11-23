import type { TrackRef } from '@shared/types';
import type { Picked, Platform } from './types';
import { AUDIO_ACCEPT, isAudioName, refFromFile } from './meta';
import * as db from '../storage/db';
import { tr } from '../i18n';

// The browser: local files through the file picker or drag and drop. Where the File System Access
// API exists (Chrome, Edge), the file handles are kept so a song picked once can be replayed after
// a restart (the browser asks for permission again once per session).

const session = new Map<string, File>();

interface FsHandle {
  getFile(): Promise<File>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
};

function inputPick(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = AUDIO_ACCEPT;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    // cancelling the dialog: focus comes back without a change event
    window.addEventListener('focus', () => setTimeout(() => resolve([]), 800), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Remembers a file picked or dropped during this session. */
export function rememberFile(key: string, f: File): void {
  session.set(key, f);
}

export const webPlatform: Platform = {
  kind: 'web',
  os: 'web',
  version: __APP_VERSION__,
  // ?safe in the address: the browser keeps its own GPU choice, the game keeps its effects minimal
  safeMode: { on: new URLSearchParams(location.search).has('safe'), reason: 'asked' },
  restart(mode) {
    const u = new URL(location.href);
    if (mode === 'safe') u.searchParams.set('safe', '');
    else u.searchParams.delete('safe');
    location.href = u.toString();
  },
  caps: {
    youtube: 'link',
    liveAnalysis: typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'tab-capture' : 'none',
    adblock: false,
    ffmpeg: false,
    folders: false,
    chudMusic: false,
    windowControls: false,
  },
  async pickFiles(): Promise<Picked[]> {
    const w = window as PickerWindow;
    const out: Picked[] = [];
    if (w.showOpenFilePicker) {
      let handles: FsHandle[] = [];
      try {
        handles = await w.showOpenFilePicker({ multiple: true, types: [{ description: tr('Musique'), accept: { 'audio/*': AUDIO_ACCEPT.split(',').filter((x) => x.startsWith('.')) } }] });
      } catch {
        return [];
      }
      for (const h of handles) {
        const f = await h.getFile();
        if (!isAudioName(f.name) && !f.type.startsWith('audio/')) continue;
        const ref = await refFromFile(f);
        session.set(ref.key, f);
        await db.put('handles', h, ref.key).catch(() => undefined);
        out.push({ ref, file: f });
      }
      return out;
    }
    for (const f of await inputPick()) {
      const ref = await refFromFile(f);
      session.set(ref.key, f);
      out.push({ ref, file: f });
    }
    return out;
  },
  async readTrack(ref: TrackRef, file?: File): Promise<ArrayBuffer> {
    const f = file ?? session.get(ref.key);
    if (f) return f.arrayBuffer();
    const h = await db.get<FsHandle>('handles', ref.key);
    if (h) {
      if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') await h.requestPermission?.({ mode: 'read' });
      const got = await h.getFile();
      session.set(ref.key, got);
      return got.arrayBuffer();
    }
    throw new Error(tr('Fichier introuvable : choisissez-le à nouveau.'));
  },
  async canPlay(ref: TrackRef): Promise<boolean> {
    if (session.has(ref.key)) return true;
    return !!(await db.get('handles', ref.key).catch(() => undefined));
  },
  openExternal(url: string) {
    window.open(url, '_blank', 'noopener');
  },
};
