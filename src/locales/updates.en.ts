/**
 * What changed, newest first, as players saw it: one entry per version that went live. Shown under Settings ›
 * Updates; the full story of every version, previews included, is in CHANGELOG.md. A version may name what it's
 * mostly about. Credits end a note as "Thanks to …".
 */
export type UpdateKind = 'added' | 'fixed' | 'changed';

export type UpdateNote = [UpdateKind, string];

export const UPDATES: { version: string; date: string; title?: string; notes: UpdateNote[] }[] = [
  {
    version: '0.13.24',
    date: '2026-10-08',
    notes: [
      [
        'changed',
        'A belt that has to carry more than one belt’s worth is drawn as that many belts side by side, up to six, with “3 × Mk.5” on its label.',
      ],
      ['changed', 'A “From the pool” card names the factories and plants that leave the item over.'],
      ['changed', 'Codex search groups its results under Parts, Resources, Buildings and the other headings.'],
      ['fixed', 'On the Auto floor a belt’s label no longer sits on a card’s header or on another label when there is room to move it.'],
    ],
  },
  {
    version: '0.13.23',
    date: '2026-10-08',
    notes: [
      ['fixed', 'Settings › Layout: the Left and Right pictures no longer spill out of their frame on a narrow window.'],
      [
        'fixed',
        'In a narrow side panel the sizing switch and the generator name stay inside their boxes, and the recipe kinds drop to a second row.',
      ],
      [
        'changed',
        'Searching for a part also names the ones above your tier that match, closest tier first, even when something already matched.',
      ],
    ],
  },
  {
    version: '0.13.22',
    date: '2026-10-08',
    notes: [
      [
        'added',
        'FICSIT Planner now lives at ficsitplanner.app. On the old address, Move my plans takes your factories, power plants and settings along.',
      ],
    ],
  },
  {
    version: '0.13.20',
    date: '2026-10-08',
    notes: [
      [
        'added',
        'Settings › Factory floor › Splitters and mergers draws them on the Auto floor where a belt feeds or is fed by several machines.',
      ],
      [
        'added',
        'A machine’s panel says how to share a belt between its machines: a tree of splitters, or a manifold with a loop back. Thanks to u/Worth-Computer8639.',
      ],
    ],
  },
  {
    version: '0.13.19',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'Resources: Plan with my nodes limits each resource to what the nodes you set give, and Optimize › Custom lets you set what each resource costs the plan. Thanks to u/terrifiedTechnophile and u/a__gun.',
      ],
    ],
  },
  {
    version: '0.13.18',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'Separate lines: switch Own line on a product to plan it apart from the others, each with its own machines and its own heading on the floor.',
      ],
    ],
  },
  {
    version: '0.13.17',
    date: '2026-10-07',
    notes: [['added', 'Power plants sized to what you have can take fuel from the pool, and what a plant leaves over goes into it.']],
  },
  {
    version: '0.13.16',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'A shared pool: what factories and power plants leave over can be taken by any factory (Already on hand › Take from the pool). It says how much the pool has, and goes red when it is short.',
      ],
    ],
  },
  {
    version: '0.13.15',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'An All tab: every factory and power plant on one page, with the power used against what the plants make and everything left over added up.',
      ],
      ['fixed', 'A hand-built factory now counts for what its floor works out to when the power planner adds up the load.'],
    ],
  },
  {
    version: '0.13.14',
    date: '2026-10-07',
    notes: [['changed', 'Codex on a phone: the categories sit two to a row.']],
  },
  {
    version: '0.13.13',
    date: '2026-10-06',
    notes: [
      ['fixed', 'Liquids and gases have their own colour on pipes and tags, as in the game; 12 of 15 were all the same blue before.'],
      ['added', 'Codex: a fluid page shows its pipe colour and a button that copies the hex code.'],
    ],
  },
  {
    version: '0.13.12',
    date: '2026-10-06',
    notes: [
      [
        'fixed',
        'Manual floor: a machine that takes back what it gives off (Encased Uranium Cell, nuclear fuel rods) now comes across with its own belt round and runs at full speed.',
      ],
      ['fixed', 'Manual floor: big factories like Turbo Motors at 12 a minute no longer stop with "model calc: Infeasible".'],
    ],
  },
  {
    version: '0.13.11',
    date: '2026-10-06',
    notes: [
      [
        'added',
        'Settings › Factory floor › Belt shape: Square gives the Auto floor straight belts with square turns, like the Manual floor.',
      ],
    ],
  },
  {
    version: '0.13.10',
    date: '2026-10-06',
    notes: [
      [
        'added',
        'Auto floor: double-click a machine to tick it built in the game. The tick comes along when you turn the factory into a Manual floor.',
      ],
      ['changed', 'Machines on the Manual floor have the same cut corner as on the Auto floor.'],
    ],
  },
  {
    version: '0.13.9',
    date: '2026-10-06',
    notes: [
      ['changed', 'Belts show arrowheads running the way the belt moves, instead of straight lines.'],
      ['added', 'Power plants: Fill to 100% turns the generators into whole ones at 100%.'],
      ['added', 'Left-over products show the AWESOME Sink points a minute they would score.'],
      ['fixed', 'Searching for something above your tier says when it opens up, not just “No matches”.'],
      ['fixed', 'Power plants: “Fix the count” no longer asks for more fuel than you listed.'],
      ['fixed', 'The Surplus card no longer drops to a line of its own with a gap beside it.'],
    ],
  },
  {
    version: '0.13.8',
    date: '2026-10-05',
    notes: [['fixed', 'Manual floor: a card moved or removed while Tidy up is working stays as you left it. Thanks to dberlin.']],
  },
  {
    version: '0.13.7',
    date: '2026-10-03',
    notes: [
      ['changed', 'Auto and Manual share their targets: change a product on one and the other follows.'],
      ['added', 'Right-click a card to duplicate, copy, paste, mark built or remove it; Ctrl+C, Ctrl+V and Ctrl+D work too.'],
      ['added', 'Double-click a belt to remove it.'],
      ['changed', 'Outputs and inputs open no panel; the × on the card removes them.'],
      ['changed', 'The build menu has four tabs, and Resources lists only what your tier can use.'],
      ['fixed', 'With a card’s panel open, the buttons along the bottom no longer run into each other.'],
    ],
  },
  {
    version: '0.13.6',
    date: '2026-10-03',
    title: 'Manual floor',
    notes: [
      [
        'added',
        'Switch any factory to Manual to place machines, draw belts and set counts yourself. It starts from the solved factory, already laid out.',
      ],
      [
        'added',
        'Add a machine with a right click, by dropping a belt on empty floor, or by holding a finger on a touch screen. The build menu offers only what fits that belt.',
      ],
      ['added', 'Lay a floor out left to right or top to bottom, tidy it up in one click, rebuild it for new targets, undo and redo.'],
      [
        'added',
        'Machines size themselves to what comes in, and each belt takes the slowest Mk that carries its load, so a new target reshapes the whole line.',
      ],
      ['added', 'Cards say when their recipe is off, needs a higher tier, or mines past a limit. Double-click a card to mark it built.'],
      ['added', 'Fill to 100%: 7 × 95% becomes 6 × 100% + 1 × 65% for the same output. Even out turns it back.'],
      ['added', 'A Special tab in the build menu for ammo, equipment and Power Shards.'],
      ['changed', 'What your tier can’t make is hidden everywhere; Settings › Interface brings it back. Thanks to u/Suspicious_Fly_1838.'],
      ['changed', 'Recipes turned off stay out of every machine panel.'],
      ['changed', 'Tooltips in the planner’s own style, with keyboard shortcuts.'],
      ['fixed', 'Closing Settings could crash the planner in the newest Chrome.'],
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
