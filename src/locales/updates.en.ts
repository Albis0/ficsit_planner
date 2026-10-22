/**
 * What changed, newest first, as players saw it: one entry per version that went live. Shown under Settings ›
 * Updates, grouped by 0.13 and 0.12; the full story of every version, previews included, is in CHANGELOG.md. A note
 * reads like a patch note: where, then what changed. A version may name what it's mostly about. Credits end a note as
 * "Thanks to …".
 */
export type UpdateKind = 'added' | 'fixed' | 'changed';

export type UpdateNote = [UpdateKind, string];

/** `ask` puts a question with a rating and a note under the version in Settings › Updates. */
export const UPDATES: { version: string; date: string; title?: string; notes: UpdateNote[]; ask?: string }[] = [
  {
    version: '0.14.1',
    date: '2026-10-22',
    notes: [
      ['added', 'Manual floor: the colour wheel takes a typed hex code too.'],
      ['added', 'Settings › Game save: “Refresh takes” says whether Refresh reads the latest save of yours or the latest autosave.'],
      ['changed', 'Tier window: a new look. The phases sit in one strip, the tiers on a line that runs orange up to the one you chose, and what the tier opens and its milestones are in one panel below.'],
      ['changed', 'Big factories freeze much less when you change a number or click a card. On a 3,200-machine factory, with the processor slowed down to test, the longest freeze went from about 2.8 s to 0.6 s. Opening Settings or Report no longer redraws the whole app, and in the power planner it no longer builds the floor again.'],
      ['changed', 'While a window such as Settings is open, the belts behind it stand still.'],
      ['changed', 'Auto backups no longer load every saved copy a minute after you open the app or when you leave the page; they only look at the copies’ times until one is due.'],
      ['fixed', 'Auto floor: the belts no longer jump by a pixel every time the animation loops.'],
    ],
  },
  {
    version: '0.14.0',
    date: '2026-10-22',
    title: 'Game save',
    notes: [
      [
        'added',
        'Import save: read your Satisfactory save and bring your game into the planner. The button is in the top bar (on a phone, “Game save” in the ⋯ menu). The window copies the save folder’s path for you and shows the steps for Windows, macOS (CrossOver), Linux (Steam Proton) and phones. Choose the folder, one .sav file, or drop it on the window. Pick the game and its newest save is chosen for you, by the date inside the save. Nothing leaves your computer: the save stays in this browser, is left out of backup files and share links, and Delete everything removes it. Thanks to Hot-Category2986 and BouBouRziPorC.',
      ],
      [
        'added',
        'Import save: the first time, you say what the save may set. Tier and the milestones you skipped, your alternate recipes (turned on in every factory), and your Somersloops and power shards, free and in machines. The result lists what came in and what did not, with the reason (FICSMAS recipes, alternates this version does not know).',
      ],
      [
        'added',
        'Settings › Game save: the save you follow, Refresh from the game, Change, Forget, and a switch for each thing the save may set. Refresh asks, line by line, about anything you changed yourself since the last import: yours or the game’s.',
      ],
      [
        'added',
        'Map: a “Your save” card with how many Somersloops, Mercer Spheres, slugs and hard drives you picked up, of how many there are. Picked up: Grey, Hide or Normal, and Details lists each find. Nodes with a miner get a ring as far round as the miner’s clock, and clicking one says “Miner Mk.2 · 150%”.',
      ],
      [
        'added',
        'Map: the factories in your save are boxed with a dashed line and named after what they make; click one for its buildings. They are a guess from how far buildings stand apart and how long the belts between them run, so a big factory may show as two, or two close ones as one. The HUB, Space Elevator, MAM, AWESOME Shop and Radar Towers are marked too.',
      ],
      [
        'added',
        'All › From your save: a card for each power circuit with generators, with what it makes and draws, its generators and batteries. “Make a power plant tab” opens a plant tab with the same generators, fuel and clock speeds.',
      ],
      [
        'changed',
        'All › Unlocked recipes: the standard recipes can be turned off now, not just the alternates. New factories start with that list, and backup files carry it.',
      ],
      [
        'changed',
        'Manual floor, on a tablet or phone: a card’s name button is easier to tap. Settings: the titles of folded sections wrap instead of being cut short.',
      ],
      ['fixed', 'Manual floor: Escape closes the menu you get by right-clicking a card.'],
    ],
  },
  {
    version: '0.13.36',
    date: '2026-10-16',
    notes: [
      [
        'added',
        'Tier window: tick off the milestones you have not bought. The ones of the chosen tier are in view, earlier tiers are folded away. What a skipped milestone opens (belts, buildings, miners, plants, vehicles, recipes) stays locked on both floors, locked tags name the milestone, and a missing part offers “Mark as bought”. The top bar says “Tier 5 · 1 off”. Thanks to clem.',
      ],
      [
        'added',
        'Backups: the backup file also carries your tier, the milestones you have not bought and your unlocked alternates. Loading a file or restoring a copy offers to use that progress and changes nothing unless you press it. Share links do not carry it.',
      ],
      [
        'added',
        'Auto backups: the app quietly keeps the last three copies of your factories, a new one every 6 hours. Settings › Your data lists them with a Restore button, and Delete everything clears them too.',
      ],
      [
        'added',
        'Auto floor: draw, name, colour, move and resize areas behind the cards, the way the Manual floor does. Hold the right button and drag.',
      ],
      [
        'added',
        'Manual floor: hold the right button and drag to draw a coloured area with a name, a note, an icon and any colour. It moves with the cards inside it, resizes from its corners and copies with them. Settings has an Area names choice.',
      ],
      ['added', 'Manual floor: an output card has a “To the pool” button.'],
      ['added', 'Manual floor: copied cards go to the real clipboard, so they paste in another tab, after a reload and in another window.'],
      [
        'added',
        'Factory tab menu: “Copy factory” copies a link to the factory. Pasting it into the app, anywhere outside a field, opens it as a new tab, even a very long one. It replaces the Share button.',
      ],
      ['added', 'All › Unlocked recipes: a Standard filter lists the standard recipes, shown on.'],
      ['changed', 'Floor: Factory, List and Transport are one dropdown instead of three buttons.'],
      [
        'changed',
        'Machine panel: its title stays at the top while the rest scrolls, and on a small floor it grows up to the top bar instead of ending short. On the Manual floor the direction arrows and Fit to screen step aside while it is open.',
      ],
      [
        'fixed',
        'The same factory shows the same power and machine count in the totals strip, the factory menu and the All page. Numbers from 1000 up have no decimals.',
      ],
      ['fixed', 'Manual floor: an item that comes in more than once (Uranium Waste) is one row and one card with a round amount.'],
      ['fixed', 'Lists: the bottom buttons no longer cover the last rows of List and Transport.'],
      ['fixed', 'The Map no longer logs an error when you leave it while zooming.'],
      [
        'changed',
        'Delete everything also clears the automatic backups, your answers to the app’s questions and the Codex pages you looked at last.',
      ],
    ],
  },
  {
    version: '0.13.35',
    date: '2026-10-11',
    notes: [
      [
        'added',
        'All: a new page, Unlocked recipes, where you mark the alternate and converter recipes you have unlocked in the game. Every new factory starts with them on, and you can still turn any of them off for one factory in its own Recipes tab. Thanks to claymann.',
      ],
      [
        'added',
        'All › Unlocked recipes: a button turns the marked recipes on in the factories you already have. It only turns recipes on and never off.',
      ],
    ],
  },
  {
    version: '0.13.34',
    date: '2026-10-11',
    notes: [
      [
        'fixed',
        'Floor: a big factory pans and zooms more smoothly on a slow computer. Belts keep their chevrons and a strip that moves along them, drawn with far fewer pieces, and a factory of more than 60 cards draws only what is on screen.',
      ],
      [
        'fixed',
        'Floor: changing a number in a big factory freezes it much less. The layout is reused while the machines and belts stay the same, and dragging the panel edge is smoother.',
      ],
      [
        'fixed',
        'Saving: a browser with no room left no longer breaks changes halfway. The plans are written a moment after the last change, and at once when you leave the page. If the browser still refuses, a note says so and offers a backup download.',
      ],
      [
        'fixed',
        'A solver that gets stuck no longer leaves the app waiting: after half a minute the request is given up and the next change starts a fresh solver.',
      ],
      ['changed', 'The Codex loads when you first open it, so the app starts with about 75 kB less.'],
      [
        'fixed',
        'Floor: moving the pointer across a very big factory is much smoother. Only the cards and belts that light up or fade are redrawn.',
      ],
    ],
  },
  {
    version: '0.13.33',
    date: '2026-10-09',
    ask: 'How do the pipe junctions and the Sink option work for you?',
    notes: [
      [
        'added',
        'Settings › Updates can ask what you think of a version, and a part of the app can ask a couple of minutes after you first try it. Later, Close and “Don’t ask again” are on every question, and Settings › Interface has a switch for them.',
      ],
      [
        'changed',
        'A liquid leftover can be sunk: its menu starts with "Sink it as Packaged …", which adds a Packager, tells you how many Empty Canisters a minute it needs and what the packed parts score in the AWESOME Sink.',
      ],
      [
        'changed',
        'Auto floor: the pipes of a line drawn as a card for each place it goes are matched once, so a pipe network has far fewer junctions and no crossings.',
      ],
    ],
  },
  {
    version: '0.13.32',
    date: '2026-10-09',
    notes: [
      [
        'changed',
        'The All page has a Pool table: for each item, who gives it, who takes it and what is left (green, or red when it is short). An AWESOME Sink row and tile show the sink points a minute for what is left.',
      ],
    ],
  },
  {
    version: '0.13.31',
    date: '2026-10-09',
    notes: [
      [
        'changed',
        'Settings: the preview under Factory floor and Colours is a small real floor now, with cards, belts, labels and a splitter drawn like the real thing. It follows every setting as you change it.',
      ],
      [
        'added',
        'Settings: point at a setting (tap it on a phone) and a thin orange ring shows in the preview what it changes. The preview shows on narrow windows and phones too.',
      ],
      [
        'added',
        'Settings: point at “Lines feeding several places” and the preview shows one line going to two places, as a card each or as one card.',
      ],
    ],
  },
  {
    version: '0.13.30',
    date: '2026-10-09',
    notes: [
      [
        'changed',
        'Factory floor: a belt that runs back to an earlier machine (the water that comes out of one refinery and goes into another one before it) goes round under the cards in a thick blue path instead of cutting back across them.',
      ],
      [
        'added',
        'Factory floor: that belt’s label says where it goes, like “Water 30/min back to Alumina Solution”, and a small ↺ stands where it climbs into its input.',
      ],
    ],
  },
  {
    version: '0.13.29',
    date: '2026-10-09',
    notes: [
      [
        'changed',
        'Top bar: the row of factory tabs is one button with the name on screen. It opens a list of every factory and power plant, with each one’s MW.',
      ],
      [
        'added',
        'Top bar: drag the grip beside a factory or plant in that list to put it in another place. The new factory and new power plant buttons are at the foot of the list.',
      ],
      [
        'changed',
        'Codex: the first page groups the categories under Items, Build and research and The world, as tall tiles with the count in the corner.',
      ],
      ['added', 'Top bar: right-click a factory or plant, on the bar or in the list, for Rename, Duplicate and Delete.'],
      ['changed', 'Codex search: AWESOME Shop entries say Buy instead of Unlock.'],
      [
        'changed',
        'Manual floor: the switch for outputs with no belt is called “Output with no belt”, with the choices “Counts as spare” and “Machine stops”.',
      ],
    ],
  },
  {
    version: '0.13.28',
    date: '2026-10-09',
    notes: [
      ['changed', 'Side panel, narrow: Targets, Recipes and Resources fit a 300 px panel and a phone with less scrolling.'],
      ['changed', 'Targets, narrow: Already on hand, Your inventory and Extraction fold to one line that says what is in them.'],
      ['fixed', 'Targets, narrow: a long name such as Packaged Rocket Fuel is no longer cut or squeezed into a column.'],
      ['fixed', 'Targets, narrow: Own line and Pool are the same size.'],
      [
        'changed',
        'Power, narrow: a generator’s count and what sizes it sit on the left, Fix the count and Fill to 100% stacked on the right. The remove button is a plain cross at the end of the title.',
      ],
    ],
  },
  {
    version: '0.13.27',
    date: '2026-10-09',
    notes: [
      [
        'changed',
        'The start page stays until the game data, the solver and your first floor are ready, and says which of them it is waiting for.',
      ],
    ],
  },
  {
    version: '0.13.26',
    date: '2026-10-08',
    notes: [
      ['added', 'Manual floor: final products. Place one from the build menu or end a belt in one, then build back from it.'],
      [
        'added',
        'Auto floor: leftover cards get “Make something from it”. Pick a recipe and its product is added, made from that leftover even when the line was a line of its own.',
      ],
      [
        'added',
        'Auto floor: “To the pool” on every product, so other factories and plants can take it. The output card has the button too.',
      ],
      ['added', 'Manual floor: “Take from the pool” and “Take from another factory” under Comes in, like on the Auto floor.'],
      ['changed', 'Manual floor: “Output with no belt” is a drawer; open the tab to pick Counts as spare or Machine stops.'],
      [
        'changed',
        'Auto floor: the strip for pinned inputs is one slim line, and “Make default” turns the scaled amounts into the targets.',
      ],
    ],
  },
  {
    version: '0.13.25',
    date: '2026-10-08',
    notes: [
      ['added', 'Auto floor and power planner: undo and redo, from the buttons in the corner or with Ctrl+Z and Ctrl+Y.'],
      [
        'changed',
        'Auto floor: splitters and mergers look like the Manual floor’s, show the amount passing through and have three outputs (three inputs for a merger), as in the game.',
      ],
      ['changed', 'Auto floor: cards you drag snap to the grid, like on the Manual floor.'],
      ['fixed', 'Auto floor: clicking one card of a line drawn as several cards centres that card, not the first one.'],
    ],
  },
  {
    version: '0.13.24',
    date: '2026-10-08',
    notes: [
      ['changed', 'Auto floor: a flow bigger than one belt is drawn as that many belts side by side, up to six, labelled like “3 × Mk.5”.'],
      [
        'changed',
        'Floors: belts side by side keep apart round a bend, and a card’s end is as wide as the belts that meet it, so they go in in parallel. They close up only at a splitter or merger.',
      ],
      [
        'fixed',
        'Manual floor: the build menu finds the splitter, merger and pipeline junction when you search for them (“split”, “pipe”).',
      ],
      ['changed', '“From the pool” cards name the factories and plants that leave the item over.'],
      ['changed', 'Codex search groups its results under Parts, Resources, Buildings and the other headings.'],
      ['fixed', 'Auto floor: belt labels stay off card headers and other labels when there is room to move them.'],
    ],
  },
  {
    version: '0.13.23',
    date: '2026-10-08',
    notes: [
      ['fixed', 'Settings › Layout: the Left and Right pictures stay inside their frame in a narrow window.'],
      ['changed', 'Settings › Layout: Panel position is not shown on a phone, where the panel always has its own screen.'],
      ['fixed', 'Narrow side panel: the sizing switch and generator name stay in their boxes, and the recipe kinds drop to a second row.'],
      ['changed', 'Search also names matching parts above your tier, closest tier first, even when something else matched.'],
    ],
  },
  {
    version: '0.13.22',
    date: '2026-10-08',
    notes: [
      [
        'added',
        'FICSIT Planner now lives at ficsitplanner.app. On the old address, Move my plans carries your factories, power plants and settings over.',
      ],
    ],
  },
  {
    version: '0.13.20',
    date: '2026-10-08',
    notes: [
      [
        'added',
        'Settings › Factory floor › Splitters and mergers: draws them on the Auto floor where a belt feeds or is fed by several machines.',
      ],
      [
        'added',
        'Machine panel: says how to share a belt between machines, a tree of splitters or a manifold with a loop back. Thanks to u/Worth-Computer8639.',
      ],
    ],
  },
  {
    version: '0.13.19',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'Resources: Plan with my nodes limits each resource to what your nodes give. Optimize › Custom sets what each resource costs the plan. Thanks to u/terrifiedTechnophile and u/a__gun.',
      ],
    ],
  },
  {
    version: '0.13.18',
    date: '2026-10-07',
    notes: [['added', 'Targets: Own line plans a product apart from the others, with its own machines and its own heading on the floor.']],
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
        'Shared pool: what factories and power plants leave over can be taken by any factory (Already on hand › Take from the pool). It shows how much the pool has and goes red when it is short.',
      ],
    ],
  },
  {
    version: '0.13.15',
    date: '2026-10-07',
    notes: [
      [
        'added',
        'All tab: every factory and power plant on one page, with the power used against the power made and every leftover added up.',
      ],
      ['fixed', 'Power planner: a hand-built factory counts for what its floor works out to.'],
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
      ['fixed', 'Pipes and tags: liquids and gases have their own colour, as in the game. 12 of 15 were the same blue before.'],
      ['added', 'Codex: a fluid page shows its pipe colour and a button that copies the hex code.'],
    ],
  },
  {
    version: '0.13.12',
    date: '2026-10-06',
    notes: [
      [
        'fixed',
        'Manual floor: machines that take back what they give off (Encased Uranium Cell, nuclear fuel rods) get their belt loop and run at full speed.',
      ],
      ['fixed', 'Manual floor: big factories such as 12/min Turbo Motors no longer stop with “model calc: Infeasible”.'],
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
      ['added', 'Auto floor: double-click a machine to tick it built. The tick comes along when the factory becomes a Manual floor.'],
      ['changed', 'Manual floor: machines have the same cut corner as on the Auto floor.'],
    ],
  },
  {
    version: '0.13.9',
    date: '2026-10-06',
    notes: [
      ['changed', 'Belts: arrowheads show the way they run, instead of straight lines.'],
      ['added', 'Power plants: Fill to 100% turns generators into whole ones at 100%.'],
      ['added', 'Leftover products show the AWESOME Sink points a minute they would score.'],
      ['fixed', 'Search: something above your tier says when it opens up, not just “No matches”.'],
      ['fixed', 'Power plants: “Fix the count” no longer asks for more fuel than you listed.'],
      ['fixed', 'Surplus card: no longer drops to a line of its own with a gap beside it.'],
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
      ['added', 'Right-click a card to duplicate, copy, paste, mark built or remove it. Ctrl+C, Ctrl+V and Ctrl+D work too.'],
      ['added', 'Double-click a belt to remove it.'],
      ['changed', 'Inputs and outputs open no panel; the × on the card removes them.'],
      ['changed', 'Build menu: four tabs. Resources lists only what your tier can use.'],
      ['fixed', 'Card panel: the buttons along the bottom no longer run into each other.'],
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
      ['added', 'Cards say when their recipe is off, needs a higher tier or mines past a limit. Double-click a card to mark it built.'],
      ['added', 'Fill to 100%: 7 × 95% becomes 6 × 100% + 1 × 65% for the same output. Even out turns it back.'],
      ['added', 'Build menu: a Special tab for ammo, equipment and Power Shards.'],
      ['changed', 'Everything your tier can’t make is hidden; Settings › Interface brings it back. Thanks to u/Suspicious_Fly_1838.'],
      ['changed', 'Recipes turned off stay out of every machine panel.'],
      ['changed', 'Tooltips in the planner’s own style, with keyboard shortcuts.'],
      ['fixed', 'Closing Settings could crash the planner in the newest Chrome.'],
    ],
  },
  {
    version: '0.12.9',
    date: '2026-10-02',
    notes: [['changed', 'Hint under the factory floor: shorter, and steps aside in a narrow window.']],
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
      ['fixed', 'Amount fields: long numbers shrink to fit before they scroll.'],
    ],
  },
  {
    version: '0.12.7',
    date: '2026-10-02',
    notes: [
      [
        'added',
        'Transport view: how each input and output travels (belt, train, truck, tractor, explorer, fluid truck, drone) and what that takes. Thanks to u/TheUnitFoxhound6.',
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
    notes: [['fixed', 'Reload on “A new version is ready” works after a hard refresh too.']],
  },
  {
    version: '0.12.4',
    date: '2026-10-01',
    notes: [
      [
        'added',
        'Settings › Game settings: part cost, power use and Space Elevator multipliers, for saves started with them. Thanks to u/pdavis41, u/TheThiefMaster and u/PhiladelphiaCollins8.',
      ],
      ['added', 'Machine panel: tick or untick the other recipes for what it makes. Thanks to u/Aeri73.'],
      ['added', 'Resources: Fewest buildings (beta), a third way to optimize. Thanks to u/a__gun.'],
      ['added', 'Resources: enter the nodes you have, like one pure and one impure, and extractors use the best first.'],
      ['added', 'Click a belt’s label to see which machines it joins.'],
      ['added', 'List view: point at a line to see where its inputs come from and where its outputs go.'],
      ['fixed', 'A line whose belts or pipes would overflow says how to build it in groups, like 6 + 4 blenders.'],
      [
        'fixed',
        'Recipes: the list scrolls down instead of sideways, and cards no longer split between columns. Thanks to u/Aeri73 and kozmo403.',
      ],
      ['changed', 'Belts turn through rounded corners and fan out smoothly from a machine.'],
      ['changed', 'A new version waits for you to press Reload instead of loading on its own.'],
      ['changed', 'Feedback: the Send button says what’s still missing.'],
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
      ['changed', 'Recipes: the search sits at the top of the tab. Thanks to u/Aeri73.'],
      ['fixed', 'Big factories: Fit to screen shows all of it, and the raw inputs no longer stack in one tall column.'],
    ],
  },
  {
    version: '0.12.1',
    date: '2026-09-30',
    notes: [
      ['fixed', 'Codex: Fabric’s alternates no longer show a broken percentage.'],
      ['fixed', 'Codex: links and tier labels are easier to tap on a phone.'],
    ],
  },
  {
    version: '0.12.0',
    date: '2026-09-30',
    notes: [
      ['added', 'Codex: a whole production line worked out for every part, and every recipe for it compared.'],
      ['added', 'New guides: getting started, the Space Elevator, power, oil and nuclear.'],
      ['fixed', 'Plans whose only recipes loop back on themselves say what to bring in instead of failing.'],
    ],
  },
];

export const LATEST_UPDATE = UPDATES[0].version;
