// The last imported save file, kept in this browser so later steps can read it again without asking for it.
// It holds the player's name and account, so it never goes into a backup, a shared link, or anywhere off this device.
const DB = 'ficsit-planner-save';
const STORE = 'save';

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Keeps a save file in place of the one kept before. Quiet: without IndexedDB (private windows) nothing is kept. */
export async function keepSave(file: File): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file, 'last');
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

/** Deletes the kept save file. */
export async function forgetSave(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {}
}
