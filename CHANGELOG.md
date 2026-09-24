# Changelog

All notable changes to FICSIT Planner. Dates are when the version was finished.

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
