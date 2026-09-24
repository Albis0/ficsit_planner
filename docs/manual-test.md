# Manual test

A click-through of the whole app, to run by hand before a release or after a big change. Each step says what to
do and what you should see. Tick the box when it matches; when it doesn't, note the step number and what you saw.

It takes about 20 minutes on a desktop, plus 10 on a phone.

## Before you start

- **Where:** the live site, <https://ficsit-planner.pages.dev>, or a local build: `bun run build`, then
  `bun run preview` and open <http://localhost:4173>.
- **Start clean:** open it in a private (incognito) window. The app keeps everything in the browser, so a normal
  window remembers your last session and skips the first-run steps.
- **Browsers:** Chrome or Edge on a desktop, plus one phone (Safari on iPhone or Chrome on Android).
- **Zoom:** browser zoom at 100% (Ctrl + 0).

## 1. First run

- [ ] **1.1** Open the site. *Expect:* a "Where are you in the game?" window with tier cards.
- [ ] **1.2** Pick **Tier 3**. *Expect:* the window closes. The top bar says **Tier 3**. The page shows only
  "What are we making?", a search box and item cards. There is no side panel on the left.
- [ ] **1.3** Look at the cards. *Expect:* items you can't make at Tier 3 (for example Modular Engine, Magnetic
  Field Generator) are dimmed and carry a small **TIER N** tag. Smart Plating, Iron Plate and Rotor have no tag.
- [ ] **1.4** Triple-click the "What are we making?" heading, then drag across a card. *Expect:* nothing gets
  highlighted as selected text.
- [ ] **1.5** Type `motor` in the search box. *Expect:* only Motor and Turbo Motor are shown, both with their
  tier tag. Clear the box: the shortcuts come back.
- [ ] **1.6** Type `plate` and press **Enter**. *Expect:* the first match is added as a target, the side panel
  appears with it under **Targets**, and the factory graph is drawn.

Remove that target with the **×** on its card before going on. *Expect:* you're back on the first screen.

## 2. Something you can't build yet

- [ ] **2.1** Still on Tier 3, click **Magnetic Field Generator**. *Expect:* no graph. A box in the middle says
  "Can't build this yet: Magnetic Field Generator unlocks at Tier 8. You're on Tier 3", with **Switch to Tier 8**
  and **Bring in 5/min** buttons. The side panel shows the target.
- [ ] **2.2** Click **Switch to Tier 8**. *Expect:* the top bar says Tier 8 and a full factory graph appears.
- [ ] **2.3** Remove the target and click **Smart Plating**. *Expect:* a graph with about 7 machines.

## 3. Factory graph

- [ ] **3.1** On first open, the whole factory fits the floor. *Expect:* if it's small, each machine shows a big
  product icon, a count like "3×" and the product name. There are no text labels on the belts.
- [ ] **3.2** Scroll to zoom in. *Expect:* past a point, machines switch to the detailed card: the machine type
  and power on the orange strip, the building icon, the recipe name, and "3 × 83.33%" on one line (count and
  clock together).
- [ ] **3.3** Look at the belt labels when zoomed in. *Expect:* the item icon on the left, the item name on top,
  and the rate with the belt tier (for example "5/min Mk.1") underneath. No label sits on top of a machine.
- [ ] **3.4** Click **→** (left to right) in the bottom right. *Expect:* the graph is redrawn running left to
  right. Click **↓**: it runs top to bottom. Reload the page: your choice is kept.
- [ ] **3.5** Click **Fit to screen**. *Expect:* the whole factory fills the floor.
- [ ] **3.6** Hover a machine. *Expect:* it and its direct neighbours stay bright and everything else fades.
- [ ] **3.7** Drag a machine somewhere else. *Expect:* it moves with the pointer, and its belts follow as plain
  curves.
- [ ] **3.8** Click **List**. *Expect:* a table of recipes and a build materials list. Click **Factory** to go back.

## 4. Machine panel (clock speed)

- [ ] **4.1** Click the **Rotor** machine. *Expect:* a panel opens on the right. **Machines** shows a number with
  − and + buttons. **Clock speed** shows the same percentage as the Rotor card on the graph (for example 2 on the
  graph and 62.5% match "2" and "62.5" in the panel).
- [ ] **4.2** Press **+**. *Expect:* machines goes up by one, the clock goes down (2 × 62.5% → 3 × 41.67%), and
  the graph card shows the same new values.
- [ ] **4.3** Type `100` in the clock box and press **Enter**. *Expect:* it snaps to the nearest speed that splits
  the work evenly (for Rotor at 5/min: 1 machine at 125%), and the graph card matches.
