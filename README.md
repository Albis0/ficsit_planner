<p align="center">
  <img src="public/logo.png" width="96" alt="FICSIT Planner logo">
</p>

<h1 align="center">FICSIT Planner</h1>

<p align="center">
  <a href="https://github.com/Albis0/ficsit_planner/actions/workflows/ci.yml"><img src="https://github.com/Albis0/ficsit_planner/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue" alt="License: GPL-3.0-or-later"></a>
</p>

<p align="center"><b><a href="https://ficsit-planner.pages.dev">Open FICSIT Planner → ficsit-planner.pages.dev</a></b></p>

<p align="center">
  <img src="public/icons/Desc_SpaceElevatorPart_1_C.webp" width="40" alt="Smart Plating">
  <img src="public/icons/Desc_SpaceElevatorPart_2_C.webp" width="40" alt="Versatile Framework">
  <img src="public/icons/Desc_SpaceElevatorPart_3_C.webp" width="40" alt="Automated Wiring">
  <img src="public/icons/Desc_SpaceElevatorPart_4_C.webp" width="40" alt="Modular Engine">
  <img src="public/icons/Desc_SpaceElevatorPart_5_C.webp" width="40" alt="Adaptive Control Unit">
  <img src="public/icons/Desc_SpaceElevatorPart_6_C.webp" width="40" alt="Magnetic Field Generator">
  <img src="public/icons/Desc_SpaceElevatorPart_7_C.webp" width="40" alt="Assembly Director System">
  <img src="public/icons/Desc_SpaceElevatorPart_8_C.webp" width="40" alt="Thermal Propulsion Rocket">
  <img src="public/icons/Desc_SpaceElevatorPart_9_C.webp" width="40" alt="Nuclear Pasta">
  <img src="public/icons/Desc_SpaceElevatorPart_10_C.webp" width="40" alt="Biochemical Sculptor">
  <img src="public/icons/Desc_SpaceElevatorPart_11_C.webp" width="40" alt="Ballistic Warp Drive">
  <img src="public/icons/Desc_SpaceElevatorPart_12_C.webp" width="40" alt="AI Expansion Server">
</p>

