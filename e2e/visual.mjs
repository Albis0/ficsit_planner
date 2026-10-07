// Takes pictures of the main screens and compares them with the ones saved in e2e/baseline, so a change that moves
// something by accident shows up even when nothing overlaps or runs out of its box.
//
//   node e2e/visual.mjs             compare (build first: bun run build)
//   node e2e/visual.mjs --update    save the screens that changed as the new baseline, after a change on purpose
//   node e2e/visual.mjs --only=codex
//
// Screens that changed are written to e2e/out/visual/ as <name>.before.png, <name>.after.png and <name>.diff.png
// (the new picture dimmed, with what changed in red), and the run exits with 1.
//
// The baseline is taken on Windows with Playwright's Chromium. Fonts render differently on Linux, so this runs on
// the development machine rather than in CI.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { preview } from 'vite';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const UPDATE = process.argv.includes('--update');
const only = arg('only', '');
const BASE = path.resolve('e2e/baseline');
const OUT = path.resolve('e2e/out/visual');
fs.mkdirSync(BASE, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/** A pixel counts as changed when a colour channel moves by more than this (anti-aliasing stays under it). */
const PIXEL = 40;
/** A screen counts as changed when more than this share of its pixels did. */
const SHARE = 0.001;

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
};

// Belts stand still and nothing animates, so two runs of the same screen give the same picture.
const still = { beltMotion: false, motion: 'reduce' };
const saved = (state) =>
  JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', ...state, settings: { ...still, ...state.settings } }, version: 3 });
const factory = (targets, extra = {}) =>
  saved({
    mode: 'factory',
    plans: [{ id: 'f1', name: 'Factory 1', targets: targets.map(([item, rate]) => ({ item, rate })) }],
    active: 'f1',
    ...extra,
  });
const plant = (generator, fuel, sizeBy = 'want') =>
  saved({
    mode: 'power',
    plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
    active: 'f1',
    power: [
      {
        id: 'pp',
        name: 'Coal plant',
        plants: [{ id: 'p', generator, fuel, by: 'auto', amount: 1, clock: 1 }],
        sizeBy,
        have: [],
        want: 1000,
        factories: 'all',
      },
    ],
    activePower: 'pp',
  });

/** Each screen: the saved state it opens with, an optional address, and what to do before the picture. */
const SCREENS = [
  { name: 'first-run', state: null },
  { name: 'factory-empty', state: saved({ mode: 'factory' }) },
  { name: 'factory-motor', state: factory([['Desc_Motor_C', 10]]) },
  {
    name: 'factory-computer-list',
    state: factory(
      [
        ['Desc_Computer_C', 5],
        ['Desc_ModularFrameHeavy_C', 2],
      ],
      { view: 'table' },
    ),
  },
  {
    name: 'factory-motor-transport',
    state: factory([['Desc_Motor_C', 10]], {
      view: 'transport',
      plans: [
        {
          id: 'f1',
          name: 'Factory 1',
          targets: [{ item: 'Desc_Motor_C', rate: 10 }],
          transport: { 'in:Desc_OreIron_C': { by: 'train', distance: 2000 }, 'out:Desc_Motor_C': { by: 'drone', distance: 3000 } },
        },
      ],
    }),
  },
  {
    name: 'inspector',
    state: factory([['Desc_Motor_C', 10]]),
    act: async (page) => {
      await page.locator('.react-flow__node-machine').first().dispatchEvent('click');
    },
  },
  {
    name: 'manual-motor',
    state: factory([['Desc_Motor_C', 10]]),
    act: async (page) => {
      await page.click('.floor-kind button >> nth=1');
      await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    name: 'manual-inspector',
    state: factory([['Desc_Motor_C', 10]]),
    act: async (page) => {
      await page.click('.floor-kind button >> nth=1');
      await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.locator('.react-flow__node-part:has(.machine-node)').first().dispatchEvent('click');
    },
  },
  {
    name: 'all-page',
    state: factory([['Desc_Motor_C', 10]], {
      plans: [
        { id: 'f1', name: 'Motors', targets: [{ item: 'Desc_Motor_C', rate: 10 }] },
        {
          id: 'f2',
          name: 'Plastic and rubber',
          targets: [
            { item: 'Desc_Plastic_C', rate: 60 },
            { item: 'Desc_Rubber_C', rate: 20 },
          ],
        },
      ],
      power: [
        {
          id: 'pp',
          name: 'Coal plant',
          plants: [{ id: 'p', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 1 }],
          sizeBy: 'factories',
          have: [],
          want: 1000,
          factories: 'all',
        },
      ],
      activePower: 'pp',
    }),
    act: async (page) => {
      await page.locator('.plan-all .plan-tab-name').click();
      await page.waitForFunction(() => document.querySelectorAll('.ov-note').length === 0, null, { timeout: 30000 });
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'manual-empty',
    state: saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [], floor: 'manual', model: { v: 1, calc: 'basic', nodes: [], links: [], seq: 1 } }],
      active: 'f1',
    }),
  },
  {
    name: 'manual-chooser',
    state: factory([['Desc_Motor_C', 10]]),
    act: async (page) => {
      await page.click('.floor-kind button >> nth=1');
      await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      // A right click on a laptop; a finger held on a phone.
      await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 200 } });
      await page.waitForTimeout(300);
      if (!(await page.locator('.chooser').count())) {
        const f = await page.locator('.react-flow__pane').boundingBox();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f.x + 30, y: f.y + 200 }] });
        await page.waitForTimeout(800);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.locator('.chooser input').fill('rotor');
    },
  },
  {
    name: 'recipes-panel',
    state: factory([['Desc_Motor_C', 10]], { tab: 'recipes' }),
    act: async (page, phone) => phone && page.click('.mobile-nav button >> nth=1'),
  },
  { name: 'power-empty', state: saved({ mode: 'power' }) },
  { name: 'power-coal', state: plant('Build_GeneratorCoal_C', 'Desc_Coal_C') },
  { name: 'codex-home', state: saved({ mode: 'codex' }), hash: '#codex' },
  { name: 'codex-motor', state: saved({ mode: 'codex' }), hash: '#codex/item/Desc_Motor_C' },
  { name: 'codex-constructor', state: saved({ mode: 'codex' }), hash: '#codex/building/Build_ConstructorMk1_C' },
  { name: 'codex-guide-overclock', state: saved({ mode: 'codex' }), hash: '#codex/guide/overclock' },
  { name: 'codex-guide-transport', state: saved({ mode: 'codex' }), hash: '#codex/guide/transport' },
  { name: 'map', state: saved({ mode: 'map' }), wait: 2500 },
  {
    name: 'settings',
    state: factory([['Desc_Motor_C', 10]]),
    act: async (page, phone) => {
      if (phone) {
        await page.click('.menu-button');
        await page.click('.sheet-links button >> nth=0');
      } else await page.click('.topbar-controls .chrome-button >> nth=-2');
    },
  },
];

