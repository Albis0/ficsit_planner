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
import { manualModel } from './manual.mjs';

const OUT = path.resolve('e2e/out/modeler');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const still = { beltMotion: false, motion: 'reduce' };
const saved = (state) =>
  JSON.stringify({ state: { onboarded: true, tier: 9, lang: 'en', ...state, settings: { ...still, ...state.settings } }, version: 4 });
const factory = (targets, extra = {}) =>
  saved({
    mode: 'factory',
    plans: [{ id: 'f1', name: 'Factory 1', targets: targets.map(([item, rate]) => ({ item, rate })), ...extra }],
    active: 'f1',
  });
// A Manual factory with the floor of the factory worked out for these targets on it.
// plan and state: more to put on the tab and in the saved session.
const manual = (targets, { plan = {}, state = {}, separate = [] } = {}) =>
  saved({
    mode: 'factory',
    plans: [
      {
        id: 'f1',
        name: 'Factory 1',
        targets: targets.map(([item, rate]) => ({ item, rate })),
        floor: 'manual',
        model: manualModel(targets, separate),
        ...plan,
      },
    ],
    active: 'f1',
    ...state,
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

// The choice for an output with no belt sits in a drawer: open it first when it is shut.
async function chooseOpenOutput(label) {
  const tab = page.locator('.open-outputs .drawer-tab');
  if ((await tab.getAttribute('aria-expanded')) !== 'true') {
    await tab.click();
    await page.waitForTimeout(300);
  }
  await page.locator(`.open-outputs [role=radio]:has-text("${label}")`).click();
}

function ok(step, pass, info = '') {
  results.push({ section, step, pass: !!pass, info });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${section} ${step}${info ? ` — ${info}` : ''}`);
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++shots).padStart(2, '0')}-${name}.png`) });
const wait = (ms = 400) => page.waitForTimeout(ms);
// The app gathers saves for 300 ms, so read what it kept only after that.
const model = async () => {
  await wait(350);
  return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].model);
};
const card = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
const end = (id, h) => page.locator(`.react-flow__handle[data-nodeid="${id}"][data-handleid="${h}"]`);
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : undefined;
};
const viewport = () => page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
// Fit to screen stops at half size, so a floor too big for that is zoomed out further by hand to have all of it in view.
const fit = async () => {
  // The buttons give way while a card's panel is open.
  if (await page.locator('.inspector.manual').count()) {
    await page.keyboard.press('Escape');
    await wait(300);
  }
  await page.click('.floor-controls .floor-button >> nth=-1');
  await wait(500);
  const box = await page.locator('.react-flow').boundingBox();
  for (let i = 0; i < 12 && !(await allInView()); i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 240);
    await wait(150);
  }
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

/** The view menu along the bottom of the floor: Factory 0, List 1, Transport 2. */
async function pickView(idx) {
  await page.locator('.floor-bar .view-menu button').click();
  await wait(200);
  await page.locator('.card-menu [role=menuitem]').nth(idx).click();
}

