import { tr, trn } from '../i18n';
import type { TrackRef } from '@shared/types';
import { platform } from '../platform';
import { isAudioName, refFromFile } from '../platform/meta';
import { rememberFile } from '../platform/web';
import { useLibrary } from '../store/library';
import { go } from '../store/nav';
import { toast, toastError } from '../store/toasts';

// Opening songs from anywhere in the interface: picker, drag and drop, library.

async function open(refs: { ref: TrackRef; file?: File }[]): Promise<void> {
  if (!refs.length) return;
  await useLibrary.getState().add(refs.map((r) => r.ref));
  for (const r of refs) if (r.file) rememberFile(r.ref.key, r.file);
  if (refs.length > 1) toast({ kind: 'info', title: trn(refs.length, '{n} morceau ajouté aux archives', '{n} morceaux ajoutés aux archives') });
  go({ id: 'song', track: refs[0].ref, file: refs[0].file });
}

export async function pickAndOpen(): Promise<void> {
  try {
    await open(await platform.pickFiles());
  } catch (e) {
    toastError(e, tr('Ouverture impossible'));
  }
}

/** Files dropped on the window. On the desktop they keep their path (replayable later). */
export async function openDropped(files: File[]): Promise<void> {
  // desktop: the main process reads the paths (folders too) and allows them for later plays
  const lib = platform.library;
  if (lib && window.ct?.pathOf(files[0]!)) {
    try {
      const refs = await lib.fromDrop(files);
      if (refs.length) return await open(refs.map((ref) => ({ ref })));
    } catch (e) {
      return toastError(e, tr('Ouverture impossible'));
    }
  }
  const audio = files.filter((f) => isAudioName(f.name) || f.type.startsWith('audio/'));
  if (!audio.length) {
    toast({ kind: 'error', title: tr('Aucun fichier audio'), text: tr('Formats acceptés : MP3, FLAC, WAV, OGG, OPUS, AAC, M4A, AIFF, WMA…') });
    return;
  }
  try {
    const out: { ref: TrackRef; file?: File }[] = [];
    for (const f of audio) {
      const ref = await refFromFile(f, 'pick');
      const path = window.ct?.pathOf(f);
      if (path) out.push({ ref: { ...ref, key: `local:${path}`, source: 'local', path }, file: f });
      else out.push({ ref, file: f });
    }
    await open(out);
  } catch (e) {
    toastError(e, tr('Ouverture impossible'));
  }
}

export function openTrack(t: TrackRef): void {
  go({ id: 'song', track: t });
}
