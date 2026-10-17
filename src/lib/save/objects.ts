import type { SaveHeader } from './header';
import { Reader, SaveError, Unsupported } from './reader';

// The save body as the game writes it (1.0 and later): a list of levels, each with object headers (class, name,
// where it stands) and then object bodies (tagged properties). Read for its layout with GreyHak's sat_sav_parse
// and etothepii's satisfactory-file-parser; no code is taken from either.

export type Ref = { level: string; path: string };
export type Props = Record<string, unknown>;

export type SaveObject = {
  /** Class path, like /Game/FactoryGame/Buildable/Factory/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C */
  type: string;
  /** Full instance name, unique in the save. */
  name: string;
  /** For a component, the actor it belongs to. */
  parent?: string;
  /** For an actor, where it stands (cm) and how it is turned. */
  pos?: [number, number, number];
  rot?: [number, number, number, number];
  /** Properties; only for the classes that are read in full. */
  props?: Props;
};

/** How much of an object to keep: nothing, its header (class, name, position) or its properties as well. */
export type Want = (type: string) => 'skip' | 'head' | 'full';

export type Parsed = {
  objects: SaveObject[];
  /** Things picked up or destroyed in the world (pickups, drop pods, plants), by instance name. */
  collected: string[];
  /** Objects in the save, read or not. */
  total: number;
  /** What could not be read, by kind, with how often. */
  unknown: Record<string, number>;
};

type Node = { name: string; kids: Node[] };
/** How an object was written: its save version, whether property tags carry full types (1.1 and later), and where to count what could not be read. */
export type ReadContext = { save: number; complete: boolean; unknown: Record<string, number> };

// Save versions (FGSaveManagerInterface) and Unreal object versions where the layout changed.
const V_WORLD_PARTITION = 38;
const V_64BIT = 41;
const V_ITEM_STATE = 43;
const V_OBJECT_FLAGS = 49;
const V_LEVEL_VERSION = 51;
const V_VERSION_DATA = 53;
const UE5_TAG_EXTENSION = 1011;
const UE5_COMPLETE_TAG = 1012;

// Structs that hold who built or owns something; never needed, skipped without counting them as unread.
const PLAYER_STRUCTS = new Set(['PlayerInfoHandle', 'ClientIdentityInfo', 'UniqueNetIdRepl']);

const times = <T>(n: number, f: () => T): T[] => Array.from({ length: n }, f);
const readRef = (r: Reader): Ref => ({ level: r.str(), path: r.str() });
const readGuid = (r: Reader) => times(4, () => r.u32());
const note = (c: ReadContext, what: string) => {
  c.unknown[what] = (c.unknown[what] ?? 0) + 1;
};

/** Package and engine versions an object was written with; only the UE5 object version matters here. */
function readVersionData(r: Reader): number {
  r.u32();
  r.i32(); // UE4 version
  const ue5 = r.i32();
  r.i32(); // licensee
  r.skip(10); // engine major, minor, patch, changelist
  r.str(); // branch
  r.skip(r.count() * 20); // custom versions: guid and number
  return ue5;
}

function readNode(r: Reader): Node {
  const name = r.str();
  return { name, kids: times(r.count(), () => readNode(r)) };
}

function readText(r: Reader): string {
  r.u32(); // flags
  const history = r.i8();
  switch (history) {
    case -1:
      return r.i32() ? r.str() : '';
    case 0:
      r.str(); // namespace
      r.str(); // key
      return r.str();
    case 1:
    case 3: {
      const format = readText(r);
      for (let n = r.count(); n > 0; n--) {
        r.str();
        if (r.u8() !== 4) throw new Unsupported('TextProperty argument');
        readText(r);
      }
      return format;
    }
    case 10: {
      const s = readText(r);
      r.u8();
      return s;
    }
    case 11:
      r.str(); // table
      return r.str();
    default:
      throw new Unsupported(`TextProperty history ${history}`);
  }
}