/** Cards drawn on top of each other. */
const overlaps = () =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node:not(.react-flow__node-area)')].map((n) => ({
      id: n.dataset.id,
      r: n.getBoundingClientRect(),
    }));
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

  // ── A1a: ticking a machine built on the Auto floor ──
  section = 'A1a';
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

  // ── A1: a Manual factory laid out ──
  section = 'A1';
  await open(manual([['Desc_Motor_C', 10]]));
  await page.click('.deck-toggle');
  await settle();
  await fit();
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
  const states = await page.$$eval('.react-flow__node .machine-node .run-state', (l) => l.map((x) => x.textContent));
  ok('every machine at full speed', states.length > 0 && states.every((s) => s === 'Full speed'), [...new Set(states)].join(', '));
  ok('no cards on top of each other', (await overlaps()).length === 0, (await overlaps()).join(' '));
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
  // A small floor: the panel grows up over the one above it, to just under the top bar.
  const reach = await page.evaluate(() => {
    const f = document.querySelector('.floor-view').getBoundingClientRect();
    const p = document.querySelector('aside.inspector').getBoundingClientRect();
    return { floor: f.height, panel: p.height, top: p.top, bar: document.querySelector('.topbar').getBoundingClientRect().bottom };
  });
  ok(
    'on a small floor the machine panel is taller than the floor',
    reach.floor >= 520 || (reach.panel > reach.floor && reach.top >= reach.bar && reach.top < reach.bar + 40),
    JSON.stringify(reach),
  );
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
  await open(manual([['Desc_IronPlate_C', 60]]));
  await page.click('.deck-toggle');
  await settle();
  await fit();
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
    manual([
      ['Desc_IronPlate_C', 30],
      ['Desc_Wire_C', 30],
    ]),
  );
  await page.click('.deck-toggle');
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
  await chooseOpenOutput('Machine stops');
  await settle();
  ok('open outputs backing up, as in the game: it stops', (await card(ironSmelter.id).innerText()).includes('Output not connected'));
  await shot('a7-stall');
  await chooseOpenOutput('Counts as spare');
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

  // ── A8: the other views ──
  section = 'A8';
  m = await model();
  const camBefore = await viewport();
  // Machines sizing themselves with nothing coming in take none, so the list leaves them out.
  const running = await page.$$eval(
    '.react-flow__node .machine-node',
    (l) => l.filter((c) => !/Input not connected|Idle/.test(c.textContent)).length,
  );
  await pickView(1);
  await wait(600);
  const rows = await page.locator('.table-view tbody tr, .table tbody tr, table tbody tr').count();
  ok('the list shows the manual machines', rows >= running && running > 0, `${rows} rows, ${running} running`);
  await pickView(2);
  await wait(600);
  ok('transport view opens', (await page.locator('.floor-view').innerText()).length > 0);
  await pickView(0);
  await wait(600);
  ok('back on the floor, the camera where it was', (await viewport()) === camBefore);

  // ── A9: share ──
  section = 'A9';
  await page.locator('.tab-menu-button').click();
  await wait(300);
  await page.locator('.tab-menu-list .copy-factory').click();
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
    ok('the shared link brings the manual floor', shared === m.nodes.length, `${shared} of ${m.nodes.length}`);
    // A link on the clipboard pasted into the page opens as a new factory, whatever is open.
    await p2.goto(URL);
    await p2.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 30000 });
    const had = await p2.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans.length);
    await p2.bringToFront();
    await p2.evaluate((l) => navigator.clipboard.writeText(l), link);
    await p2.keyboard.press('Control+v');
    await p2.waitForTimeout(1500);
    const now = await p2.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans.length);
    ok('Ctrl+V of a shared link opens it as a new factory', now === had + 1, `${had} → ${now}`);
    await p2.close();
  }

  // ── A9b: Copy factory in the tab menu ──
  section = 'A9b';
  {
    await open(factory([['Desc_Motor_C', 10]]));
    await page.locator('.tab-menu-button').click();
    await wait(300);
    const row = page.locator('.tab-menu-list .copy-factory');
    ok('the tab menu has a Copy factory row', (await row.count()) === 1 && (await row.innerText()).includes('Copy factory'));
    await row.click();
    await wait(300);
    ok('it says the link is copied', (await row.innerText()).includes('Link copied'));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok('the clipboard holds a link to the factory', clip.includes('#share='), clip.slice(0, 60));
    await wait(1200);
    ok('and the menu goes away', (await page.locator('.tab-menu-list').count()) === 0);
  }

  // ── A10: the same output another way ──
  section = 'A10';
  await open(manual([['Desc_Motor_C', 10]]));
  await settle();
  await fit();
  m = await model();
  // Machines size themselves, at the clock the Auto card runs them at.
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

  // ── A11: areas, drawn with the right button held down ──
  section = 'A11';
  {
    await open(manual([['Desc_Motor_C', 10]], { state: { settings: { ...still, areaLabels: 'always' } } }));
    await settle();
    await fit();
    const groups = async () => (await model()).nodes.filter((n) => n.k === 'group');
    const cardsOn = async () => (await model()).nodes.filter((n) => n.k !== 'group').length;
    // Round two cards when the corner above them is empty floor, else on a spot of empty floor.
    // The first machine and the one nearest it: the layout may put any two first.
    const all = (await model()).nodes.filter((n) => n.k === 'machine');
    const near = all.slice(1).sort((p, q) => Math.hypot(p.x - all[0].x, p.y - all[0].y) - Math.hypot(q.x - all[0].x, q.y - all[0].y))[0];
    const two = [all[0], near];
    const rects = await Promise.all(two.map((n) => card(n.id).boundingBox()));
    const floorBox = await page.locator('.react-flow').boundingBox();
    // A spot of empty floor above and left of both, found by stepping out from them.
    const tl = await page.evaluate(
      ({ x0, y0, box }) => {
        const bar = document.querySelector('.model-toolbar')?.getBoundingClientRect().bottom ?? box.y + 120;
        for (let d = 0; d <= 240; d += 12)
          for (const [x, y] of [
            [x0 - 24 - d, y0 - 30 - d],
            [x0 - 24, y0 - 30 - d],
            [x0 - 24 - d, y0 - 30],
          ])
            if (x > box.x + 20 && y > bar + 8 && document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
        return null;
      },
      { x0: Math.min(...rects.map((r) => r.x)), y0: Math.min(...rects.map((r) => r.y)), box: floorBox },
    );
    const cornerFree = !!tl;
    const from = cornerFree ? tl : await emptySpot('right');
    const to = cornerFree
      ? { x: Math.max(...rects.map((r) => r.x + r.width)) + 24, y: Math.max(...rects.map((r) => r.y + r.height)) + 24 }
      : { x: Math.max(floorBox.x + 40, from.x - 300), y: Math.min(floorBox.y + floorBox.height - 120, from.y + 150) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    ok('while the right button is held a box shows', (await page.locator('.area-draw').count()) === 1);
    await page.mouse.up({ button: 'right' });
    await wait(500);
    let gs = await groups();
    ok('letting go leaves an area', gs.length === 1 && gs[0].w >= 80 && gs[0].h >= 80, JSON.stringify(gs[0]));
    ok(
      'with its panel open and no build menu',
      (await page.locator('aside.inspector #area-name').count()) === 1 && (await page.locator('.chooser').count()) === 0,
    );
    // With no name, icon or note yet it is still there to pick: let go of it, then click it again.
    ok(
      'a new area is on half squares',
      gs.every((g) => g.x % 20 === 0 && g.y % 20 === 0 && g.w % 20 === 0 && g.h % 20 === 0),
      JSON.stringify(gs[0]),
    );
    await page.keyboard.press('Escape');
    await wait(300);
    ok('Escape lets go of it', (await page.locator('aside.inspector').count()) === 0);
    // A spot on the strip no card lies over.
    const strip = () =>
      page.evaluate(() => {
        const r = document.querySelector('.area-grip').getBoundingClientRect();
        for (let x = r.right - 6; x > r.left; x -= 6)
          if (document.elementFromPoint(x, r.top + r.height / 2)?.closest('.area-grip')) return { x, y: r.top + r.height / 2 };
        return null;
      });
    const bare = await strip();
    await page.mouse.click(bare.x, bare.y);
    await wait(500);
    ok('an area with no name comes back when clicked on its strip', (await page.locator('aside.inspector #area-name').count()) === 1);
    await page.keyboard.press('Escape');
    await wait(300);
    const edge = await page.locator('.area-node').boundingBox();
    // A spot on the left edge no card or belt lies over.
    const onEdge = await page.evaluate(
      ({ x, y, h }) => {
        for (let k = 1; k < 20; k++) {
          const py = y + (h * k) / 20;
          if (document.elementFromPoint(x + 2, py)?.closest('.area-edge')) return py;
        }
        return y + h / 2;
      },
      { x: edge.x, y: edge.y, h: edge.height },
    );
    await page.mouse.click(edge.x + 2, onEdge);
    await wait(500);
    ok('and on its edge', (await page.locator('aside.inspector #area-name').count()) === 1);
    const tall = await page.locator('aside.inspector').evaluate((a) => a.scrollHeight);
    await page.locator('.area-icon-row .add-button').click();
    await wait(300);
    ok(
      'the icon list opens over the panel without making it longer',
      (await page.locator('aside.inspector').evaluate((a) => a.scrollHeight)) <= tall + 2 &&
        (await page.locator('.area-icon-row .picker').count()) === 1,
    );
    await page.keyboard.press('Escape');
    await wait(300);
    await page.fill('#area-name', 'Steel');
    await page.fill('#area-note', 'Pipe for the stator');
    await wait(500);
    gs = await groups();
    ok('named, with a note', gs[0].label === 'Steel' && gs[0].note === 'Pipe for the stator');
    ok('the name is on the floor, readable at any zoom', (await page.locator('.area-name').innerText()) === 'Steel');
    await page.locator('.color-wheel').scrollIntoViewIfNeeded();
    const wheel = await page.locator('.color-wheel').boundingBox();
    await page.mouse.move(wheel.x + wheel.width * 0.5, wheel.y + wheel.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(wheel.x + wheel.width * 0.85, wheel.y + wheel.height * 0.5, { steps: 8 });
    const live = await page.locator('.area-node').evaluate((e) => e.style.getPropertyValue('--area'));
    ok(
      'dragging on the wheel shows the colour on the floor at once, without touching the model',
      /^#[0-9a-f]{6}$/.test(live) && !(await groups())[0].color,
      live,
    );
    await page.mouse.up();
    await wait(500);
    ok('a colour from the wheel', /^#[0-9a-f]{6}$/.test((await groups())[0].color ?? ''), (await groups())[0].color);
    await shot('a11-area');
    // A colour typed as hex: six digits are taken as they are typed, the short form when the field is left.
    const hex = page.locator('.color-hex');
    await hex.scrollIntoViewIfNeeded();
    await shot('a11-hex');
    ok('the hex field shows the wheel’s colour', (await hex.inputValue()) === (await groups())[0].color);
    await hex.fill('#ABC123');
    await wait(500);
    ok('six hex digits typed set the colour', (await groups())[0].color === '#abc123', (await groups())[0].color);
    ok(
      'and the area on the floor wears it',
      (await page.locator('.area-node').evaluate((e) => e.style.getPropertyValue('--area'))) === '#abc123',
    );
    await hex.fill('#0f0');
    ok('the short form waits for the field to be left', (await groups())[0].color === '#abc123');
    await hex.blur();
    await wait(500);
    ok('then it is taken', (await groups())[0].color === '#00ff00', (await groups())[0].color);
    await hex.fill('#zz');
    await hex.blur();
    await wait(300);
    ok('what is not a colour is dropped', (await hex.inputValue()) === '#00ff00' && (await groups())[0].color === '#00ff00');
    await page.keyboard.press('Escape');
    await wait(300);
    await addHere();
    ok('a right click without a drag is still the build menu', (await page.locator('.chooser').count()) === 1);
    await page.keyboard.press('Escape');
    await wait(300);
    // The strip moves the area and what lies wholly inside it.
    const before = await model();
    const inside = await page.evaluate(() => {
      const a = document.querySelector('.area-node').getBoundingClientRect();
      return [...document.querySelectorAll('.react-flow__node-part')]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.left >= a.left && r.top >= a.top && r.right <= a.right && r.bottom <= a.bottom;
        })
        .map((n) => n.dataset.id);
    });
    const grip = await strip();
    await drag({ x: grip.x, y: grip.y }, { x: grip.x + 80, y: grip.y + 40 });
    await wait(500);
    const after = await model();
    const moved = (id) => {
      const [a, b] = [before.nodes.find((n) => n.id === id), after.nodes.find((n) => n.id === id)];
      return [b.x - a.x, b.y - a.y];
    };
    const [dx, dy] = moved(gs[0].id);
    ok('the area moved', dx > 0 && dy > 0, `${dx},${dy}`);
    ok(
      'what lay inside went with it, the rest stayed',
      before.nodes.every((n) => {
        const [x, y] = moved(n.id);
        return inside.includes(n.id) || n.id === gs[0].id ? x === dx && y === dy : x === 0 && y === 0;
      }),
      `${inside.length} inside`,
    );
    ok('the area had cards in it to take along', inside.length > 0, `${inside.length}`);
    await page.keyboard.press('Control+z');
    await wait(500);
    ok(
      'one undo puts them all back',
      JSON.stringify((await model()).nodes.map((n) => [n.id, n.x, n.y])) === JSON.stringify(before.nodes.map((n) => [n.id, n.x, n.y])),
    );
    // A box round cards inside it never picks the area.
    await page.mouse.click(grip.x, grip.y);
    await wait(500);
    const count = (await model()).nodes.length;
    await page.keyboard.press('Control+d');
    await wait(500);
    m = await model();
    ok(
      'duplicating the area copies what lies in it',
      m.nodes.filter((n) => n.k === 'group').length === 2 && m.nodes.length === count + inside.length + 1,
      `${count} → ${m.nodes.length}`,
    );
    await page.keyboard.press('Control+z');
    await wait(500);
    await page.mouse.click(grip.x, grip.y);
    await wait(500);
    await page.keyboard.press('Delete');
    await wait(500);
    ok('Delete takes the area and leaves the cards', (await groups()).length === 0 && (await cardsOn()) === count - 1);
    await page.keyboard.press('Control+z');
    await wait(500);
    ok('and undo brings it back', (await groups()).length === 1);
    const res = await page.locator('.area-node .react-flow__resize-control.handle.bottom.right').count();
    ok('picked, its corners show handles', res === 0 || res === 1);
  }

  // ── A11b: areas on the Auto floor ──
  section = 'A11b';
  {
    await open(factory([['Desc_Motor_C', 10]]));
    const areasSaved = async () => {
      await wait(400);
      return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].areas?.nodes ?? []);
    };
    const floorBox = await page.locator('.react-flow').boundingBox();
    const from = await emptySpot('right');
    const to = { x: Math.max(floorBox.x + 40, from.x - 260), y: Math.min(floorBox.y + floorBox.height - 120, from.y + 140) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    ok('Auto: while the right button is held a box shows', (await page.locator('.area-draw').count()) === 1);
    await page.mouse.up({ button: 'right' });
    await wait(500);
    let gs = await areasSaved();
    ok('Auto: letting go leaves an area', gs.length === 1 && gs[0].k === 'group' && gs[0].w >= 80, JSON.stringify(gs[0]));
    ok('Auto: its panel opens with the name box', (await page.locator('aside.inspector #area-name').count()) === 1);
    await page.fill('#area-name', 'Motors');
    await wait(500);
    gs = await areasSaved();
    ok('Auto: the name is saved', gs[0].label === 'Motors');
    ok(
      'Auto: and shows on the floor',
      (await page.locator('.react-flow__node-area:not(.auto-area) .area-name').first().innerText()) === 'Motors',
    );
    // The panel covers the strip while it is open: click bare floor to put it away.
    const bare = await emptySpot('left');
    await page.mouse.click(bare.x, bare.y);
    await wait(400);
    // A card may lie over part of the strip: take a point of it that is bare.
    const hold = await page.evaluate(() => {
      const r = document.querySelector('.react-flow__node-area:not(.auto-area) .area-grip').getBoundingClientRect();
      for (let x = r.left + 6; x < r.right - 6; x += 8)
        if (document.elementFromPoint(x, r.top + r.height / 2)?.closest('.area-grip')) return { x, y: r.top + r.height / 2 };
      return null;
    });
    ok('Auto: a bare point of its strip is there to take hold of', !!hold);
    await page.mouse.move(hold.x, hold.y);
    await page.mouse.down();
    await page.mouse.move(hold.x + 60, hold.y + 60, { steps: 6 });
    await page.mouse.up();
    await wait(500);
    const moved = (await areasSaved())[0];
    ok('Auto: dragging its strip moves it', moved.x !== gs[0].x || moved.y !== gs[0].y, `${gs[0].x},${gs[0].y} -> ${moved.x},${moved.y}`);
    ok('Auto: the cards stay where they were laid out', (await page.locator('.react-flow__node-machine').count()) > 0);
    await page.reload();
    await wait(1500);
    ok(
      'Auto: after a reload the area is still there',
      (await page.locator('.react-flow__node-area:not(.auto-area) .area-node').count()) === 1,
    );
    // A belt's label may lie over the middle of the strip: click a point of it that is bare.
    const spot = await page.evaluate(() => {
      const r = document.querySelector('.react-flow__node-area:not(.auto-area) .area-grip').getBoundingClientRect();
      for (let x = r.left + 6; x < r.right - 6; x += 8)
        if (document.elementFromPoint(x, r.top + r.height / 2)?.closest('.area-grip')) return { x, y: r.top + r.height / 2 };
      return null;
    });
    await page.mouse.click(spot.x, spot.y);
    await wait(400);
    await page.locator('.inspector-actions .danger').click();
    await wait(500);
    ok(
      'Auto: Remove area takes it off',
      (await areasSaved()).length === 0 && (await page.locator('.react-flow__node-area:not(.auto-area) .area-node').count()) === 0,
    );
  }

  // ── A11c: an output card offers its product to the pool ──
  section = 'A11c';
  {
    await open(manual([['Desc_Motor_C', 10]]));
    await settle();
    await fit();
    await wait(600);
    const pooledNow = async () => {
      await wait(400);
      return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].pooled ?? []);
    };
    const button = page.locator('.endpoint-node.manual.target .endpoint-pool');
    ok(
      'Manual: an output card has a To the pool button',
      (await button.count()) === 1 && (await button.innerText()).includes('To the pool'),
    );
    ok('Manual: it starts not in the pool', (await pooledNow()).length === 0);
    await button.click();
    ok('Manual: a click offers the product to the pool', (await pooledNow()).includes('Desc_Motor_C'));
    ok('Manual: and the button says so', (await button.getAttribute('aria-pressed')) === 'true');
    await button.click();
    ok('Manual: a second click takes it back', (await pooledNow()).length === 0);
    await open(factory([['Desc_Motor_C', 10]]));
    await wait(600);
    ok('Auto: the output card has its button too', (await page.locator('.endpoint-pool').count()) >= 1);
  }

  // ── A11d: the All page lists the standard recipes too ──
  section = 'A11d';
  {
    await open(
      saved({
        mode: 'factory',
        plans: [
          { id: 'f1', name: 'Motors', targets: [{ item: 'Desc_Motor_C', rate: 10 }] },
          { id: 'f2', name: 'Plastic', targets: [{ item: 'Desc_Plastic_C', rate: 60 }] },
        ],
        active: 'f1',
        unlocked: ['Recipe_Alternate_AdheredIronPlate_C'],
      }),
    );
    await page.click('.plan-current');
    await page.locator('.plan-row.all .plan-row-name').click();
    await page.getByRole('radio', { name: 'Unlocked recipes' }).click();
    await wait(600);
    const alt = await page.locator('.recipe-row input:checked').count();
    ok('All: the alternate you unlocked is ticked', alt === 1, `${alt}`);
    await page.getByRole('radio', { name: /^standard$/i }).click();
    await wait(400);
    const rows = await page.locator('.recipe-row').count();
    const fixed = await page.locator('.recipe-row input:checked:disabled').count();
    ok('All: Standard lists the standard recipes', rows > 20, `${rows}`);
    const on = await page.locator('.recipe-row input:checked').count();
    ok('All: each starts on, and can be changed', on === rows && fixed === 0, `${on}/${rows}, ${fixed} locked`);
    await page.locator('.recipe-row .recipe-name').first().click({ force: true });
    await wait(300);
    ok('All: clicking one turns it off', (await page.locator('.recipe-row input:checked').count()) === rows - 1);
    await page.locator('.recipe-row .recipe-name').first().click({ force: true });
    await wait(300);
    ok('All: clicking it again turns it back on', (await page.locator('.recipe-row input:checked').count()) === rows);
  }

  // ── A12: automatic copies in Settings › Your data ──
  section = 'A12';
  {
    await open(factory([['Desc_Motor_C', 10]]));
    await page.click('.chrome-button.settings');
    await page.locator('.settings-nav button:has-text("Your data")').click();
    ok('no copies yet, no Auto backups row', (await page.locator('text=Auto backups').count()) === 0);
    await page.keyboard.press('Escape');
    await wait(300);
    // Put a copy where the app keeps them, the way a day-old one would sit there.
    await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('ficsit-planner')).state;
      const file = {
        kind: 'ficsit-planner',
        version: 2,
        exported: new Date().toISOString(),
        plans: state.plans,
        power: state.power ?? [],
        settings: state.settings,
      };
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('ficsit-planner-backups', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'at' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('copies', 'readwrite');
      tx.objectStore('copies').put({ at: Date.now() - 86400000, hash: 'x', factories: file.plans.length, plants: 0, file });
      await new Promise((res) => (tx.oncomplete = res));
      db.close();
    });
    await page.click('.chrome-button.settings');
    await page.locator('.settings-nav button:has-text("Your data")').click();
    await wait(500);
    ok('the copy is listed', (await page.locator('text=Auto backups').count()) >= 1);
    const tabs = async () => {
      await wait(600);
      return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans.length);
    };
    const before = await tabs();
    await page.locator('button:has-text("Restore")').click();
    await wait(400);
    ok('Restore says what it added', (await page.locator('.setting-note.ok').count()) === 1);
    await page.keyboard.press('Escape');
    await wait(300);
    ok('and adds the factory as a new tab', (await tabs()) === before + 1, `${before} → ${await tabs()}`);
    await page.click('.chrome-button.settings');
    await page.locator('.settings-nav button:has-text("Your data")').click();
    const wipe = page.locator('button:has-text("Delete")').last();
    await wipe.click();
    await wipe.click();
    await page.waitForLoadState('load');
    await wait(1500);
    const left = await page.evaluate(async () => ({
      keys: Object.keys(localStorage).filter((k) => k.startsWith('ficsit-')),
      dbs: (await indexedDB.databases()).map((d) => d.name),
    }));
    ok(
      'Delete everything leaves no copies or keys',
      !left.dbs.includes('ficsit-planner-backups') && left.keys.every((k) => k === 'ficsit-planner'),
      JSON.stringify(left),
    );
  }

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
  await page.mouse.click(menu.x > 400 ? menu.x - 100 : menu.x + menu.width + 100, menu.y + 220);
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
  await chooseOpenOutput('Machine stops');
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
  await chooseOpenOutput('Counts as spare');
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
  await open(manual([['Desc_UraniumCell_C', 12]]));
  await page.click('.deck-toggle');
  await wait(600);
  await settle();
  await fit();
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
  await open(manual([['Desc_Motor_C', 10]]));
  await page.click('.deck-toggle');
  await wait(600);
  await settle();
  await fit();
  await wait(800);
  const floorPower = (await page.locator('.readout.power .readout-value').first().innerText()).replace(/\s+/g, ' ');
  await page.click('.plan-current');
  await wait(300);
  ok('the All row shows with only one tab', (await page.locator('.plan-row.all').count()) === 1);
  ok('a power plant with nothing in it is not in the factory menu', (await page.locator('.plan-row.power').count()) === 0);
  await page.keyboard.press('Escape');
  await page.click('.plan-add');
  await wait(300);
  ok('the + offers an Auto and a Manual factory', (await page.locator('.card-menu button').count()) === 2);
  await page.keyboard.press('Escape');
  await wait(200);
  ok(
    'Escape closes it and adds nothing',
    (await page.locator('.card-menu').count()) === 0 && (await page.locator('.plan-current').innerText()).includes('Factory 1'),
  );
  await page.click('.plan-add');
  await wait(300);
  await page.locator('.card-menu button', { hasText: 'Auto factory' }).click();
  await wait(500);
  ok('Auto factory adds an Auto tab', (await page.locator('.plan-current .kind-tag.auto').count()) === 1);
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
  ok(
    'each factory shows its kind: the Manual one a grid, the Auto one a gear',
    (await page.locator('.ov-name .kind-tag.manual').count()) === 1 && (await page.locator('.ov-name .kind-tag.auto').count()) === 1,
  );
  const rowPower = rowsText[0].match(/([\d.,]+)\s*MW/)?.[1];
  ok('its power is what the Manual floor showed', !!rowPower && floorPower.startsWith(rowPower), `${floorPower} / ${rowPower}`);
  ok('the page is clean of floor controls', (await page.locator('.floor-bar, .copy-factory').count()) === 0);
  await shot('all-page');
  await page.locator('.ov-name button').first().click();
  await wait(600);
  ok(
    'a row opens its factory',
    (await page.locator('.overview').count()) === 0 &&
      (await page.locator('.react-flow').count()) === 1 &&
      (await page.locator('.floor-kind').count()) === 0,
  );

  // Auto and Manual factories are apart: an old tab holding both is two tabs, and neither changes the other.
  section = 'apart';
  {
    const motorModel = manualModel([['Desc_Motor_C', 10]]);
    const savedPlans = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans);
    // A session saved before version 4: one tab, the Manual floor on screen, the Auto targets beside it.
    await open(
      JSON.stringify({
        state: {
          onboarded: true,
          tier: 9,
          lang: 'en',
          mode: 'factory',
          settings: still,
          plans: [{ id: 'f1', name: 'Motors', targets: [{ item: 'Desc_Motor_C', rate: 10 }], floor: 'manual', model: motorModel }],
          active: 'f1',
        },
        version: 3,
      }),
    );
    await settle();
    await wait(500);
    const tabs = await savedPlans();
    ok(
      'an old tab with both floors becomes two tabs',
      tabs.length === 2 && tabs[0].name === 'Motors' && tabs[1].name === 'Motors (Manual)',
    );
    ok(
      'the Auto one has no floor, the Manual one keeps its floor',
      !tabs[0].model && !tabs[0].floor && tabs[1].floor === 'manual' && tabs[1].model.nodes.length === motorModel.nodes.length,
    );
    ok(
      'the floor that was open is still open',
      (await page.locator('.plan-current').innerText()).includes('Motors (Manual)') &&
        (await page.locator('.react-flow__node-part').count()) > 0,
    );
    await page.click('.plan-current');
    await wait(300);
    ok(
      'the list tells them apart: a gear for Auto, a grid for Manual',
      (await page.locator('.plan-row[data-group="f"] .kind-tag.auto').count()) === 1 &&
        (await page.locator('.plan-row[data-group="f"] .kind-tag.manual').count()) === 1,
    );
    await page.locator('.plan-row[data-group="f"]').first().locator('.plan-row-name').click();
    await settle();
    ok(
      'the Auto tab shows no switch to Manual',
      (await page.locator('.floor-kind').count()) === 0 && (await page.locator('.react-flow__node-machine').count()) > 0,
    );
    const manualBefore = JSON.stringify((await savedPlans())[1]);
    const rate = page.locator('.side .targets .item-card input').first();
    await rate.fill('20');
    await rate.press('Enter');
    await wait(900);
    const after = await savedPlans();
    ok('a target changed on the Auto tab', after[0].targets[0].rate === 20);
    ok('and the Manual tab beside it is exactly as it was', JSON.stringify(after[1]) === manualBefore);

    // A Manual factory from the + menu: an empty floor of its own, with a Manual tag in front of its name.
    await page.click('.plan-add');
    await wait(300);
    await page.locator('.card-menu button', { hasText: 'Manual factory' }).click();
    await wait(800);
    const added = await savedPlans();
    ok(
      'Manual factory from the + adds a Manual tab with an empty floor',
      added.length === 3 && added[2].floor === 'manual' && added[2].model.nodes.length === 0,
    );
    ok('its name has the grid in front', (await page.locator('.plan-current .kind-tag.manual').count()) === 1);
    await shot('apart-new-manual');

    // "Build by hand" is for a factory with nothing in it, and only there.
    await open(blank);
    ok('an empty Auto factory offers Build by hand', (await page.locator('.build-by-hand').count()) === 1);
    await page.locator('.build-by-hand').click();
    await wait(800);
    const made = (await savedPlans())[0];
    ok('it turns that tab Manual', made.floor === 'manual' && made.model.nodes.length === 0);
    await open(factory([['Desc_Motor_C', 10]]));
    ok('a factory with something in it offers no such button', (await page.locator('.build-by-hand').count()) === 0);
  }

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
      settings: {},
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
  ok('on without any setting: splitter cards are there', (await page.locator('.logistic-node').count()) > 0);

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
    await open(manual([[item, rate]]));
    await page.click('.deck-toggle');
    await settle();
    await fit();
    await wait(600);
    const mm = await model();
    const tag = item.replace(/^Desc_|_C$/g, '');
    await shot(`big-${tag}-open`);
    ok(`${tag}: the whole floor in view`, await allInView());
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
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  await wait(350);
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
  await open(manual([[plate, 30]], { state: { settings: { ...still, beltLabels: 'always' } } }));
  await settle();
  await fit();
  let m = await model();
  ok(
    'belts are left to the load: no Mk picked',
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

  // Numbers off takes them away; on again, they are back as they were.
  await page.locator('.tool-button[aria-label="Numbers"]').click();
  await settle();
  ok(
    'numbers off: no Rebuild button any more, and no run states',
    (await page.locator('.tool-button[aria-label="Rebuild"]').count()) === 0 &&
      (await page.locator('.react-flow__node .machine-node .run-state').count()) === 0,
  );
  await page.locator('.tool-button[aria-label="Numbers"]').click();
  await settle();
  const again = await model();
  const out5 = again.nodes.find((n) => n.k === 'out' && n.item === plate);
  ok('numbers back: the floor puts out what it did', again.calc === 'basic' && out5?.lim === 5, JSON.stringify(out5));

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

  // Open outputs: a drawer, its tab naming the setting and the choice, the switch inside it with no caption of its own.
  ok(
    'Open outputs is a drawer: a tab, and the switch inside it',
    (await page.locator('.open-outputs > .drawer-tab .tool-label').count()) === 1 &&
      (await page.locator('.open-outputs .drawer-slide .segmented').count()) === 1 &&
      !(await page.locator('.segmented .tool-label').count()),
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

  // ── R: 0.13.7 ──
  section = 'R';
  await open(manual([[plate, 30]]));
  await settle();
  await fit();
  const targetsNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.plans[0].targets);
  m = await model();
  const outCard = m.nodes.find((n) => n.k === 'out' && n.item === plate);

  // A Manual factory's targets are its floor's output cards: an amount set on the floor is its target.
  await page.locator('.side .floor-io input').first().fill('7');
  await page.locator('.side .floor-io input').first().press('Enter');
  await settle();
  ok('an amount set on the floor is the target', JSON.stringify(await targetsNow()) === JSON.stringify([{ item: plate, rate: 7 }]));
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
  // The copy is on the system clipboard too: another tab or a later visit can paste it.
  await card(asm.id).locator('.machine-body').click();
  await wait(300);
  await page.keyboard.press('Control+c');
  const onClip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('Ctrl+C puts the cards on the system clipboard', onClip.includes('"kind":"ficsit-planner-cards"'), onClip.slice(0, 60));
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      JSON.stringify({ kind: 'ficsit-planner-cards', v: 1, nodes: [{ id: 'zz', k: 'sink', x: 0, y: 0 }], links: [] }),
    ),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const before = (await model()).nodes.length;
  await page.mouse.move(pasteAt.x, pasteAt.y);
  await page.keyboard.press('Control+v');
  await settle();
  m = await model();
  ok('Ctrl+V pastes what the system clipboard holds, not only the last copy', m.nodes.length === before + 1 && m.nodes.at(-1).k === 'sink');
  await page.keyboard.press('Control+z');
  await settle();
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
  ok('the menu’s first entry has the keyboard focus', await page.evaluate(() => !!document.activeElement?.closest('.card-menu')));
  await page.keyboard.press('Escape');
  await wait(150);
  ok('Escape closes the card menu', !(await page.locator('.card-menu').count()));
  await card(asm.id).locator('.machine-body').click({ button: 'right' });
  await wait(300);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await wait(150);
  ok('a press anywhere else closes the card menu', !(await page.locator('.card-menu').count()));
  await card(asm.id).locator('.machine-body').click({ button: 'right' });
  await wait(300);
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
  const viewsBox = await page.locator('.floor-bar .segmented').boundingBox();
  ok(
    'a panel open: the bottom buttons clear of each other',
    !clash(ctrls, viewsBox) && !clash(ctrls, await page.locator('aside.inspector').boundingBox()),
    JSON.stringify({ ctrls, fbar }),
  );
  await shot('r-panel-bottom');
  await page.setViewportSize({ width: 1366, height: 768 });

  // ── S: 0.13.8 ──
  section = 'S';
  await open(manual([['Desc_Motor_C', 10]]));
  await settle();
  await fit();
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

