/**
 * What changed, a few plain lines per version, newest first. Shown under Settings › Updates; the full
 * story of each version is in CHANGELOG.md.
 */
export type UpdateKind = 'added' | 'fixed' | 'changed';

export const UPDATES: { version: string; date: string; notes: [UpdateKind, string][] }[] = [
  {
    version: '0.13.3',
    date: '2026-10-03',
    notes: [
      ['fixed', 'Manual floor: the build menu lists only the recipes turned on in Recipes.'],
      ['changed', 'Manual floor: a new miner comes with the miner, purity and clock picked in Resources.'],
      [
        'changed',
        'Manual floor: a card says when its recipe is off in Recipes, when it needs a higher tier, or when miners take more than the limit in Resources.',
      ],
    ],
  },
  {
    version: '0.13.2',
    date: '2026-10-03',
    notes: [
      [
        'changed',
        'What your tier can’t make is now hidden everywhere on the factory and power sides: products, recipes, miners, belts, plants. Settings › Interface › Show what your tier can’t make brings it back. Thanks to u/Suspicious_Fly_1838.',
      ],
      [
        'changed',
        'Manual floor: a machine you put down takes as many machines as what comes in keeps busy (Auto), so a miner → smelter → constructor line runs straight away. Type a count to set it yourself.',
      ],
      ['changed', 'Manual floor: an open output counts as left over and shows what comes out of it, instead of stopping the line.'],
      ['changed', 'Manual floor: the side panel lists the floor’s own outputs and inputs, and Rebuild starts from them.'],
      ['changed', 'Manual floor: cards, their ends and belts sit on the grid; Tidy up bends belts less.'],
      ['added', 'A miner’s panel takes what it makes a minute.'],
      ['changed', 'Built in the game is a box to tick; Fill to 100% always shows in a machine’s panel; Build by hand is a button.'],
    ],
  },
  {
    version: '0.13.1',
    date: '2026-10-03',
    notes: [
      [
        'added',
        'Settings › Interface › Hide what your tier can’t make: products, buildings and generators above your tier leave the lists. Thanks to u/Suspicious_Fly_1838.',
      ],
      ['added', 'Fill to 100% on a machine: 7 × 95% becomes 6 × 100% + 1 × 65%, same output. Even out goes back.'],
      ['added', 'Settings › Factory floor: add parts with a right click or a double click.'],
      [
        'changed',
        'Manual floor belts run straight with square turns, cards ordered so belts don’t cross, each label on its own belt; a new layout shows the whole floor.',
      ],
      ['fixed', 'Closing Settings could crash the planner in the newest Chrome.'],
    ],
  },
  {
    version: '0.13.0',
    date: '2026-10-02',
    notes: [
      [
        'added',
        'Manual floor: switch a factory to Manual to move machines, lay belts and set counts by hand, starting from the factory as worked out, laid out cleanly.',
      ],
      [
        'added',
        'Right-click the floor, press + Add, or let go of a belt on the floor to add a machine; a belt lists only what fits it and comes in already joined.',
      ],
      ['added', 'Build by hand from an empty floor, Tidy up, and a button that goes to each card still missing a belt.'],
    ],
  },
  {
    version: '0.12.9',
    date: '2026-10-02',
    notes: [['changed', 'The hint under the factory floor is shorter and steps aside when the window is narrow.']],
  },
  {
    version: '0.12.8',
    date: '2026-10-02',
    notes: [
      [
        'added',
        'A line feeding more than one place is built as a card per place, each at its own clock: no splitter ratios, no power shards. Settings › Factory floor can keep it as one card.',
      ],
      ['fixed', 'A target with many decimals no longer makes the plan count power shards it doesn’t need.'],
      ['fixed', 'Long numbers in amount fields shrink to fit before they scroll.'],
    ],
  },
  {
    version: '0.12.7',
    date: '2026-10-02',
    notes: [
      [
        'added',
        'Transport view: how each input and output travels, by belt, train, truck, tractor, explorer, fluid truck or drone, and what that takes. Thanks to u/TheUnitFoxhound6.',
      ],
      ['added', 'Codex › Transport: the same calculator for any item, and what each vehicle holds.'],
    ],
  },
  {
    version: '0.12.6',
    date: '2026-10-02',
    notes: [
      [
        'changed',
        'Fewest buildings counts miners and pumps too, and mines about as few kinds of resource as By rarity. Thanks to u/a__gun.',
      ],
      ['fixed', 'Pinned inputs scale your plan instead of swapping what you pinned for a resource you didn’t.'],
    ],
  },
  {
    version: '0.12.5',
    date: '2026-10-02',
    notes: [['fixed', 'Reload on "A new version is ready" works after a hard refresh too.']],
  },
  {
    version: '0.12.4',
    date: '2026-10-01',
    notes: [
      [
        'added',
        'Settings › Game settings: part cost, power use and Space Elevator multipliers, for saves started with them. Thanks to u/pdavis41, u/TheThiefMaster and u/PhiladelphiaCollins8.',
      ],
      ['added', 'Select a machine to tick or untick the other recipes for what it makes. Thanks to u/Aeri73.'],
      ['added', 'Resources: Fewest buildings (beta), a third way to optimize. Thanks to u/a__gun.'],
      ['fixed', 'A line whose belts or pipes would overflow says how to build it in groups, like 6 + 4 blenders.'],
      ['added', 'Resources: enter the nodes you have, like one pure and one impure, and extractors use the best first.'],
      ['added', 'Click a belt’s label to see which machines it joins.'],
      ['added', 'List view: point at a line to see where its inputs come from and where its outputs go.'],
      [
        'fixed',
        'Recipes: the list scrolls down instead of sideways, and cards no longer split between columns. Thanks to u/Aeri73 and kozmo403.',
      ],
      ['changed', 'Belts turn through rounded corners and fan out smoothly from a machine.'],
      ['changed', 'A new version waits for you to press Reload instead of loading on its own.'],
      ['changed', 'Feedback: the Send button says what\u2019s still missing.'],
    ],
  },
  {
    version: '0.12.2',
    date: '2026-10-01',
    notes: [
      [
        'fixed',
        'Recipes above your tier are hidden and can’t be ticked. Alternates also wait for the tier that makes their parts. Thanks to u/Aeri73.',
      ],
      ['added', 'A pinned input says which ticked alternates it keeps out of the plan. Thanks to u/TheUnitFoxhound6.'],
      ['added', 'Resources: a cost switch, By rarity or All equal, for mods that let you build nodes anywhere. Thanks to u/a__gun.'],
      ['added', 'The totals over the factory fold away to one line, and the panels fold smoothly.'],
      ['changed', 'The recipe search sits at the top of the Recipes tab. Thanks to u/Aeri73.'],
      ['fixed', 'Big factories: Fit to screen shows all of it, and the raw inputs no longer stack in one tall column.'],
    ],
  },
  {
    version: '0.12.1',
    date: '2026-09-30',
    notes: [
      ['fixed', 'Codex: Fabric’s alternates no longer show a broken percentage.'],
      ['fixed', 'Codex links and tier labels are easier to tap on a phone.'],
    ],
  },
  {
    version: '0.12.0',
    date: '2026-09-30',
    notes: [
      ['added', 'The Codex works out a whole production line for every part and compares every recipe for it.'],
      ['added', 'New guides: getting started, the Space Elevator, power, oil and nuclear.'],
      ['fixed', 'Plans whose only recipes loop back on themselves say what to bring in instead of failing.'],
    ],
  },
];

export const LATEST_UPDATE = UPDATES[0].version;
