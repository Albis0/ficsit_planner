// Works out the Codex's production lines, recipe comparisons and fuel costs with the planner's solver and
// writes src/data/insights.json. Run it after the game data changes: bun scripts/codex-insights.ts
import fs from 'node:fs';
import path from 'node:path';
import loadHighs from 'highs';
import { buildInsights } from '../src/lib/insights';

const out = path.join(import.meta.dirname, '..', 'src', 'data', 'insights.json');
const insights = buildInsights(await loadHighs());
fs.writeFileSync(out, `${JSON.stringify(insights)}\n`);
console.log(`${Object.keys(insights.items).length} parts, ${insights.fuels.length} fuels -> ${path.relative(process.cwd(), out)}`);