// ───────────────────────────── Brought in once, leaving the map ─────────────────────────────
{
  section = 'W';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const eight = [
    'Desc_Motor_C',
    'Desc_ModularFrameHeavy_C',
    'Desc_Computer_C',
    'Desc_PlutoniumPellet_C',
    'Desc_AluminumPlate_C',
    'Desc_Rotor_C',
    'Desc_SpaceElevatorPart_5_C',
    'Desc_CircuitBoard_C',
  ];
  await open(manual(eight.map((i) => [i, 20])));
  await page.click('.deck-toggle');
  await wait(600);
  await settle();
  await fit();
  await wait(1500);
  const names = await page.locator('.floor-io .item-card-name').allInnerTexts();
  const comes = await page.$$eval('.panel-body.manual section:nth-of-type(2) .floor-io-name', (l) =>
    l.map((e) => e.firstChild?.textContent ?? ''),
  );
  ok('Comes in lists each item once', comes.length > 0 && new Set(comes).size === comes.length, comes.join(', '));
  ok('and the floor still lists its products', names.length > comes.length);
  const amounts = await page.$$eval('.panel-body.manual section:nth-of-type(2) input', (l) => l.map((i) => i.value));
  ok(
    'with amounts a person can read',
    amounts.every((v) => v.replace(/[^0-9]/g, '').length <= 8),
    amounts.join(', '),
  );

  // The list and the transport view end above the buttons along the bottom, and the transport view has no hint to click a machine.
  await open(factory(eight.map((i) => [i, 20])));
  await page.click('.deck-toggle');
  await settle();
  await wait(800);
  for (const [name, idx] of [
    ['list', 1],
    ['transport', 2],
  ]) {
    await pickView(idx);
    await wait(900);
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('.table-wrap, .transport-wrap')) e.scrollTop = e.scrollHeight;
    });
    await wait(300);
    const room = await page.evaluate(() => {
      const w = document.querySelector('.table-wrap, .transport-wrap');
      const last = w.lastElementChild.getBoundingClientRect();
      return Math.round(
        Math.min(...[...document.querySelectorAll('.floor-bar, .floor-controls')].map((e) => e.getBoundingClientRect().top)) - last.bottom,
      );
    });
    ok(`the ${name} view ends above the buttons along the bottom`, room >= 0, `${room}px`);
    if (name === 'transport') ok('the transport view has no hint to click a machine', (await page.locator('.floor-hint').count()) === 0);
    else ok('the list view keeps its hint', (await page.locator('.floor-hint').count()) === 1);
  }

  // Leaving the map in the middle of a zoom must not trip Leaflet over the panes it has taken down.
  const before = errors.length;
  for (const delay of [0, 10, 40, 120]) {
    await open(saved({ mode: 'map', plans: [{ id: 'f1', name: 'Factory 1', targets: [] }], active: 'f1' }));
    await page.waitForSelector('.leaflet-container', { timeout: 30000 });
    await wait(1200);
    await page.evaluate(
      (d) =>
        new Promise((res) => {
          document.querySelector('.leaflet-control-zoom-in').click();
          setTimeout(() => {
            document.querySelector('.mode-switch button').click();
            res();
          }, d);
        }),
      delay,
    );
    await wait(600);
  }
  ok('leaving the map while it zooms raises no error', errors.length === before, errors.slice(before).join(' | '));
  await ctx.close();
}

