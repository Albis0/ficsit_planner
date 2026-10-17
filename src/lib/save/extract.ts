import raw from '../../data/gamedata.json';
import { readHeader, type SaveHeader } from './header';
import { inflateBody } from './inflate';
import { type Parsed, type Props, type Ref, readObjects, type Want } from './objects';
import { SaveError } from './reader';
import { LANDMARKS } from './map';
import type { BuildingKind, SaveBuilding, SaveCircuit, SaveCount, SaveData, SaveLink } from './types';

/** The oldest save version read (1.0). */
export const OLDEST_SAVE_VERSION = 46;

const game = raw as unknown as {
  recipes: { id: string }[];
  machines: Record<string, unknown>;
  extractors: { id: string }[];
  generators: { id: string }[];
  powerStorage: { id: string };
};
const RECIPES = new Set(game.recipes.map((r) => r.id));

const KIND = new Map<string, BuildingKind>([
  ...Object.keys(game.machines).map((id) => [id, 'machine'] as const),
  ...game.extractors.map((e) => [e.id, 'extractor'] as const),
  ...game.generators.map((g) => [g.id, 'generator'] as const),
  [game.powerStorage.id, 'battery'],
  ['Build_FrackingSmasher_C', 'pressurizer'],
  ['Build_ConveyorAttachmentSplitter_C', 'splitter'],
  ['Build_ConveyorAttachmentMerger_C', 'merger'],
  ['Build_ConveyorAttachmentSplitterSmart_C', 'smart'],
  ['Build_ConveyorAttachmentSplitterProgrammable_C', 'prog'],
  ['Build_ConveyorAttachmentMergerPriority_C', 'prio'],
  ['Build_PipelineJunction_Cross_C', 'junction'],
  ['Build_PipelineJunction_T_C', 'junction'],
  ['Build_StorageContainerMk1_C', 'storage'],
  ['Build_StorageContainerMk2_C', 'storage'],
  ['Build_IndustrialTank_C', 'storage'],
  ['Build_PipeStorageTank_C', 'storage'],
  ['Build_CentralStorage_C', 'storage'],
  ['Build_ResourceSink_C', 'sink'],
  ['Build_PipelinePump_C', 'pump'],
  ['Build_PipelinePumpMk2_C', 'pump'],
  ['Build_Valve_C', 'pump'],
]);

const kindOf = (cls: string): BuildingKind | undefined =>
  KIND.get(cls) ??
  (/^Build_ConveyorBeltMk\d_C$/.test(cls)
    ? 'belt'
    : /^Build_ConveyorLiftMk\d_C$/.test(cls)
      ? 'lift'
      : /^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.test(cls)
        ? 'pipe'
        : /^Build_FoundationPassthrough_/.test(cls)
          ? 'pass'
          : undefined);

/** Class or asset id from a path: the part after the last dot (…/Recipe_IngotIron.Recipe_IngotIron_C). */
const idOf = (path: string) => path.slice(path.lastIndexOf('.') + 1);
/** An instance name without its level: Persistent_Level:PersistentLevel.Build_X_C_1.Output0 is Build_X_C_1.Output0. */
const short = (path: string) => path.slice(path.indexOf('.') + 1);
/** A component's actor and port: Build_X_C_1.Output0 is [Build_X_C_1, Output0]. */
const split = (name: string): [string, string] => {
  const i = name.lastIndexOf('.');
  return [name.slice(0, i), name.slice(i + 1)];
};

const ref = (v: unknown) => (v && typeof v === 'object' && 'path' in v && (v as Ref).path ? (v as Ref) : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v : []);
/** Rounds to a number of decimals without float tails (1.333333, not 1.3333329999999999). */
const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const MANAGERS = /\.(FGRecipeManager|BP_SchematicManager_C|BP_GamePhaseManager_C|FGPowerCircuit|BP_DropPod_C|FGCentralStorageSubsystem)$/;
/** The pickups the map shows: Somersloops and Mercer Spheres (WAT1, WAT2), the three slugs, and drop pods. Plants and debris are left out. */
const PICKUP = /^(BP_WAT[12]|BP_Crystal(_mk[23])?|BP_DropPod)(_|\d|$)/;
const COMPONENTS = /\.(FGFactoryConnectionComponent|FGPipeConnectionComponent|FGPipeConnectionFactory|FGInventoryComponent)$/;
const NODES = /\.(BP_ResourceNode|BP_ResourceNodeGeyser|BP_FrackingSatellite|BP_FrackingCore|BP_ResourceDeposit)_C$/;
const SWITCH = /^Build_(Priority)?PowerSwitch_C$/;

