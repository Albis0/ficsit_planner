import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { extract } from '../src/lib/save/extract';
import { readHeader } from '../src/lib/save/header';
import { inflateBody } from '../src/lib/save/inflate';
import { type Parsed, type ReadContext, readProps } from '../src/lib/save/objects';
import { Reader, SaveError } from '../src/lib/save/reader';

// Builds little-endian bytes the way the game writes them.
class Bytes {
  parts: number[] = [];
  view(n: number, set: (d: DataView) => void) {
    const d = new DataView(new ArrayBuffer(n));
    set(d);
    this.parts.push(...new Uint8Array(d.buffer));
    return this;
  }
  u8 = (v: number) => this.view(1, (d) => d.setUint8(0, v));
  i32 = (v: number) => this.view(4, (d) => d.setInt32(0, v, true));
  u32 = (v: number) => this.view(4, (d) => d.setUint32(0, v, true));
  u64 = (v: number) => this.view(8, (d) => d.setBigUint64(0, BigInt(v), true));
  f32 = (v: number) => this.view(4, (d) => d.setFloat32(0, v, true));
  f64 = (v: number) => this.view(8, (d) => d.setFloat64(0, v, true));
  str = (s: string) => {
    if (!s) return this.i32(0);
    if ([...s].every((c) => c.charCodeAt(0) < 256)) {
      this.i32(s.length + 1);
      for (const c of s) this.u8(c.charCodeAt(0));
      return this.u8(0);
    }
    this.i32(-(s.length + 1));
    for (let i = 0; i < s.length; i++) this.view(2, (d) => d.setUint16(0, s.charCodeAt(i), true));
    return this.view(2, () => {});
  };
  raw = (b: ArrayLike<number>) => {
    this.parts.push(...Array.from(b));
    return this;
  };
  get bytes() {
    return new Uint8Array(this.parts);
  }
}

const ctx = (complete: boolean): ReadContext => ({ save: complete ? 60 : 46, complete, unknown: {} });

/** A 1.2 save header: session "ela", 58 hours, saved 2026-09-27 19:52 UTC. */
function header() {
  const ticks = 621355968000000000 + Date.UTC(2026, 8, 27, 19, 52) * 10000;
  const b = new Bytes()
    .i32(14)
    .i32(60)
    .i32(502094)
    .str('SPACE')
    .str('Persistent_Level')
    .str('?opts')
    .str('ela')
    .i32(3600 * 58);
  b.view(8, (d) => d.setBigInt64(0, BigInt(ticks), true));
  return b.u8(0).i32(0).str('').i32(0).str('abc123').i32(1).i32(0).i32(0);
}

describe('reading bytes', () => {
  test('strings: one byte per character, UTF-16 when the length is negative, empty for zero', () => {
    const r = new Reader(new Bytes().str('Recipe_IngotIron_C').str('Fabrika ışığı').str('').bytes);
    expect(r.str()).toBe('Recipe_IngotIron_C');
    expect(r.str()).toBe('Fabrika ışığı');
    expect(r.str()).toBe('');
    expect(r.pos).toBe(r.size);
  });

  test('a length that runs past the end is a damaged save, not a hang or a huge allocation', () => {
    expect(() => new Reader(new Bytes().i32(1_000_000).u8(65).bytes).str()).toThrow(SaveError);
    expect(() => new Reader(new Bytes().i32(-2147483648).bytes).str()).toThrow(SaveError);
    expect(() => new Reader(new Bytes().i32(500).bytes).count()).toThrow(SaveError);
    expect(() => new Reader(new Bytes().u8(1).bytes).i32()).toThrow(SaveError);
  });
});

describe('properties', () => {
  test('the old tag layout (before 1.1): number, flag, object reference, then None', () => {
    const ref = new Bytes().str('').str('/Game/Recipe_IngotIron.Recipe_IngotIron_C').bytes;
    const b = new Bytes().str('mCurrentPotential').str('FloatProperty').i32(4).i32(0).u8(0).f32(1.5);
    b.str('mIsProducing').str('BoolProperty').i32(0).i32(0).u8(1).u8(0);
    b.str('mCurrentRecipe').str('ObjectProperty').i32(ref.length).i32(0).u8(0).raw(ref);
    const props = readProps(new Reader(b.str('None').bytes), ctx(false));
    expect(props).toEqual({
      mCurrentPotential: 1.5,
      mIsProducing: true,
      mCurrentRecipe: { level: '', path: '/Game/Recipe_IngotIron.Recipe_IngotIron_C' },
    });
  });

  test('the 1.1 tag layout: a type tree, the flag in the tag, an array of vectors', () => {
    const node = (b: Bytes, name: string, kids: (() => void)[] = []) => {
      b.str(name).i32(kids.length);
      for (const k of kids) k();
    };
    const b = new Bytes();
    b.str('mIsProducing');
    node(b, 'BoolProperty');
    b.i32(0).u8(0x10);
    b.str('mSplineData');
    node(b, 'ArrayProperty', [() => node(b, 'StructProperty', [() => node(b, 'Vector', [() => node(b, '/Script/CoreUObject')])])]);
    b.i32(4 + 2 * 24).u8(0x08);
    b.i32(2).f64(0).f64(0).f64(0).f64(600).f64(0).f64(-100);
    b.str('mCircuitID');
    node(b, 'IntProperty');
    b.i32(4).u8(0).i32(7);
    const props = readProps(new Reader(b.str('None').bytes), ctx(true));
    expect(props).toEqual({
      mIsProducing: true,
      mSplineData: [
        [0, 0, 0],
        [600, 0, -100],
      ],
      mCircuitID: 7,
    });
  });

  test('a property of a type it does not know is skipped by its size and counted; the next one is still read', () => {
    const c = ctx(false);
    const b = new Bytes().str('mOdd').str('WeirdProperty').i32(3).i32(0).u8(0).raw([1, 2, 3]);
    b.str('mCircuitID').str('IntProperty').i32(4).i32(0).u8(0).i32(9);
    expect(readProps(new Reader(b.str('None').bytes), c)).toEqual({ mCircuitID: 9 });
    expect(c.unknown).toEqual({ WeirdProperty: 1 });
  });
});

