/**
 * What changed, a few plain lines per version, newest first. Shown under Settings › Updates; the full
 * story of each version is in CHANGELOG.md.
 */
export type UpdateKind = 'added' | 'fixed' | 'changed';

export const UPDATES: { version: string; date: string; notes: [UpdateKind, string][] }[] = [
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
