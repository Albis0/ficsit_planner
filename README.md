# FICSIT Planlayıcı

Satisfactory production planner. React + Vite, HiGHS LP solver (WebAssembly), packaged as a Tauri desktop app.
Runs fully offline; all game data and icons are committed, so a checkout works without the game installed.

## Game data in this repo

| File | What | Made by |
| --- | --- | --- |
| `src/data/gamedata.json` | items, recipes, buildings, belts, extractors | `bun run extract` |
| `src/data/meta.json` | which game build the data came from | `bun run extract` |
| `src/data/icon-manifest.json` | icon texture path per item/building | `bun run extract` |
| `public/icons/*.webp` | item and building icons | `bun run icons` |

Last extract: **Satisfactory 1.2.4.0**, build 502094, Unreal Engine 5.6.1, on 2026-09-24 (see `src/data/meta.json`).

## Working without the game (laptop)

Needs [Bun](https://bun.sh). Rust is only needed for the desktop build.

```sh
bun install
bun run dev            # web version at http://localhost:1420
bun test               # solver and graph tests
bun run tauri dev      # desktop app (needs Rust + the Tauri prerequisites)
bun run tauri build    # Windows installer in src-tauri/target/release/bundle/nsis
```

The committed data is used as-is; nothing reads the game at runtime.

## Refreshing data after a game update (needs the game installed)

```sh
bun run extract                                            # Epic install on C: by default
bun run extract "D:/SteamLibrary/steamapps/common/Satisfactory"
bun run icons                                              # needs the .NET 10 SDK
dotnet run --project tools/icon-extractor -- "D:/SteamLibrary/steamapps/common/Satisfactory"
```

Commit the changed files under `src/data` and `public/icons` afterwards.

- `scripts/extract.mjs` reads `CommunityResources/Docs/*.json` (UTF-16) plus the build `.version` file.
- `tools/icon-extractor` reads the IoStore archives (`.utoc/.ucas`) with CUE4Parse and writes WebP.
  The game's `FactoryGame.usmap` writes `OptionalProperty` without an inner type, which CUE4Parse expects,
  so `UsmapPatch.cs` inserts a placeholder before loading it. The engine version is set in `Program.cs`
  (`EGame.GAME_UE5_6`); bump it if a game update moves to a newer Unreal version.

## Notes

- World resource limits (used to weigh scarce ores) come from SatisfactoryTools' 1.0 numbers.
- Somersloop slot counts come from the game data, not the wiki (the current build gives Smelters 0 slots).
- Icons are Coffee Stain Studios' art, extracted from a local install for this fan tool.
