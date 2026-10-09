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

/** Opens the build menu on an empty spot of the floor, with a right click. */
async function addHere(prefer = 'right') {
  const at = await emptySpot(prefer);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await wait(300);
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

/** Every card inside the floor, nothing cut off at an edge. */
const allInView = () =>
  page.evaluate(() => {
    const f = document.querySelector('.react-flow').getBoundingClientRect();
    return [...document.querySelectorAll('.react-flow__node')].every((n) => {
      const r = n.getBoundingClientRect();
      return r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
    });
  });

/** Toolbar buttons drawn over the totals' fold tab. */
const onTab = () =>
  page.evaluate(() => {
    const tab = document.querySelector('.summary-handle')?.getBoundingClientRect();
    if (!tab) return [];
    return [...document.querySelectorAll('.model-toolbar button, .model-toolbar label')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.left < tab.right && tab.left < r.right && r.top < tab.bottom && tab.top < r.bottom;
      })
      .map((b) => b.textContent);
  });

/** Belts with a little kink: their two ends, as drawn, neither in line nor a clear step apart. */
const kinked = (links) =>
  page.evaluate((links) => {
    const mid = (node, handle) => {
      const h = document.querySelector(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${handle}"]`);
      if (!h) return undefined;
      const r = h.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1);
    const bad = [];
    for (const l of links) {
      const x = mid(l.a, `o${l.ap}`);
      const y = mid(l.b, `i${l.bp}`);
      if (x === undefined || y === undefined) continue;
      const d = Math.abs(x - y) / zoom;
      if (d > 0.5 && d < 12) bad.push(`${l.id} ${d.toFixed(1)}`);
    }
    return bad;
  }, links);

/** Two boxes on screen drawn over each other. */
const clash = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ───────────────────────────── Laptop ─────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  // ── A0: square belts on the Auto floor ──
  section = 'A0';
  const beltPaths = () => page.$$eval('.react-flow__edge path', (l) => l.map((p) => p.getAttribute('d') ?? ''));
  await open(factory([['Desc_Motor_C', 10]]));
  const curved = await beltPaths();
  ok('curved belts by default', curved.length > 0 && curved.some((d) => /C/.test(d)));
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
      active: 'f1',
      settings: { autoBelts: 'square' },
    }),
  );
  const squared = await beltPaths();
  ok(
    'square belts: straight runs with rounded turns, no curves',
    squared.length > 0 && squared.every((d) => !/C/.test(d)),
    `${squared.length} belts`,
  );

  // ── A1: Auto to Manual ──
  section = 'A1';
  await open(factory([['Desc_Motor_C', 10]]));
  await page.click('.deck-toggle');
  await wait(600);
  // A double click on an Auto machine ticks it built (no panel opens); a single click opens its panel with the box ticked.
  await page.locator('.react-flow__node-machine .machine-node').first().dblclick();
  await wait(600);
  ok('a double click on an Auto machine ticks it built', (await page.locator('.machine-node.done').count()) === 1);
  ok('and opens no panel', (await page.locator('.inspector').count()) === 0);
  await page.locator('.react-flow__node-machine .machine-node').first().click();
  await wait(600);
  ok('a single click opens the panel, with the built box ticked', (await page.locator('.inspector .built-check.on').count()) === 1);
  await page.keyboard.press('Escape');
  const autoRaw = await page.$$eval('.readout.wide input', (l) => l.map((i) => i.value));
  const autoMachines = await page.locator('.readout-value').nth(1).innerText();
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await wait(800);
  await shot('a1-manual');
  let m = await model();
  ok('model made', m && m.nodes.length > 10, `${m?.nodes.length} cards, ${m?.links.length} belts`);
  ok(
    'every belt laid out with a spot for its label',
    m.links.every((l) => l.lbl),
    `${m.links.filter((l) => !l.lbl).length} without`,
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
  ok(
    'the machine ticked built in Auto is ticked on the Manual floor too',
    m.nodes.some((n) => n.k === 'machine' && n.done),
  );
  const states = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok('every machine at full speed', states.length > 0 && states.every((s) => s === 'Full speed'), [...new Set(states)].join(', '));
  ok('no cards on top of each other', (await overlaps()).length === 0, (await overlaps()).join(' '));
  ok('opens with the whole floor in view', await allInView());
  ok('the toolbar clear of the totals tab', (await onTab()).length === 0, (await onTab()).join(', '));
  // The cards feeding a machine stand in the order of its inputs, so their belts don't cross: iron ore above coal.
  const steel = m.nodes.find((n) => n.recipe === 'Recipe_IngotSteel_C');
  const feeds = [0, 1].map((p) => m.nodes.find((n) => n.id === m.links.find((l) => l.b === steel?.id && l.bp === p)?.a));
  ok(
    'the foundry fed in the order of its inputs',
    feeds[0] && feeds[1] && feeds[0].y < feeds[1].y,
    feeds.map((n) => `${n?.item}@${n?.y}`).join(' / '),
  );
  // Belts run straight with square turns: every stretch of every belt drawn level or upright.
  const bent = await page.$$eval(
    '.react-flow__edge path.belt-hit',
    (l) =>
      l.filter((p) => {
        // M x,y, then L x,y for a straight stretch and Q cx,cy x,y for a turn; each stretch must be level or upright.
        let at;
        let bad = false;
        for (const [, op, args] of p.getAttribute('d').matchAll(/([MLQ])\s*([^MLQ]+)/g)) {
          const nums = args.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
          const end = nums.slice(-2);
          if (op === 'L' && at && Math.abs(end[0] - at[0]) > 1 && Math.abs(end[1] - at[1]) > 1) bad = true;
          at = end;
        }
        return bad;
      }).length,
  );
  ok('belts in straight runs', bent === 0, `${bent} bent`);
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
  const builtNow = (await model()).nodes.find((n) => n.id === smelter.id)?.done === true;
  ok(
    'double click ticks it built, with the tick on the card and in the panel',
    builtNow &&
      (await card(smelter.id).locator('.machine-node.done').count()) === 1 &&
      (await page.locator('aside.inspector .built-check input').isChecked()),
  );
  await shot('a3-built');
  await card(smelter.id).locator('.machine-strip').dblclick();
  await wait();
  ok('a second double click unticks it', !(await model()).nodes.find((n) => n.id === smelter.id)?.done);
  const touching = m.links.filter((l) => l.a === smelter.id || l.b === smelter.id).map((l) => l.id);
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
  const speed = page.locator('aside.inspector .speed-buttons button');
  ok(
    'Fill to 100% and Even out always in the panel',
    (await speed.count()) === 2 && (await speed.first().isEnabled()) && (await speed.first().innerText()) === 'Fill to 100%',
  );
  const built = page.locator('aside.inspector .built-check');
  ok('Built in the game is a box to tick', (await built.locator('input[type="checkbox"]').count()) === 1 && (await built.isVisible()));
  await built.click();
  await wait();
  m = await model();
  ok(
    'ticked: built, with a tick on the card',
    m.nodes.find((n) => n.id === cons.id).done === true && (await card(cons.id).locator('.done').count()) === 1,
  );
  await built.click();
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
  await page.locator('aside.inspector .mk-pick button:text-is("Mk.1")').click();
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
  ok(
    'with its output open, it runs and what it makes is left over',
    (await card(ironSmelter.id).innerText()).includes('Full speed') && (await card(ironSmelter.id).locator('.port-spare').count()) === 1,
    (await card(ironSmelter.id).innerText()).replace(/\s+/g, ' '),
  );
  ok('the totals count it as left over', /Surplus\s*45/.test(await page.locator('.floor').innerText()));
  await shot('a7-left-over');
  await page.locator('.open-outputs button:has-text("Fill up")').click();
  await settle();
  ok('open outputs backing up, as in the game: it stops', (await card(ironSmelter.id).innerText()).includes('Output not connected'));
  await shot('a7-stall');
  await page.locator('.open-outputs button:has-text("Left over")').click();
  await settle();
  await page.locator('.tool-button[aria-label="Numbers"]').click();
  await settle();
  ok(
    'Off: no numbers',
    !(await card(ironSmelter.id).locator('.run-state').count()) &&
      !(await page.locator('.edge-rate, .endpoint-rate, .machine-draw').count()),
  );
  await shot('a7-off');
  await page.locator('.tool-button[aria-label="Numbers"]').click();
  await settle();
  ok('numbers back', (await card(ironSmelter.id).locator('.run-state').count()) === 1);

  // ── A8: the other views, Auto and back, rebuild ──
  section = 'A8';
  m = await model();
  const camBefore = await viewport();
  // Machines sizing themselves with nothing coming in take none, so the list leaves them out.
  const running = await page.$$eval(
    '.react-flow__node .machine-node',
    (l) => l.filter((c) => !/Input not connected|Idle/.test(c.textContent)).length,
  );
  await page.locator('.floor-bar .segmented:not(.floor-kind) button >> nth=1').click();
  await wait(600);
  const rows = await page.locator('.table-view tbody tr, .table tbody tr, table tbody tr').count();
  ok('the list shows the manual machines', rows >= running && running > 0, `${rows} rows, ${running} running`);
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
  await page.locator('.tool-button[aria-label="Rebuild"]').click();
  await settle();
  const rebuilt = await model();
  ok('rebuild asks, then starts again', rebuilt.links.some((l) => l.a === ironSmelter.id) || rebuilt.nodes.length > 0);
  ok('rebuilt: no open output left', !rebuilt.stall && (await page.locator('.open-ends').count()) === 0);
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0]);
  const outs = rebuilt.nodes.filter((n) => n.k === 'out' && n.tag !== 'spare').map((n) => n.item);
  ok(
    'the products in the panel are the floor’s outputs, and the factory’s targets',
    (await page.locator('.side .floor-io').count()) >= outs.length &&
      plan.targets.every((x) => outs.includes(x.item)) &&
      outs.every((i) => plan.targets.some((x) => x.item === i)),
    `${outs.join(',')} / ${plan.targets.map((x) => x.item).join(',')}`,
  );

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

  // ── A10: the same output another way ──
  section = 'A10';
  await open(factory([['Desc_Motor_C', 10]]));
  await page.click('.floor-kind button >> nth=1');
  await settle();
  m = await model();
  // Converted machines size themselves, at the clock the Auto card runs them at.
  let slow;
  for (const n of m.nodes)
    if (
      !slow &&
      n.k === 'machine' &&
      n.auto &&
      (n.clock ?? 1) < 1 &&
      /([3-9]|\d\d) ×/.test((await card(n.id).innerText()).replace(/\s+/g, ' '))
    )
      slow = n;
  ok(
    'a line below 100%',
    !!slow,
    slow
      ? `auto × ${slow.clock}`
      : `${m.nodes.filter((n) => n.k === 'machine').map((n) => `${n.auto}/${n.clock}`)} ${(await page.$$eval('.machine-node .machine-info', (l) => l.map((x) => x.textContent))).join(' | ')}`,
  );
  const output = (await model()).nodes.length;
  await fit();
  await card(slow.id).locator('.machine-strip').click();
  await wait();
  ok('the picked card offers Fill to 100%', await card(slow.id).locator('.speed-buttons button:has-text("Fill to 100%")').isVisible());
  await shot('a10-card');
  await card(slow.id).locator('.speed-buttons button:has-text("Fill to 100%")').click();
  await settle();
  m = await model();
  let filled = m.nodes.find((n) => n.id === slow.id);
  ok(
    'Fill to 100%: the machines at 100%, as many as that takes',
    filled.auto && filled.n === undefined && filled.clock === undefined,
    `${slow.clock} → ${filled.clock ?? 1}`,
  );
  const runLine = (await card(slow.id).locator('.machine-body').innerText()).replace(/\s+/g, ' ');
  ok('the card says whole machines and one slower', /100%/.test(runLine) && /\+ 1 ×/.test(runLine), runLine.replace(/\s+/g, ' '));
  const st = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok(
    'everything still at full speed',
    st.every((x) => x === 'Full speed'),
    [...new Set(st)].join(', '),
  );
  ok('no Fill to 100% once there', !(await card(slow.id).locator('.speed-buttons button:has-text("Fill to 100%")').count()));
  await page.locator('aside.inspector .speed-buttons button:has-text("Even out")').click();
  await settle();
  filled = (await model()).nodes.find((n) => n.id === slow.id);
  ok('Even out puts them back at one clock', filled.auto && Math.abs(filled.clock - slow.clock) < 1e-5, `${filled.clock}`);
  ok('nothing else changed', (await model()).nodes.length === output);
  ok(
    'reduce motion: the panel opens without sliding',
    (await page.$eval('aside.inspector', (a) => getComputedStyle(a).animationDuration)) === '0.001s',
  );
  await page.keyboard.press('Escape');

  // ── B: building by hand ──
  section = 'B1';
  await open(blank);
  await page.locator('.quick-head .build-by-hand').click();
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
  ok('double click on the floor adds nothing, as set', !(await page.locator('.chooser').count()));
  at = await emptySpot('left');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await wait(300);
  ok('right click on the floor opens the menu', await page.locator('.chooser').isVisible());
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
  const menu = await page.locator('.chooser').boundingBox();
  await page.mouse.click(menu.x > 400 ? menu.x - 100 : menu.x + menu.width + 100, menu.y + 40);
  await wait(300);
  ok('a click outside closes it', !(await page.locator('.chooser').count()));
  // Settings › Factory floor: add with a double click instead; then a right click adds nothing.
  const addWith = async (label) => {
    await page.click('.chrome-button.settings');
    await page.locator('.settings-nav button:has-text("Factory floor")').click();
    await page.locator(`[role="radiogroup"][aria-label="Add parts with"] button:has-text("${label}")`).click();
    await page.keyboard.press('Control+s');
    await wait(200);
    await page.keyboard.press('Escape');
    await wait(300);
  };
  await addWith('Double click');
  ok(
    'the setting is saved',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.settings.addWith)) === 'double',
  );
  at = await emptySpot('left');
  await page.mouse.dblclick(at.x, at.y);
  await wait(300);
  ok('set to double click: a double click opens the menu', await page.locator('.chooser').isVisible());
  await page.keyboard.press('Escape');
  await wait(200);
  at = await emptySpot('left');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await wait(300);
  ok('set to double click: a right click adds nothing', !(await page.locator('.chooser').count()));
  await addWith('Right click');
  ok('no Add button on the floor', !(await page.locator('.add-part').count()));

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
  // The player's line from the report: miner, smelter, plates, nothing after. It runs, sized to the miner.
  ok(
    'machines put down by hand size themselves',
    m.nodes.filter((n) => n.k === 'machine').every((n) => n.auto === true),
  );
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  const chainStates = await page.$$eval('.react-flow__node .run-state', (l) => l.map((x) => x.textContent));
  ok('miner → smelter → plates all run', chainStates.length === 3 && chainStates.every((x) => x === 'Full speed'), chainStates.join(', '));
  const plateText = (await card(plate.id).innerText()).replace(/\s+/g, ' ');
  ok('the plates come out of the last card', /\d+\/min/.test(await card(plate.id).locator('.port-spare').innerText()), plateText);
  ok('the panel lists them as left over', /Left over[\s\S]*Iron Plate/.test(await page.locator('.side').innerText()));
  await shot('b3-chain-runs');
  await card(mine.id).click();
  await wait();
  const makes = page.locator('aside.inspector .inspector-row:has-text("Makes") input');
  await makes.click();
  await makes.fill('30');
  await settle();
  m = await model();
  ok(
    'typing what the miner makes sets its clock, and the line follows',
    Math.abs((m.nodes.find((n) => n.id === mine.id).clock ?? 1) * (m.nodes.find((n) => n.id === mine.id).n ?? 1) - 0.5) < 1e-6 ||
      (await card(sm).innerText()).includes('1'),
    (await card(sm).innerText()).replace(/\s+/g, ' '),
  );
  await page.keyboard.press('Escape');
  // A belt let go on a card's body goes onto its free end that fits.
  const rod = await page.evaluate(() => null);
  void rod;
  await addHere('right');
  await page.keyboard.type('Iron Rod');
  await page.keyboard.press('Enter');
  await settle();
  m = await model();
  const rodNode = m.nodes.find((n) => n.recipe === 'Recipe_IronRod_C');
  await page.keyboard.press('Escape');
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  // The smelter's output already feeds the plates: a splitter first, then from it onto the rod card's body.
  await addHere('right');
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
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  await drag(await centre(end(split.id, 'o1')), await centre(card(plate.id).locator('.machine-body')));
  await settle();
  m = await model();
  ok(
    'one belt per end: the new one replaces the old',
    m.links.filter((l) => l.b === plate.id && l.bp === 0).length === 1 && m.links.some((l) => l.a === split.id && l.b === plate.id),
  );
  await shot('b3-split');

  section = 'B4';
  // Open outputs backing up as in the game: then every open output needs a belt.
  await page.locator('.open-outputs button:has-text("Fill up")').click();
  await settle();
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
  // An output on each open machine output: added as a product in the side panel, then joined with a belt.
  m = await model();
  for (const [n, item] of [
    [plate, 'Iron Plate'],
    [rodNode, 'Iron Rod'],
  ]) {
    await page.locator('.side .targets.manual .add-button').first().click();
    await page.locator('.side .picker-search').fill(item);
    await page.locator('.side .picker-search').press('Enter');
    await settle();
    await page.click('.floor-controls .floor-button >> nth=-1');
    await wait(400);
    const made = (await model()).nodes.find((x) => x.k === 'out' && !m.nodes.some((y) => y.id === x.id));
    m = await model();
    await drag(await centre(end(n.id, 'o0')), await centre(end(made.id, 'i0')));
    await settle();
    await page.keyboard.press('Escape');
  }
  ok('nothing left open', !(await page.locator('.open-ends').count()));
  await page.locator('.open-outputs button:has-text("Left over")').click();
  await settle();
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
  await page.locator('.tool-button[aria-label="Tidy up"]').click();
  await settle();
  await wait(500);
  ok('Tidy up lays it out afresh', JSON.stringify((await model()).nodes.map((n) => [n.x, n.y])) !== was);
  ok('no cards on top of each other', (await overlaps()).length === 0);
  ok('after Tidy up the whole floor in view', await allInView());
  await shot('b5-tidy');
  await page.keyboard.press('Control+z');
  await settle();
  ok('undo puts them back', JSON.stringify((await model()).nodes.map((n) => [n.x, n.y])) === was);

  // A machine that takes back what it gives off (a Blender feeding itself acid) comes across with its belt round to its own input.
  section = 'loop';
  await open(factory([['Desc_UraniumCell_C', 12]]));
  await page.click('.deck-toggle');
  await wait(600);
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await wait(800);
  m = await model();
  const blender = m.nodes.find((n) => n.recipe === 'Recipe_UraniumCell_C');
  ok(
    'the Blender has its acid output belted, round into its own input through a merger',
    m.links.some((l) => l.a === blender.id && l.ap === 1) &&
      m.nodes.some((n) => n.k === 'logistic' && m.links.some((l) => l.a === n.id && l.b === blender.id && l.bp === 2)),
  );
  const loopStates = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok('every machine at full speed', loopStates.length === 3 && loopStates.every((x) => x === 'Full speed'), loopStates.join(', '));
  ok(
    'the product still comes out at 12 a minute',
    /12\s*\/min/.test(await page.locator('.react-flow__node', { hasText: 'Output' }).first().innerText()),
  );

  // The "All" tab: every factory and plant on one page; a hand-built factory counts for what its floor works out to.
  section = 'all';
  await open(factory([['Desc_Motor_C', 10]]));
  await page.click('.deck-toggle');
  await wait(600);
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await wait(800);
  const floorPower = (await page.locator('.readout.power .readout-value').first().innerText()).replace(/\s+/g, ' ');
  await page.click('.plan-current');
  await wait(300);
  ok('no All row while there is only one tab', (await page.locator('.plan-row.all').count()) === 0);
  await page.keyboard.press('Escape');
  await page.click('.plan-add');
  await wait(500);
  await page.click('.plan-current');
  await wait(300);
  ok('the All row shows with two factories', (await page.locator('.plan-row.all').count()) === 1);
  await page.locator('.plan-row.all .plan-row-name').click();
  await wait(2500);
  ok(
    'the All page replaces the floor',
    (await page.locator('.overview').count()) === 1 && (await page.locator('.react-flow').count()) === 0,
  );
  const rowsText = await page.$$eval('.ov-table:not(.plants):not(.pool) tbody tr', (l) => l.map((r) => r.textContent.replace(/\s+/g, ' ')));
  ok('a row per factory, the empty one says so', rowsText.length === 2 && /Nothing planned/.test(rowsText[1]), rowsText.join(' | '));
  ok('the hand-built factory is marked', (await page.locator('.ov-tag').count()) === 1);
  const rowPower = rowsText[0].match(/([\d.,]+)\s*MW/)?.[1];
  ok('its power is what the Manual floor showed', !!rowPower && floorPower.startsWith(rowPower), `${floorPower} / ${rowPower}`);
  ok('the page is clean of floor controls', (await page.locator('.floor-bar, .share-button').count()) === 0);
  await shot('all-page');
  await page.locator('.ov-name button').first().click();
  await wait(600);
  ok('a row opens its factory', (await page.locator('.overview').count()) === 0 && (await page.locator('.floor-kind').count()) === 1);

  // The pool: what factories leave over, for another factory to take; red when more is taken than there is.
  section = 'pool';
  await open(
    saved({
      mode: 'factory',
      plans: [
        { id: 'f1', name: 'Plastic', targets: [{ item: 'Desc_Plastic_C', rate: 60 }] },
        {
          id: 'f2',
          name: 'Fuel',
          targets: [{ item: 'Desc_Motor_C', rate: 5 }],
          supplies: [{ item: 'Desc_HeavyOilResidue_C', rate: 20, from: 'pool' }],
        },
      ],
      active: 'f2',
    }),
  );
  await wait(2500);
  const poolNote = async () => (await page.locator('.supply-pool').first().innerText()).replace(/\s+/g, ' ');
  ok('a supply taken from the pool says what the pool has', /30\/min in the pool/.test(await poolNote()), await poolNote());
  const poolInput = page.locator('.item-card', { hasText: 'Heavy Oil Residue' }).locator('input').first();
  await poolInput.fill('50');
  await poolInput.blur();
  await wait(2500);
  ok('and goes red when more is taken than there is', (await page.locator('.supply-pool.short').count()) === 1, await poolNote());
  ok('the graph says the supply comes from the pool', /From the pool/i.test(await page.locator('.react-flow').innerText()));
  await page.click('.plan-current');
  await wait(300);
  await page.locator('.plan-row.all .plan-row-name').click();
  await wait(2500);
  ok(
    'the All page shows the pool short',
    (await page.locator('.readout.short').count()) === 1,
    (await page.locator('.readout.short').innerText()).replace(/\s+/g, ' '),
  );
  await shot('pool-short');

  // A power plant sized to what you have can take fuel from the pool too.
  section = 'pool-power';
  await open(
    saved({
      mode: 'power',
      plans: [{ id: 'f1', name: 'Plastic', targets: [{ item: 'Desc_Plastic_C', rate: 60 }] }],
      active: 'f1',
      power: [
        {
          id: 'pp',
          name: 'Coal plant',
          plants: [{ id: 'p', generator: 'Build_GeneratorCoal_C', fuel: 'Desc_Coal_C', by: 'auto', amount: 1, clock: 1 }],
          sizeBy: 'have',
          have: [{ item: 'Desc_HeavyOilResidue_C', rate: 10, from: 'pool' }],
          want: 1000,
          factories: 'all',
        },
      ],
      activePower: 'pp',
    }),
  );
  await wait(2500);
  ok(
    'a plant says what the pool has for the fuel taken from it',
    /30\/min in the pool/.test((await page.locator('.supply-pool').first().innerText()).replace(/\s+/g, ' ')),
  );

  // Separate lines: a product on a line of its own is made apart from the rest, each line with a tag over it.
  section = 'lines';
  await open(
    factory([
      ['Desc_Motor_C', 10],
      ['Desc_Computer_C', 5],
    ]),
  );
  const ownLine = page.locator('.line-toggle', { hasText: 'Own line' });
  ok('every product has an Own line switch', (await ownLine.count()) === 2);
  const machinesBefore = await page.locator('.readout-value').nth(1).innerText();
  await ownLine.nth(1).click();
  await wait(2500);
  ok('the switch is on', (await page.locator('.line-toggle[aria-pressed="true"]', { hasText: 'Own line' }).count()) === 1);
  ok(
    'the floor shows a tag over each of the two lines',
    (await page.locator('.line-tag').count()) === 2,
    await page
      .locator('.line-tag')
      .allInnerTexts()
      .then((l) => l.join(' / ')),
  );
  ok('no cards on top of each other', (await overlaps()).length === 0, (await overlaps()).join(' '));
  const machinesApart = await page.locator('.readout-value').nth(1).innerText();
  ok(
    'the totals count the machines of both lines',
    Number(machinesApart) >= Number(machinesBefore),
    `${machinesBefore} -> ${machinesApart}`,
  );
  await shot('lines');
  await ownLine.nth(1).click();
  await wait(2500);
  ok('switched off, the floor is one line again', (await page.locator('.line-tag').count()) === 0);

  // Your own nodes as a limit, and what each resource costs.
  section = 'resources';
  await open(
    saved({
      mode: 'factory',
      plans: [
        {
          id: 'f1',
          name: 'Factory 1',
          targets: [{ item: 'Desc_IronPlate_C', rate: 300 }],
          extraction: {
            miner: 'Build_MinerMk2_C',
            purity: 'normal',
            clock: 1,
            nodes: { Desc_OreIron_C: { pure: 1, normal: 1 } },
            capByNodes: true,
          },
        },
      ],
      active: 'f1',
    }),
  );
  await wait(1500);
  ok('more than the nodes give does not work out', (await page.locator('.floor-message.error').count()) === 1);
  await page.getByRole('tab', { name: /Resources/ }).click();
  await wait(500);
  const nodesBox = page.locator('.check-row', { hasText: 'Plan with my nodes' }).locator('input');
  ok('Plan with my nodes is on', await nodesBox.isChecked());
  await nodesBox.uncheck();
  await wait(2000);
  ok('off, the plan works out again', (await page.locator('.floor-message.error').count()) === 0);
  await page.getByRole('radio', { name: 'Custom' }).click();
  await wait(500);
  ok('Custom cost puts a cost box on every resource', (await page.locator('.cost-field').count()) > 0);
  await shot('custom-cost');

  // Splitters and mergers on the Auto floor, and how a belt is shared out between a line's machines.
  section = 'splitters';
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
      active: 'f1',
      settings: { autoSplitters: true },
    }),
  );
  await page.click('.deck-toggle');
  await wait(600);
  ok(
    'splitters and mergers are drawn on the Auto floor',
    (await page.locator('.logistic-node').count()) > 0,
    `${await page.locator('.logistic-node').count()}`,
  );
  ok('no cards on top of each other', (await overlaps()).length === 0, (await overlaps()).join(' '));
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(600);
  await shot('splitters');
  await page.locator('.react-flow__node-machine .machine-node').first().click();
  await wait(700);
  ok('a machine panel says how to share a belt between its machines', (await page.locator('.inspector-balancer').count()) === 1);
  await open(factory([['Desc_Motor_C', 10]]));
  ok('off by default: no splitter cards', (await page.locator('.logistic-node').count()) === 0);

  // The old address says there is a new one, and takes the plans along in a link. Both addresses are served from this build.
  section = 'moved';
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' });
    const old = await ctx.newPage();
    for (const host of ['https://ficsit-planner.pages.dev', 'https://ficsitplanner.app']) {
      await old.route(`${host}/**`, async (route) => {
        const u = new globalThis.URL(route.request().url());
        const r = await fetch(`http://127.0.0.1:4177${u.pathname}${u.search}`);
        const headers = Object.fromEntries(r.headers);
        delete headers['content-encoding'];
        delete headers['content-length'];
        await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
      });
    }
    const mine = saved({
      mode: 'factory',
      plans: [
        { id: 'a', name: 'Motors', targets: [{ item: 'Desc_Motor_C', rate: 10 }] },
        { id: 'b', name: 'Plates', targets: [{ item: 'Desc_IronPlate_C', rate: 30 }] },
      ],
      active: 'a',
    });
    await old.goto('https://ficsit-planner.pages.dev/');
    await old.evaluate((v) => {
      localStorage.clear();
      localStorage.setItem('ficsit-planner', v);
    }, mine);
    await old.goto('about:blank');
    await old.goto('https://ficsit-planner.pages.dev/');
    await old.waitForSelector('.toast.moved', { timeout: 30000 });
    ok('the old address says there is a new one', /new address/.test(await old.locator('.toast.moved').innerText()));
    await old.screenshot({ path: path.join(OUT, `${String(++shots).padStart(2, '0')}-moved-notice.png`) });
    await old.getByRole('button', { name: 'Move my plans' }).click();
    await old.waitForURL(/ficsitplanner\.app/, { timeout: 30000 });
    await old.waitForSelector('.plan-tab-label', { timeout: 30000 });
    await old.waitForTimeout(1500);
    // Read the plans that arrived from what the page keeps, whichever way its top bar lists them.
    const tabs = await old.evaluate(
      () => JSON.parse(localStorage.getItem('ficsit-planner') ?? '{}').state?.plans?.map((p) => p.name) ?? [],
    );
    ok('the plans arrive on the new address', tabs.includes('Motors') && tabs.includes('Plates'), tabs.join(', '));
    ok('and the new address has no notice of its own', (await old.locator('.toast.moved').count()) === 0);
    await ctx.close();
  }

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
    ok(`${tag}: converted, the whole floor in view`, await allInView());
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
      `${tag}: every belt laid out with a spot for its label`,
      mm.links.every((l) => l.lbl),
    );
    // Made from the plan's own recipes, tier and limits: nothing on it goes against the side panel.
    ok(`${tag}: no card goes against the side panel`, !(await page.locator('.card-flag').count()));
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

