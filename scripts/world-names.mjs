import fs from 'node:fs';

const FILE = 'src/data/world-names.json';

/** Adds layers to the game's actor names, keeping the ones the other extract script wrote. */
export function writeNames(layers) {
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  fs.writeFileSync(FILE, `${JSON.stringify({ ...old, ...layers })}\n`);
}