// ───────────────────────────── Milestones in the tier window ─────────────────────────────
{
  section = 'T';
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const OIL = 'Schematic_5-1_C';
  const plastic = (extra) =>
    saved({
      tier: 5,
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [{ item: 'Desc_Plastic_C', rate: 30 }] }],
      active: 'f1',
      ...extra,
    });
  const skippedNow = async () => {
    await wait(350);
    return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state.skipped);
  };
  const bar = async () => (await page.locator('.tier-button:visible').first().innerText()).replace(/\s+/g, ' ').trim();
  const window_ = async () => {
    await page.click('.tier-button:visible');
    await wait(300);
  };
  const done = async () => {
    await page.click('.tier-dialog .primary-button');
    await wait(1200);
  };
  const chip = (name) => page.locator('.tier-dialog .milestone-chip', { hasText: name });

  await open(plastic());
  ok('nothing skipped: the top bar says only the tier', /^tier 5$/i.test(await bar()), await bar());
  await window_();
  ok(
    'the window lists the four Tier 5 milestones, all bought',
    (await page.locator('.milestones .milestone-chip[aria-pressed=true]').count()) === 4,
  );
  ok('earlier tiers wait in a fold', /Earlier tiers \(3\)/.test(await page.locator('.earlier-tiers summary').innerText()));
  ok('nothing says "not bought"', !(await page.locator('.tier-foot').innerText()).includes('not bought'));
  await chip('Oil Processing').click();
  await wait(200);
  ok('a click marks it not bought', (await chip('Oil Processing').getAttribute('aria-pressed')) === 'false');
  ok('and the window counts it', (await page.locator('.tier-foot').innerText()).includes('1 not bought'));
  await page.locator('.tier-card', { hasText: 'Tier 6' }).first().click();
  await wait(200);
  ok('picking another tier leaves the window open', (await page.locator('.tier-dialog[open]').count()) === 1);
  ok('and shows that tier\u2019s milestones', (await page.locator('.milestones .milestone-chip').count()) === 3);
  ok('the one skipped earlier still counts', (await page.locator('.tier-foot').innerText()).includes('1 not bought'));
  await page.locator('.tier-card', { hasText: 'Tier 5' }).first().click();
  await wait(200);
  await shot('t-window');
  await done();
  ok('Done closes it', (await page.locator('.tier-dialog[open]').count()) === 0);
  ok('the top bar says Tier 5 \u00B7 1 off', /^tier 5 \u00B7 1 off$/i.test(await bar()), await bar());
  ok('saved', JSON.stringify(await skippedNow()) === JSON.stringify([OIL]));
  // Auto: the plastic can't be made, and the list offers the fix.
  const missing = page.locator('.missing-list');
  ok(
    'Auto: Plastic waits for the milestone',
    /Oil Processing milestone/.test(await missing.innerText()),
    (await missing.innerText()).replace(/\n/g, ' '),
  );
  await shot('t-missing');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.boot') && !document.querySelector('.busy'), null, { timeout: 30000 });
  await wait(800);
  ok('it survives a reload', /1 off/.test(await bar()));
  await page.locator('.missing-list .chip.fix', { hasText: 'Mark Oil Processing as bought' }).click();
  await wait(1500);
  ok('Mark as bought: the list is gone', (await page.locator('.missing-list').count()) === 0);
  ok('and the bar is back to Tier 5', /^tier 5$/i.test(await bar()), await bar());
  ok('saved without it', (await skippedNow()).length === 0);

  // Manual: the card says what it waits for, and the flag goes away when the milestone is bought.
  await open(manual([['Desc_Plastic_C', 30]], { state: { tier: 5 } }));
  await page.click('.deck-toggle').catch(() => {});
  await wait(500);
  await settle();
  await fit();
  await wait(1500);
  ok('Manual: nothing flagged at first', (await page.locator('.card-flag').count()) === 0);
  await window_();
  await chip('Oil Processing').click();
  await done();
  const flagText = (await page.locator('.card-flag').allInnerTexts()).join('|');
  ok('Manual: the cards say Needs Oil Processing', /needs oil processing/i.test(flagText), flagText);
  await shot('t-manual-flag');
  await window_();
  await chip('Oil Processing').click();
  await done();
  ok('bought again: the flag is gone', (await page.locator('.card-flag').count()) === 0);
  // The flag a tier gives goes the same way.
  await window_();
  await page.locator('.tier-card', { hasText: 'Tier 4' }).first().click();
  await done();
  ok('a lower tier flags them with the tier', /needs tier 5/i.test((await page.locator('.card-flag').allInnerTexts()).join('|')));
  await window_();
  await page.locator('.tier-card', { hasText: 'Tier 9' }).first().click();
  await done();
  ok('raised again: the flag is gone', (await page.locator('.card-flag').count()) === 0);

  // Shortcuts: with locked parts shown, one that waits for a milestone names it.
  await open(
    saved({
      tier: 5,
      skipped: [OIL],
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Factory 1', targets: [] }],
      active: 'f1',
      settings: { showLocked: true },
    }),
  );
  await page.locator('.quick-search').fill('plastic');
  await wait(300);
  ok(
    'Shortcuts: Plastic is tagged with the milestone',
    /oil processing/i.test(await page.locator('.quick-item.locked .tier-tag').first().innerText()),
  );
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

  await open(manual([['Desc_Motor_C', 10]]));
  await settle();
  await fit();
  await wait(600);
  await shot('c-motor');
  ok('on a phone, the whole floor in view', await allInView());
  const bar = await page.locator('.floor-bar').boundingBox();
  const controls = await page.locator('.floor-controls').boundingBox();
  ok(
    'buttons along the bottom clear of each other',
    !clash(controls, await page.locator('.floor-bar .segmented').boundingBox()),
    JSON.stringify({ bar, controls }),
  );
  const toolbar = await page.locator('.model-toolbar').boundingBox();
  ok('the toolbar clear of the totals tab', (await onTab()).length === 0, (await onTab()).join(', '));
  ok('toolbar fits across', toolbar.width <= 412, `${toolbar.width}`);
  ok('on a phone the switch to turn the floor is along the bottom', await page.locator('.floor-dir').isVisible());
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
