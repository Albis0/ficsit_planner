// Imports a real game save the way a player would: the button, the window, the folder, the picker, the cover while
// it reads, the first questions, what came in, the map, the save's factories (All, the read-only floor, a copy, a link and
// its ticks); then a refresh after the player changed things, Settings › Game save,
// forgetting it, and the same on a phone.
//
//   bun run build && node e2e/save-import.mjs
//
// Needs the player saves in C:/code/ficsit-saves (never in the repo: they hold the player's name and account); without
// them it says so and stops. Pictures go to e2e/out/save-import/, results to e2e/out/save-import.md.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const SAVES = 'C:/code/ficsit-saves';
if (!fs.existsSync(`${SAVES}/ela`)) {
  console.log(`No saves in ${SAVES}: skipped.`);
  process.exit(0);
}

const OUT = path.resolve('e2e/out/save-import');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ALT = ['Recipe_Alternate_BoltedFrame_C', 'Recipe_Alternate_ReinforcedIronPlate_2_C', 'Recipe_Alternate_SteelRod_C'];
const seed = (state) =>
  JSON.stringify({
    state: {
      onboarded: true,
      tier: 9,
      lang: 'en',
      mode: 'factory',
      plans: [{ id: 'f1', name: 'Modular Frames', targets: [{ item: 'Desc_ModularFrame_C', rate: 10 }] }],
      active: 'f1',
      settings: { beltMotion: false, motion: 'reduce' },
      seenUpdates: '9.9.9',
      ...state,
    },
    version: 3,
  });