- [ ] **4.4** Drag the clock slider and let go. *Expect:* when you let go it snaps the same way, and the machine
  count updates.
- [ ] **4.5** Click **Reset**. *Expect:* back to the starting values.

## 5. Power shards and somersloops

- [ ] **5.1** Under **Your inventory**, enter 2 somersloops and 5 power shards, then click **Auto place**.
  *Expect:* a list of where they went appears under the button.
- [ ] **5.2** Look at the graph. *Expect:* machines with power shards have a **blue** edge along the bottom,
  machines with somersloops a **pink** one, and a machine with both is half blue, half pink. No yellow glow.
- [ ] **5.3** Look at the readouts along the top. *Expect:* Power shards in blue, Somersloops in pink, and no
  grey empty block even when the row wraps.
- [ ] **5.4** Click **Remove all**. *Expect:* the coloured edges go away.

## 6. On-hand items and recipes

- [ ] **6.1** Click **Add an item you already have**, type `screw`, press **Enter**. *Expect:* Screws appear
  under Already on hand, and the graph shows a **green** "On hand" Screws box feeding the line.
- [ ] **6.2** Open **Recipes** and turn off **Iron Plate**. *Expect:* a red strip above the graph says Iron Plate
  "needs the Iron Plate recipe, which is turned off", with **Turn recipe on** and **Bring in** buttons.
- [ ] **6.3** Click **Turn recipe on**. *Expect:* the strip goes away and the graph is whole again.

## 7. Resources and limits

- [ ] **7.1** Open **Resources** and set Iron Ore's limit to `1`. *Expect:* a red message in the middle: "These
  targets can't be made within your resource limits…". Clear the limit: the graph comes back.
- [ ] **7.2** On the graph, click the Iron Ore amount and type a smaller number. *Expect:* a "Targets scaled to
  your pinned inputs" strip, and every target shrinks to fit. **Unpin all** undoes it.

## 8. Side panel and factories

- [ ] **8.1** Drag the side panel's right edge to the right. *Expect:* the panel gets wider and the graph narrower,
  with an orange line on the edge while you drag. Reload: the width is kept. Double-click the edge: back to the
  default width.
- [ ] **8.2** Click **+** next to the factory tab. *Expect:* a new empty factory showing the first screen. Switch
  back to the first tab: its plan is still there.
- [ ] **8.3** Double-click a tab name, rename it, press **Enter**. Then **Duplicate** and **Delete** (click twice
  to confirm). *Expect:* each does what it says.
- [ ] **8.4** The top bar has no "Optimize for" switch.

## 9. Offline and install

- [ ] **9.1** After the first load, a "Ready to work offline" note appears at the top and goes away on its own.
- [ ] **9.2** Chrome or Edge: click **Install app** in the top bar (or the install icon in the address bar).
  *Expect:* it opens in its own window, with a FICSIT icon on the desktop or in the Start menu.
- [ ] **9.3** Turn off Wi-Fi (or DevTools → Network → Offline) and reload. *Expect:* the app still opens and still
  solves new targets.

## 10. Phone

Use a real phone if you can. A desktop browser's device mode is close but isn't Safari.

- [ ] **10.1** Open the site. *Expect:* the first screen fills the phone, with no bottom bar yet and no sideways
  scrolling.
- [ ] **10.2** Tap **Smart Plating**. *Expect:* the factory runs top to bottom, the bottom bar appears (Targets,
  Recipes, Resources, Factory), and the direction and fit buttons sit bottom right beside Factory / List without
  overlapping.
- [ ] **10.3** Pinch to zoom and drag to pan. *Expect:* smooth, and machines don't move when you drag across them.
- [ ] **10.4** Tap a machine. *Expect:* the machine panel slides up from the bottom, with − / + and the clock.
- [ ] **10.5** Tap **⋯** (top right). *Expect:* a sheet with Tier, factory actions and Install.
- [ ] **10.6** iPhone: Share → **Add to Home Screen**, then open it from the home screen. *Expect:* full screen,
  nothing hidden under the notch or the home bar.

## 11. Link previews and search

- [ ] **11.1** Paste the site link in Discord or a Reddit post draft. *Expect:* a large card with the FICSIT
  Planner image, title and description.
- [ ] **11.2** Open <https://ficsit-planner.pages.dev/robots.txt>, `/sitemap.xml` and a made-up page like
  `/nope`. *Expect:* the first two show plain text or XML, and the last shows "Nothing built here".