function readStruct(r: Reader, name: string, c: ReadContext): unknown {
  const real = () => (c.save >= V_64BIT ? r.f64() : r.f32());
  switch (name) {
    case 'Vector':
    case 'Rotator':
      return times(3, real);
    case 'Vector2D':
      return times(2, real);
    case 'Quat':
    case 'Vector4':
    case 'Vector4D':
      return times(4, real);
    case 'Box': {
      const box = times(6, real);
      r.u8(); // valid
      return box;
    }
    case 'IntVector':
      return times(3, () => r.i32());
    case 'IntPoint':
      return times(2, () => r.i32());
    case 'LinearColor':
      return times(4, () => r.f32());
    case 'Color':
      return times(4, () => r.u8());
    case 'Guid':
      return readGuid(r);
    case 'DateTime':
    case 'Timespan':
      return r.i64();
    case 'TimerHandle':
    case 'SlateBrush':
      return r.str();
    case 'FluidBox':
      return r.f32();
    case 'RailroadTrackPosition':
      return { track: readRef(r), offset: r.f32(), forward: r.f32() };
    case 'InventoryItem': {
      const item = readRef(r);
      if (c.save < V_ITEM_STATE) readRef(r);
      else if (r.i32() >= 1) {
        readRef(r); // state struct type
        r.i32(); // its size
        readProps(r, c);
      }
      return item;
    }
    default:
      if (PLAYER_STRUCTS.has(name)) throw new Unsupported(name);
      // Any other struct is a list of tagged properties.
      return readProps(r, c);
  }
}

function readValue(r: Reader, node: Node, c: ReadContext, prop: string): unknown {
  switch (node.name) {
    case 'BoolProperty':
      return r.u8() !== 0;
    case 'ByteProperty':
      return node.kids.length ? r.str() : r.u8();
    case 'Int8Property':
      return r.i8();
    case 'Int16Property':
      return r.i16();
    case 'UInt16Property':
      return r.u16();
    case 'IntProperty':
      return r.i32();
    case 'UInt32Property':
      return r.u32();
    case 'Int64Property':
      return r.i64();
    case 'UInt64Property':
      return r.u64();
    case 'FloatProperty':
      return r.f32();
    case 'DoubleProperty':
      return r.f64();
    case 'StrProperty':
    case 'NameProperty':
    case 'EnumProperty':
      return r.str();
    case 'ObjectProperty':
    case 'InterfaceProperty':
      return readRef(r);
    case 'SoftObjectProperty': {
      const pkg = r.str();
      const asset = r.str();
      r.str(); // sub path
      return { level: '', path: asset ? `${pkg}.${asset}` : pkg } satisfies Ref;
    }
    case 'TextProperty':
      return readText(r);
    case 'StructProperty':
      return readStruct(r, node.kids[0]?.name ?? '', c);
    case 'ArrayProperty': {
      const n = r.count();
      const el = node.kids[0];
      if (el?.name !== 'StructProperty') return times(n, () => readValue(r, el ?? { name: '', kids: [] }, c, prop));
      let struct = el.kids[0]?.name ?? '';
      if (!c.complete) {
        // The old layout names the element struct in a tag of its own.
        r.str();
        r.str();
        r.i32();
        r.i32();
        struct = r.str();
        r.skip(16);
        if (r.u8()) r.skip(16);
      }
      return times(n, () => readStruct(r, struct, c));
    }
    case 'SetProperty': {
      if (r.i32() !== 0) throw new Unsupported('SetProperty removals');
      const n = r.count();
      const el = node.kids[0] ?? { name: '', kids: [] };
      if (el.name !== 'StructProperty') return times(n, () => readValue(r, el, c, prop));
      // The game writes these two by hand, whatever the tag says.
      if (prop === 'mRemovalLocations') return times(n, () => times(3, () => r.f32()));
      if (prop === 'mDestroyedPickups' || prop === 'mLootedDropPods') return times(n, () => readGuid(r));
      const struct = el.kids[0]?.name;
      if (!struct) throw new Unsupported(`SetProperty of struct ${prop}`);
      return times(n, () => readStruct(r, struct, c));
    }
    case 'MapProperty': {
      if (r.i32() !== 0) throw new Unsupported('MapProperty removals');
      const n = r.count();
      const [k = { name: '', kids: [] }, v = { name: '', kids: [] }] = node.kids;
      const one = (t: Node, isKey: boolean) => {
        if (t.name !== 'StructProperty') return readValue(r, t, c, prop);
        if (isKey && (prop === 'mSaveData' || prop === 'mUnresolvedSaveData')) return times(3, () => r.i32());
        const struct = t.kids[0]?.name;
        return struct ? readStruct(r, struct, c) : readProps(r, c);
      };
      return times(n, () => [one(k, true), one(v, false)]);
    }
    default:
      throw new Unsupported(node.name || 'property without a type');
  }
}

