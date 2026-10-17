import type { SaveHeader } from './header';
import { readSaveHeader } from './saveClient';

/** One save file and what its header says. */
export type Found = { file: File; header: SaveHeader };
/** One game (session) and its saves, newest first. */
export type Game = { key: string; name: string; saves: Found[] };

/** Whether a file is worth opening: a .sav, not the dedicated server's settings file, not a stub. */
export const isSaveFile = (f: Pick<File, 'name' | 'size'>) => /\.sav$/i.test(f.name) && !/^ServerManager/i.test(f.name) && f.size >= 10_000;

/** The game a save belongs to: its session id, or its name for saves without one. */
export const gameKey = (h: Pick<SaveHeader, 'sessionId' | 'sessionName'>) => h.sessionId || `name:${h.sessionName}`;

/** Saves grouped by game, the game saved to last first; each game's saves newest first, by the date inside the save. */
export function groupGames(found: Found[]): Game[] {
  const games = new Map<string, Game>();
  for (const f of found) {
    const key = gameKey(f.header);
    const g = games.get(key) ?? { key, name: f.header.sessionName || f.header.saveName, saves: [] };
    g.saves.push(f);
    games.set(key, g);
  }
  // File dates are no use: saves synced from the cloud all carry the day they were downloaded.
  for (const g of games.values()) g.saves.sort((a, b) => b.header.savedAt - a.header.savedAt);
  return [...games.values()].sort((a, b) => b.saves[0].header.savedAt - a.saves[0].header.savedAt);
}

/** Reads the header of every save among the files; files that are not saves are left out. */
export async function findSaves(files: File[]): Promise<Found[]> {
  const found = await Promise.all(
    files.filter(isSaveFile).map(async (file) => {
      const header = await readSaveHeader(file);
      return header ? { file, header } : undefined;
    }),
  );
  return found.filter((f) => !!f);
}

/** The files in a drop, with the folders in it opened all the way down. */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  // The entries have to be taken while the drop event lasts; the list empties after.
  const entries = [...dt.items].flatMap((i) => i.webkitGetAsEntry?.() ?? []);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // A folder comes in batches of up to 100 entries; an empty batch is the end.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const b of batch) await walk(b);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
