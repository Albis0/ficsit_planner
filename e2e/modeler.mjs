// Goes through the hand-built floor the way a player would, step by step, and checks each step both on screen and in
// the saved model: turning a worked-out factory into a manual one, moving cards, laying and removing belts, the
// panels, undo, the build menu, open ends, tidying up, and the same on a phone with taps.
//
//   bun run build && node e2e/modeler.mjs
//
// Pictures of each step go to e2e/out/modeler/, the results to e2e/out/modeler.md. Exits with 1 when a step fails.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const OUT = path.resolve('e2e/out/modeler');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const still = { beltMotion: false, motion: 'reduce' };
const saved = (state) =>
  JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', ...state, settings: { ...still, ...state.settings } }, version: 3 });
const factory = (targets, extra = {}) =>
  saved({
    mode: 'factory',
    plans: [{ id: 'f1', name: 'Factory 1', targets: targets.map(([item, rate]) => ({ item, rate })), ...extra }],
    active: 'f1',
  });
const blank = saved({ mode: 'factory', plans: [{ id: 'f1', name: 'Factory 1', targets: [] }], active: 'f1' });

const server = await preview({ preview: { port: 4177, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const URL = 'http://127.0.0.1:4177/';
const browser = await chromium.launch();

const results = [];
let section = '';
let page;
let shots = 0;
const errors = [];

function ok(step, pass, info = '') {
  results.push({ section, step, pass: !!pass, info });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${section} ${step}${info ? ` — ${info}` : ''}`);
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++shots).padStart(2, '0')}-${name}.png`) });
const wait = (ms = 400) => page.waitForTimeout(ms);
const model = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].model);
const card = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
const end = (id, h) => page.locator(`.react-flow__handle[data-nodeid="${id}"][data-handleid="${h}"]`);
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : undefined;
};
const viewport = () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
const fit = async () => {
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
};
const settle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 20000 }).then(() => wait(300));

async function open(state) {
  await page.goto(URL);
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('ficsit-planner', s);
  }, state);
  await page.goto(URL);
  await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
  await wait(500);
}

async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await wait(300);
}

/** An empty spot on the floor: no card, belt, label or button under it. */
async function emptySpot(prefer = 'right') {
  return page.evaluate((prefer) => {
    const floor = document.querySelector('.react-flow').getBoundingClientRect();
    const xs = [];
    for (let x = floor.left + 60; x < floor.right - 60; x += 30) xs.push(x);
    if (prefer === 'right') xs.reverse();
    for (const x of xs)
      for (let y = floor.top + 120; y < floor.bottom - 110; y += 30) {
        const el = document.elementFromPoint(x, y);
        if (el?.classList.contains('react-flow__pane')) {
          // Room around it too.
          const clear = [-40, 40].every(
            (d) =>
              document.elementFromPoint(x + d, y)?.classList.contains('react-flow__pane') &&
              document.elementFromPoint(x, y + d)?.classList.contains('react-flow__pane'),
          );
          if (clear) return { x, y };
        }
      }
    return null;
  }, prefer);
}

/** Cards drawn on top of each other. */
const overlaps = () =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.dataset.id, r: n.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r;
        const b = boxes[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
          hits.push(`${boxes[i].id}/${boxes[j].id}`);
      }
    return hits;
  });