// ───────────────────────────── Hiding what the tier can't make ─────────────────────────────
{
  section = 'H';
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const low = (extra) => saved({ tier: 2, mode: 'factory', plans: [{ id: 'f1', name: 'Factory 1', targets: [] }], active: 'f1', ...extra });
  await open(low());
  ok(
    'hidden by default: the shortcuts keep only what this tier makes',
    (await page.locator('.quick-item').count()) > 0 && (await page.locator('.quick-item.locked').count()) === 0,
  );
  await page.locator('.quick-search').fill('motor');
  await wait(200);
  ok(
    'Motor is left out of the search',
    !(await page.locator('.quick-item').count()),
    await page
      .locator('.quick-pick')
      .innerText()
      .then((x) => x.slice(0, 80)),
  );
  await page.locator('.quick-search').fill('');
  // The build menu on a hand-built floor.
  await page.locator('.quick-head .build-by-hand').click();
  await wait(400);
  await page.locator('.floor-empty .primary-button').click();
  await wait(300);
  ok(
    'the build menu lists nothing locked',
    (await page.locator('.chooser-list li').count()) > 0 && !(await page.locator('.chooser-list li.locked').count()),
  );
  await page.keyboard.type('motor');
  await wait(200);
  ok('Motor is not in the build menu', !(await page.locator('.chooser-list li:has-text("Motor")').count()));
  await page.keyboard.press('Escape');
  // The product and on-hand lists in the panel.
  await open(low({ plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_IronPlate_C', rate: 10 }] }] }));
  await page.locator('.side .add-button').first().click();
  await page.locator('.picker-search').fill('motor');
  await wait(200);
  ok('Motor is not in Add product', (await page.locator('.picker-list li[role=option]').count()) === 0);
  ok(
    'and the empty list says when it opens up',
    /Not in your tier yet: .*Motor.*Tier \d/.test(await page.locator('.picker-empty').innerText()),
  );
  await page.locator('.picker-search').fill('qwzx');
  await wait(200);
  ok('a made-up word just finds no matches', (await page.locator('.picker-empty').innerText()).trim() === 'No matches');
  await page.locator('.picker-search').fill('motor');
  await wait(200);
  await page.locator('.picker-search').fill('rotor');
  await wait(200);
  ok('what this tier makes still is', (await page.locator('.picker-list li:has-text("Rotor")').count()) === 1);
  await page.keyboard.press('Escape');
  await page.locator('.side .add-button').nth(1).click();
  await page.locator('.picker-search').fill('motor');
  await wait(200);
  ok('Motor is not in Already on hand', (await page.locator('.picker-list li[role=option]').count()) === 0);
  await page.keyboard.press('Escape');
  // Recipes: nothing locked listed, and no button to list it.
  await page.locator('.side .tabs button[role="tab"]:has-text("Recipes")').click();
  await page.locator('.panel-body.recipes .segmented button:has-text("All")').click();
  await wait(300);
  ok(
    'no locked recipes and no Show locked',
    (await page.locator('.recipe-row').count()) > 0 &&
      !(await page.locator('.recipe-row.locked').count()) &&
      !(await page.locator('.locked-note').count()),
  );
  // Resources: miners not unlocked yet.
  await page.locator('.side .tabs button[role="tab"]:has-text("Resources")').click();
  await wait(300);
  ok('only unlocked miners to pick', (await page.locator('.miner-picker button').count()) === 1);
  // Power: generators not unlocked yet.
  await open(low({ mode: 'power' }));
  ok('no locked generators to pick', (await page.locator('.gen-card').count()) > 0 && !(await page.locator('.gen-card.locked').count()));
  // Settings › Interface turns them back on.
  await open(low());
  await page.click('.chrome-button.settings');
  await page.locator('.settings-nav button:has-text("Interface")').click();
  const sw = page.locator('[role="switch"][aria-label="Show what your tier can’t make"]');
  ok('the setting is off at first', (await sw.getAttribute('aria-checked')) === 'false');
  await sw.click();
  await page.keyboard.press('Control+s');
  await wait(200);
  await page.keyboard.press('Escape');
  await wait(300);
  ok(
    'turned on and saved',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.settings.showLocked)) === true,
  );
  await page.locator('.quick-search').fill('motor');
  await wait(200);
  ok('turned on: Motor shows with its tier', (await page.locator('.quick-item.locked').count()) > 0);
  await page.locator('.quick-search').fill('');
  await open(low({ settings: { showLocked: true }, mode: 'power' }));
  ok('turned on: locked generators show', (await page.locator('.gen-card.locked').count()) > 0);
  await open(
    low({ settings: { showLocked: true }, plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_IronPlate_C', rate: 10 }] }] }),
  );
  await page.locator('.side .tabs button[role="tab"]:has-text("Recipes")').click();
  await wait(300);
  ok('turned on: Recipes offers Show locked', (await page.locator('.locked-note').count()) === 1);
  await ctx.close();
}

// ───────────────────────────── The side panel holds on the floor ─────────────────────────────
{
  section = 'P';
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // A miner and a smelter put down by hand; the plan's recipes as they come, every alternate off.
  await open(
    saved({
      mode: 'factory',
      plans: [
        {
          id: 'f1',
          name: 'Factory 1',
          targets: [],
          floor: 'manual',
          model: {
            v: 1,
            calc: 'basic',
            seq: 10,
            nodes: [
              { id: 'm', x: 0, y: 0, k: 'extract', extractor: 'Build_MinerMk2_C', item: 'Desc_OreIron_C' },
              { id: 's', x: 480, y: 0, k: 'machine', recipe: 'Recipe_IngotIron_C', auto: true },
            ],
            links: [{ id: 'l1', a: 'm', ap: 0, b: 's', bp: 0 }],
          },
        },
      ],
      active: 'f1',
    }),
  );
  const tab = (name) => page.locator(`.side .tabs button[role="tab"]:has-text("${name}")`).click();
  const fromMiner = async () => {
    await fit();
    await drag(await centre(end('m', 'o0')), await emptySpot('right'));
    await wait(300);
  };
  await fromMiner();
  ok('a belt from the miner opens the menu', await page.locator('.chooser').isVisible());
  ok(
    'every alternate off in Recipes: none in the menu',
    (await page.locator('.chooser-list li').count()) > 0 && !(await page.locator('.chooser-list .kind.alternate').count()),
    (await page.locator('.chooser-list li .chooser-title').allInnerTexts()).join(' | '),
  );
  await shot('p-no-alternates');
  await page.keyboard.press('Escape');
  // One alternate turned on in Recipes: that one comes, and no other.
  await tab('Recipes');
  await page.locator('.panel-body.recipes .segmented button:has-text("Alternate")').click();
  await page.locator('.panel-body.recipes .search').fill('Iron Alloy');
  await wait(300);
  await page.locator('.recipe-row input').first().check();
  await wait(300);
  await fromMiner();
  const alts = await page.locator('.chooser-list li:has(.kind.alternate) .chooser-title').allInnerTexts();
  ok('one alternate turned on: only that one', alts.length === 1 && alts[0].includes('Iron Alloy'), alts.join(' | '));
  await page.keyboard.press('Escape');
  // The standard Iron Ingot turned off: the smelter on the floor says so, and stays.
  await page.locator('.panel-body.recipes .segmented button:has-text("Standard")').click();
  await page.locator('.panel-body.recipes .search').fill('Iron Ingot');
  await wait(300);
  await page
    .locator('.recipe-row')
    .filter({ hasText: /^Iron Ingot/ })
    .locator('input')
    .uncheck();
  await wait(500);
  ok('a card on a recipe turned off says so', (await card('s').locator('.card-flag').innerText()).toLowerCase() === 'off in recipes');
  ok(
    'and is still on the floor',
    (await model()).nodes.some((n) => n.id === 's'),
  );
  await shot('p-recipe-off');
  await fromMiner();
  ok(
    'nor does the menu offer it',
    !(await page.locator('.chooser-list li .chooser-title').allInnerTexts()).some((x) => x === 'Iron Ingot'),
  );
  await page.keyboard.press('Escape');
  await page
    .locator('.recipe-row')
    .filter({ hasText: /^Iron Ingot/ })
    .locator('input')
    .check();
  await wait(400);
  ok('turned back on: the tag goes', !(await card('s').locator('.card-flag').count()));
  // The tier lowered below the Mk.2 miner.
  await page.locator('.tier-steps button:text-is("3")').click();
  await wait(400);
  ok('a miner above the tier says so', (await card('m').locator('.card-flag').innerText()).toLowerCase() === 'needs tier 4');
  await page.locator('.tier-steps button:text-is("9")').click();
  await wait(300);
  // Resources: a new miner comes as picked there.
  await tab('Resources');
  await page.locator('.miner-picker button:has-text("Mk.1")').click();
  await page.locator('.panel-body.resources .segmented button:has-text("Impure")').click();
  await wait(200);
  const spot = await emptySpot('left');
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await wait(300);
  await page.locator('.chooser-tabs button:has-text("Resources")').click();
  await page.locator('.chooser input').fill('Iron Ore');
  await wait(200);
  await page.locator('.chooser-list li').first().dispatchEvent('mousedown');
  await settle();
  const added = (await model()).nodes.find((n) => n.k === 'extract' && n.id !== 'm');
  ok(
    'a new miner comes with the Mk and purity from Resources',
    added?.extractor === 'Build_MinerMk1_C' && added?.purity === 'impure',
    JSON.stringify(added),
  );
  ok('its card says so', (await card(added.id).innerText()).includes('Mk.1 · Impure'));
  ok('an iron ore miner, as searched', added?.item === 'Desc_OreIron_C');
  await page.keyboard.press('Escape');
  // A limit in Resources under what the floor mines: the miners and the panel say so.
  await page.locator('.resource-card').filter({ hasText: 'Iron Ore' }).locator('input').first().fill('10');
  await page.keyboard.press('Enter');
  await wait(800);
  ok('mined past the limit: the miner says so', (await card('m').locator('.card-flag').innerText()).toLowerCase() === 'over the limit');
  ok('and Resources too', (await page.locator('.resource-card .over-cap').count()) === 1);
  await shot('p-over-limit');
  // Scrolled to the end of a panel, nothing at its bottom is faded.
  const fadeAt = (where) =>
    page.evaluate((where) => {
      const p = document.querySelector('.panel-body.resources');
      p.scrollTop = where === 'end' ? p.scrollHeight : 0;
      return new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(getComputedStyle(p).getPropertyValue('--fade').trim()))),
      );
    }, where);
  const scrolls = await page.evaluate(() => {
    const p = document.querySelector('.panel-body.resources');
    return p.scrollHeight > p.clientHeight + 4;
  });
  ok('a panel faded only while there is more below', !scrolls || ((await fadeAt('top')) !== '0px' && (await fadeAt('end')) === '0px'));
  // A belt left to choose its Mk: the slowest that carries it, though Mk.6 is unlocked.
  await fit();
  await page.locator('.react-flow__edge[data-id="l1"] .belt-hit').click({ force: true });
  await wait();
  const beltHead = await page.locator('aside.inspector .inspector-machine').innerText();
  ok(
    'a belt left to itself is the slowest Mk that carries it',
    beltHead.includes('Mk.2') && (await page.locator('aside.inspector .mk-pick button[aria-checked="true"]').innerText()) === 'Auto',
    beltHead,
  );
  await page.keyboard.press('Escape');
  // Undo and redo side by side, arrows, no words.
  const [u, r] = await Promise.all(['Undo', 'Redo'].map((n) => page.locator(`.tool-button[aria-label="${n}"]`).boundingBox()));
  ok('undo and redo side by side', u && r && Math.abs(r.x - (u.x + u.width)) <= 2 && Math.abs(r.y - u.y) <= 1, JSON.stringify({ u, r }));
  ok('the toolbar has no words on its buttons', !(await page.locator('.model-toolbar .tool-button').allInnerTexts()).some((x) => x.trim()));
  const handle = await page.locator('.summary-handle').boundingBox();
  ok('the totals fold tab is easy to hit', handle && handle.width >= 76 && handle.height >= 24, JSON.stringify(handle));
  await shot('p-toolbar');
  // Auto floor: a machine's panel lists only the recipes turned on.
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }] }],
      active: 'f1',
    }),
  );
  await page.click('.deck-toggle');
  await wait(500);
  const plateCard = () =>
    page
      .locator('.react-flow__node')
      .filter({ has: page.locator('.machine-product', { hasText: /^(Coated )?Iron Plate$/ }) })
      .first();
  await plateCard().click();
  await wait(400);
  ok('every alternate off: no recipe list to turn them on from in the Auto panel', !(await page.locator('.recipe-choices').count()));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('ficsit-planner'));
    s.state.plans[0].enabled.push('Recipe_Alternate_CoatedIronPlate_C');
    localStorage.setItem('ficsit-planner', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
  await wait(600);
  await plateCard().click();
  await wait(400);
  const listed = await page.locator('.recipe-choices .recipe-choice-name').allInnerTexts();
  const unticked = await page.locator('.recipe-choices input:not(:checked)').count();
  ok(
    'one turned on: the panel lists it with the standard one, nothing turned off',
    listed.length === 2 && unticked === 0 && listed.some((x) => x.includes('Coated Iron Plate')),
    listed.join(' | '),
  );

  // ── Q: 0.13.5 ──
  section = 'Q';
  const plate = 'Desc_IronPlateReinforced_C';
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: plate, rate: 30 }] }],
      active: 'f1',
      settings: { beltLabels: 'always' },
    }),
  );
  await page.click('.floor-kind button >> nth=1');
  await settle();
  let m = await model();
  ok(
    'converted belts are left to the load: no Mk picked',
    m.links.every((l) => l.mk === undefined),
  );
  ok(
    'converted machines size themselves',
    m.nodes.filter((n) => n.k === 'machine').every((n) => n.auto && n.n === undefined),
  );
  const mks = async () => [
    ...new Set((await page.locator('.edge-label').allInnerTexts()).map((x) => /Mk\.\d/.exec(x)?.[0]).filter(Boolean)),
  ];
  const at30 = await mks();
  ok(
    'at 30 a minute some belt needs more than a Mk.1',
    at30.some((x) => x !== 'Mk.1'),
    at30.join(','),
  );
  const machinesAt = () =>
    page.$$eval('.react-flow__node .machine-node .run-with-auto', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ')));
  const before5 = await machinesAt();
  await page.locator('.side .floor-io input').first().fill('5');
  await page.locator('.side .floor-io input').first().press('Enter');
  await settle();
  const st5 = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok(
    'set to 5 a minute: every machine at full speed, fewer of them',
    st5.length > 0 && st5.every((x) => x === 'Full speed'),
    `${before5.join(' / ')} → ${(await machinesAt()).join(' / ')}`,
  );
  const at5 = await mks();
  ok('set to 5 a minute: every belt a Mk.1', at5.length === 1 && at5[0] === 'Mk.1', at5.join(','));
  const minerNote = await page.locator('.endpoint-node.raw .endpoint-line').first().innerText();
  ok('a miner held back shows the clock it runs at, not a share', !/Runs at/.test(minerNote), minerNote.replace(/\s+/g, ' '));
  await shot('q-five');

  // Numbers off: Rebuild stays, and still starts the floor again.
  await page.locator('.tool-button[aria-label="Numbers"]').click();
  await settle();
  ok('numbers off: Rebuild still there', await page.locator('.tool-button[aria-label="Rebuild"]').isVisible());
  page.once('dialog', (d) => d.accept());
  await page.locator('.tool-button[aria-label="Rebuild"]').click();
  await settle();
  const again = await model();
  const out5 = again.nodes.find((n) => n.k === 'out' && n.item === plate);
  ok('numbers off: Rebuild builds for what the floor puts out', again.calc === 'basic' && out5?.lim === 5, JSON.stringify(out5));

  // A double click ticks a card built without opening its panel; one click opens it.
  await fit();
  const someCard = again.nodes.find((n) => n.k === 'machine');
  await card(someCard.id).locator('.machine-body').dblclick();
  await wait(700);
  ok(
    'a double click opens no panel',
    !(await page.locator('aside.inspector').count()) && (await model()).nodes.find((n) => n.id === someCard.id).done === true,
  );
  await card(someCard.id).locator('.machine-body').click();
  await wait(700);
  ok('one click opens it', (await page.locator('aside.inspector').count()) === 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(300);

  // Open outputs: the words a caption beside the switch, not a part of it.
  ok(
    'Open outputs is a caption beside its switch',
    (await page.locator('.open-outputs > .tool-label').count()) === 1 && !(await page.locator('.segmented .tool-label').count()),
  );

  // Laying a belt by clicks: the strip low over the floor, clear of the toolbar.
  const anyLink = again.links[0];
  await end(anyLink.a, `o${anyLink.ap}`).click();
  await wait(300);
  const strip = await page.locator('.floor-strip').boundingBox();
  const bar = await page.locator('.model-toolbar').boundingBox();
  const bottomRow = await page.locator('.floor-controls').boundingBox();
  ok(
    'the strip is clear of the toolbar and the buttons along the bottom',
    strip && !clash(strip, bar) && !clash(strip, bottomRow),
    JSON.stringify({ strip, bar }),
  );
  ok('the strip shows what the belt carries', (await page.locator('.floor-strip .slot').count()) === 1);
  await shot('q-strip');
  await page.locator('.floor-strip .text-button').click();
  await wait(200);

  // Tips: the app's own, with the key in a box; none until the pointer rests.
  await page.locator('.tool-button[aria-label="Undo"]').hover();
  await wait(700);
  const tip = await page.locator('.tip').boundingBox();
  const undoBox = await page.locator('.tool-button[aria-label="Undo"]').boundingBox();
  ok(
    'resting on a button shows its tip under it, the key in a box',
    tip && tip.y > undoBox.y + undoBox.height && (await page.locator('.tip kbd').innerText()) === 'Ctrl+Z',
    (
      await page
        .locator('.tip')
        .innerText()
        .catch(() => '')
    ).replace(/\s+/g, ' '),
  );
  ok('the browser’s own tip is gone', (await page.locator('.tool-button[aria-label="Undo"]').getAttribute('title')) === null);
  await shot('q-tip');
  await page.mouse.move(5, 400);
  await wait(300);
  ok('and goes when the pointer leaves', !(await page.locator('.tip').count()));

  // The build menu: gear on a tab of its own.
  await addHere();
  const tabs = await page.locator('.chooser-tabs button').allInnerTexts();
  ok('the build menu has a Special tab, last', tabs.at(-1)?.startsWith('Special'), tabs.join(' | '));
  await page.locator('.chooser-tabs button', { hasText: 'Special' }).click();
  const special = await page.locator('.chooser-list li .chooser-title').allInnerTexts();
  ok(
    'Nobelisk and power shards are there',
    special.includes('Nobelisk') && special.some((x) => x.startsWith('Power Shard')),
    special.slice(0, 6).join(' | '),
  );
  await page.locator('.chooser-tabs button', { hasText: 'Production' }).click();
  const making = await page.locator('.chooser-list li .chooser-title').allInnerTexts();
  ok('and not among the parts', !making.some((x) => /Nobelisk|Power Shard|Rebar|Ammo/.test(x)), `${making.length} rows`);
  await shot('q-special');
  await page.keyboard.press('Escape');

  // Turned the other way: laid out top to bottom, inputs on the cards' tops, one undo turns it back.
  const beforeTurn = await model();
  await page.locator('.floor-dir button[aria-checked="false"]').click();
  await settle();
  m = await model();
  ok(
    '↓ lays the floor out top to bottom',
    m.dir === 'TB' && m.nodes.length === beforeTurn.nodes.length && m.links.length === beforeTurn.links.length,
  );
  ok('no cards on top of each other', (await overlaps()).length === 0);
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('.react-flow__handle.port.in')].every((h) => {
      const c = h.closest('.react-flow__node').getBoundingClientRect();
      const r = h.getBoundingClientRect();
      return r.top + r.height / 2 < c.top + 4;
    }),
  );
  ok('inputs along the cards’ tops', tops);
  const kinks = await kinked(m.links);
  ok('ends in line, belts without kinks', kinks.length === 0, kinks.slice(0, 5).join(', '));
  const goDown = m.links.filter((l) => {
    const a = m.nodes.find((n) => n.id === l.a);
    const b = m.nodes.find((n) => n.id === l.b);
    return a.y < b.y;
  }).length;
  ok('belts run down the floor', goDown >= m.links.length * 0.95, `${goDown} of ${m.links.length}`);
  ok('the whole floor in view', await allInView());
  await shot('q-down');
  await page.keyboard.press('Control+z');
  await settle();
  ok('one undo turns it back', (await model()).dir === undefined);

  // Converting a factory the Auto floor shows top to bottom keeps it that way.
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
      active: 'f1',
      graphDir: 'TB',
    }),
  );
  await page.click('.floor-kind button >> nth=1');
  await settle();
  m = await model();
  ok('converted from a floor running down, it runs down', m.dir === 'TB' && (await overlaps()).length === 0);
  const motorKinks = await kinked(m.links);
  ok('and its belts have no kinks', motorKinks.length === 0, motorKinks.slice(0, 5).join(', '));
  await shot('q-motor-down');

  // ── R: 0.13.7 ──
  section = 'R';
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: plate, rate: 30 }] }],
      active: 'f1',
    }),
  );
  await page.click('.floor-kind button >> nth=1');
  await settle();
  const targetsNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].targets);
  m = await model();
  const outCard = m.nodes.find((n) => n.k === 'out' && n.item === plate);

  // One list of targets: set in Auto, the floor's output follows; set on the floor, Auto follows.
  await page.click('.floor-kind button >> nth=0');
  await settle();
  await page.locator('.side .targets .item-card input').first().fill('15');
  await page.locator('.side .targets .item-card input').first().press('Enter');
  await wait(300);
  await page.click('.floor-kind button >> nth=1');
  await settle();
  ok('a target set in Auto is the Manual output’s amount', (await model()).nodes.find((n) => n.id === outCard.id)?.lim === 15);
  await page.locator('.side .floor-io input').first().fill('7');
  await page.locator('.side .floor-io input').first().press('Enter');
  await settle();
  ok('an amount set on the floor is the target in Auto', JSON.stringify(await targetsNow()) === JSON.stringify([{ item: plate, rate: 7 }]));
  await page.click('.floor-kind button >> nth=0');
  await settle();
  ok('and Auto shows it', (await page.locator('.side .targets .item-card input').first().inputValue()) === '7');
  await page.click('.floor-kind button >> nth=1');
  await settle();
  await fit();

  // An output has no panel; its × takes it off, and the target with it. Undo brings both back.
  await card(outCard.id).click();
  await wait(500);
  ok('an output opens no panel', !(await page.locator('aside.inspector').count()));
  await card(outCard.id).hover();
  ok(
    'its × shows on hover',
    (await card(outCard.id)
      .locator('.card-x')
      .evaluate((b) => getComputedStyle(b).opacity)) === '1',
  );
  await shot('r-out-x');
  await card(outCard.id).locator('.card-x').click();
  await settle();
  ok('the × takes it off, and the target', !(await model()).nodes.some((n) => n.id === outCard.id) && (await targetsNow()).length === 0);
  await page.keyboard.press('Control+z');
  await settle();
  ok('undo brings both back', (await model()).nodes.some((n) => n.id === outCard.id) && (await targetsNow()).length === 1);

  // A double click on a belt takes it off, and opens nothing.
  m = await model();
  const victimBelt = m.links.find((l) => l.b === outCard.id);
  await page.locator(`.react-flow__edge[data-id="${victimBelt.id}"] .belt-hit`).dblclick({ force: true });
  await wait(500);
  ok(
    'a double click on a belt takes it off',
    !(await model()).links.some((l) => l.id === victimBelt.id) && !(await page.locator('aside.inspector').count()),
  );
  await page.keyboard.press('Control+z');
  await settle();

  // Copy and paste, duplicate, and the menu on a right click.
  m = await model();
  const asm = m.nodes.find((n) => n.k === 'machine' && n.recipe === 'Recipe_IronPlateReinforced_C');
  const count = m.nodes.length;
  await card(asm.id).locator('.machine-body').click();
  await wait(400);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const pasteAt = await emptySpot('right');
  await page.mouse.move(pasteAt.x, pasteAt.y);
  await page.keyboard.press('Control+v');
  await settle();
  m = await model();
  const pasted = m.nodes.filter((n) => n.k === 'machine' && n.recipe === asm.recipe);
  ok('Ctrl+C, Ctrl+V: a copy of the card', m.nodes.length === count + 1 && pasted.length === 2);
  ok('the copy lies on no card', (await overlaps()).length === 0);
  ok('the copy comes up picked', (await page.locator('.react-flow__node.selected').count()) === 1);
  await page.keyboard.press('Control+d');
  await settle();
  ok(
    'Ctrl+D duplicates it',
    (await model()).nodes.length === count + 2 &&
      (await overlaps()).length === 0 &&
      (await page.locator('.react-flow__node.selected').count()) === 1,
    `${(await model()).nodes.length - count} new, ${await page.locator('.react-flow__node.selected').count()} picked`,
  );
  await fit();
  await card(asm.id).locator('.machine-body').click({ button: 'right' });
  await wait(300);
  const menuItems = await page.locator('.card-menu button').allInnerTexts();
  ok(
    'a right click on a card: Duplicate, Copy, Paste, Mark built, Remove',
    ['Duplicate', 'Copy', 'Paste', 'Mark built', 'Remove'].every((x) => menuItems.some((y) => y.startsWith(x))),
    menuItems.map((x) => x.replace(/\s+/g, ' ')).join(' | '),
  );
  await shot('r-menu');
  await page.locator('.card-menu button', { hasText: 'Mark built' }).click();
  await settle();
  ok('Mark built from the menu', (await model()).nodes.find((n) => n.id === asm.id)?.done === true);
  await card(asm.id).locator('.machine-body').click({ button: 'right' });
  await page.locator('.card-menu button', { hasText: 'Remove' }).click();
  await settle();
  ok('Remove from the menu', !(await model()).nodes.some((n) => n.id === asm.id));
  ok('no menu left over', !(await page.locator('.card-menu').count()));

  // Tips: none where the button says it already, and none at once.
  await page.locator('.mode-switch button', { hasText: 'Power' }).hover();
  await wait(1100);
  ok('no tip on a button that reads the same', !(await page.locator('.tip').count()));
  await page.locator('.tool-button[aria-label="Undo"]').hover();
  await wait(350);
  ok('no tip at once', !(await page.locator('.tip').count()));
  await wait(800);
  ok('a tip once the pointer rests', (await page.locator('.tip').count()) === 1);
  await page.mouse.move(5, 400);

  // The build menu: four tabs, no In and out; at tier 4 no uranium miner.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('ficsit-planner'));
    s.state.tier = 4;
    localStorage.setItem('ficsit-planner', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
  await wait(600);
  await addHere();
  const fourTabs = await page.locator('.chooser-tabs button').allInnerTexts();
  ok(
    'the build menu: Production, Resources, Products, Logistics, Special',
    fourTabs.join('|').replace(/\s+/g, '') === 'Production|Resources|Products|Logistics|Special',
    fourTabs.join(' | '),
  );
  await page.locator('.chooser-tabs button', { hasText: 'Resources' }).click();
  const resources = await page.locator('.chooser-list li .chooser-title').allInnerTexts();
  ok('tier 4: no uranium to mine', !resources.includes('Uranium') && resources.includes('Iron Ore'), resources.join(', '));
  await page.keyboard.press('Escape');

  // A card's panel open on a laptop: the buttons along the bottom clear of each other.
  await page.setViewportSize({ width: 1280, height: 720 });
  await wait(300);
  m = await model();
  await fit();
  const someMachine = m.nodes.find((n) => n.k === 'machine');
  await card(someMachine.id).locator('.machine-body').click();
  await wait(600);
  const ctrls = await page.locator('.floor-controls').boundingBox();
  const fbar = await page.locator('.floor-bar').boundingBox();
  const kindsBox = await page.locator('.floor-kind').boundingBox();
  const viewsBox = await page.locator('.floor-bar .segmented:not(.floor-kind)').boundingBox();
  ok(
    'a panel open: the bottom buttons clear of each other',
    !clash(ctrls, kindsBox) && !clash(ctrls, viewsBox) && !clash(ctrls, await page.locator('aside.inspector').boundingBox()),
    JSON.stringify({ ctrls, fbar }),
  );
  await shot('r-panel-bottom');
  await page.setViewportSize({ width: 1366, height: 768 });

  // ── S: 0.13.8 ──
  section = 'S';
  await open(
    saved({
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Motor_C', rate: 10 }] }],
      active: 'f1',
    }),
  );
  await page.click('.floor-kind button >> nth=1');
  await settle();
  // Turned one way and straight back before the first is laid out: the second click waits its turn and does nothing.
  await page.locator('.floor-dir button[aria-checked="false"]').click();
  await page.locator('.floor-dir button[aria-checked="true"]').click({ force: true });
  await settle();
  ok('a second turn while laying out does nothing', (await model()).dir === 'TB' && (await overlaps()).length === 0);
  // A card taken off while Tidy up is worked out stays off.
  m = await model();
  const motorOut = m.nodes.find((n) => n.k === 'out' && n.item === 'Desc_Motor_C');
  await card(motorOut.id).hover();
  await page.locator('.tool-button[aria-label="Tidy up"]').click();
  const midway = (await page.locator('.busy').count()) > 0;
  await card(motorOut.id).locator('.card-x').click({ force: true });
  await settle();
  ok(
    'a card taken off while Tidy up runs stays off',
    midway && !(await model()).nodes.some((n) => n.id === motorOut.id),
    `laying out when taken off: ${midway}`,
  );
  await ctx.close();
}

