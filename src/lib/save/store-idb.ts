import type { Model } from '../model/types';
import type { Members } from './factories';

// The last imported save file and its factories' floors, kept in this browser so they can be read again without
// asking for the file. The file holds the player's name and account, so it never goes into a backup, a shared link,
// or anywhere off this device.
const DB = 'ficsit-planner-save';
const STORE = 'save';

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

/** A save factory's floor: its cards and belts, laid out the first time it is opened. */
export type KeptFloor = { model: Model; skipped: number; laid?: true };

/**
 * Keeps a save file, and its factories' floors with the buildings of each, in place of all kept before. Quiet:
 * without IndexedDB (some private windows) nothing is kept.
 */
export async function keepSave(file: File, factories?: { members: Members; floors: Map<string, KeptFloor> }): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    store.put(file, 'last');
    if (factories) {
      store.put(factories.members, 'members');
      for (const [id, floor] of factories.floors) store.put(floor, `floor:${id}`);
    }
    await finished(tx);
    db.close();
  } catch {}
}

async function read<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    const value = await new Promise<T | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  } catch {
    return undefined;
  }
}

/** The buildings of each factory at the last import. */
export const keptMembers = async (): Promise<Members> => (await read<Members>('members')) ?? {};

/** A save factory's floor as kept, or undefined when there is none (never imported, or IndexedDB is off). */
export const keptFloor = (id: string) => read<KeptFloor>(`floor:${id}`);

/** Keeps a save factory's floor once it has been laid out, so it opens at once next time. */
export async function keepFloor(id: string, floor: KeptFloor): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(floor, `floor:${id}`);
    await finished(tx);
    db.close();
  } catch {}
}

/** Deletes the kept save file and floors. */
export async function forgetSave(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {}
}