const leaf = (name: string): Node => ({ name, kids: [] });

/** A list of tagged properties up to the "None" that ends it. A property that cannot be read is skipped by its size. */
export function readProps(r: Reader, c: ReadContext): Props {
  const props: Props = {};
  for (;;) {
    const name = r.str();
    if (name === 'None' || name === '') return props;
    let node: Node;
    let size: number;
    let index = 0;
    let bool = false;
    if (c.complete) {
      node = readNode(r);
      size = r.i32();
      const flags = r.u8();
      if (flags & 0x01) index = r.i32();
      if (flags & 0x02) r.skip(16); // property guid
      if (flags & 0x04) throw new Unsupported('property tag extensions');
      bool = (flags & 0x10) !== 0;
    } else {
      const type = r.str();
      size = r.i32();
      index = r.i32();
      node = leaf(type);
      if (type === 'ArrayProperty' || type === 'SetProperty') node.kids.push(leaf(r.str()));
      else if (type === 'StructProperty') {
        node.kids.push(leaf(r.str()));
        r.skip(16); // struct guid
      } else if (type === 'BoolProperty') bool = r.u8() !== 0;
      else if (type === 'ByteProperty' || type === 'EnumProperty') {
        const e = r.str();
        if (e !== 'None') node.kids.push(leaf(e));
      } else if (type === 'MapProperty') node.kids.push(leaf(r.str()), leaf(r.str()));
      if (r.u8()) r.skip(16); // property guid
    }
    const start = r.pos;
    const end = start + size;
    if (size < 0 || end > r.size) throw new SaveError(`Damaged save: property ${name} runs past the end`);
    const key = index ? `${name}[${index}]` : name;
    const struct = node.name === 'StructProperty' ? (node.kids[0]?.name ?? '') : '';
    if (node.name === 'BoolProperty') props[key] = bool;
    else if (!PLAYER_STRUCTS.has(struct)) {
      try {
        const value = readValue(r, node, c, name);
        if (r.pos > end) throw new SaveError(`${name} read past its size`);
        props[key] = value;
      } catch (e) {
        if (!(e instanceof SaveError)) throw e;
        note(c, struct ? `StructProperty ${struct}` : node.kids[0] ? `${node.name} of ${node.kids[0].name}` : node.name);
      }
    }
    r.pos = end;
  }
}

function readBody(r: Reader, actor: boolean, c: ReadContext, ue5: number): Props {
  if (actor) {
    readRef(r); // outer
    for (let n = r.count(); n > 0; n--) readRef(r); // components, which also name their actor in their own header
  }
  if (ue5 >= UE5_TAG_EXTENSION) r.u8(); // serialization control
  return readProps(r, c);
}

/** Reads the unpacked body: every level's object headers, and the properties of the objects `want` asks for. */
export function readObjects(body: Uint8Array, header: SaveHeader, want: Want, progress?: (done: number) => void): Parsed {
  const save = header.saveVersion;
  let r = new Reader(body);
  const size = r.i64();
  if (size < 0 || size + 8 > body.length) throw new SaveError('Damaged save: body size');
  r = new Reader(body.subarray(0, size + 8), 8);
  const ue5 = save >= V_VERSION_DATA ? readVersionData(r) : 0;
  if (save >= V_WORLD_PARTITION) {
    // World partition grids: names and hashes, not needed.
    for (let grids = r.count(); grids > 0; grids--) {
      r.str();
      r.skip(8);
      for (let cells = r.u32(); cells > 0; cells--) {
        r.str();
        r.u32();
      }
    }
  }
  const out: Parsed = { objects: [], collected: [], total: 0, unknown: {} };
  const collected = new Set<string>();
  const levels = r.count();
  for (let i = 0; i <= levels; i++) {
    const persistent = i === levels;
    if (!persistent) r.str(); // level name
    readLevel(r, persistent, save, ue5, want, out, collected);
    progress?.(r.pos / r.size);
  }
  out.collected = [...collected];
  return out;
}