/** Reads in full what the planner uses; keeps only the header of nodes (for their place) and of other factory buildings (to count them). */
export const want: Want = (type) =>
  MANAGERS.test(type) || COMPONENTS.test(type) || kindOf(idOf(type)) || SWITCH.test(idOf(type))
    ? 'full'
    : NODES.test(type) || type.includes('/Buildable/Factory/')
      ? 'head'
      : 'skip';

const SLOOP = 'Desc_WAT1_C';
const SHARD = 'Desc_CrystalShard_C';

// Belts and pipes: straight lines between spline points. shortcut: a curve comes out a little short; fine for telling
// a long line between factories from a short one inside a factory.
const splineLength = (props: Props) => {
  const pts = list(props.mSplineData).map((p) => (p as Props)?.Location as number[] | undefined);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) len += dist(a, b);
  }
  return len / 100;
};

/** Turns what was read into the planner's terms. */
export function extract(p: Parsed, header: SaveHeader): SaveData {
  const byName = new Map(p.objects.map((o) => [o.name, o]));
  const unknown = { ...p.unknown };
  const note = (what: string) => {
    unknown[what] = (unknown[what] ?? 0) + 1;
  };
  const out: SaveData = {
    header,
    recipes: [],
    schematics: [],
    buildings: [],
    links: [],
    circuits: [],
    sloops: { free: 0, inMachines: 0, inDepot: 0 },
    shards: { free: 0, inMachines: 0, inDepot: 0 },
    // A dismantled drop pod is in the destroyed list; one that still stands says it was looted itself (below).
    collected: p.collected.map(short).filter((name) => PICKUP.test(name)),
    other: {},
    landmarks: [],
    unknown,
    objects: p.total,
  };
  const links = new Map<string, SaveLink>();
  /** Power switches that are on: they join the circuits either side of them into one. */
  const bridges = new Set<string>();
  const slotted = new Map<string, { sloops: number; shards: number }>();
  const add = (c: SaveCount, slot: boolean, n: number) => {
    if (slot) c.inMachines += n;
    else c.free += n;
  };

  for (const o of p.objects) {
    const cls = idOf(o.type);
    const props = o.props ?? {};
    switch (cls) {
      case 'FGRecipeManager':
        out.recipes = list(props.mAvailableRecipes)
          .flatMap((r) => ref(r)?.path ?? [])
          .map(idOf);
        continue;
      case 'BP_SchematicManager_C':
        out.schematics = list(props.mPurchasedSchematics)
          .flatMap((r) => ref(r)?.path ?? [])
          .map(idOf);
        continue;
      case 'BP_GamePhaseManager_C': {
        const phase = ref(props.mCurrentGamePhase);
        if (phase) out.phase = idOf(phase.path);
        continue;
      }
      case 'FGPowerCircuit':
        out.circuits.push({
          id: num(props.mCircuitID) ?? -1,
          members: [
            ...new Set(
              list(props.mComponents)
                .flatMap((r) => ref(r)?.path ?? [])
                .map((path) => split(short(path))[0]),
            ),
          ],
        });
        continue;
      case 'BP_DropPod_C':
        if (props.mHasBeenLooted === true) out.collected.push(short(o.name));
        continue;
      case 'FGCentralStorageSubsystem':
        for (const s of list(props.mStoredItems)) {
          const id = idOf(ref((s as Props)?.ItemClass)?.path ?? '');
          // Most saves name the count "Amount"; one 1.1 save (modded) has "amount".
          const n = num((s as Props)?.Amount) ?? num((s as Props)?.amount) ?? 0;
          if (id === SLOOP) out.sloops.inDepot += n;
          if (id === SHARD) out.shards.inDepot += n;
        }
        continue;
      case 'FGFactoryConnectionComponent':
      case 'FGPipeConnectionComponent':
      case 'FGPipeConnectionFactory': {
        const to = ref(props.mConnectedComponent);
        if (!to) continue;
        const [x, y] = [short(o.name), short(to.path)].sort();
        const [a, ap] = split(x);
        const [b, bp] = split(y);
        links.set(`${x} ${y}`, { a, ap, b, bp, pipe: cls !== 'FGFactoryConnectionComponent' });
        continue;
      }
      case 'FGInventoryComponent': {
        const slot = o.name.endsWith('.InventoryPotential');
        for (const s of list(props.mInventoryStacks)) {
          const item = ref((s as Props)?.Item)?.path;
          const n = num((s as Props)?.NumItems) ?? 0;
          if (!item || n <= 0) continue;
          const id = idOf(item);
          if (id !== SLOOP && id !== SHARD) continue;
          add(id === SLOOP ? out.sloops : out.shards, slot, n);
          if (slot && o.parent) {
            const owner = short(o.parent);
            const has = slotted.get(owner) ?? { sloops: 0, shards: 0 };
            if (id === SLOOP) has.sloops += n;
            else has.shards += n;
            slotted.set(owner, has);
          }
        }
        continue;
      }
    }

    const kind = kindOf(cls);
    if (!kind) {
      if (o.pos && o.type.includes('/Buildable/Factory/')) out.other[cls] = (out.other[cls] ?? 0) + 1;
      if (SWITCH.test(cls) && props.mIsSwitchOn === true) bridges.add(short(o.name));
      if (o.pos && LANDMARKS.includes(cls)) out.landmarks.push({ cls, x: Math.round(o.pos[0]), y: Math.round(o.pos[1]) });
      continue;
    }
    if (!o.props || !o.pos || !o.rot) continue; // already counted as unread
    const [qx, qy, qz, qw] = o.rot;
    const b: SaveBuilding = {
      id: short(o.name),
      cls,
      kind,
      x: Math.round(o.pos[0]),
      y: Math.round(o.pos[1]),
      z: Math.round(o.pos[2]),
      yaw: Math.round((Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * 180) / Math.PI),
    };
    const recipe = ref(props.mCurrentRecipe);
    if (recipe) {
      b.recipe = idOf(recipe.path);
      if (!RECIPES.has(b.recipe)) note(`recipe ${b.recipe}`);
    }
    if (kind === 'machine' || kind === 'extractor' || kind === 'pressurizer' || kind === 'generator') {
      // The game leaves out values that are at their default: no clock means 100%, no flag means not producing.
      b.clock = round(num(props.mCurrentPotential) ?? 1, 6);
      b.producing = props.mIsProducing === true;
      const span = num(props.mLastProductivityMeasurementDuration);
      const busy = num(props.mLastProductivityMeasurementProduceDuration);
      if (span && busy !== undefined) b.productivity = round(Math.min(1, busy / span), 3);
    }
    const node = ref(props.mExtractableResource);
    if (node) {
      b.node = short(node.path);
      const at = byName.get(node.path)?.pos;
      if (at) b.nodeAt = [Math.round(at[0]), Math.round(at[1]), Math.round(at[2])];
    }
    const fuel = ref(props.mCurrentFuelClass);
    if (fuel) b.fuel = idOf(fuel.path);
    if (kind === 'belt' || kind === 'pipe') b.length = round(splineLength(props), 1);
    if (kind === 'lift') {
      const top = ((props.mTopTransform as Props)?.Translation as number[] | undefined) ?? [0, 0, 0];
      b.length = round(dist(top, [0, 0, 0]) / 100, 1);
    }
    out.buildings.push(b);
  }

  const ids = new Set(out.buildings.map((b) => b.id));
  for (const b of out.buildings) {
    const s = slotted.get(b.id);
    if (s?.sloops) b.sloops = s.sloops;
    if (s?.shards) b.shards = s.shards;
  }
  out.links = [...links.values()];
  out.circuits = joined(out.circuits, bridges)
    .map((c) => ({ ...c, members: c.members.filter((m) => ids.has(m)) }))
    .filter((c) => c.members.length);
  return out;
}

