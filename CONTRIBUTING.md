# Contributing

Thanks for helping with FICSIT Planner. This page covers setup, how the code is laid out, and what has to pass
before a change goes in.

## Setup

You need [Bun](https://bun.sh). The game is not needed unless you are refreshing game data.

```sh
bun install
bun run dev        # http://localhost:1420
```

## Before you open a pull request

```sh
bun run check      # Biome: lint + formatting (bun run format fixes most of it)
bun test           # solver, graph, saved state and string tests
bun run build      # type check + production build
```

CI runs the same three on every push, and a pull request needs all of them green.

For UI changes, also try the change at phone width in the browser's device mode, and with `bun run preview`,
which serves the built app with its service worker, the way users get it.

## Code style

- Biome formats the code. Don't hand-format against it.
- Match the surrounding code: short names, small functions, and comments only where the reason isn't obvious.
- Every UI string goes in `src/locales/en.ts` and is used through `t('key')`. A test fails if a key is missing or
  unused.
- Solver failures are `SolverError` codes, not text. The UI turns them into words (`src/lib/solveFailure.ts`).
- The solver (`src/lib/solver.ts`) stays free of React and browser APIs. It runs in a Web Worker in the app and
  directly in the tests.
- Layout for small screens lives in the "Tablet and phone" section at the end of `src/styles.css`. The phone
  breakpoint (900px) matches `PHONE` in `src/lib/useMediaQuery.ts`.

## Tests

Tests live in `tests/` and run with `bun test`. Add one when you change what the solver produces, how the graph is
built, or how saved state is loaded. Solver tests check against numbers you can confirm in the game, for example
"60 iron plates need 3 smelters and 3 constructors".

## Game data

`src/data/` and `public/icons/` are generated from a Satisfactory install. Don't edit them by hand. To refresh
them, see "Refreshing data after a game update" in the [README](README.md).

## Commit messages

Start with a short summary in the imperative ("Run the solver in a Web Worker"). If the change needs it, follow
with a blank line and a few bullet points on what changed and why.

## License

By contributing, you agree that your contribution is licensed under the
[GNU General Public License v3.0 or later](LICENSE), the same as the rest of the project.
