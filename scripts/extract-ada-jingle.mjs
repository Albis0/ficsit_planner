// ADA's notification chime (the game's Play_ADA_IncomingMessage_Jingle event) as a small Opus .ogg in public/ada/jingle.ogg.
// Same route as extract-ada.mjs: the event's sound bank names the media, which is decoded with vgmstream and ffmpeg.
// Usage: VGMSTREAM=path/to/vgmstream-cli.exe bun scripts/extract-ada-jingle.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GAME = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const VGM = process.env.VGMSTREAM ?? 'vgmstream-cli';
const EVENT = 'Play_ADA_IncomingMessage_Jingle';
const root = path.join(import.meta.dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-jingle-'));
const extractor = (...a) =>
  execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, ...a], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
const find = (q, ext) =>
  extractor('list', q)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('FactoryGame/Content/') && l.endsWith(ext));

const bank = find('WwiseAudio/Event', '.bnk').find((f) => path.basename(f, '.bnk') === EVENT);
if (!bank) throw new Error(`no bank for ${EVENT}`);
const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, bank);
extractor('rawmany', list, path.join(TMP, 'bnk'));

// The bank's sound objects (HIRC type 2) say which media play; a short bank keeps the media inside (DIDX/DATA).
const d = fs.readFileSync(path.join(TMP, 'bnk', path.basename(bank)));
const media = [];
const inside = new Map();
let data;
for (let i = 0; i + 8 <= d.length; ) {
  const tag = d.toString('latin1', i, i + 4);
  const n = d.readUInt32LE(i + 4);
  if (tag === 'DIDX')
    for (let p = i + 8; p < i + 8 + n; p += 12) inside.set(d.readUInt32LE(p), [d.readUInt32LE(p + 4), d.readUInt32LE(p + 8)]);
  if (tag === 'DATA') data = d.subarray(i + 8, i + 8 + n);
  if (tag === 'HIRC') {
    let p = i + 12;
    for (let k = 0, c = d.readUInt32LE(i + 8); k < c; k++) {
      const size = d.readUInt32LE(p + 1);
      if (d[p] === 2) media.push(d.readUInt32LE(p + 14));
      p += 5 + size;
    }
  }
  i += 8 + n;
}
console.log('media', media, 'inside', [...inside.keys()]);
fs.mkdirSync(path.join(TMP, 'wem'), { recursive: true });
const streamed = media.filter((m) => !inside.has(m));
if (streamed.length) {
  fs.writeFileSync(
    list,
    find('WwiseAudio/Media', '.wem')
      .filter((f) => streamed.includes(Number(path.basename(f, '.wem'))))
      .join('\n'),
  );
  extractor('rawmany', list, path.join(TMP, 'wem'));
}
// The event plays its sounds together (the chime and what rides under it), so they are mixed back into one.
const wavs = media.map((m) => {
  const wem = path.join(TMP, 'wem', `${m}.wem`);
  if (inside.has(m)) {
    const [from, len] = inside.get(m);
    fs.writeFileSync(wem, data.subarray(from, from + len));
  }
  if (!fs.existsSync(wem)) throw new Error(`no media ${m}`);
  const wav = path.join(TMP, `${m}.wav`);
  execFileSync(VGM, ['-o', wav, wem], { stdio: 'ignore' });
  return wav;
});
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  ...wavs.flatMap((w) => ['-i', w]),
  '-filter_complex',
  `amix=inputs=${wavs.length}:normalize=0,alimiter=limit=0.95`,
  '-c:a',
  'libopus',
  '-b:a',
  '48k',
  path.join(root, 'public', 'ada', 'jingle.ogg'),
]);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('public/ada/jingle.ogg written');
