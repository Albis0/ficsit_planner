# FICSIT Planlayıcı

Offline Satisfactory production planner. Tauri + React, HiGHS LP solver, game data and icons read straight from your install.

```sh
bun install
bun run extract        # recipes/items from CommunityResources/Docs -> src/data/gamedata.json
bun run icons          # item/building icons from the .utoc/.ucas archives -> public/icons (needs .NET SDK)
bun run tauri dev      # desktop app with hot reload
bun run tauri build    # installer in src-tauri/target/release/bundle/nsis
bun test               # solver tests
```

Both extract steps default to the Epic install on `C:`. Pass another path for Steam:

```sh
bun run extract "D:/SteamLibrary/steamapps/common/Satisfactory"
dotnet run --project tools/icon-extractor -- "D:/SteamLibrary/steamapps/common/Satisfactory"
```

## Notes

- World resource limits (used to weigh scarce ores) come from SatisfactoryTools' 1.0 numbers.
- Somersloop slot counts come from the game data, not the wiki (the current build gives Smelters 0 slots).
- The game ships `FactoryGame.usmap` with `OptionalProperty` entries that have no inner type; CUE4Parse expects one,
  so `tools/icon-extractor/UsmapPatch.cs` inserts a placeholder before loading it.
