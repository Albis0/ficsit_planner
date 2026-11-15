import type { Members } from './factories';

// The last imported save file and the buildings of its factories, kept in this browser so they can be read again
// without asking for the file. The file holds the player's name and account, so it never goes into a backup, a shared link,
// or anywhere off this device.
const DB = 'ficsit-planner-save';
const STORE = 'save';

/** The world a player has before they make another. What was kept before worlds is filed under its plain keys, so it still resolves. */
export const FIRST_WORLD = 'main';
const key = (name: 'last' | 'members', world: string) => (world === FIRST_WORLD ? name : `${name}:${world}`);

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

/**
 * Keeps a world's save file, and the buildings of each of its factories, in place of all kept for it before. Quiet:
 * without IndexedDB (some private windows) nothing is kept.
 */
export async function keepSave(world: string, file: File, factories?: { members: Members }): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(key('last', world));
    store.delete(key('members', world));
    store.put(file, key('last', world));
    if (factories) store.put(factories.members, key('members', world));
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

/** The buildings of each factory at the world's last import. */
export const keptMembers = async (world: string): Promise<Members> => (await read<Members>(key('members', world))) ?? {};

/** Deletes a world's kept save file; without a world, every kept file. */
export async function forgetSave(world?: string): Promise<void> {
  try {
    if (world !== undefined) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key('last', world));
      tx.objectStore(STORE).delete(key('members', world));
      await finished(tx);
      db.close();
      return;
    }
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {}
}