const server = await preview({ preview: { port: 4174, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const URL = 'http://127.0.0.1:4174/';
const browser = await chromium.launch();

/** Share of pixels that differ, and a picture of where: the new one dimmed, changed pixels in red. */
async function compare(beforeFile, after) {
  const a = await sharp(beforeFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { share: 1, diff: undefined };
  const out = Buffer.alloc(b.data.length);
  let changed = 0;
  for (let i = 0; i < b.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > PIXEL) {
      changed++;
      out.set([255, 0, 0, 255], i);
    } else {
      const g = Math.round((b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3 / 3.5);
      out.set([g, g, g, 255], i);
    }
  }
  const diff = await sharp(out, { raw: { width: b.info.width, height: b.info.height, channels: 4 } })
    .png()
    .toBuffer();
  return { share: changed / (b.data.length / 4), diff };
}

const changed = [];
let taken = 0;
for (const [size, opts] of Object.entries(SIZES)) {
  const phone = !!opts.isMobile;
  const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  for (const s of SCREENS) {
    const name = `${s.name}.${size}`;
    if (only && !name.includes(only)) continue;
    await page.goto('about:blank');
    await page.goto(URL);
    await page.evaluate((state) => {
      localStorage.clear();
      if (state) localStorage.setItem('ficsit-planner', state);
    }, s.state);
    await page.goto(URL + (s.hash ?? ''));
    await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    if (s.act) await s.act(page, phone);
    await page.waitForTimeout(s.wait ?? 900);
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    taken++;
    const file = path.join(BASE, `${name}.png`);
    const save = () => sharp(shot).png({ compressionLevel: 9, palette: false }).toFile(file);
    if (!fs.existsSync(file)) {
      await save();
      continue;
    }
    const { share, diff } = await compare(file, shot);
    if (share <= SHARE) continue;
    // Updating keeps the pictures that didn't change, so the commit shows only the screens that did.
    if (UPDATE) {
      await save();
      changed.push({ name, share });
      continue;
    }
    changed.push({ name, share });
    fs.copyFileSync(file, path.join(OUT, `${name}.before.png`));
    fs.writeFileSync(path.join(OUT, `${name}.after.png`), shot);
    if (diff) fs.writeFileSync(path.join(OUT, `${name}.diff.png`), diff);
  }
  await ctx.close();
}
await browser.close();
await server.close();

if (UPDATE) console.log(`${changed.length} of ${taken} screens changed and saved as the new baseline in e2e/baseline.`);
else if (changed.length === 0) console.log(`${taken} screens, none changed.`);
else {
  for (const c of changed) console.log(`changed: ${c.name} (${(c.share * 100).toFixed(2)}% of pixels)`);
  console.log(`${changed.length} of ${taken} screens changed. Before, after and diff pictures are in e2e/out/visual.`);
}
process.exit(changed.length && !UPDATE ? 1 : 0);
