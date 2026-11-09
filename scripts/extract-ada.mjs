// ADA's voice for the HUB milestones and the MAM researches, with the subtitles the game shows. Each Narrative message
// (FGMessage) names the schematics that trigger it, the Wwise event it plays and its subtitles with their times. The event's
// sound bank points at a Wwise Opus .wem (streamed from Media/, or kept inside the bank); it is decoded and stored as a small
// mono Opus .ogg in public/ada/. Needs the .NET SDK, ffmpeg and vgmstream-cli (https://github.com/vgmstream/vgmstream; give
// its path in VGMSTREAM). Also writes public/ada/logo.png and bubble.png (the ADA badge).
// Writes src/data/ada.json: { [schematic id]: [{ a: [file name without .ogg, ...], c: [[seconds, text, 0 for ADA | 1 other], ...] }] }
// Usage: VGMSTREAM=path/to/vgmstream-cli.exe bun scripts/extract-ada.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GAME = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const VGM = process.env.VGMSTREAM ?? 'vgmstream-cli';
const root = path.join(import.meta.dirname, '..');
const outDir = path.join(root, 'public', 'ada');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-ada-'));
const codex = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'codex.json'), 'utf8'));
const extractor = (...a) =>
  execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, ...a], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
const files = (q) =>
  extractor('list', q)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('FactoryGame/Content/'));

// The schematics with a page that shows the voice: the HUB's milestones and the MAM's researches.
const wantedIds = new Set(codex.schematics.filter((s) => ['hub', 'milestone', 'mam'].includes(s.type)).map((s) => s.id));

const list = path.join(TMP, 'list.txt');
const narrative = files('Narrative/').filter((f) => f.endsWith('.uasset'));
fs.writeFileSync(list, narrative.join('\n'));
const bulk = path.join(TMP, 'messages.json');
extractor('bulk', list, bulk);
const packages = JSON.parse(fs.readFileSync(bulk, 'utf8'));

const nameOf = (o) => o?.ObjectName?.replace(/.*'(.*)'/, '$1');
const events = new Map(); // event -> { chunks, ids: Set, from }
for (const [file, exports] of Object.entries(packages)) {
  // A pickup message only waits for the MAM to open; it is not about the schematic that opens it.
  if (/Pickup/i.test(file)) continue;
  const msg = exports.find((e) => e.Type === 'FGMessage')?.Properties;
  const event = msg?.mAudioEvent?.AssetPathName?.split('.').pop();
  if (!event) continue;
  const dep = exports.find((e) => e.Type === 'BP_SchematicPurchasedDependency_C');
  const ids = (dep?.Properties?.mSchematics ?? []).map(nameOf).filter((i) => wantedIds.has(i));
  if (!ids.length) continue;
  const chunks = (msg.mSubtitles ?? [])
    .map((s) => [
      Math.round(s.TimeStamp * 100) / 100,
      (s.Subtitle?.LocalizedString ?? '').replace(/\s+/g, ' ').trim(),
      /Aliens/.test(s.SenderClass?.ObjectName ?? '') ? 1 : 0,
    ])
    .filter((c) => c[1]);
  if (!chunks.length) continue;
  events.set(event, { chunks, ids, from: path.basename(file, '.uasset') });
}
if (!events.size) throw new Error('no ADA messages found');

// An event's sound bank is named after it.
const banks = new Map(
  files('WwiseAudio/Event')
    .filter((f) => f.endsWith('.bnk'))
    .map((f) => [path.basename(f, '.bnk'), f]),
);
const plan = [...events].flatMap(([event, e]) => {
  const bank = banks.get(event);
  if (!bank) {
    console.warn(`no bank for ${event} (${e.from})`);
    return [];
  }
  return [{ event, bank, ...e }];
});
fs.writeFileSync(list, plan.map((b) => b.bank).join('\n'));
extractor('rawmany', list, path.join(TMP, 'bnk'));

