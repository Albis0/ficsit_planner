// Opens every screen the app has at several window sizes and reports what's wrong on each: text running out of
// its card, things off the window, text over text, cards over cards, broken words, missing pictures, errors.
//
//   bun run sweep                      everything, every size (builds first)
//   bun run sweep -- --quick           a sample of each part, for CI
//   bun run sweep -- --sizes=phone --only=codex
//   node e2e/sweep.mjs --browser=webkit    Safari's engine (or firefox); install it first with
//                                          node node_modules/playwright-core/cli.js install webkit firefox
//
// Writes e2e/out/sweep.json and e2e/out/sweep.md (or the --name given), and exits with 1 when it finds a problem that isn't listed in
// e2e/known.json (the ones looked at and left on purpose, each with why).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { preview } from 'vite';
import { inspectPage } from './checks.js';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const QUICK = process.argv.includes('--quick');
const OUT = path.resolve('e2e/out');
fs.mkdirSync(OUT, { recursive: true });

const SIZES = {
  wide: { viewport: { width: 1920, height: 1080 } },
  laptop: { viewport: { width: 1366, height: 768 } },
  tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  phone: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
  small: { viewport: { width: 360, height: 700 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
};
const sizes = arg('sizes', QUICK ? 'laptop,phone' : Object.keys(SIZES).join(',')).split(',');
const only = arg('only', 'factory,power,codex,settings,screens').split(',');

const game = JSON.parse(fs.readFileSync('src/data/gamedata.json', 'utf8'));
const codex = JSON.parse(fs.readFileSync('src/data/codex.json', 'utf8'));
const creatures = JSON.parse(fs.readFileSync('src/data/creatures.json', 'utf8'));
const made = new Set(game.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
const products = Object.keys(game.items).filter((id) => !game.items[id].raw && made.has(id));
const sample = (list, n) => (QUICK ? list.filter((_, i) => i % Math.ceil(list.length / n) === 0) : list);

// Saved state the app reads on start: straight into a factory, a plant or a setting, with no first-run question.
const saved = (state) => JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', ...state }, version: 3 });
const factory = (targets, extra = {}) =>
  saved({
    mode: 'factory',
    plans: [{ id: 'f1', name: 'Factory 1', targets: targets.map((item) => ({ item, rate: 10 })) }],
    active: 'f1',
    ...extra,
  });

// Not 4190: Safari refuses a few ports (ManageSieve's among them) as unsafe.
const server = arg('url') ? undefined : await preview({ preview: { port: 4173, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const URL = arg('url', 'http://127.0.0.1:4173/');
// Playwright's own Chromium (`node node_modules/playwright-core/cli.js install chromium`), started fresh for each size.
// Scrollbars stay on, since they take room from the layout like they do for a player.
// WebKit and Firefox are there to catch what only Safari (every browser on an iPhone) or Firefox get wrong.
const BROWSER = arg('browser', 'chromium');
const engine = { chromium, webkit, firefox }[BROWSER];
const launch = () => (BROWSER === 'chromium' ? chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }) : engine.launch());
let browser;

const found = [];
let screens = 0;

async function run(size) {
  const opts = SIZES[size];
  const touch = !!opts.hasTouch;
  // Phones have their own layout: one pane at a time, the bottom navigation and the menu under the three dots.
  const phone = opts.viewport.width <= 900;
  // Firefox has no phone mode; a touch screen at phone width is the closest it gets.
  const { isMobile, ...rest } = opts;
  // Outside Chromium the service worker stays off: leaving each page right after it opens cancels its downloads,
  // which WebKit and Firefox report as errors that a player never sees.
  const ctx = await browser.newContext({
    ...(BROWSER === 'firefox' ? rest : opts),
    reducedMotion: 'reduce',
    serviceWorkers: BROWSER === 'chromium' ? 'allow' : 'block',
  });
  const page = await ctx.newPage();
  let where = '';
  // While a page is being left for the next one, downloads still on their way get cancelled, and WebKit reports
  // that as an error from the page. A player leaving a page never sees it, so those don't count.
  let leaving = false;
  page.on('pageerror', (e) => !leaving && found.push({ size, where, kind: 'page-error', what: '', detail: e.message.slice(0, 200) }));
  page.on(
    'console',
    (m) => !leaving && m.type() === 'error' && found.push({ size, where, kind: 'console-error', what: '', detail: m.text().slice(0, 200) }),
  );
  page.on(
    'response',
    (r) => r.status() >= 400 && found.push({ size, where, kind: 'missing-file', what: '', detail: `${r.status()} ${r.url()}` }),
  );

  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  // One screen that fails to open is itself a finding; the sweep carries on with the next.
  const step = async (name, fn) => {
    if (process.env.SWEEP_LOG) console.log(`${size} · ${name}`);
    try {
      await fn();
    } catch (e) {
      found.push({ size, where: name, kind: 'screen-failed', what: '', detail: String(e.message).split('\n')[0].slice(0, 160) });
    }
  };
  const check = async (name) => {
    where = name;
    screens++;
    const list = await page.evaluate(inspectPage, { touch });
    for (const f of list) found.push({ size, where: name, ...f });
  };
  // Loads the app with this saved state and waits until the floor has settled.
  const open = async (state, hash = '') => {
    leaving = true;
    await page.goto('about:blank');
    leaving = false;
    await page.goto(URL);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem('ficsit-planner', s);
    }, state);
    await page.goto(URL + hash);
    await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 20000 });
    await page.waitForTimeout(700);
  };

  if (only.includes('factory')) {
    for (const item of sample(products, 12))
      await step(`factory ${item}`, async () => {
        await open(factory([item]));
        await check(`factory ${item}`);
      });
    // Two lines of the same pipe network with splitters drawn: crude oil, a leftover that is packaged, and plastic.
    await step('factory pipes with splitters', async () => {
      await open(
        saved({
          mode: 'factory',
          plans: [
            {
              id: 'f1',
              name: 'Factory 1',
              targets: [
                { item: 'Desc_Plastic_C', rate: 30 },
                { item: 'Desc_PackagedOilResidue_C', rate: 15 },
              ],
            },
          ],
          active: 'f1',
          settings: { autoSplitters: true },
        }),
      );
      await check('factory pipes with splitters');
    });
    for (const item of sample(products, 4).slice(0, QUICK ? 4 : 40))
      await step(`list ${item}`, async () => {
        await open(factory([item], { view: 'table' }));
        await check(`list ${item}`);
      });
    for (const item of sample(products, 4).slice(0, QUICK ? 4 : 40))
      await step(`transport ${item}`, async () => {
        await open(factory([item], { view: 'transport' }));
        await check(`transport ${item}`);
      });
    for (const item of sample(products, 4).slice(0, QUICK ? 4 : 40))
      await step(`inspector ${item}`, async () => {
        await open(factory([item]));
        const node = page.locator('.react-flow__node-machine').first();
        if (!(await node.count())) return;
        await node.dispatchEvent('click');
        await page.waitForTimeout(500);
        await check(`inspector ${item}`);
      });
    // The hand-built floor, made from the Auto one, and a machine on it picked.
    for (const item of sample(products, 4).slice(0, QUICK ? 4 : 40))
      await step(`manual ${item}`, async () => {
        await open(factory([item]));
        const button = page.locator('.floor-kind button >> nth=1');
        if (!(await button.count())) return;
        await button.click();
        await page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 30000 });
        await page.waitForTimeout(1200);
        await check(`manual ${item}`);
        const node = page.locator('.react-flow__node-part:has(.machine-node)').first();
        if (!(await node.count())) return;
        await node.dispatchEvent('click');
        await page.waitForTimeout(500);
        await check(`manual inspector ${item}`);
        // The chooser, from a right click on the floor and from a belt let go on it.
        await page.keyboard.press('Escape');
        await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 200 } });
        await page.waitForTimeout(300);
        await check(`manual chooser ${item}`);
        await page.keyboard.press('Escape');
        const end = page.locator('.react-flow__handle.port.out').first();
        const box = (await end.count()) ? await end.boundingBox() : null;
        if (!box) return;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 120, box.y + 60, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await check(`manual drop ${item}`);
        await page.keyboard.press('Escape');
      });
    // A floor built by hand from nothing.
    await step('manual empty', async () => {
      await open(saved({ mode: 'factory', plans: [{ id: 'f1', name: 'Factory 1', targets: [], floor: 'manual' }], active: 'f1' }));
      await check('manual empty');
    });
    // Every side panel tab, on the factory and next to it.
    for (const [tab, panel] of [
      ['targets', 'top'],
      ['recipes', 'top'],
      ['resources', 'top'],
      ['targets', 'left'],
      ['recipes', 'right'],
      ['resources', 'left'],
    ])
      await step(`panel ${tab} ${panel}`, async () => {
        await open(factory(['Desc_Motor_C', 'Desc_ModularFrameHeavy_C'], { tab, settings: { panel } }));
        if (phone) await page.click(`.mobile-nav button >> nth=${['targets', 'recipes', 'resources'].indexOf(tab)}`);
        await page.waitForTimeout(400);
        await check(`panel ${tab} ${panel}`);
      });
  }

  if (only.includes('power')) {
    const options = game.generators.flatMap((g) => (g.kind === 'fuel' ? g.fuels.map((f) => [g.id, f.item]) : [[g.id]]));
    for (const [generator, fuel] of sample(options, 5))
      for (const sizeBy of QUICK ? ['want'] : ['want', 'have', 'factories'])
        await step(`power ${generator} ${fuel ?? ''} ${sizeBy}`, async () => {
          const plant = { id: 'p', generator, ...(fuel ? { fuel } : {}), by: 'auto', amount: 1, clock: 1 };
          const have = fuel ? [{ item: fuel, rate: 100 }] : [];
          await open(
            saved({
              mode: 'power',
              plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
              active: 'f1',
              power: [{ id: 'pp', name: 'Plant', plants: [plant], sizeBy, have, want: 1000, factories: 'all' }],
              activePower: 'pp',
            }),
          );
          await check(`power ${generator} ${fuel ?? ''} ${sizeBy}`);
        });
  }

  if (only.includes('codex')) {
    const pages = [
      '',
      ...[
        'parts',
        'resources',
        'buildings',
        'vehicles',
        'equipment',
        'milestones',
        'research',
        'alternates',
        'shop',
        'world',
        'creatures',
        'guides',
      ].map((c) => `cat/${c}`),
      ...[
        'start',
        'elevator',
        'power',
        'overclock',
        'sloops',
        'nodes',
        'fuel',
        'oil',
        'nuclear',
        'transport',
        'alternates',
        'world',
        'sink',
        'crashsites',
      ].map((g) => `guide/${g}`),
      ...sample(Object.keys(codex.items), 12).map((id) => `item/${id}`),
      ...sample(Object.keys(codex.buildings), 8).map((id) => `building/${id}`),
      ...sample(Object.keys(codex.vehicles), 2).map((id) => `vehicle/${id}`),
      ...sample(
        codex.schematics.map((s) => s.id),
        8,
      ).map((id) => `schematic/${id}`),
      ...sample(
        creatures.creatures.map((c) => c.id),
        3,
      ).map((id) => `creature/${id}`),
    ];
    await step('codex', () => open(saved({ mode: 'codex' }), '#codex'));
    for (const p of pages)
      await step(`codex ${p || 'home'}`, async () => {
        await page.evaluate(
          (h) => {
            location.hash = h;
          },
          `#codex${p ? `/${p}` : ''}`,
        );
        await page.waitForTimeout(250);
        await check(`codex ${p || 'home'}`);
      });
  }

  if (only.includes('settings')) {
    // Typefaces and the biggest and smallest cards and text, on a real factory.
    const combos = [];
    for (const font of ['satisfactory', 'poppins', 'inter', 'rajdhani', 'barlow'])
      for (const [cardScale, textScale] of [
        [1, 1],
        [0.7, 1.5],
        [1.6, 0.8],
        [1.6, 1.5],
      ])
        combos.push({ font, cardScale, textScale });
    for (const uiScale of [0.85, 1.35]) combos.push({ uiScale }, { uiScale, panel: 'left' });
    for (const s of sample(combos, 4))
      await step(`settings ${JSON.stringify(s)}`, async () => {
        await open(factory(['Desc_ModularFrameHeavy_C', 'Desc_Computer_C'], { settings: s }));
        await check(`settings ${JSON.stringify(s)}`);
      });
  }

  if (only.includes('screens')) {
    // The first-run tier question, the empty floors, dialogs, menus, many tabs with long names, the map.
    await step('first-run tier question', async () => {
      leaving = true;
      await page.goto('about:blank');
      leaving = false;
      await page.goto(URL);
      await page.evaluate(() => localStorage.clear());
      await page.goto(URL);
      await page.waitForSelector('.tier-dialog');
      await check('first-run tier question');
    });
    await step('factory empty', async () => {
      await open(saved({ mode: 'factory' }));
      await check('factory empty');
      await page.fill('.quick-search', 'iron');
      await check('factory search');
    });
    await step('power empty', async () => {
      await open(saved({ mode: 'power' }));
      await check('power empty');
    });
    await step('fourteen tabs', async () => {
      const long = 'Heavy Modular Frame and Computer factory by the river';
      await open(
        saved({
          mode: 'factory',
          plans: Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, name: i % 3 ? `Factory ${i + 1}` : `${long} ${i}`, targets: [] })),
          active: 't7',
        }),
      );
      await check('fourteen tabs');
    });
    // Phones reach Settings and Feedback through the menu under the three dots; wider screens have them in the top bar.
    const openDialog = async (i) => {
      await open(factory(['Desc_Motor_C']));
      if (phone) {
        await page.click('.menu-button');
        await page.click(`.sheet-links button >> nth=${i}`);
      } else await page.click(`.topbar-controls .chrome-button >> nth=${i - 2}`);
      await page.waitForTimeout(400);
    };
    await step('settings dialog', async () => {
      await openDialog(0);
      const nav = page.locator('.settings-nav button');
      for (let i = 0; i < (await nav.count()); i++) {
        await nav.nth(i).click();
        await page.waitForTimeout(250);
        await check(`settings dialog ${i}`);
      }
    });
    await step('feedback', async () => {
      await openDialog(1);
      await check('feedback bug');
      await page.click('.report-dialog [role=radio] >> nth=1');
      await page.waitForTimeout(200);
      await check('feedback idea');
    });
    await step('menus', async () => {
      await open(factory(['Desc_Motor_C']));
      if (phone) {
        await page.click('.menu-button');
        await page.waitForTimeout(300);
        await check('phone menu');
      } else {
        await page.click('.tab-menu-button');
        await page.waitForTimeout(300);
        await check('tab menu');
        await page.keyboard.press('Escape');
        await page.click('.tier-button');
        await page.waitForTimeout(300);
        await check('tier dialog');
      }
    });
    // The map with every layer on.
    await step('map', async () => {
      await open(
        saved({
          mode: 'map',
          mapFilter: { hidden: [], purities: [0, 1, 2], layers: ['sloop', 'sphere', 'pod', 'slug1', 'slug2', 'slug3'] },
        }),
      );
      await page.waitForTimeout(1500);
      await check('map');
      if (phone) {
        await page.click('.mobile-nav button >> nth=0');
        await page.waitForTimeout(300);
        await check('map filter');
      }
    });
  }
  await ctx.close();
}