const readRefs = (r: Reader, into: Set<string>) => {
  for (let n = r.count(); n > 0; n--) into.add(readRef(r).path);
};
// The main level lists what was destroyed per level: level name, then references.
const readDestroyed = (r: Reader, into: Set<string>) => {
  for (let n = r.count(); n > 0; n--) {
    r.str();
    readRefs(r, into);
  }
};

function readLevel(r: Reader, persistent: boolean, save: number, saveUe5: number, want: Want, out: Parsed, collected: Set<string>) {
  const tocSize = r.i64();
  const tocAt = r.pos;
  r.skip(tocSize);
  const dataSize = r.i64();
  const dataAt = r.pos;
  r.skip(dataSize);
  // What comes after the objects decides how they are read, so it is read first.
  let levelSave = save;
  let levelUe5 = saveUe5;
  // What was picked up or destroyed is listed here, and newer saves list it again after the object headers. When
  // both are there the second one counts: the first can still name things that stand in the world.
  let gone = new Set<string>();
  if (persistent) readDestroyed(r, gone);
  else {
    if (save >= V_LEVEL_VERSION) levelSave = r.i32();
    readRefs(r, gone);
    if (save >= V_VERSION_DATA && r.i32() >= 1) levelUe5 = readVersionData(r);
  }
  const end = r.pos;

  r.pos = tocAt;
  const count = r.count();
  out.total += count;
  const heads: { obj: SaveObject; actor: boolean; keep: 'skip' | 'head' | 'full' }[] = [];
  for (let i = 0; i < count; i++) {
    const actor = r.i32() === 1;
    const type = r.str();
    r.str(); // root object
    const name = r.str();
    if (levelSave >= V_OBJECT_FLAGS) r.u32();
    const obj: SaveObject = { type, name };
    if (actor) {
      r.i32(); // needs transform
      const rot: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
      obj.pos = [r.f32(), r.f32(), r.f32()];
      obj.rot = rot;
      r.skip(12); // scale
      r.i32(); // placed in level
    } else obj.parent = r.str();
    heads.push({ obj, actor, keep: want(type) });
  }
  if (r.pos < tocAt + tocSize) {
    gone = new Set();
    if (persistent) readDestroyed(r, gone);
    else readRefs(r, gone);
  }
  for (const g of gone) collected.add(g);

  r.pos = dataAt;
  if (r.i32() !== count) throw new SaveError('Damaged save: object count does not match');
  for (const { obj, actor, keep } of heads) {
    let objSave = levelSave;
    if (levelSave >= V_WORLD_PARTITION) {
      objSave = r.i32();
      r.i32(); // move references to the main level
    }
    const size = r.i32();
    const at = r.pos;
    r.skip(size);
    let objUe5 = levelUe5;
    if (objSave >= V_VERSION_DATA && r.i32() === 1) objUe5 = readVersionData(r);
    const next = r.pos;
    if (keep === 'full') {
      const c: ReadContext = { save: objSave, complete: objSave >= V_VERSION_DATA && objUe5 >= UE5_COMPLETE_TAG, unknown: out.unknown };
      // Read inside the object's own bytes, so a damaged object cannot take the next one with it.
      const own = new Reader(r.bytes.subarray(at, at + size));
      try {
        obj.props = readBody(own, actor, c, objUe5);
      } catch (e) {
        if (!(e instanceof SaveError)) throw e;
        note(c, `object ${obj.type.slice(obj.type.lastIndexOf('.') + 1)}`);
      }
    }
    if (keep !== 'skip') out.objects.push(obj);
    r.pos = next;
  }
  r.pos = end;
}