// A bank's sound objects (HIRC type 2) say which media they play; a short bank keeps the media inside (DIDX/DATA).
const sources = (file) => {
  const d = fs.readFileSync(file);
  const out = { media: [], inside: new Map() };
  let i = 0;
  while (i + 8 <= d.length) {
    const tag = d.toString('latin1', i, i + 4);
    const n = d.readUInt32LE(i + 4);
    if (tag === 'DIDX') {
      for (let p = i + 8; p < i + 8 + n; p += 12) out.inside.set(d.readUInt32LE(p), [d.readUInt32LE(p + 4), d.readUInt32LE(p + 8)]);
    }
    if (tag === 'DATA') out.data = d.subarray(i + 8, i + 8 + n);
    if (tag === 'HIRC') {
      let p = i + 12;
      for (let k = 0, c = d.readUInt32LE(i + 8); k < c; k++) {
        const size = d.readUInt32LE(p + 1);
        if (d[p] === 2) out.media.push(d.readUInt32LE(p + 14));
        p += 5 + size;
      }
    }
    i += 8 + n;
  }
  return out;
};
for (const b of plan) b.src = sources(path.join(TMP, 'bnk', path.basename(b.bank)));
// A streamed sound keeps only its first moments in the bank; the whole line is in Media/.
const need = new Set(plan.flatMap((b) => b.src.media));
fs.writeFileSync(
  list,
  files('WwiseAudio/Media')
    .filter((f) => need.has(Number(path.basename(f, '.wem'))))
    .join('\n'),
);
extractor('rawmany', list, path.join(TMP, 'wem'));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const done = new Map(); // event -> file names
for (const b of plan) {
  const names = [];
  b.src.media.forEach((m, k) => {
    const wem = path.join(TMP, 'wem', `${m}.wem`);
    if (!fs.existsSync(wem) && b.src.inside.has(m)) {
      const [from, len] = b.src.inside.get(m);
      fs.writeFileSync(wem, b.src.data.subarray(from, from + len));
    }
    if (!fs.existsSync(wem)) {
      console.warn(`no media ${m} for ${b.event}`);
      return;
    }
    const name = `${b.event.replace(/^Play_0?VO_|^VO_/, '')}${k ? `-${k}` : ''}`;
    execFileSync(VGM, ['-o', path.join(TMP, `${name}.wav`), wem], { stdio: 'ignore' });
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(TMP, `${name}.wav`),
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      '20k',
      '-application',
      'voip',
      path.join(outDir, `${name}.ogg`),
    ]);
    names.push(name);
  });
  if (names.length) done.set(b.event, names);
  if (names.length > 1) console.warn(`${b.event} has ${names.length} sounds`);
}

const result = {};
for (const b of plan.sort((x, y) => x.from.localeCompare(y.from))) {
  const a = done.get(b.event);
  if (!a) continue;
  for (const id of b.ids) result[id] = [...(result[id] ?? []), { a, c: b.chunks }];
}
fs.writeFileSync(path.join(root, 'src', 'data', 'ada.json'), `${JSON.stringify(result)}\n`);

// The badge the game shows beside ADA's words: the logo and the speech bubble that goes over its D.
extractor(
  'tex',
  path.join(TMP, 'logo'),
  'FactoryGame/Content/FactoryGame/Interface/UI/Message/TXUI_ADALogo.uasset',
  'FactoryGame/Content/FactoryGame/Interface/UI/Message/TXUI_ADALogo_SpeechBubble.uasset',
);
fs.copyFileSync(path.join(TMP, 'logo', 'TXUI_ADALogo.png'), path.join(outDir, 'logo.png'));
// The speech bubble with its check mark: the game draws it over the logo's D.
fs.copyFileSync(path.join(TMP, 'logo', 'TXUI_ADALogo_SpeechBubble.png'), path.join(outDir, 'bubble.png'));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${[...done.values()].flat().length} sounds for ${Object.keys(result).length} schematics`);
