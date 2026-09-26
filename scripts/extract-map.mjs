// The world map: the game's own map picture cut into tiles, and every resource node, well and geyser on it.
// Needs the game installed (the map and the level come out of its archives) and the .NET SDK.
// Usage: bun scripts/extract-map.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const GAME = process.argv[2] ?? 'C:/Program Files/Epic Games/Satisfactory';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-map-'));
const TILES = 'public/map';
/** The map picture spans this square of the world, in game units (cm): x west to east, y north to south. */
const BOUNDS = { x0: -324698.832, x1: 425301.168, y0: -375000, y1: 375000 };
const SIZE = 8192;
const SLICES = 'FactoryGame/Content/FactoryGame/Interface/UI/Assets/MapTest/SlicedMap';

const extractor = (...args) =>
  execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

// The map comes as four 4096 px slices named column-row.
extractor('tex', TMP, ...['0-0', '0-1', '1-0', '1-1'].map((s) => `${SLICES}/Map_${s}`));
const full = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#000' } })
  .composite(
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ].map(([c, r]) => ({ input: path.join(TMP, `Map_${c}-${r}.png`), left: c * 4096, top: r * 4096 })),
  )
  .png()
  .toBuffer();

// Tiles in z/x/y.webp, 256 px, zoom 0 (the whole map in one tile) to 5 (the picture at full size).
fs.rmSync(TILES, { recursive: true, force: true });
let files = 0;
let bytes = 0;
for (let z = 0; z <= 5; z++) {
  const side = 256 * 2 ** z;
  const level = await sharp(full).resize(side, side, { kernel: 'lanczos3' }).png().toBuffer();
  for (let x = 0; x < 2 ** z; x++) {
    fs.mkdirSync(`${TILES}/${z}/${x}`, { recursive: true });
    for (let y = 0; y < 2 ** z; y++) {
      const out = `${TILES}/${z}/${x}/${y}.webp`;
      await sharp(level)
        .extract({ left: x * 256, top: y * 256, width: 256, height: 256 })
        .webp({ quality: 78, effort: 6 })
        .toFile(out);
      files++;
      bytes += fs.statSync(out).size;
    }
  }
}
console.log(`tiles: ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);

// Nodes: kind, resource, purity 0 impure / 1 normal / 2 pure, and where on the picture (0..8192 px).
extractor('nodes', path.join(TMP, 'nodes.json'));
const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'nodes.json'), 'utf8'));
const PURITY = { RP_Inpure: 0, RP_Normal: 1, RP_Pure: 2 };
const px = (v, lo, hi) => Math.round(((v - lo) / (hi - lo)) * SIZE * 10) / 10;
const cores = raw.filter((n) => n.kind === 'core').map((n) => n.id);
const nodes = raw
  .filter((n) => n.kind !== 'core')
  .map((n) => ({
    kind: n.kind,
    item: n.resource,
    purity: PURITY[n.purity] ?? 1,
    x: px(n.x, BOUNDS.x0, BOUNDS.x1),
    y: px(n.y, BOUNDS.y0, BOUNDS.y1),
    ...(n.core ? { well: cores.indexOf(n.core) } : {}),
  }))
  .sort((a, b) => a.item.localeCompare(b.item) || b.purity - a.purity || a.x - b.x);
const wells = raw
  .filter((n) => n.kind === 'core')
  .map((n) => ({ item: n.resource, x: px(n.x, BOUNDS.x0, BOUNDS.x1), y: px(n.y, BOUNDS.y0, BOUNDS.y1) }));
fs.writeFileSync('src/data/world.json', `${JSON.stringify({ size: SIZE, bounds: BOUNDS, nodes, wells })}\n`);
console.log(`nodes: ${nodes.length}, well cores: ${wells.length}`);
fs.rmSync(TMP, { recursive: true, force: true });