/** Circuits as the game runs them: those with a power switch between them that is on are one, under the first one's id. */
function joined(circuits: SaveCircuit[], bridges: ReadonlySet<string>): SaveCircuit[] {
  const up = circuits.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (up[r] !== r) r = up[r];
    return r;
  };
  const seen = new Map<string, number>();
  circuits.forEach((c, i) => {
    for (const m of c.members) {
      if (!bridges.has(m)) continue;
      const j = seen.get(m);
      if (j === undefined) seen.set(m, i);
      else up[find(i)] = find(j);
    }
  });
  const out = new Map<number, SaveCircuit>();
  circuits.forEach((c, i) => {
    const root = find(i);
    const has = out.get(root);
    if (has) has.members.push(...c.members);
    else out.set(root, { id: circuits[root].id, members: [...c.members] });
  });
  return [...out.values()].map((c) => ({ ...c, members: [...new Set(c.members)] }));
}

export type SaveStep = 'read' | 'inflate' | 'parse' | 'extract';

/** Reads a whole save file into what the planner uses. Throws SaveError for a file it cannot read. */
export async function readSave(bytes: Uint8Array, progress?: (step: SaveStep, done: number) => void): Promise<SaveData> {
  const header = readHeader(bytes);
  if (header.saveVersion < OLDEST_SAVE_VERSION) throw new SaveError('Saves from before 1.0 cannot be read');
  const body = await inflateBody(bytes, header.bodyStart, (d) => progress?.('inflate', d));
  const parsed = readObjects(body, header, want, (d) => progress?.('parse', d));
  progress?.('extract', 0);
  const data = extract(parsed, header);
  progress?.('extract', 1);
  return data;
}