Production planner for Satisfactory that runs in the browser. Enter what you want per minute and it picks the
recipes, counts the machines, sets their clock speeds and draws the factory with its belts and pipes. The maths is
done by a linear programming solver ([HiGHS](https://highs.dev), compiled to WebAssembly).

It also plans power plants and their fuel, has a Codex with the game's parts, buildings, milestones, research and
alternate recipes, and a map of every resource node. It can be installed as an app (PWA) and then works offline.

![The factory graph for 10 motors per minute](docs/desktop-graph.webp)

![The power planner: a fuel plant sized to two factories, with crude oil refined into fuel for eight generators that feed both factories and its own refineries](docs/desktop-power.webp)

![The Codex: the Motor's page, with every way to make it and what it goes into](docs/desktop-codex.webp)

![The world map with every resource node, coloured by purity](docs/desktop-map.webp)

<p align="center">
  <img src="docs/phone-graph.webp" width="30%" alt="Phone: the factory runs top to bottom">
  <img src="docs/phone-inspector.webp" width="30%" alt="Phone: clock speed and somersloops in a bottom sheet">
  <img src="docs/phone-table.webp" width="30%" alt="Phone: every recipe as a card">
</p>

## Features

| | |
| :-: | --- |
| <img src="public/icons/Desc_ModularFrame_C.webp" width="36" alt="Modular Frame"> | **Targets and tabs.** Any number of products per factory, each at its own rate. Factories are tabs you can rename, duplicate and delete. Everything is saved in the browser. |
| <img src="public/icons/Desc_IronPlate_C.webp" width="36" alt="Iron Plate"> | **On-hand items.** Parts that arrive from elsewhere (another factory, a train). The planner uses them instead of making them. |
| <img src="public/icons/Build_AssemblerMk1_C.webp" width="36" alt="Assembler"> | **Recipes.** Standard, alternate and converter recipes, grouped by product, each one on or off. When something can't be made, the planner says why (the tier that unlocks it, or the recipe that's off) and offers the fix. |
| <img src="public/icons/Desc_SpaceElevatorPart_2_C.webp" width="36" alt="Versatile Framework"> | **Tier.** You pick the highest tier you've unlocked. Recipes, buildings, belts and miners above it are left out. |
| <img src="public/icons/Desc_OreIron_C.webp" width="36" alt="Iron Ore"> | **Resource limits.** A per-minute cap for each raw resource. Empty means the whole map's supply. The list shows only the resources the plan can use; the rest are one click away. |
| <img src="public/icons/Desc_Coal_C.webp" width="36" alt="Coal"> | **Pinned inputs.** Type the amount of a raw resource you actually have into the totals strip, and the targets scale to it. |
| <img src="public/icons/Desc_CrystalShard_C.webp" width="36" alt="Power Shard"> | **Machines and clocks.** Select a machine to set how many there are or their clock speed. Power uses the game's formula. Overclocked lines use as few power shards as possible. |
| <img src="public/icons/Desc_WAT1_C.webp" width="36" alt="Somersloop"> | **Somersloops and shards.** Set them per machine, or enter how many you own and let the planner place them (**Auto place** or **Use all**). |
| <img src="public/icons/Build_MinerMk2_C.webp" width="36" alt="Miner Mk.2"> | **Extraction.** Miner mark, node purity and extractor clock decide how many miners and pumps each resource needs, and their power. |
| <img src="public/icons/Build_ConveyorBeltMk5_C.webp" width="36" alt="Conveyor Belt Mk.5"> | **Graph and list.** The graph runs left to right or top to bottom, colours belts by tier and splits a flow over more belts when one isn't enough. The list shows every recipe and the build cost. |
| <img src="public/icons/Build_GeneratorNuclear_C.webp" width="36" alt="Nuclear Power Plant"> | **Power planner.** Power plants are tabs too and can mix generators. Size one by the fuel you have, the MW you want or the factories it runs. The fuel chain, water, nuclear waste, augmenters and Power Storage are counted. |
| <img src="public/icons/Desc_HardDrive_C.webp" width="36" alt="Hard Drive"> | **Codex.** Parts, resources, buildings, vehicles, equipment, milestones, MAM research, alternate recipes and the AWESOME Shop, with the game's descriptions. Also the creatures (health, speed, what they leave behind, where they spawn), what can be found in the world, and what each crash site takes to open. Every part shows its whole production line (raw resources, buildings, power) and how each of its recipes compares once everything before it is made too; every alternate is ranked against the standard recipe. Guides cover getting started, the Space Elevator phases, power from biomass to nuclear, oil and nuclear waste, with small calculators. **Build this factory** opens a factory for any part. |
| <img src="public/icons/Build_MinerMk3_C.webp" width="36" alt="Miner Mk.3"> | **World map.** All 459 resource nodes, 118 well nodes and 31 geysers on the game's map, filtered by resource and purity. Pressing a node shows what each miner or extractor gets from it. Somersloops, Mercer Spheres, power slugs, crash sites, berries, nuts, mushrooms and every creature's spawn points can be turned on too. |
| <img src="public/icons/Desc_FreightWagon_C.webp" width="36" alt="Freight Wagon"> | **Linked factories.** A factory can take an item from another factory tab, which then makes it on top of its own products. |
| <img src="public/icons/Desc_ModularFrameLightweight_C.webp" width="36" alt="Radio Control Unit"> | **Share links.** The **Share** button copies a link that contains the factory (and the power plants that run it). Opening it adds a copy as a new tab. Nothing is uploaded. |
| <img src="public/icons/Desc_CircuitBoard_C.webp" width="36" alt="Circuit Board"> | **Settings.** Panel position, card and text size, spacing, belt labels, colours, interface size, decimals and animations. Save all factories and settings to a file and load them back. **Help** explains the terms on screen. |
| <img src="public/icons/Desc_CrystalOscillator_C.webp" width="36" alt="Crystal Oscillator"> | **Feedback.** Bug reports and ideas from inside the app, stored in the site's own database, optionally with the factory on screen. |
| <img src="public/icons/BP_ItemDescriptorPortableMiner_C.webp" width="36" alt="Portable Miner"> | **Phones and offline.** Installs as an app and works offline. On phones there is one pane at a time and a bottom bar. |

## Install as an app

- **Chrome, Edge (desktop), Chrome (Android):** click **Install app** in the top bar, or use the install icon in
  the address bar.
- **iPhone, iPad (Safari):** tap **Share**, then **Add to Home Screen**. The Install app button explains this.
- **Firefox (desktop):** has no install option. Use it as a normal website.

After the first visit everything is cached, including the solver and all icons. The planner then works without a
network. Updates install on their own the next time you open it, and your factories stay saved in the browser.

To make the cards or the interface bigger or smaller, open **Settings** (top right). The browser's zoom (Ctrl + /
Ctrl −, or pinch on a touch screen) works too. On a desktop, drag the panel's edge to resize it (double-click the
edge to reset it), or click **Hide panel** to give the factory the whole screen. Amounts have up and down buttons
(and the arrow keys) that move them one whole number at a time.