describe('the compressed body', () => {
  const chunk = (data: Uint8Array) => {
    const packed = deflateSync(data);
    return new Bytes()
      .u32(0x9e2a83c1)
      .u32(0x22222222)
      .u64(131072)
      .u8(3)
      .u64(packed.length)
      .u64(data.length)
      .u64(packed.length)
      .u64(data.length)
      .raw(packed).bytes;
  };

  test('zlib chunks unpack into one body, in order', async () => {
    const a = new Uint8Array(1000).map((_, i) => i % 7);
    const z = new Uint8Array(300).fill(42);
    const file = new Bytes().raw([9, 9, 9]).raw(chunk(a)).raw(chunk(z)).bytes;
    const body = await inflateBody(file, 3);
    expect(body).toEqual(new Uint8Array([...a, ...z]));
  });

  test('a chunk without its tag is a damaged save', async () => {
    const file = chunk(new Uint8Array(10));
    file[0] = 0;
    await expect(inflateBody(file, 0)).rejects.toBeInstanceOf(SaveError);
  });
});

describe('what the planner takes', () => {
  test('the map keeps spheres, sloops, slugs and looted pods; the depot counts sloops and shards on their own', () => {
    const item = (id: string) => ({ level: '', path: `/Game/X.${id}` });
    const parsed: Parsed = {
      objects: [
        { type: '/Game/X.BP_DropPod_C', name: 'L:PersistentLevel.BP_DropPod7', props: { mHasBeenOpened: true, mHasBeenLooted: true } },
        { type: '/Game/X.BP_DropPod_C', name: 'L:PersistentLevel.BP_DropPod8', props: { mHasBeenOpened: true } },
        {
          type: '/Script/FactoryGame.FGCentralStorageSubsystem',
          name: 'L:PersistentLevel.CentralStorageSubsystem',
          props: {
            mStoredItems: [
              { ItemClass: item('Desc_WAT1_C'), Amount: 4 },
              { ItemClass: item('Desc_CrystalShard_C'), Amount: 30 },
              { ItemClass: item('Desc_WAT2_C'), Amount: 9 },
            ],
          },
        },
      ],
      collected: [
        'L:PersistentLevel.BP_WAT2_C_UAID_1',
        'L:PersistentLevel.BP_Crystal_mk3_5',
        'L:PersistentLevel.BP_NutBush12',
        'L:PersistentLevel.BP_DropPod3',
      ],
      total: 3,
      unknown: {},
    };
    const s = extract(parsed, readHeader(header().bytes));
    expect(s.collected.sort()).toEqual(['BP_Crystal_mk3_5', 'BP_DropPod3', 'BP_DropPod7', 'BP_WAT2_C_UAID_1']);
    expect(s.sloops).toEqual({ free: 0, inMachines: 0, inDepot: 4 });
    expect(s.shards).toEqual({ free: 0, inMachines: 0, inDepot: 30 });
  });
});

describe('the header', () => {
  test('reads names, play time and the save date', () => {
    const b = header();
    const h = readHeader(b.bytes);
    expect(h).toMatchObject({
      headerVersion: 14,
      saveVersion: 60,
      build: 502094,
      saveName: 'SPACE',
      sessionName: 'ela',
      sessionId: 'abc123',
    });
    expect(h.playSeconds).toBe(3600 * 58);
    expect(h.savedAt).toBe(Date.UTC(2026, 8, 27, 19, 52));
    expect(h.bodyStart).toBe(b.parts.length);
  });

  test('a file that is not a save says so', () => {
    expect(() => readHeader(new TextEncoder().encode('{"ServerManager": true} and some more text'))).toThrow(SaveError);
  });
});
