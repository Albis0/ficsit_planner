# FICSIT Planner

Offline production planner for Satisfactory. Pick what you want to make and how many per minute; a linear
programming solver ([HiGHS](https://highs.dev), compiled to WebAssembly) picks the recipes, counts the machines,
sets their clock speeds and draws the factory as a belt-and-pipe graph.

React + Vite front end, packaged as a Tauri desktop app (Windows installer). It also runs in a plain browser.
The UI speaks English and Turkish. Everything runs offline: game data and icons are committed, so a checkout
works without the game installed and nothing reads the game at runtime.

## Features

- **Targets and factories.** Any number of products per factory, each at its own rate. Factories live in tabs
  (double-click to rename, duplicate, delete). All state is saved locally.
- **On-hand items.** Parts arriving from another factory or a train. The planner uses them instead of building
  them from scratch.
- **Recipe control.** Standard, alternate and converter recipes, grouped by product, each switchable. When an
  input can't be made with the enabled recipes it is flagged, with a one-click "add as on hand".
- **Progression aware.** On first launch you pick the highest milestone tier you have unlocked. Recipes,
  buildings, belts, pipes and miners above it are left out until you raise it.
- **Two objectives.** _Fewer resources_ (raw use weighted by how scarce each ore is in the world) or _less power_.
- **Resource limits.** A per-minute cap for each raw resource; empty means the whole world's supply.
- **Pinned inputs.** Click the rate on an ore node in the graph and type what you actually have; every target
  scales, keeping its ratio, to whatever that input can feed.
- **Clock speed and somersloops.** Click a machine to set them, like the in-game panel. Power follows the game
  formula (base × amplification² × clock^exponent). Overclocked lines keep machines at 100% and push only as many
  as needed past it, so they use the fewest power shards.
- **Auto place.** Enter how many somersloops and power shards you own; they go where they save the most.
- **Extraction.** Choose the miner, node purity and extractor clock to get miner and pump counts per purity,
  plus their power.
- **Two views.** A factory graph (belts colour-coded by tier, parallel lanes when one belt can't carry the flow,
  hover a machine to follow its line) and a table with the total build cost of every machine and extractor.

## Getting started

Needs [Bun](https://bun.sh). Rust is only needed for the desktop build.

```sh
bun install
bun run dev            # web version at http://localhost:1420
bun test               # solver and graph tests
bun run build          # type check + production bundle in dist/
bun run tauri dev      # desktop app (needs Rust + the Tauri prerequisites)
bun run tauri build    # Windows installer in src-tauri/target/release/bundle/nsis
```

## How the solver works

`src/lib/solver.ts` builds an LP in CPLEX text format and hands it to HiGHS.

- **Variables:** one per enabled recipe (machines running at that recipe's configured clock and somersloops),
  one per raw resource used, and one "missing" variable for every item no enabled recipe can make.
- **Constraints:** for every item, net production ≥ demand − on-hand supply. Raw resources are bounded by the
  player's cap, or by the world limit when there is no cap.
- **Objective:** _fewer resources_ minimises raw use weighted by scarcity (iron's world limit ÷ the resource's
  limit), with a tiny machine-power term so it never builds machines it doesn't need. _Less power_ minimises
  machine power, with the resource weights as a small tie-breaker. Missing items cost 10⁵ each, so they only
  appear when nothing else works.
- **Pinned inputs** solve in two phases: first maximise a scale factor _k_ on all targets with the pinned
  resources as hard limits, then solve the normal objective at that _k_.
- **Shadow prices** of the item rows give the marginal raw cost of each item; auto place uses them to send
  somersloops to the machines whose inputs are most expensive.

After solving, fractional machine counts are rounded up to buildings that can actually be placed, with per-machine
clocks. `src/lib/graph.ts` then matches each item's producers to its consumers greedily (largest first, which keeps
the belt count low) and lays the graph out left to right with dagre.

## Project layout

| Path                    | What                                                     |
| ----------------------- | -------------------------------------------------------- |
| `src/lib/solver.ts`     | LP model, solve, somersloop/shard auto placement         |
| `src/lib/graph.ts`      | solution → nodes and belts, layout                       |
| `src/lib/extraction.ts` | miner and pump counts per node purity                    |
| `src/lib/data.ts`       | typed access to the game data, belt/pipe choice per flow |
| `src/lib/i18n.ts`       | English and Turkish UI strings                           |
| `src/store.ts`          | app state (zustand), saved to `localStorage`             |
| `src/components/`       | panels, graph view, table view, inspector                |
| `src-tauri/`            | desktop shell                                            |
| `scripts/extract.mjs`   | game data extractor                                      |
| `tools/icon-extractor/` | .NET icon extractor                                      |
| `tests/`                | solver, extraction, auto placement and graph tests       |

Saved state is versioned. After a game data refresh, recipes and items that no longer exist are dropped from
saved factories on load.

## Game data in this repo

| File                          | What                                         | Made by           |
| ----------------------------- | -------------------------------------------- | ----------------- |
| `src/data/gamedata.json`      | items, recipes, buildings, belts, extractors | `bun run extract` |
| `src/data/meta.json`          | which game build the data came from          | `bun run extract` |
| `src/data/icon-manifest.json` | icon texture path per item/building          | `bun run extract` |
| `public/icons/*.webp`         | item and building icons                      | `bun run icons`   |

Last extract: **Satisfactory 1.2.4.0**, build 502094, Unreal Engine 5.6.1, on 2026-09-24 (see `src/data/meta.json`).

## Refreshing data after a game update (needs the game installed)

```sh
bun run extract                                            # Epic install on C: by default
bun run extract "D:/SteamLibrary/steamapps/common/Satisfactory"
bun run icons                                              # needs the .NET 10 SDK
dotnet run --project tools/icon-extractor -- "D:/SteamLibrary/steamapps/common/Satisfactory"
```

The extractor also reads the install path from the `SATISFACTORY_DIR` environment variable. `bun run icons` points
at the default Epic install; for any other location run the `dotnet` line from the repo root.

Commit the changed files under `src/data` and `public/icons` afterwards.

- `scripts/extract.mjs` reads `CommunityResources/Docs/*.json` (UTF-16) plus the build `.version` file. English
  names come from `en-US.json`, Turkish names from `tr.json`. Seasonal (FICSMAS) recipes are skipped.
- `tools/icon-extractor` reads the IoStore archives (`.utoc/.ucas`) with CUE4Parse and writes WebP.
  The game's `FactoryGame.usmap` writes `OptionalProperty` without an inner type, which CUE4Parse expects,
  so `UsmapPatch.cs` inserts a placeholder before loading it. The engine version is set in `Program.cs`
  (`EGame.GAME_UE5_6`); bump it if a game update moves to a newer Unreal version.

## Notes

- World resource limits (used to weigh scarce ores) come from SatisfactoryTools' 1.0 numbers.
- Somersloop slot counts come from the game data, not the wiki (the current build gives Smelters 0 slots).
- Icons are Coffee Stain Studios' art, extracted from a local install for this fan tool.
