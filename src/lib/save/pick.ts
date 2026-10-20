// What the import starts with, kept small for the top bar: which system the player is on, where its saves are,
// and the browser's file chooser. The import window itself loads only when it opens.

export type Os = 'windows' | 'mac' | 'linux' | 'ios' | 'android';

/** The system the page runs on, as far as the browser tells. An iPad asks to be taken for a Mac, but has touch. */
export function osOf(ua = navigator.userAgent, touch = navigator.maxTouchPoints ?? 0): Os {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1)) return 'ios';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'windows';
}

/** Phones have no game on them and no folder chooser: a save is copied over and picked as one file. */
export const isPhone = (os: Os) => os === 'ios' || os === 'android';

const WINDOWS = '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames';

/** Where the game keeps its saves: on Windows; under Steam's Proton on Linux; in a CrossOver bottle on a Mac. A phone shows the PC's. */
export const SAVE_PATHS: Record<Os, string> = {
  windows: WINDOWS,
  linux: '~/.steam/steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames',
  mac: '~/Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/AppData/Local/FactoryGame/Saved/SaveGames',
  ios: WINDOWS,
  android: WINDOWS,
};

/** The systems a game runs on, as the import window lists them. */
export const SYSTEMS = ['windows', 'mac', 'linux'] as const;
export const SYSTEM_NAME: Record<(typeof SYSTEMS)[number], string> = { windows: 'Windows', mac: 'Mac · CrossOver', linux: 'Linux · Steam' };

/** Puts the save folder's path on the clipboard, for the chooser's address bar. False when the browser says no. */
export async function copySavePath(os = osOf()): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(SAVE_PATHS[os]);
    return true;
  } catch {
    return false;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "today 18:42", or "3 Oct 22:10" for any other day, in local time. */
export function savedWhen(ms: number, today: string) {
  const d = new Date(ms);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? `${today} ${time}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** A save's own name; saves from 1.0 have none, so their file name without .sav. */
export const saveTitle = (f: { file: { name: string }; header: { saveName: string } }) =>
  f.header.saveName || f.file.name.replace(/\.sav$/i, '');

/** Files handed over by a chooser opened outside the import window (Refresh), for the window to start from; it clears them on closing. */
let pending: File[] | undefined;
export const handOver = (files: File[] | undefined) => {
  pending = files;
};
export const handedOver = () => pending;

/**
 * Opens the browser's chooser for a folder (every save in it, all the way down) or one file. Has to run straight
 * from a click: browsers open choosers only then.
 */
export function chooseSaves(folder: boolean, then: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  if (folder) input.webkitdirectory = true;
  // A phone greys out files of a type it doesn't know, and it knows no .sav.
  else if (!isPhone(osOf())) input.accept = '.sav';
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', () => {
    then([...(input.files ?? [])]);
    input.remove();
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}
