/** A file that is not a Satisfactory save, or one that is cut short or damaged. */
export class SaveError extends Error {}

/** Something this version cannot read yet: a property type, a struct or a text format. The part is skipped. */
export class Unsupported extends SaveError {}

const latin1 = new TextDecoder('latin1');
const utf16 = new TextDecoder('utf-16le');

/** Reads little-endian numbers and Unreal strings from a byte array; no read goes past the end. */
export class Reader {
  readonly dv: DataView;

  constructor(
    readonly bytes: Uint8Array,
    public pos = 0,
  ) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get size() {
    return this.bytes.length;
  }

  /** Moves past n bytes and returns where they start. */
  private take(n: number): number {
    const at = this.pos;
    if (!(n >= 0) || at < 0 || at + n > this.bytes.length) throw new SaveError(`Damaged save: read past the end at byte ${at}`);
    this.pos = at + n;
    return at;
  }

  skip(n: number) {
    this.take(n);
  }
  u8() {
    return this.bytes[this.take(1)];
  }
  i8() {
    return this.dv.getInt8(this.take(1));
  }
  u16() {
    return this.dv.getUint16(this.take(2), true);
  }
  i16() {
    return this.dv.getInt16(this.take(2), true);
  }
  i32() {
    return this.dv.getInt32(this.take(4), true);
  }
  u32() {
    return this.dv.getUint32(this.take(4), true);
  }
  // 64-bit values come back as plain numbers: sizes and counts never reach 2^53, and ticks lose under a millisecond.
  i64() {
    const at = this.take(8);
    return this.dv.getUint32(at, true) + this.dv.getInt32(at + 4, true) * 2 ** 32;
  }
  u64() {
    const at = this.take(8);
    return this.dv.getUint32(at, true) + this.dv.getUint32(at + 4, true) * 2 ** 32;
  }
  f32() {
    return this.dv.getFloat32(this.take(4), true);
  }
  f64() {
    return this.dv.getFloat64(this.take(8), true);
  }

  /** A count read from the file, checked against the bytes that are left so a damaged one cannot run away. */
  count(): number {
    const n = this.i32();
    if (n < 0 || n > this.size - this.pos) throw new SaveError(`Damaged save: count ${n} at byte ${this.pos - 4}`);
    return n;
  }

  /** An Unreal string: positive length is one byte per character, negative is UTF-16; both end in a null. */
  str(): string {
    const n = this.i32();
    if (n === 0) return '';
    if (n > 0) {
      const at = this.take(n);
      return latin1.decode(this.bytes.subarray(at, at + n - 1));
    }
    const len = -n * 2;
    const at = this.take(len);
    return utf16.decode(this.bytes.subarray(at, at + len - 2));
  }
}