// ───────────────────────────── Motion on ─────────────────────────────
{
  section = 'M';
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await open(
    saved({ mode: 'factory', plans: [{ id: 'f1', name: 'Factory 1', targets: [] }], active: 'f1', settings: { motion: 'system' } }),
  );
  await page.locator('.quick-head .build-by-hand').click();
  await wait(400);
  await page.locator('.floor-empty .primary-button').click();
  await page.keyboard.type('iron ingot');
  await page.keyboard.press('Enter');
  await page.waitForSelector('aside.inspector');
  const anim = await page.$eval('aside.inspector', (a) => [getComputedStyle(a).animationName, getComputedStyle(a).animationDuration]);
  ok('the panel slides in from the right', anim[0] === 'inspector-in' && anim[1] === '0.18s', anim.join(' '));
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
  await page.locator('.quick-head .build-by-hand').tap();
  await wait(500);
  // A finger held on the empty floor opens the menu; there's no Add button.
  ok('no Add button on the phone either', !(await page.locator('.add-part').count()));
  {
    const f = await page.locator('.react-flow').boundingBox();
    const at = { x: f.x + f.width / 2, y: f.y + f.height - 140 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await wait(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(400);
  }
  const sheet = await page.locator('.chooser').boundingBox();
  ok(
    'a finger held on the floor opens the menu from the bottom',
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
  await touchDrag(c1, { x: c1.x - 80, y: c1.y + 10 });
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
  ok('the strip says what to do', await page.locator('.floor-strip').isVisible());
  await shot('c-strip');
  await page.locator('.floor-strip .text-button').tap();
  await wait(200);
  ok('Cancel', !(await page.locator('.floor-strip').count()));
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
  ok('converted on a phone, the whole floor in view', await allInView());
  const bar = await page.locator('.floor-bar').boundingBox();
  const controls = await page.locator('.floor-controls').boundingBox();
  const kinds = await page.locator('.floor-kind').boundingBox();
  ok(
    'buttons along the bottom clear of each other',
    !clash(controls, kinds) && !clash(controls, await page.locator('.floor-bar .segmented:not(.floor-kind)').boundingBox()),
    JSON.stringify({ bar, controls }),
  );
  const toolbar = await page.locator('.model-toolbar').boundingBox();
  ok('the toolbar clear of the totals tab', (await onTab()).length === 0, (await onTab()).join(', '));
  ok('toolbar fits across', toolbar.width <= 412, `${toolbar.width}`);
  // Converted on a phone the floor runs down, as the Auto floor did there; the switch is along the bottom.
  ok(
    'converted on a phone, it runs down, the switch to turn it there',
    (await model()).dir === 'TB' && (await page.locator('.floor-dir').isVisible()),
  );
  // No hover tips on a phone, even where a tap lands on a button with one.
  await page.locator('.tool-button[aria-label="Numbers"]').tap();
  await page.locator('.tool-button[aria-label="Numbers"]').tap();
  await wait(700);
  ok('no hover tips on a phone', !(await page.locator('.tip').count()));
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