/** Two boxes on screen drawn over each other. */
const clash = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ───────────────────────────── Laptop ─────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  // ── A1: Auto to Manual ──
  section = 'A1';
  await open(factory([['Desc_Motor_C', 10]]));
  await page.click('.deck-toggle');
  await wait(600);
  const autoRaw = await page.$$eval('.readout.wide input', (l) => l.map((i) => i.value));
  const autoMachines = await page.locator('.readout-value').nth(1).innerText();
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await wait(800);
  await shot('a1-manual');
  let m = await model();
  ok('model made', m && m.nodes.length > 10, `${m?.nodes.length} cards, ${m?.links.length} belts`);
  ok(
    'every belt has a route',
    m.links.every((l) => l.pts?.length),
    `${m.links.filter((l) => !l.pts?.length).length} without`,
  );
  ok(
    'whole machine counts',
    m.nodes.filter((n) => n.k === 'machine').every((n) => Number.isInteger(n.n ?? 1)),
  );
  ok(
    'splitters and mergers',
    m.nodes.some((n) => n.k === 'logistic'),
  );
  const manualRaw = await page.$$eval('.readout.wide input', (l) => l.map((i) => i.value));
  ok('same raw input as Auto', JSON.stringify(manualRaw) === JSON.stringify(autoRaw), `${autoRaw} / ${manualRaw}`);
  ok('same machine count', (await page.locator('.readout-value').nth(1).innerText()) === autoMachines);
  const states = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok('every machine at full speed', states.length > 0 && states.every((s) => s === 'Full speed'), [...new Set(states)].join(', '));
  ok('no cards on top of each other', (await overlaps()).length === 0, (await overlaps()).join(' '));
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(600);
  await shot('a1-fit');
  ok('no cards on top of each other after Fit', (await overlaps()).length === 0, (await overlaps()).join(' '));

  // ── A2: moving ──
  section = 'A2';
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  m = await model();
  const mover = m.nodes.find((n) => n.k === 'machine');
  const before = { x: mover.x, y: mover.y };
  const c0 = await centre(card(mover.id).locator('.machine-strip'));
  await drag(c0, { x: c0.x + 60, y: c0.y + 90 });
  m = await model();
  let moved = m.nodes.find((n) => n.id === mover.id);
  ok('card moved', moved.x !== before.x || moved.y !== before.y, `${before.x},${before.y} → ${moved.x},${moved.y}`);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'));
  await wait(600);
  m = await model();
  moved = m.nodes.find((n) => n.id === mover.id);
  ok('stays after reload', moved.x !== before.x || moved.y !== before.y);
  const t0 = await viewport();
  const spot = await emptySpot('left');
  await drag(spot, { x: spot.x + 120, y: spot.y + 40 });
  ok('dragging the empty floor pans', (await viewport()) !== t0);
  ok('panning moved no card', JSON.stringify((await model()).nodes) === JSON.stringify(m.nodes));
  await fit();
  const fl = await page.locator('.react-flow').boundingBox();
  await page.keyboard.down('Shift');
  await drag({ x: fl.x + 30, y: fl.y + 80 }, { x: fl.x + fl.width / 2, y: fl.y + fl.height - 90 });
  await page.keyboard.up('Shift');
  const boxed = await page.locator('.react-flow__node.selected').count();
  ok('Shift + drag picks cards in a box', boxed > 0, `${boxed} picked`);
  await page.keyboard.press('Escape');

  // ── A3: clicking ──
  section = 'A3';
  m = await model();
  const smelter = m.nodes.find((n) => n.k === 'machine' && n.recipe === 'Recipe_IngotIron_C') ?? m.nodes.find((n) => n.k === 'machine');
  await fit();
  await card(smelter.id).locator('.machine-strip').click();
  await wait();
  ok('one click opens the panel', await page.locator('aside.inspector').isVisible());
  ok('one click picks just that card', (await page.locator('.react-flow__node.selected').count()) === 1);
  await card(smelter.id).locator('.machine-strip').dblclick();
  await wait();
  const touching = m.links.filter((l) => l.a === smelter.id || l.b === smelter.id).map((l) => l.id);
  const lit = await page.$$eval('.react-flow__edge.selected', (l) => l.map((e) => e.dataset.id ?? e.getAttribute('data-id')));
  ok(
    'double click picks its belts',
    touching.length > 0 && touching.every((id) => lit.includes(id)) && lit.length === touching.length,
    `${lit.length}/${touching.length}`,
  );
  ok('double click picks no cards', (await page.locator('.react-flow__node.selected').count()) === 0);
  await shot('a3-belts');
  await page.keyboard.press('Escape');
  await wait();
  ok(
    'Escape lets go',
    (await page.locator('.react-flow__edge.selected').count()) === 0 && !(await page.locator('aside.inspector').count()),
  );
  await page.locator(`.react-flow__edge[data-id="${touching[0]}"] .belt-hit`).click({ force: true });
  await wait();
  ok('clicking a belt opens the belt panel', await page.locator('aside.inspector .mk-pick').isVisible());
  await page.keyboard.press('Escape');
  // Zoomed in, the label opens it too.
  await page.mouse.move(683, 450);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await wait(500);
  const label = page.locator('.edge-label');
  await shot('a3-zoom');
  ok('labels show up close in', (await label.count()) > 0);
  const inView = await page.evaluate(() => {
    const floor = document.querySelector('.react-flow').getBoundingClientRect();
    for (const l of document.querySelectorAll('.edge-label')) {
      const r = l.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (
        x > floor.left + 20 &&
        x < floor.right - 20 &&
        y > floor.top + 70 &&
        y < floor.bottom - 80 &&
        document.elementFromPoint(x, y)?.closest('.edge-label')
      )
        return { x, y };
    }
    return null;
  });
  ok('a label in view', !!inView);
  if (inView) {
    await page.mouse.click(inView.x, inView.y);
    await wait();
    ok('a belt label opens the belt panel', await page.locator('aside.inspector .mk-pick').isVisible());
  }
  await page.keyboard.press('Escape');

  // ── A4: machine panel ──
  section = 'A4';
  const cons = m.nodes.find((n) => n.k === 'machine' && n.recipe === 'Recipe_Rotor_C') ?? m.nodes.find((n) => n.k === 'machine');
  await fit();
  await card(cons.id).locator('.machine-strip').click();
  await wait();
  const count = page.locator('aside.inspector .stepper input');
  await count.click();
  await count.fill('8/3');
  await wait(500);
  m = await model();
  ok(
    'a count of 8/3',
    Math.abs((m.nodes.find((n) => n.id === cons.id).n ?? 1) - 8 / 3) < 1e-9,
    String(m.nodes.find((n) => n.id === cons.id).n),
  );
  const clockField = page.locator('aside.inspector .clock-control input.rate-input');
  await clockField.click();
  await clockField.fill('150');
  await wait(500);
  m = await model();
  ok('clock 150%', Math.abs((m.nodes.find((n) => n.id === cons.id).clock ?? 1) - 1.5) < 1e-9);
  ok(
    'card shows the clock as set: 2 × 150% + 1 × 100%',
    /2\s*×\s*150%/.test(await card(cons.id).innerText()) && /1\s*×\s*100%/.test(await card(cons.id).innerText()),
    (await card(cons.id).innerText()).replace(/\s+/g, ' '),
  );
  const sloop = page.locator('aside.inspector .sloop-slots button >> nth=1');
  if (await sloop.count()) {
    await sloop.click();
    await wait();
    m = await model();
    ok('one somersloop', m.nodes.find((n) => n.id === cons.id).sloops === 1);
  }
  await page.locator('aside.inspector .inspector-actions .text-button >> nth=0').click();
  await wait();
  m = await model();
  ok('mark as built', m.nodes.find((n) => n.id === cons.id).done === true && (await card(cons.id).locator('.done').count()) === 1);
  await page.locator('aside.inspector .inspector-actions .text-button >> nth=0').click();
  await wait();
  ok('and back', !(await model()).nodes.find((n) => n.id === cons.id).done);
  await shot('a4-machine');
  await page.keyboard.press('Escape');
  const miner = m.nodes.find((n) => n.k === 'extract');
  await fit();
  await card(miner.id).click();
  await wait();
  await page.locator('aside.inspector').getByRole('radio', { name: 'Pure', exact: true }).click();
  await wait();
  m = await model();
  ok('miner purity', m.nodes.find((n) => n.id === miner.id).purity === 'pure');
  await page.locator('aside.inspector').getByRole('radio', { name: 'Mk.1', exact: true }).first().click();
  await wait();
  m = await model();
  ok('miner Mk', m.nodes.find((n) => n.id === miner.id).extractor === 'Build_MinerMk1_C');
  await page.keyboard.press('Escape');

  // ── A5: belt panel, undo ──
  section = 'A5';
  await open(factory([['Desc_IronPlate_C', 60]]));
  await page.click('.deck-toggle');
  await page.click('.floor-kind button >> nth=1');
  await settle();
  m = await model();
  const plateBelt = m.links.find((l) => {
    const a = m.nodes.find((n) => n.id === l.a);
    return a?.k === 'extract';
  });
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  const labels = page.locator('.edge-label');
  ok('belt labels shown', (await labels.count()) > 0);
  await page.locator(`.react-flow__edge[data-id="${plateBelt.id}"] .belt-hit`).click({ force: true });
  await wait();
  const panelOpen = await page.locator('aside.inspector .mk-pick').isVisible();
  ok('clicking a belt opens it', panelOpen);
  await page.locator('aside.inspector .mk-pick button >> nth=0').click();
  await settle();
  m = await model();
  const b1 = m.links.find((l) => l.id === plateBelt.id);
  ok('belt Mk.1', b1.mk === 0);
  const ore = (await model()).nodes.find((n) => n.id === plateBelt.b);
  ok('a full Mk.1 belt is marked', (await page.locator('.edge-tier.full').count()) > 0);
  await page.locator('aside.inspector button[aria-label="One more"]').click();
  await settle();
  ok('two side by side', (await model()).links.find((l) => l.id === plateBelt.id).lanes === 2);
  const lim = page.locator('aside.inspector .inspector-row:has-text("Most it carries") input');
  await lim.click();
  await lim.fill('10');
  await settle();
  ok('a limit of 10', (await model()).links.find((l) => l.id === plateBelt.id).lim === 10);
  const rateText = await page.locator('aside.inspector .inspector-stats dd').first().innerText();
  ok('carries 10', rateText.startsWith('10'), rateText);
  ok('says the limit, not a full belt', (await page.locator('aside.inspector').innerText()).includes('At the limit'));
  await shot('a5-belt');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait();
  ok('Escape twice closes the panel from a field', !(await page.locator('aside.inspector').count()));
  await page.keyboard.press('Control+z');
  await settle();
  ok('undo takes the limit off', (await model()).links.find((l) => l.id === plateBelt.id).lim === undefined);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await settle();
  const back = (await model()).links.find((l) => l.id === plateBelt.id);
  ok('undo three times: back as it was', back.mk === plateBelt.mk && back.lanes === plateBelt.lanes, JSON.stringify(back));
  await page.keyboard.press('Control+y');
  await settle();
  ok('redo', (await model()).links.find((l) => l.id === plateBelt.id).mk === 0);
  void ore;

  // ── A6: laying belts ──
  section = 'A6';
  await page.keyboard.press('Control+z');
  await settle();
  m = await model();
  const victim = m.links.find((l) => m.nodes.find((n) => n.id === l.b)?.k === 'machine');
  await page.locator(`.react-flow__edge[data-id="${victim.id}"] .belt-hit`).click({ force: true });
  await wait();
  await page.keyboard.press('Delete');
  await settle();
  m = await model();
  ok('Delete takes a belt off', !m.links.some((l) => l.id === victim.id));
  ok('its ends turn open', (await end(victim.b, `i${victim.bp}`).getAttribute('class')).includes('open'));
  ok('the machine says why', (await card(victim.b).innerText()).includes('Input not connected'));
  await shot('a6-open');
  await drag(await centre(end(victim.a, `o${victim.ap}`)), await centre(end(victim.b, `i${victim.bp}`)));
  await settle();
  m = await model();
  ok(
    'drag lays it again',
    m.links.some((l) => l.a === victim.a && l.ap === victim.ap && l.b === victim.b && l.bp === victim.bp),
  );
  await page.keyboard.press('Control+z');
  await settle();
  await end(victim.a, `o${victim.ap}`).click();
  await wait(200);
  await end(victim.b, `i${victim.bp}`).click();
  await settle();
  m = await model();
  ok(
    'two clicks lay it too',
    m.links.some((l) => l.a === victim.a && l.b === victim.b),
  );
  ok('two clicks open no panel', !(await page.locator('aside.inspector').count()));

  // A wrong item: iron ingots into a miner can't be; iron ingots into something taking ore can't either.
  await open(
    factory([
      ['Desc_IronPlate_C', 30],
      ['Desc_Wire_C', 30],
    ]),
  );
  await page.click('.deck-toggle');
  await page.click('.floor-kind button >> nth=1');
  await settle();
  m = await model();
  const ironSmelter = m.nodes.find((n) => n.k === 'machine' && n.recipe === 'Recipe_IngotIron_C');
  const copperSmelter = m.nodes.find((n) => n.k === 'machine' && n.recipe === 'Recipe_IngotCopper_C');
  const linksBefore = m.links.length;
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(400);
  await drag(await centre(end(ironSmelter.id, 'o0')), await centre(end(copperSmelter.id, 'i0')));
  await settle();
  m = await model();
  ok(
    'a belt with the wrong item is refused',
    m.links.length === linksBefore && !m.links.some((l) => l.a === ironSmelter.id && l.b === copperSmelter.id),
  );

  // ── A7: states ──
  section = 'A7';
  const outBelt = m.links.find((l) => l.a === ironSmelter.id);
  await page.locator(`.react-flow__edge[data-id="${outBelt.id}"] .belt-hit`).click({ force: true });
  await page.keyboard.press('Delete');
  await settle();
  ok('an open output stops the machine', (await card(ironSmelter.id).innerText()).includes('Output not connected'));
  await page.locator('.model-drain input').check();
  await settle();
  ok(
    'counted as left over, it runs',
    (await card(ironSmelter.id).innerText()).includes('Full speed'),
    await card(ironSmelter.id).innerText(),
  );
  await shot('a7-drain');
  await page.locator('.model-toolbar .segmented button:has-text("Off")').click();
  await settle();
  ok(
    'Off: no numbers',
    !(await card(ironSmelter.id).locator('.run-state').count()) &&
      !(await page.locator('.edge-rate, .endpoint-rate, .machine-draw').count()),
  );
  await shot('a7-off');
  await page.locator('.model-toolbar .segmented button:has-text("Max flow")').click();
  await settle();
  ok('Max flow: numbers back', (await card(ironSmelter.id).locator('.run-state').count()) === 1);

  // ── A8: the other views, Auto and back, rebuild ──
  section = 'A8';
  m = await model();
  const camBefore = await viewport();
  await page.locator('.floor-bar .segmented:not(.floor-kind) button >> nth=1').click();
  await wait(600);
  const rows = await page.locator('.table-view tbody tr, .table tbody tr, table tbody tr').count();
  ok('the list shows the manual machines', rows >= m.nodes.filter((n) => n.k === 'machine').length, `${rows} rows`);
  await page.locator('.floor-bar .segmented:not(.floor-kind) button >> nth=2').click();
  await wait(600);
  ok('transport view opens', (await page.locator('.floor-view').innerText()).length > 0);
  await page.locator('.floor-bar .segmented:not(.floor-kind) button >> nth=0').click();
  await wait(600);
  ok('back on the floor, the camera where it was', (await viewport()) === camBefore);
  await page.click('.floor-kind button >> nth=0');
  await settle();
  await page.click('.floor-kind button >> nth=1');
  await settle();
  ok('Auto and back keeps the floor', JSON.stringify(await model()) === JSON.stringify(m));
  page.once('dialog', (d) => d.accept());
  await page.locator('.model-toolbar button:has-text("Rebuild from targets")').click();
  await settle();
  const rebuilt = await model();
  ok('rebuild asks, then starts again', rebuilt.links.some((l) => l.a === ironSmelter.id) || rebuilt.nodes.length > 0);
  ok('rebuilt: no open output left', !rebuilt.drain && (await page.locator('.open-ends').count()) === 0);

  // ── A9: share ──
  section = 'A9';
  await page.locator('.topbar .share-button').click();
  await wait(500);
  const link = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('share link made', link.includes('#share='), link.slice(0, 60));
  if (link.includes('#share=')) {
    const p2 = await ctx.newPage();
    await p2.goto('about:blank');
    await p2.goto(URL);
    await p2.evaluate(() => localStorage.clear());
    await p2.goto(link.replace(/^https?:\/\/[^/]+\//, URL));
    await p2.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 30000 });
    await p2.waitForTimeout(1500);
    const shared = await p2.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('ficsit-planner') ?? '{}').state;
      return s?.plans?.find((p) => p.model)?.model?.nodes.length ?? 0;
    });
    ok('the shared link brings the manual floor', shared === rebuilt.nodes.length, `${shared} of ${rebuilt.nodes.length}`);
    await p2.close();
  }

  // ── B: building by hand ──
  section = 'B1';
  await open(blank);
  await page.locator('.quick-head .text-button').click();
  await wait(600);
  ok('Build by hand opens an empty floor', (await page.locator('.floor-empty .primary-button').count()) === 1);
  await shot('b1-empty');

  section = 'B2';
  await page.locator('.floor-empty .primary-button').click();
  await wait(300);
  ok('Add a machine opens the menu', await page.locator('.chooser').isVisible());
  const chooserBox = await page.locator('.chooser').boundingBox();
  const toolbarBox = await page.locator('.model-toolbar').boundingBox();
  ok(
    'the menu is over the toolbar, not under it',
    await page.evaluate(() => {
      const c = document.querySelector('.chooser').getBoundingClientRect();
      const el = document.elementFromPoint(c.left + 20, c.top + 10);
      return !!el?.closest('.chooser');
    }),
    JSON.stringify({ chooserBox, toolbarBox }),
  );
  await page.keyboard.type('iron ingot');
  await wait(200);
  ok('search puts Iron Ingot first', (await page.locator('.chooser-list li').first().innerText()).startsWith('Iron Ingot'));
  await shot('b2-search');
  await page.keyboard.press('Enter');
  await settle();
  m = await model();
  ok('Enter adds the smelter', m.nodes.length === 1 && m.nodes[0].recipe === 'Recipe_IngotIron_C');
  ok('and opens its panel', await page.locator('aside.inspector').isVisible());
  const sm = m.nodes[0].id;
  await page.keyboard.press('Escape');
  let at = await emptySpot('left');
  await page.mouse.dblclick(at.x, at.y);
  await wait(300);
  ok('double click on the floor opens the menu', await page.locator('.chooser').isVisible());
  const near = await page.locator('.chooser').boundingBox();
  ok(
    'beside where it was clicked',
    Math.abs(near.x - at.x) < 480 && Math.abs(near.y - at.y) < 560,
    `${Math.round(near.x)},${Math.round(near.y)} vs ${at.x},${at.y}`,
  );
  await page.keyboard.press('Escape');
  await wait(200);
  ok('Escape closes it', !(await page.locator('.chooser').count()));
  at = await emptySpot('left');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await wait(300);
  ok('right click on the floor opens the menu', await page.locator('.chooser').isVisible());
  const menu = await page.locator('.chooser').boundingBox();
  await page.mouse.click(menu.x > 400 ? menu.x - 100 : menu.x + menu.width + 100, menu.y + 40);
  await wait(300);
  ok('a click outside closes it', !(await page.locator('.chooser').count()));
  await page.locator('.add-part').click();
  await wait(300);
  ok('+ Add opens it', await page.locator('.chooser').isVisible());
  await page.keyboard.press('Escape');

  section = 'B3';
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  at = await emptySpot('right');
  await drag(await centre(end(sm, 'o0')), at);
  await wait(300);
  ok('a belt let go on the floor opens the menu', await page.locator('.chooser').isVisible());
  ok('for what takes iron ingots', (await page.locator('.chooser input').getAttribute('placeholder')).includes('Iron Ingot'));
  const firstTwo = await page.locator('.chooser-list li .chooser-title').allInnerTexts();
  ok(
    'Iron Plate and Iron Rod first',
    firstTwo.slice(0, 3).some((x) => x.startsWith('Iron Plate')) && firstTwo.slice(0, 3).some((x) => x.startsWith('Iron Rod')),
    firstTwo.slice(0, 4).join(' | '),
  );
  await shot('b3-drop');
  await page.locator('.chooser-list li:has-text("Iron Plate")').first().dispatchEvent('mousedown');
  await settle();
  m = await model();
  const plate = m.nodes.find((n) => n.recipe === 'Recipe_IronPlate_C');
  ok('Iron Plate added', !!plate);
  ok(
    'joined to the smelter',
    m.links.some((l) => l.a === sm && l.b === plate?.id),
  );
  const pb = await card(plate.id).boundingBox();
  const ib = await page.locator('aside.inspector').boundingBox();
  ok('not under the panel', !clash(pb, ib), JSON.stringify({ pb, ib }));
  await shot('b3-joined');
  await page.keyboard.press('Escape');
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  at = await emptySpot('left');
  await drag(await centre(end(sm, 'i0')), at);
  await wait(300);
  const tabs = await page.locator('.chooser-tabs button').allInnerTexts();
  ok('an input wanting ore starts on Resources', tabs[0]?.startsWith('Resources'), tabs.join(' | '));
  await page.locator('.chooser-list li').first().dispatchEvent('mousedown');
  await settle();
  m = await model();
  const mine = m.nodes.find((n) => n.k === 'extract');
  ok('the miner added and joined', !!mine && m.links.some((l) => l.a === mine.id && l.b === sm));
  await page.keyboard.press('Escape');
  // A belt let go on a card's body goes onto its free end that fits.
  const rod = await page.evaluate(() => null);
  void rod;
  await page.locator('.add-part').click();
  await page.keyboard.type('Iron Rod');
  await page.keyboard.press('Enter');
  await settle();
  m = await model();
  const rodNode = m.nodes.find((n) => n.recipe === 'Recipe_IronRod_C');
  await page.keyboard.press('Escape');
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  // The smelter's output already feeds the plates: a splitter first, then from it onto the rod card's body.
  await page.locator('.add-part').click();
  await page.locator('.chooser-tabs button:has-text("Logistics")').click();
  await page.locator('.chooser-list li:has-text("Conveyor Splitter")').dispatchEvent('mousedown');
  await settle();
  m = await model();
  const split = m.nodes.find((n) => n.k === 'logistic');
  await page.keyboard.press('Escape');
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  await drag(await centre(end(sm, 'o0')), await centre(end(split.id, 'i0')));
  await settle();
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  await drag(await centre(end(split.id, 'o0')), await centre(card(rodNode.id).locator('.machine-body')));
  await settle();
  m = await model();
  ok(
    'a belt let go on a card body joins its end',
    m.links.some((l) => l.a === split.id && l.b === rodNode.id && l.bp === 0),
  );
  await drag(await centre(end(split.id, 'o1')), await centre(card(plate.id).locator('.machine-body')));
  await settle();
  m = await model();
  ok(
    'one belt per end: the new one replaces the old',
    m.links.filter((l) => l.b === plate.id && l.bp === 0).length === 1 && m.links.some((l) => l.a === split.id && l.b === plate.id),
  );
  await shot('b3-split');

  section = 'B4';
  const openText = await page
    .locator('.open-ends')
    .innerText()
    .catch(() => '');
  ok('open ends counted', /\d+ not connected/.test(openText), openText);
  ok('spare splitter output not marked', (await end(split.id, 'o2').getAttribute('class')).includes('free'));
  await page.locator('.open-ends').click();
  await wait(500);
  ok(
    'the button picks a card with an open end',
    (await page.locator('aside.inspector .run-state.bad').count()) > 0 ||
      (await page.locator('aside.inspector dd.run-state.bad').count()) > 0,
  );
  await page.keyboard.press('Escape');
  // An output on each open machine output.
  m = await model();
  for (const n of [plate, rodNode]) {
    await page.click('.floor-controls .floor-button >> nth=-1');
    await wait(400);
    at = await emptySpot('right');
    await drag(await centre(end(n.id, 'o0')), at);
    await wait(300);
    await page.locator('.chooser-tabs button:has-text("In and out")').click();
    await page.locator('.chooser-list li').first().dispatchEvent('mousedown');
    await settle();
    await page.keyboard.press('Escape');
  }
  ok('nothing left open', !(await page.locator('.open-ends').count()));
  const allStates = await page.$$eval('.react-flow__node .run-state', (l) => l.map((x) => x.textContent));
  ok(
    'everything runs',
    allStates.every((s) => s === 'Full speed' || s.startsWith('Runs at')),
    allStates.join(', '),
  );
  await shot('b4-done');

  section = 'B5';
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  const tb = await page.locator('.model-toolbar').boundingBox();
  const tops = await page.$$eval('.react-flow__node', (l) => l.map((n) => n.getBoundingClientRect().top));
  ok(
    'after Fit no card under the toolbar',
    tops.every((t) => t >= tb.y + tb.height - 2),
    `${Math.min(...tops)} vs ${tb.y + tb.height}`,
  );
  m = await model();
  const was = JSON.stringify(m.nodes.map((n) => [n.x, n.y]));
  await page.locator('.model-toolbar button:has-text("Tidy up")').click();
  await settle();
  await wait(500);
  ok('Tidy up lays it out afresh', JSON.stringify((await model()).nodes.map((n) => [n.x, n.y])) !== was);
  ok('no cards on top of each other', (await overlaps()).length === 0);
  await shot('b5-tidy');
  await page.keyboard.press('Control+z');
  await settle();
  ok('undo puts them back', JSON.stringify((await model()).nodes.map((n) => [n.x, n.y])) === was);

  // ── Big factories: laid out cleanly ──
  section = 'big';
  for (const [item, rate] of [
    ['Desc_ComputerSuper_C', 5],
    ['Desc_MotorLightweight_C', 2],
    ['Desc_SpaceElevatorPart_9_C', 2],
  ]) {
    await open(factory([[item, rate]]));
    await page.click('.deck-toggle');
    await page.click('.floor-kind button >> nth=1');
    await settle();
    await wait(600);
    const mm = await model();
    const tag = item.replace(/^Desc_|_C$/g, '');
    await shot(`big-${tag}-open`);
    ok(
      `${tag}: opens on cards`,
      (await page.$$eval(
        '.react-flow__node',
        (l) =>
          l.filter((n) => {
            const r = n.getBoundingClientRect();
            return r.right > 0 && r.left < innerWidth && r.bottom > 300 && r.top < innerHeight - 80;
          }).length,
      )) >= 4,
    );
    ok(
      `${tag}: every belt routed`,
      mm.links.every((l) => l.pts?.length),
    );
    const states2 = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
    ok(
      `${tag}: every machine at full speed`,
      states2.every((s) => s === 'Full speed'),
      [...new Set(states2)].join(', '),
    );
    await page.click('.floor-controls .floor-button >> nth=-1');
    await wait(600);
    await shot(`big-${tag}-fit`);
    ok(`${tag}: no cards on top of each other`, (await overlaps()).length === 0, (await overlaps()).slice(0, 5).join(' '));
  }
  await ctx.close();
}

