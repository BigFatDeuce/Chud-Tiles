// IndexedDB, the same on the desktop and in the browser. Stores:
//   kv        small values (profile, …)                       key → value
//   analyses  cached song analyses (redone when outdated)      track key → { version, analysis }
//   records   every finished run                               auto id, index by track
//   tracks    songs seen (library of picked files, recents)    track key → TrackRef
//   handles   file handles of picked files (browser only)      track key → FileSystemFileHandle
//   learned   YouTube listens (frames for the learning step)   video id → recording

const NAME = 'chud-tiles';
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('analyses')) db.createObjectStore('analyses');
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('track', 'trackKey');
        s.createIndex('time', 'playedAt');
      }
      if (!db.objectStoreNames.contains('tracks')) {
        const s = db.createObjectStore('tracks', { keyPath: 'key' });
        s.createIndex('lastPlayed', 'lastPlayed');
      }
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('learned')) db.createObjectStore('learned');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export type StoreName = 'kv' | 'analyses' | 'records' | 'tracks' | 'handles' | 'learned';

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function all<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function byIndex<T>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(key)) as Promise<T[]>;
}

export async function clear(store: StoreName): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}

/** Approximate size of the stored data (settings screen). */
export async function usage(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage ?? null;
  } catch {
    return null;
  }
}
