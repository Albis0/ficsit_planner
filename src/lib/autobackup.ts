import { buildExport, hasPlans, type ExportFile } from './backup';

const DB = 'ficsit-planner-backups';
const STORE = 'copies';
/** How many copies are kept; a new one pushes out the oldest. */
export const MAX_BACKUPS = 3;
/** A copy is taken at most this often. */
export const EVERY = 24 * 3600 * 1000;
/** After opening the app, the first check waits this long. */
const OPEN_WAIT = 60 * 1000;

export type Backup = { at: number; hash: string; factories: number; plants: number; file: ExportFile };

/** A short fingerprint of the plans and plants, to tell whether they changed since the last copy. */
export function fingerprint(file: Pick<ExportFile, 'plans' | 'power'>): string {
  const text = JSON.stringify([file.plans, file.power]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${text.length}`;
}

/** Whether a new copy is due: a day since the newest, and the plans differ from it. */
export function isDue(list: Pick<Backup, 'at' | 'hash'>[], now: number, hash: string): boolean {
  const last = list.reduce<Pick<Backup, 'at' | 'hash'> | undefined>((a, b) => (!a || b.at > a.at ? b : a), undefined);
  return !last || (now - last.at >= EVERY && last.hash !== hash);
}

/** The copies to throw away once `fresh` is added: everything past the newest MAX_BACKUPS. */
export function surplus(list: Pick<Backup, 'at'>[]): number[] {
  return list
    .map((b) => b.at)
    .sort((a, b) => b - a)
    .slice(MAX_BACKUPS);
}

let off = false;

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'at' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

/** The saved copies, newest first. Empty where the browser has no IndexedDB (private windows, some embeds). */
export async function listBackups(): Promise<Backup[]> {
  try {
    const db = await open();
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    const list = await new Promise<Backup[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Takes a copy if one is due. Quiet: any failure just means no copy this time. */
export async function backupNow(now = Date.now()): Promise<void> {
  if (off) return;
  try {
    const file = buildExport();
    if (!hasPlans(file)) return;
    const hash = fingerprint(file);
    const list = await listBackups();
    if (off || !isDue(list, now, hash)) return;
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ at: now, hash, factories: file.plans.length, plants: file.power.length, file } satisfies Backup);
    for (const at of surplus([...list, { at: now }])) store.delete(at);
    await done(tx);
    db.close();
  } catch {}
}

/** Deletes every saved copy, and stops new ones for the rest of this page's life (Delete everything reloads right after). */
export async function clearBackups(): Promise<void> {
  off = true;
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {}
}

/** Starts the quiet schedule: a check a minute after opening, and one when the page is left. */
let started = false;
export function startAutoBackup() {
  if (started || typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  started = true;
  setTimeout(() => void backupNow(), OPEN_WAIT);
  addEventListener('pagehide', () => void backupNow());
}
