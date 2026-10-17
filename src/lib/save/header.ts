import { Reader, SaveError } from './reader';

/** What a save says about itself before its compressed body; enough to list it without opening it. */
export type SaveHeader = {
  headerVersion: number;
  saveVersion: number;
  /** The game build that wrote it (502094 is 1.2). */
  build: number;
  saveName: string;
  mapName: string;
  /** The name the player gave the game; all saves of one game share it. */
  sessionName: string;
  /** Tells two games with the same name apart. */
  sessionId: string;
  playSeconds: number;
  /** When it was saved, ms since 1970 (UTC). */
  savedAt: number;
  modded: boolean;
  creative: boolean;
  /** Byte where the compressed body starts. */
  bodyStart: number;
};

// .NET ticks (100 ns since year 1) at 1970-01-01.
const EPOCH_TICKS = 621355968000000000;

/** Reads the header at the start of a save; it needs only the first few kilobytes. */
export function readHeader(bytes: Uint8Array): SaveHeader {
  const r = new Reader(bytes);
  const headerVersion = r.i32();
  const saveVersion = r.i32();
  const build = r.i32();
  if (headerVersion < 0 || headerVersion > 100 || saveVersion < 0 || saveVersion > 1000) throw new SaveError('Not a Satisfactory save');
  const saveName = headerVersion >= 14 ? r.str() : '';
  const mapName = r.str();
  r.str(); // map options
  const sessionName = r.str();
  const playSeconds = r.i32();
  const savedAt = Math.round((r.i64() - EPOCH_TICKS) / 10000);
  r.u8(); // session visibility
  if (headerVersion >= 7) r.i32(); // editor object version
  let modded = false;
  if (headerVersion >= 8) {
    r.str(); // mod list, as JSON
    modded = r.i32() !== 0;
  }
  const sessionId = headerVersion >= 10 ? r.str() : '';
  if (headerVersion >= 11) r.i32(); // world partition
  if (headerVersion >= 12 && r.i32() === 1) r.skip(16); // checksum
  const creative = headerVersion >= 13 && r.i32() === 1;
  return {
    headerVersion,
    saveVersion,
    build,
    saveName,
    mapName,
    sessionName,
    sessionId,
    playSeconds,
    savedAt,
    modded,
    creative,
    bodyStart: r.pos,
  };
}