// ───────────────────────────── Phone ─────────────────────────────
{
  section = 'C';
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const touchDrag = async (from, to) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 12; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(400);
  };

  await open(blank);
  await page.locator('.quick-head .text-button').tap();
  await wait(500);
  await page.locator('.add-part').tap();
  await wait(300);
  const sheet = await page.locator('.chooser').boundingBox();
  ok(
    '+ opens the menu from the bottom',
    sheet &&
      Math.abs(
        sheet.y +
          sheet.height -
          (await page.locator('.floor-view').boundingBox()).y -
          (await page.locator('.floor-view').boundingBox()).height,
      ) < 3,
  );
  ok('no keyboard pops up', await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
  await shot('c-sheet');
  await page.locator('.chooser-list li:has-text("Iron Ingot")').first().dispatchEvent('mousedown');
  await settle();
  let m = await model();
  const sm = m.nodes[0];
  ok('a tap adds it', m.nodes.length === 1);
  await page.locator('aside.inspector .icon-button').first().tap();
  await wait(300);
  // A finger on a card not picked pans the floor.
  const v0 = await viewport();
  const c1 = await centre(card(sm.id).locator('.machine-body'));
  await touchDrag(c1, { x: c1.x - 80, y: c1.y + 120 });
  m = await model();
  ok('a finger on a card not picked pans', (await viewport()) !== v0 && m.nodes[0].x === sm.x && m.nodes[0].y === sm.y);
  await card(sm.id).locator('.machine-strip').tap();
  await wait(300);
  await page.locator('aside.inspector .icon-button').first().tap();
  await wait(300);
  // The panel closed takes the pick off too; pick it without opening the panel over it: tap, then drag at once.
  await card(sm.id).locator('.machine-strip').tap();
  await wait(300);
  const c2 = await centre(card(sm.id).locator('.machine-strip'));
  await touchDrag(c2, { x: c2.x + 40, y: c2.y - 120 });
  m = await model();
  ok(
    'a picked card moves with a finger',
    m.nodes[0].x !== sm.x || m.nodes[0].y !== sm.y,
    `${sm.x},${sm.y} → ${m.nodes[0].x},${m.nodes[0].y}`,
  );
  const panelX = page.locator('aside.inspector .icon-button');
  if (await panelX.count()) await panelX.first().tap();
  await wait(300);
  await end(sm.id, 'o0').tap();
  await wait(300);
  ok('tapping an end opens no panel', !(await page.locator('aside.inspector').count()));
  ok('the strip says what to do', await page.locator('.connect-strip').isVisible());
  await shot('c-strip');
  await page.locator('.connect-strip .text-button').tap();
  await wait(200);
  ok('Cancel', !(await page.locator('.connect-strip').count()));
  await end(sm.id, 'o0').tap();
  await wait(200);
  const spot = await emptySpot('right');
  await page.touchscreen.tap(spot.x, spot.y);
  await wait(400);
  ok(
    'tapping the floor opens the menu for the belt',
    (await page.locator('.chooser input').getAttribute('placeholder'))?.includes('Iron Ingot'),
  );
  await shot('c-for-belt');
  await page.locator('.chooser-list li').first().dispatchEvent('mousedown');
  await settle();
  m = await model();
  ok('the new card comes joined', m.links.length === 1 && m.links[0].a === sm.id);
  if (await panelX.count()) await panelX.first().tap();
  await wait(300);
  ok('open ends button', (await page.locator('.open-ends').innerText()).includes('⚠'));
  await shot('c-built');

  await open(factory([['Desc_Motor_C', 10]]));
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await wait(600);
  await shot('c-motor');
  const bar = await page.locator('.floor-bar').boundingBox();
  const controls = await page.locator('.floor-controls').boundingBox();
  const kinds = await page.locator('.floor-kind').boundingBox();
  ok(
    'buttons along the bottom clear of each other',
    !clash(controls, kinds) && !clash(controls, await page.locator('.floor-bar .segmented:not(.floor-kind)').boundingBox()),
    JSON.stringify({ bar, controls }),
  );
  const toolbar = await page.locator('.model-toolbar').boundingBox();
  ok('toolbar fits across', toolbar.width <= 412, `${toolbar.width}`);
  await ctx.close();
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();

const failed = results.filter((r) => !r.pass);
const md = [
  `# Hand-built floor: ${results.length - failed.length} of ${results.length} steps passed`,
  '',
  ...results.map((r) => `- ${r.pass ? '✓' : '✗'} **${r.section}** ${r.step}${r.info ? ` — ${r.info}` : ''}`),
  '',
].join('\n');
fs.writeFileSync('e2e/out/modeler.md', md);
console.log(`\n${results.length - failed.length} of ${results.length} passed. See e2e/out/modeler.md and e2e/out/modeler/.`);
process.exit(failed.length ? 1 : 0);