const server = await preview({ preview: { port: 4178, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const URL = 'http://127.0.0.1:4178/';
const browser = await chromium.launch();

const results = [];
const errors = [];
let section = '';
let page;
let ctx;
let shots = 0;

function ok(step, pass, info = '') {
  results.push({ section, step, pass: !!pass, info });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${section} ${step}${info ? ` — ${info}` : ''}`);
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++shots).padStart(2, '0')}-${name}.png`) });
const wait = (ms = 400) => page.waitForTimeout(ms);
const state = async () => {
  await wait(400);
  return page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-planner')).state);
};

async function open(width, height, stored, mobile = false) {
  await ctx?.close();
  ctx = await browser.newContext({
    viewport: { width, height },
    ...(mobile
      ? {
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
          userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
        }
      : {}),
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ficsit-planner', s);
      sessionStorage.setItem('seeded', '1');
    }
  }, stored);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${section}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${section}: ${m.text()}`));
  await page.goto(URL);
  await page.waitForSelector('.topbar');
  await wait(800);
}

/** Clicks what opens a chooser and hands it a folder or a file. */
async function choose(click, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
  await chooser.setFiles(files);
}

/** Waits for the save to be read: the cover comes and goes. */
async function reading() {
  // A small save can be read before the cover is caught; then there is nothing to wait for.
  const seen = await page
    .waitForSelector('.save-block', { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (seen) await shot('reading').catch(() => {});
  await page.waitForSelector('.save-block', { state: 'detached', timeout: 60000 });
}

try {
  section = 'first import';
  await open(1280, 800, seed({}));
  await page.click('.save-button');
  await page.waitForSelector('.save-dialog');
  await wait(500);
  await shot('import-window');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('opening the window copies the save path', clip === '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames', clip);
  ok(
    'the window shows the path in a picture of the chooser',
    (await page.locator('.save-win-address').textContent()).includes('SaveGames'),
  );

  await choose(() => page.click('.save-dialog .save-big'), `${SAVES}/ela`);
  await page.waitForSelector('.save-side-row');
  await shot('picker-one-game');
  ok('the picker lists one game', (await page.locator('.save-side-row').count()) === 1);
  ok('with its 11 saves', (await page.locator('.save-list-row').count()) === 11);
  const picked = await page.locator('.save-list-row:has(input:checked) b').textContent();
  ok('the newest save is picked', picked === 'SPACEDELAELEVATORE', picked);

  await page.click('.save-foot .primary-button');
  await reading();
  await page.waitForSelector('.save-dialog .toggle');
  await shot('questions');
  ok('four questions, all on', (await page.locator('.save-dialog [role=switch][aria-checked=true]').count()) === 4);
  const hint = await page.locator('.save-dialog .setting-hint').first().textContent();
  ok('the tier question says what the save has', hint.startsWith('Tier 4'), hint);
  await page.click('.save-foot .primary-button');
  await page.waitForSelector('.save-came');
  await shot('result');
  const came = await page.locator('.save-came').first().textContent();
  ok(
    'the result lists tier, alternates, sloops and shards',
    /Tier 4/.test(came) && /3 alternate recipes/.test(came) && /2 Somersloops/.test(came) && /21 power shards/.test(came),
    came,
  );
  ok('the result says what came onto the map', /The map/.test(came) && /21 nodes mined/.test(came) && /4 factories/.test(came), came);
  let s = await state();
  ok(
    'the map takes the miners, pickups and factories',
    s.save?.map?.miners.length === 21 &&
      s.save.map.picked.slug1?.length === 15 &&
      s.save.map.factories.length === 4 &&
      s.save.map.missed === 0,
  );
  ok(
    'tier, alternates and inventory are taken',
    s.tier === 4 && ALT.every((a) => s.unlocked.includes(a)) && s.inventory.sloops === 2 && s.inventory.shards === 21,
  );
  ok(
    'the alternates are on in the factory',
    ALT.every((a) => s.plans[0].enabled.includes(a)),
  );
  ok(
    'the followed save is kept, with no player name in it',
    s.save?.game === 'ela' && s.save?.file === 'SPACEDELAELEVATORE' && !JSON.stringify(s.save).includes('3e281e72'),
  );
  const kept = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('ficsit-planner-save');
        r.onsuccess = () => {
          const g = r.result.transaction('save').objectStore('save').get('last');
          g.onsuccess = () => res(g.result?.size ?? 0);
        };
        r.onerror = () => res(0);
      }),
  );
  ok('the save file is kept in this browser', kept > 800000, String(kept));
  await page.click('.save-foot .primary-button');
  await wait(300);

  section = 'menu';
  await page.click('.save-button');
  await page.waitForSelector('.save-menu');
  await shot('menu');
  ok('the menu names the followed game', (await page.locator('.save-menu-head').textContent()).startsWith('ela · saved'));
  await page.keyboard.press('Escape');

  section = 'map';
  await page.click('.mode-switch [role=radio] >> nth=3');
  await page.waitForSelector('.map-picked');
  await wait(1500);
  await shot('map');
  ok(
    'the filter names the followed game',
    (await page.locator('.map-nav .section-title').first().textContent()) === 'From your save · ela',
  );
  ok('the factories are named on the map', (await page.locator('.map-factory-label').count()) === 4);
  for (const layer of ['Blue Power Slug', 'Mercer Sphere', 'Somersloop']) await page.locator('.map-item', { hasText: layer }).click();
  const label = await page.locator('.map-factory-label').first().boundingBox();
  await page.mouse.move(label.x + label.width / 2, label.y + label.height + 30);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -300);
    await wait(400);
  }
  await wait(1200);
  await shot('map-close');
  const near = await page.locator('.map-factory-label:visible').first().boundingBox();
  await page.mouse.click(near.x + near.width / 2 - 60, near.y + near.height + 150);
  await wait(400);
  await shot('map-factory-popup');
  ok(
    'a factory says what it has',
    /From your save/.test(
      (await page
        .locator('.map-pop')
        .textContent()
        .catch(() => '')) ?? '',
    ),
  );
  await page.keyboard.press('Escape');
  await page.click('.map-picked [role=radio] >> nth=1');
  s = await state();
  ok('Hide is kept', s.mapFilter.picked === 'hide');
  await wait(600);
  await shot('map-hide');
  await page.click('.map-picked [role=radio] >> nth=0');
  await page.setViewportSize({ width: 900, height: 800 });
  await wait(800);
  await shot('map-900');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('.mode-switch [role=radio] >> nth=0');
  await wait(400);

  section = 'save factories';
  const openAll = async () => {
    await page.click('.plan-current');
    await page.click('.plan-row.all .plan-row-name');
    await page.waitForSelector('.save-card');
  };
  await openAll();
  await page.locator('.save-list').scrollIntoViewIfNeeded();
  await wait(300);
  await shot('all-from-save');
  ok('All lists the save’s factories', (await page.locator('.save-card').count()) === 4);
  const frames = s.save.map.factories[0].id;
  await page.locator('.save-card .ghost-button').first().click();
  await page.waitForSelector('.save-floor .react-flow__node', { timeout: 60000 });
  await wait(1500);
  await shot('save-floor');
  ok(
    'the floor opens read only, named after the factory',
    (await page.locator('.plan-tab-label').textContent()) === 'Modular Frame' &&
      (await page.locator('.save-stamp').isVisible()) &&
      (await page.locator('.react-flow.read-only').count()) === 1,
  );
  // Dragged and double-clicked, a card stays where it is, unticked, with no panel.
  const cards = page.locator('.save-floor .react-flow__node');
  const box = await cards.nth(3).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 110, { steps: 6 });
  await page.mouse.up();
  await cards.nth(3).dblclick();
  await wait(400);
  ok(
    'a card on it does not move, tick or open a panel',
    (await page.locator('.save-floor .react-flow__node.draggable, .save-floor .react-flow__node.selected').count()) === 0 &&
      (await page.locator('.save-floor .done').count()) === 0 &&
      (await page.locator('.save-floor .react-flow__node button:visible').count()) === 0 &&
      (await page.locator('.inspector').count()) === 0,
    `${await page.locator('.save-floor .react-flow__node.draggable').count()} ${await page.locator('.save-floor .done').count()} ${await page.locator('.inspector').count()}`,
  );
  await page.click('.save-info-head');
  ok('the box beside it folds', (await page.locator('.save-info-body').count()) === 0);
  await page.click('.save-info-head');
  await page.setViewportSize({ width: 900, height: 800 });
  await wait(600);
  await shot('save-floor-900');
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(400);
  await page.click('.save-info .primary-button');
  await page.waitForSelector('.save-compare');
  await wait(2500);
  await shot('copy-compare');
  s = await state();
  const copy = s.plans.at(-1);
  ok(
    'a copy is a hand-built tab linked to the factory',
    s.plans.length === 2 && copy.floor === 'manual' && copy.saveFactory === frames && copy.model.nodes.length > 100,
  );
  ok(
    'every machine of the copy is ticked from the save',
    copy.model.nodes.filter((n) => n.k === 'machine').every((n) => n.done === 'save'),
  );
  ok('the box compares recipe by recipe', (await page.locator('.save-compare-rows li').count()) === 12);
  await openAll();
  await page.locator('.save-card .save-link').first().selectOption('f1');
  await wait(300);
  s = await state();
  ok(
    'a save factory is linked to one tab: the copy lets go, and its ticks with it',
    s.plans[0].saveFactory === frames && !s.plans[1].saveFactory && s.plans[1].model.nodes.every((n) => !n.done),
  );
  await page.click('.plan-current');
  await page.locator('.plan-row', { hasText: 'Modular Frames' }).locator('.plan-row-name').click();
  await page.waitForSelector('.save-compare');
  await wait(2500);
  await shot('auto-compare');
  s = await state();
  ok(
    'the Auto tab is ticked where the save has every machine',
    JSON.stringify([...(s.plans[0].savedBuilt ?? [])].sort()) ===
      JSON.stringify(['Recipe_IngotIron_C', 'Recipe_IronPlateReinforced_C', 'Recipe_IronPlate_C', 'Recipe_Screw_C']),
    JSON.stringify(s.plans[0].savedBuilt),
  );
  await page.click('.mode-switch [role=radio] >> nth=3');
  await page.waitForSelector('.map-factory-label');
  await wait(1200);
  const tag = await page.locator('.map-factory-label').first().boundingBox();
  await page.mouse.move(tag.x + tag.width / 2, tag.y + tag.height + 30);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -300);
    await wait(400);
  }
  await wait(1200);
  const big = await page.locator('.map-factory-label:visible').first().boundingBox();
  await page.mouse.click(big.x + big.width / 2 - 60, big.y + big.height + 150);
  await page.waitForSelector('.map-pop-save');
  await shot('map-factory-link');
  ok('the map popup names the linked tab', (await page.locator('.map-pop-save select').inputValue()) === 'f1');
  await page.click('.map-pop-save .ghost-button');
  await page.waitForSelector('.save-floor .react-flow__node', { timeout: 60000 });
  ok('Open floor on the map opens it', (await page.locator('.save-info-head').textContent()).includes('Modular Frame'));
  await page.click('.save-info .text-button');
  await wait(1500);
  await shot('show-on-map');
  s = await state();
  ok('Show on map goes to the map', s.mode === 'map');
  await page.click('.mode-switch [role=radio] >> nth=0');
  await wait(400);

  section = 'refresh';
  // The player changes things in the planner since the import.
  s = await state();
  await page.evaluate((st) => localStorage.setItem('ficsit-planner', JSON.stringify({ state: st, version: 3 })), {
    ...s,
    tier: 6,
    inventory: { sloops: 9, shards: 21 },
  });
  await page.reload();
  await page.waitForSelector('.topbar');
  await wait(600);
  await page.click('.save-button');
  await choose(() => page.click('.save-menu .menu-item >> nth=0'), `${SAVES}/ela`);
  await reading();
  await page.waitForSelector('.save-table');
  await shot('conflict');
  const rows = await page.locator('.save-table tbody tr td:first-child').allTextContents();
  ok('only what the player changed is asked', rows.join() === 'Tier,Somersloops', rows.join());
  await page.locator('.save-table tbody tr').first().locator('input').first().check();
  await page.click('.save-foot .primary-button');
  await page.waitForSelector('.save-came');
  await shot('refresh-result');
  ok('the result says the tier was kept', (await page.locator('.save-came.not').textContent()).includes('Tier: you kept yours'));
  s = await state();
  ok('kept tier stays, sloops follow the game', s.tier === 6 && s.inventory.sloops === 2, `${s.tier} ${s.inventory.sloops}`);
  ok('the factory is found again: its link stays', s.plans[0].saveFactory === frames && s.save.map.factories[0].id === frames);
  await page.click('.save-foot .primary-button');

  section = 'settings';
  await page.click('.save-button');
  await page.click('.save-menu .menu-item >> nth=2');
  await page.waitForSelector('.save-line');
  await wait(300);
  await shot('settings');
  ok('Settings opens on Game save', (await page.locator('.settings-heading').textContent()) === 'Game save');
  await page.locator('.settings-controls [role=switch]').nth(1).click();
  s = await state();
  ok('turning sloops and shards off is kept', s.save.answers.inventory === false);
  await page.click('.save-line .danger');
  await wait(300);
  await shot('settings-forgotten');
  s = await state();
  ok('Forget drops the followed save', !s.save && (await page.locator('.save-line').textContent()).includes('No save imported yet'));
  ok('…but keeps the tier', s.tier === 6);

  section = 'many games';
  await open(1280, 800, seed({}));
  await page.click('.save-button');
  await choose(() => page.click('.save-dialog .save-big'), `${SAVES}/online`);
  await page.waitForSelector('.save-side-row');
  await shot('picker-many');
  ok('saves of several games', (await page.locator('.save-side-row').count()) >= 5);
  await page
    .locator('.save-side-row', { hasText: 'Frodo' })
    .first()
    .click()
    .catch(() => {});
  await wait(200);
  await shot('picker-other-game');
  await page.locator('.save-side-row', { hasText: 'FreshStartU8' }).click();
  await wait(200);
  await shot('picker-too-old');
  ok('a save from before 1.0 cannot be imported', await page.locator('.save-foot .primary-button').isDisabled());
  await page.locator('.save-side-row', { hasText: 'Frodo' }).click();
  await page.setViewportSize({ width: 900, height: 800 });
  await wait(300);
  await shot('picker-900');
  await page.keyboard.press('Escape');
  await wait(300);
  // At 900 the top bar folds into the ⋯ menu.
  await page.click('.menu-button');
  await page.click('.save-sheet-button');
  await page.waitForSelector('.save-dialog');
  await wait(400);
  await shot('import-window-900');

  section = 'damaged file';
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(300);
  await page.click('.save-button');
  await page.waitForSelector('.save-dialog');
  const bad = path.join(OUT, 'broken.sav');
  const real = fs.readFileSync(`${SAVES}/ela/a.sav`);
  fs.writeFileSync(bad, real.subarray(0, 60000));
  await choose(() => page.click('.save-dialog .save-wide'), bad);
  await page.waitForSelector('.setting-note.bad', { timeout: 30000 });
  await shot('damaged');
  ok('a damaged file says so', (await page.locator('.setting-note.bad').textContent()).length > 10);
  fs.rmSync(bad);

  section = 'phone';
  await open(390, 844, seed({}), true);
  await page.click('.menu-button');
  await page.waitForSelector('.sheet');
  await wait(300);
  await shot('phone-menu');
  await page.locator('.save-sheet-button').dispatchEvent('click');
  await page.waitForSelector('.save-dialog');
  await wait(400);
  await shot('phone-import-window');
  ok(
    'a phone offers one file, no folder',
    (await page.locator('.save-big').textContent()).includes('.sav file') && (await page.locator('.save-drop').count()) === 0,
  );
  await choose(() => page.locator('.save-big').dispatchEvent('click'), `${SAVES}/online/etothepii/Dunarr-076.sav`);
  await reading();
  await page.waitForSelector('.save-dialog .toggle');
  await shot('phone-questions');
  await page.locator('.save-foot .primary-button').dispatchEvent('click');
  await page.waitForSelector('.save-came');
  await shot('phone-result');
  await page.locator('.save-foot .primary-button').dispatchEvent('click');
  await wait(300);
  await page.click('.menu-button');
  await page.waitForSelector('.sheet');
  await wait(300);
  await shot('phone-menu-followed');
  ok('the phone menu names the followed game', (await page.locator('.save-sheet-text small').textContent()).startsWith('Dunarr · saved'));
  await page.keyboard.press('Escape');
  await wait(300);
  await page.locator('.mode-switch [role=radio] >> nth=3').dispatchEvent('click');
  await wait(1500);
  await shot('phone-map');
  ok('the phone map names factories', (await page.locator('.map-factory-label').count()) > 0);
  await page.locator('.mobile-nav button', { hasText: 'Filter' }).dispatchEvent('click');
  await wait(1500);
  await shot('phone-map-filter');
  ok('the phone filter has the picked-up switch', await page.locator('.map-picked').isVisible());
  await page.locator('.mode-switch [role=radio] >> nth=0').dispatchEvent('click');
  await wait(500);
  await page.locator('.plan-current').dispatchEvent('click');
  await page.locator('.plan-row.all .plan-row-name').dispatchEvent('click');
  await page.waitForSelector('.save-card');
  await page.locator('.save-list').scrollIntoViewIfNeeded();
  await wait(400);
  await shot('phone-all');
  await page.locator('.save-card .ghost-button').nth(1).dispatchEvent('click');
  await page.waitForSelector('.save-floor .react-flow__node', { timeout: 120000 });
  await wait(1500);
  await shot('phone-save-floor');
  ok('a phone opens a save factory read only', await page.locator('.save-stamp').isVisible());
  await page.locator('.save-info-head').dispatchEvent('click');
  await wait(300);
  await shot('phone-save-floor-folded');
} catch (e) {
  ok('ran to the end', false, e.message.split('\n')[0]);
  await shot('stopped').catch(() => {});
}

ok('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.httpServer.close();
const lines = results.map((r) => `- ${r.pass ? 'ok' : '**FAIL**'} ${r.section}: ${r.step}${r.info ? ` (${r.info})` : ''}`);
fs.writeFileSync('e2e/out/save-import.md', `# Save import\n\n${lines.join('\n')}\n`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
