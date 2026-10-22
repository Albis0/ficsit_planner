// Runs axe (the accessibility checker) on the main screens at a laptop and a phone size and reports what it finds:
// buttons with no name, text too faint on its background, controls a screen reader cannot tell apart, and so on.
//
//   bun run build && node e2e/a11y.mjs            the main screens, both sizes
//   node e2e/a11y.mjs --sizes=phone --url=http://127.0.0.1:4173/
//
// Writes e2e/out/a11y.md and exits with 1 on a serious or critical finding that e2e/known-a11y.json doesn't list
// (a rule id, with why it was left on purpose).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const OUT = path.resolve('e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const known = fs.existsSync('e2e/known-a11y.json') ? JSON.parse(fs.readFileSync('e2e/known-a11y.json', 'utf8')) : [];

const SIZES = {
  laptop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true },
};
const sizes = arg('sizes', 'laptop,phone').split(',');
const saved = (state) => JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', ...state }, version: 3 });
const plan = (more = {}) => ({
  id: 'f1',
  name: 'Factory 1',
  targets: [{ item: 'Desc_Motor_C', rate: 10 }],
  ...more,
});

const server = arg('url') ? undefined : await preview({ preview: { port: 4173, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const URL = arg('url', 'http://127.0.0.1:4173/');
const axe = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch();
const rows = [];

for (const size of sizes) {
  const ctx = await browser.newContext({ ...SIZES[size], reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const phone = SIZES[size].viewport.width <= 900;
  const open = async (state, hash = '') => {
    await page.goto('about:blank');
    await page.goto(URL);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem('ficsit-planner', s);
    }, state);
    await page.goto(URL + hash);
    await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 20000 });
    await page.waitForTimeout(700);
  };
  const scan = async (where) => {
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }));
    for (const v of result.violations)
      rows.push({
        size,
        where,
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodes.length,
        sample: v.nodes[0]?.target?.join(' ').slice(0, 120),
      });
  };
  const step = async (where, fn) => {
    try {
      await fn();
      await scan(where);
    } catch (e) {
      rows.push({ size, where, id: 'screen-failed', impact: 'critical', help: String(e.message).split('\n')[0].slice(0, 160), count: 1 });
    }
  };

  await step('factory (Auto)', () => open(saved({ mode: 'factory', plans: [plan()], active: 'f1' })));
  await step('factory (Manual)', async () => {
    await open(saved({ mode: 'factory', plans: [plan()], active: 'f1' }));
    await page.locator('.floor-kind button >> nth=1').click();
    await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 30000 });
    await page.waitForTimeout(1200);
  });
  await step('factory list', () => open(saved({ mode: 'factory', plans: [plan()], active: 'f1', view: 'table' })));
  await step('power planner', () =>
    open(
      saved({
        mode: 'power',
        plans: [plan()],
        active: 'f1',
        power: [
          {
            id: 'pp',
            name: 'Plant',
            plants: [{ id: 'p', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 1 }],
            sizeBy: 'want',
            have: [],
            want: 1000,
            factories: 'all',
          },
        ],
        activePower: 'pp',
      }),
    ),
  );
  await step('codex', () => open(saved({ mode: 'codex' }), '#codex'));
  await step('codex item', () => open(saved({ mode: 'codex' }), '#codex/item/Desc_IronPlate_C'));
  await step('first-run tier question', async () => {
    await page.goto('about:blank');
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.waitForSelector('.tier-dialog');
  });
  await step('settings dialog', async () => {
    await open(saved({ mode: 'factory', plans: [plan()], active: 'f1' }));
    if (phone) {
      await page.click('.menu-button');
      await page.click('.sheet-links button >> nth=0');
    } else await page.click('.topbar-controls .chrome-button >> nth=-2');
    await page.waitForSelector('.settings-nav button');
  });
  await ctx.close();
}
await browser.close();
await server?.close();

// One line a rule per screen kind: the same fault on every screen is one thing to fix.
const byRule = new Map();
for (const r of rows) {
  const e = byRule.get(r.id) ?? { ...r, screens: new Set(), total: 0 };
  e.screens.add(`${r.size} · ${r.where}`);
  e.total += r.count;
  byRule.set(r.id, e);
}
const list = [...byRule.values()].sort(
  (a, b) => ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impact),
);
const isKnown = (id) => known.some((k) => k.id === id);
const fresh = list.filter((r) => (r.impact === 'critical' || r.impact === 'serious') && !isKnown(r.id));
const md = [
  '# Accessibility (axe)',
  '',
  ...(list.length
    ? list.map(
        (r) =>
          `- **${r.id}** (${r.impact}${isKnown(r.id) ? ', known' : ''}): ${r.help}. ${r.total} places on ${r.screens.size} screens, e.g. \`${r.sample ?? ''}\` · ${[...r.screens][0]}`,
      )
    : ['Nothing found.']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'a11y.md'), md);
console.log(md);
if (fresh.length) {
  console.log(`${fresh.length} serious or critical rule(s) not in e2e/known-a11y.json: ${fresh.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
