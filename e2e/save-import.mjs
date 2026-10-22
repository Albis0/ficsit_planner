// Imports a real game save the way a player would: the button, the window, the folder, the picker, the cover while
// it reads, the first questions, what came in, the map, the save's factories (All, a link and
// its ticks), its power circuit as a plant tab; then a refresh after the player changed things, Settings › Game save,
// forgetting it, and the same on a phone.
//
//   bun run build && node e2e/save-import.mjs
//
// Needs the player saves in C:/code/ficsit-ekler/ficsit-saves (never in the repo: they hold the player's name and account); without
// them it says so and stops. Pictures go to e2e/out/save-import/, results to e2e/out/save-import.md.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const SAVES = 'C:/code/ficsit-ekler/ficsit-saves';
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
    'the window lists the path of every system',
    (await page.locator('.save-where .save-path').count()) === 3 &&
      (await page.locator('.save-where .save-path code').first().textContent()) === clip,
  );
  // A page the browser does not trust refuses the clipboard: the path is then selected for Ctrl+C.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('refused'));
  });
  await page.locator('.save-path button').nth(1).click();
  await wait(200);
  ok(
    'a refused clipboard selects the path instead',
    (await page.locator('.save-path button').nth(1).textContent()) === 'Press Ctrl+C' &&
      (await page.evaluate(() => getSelection()?.toString())) === (await page.locator('.save-path code').nth(1).textContent()),
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
  ok('the result says what came onto the map', /The map/.test(came) && /21 nodes mined/.test(came) && /3 factories/.test(came), came);
  ok('the result counts the power circuit', /1 circuit/.test(came) && /1,500 MW of generators/.test(came), came);
  let s = await state();
  ok(
    'the map takes the miners, pickups and factories',
    s.save?.map?.miners.length === 21 &&
      s.save.map.picked.slug1?.length === 15 &&
      s.save.map.factories.length === 3 &&
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
  ok('the save card names the followed game', ((await page.locator('.map-save-game').textContent()) ?? '').startsWith('ela · '));
  await page.click('.map-save-more');
  ok('the card lists each find on its own', (await page.locator('.map-save-rows li').count()) === 6);
  ok('hard drives are among them', (await page.locator('.map-save-rows').textContent()).includes('Hard drive'));
  await wait(800);
  await shot('map-details');
  const rowNs = await page.locator('.map-save-n').allTextContents();
  const rowGot = rowNs.reduce((n, t) => n + Number(t.split('/')[0].replace(/\D/g, '')), 0);
  const total = Number((await page.locator('.map-save-total strong').textContent()).replace(/\D/g, ''));
  ok('the total is what the rows add up to', total > 0 && total === rowGot, `${total} / ${rowGot}`);
  ok('Grey, Hide and Normal are offered', (await page.locator('.map-picked [role=radio]').allTextContents()).length === 3);
  await page.click('.map-picked [role=radio] >> nth=2');
  ok('Normal is kept', (await state()).mapFilter.picked === 'show');
  await page.click('.map-picked [role=radio] >> nth=0');
  ok('Grey is kept', (await state()).mapFilter.picked === 'grey');
  await page.click('.map-save-more');
  ok('the factories are named on the map', (await page.locator('.map-factory-label').count()) === 3);
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
  ok(
    'All lists the save’s power circuit only: no factory cards',
    (await page.locator('.save-list .save-card').count()) === 1 &&
      !(await page.locator('.save-list').textContent()).includes('Modular Frame'),
  );
  s = await state();
  const frames = s.save.map.factories[0].id;

  section = 'save power';
  await openAll();
  const grid = page.locator('.save-grids-title + .save-cards .save-card');
  await page.locator('.save-grids-title').scrollIntoViewIfNeeded();
  await wait(300);
  await shot('all-power');
  ok(
    'All lists the save’s power circuit: what it makes and draws',
    (await grid.count()) === 1 && /^1,500 MW · uses \d/.test(await grid.locator('header small').textContent()),
    await grid.locator('header small').textContent(),
  );
  ok('with its generators and batteries', (await grid.locator('.save-counts li').allTextContents()).join() === '20,16');
  await page.setViewportSize({ width: 900, height: 800 });
  await wait(400);
  await page.locator('.save-grids-title').scrollIntoViewIfNeeded();
  await shot('all-power-900');
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(300);
  await grid.locator('.ghost-button').click();
  await wait(2500);
  await shot('power-from-save');
  s = await state();
  const plant = s.power.find((p) => p.id === s.activePower);
  ok(
    'Make a power plant tab opens a plant with the circuit’s generators',
    s.mode === 'power' &&
      !s.overview &&
      (await page.locator('.plan-tab-label').textContent()) === 'Coal plant' &&
      s.power.length === 1 &&
      plant.name === 'Coal plant' &&
      JSON.stringify(plant.plants.map((p) => [p.generator, p.fuel, p.by, p.amount, p.clock])) ===
        JSON.stringify([['Build_GeneratorCoal_C', 'Desc_Coal_C', 'count', 20, 1]]),
    JSON.stringify(plant?.plants),
  );
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
  ok('the factory is found again with the same id', s.save.map.factories[0].id === frames);
  await page.click('.save-foot .primary-button');

  section = 'settings';
  await page.click('.save-button');
  await page.click('.save-menu .menu-item >> nth=2');
  await page.waitForSelector('.save-line');
  await wait(300);
  await shot('settings');
  ok('Settings opens on Game save', (await page.locator('.settings-heading').textContent()) === 'Game save');
  s = await state();
  ok('the kind of save last imported is what Refresh takes', s.save.from === 'manual' || s.save.from === 'auto', s.save.from);
  const other = s.save.from === 'auto' ? 'manual' : 'auto';
  await page
    .locator('.settings-controls .segmented button', { hasText: other === 'auto' ? 'Latest autosave' : 'Latest save of yours' })
    .click();
  s = await state();
  ok('and it can be switched to the other kind', s.save.from === other, s.save.from);
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
  await page.locator('.map-save-more').dispatchEvent('click');
  await wait(800);
  await shot('phone-map-details');
  ok('the phone filter has the picked-up switch', await page.locator('.map-picked').isVisible());
  await page.locator('.mode-switch [role=radio] >> nth=0').dispatchEvent('click');
  await wait(500);
  await page.locator('.plan-current').dispatchEvent('click');
  await page.locator('.plan-row.all .plan-row-name').dispatchEvent('click');
  await page.waitForSelector('.save-card');
  await page.locator('.save-list').scrollIntoViewIfNeeded();
  await wait(400);
  await shot('phone-all');
  await page.locator('.save-grids-title').scrollIntoViewIfNeeded();
  await wait(300);
  await shot('phone-all-power');
  ok('a phone lists the power circuits too', (await page.locator('.save-grids-title + .save-cards .save-card').count()) === 1);
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
