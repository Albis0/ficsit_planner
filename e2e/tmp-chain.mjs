import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { preview } from 'vite';
const OUT = path.resolve('e2e/out/tmp');
fs.mkdirSync(OUT, { recursive: true });
const model = {
  v: 1, calc: 'basic', seq: 20,
  nodes: [
    { id: '1', k: 'extract', extractor: 'Build_MinerMk2_C', item: 'Desc_OreIron_C', n: 2, x: 0, y: 0 },
    { id: '2', k: 'machine', recipe: 'Recipe_IngotIron_C', auto: true, x: 440, y: 0 },
    { id: '3', k: 'machine', recipe: 'Recipe_IronPlate_C', auto: true, x: 860, y: 0 },
  ],
  links: [{ id: '4', a: '1', ap: 0, b: '2', bp: 0 }, { id: '5', a: '2', ap: 0, b: '3', bp: 0 }],
};
const state = JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', mode: 'factory', settings: { beltMotion: false, motion: 'reduce' },
  plans: [{ id: 'f1', name: 'Factory 1', targets: [], floor: 'manual', model }], active: 'f1' }, version: 3 });
const server = await preview({ preview: { port: 4178, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4178/');
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('ficsit-planner', s); }, state);
await page.goto('http://127.0.0.1:4178/');
await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'chain.png') });
await page.click('.react-flow__node[data-id="2"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'chain-smelter.png') });
await page.click('.react-flow__node[data-id="1"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'chain-miner.png') });
console.log(await page.locator('.side').innerText());
await browser.close();
server.httpServer.close();