## Development

Needs [Bun](https://bun.sh).

```sh
bun install
bun run dev        # http://localhost:1420
bun test           # solver, hand-checked numbers, random plans, graph, saved state and strings
bun run check      # Biome lint + format check (bun run format to fix)
bun run build      # type check + production bundle in dist/
bun run preview    # serve dist/ with the service worker, as it will be deployed
bun run sweep      # every screen at five window sizes, checked for layout problems (see CONTRIBUTING)
bun run visual     # screenshots of 28 screens compared with e2e/baseline
```

CI (GitHub Actions) runs check, test and build on every push, then a sample of every screen in Chromium, WebKit
and Firefox.

The build is a static site. To serve it from a sub-folder, for example GitHub Pages at `/<repo>/`, set
`BASE_PATH`:

```sh
BASE_PATH=/ficsit_planner/ bun run build
```

On Windows, run that in PowerShell (`$env:BASE_PATH = '/ficsit_planner/'; bun run build`). Git Bash rewrites
arguments that look like Unix paths into Windows paths, so the base comes out as `/Program Files/Git/...`. Prefix
the command with `MSYS_NO_PATHCONV=1` if you want to stay in Git Bash.

### Deploying

The live site is on Cloudflare Pages. `wrangler.jsonc` names the project and its feedback database, and
`public/_headers` sets the security headers and long caching for the hashed files in `assets/`.

```sh
bunx wrangler login   # once, opens the browser
bun run deploy        # build, then upload dist/ and functions/ to https://ficsit-planner.pages.dev
```

### Feedback from players

The in-app **Feedback** window posts to `functions/api/report.ts`, a Pages Function that stores each report in a
D1 database (`ficsit-reports`, schema in `migrations/`). It checks the fields, turns away other sites, drops bots
that fill a hidden field, strips control characters, and allows six reports an hour per sender. Senders are kept for
an hour as a salted hash for that limit and never with a report. Read the reports from your machine:

```sh
bun run reports            # open reports, newest first
bun run reports show 12    # one in full, with the factory it came with
bun run reports done 12    # mark it handled
bun run reports md         # write the open ones to reports/feedback.md
bun run db:migrate         # apply a new schema file in migrations/ to the live database
```

Add `--local` to any of them to read the database `bunx wrangler pages dev dist` uses instead. The salt is the
`REPORT_SALT` secret on the Pages project. See [docs/feedback.md](docs/feedback.md) for the details.

`SITE_URL` (default `https://ficsit-planner.pages.dev`) goes into the canonical link, the social preview tags,
`robots.txt` and `sitemap.xml`, which the build writes. Set it when you host the site somewhere else, including the
sub-folder if there is one: `SITE_URL=https://you.github.io/ficsit_planner`. The social preview image is
`public/og-image.jpg` (1200 × 630).

App icons (favicon, PWA and iOS icons) are generated from `public/logo.png` with `bun run pwa-icons`. Commit the
files it writes to `public/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for code style and what to check before a change goes in, and
[CHANGELOG.md](CHANGELOG.md) for what changed between versions.

## How the solver works

`src/lib/solver.ts` builds an LP in CPLEX text format and hands it to HiGHS, which runs in a Web Worker
(`src/lib/solver.worker.ts`) so the page never freezes.

- **Variables:** one per enabled recipe (machines running at that recipe's clock and somersloop setting), one per
  raw resource used, and one "missing" variable for every item no enabled recipe can make.
- **Constraints:** for every item, net production ≥ demand − on-hand supply. Raw resources are capped by the
  player's limit, or by the world limit when there is none.
- **Objective:** minimise raw use weighted by scarcity (iron's world limit ÷ the resource's limit), plus a tiny
  machine-power term so it never builds machines it doesn't need. Missing items cost 10⁵ each, so they only appear
  when nothing else works. The solver can also minimise power instead; the app doesn't offer it, because with
  standard recipes both goals nearly always pick the same factory.
- **Power plants** join the model as stand-in recipes: one "machine" is one generator at its clock, taking its
  fuel and water and leaving its waste, so the fuel chain is solved like any factory. When a plant is set to Auto,
  one more row says generation (times the augmenter boost) must cover the outside demand plus every machine and
  extractor in the plan, with the spare capacity on top. Fixed plants are pinned to their count or output.
- **Pinned inputs** are solved in two passes. The first maximises a scale factor *k* on all targets, with the
  pinned resources as hard limits. The second solves the normal objective at that *k*.
- **Shadow prices** of the item rows give the marginal raw cost of each item. Auto place uses them to send
  somersloops to the machines whose inputs are most expensive.
- **Failures** come back as codes (`infeasible`, `pinnedInfeasible`, `stopped`), and the UI shows them as text in
  the current language.

After solving, fractional machine counts are rounded up to buildings you can actually place, each with its own
clock. `src/lib/graph.ts` then matches each item's producers to its consumers greedily, largest first, which keeps
the belt count low. dagre lays the graph out left to right, or top to bottom on phones.

## Project layout

| Path | What |
| --- | --- |
| `src/lib/solver.ts` | LP model, solve, somersloop/shard auto placement |
| `src/lib/solver.worker.ts`, `solverClient.ts` | the solver in a Web Worker, and its promise API |
| `src/lib/graph.ts` | solution → nodes and belts; layout tries both directions and three rankings, keeps the one that fits the screen with the fewest crossings, and routes belts through space kept for their labels |
| `src/lib/extraction.ts` | miner and pump counts per node purity, and their MW per unit for the power planner |
| `src/lib/power.ts`, `src/lib/solution.ts` | generators as solver recipes, and the hooks that solve factories and power plants |
| `src/lib/settings.ts`, `src/lib/backup.ts` | settings and the CSS variables they set; save and load a copy |
| `src/lib/feedback.ts`, `src/lib/feedback-schema.ts`, `functions/api/report.ts` | the feedback window's request, its checks, and the endpoint that stores it |
| `src/lib/codex.ts`, `src/components/Codex.tsx`, `CodexGuides.tsx`, `CodexLine.tsx` | the Codex: its data, index and search, pages and addresses, the guides, and the production lines and recipe comparisons |
| `src/lib/insights.ts`, `scripts/codex-insights.ts` | works out each part's whole production line, its recipes compared and every fuel's cost, with the solver |
| `src/locales/codex-notes.en.ts` | the Codex's Good to know notes on parts and buildings |
| `src/lib/data.ts` | typed access to the game data, belt/pipe choice per flow, unlock tiers and why an item can't be made |
| `src/locales/en.ts`, `src/lib/lang.ts`, `src/lib/i18n.ts` | UI strings, language registry, `useT()` |
| `src/lib/install.ts`, `src/components/PwaStatus.tsx` | install button and offline status |
| `index.html`, `vite.config.ts` | page title, search and social preview tags, PWA manifest, `robots.txt` and sitemap |
| `public/_headers`, `public/404.html`, `wrangler.jsonc` | Cloudflare Pages headers, not-found page, project config |
| `src/store.ts` | app state (zustand), saved to `localStorage` |
| `src/components/` | panels, graph view, table view, inspector, power panel and floor, mode switch, settings and feedback windows, phone navigation, panel splitter |
| `migrations/`, `scripts/reports.mjs` | feedback database schema, and reading the reports |
| `scripts/extract.mjs`, `scripts/extract-codex.mjs` | game data extractors: the planner's data, and the Codex's |
| `tools/icon-extractor/` | .NET icon extractor |
| `tools/map-extractor/`, `scripts/extract-map.mjs` | .NET world reader (resource nodes, the map picture) and the script that tiles the map |
| `src/lib/world.ts`, `src/components/WorldMap.tsx`, `src/components/MapNav.tsx` | the world map: node data, the map (Leaflet), its filter |
| `tests/` | solver, hand-checked production lines (`golden`), random plans (`fuzz`), extraction, auto placement, graph layout, unlock tiers, Codex insights, saved state and string tests |
| `e2e/` | the screen sweep (`sweep.mjs`, `checks.js`) and the screenshot comparison (`visual.mjs`, `baseline/`) |
| `docs/manual-test.md` | a click-through checklist for testing the app by hand before a release |

Saved state is versioned. After a game data refresh, recipes and items that no longer exist are dropped from
saved factories when they load.

### Adding a language

1. Copy `src/locales/en.ts` to a new file and translate the values. TypeScript flags any missing key.
2. Register it in `LANGS` in `src/lib/lang.ts`, along with its number-format locale.
3. Game item and recipe names come from the game's own translations in `CommunityResources/Docs`, so the
   extractor has to be run against an install to add them.

## Game data in this repo

| File | What | Made by |
| --- | --- | --- |
| `src/data/gamedata.json` | items, recipes, buildings, belts, extractors, generators and fuel energy | `bun run extract` |
| `src/data/meta.json` | which game build the data came from | `bun run extract` |
| `src/data/icon-manifest.json` | icon texture path per item/building | `bun run extract` |
| `src/data/codex.json` | descriptions, stack sizes, every building, vehicles, equipment, milestones, MAM research, the AWESOME Shop (loaded when the Codex opens) | `bun run extract:codex` |
| `src/data/codex-icons.json` | icon texture paths the Codex needs on top of the planner's | `bun run extract:codex` |
| `src/data/elevator.json` | the Space Elevator's phases: what each asks for and the tiers it opens | `bun run extract:elevator` |
| `src/data/insights.json` | each part's production line, its recipes compared, and every fuel's cost, worked out with the solver | `bun run insights` |
| `public/icons/*.webp` | item and building icons | `bun run icons`, `bun run icons:codex` |
| `src/data/world.json` | every resource node, well node and geyser: resource, purity, place on the map | `bun run extract:map` |
| `public/map/{z}/{x}/{y}.webp` | the game's map picture (8192 px) as 256 px tiles, zoom 0 to 5 | `bun run extract:map` |
| `src/data/finds.json` | somersloops, Mercer Spheres, power slugs, crash sites (with what opens them), plants and creature spawns on the map | `bun run extract:world` |
| `src/data/creatures.json` | each creature's name, description, health, speed and remains, and how many of everything the world holds | `bun run extract:world` |
| `src/data/world-icons.json`, `public/icons/Desc_Hog*.webp` … | creature icons and the textures they come from | `bun run extract:world`, `bun run icons:world` |

Last extract: **Satisfactory 1.2.4.0**, build 502094, Unreal Engine 5.6.1, on 2026-09-24 (see `src/data/meta.json`).

## Refreshing data after a game update (needs the game installed)

```sh
bun run extract                                            # Epic install on C: by default
bun run extract "D:/SteamLibrary/steamapps/common/Satisfactory"
bun run extract:codex                                      # after extract: it reads gamedata.json
bun run icons                                              # needs the .NET 10 SDK
bun run icons:codex
bun run extract:map                                        # the world map: nodes and tiles, needs .NET too
bun run extract:world                                      # after extract:map: finds, creatures and their icons
bun run extract:elevator                                   # the Space Elevator's phases, needs .NET too
bun run insights                                           # last: the Codex's worked-out lines (a test fails until it's run)
dotnet run --project tools/icon-extractor -- "D:/SteamLibrary/steamapps/common/Satisfactory"
```

The extractor also reads the install path from the `SATISFACTORY_DIR` environment variable. `bun run icons` points
at the default Epic install. For any other location, run the `dotnet` line from the repo root.

Commit the changed files under `src/data` and `public/icons` afterwards.

- `scripts/extract.mjs` reads `CommunityResources/Docs/en-US.json` (UTF-16) plus the build `.version` file.
  Seasonal (FICSMAS) recipes are skipped. `scripts/extract-codex.mjs` reads the same file for the Codex.
  Coupons and hard drives have no descriptor there, so their names and icon paths are set in the script.
- `tools/icon-extractor` reads the IoStore archives (`.utoc/.ucas`) with CUE4Parse and writes WebP.
  The game's `FactoryGame.usmap` writes `OptionalProperty` without an inner type, which CUE4Parse expects,
  so `UsmapPatch.cs` inserts a placeholder before loading it. The engine version is set in `Program.cs`
  (`EGame.GAME_UE5_6`). Bump it if a game update moves to a newer Unreal version. Pass `--find <text>` in place
  of the manifest to list archive paths containing that text, to look up an icon by hand.

## Notes

- World resource limits (used to weigh scarce ores) come from SatisfactoryTools. They were last compared with
  its current numbers on 2026-09-24 and were unchanged.
- Somersloop slot counts come from the game data, not the wiki. The current build gives Smelters 0 slots.

## License

The planner's code is free software under the **GNU General Public License v3.0 or later**. See
[LICENSE](LICENSE). You can use, study, change and share it. If you distribute it, changed or not, you have to
share the source under the same license.

These parts are not the project's own work, so the GPL doesn't cover them:

- **Game content.** Item and building icons (`public/icons/`), the map picture (`public/map/`) and the game data extracted into `src/data/`
  (names, recipes, numbers) belong to Coffee Stain Studios. They are included only so this free, non-commercial
  fan tool can work, and all rights to them stay with Coffee Stain. Satisfactory is a trademark of Coffee Stain
  Studios. This project is not affiliated with or endorsed by them.
- **Dependencies** keep their own licenses. HiGHS, React, React Flow, dagre, zustand and Workbox are MIT, Leaflet
  is BSD-2-Clause. The Heebo, Poppins, Inter, Rajdhani and Barlow fonts are SIL Open Font License 1.1. CUE4Parse, which the icon extractor uses, is Apache-2.0. All of
  them can be combined with GPLv3.
- **World resource limits** come from [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools), MIT.
