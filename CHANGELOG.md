# Changelog

All notable changes to FICSIT Planner. Dates are when the version was finished.

## 0.6.0 — 2026-09-25

### Changed

- **Power plants are tabs.** The power planner's one grid is now a row of plant tabs, like factories: add,
  rename, duplicate and delete them. A new plant is named after its first generator ("Coal plant").
  - One plant can mix generators and fuels.
  - Size a plant three ways: **What I have** (the fuel, or the ore and oil it's made from, per minute; it makes
    all it can and tells you what's left for the grid), **Power I want** (a set output), or **My factories**
    (the factory tabs you tick, plus other consumers and spare capacity).
  - A factory is counted on one plant only: ticking it on one takes it off the others.
  - Sized to factories, the plant follows them as they change, or holds a figure you set.
  - **Also run its own chain** can be turned off when the refineries and miners run on another grid.
  - Readouts: Covers (or what's left for the grid), Makes, Needs and Makes as well.
  - Saves and files from 0.5 load their grid as the first plant, feeding the same factories.

## 0.5.0 — 2026-09-24

### Added

- **Power planner.** A switch in the top bar flips between the factory planner and the power planner, with a
  reveal that opens from the switch.
  - The grid carries the factory tabs you tick, what you type in for everything else, and the spare capacity you
    want on top.
  - Power plants: Biomass Burner, Coal-Powered Generator, Fuel-Powered Generator, Nuclear Power Plant with each
    of their fuels, Geothermal Generator by geyser purity, and the Alien Power Augmenter, fed or not.
  - A plant can be sized to cover the demand (Auto), a set number of generators, or a set output, at any clock.
  - The fuel is planned like a factory with its own recipes, limits and extraction, and the power its machines
    and miners draw is added to the load. Water, nuclear waste and the augmenter boost are counted, and uranium
    waste feeds a plutonium plant when there is one.
  - The floor draws the whole grid: ore, fuel chain, generators, a power grid node, and the factories it feeds.
    Readouts show spare or short, generation, consumption, generators, water, waste and the power mix.
  - Backup: how many Power Storage units carry the load for a given time, and how long they take to refill.
- **Settings** (top right):
  - Put the panel on top, on the left or on the right.
  - Set the card size, text size and spacing on the floor, belt labels, moving belts and the foundation grid.
  - Pick the accent and recipe colours and the belt colouring, with a live preview.
  - Set the interface size, decimals and animations.
  - Save all factories, the grid and settings to a file, load them back, reset or delete everything.
- **Feedback** (top right): report a bug or suggest an idea from inside the app, optionally with the factory on
  screen attached. Reports go to the site's own database; `bun run reports` reads them.
- Generator and Power Storage icons, energy values for every fuel, and generator data from the game files.

### Fixed

- On phones, a panel folded on a desktop no longer hides the panel page.
- The "Ready to work offline" note no longer covers the tabs.
- A layout setting's hint no longer leaves a tall gap above its choices.
- Saved panel sizes from a bigger window no longer squeeze the floor out of view.

## 0.4.2 — 2026-09-24

### Added

- Raw inputs in the summary strip are editable: type an amount or step it up and down to pin it, and × to unpin.
  The graph's ore nodes still work too.
- When pinned inputs can't make anything, the error has an **Unpin all** button.

### Changed

- Every icon on a machine card sits next to its own name: the product's icon and name on the strip, the
  building's icon and name in the body.
- The power draw sits on a dark tag in power yellow, and "3 × 88.89%" uses plain digits with the clock nearly as
  big as the count, so both read more easily.
- **Auto place** moved up next to the Your inventory title, with its message right under it.

## 0.4.1 — 2026-09-24

### Changed

- Machine cards are back to the build-menu look (cut corner, coloured strip), with the icons swapped: the strip
  holds the product's icon, the building name and a larger power figure; the body shows the building with the
  recipe and "3 × 83.33%" beside it.
- Zooming out no longer swaps machines for a stripped-down poster; the card stays the same at every zoom, and
  the opening view doesn't zoom out as far.
- Output nodes have their orange wash back.

## 0.4.0 — 2026-09-24

### Changed

- The panel (targets, recipes, resources) now runs across the top, and the factory floor takes the full width
  under it. Each tab lays itself out across the width: targets, on hand and inventory side by side; recipe tools
  on the left with the recipes in columns; extraction on the left with every resource in a grid.
- Drag the panel's bottom edge to trade height with the floor, or hide the panel down to its tabs.
- Machines are a plain plate with the recipe kind along the top edge, the building and its power in a small
  header, and the product icon, name and "3 × 83.33%" underneath. Zoomed out, the same plate keeps just the
  product and the count, in big type.
- Output nodes lost their brown wash.

### Added

- Up and down buttons on target, on-hand and inventory amounts, one whole number per click (12.5 goes to 13 or
  12). The arrow keys do the same. On touch screens they are − and + either side of the field.

## 0.3.0 — 2026-09-24

### Added

- A first screen with nothing else on it: "What are we making?", a search over every item, and the usual
  shortcuts. The side panel appears once there is something to plan.
- Items above your tier say which tier unlocks them, on the first screen and in search.
- When something can't be made, the planner says why: the tier that unlocks it (with a button to switch), or the
  recipe that's turned off (with a button to turn it on). If nothing in the plan can be built, that explanation
  replaces the graph.
- Choose the graph direction: left to right or top to bottom. Without a choice, the layout takes whichever fits
  the screen better.
- Drag the side panel's edge to resize it. Double-click to reset.
- A machine count in the machine panel. Change it, or the clock speed, and the other follows.
- Zoomed far out, machines show their product and count in large type, readable at a glance.
- Machines with power shards get a blue edge, with somersloops a pink one, with both half and half.

### Changed

- The clock speed in the machine panel is now the clock the machines really run at, the same number the graph
  shows. It snaps to the speeds that split the work evenly across a whole number of machines.
- Machine cards read "3 × 83.33%": the count and the clock together.
- Belt labels show the item icon and name, with the rate and belt tier underneath, and have space kept for them
  in the layout, so they no longer sit on a machine.
- The layout tries several arrangements and keeps the one with the fewest crossing belts, and belts are routed
  around machines.
- On-hand items look different from raw inputs: green.
- Power shards are blue everywhere, somersloops pink.
- Text in the app can't be selected by accident while clicking and dragging.

### Removed

- The "Optimize for" switch. With standard recipes both goals nearly always chose the same factory.

### Fixed

- Picking an item above your tier drew a meaningless "bring in → output" graph.
- With power shards in use, the readouts along the top left a grey block when they wrapped.
- Long item names ran under the amount field in the narrow tablet side panel.

## 0.2.0 — 2026-09-24

The planner is now a web app instead of a Windows program.

### Added

- Install as an app (PWA). Chrome, Edge and Android add a desktop or home-screen shortcut, and iPhone and iPad
  do the same through the Share menu. It then opens in its own window.
- Works fully offline after the first visit. The solver, icons and fonts are all cached, and updates install on
  their own.
- Phone and tablet layout:
  - One pane at a time with a bottom navigation bar, and a menu for tier, goal and factory actions.
  - The factory graph runs top to bottom, the machine panel opens as a bottom sheet, and the table shows each
    recipe as a card.
  - Finger-sized buttons.
- Rename a factory from the menu, since touch screens have no double-click.
- A "Ready to work offline" notice after the first visit.
- Hosted on Cloudflare Pages at https://ficsit-planner.pages.dev.
- Search and link previews: page description, a preview image for Discord, Reddit and other sites, a sitemap
  and a not-found page.
- Automatic checks on every push: lint, formatting, tests and build.
- GPL-3.0-or-later license.

### Changed

- English only for now. Turkish returns later, together with German, Spanish, Chinese and Japanese.
- The solver runs in the background, so the page no longer freezes during auto place.

### Fixed

- Solver errors were always shown in Turkish, even with English selected.
- The first factory got a Turkish default name in every language.
- A new belt tier from a game update would have been drawn without a colour.

### Removed

- The Windows desktop build (Tauri).
- The A− / A+ size buttons. Use the browser's zoom instead (Ctrl + / Ctrl −, or pinch). The buttons made dragged
  machines drift away from the pointer.

## 0.1.0 — 2026-09-24

First version: a Windows desktop app (Tauri) in Turkish and English.

- Linear programming planner (HiGHS) with the two goals *fewer resources* and *less power*.
- Resource limits, on-hand items, pinned inputs, milestone tiers.
- Clock speed, somersloops, and auto placement of somersloops and power shards.
- Extraction counts, a factory graph and a table with build costs.
- Game data and icons extracted from Satisfactory 1.2.4.0 (build 502094) and committed, so no game install is
  needed to run it.