const known = fs.existsSync('e2e/known.json') ? JSON.parse(fs.readFileSync('e2e/known.json', 'utf8')) : [];
const isKnown = (f) =>
  known.some(
    (k) =>
      k.kind === f.kind &&
      (!k.what || f.what.includes(k.what)) &&
      (!k.where || f.where.includes(k.where)) &&
      (!k.detail || f.detail.includes(k.detail)),
  );

for (const size of sizes) {
  const t0 = performance.now();
  browser = await launch();
  await run(size);
  await browser.close();
  console.log(`${size}: ${Math.round((performance.now() - t0) / 1000)}s`);
}
await server?.close();

// One line per kind of problem and place it shows up, with how often and where.
const groups = new Map();
for (const f of found) {
  const key = `${f.kind}|${f.what}|${f.kind === 'missing-file' || f.kind.endsWith('error') ? f.detail : ''}|${isKnown(f)}`;
  const g = groups.get(key) ?? { kind: f.kind, what: f.what, count: 0, sizes: new Set(), examples: [], known: isKnown(f) };
  g.count++;
  g.sizes.add(f.size);
  if (g.examples.length < 3) g.examples.push(`${f.size} · ${f.where}: ${f.detail}`);
  groups.set(key, g);
}
const list = [...groups.values()].sort((a, b) => Number(a.known) - Number(b.known) || a.kind.localeCompare(b.kind) || b.count - a.count);
const name = arg('name', 'sweep');
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ screens, found }, null, 1));
const md = [
  `# Sweep: ${screens} screens, ${found.length} findings in ${list.length} groups`,
  '',
  ...list.map(
    (g) =>
      `- ${g.known ? '(known) ' : ''}**${g.kind}** ${g.what} ×${g.count} [${[...g.sizes].join(', ')}]\n  - ${g.examples.join('\n  - ')}`,
  ),
];
fs.writeFileSync(path.join(OUT, `${name}.md`), md.join('\n'));
const fresh = list.filter((g) => !g.known);
console.log(`${screens} screens, ${fresh.length} new problem groups, ${list.length - fresh.length} known. See e2e/out/${name}.md`);
process.exit(fresh.length ? 1 : 0);
