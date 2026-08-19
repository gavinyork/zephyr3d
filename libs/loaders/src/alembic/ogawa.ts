/**
 * Minimal reader for the Alembic Ogawa container format.
 *
 * @remarks
 * Ogawa stores a tree of groups and data blocks. The 16-byte file header ends
 * with a uint64 offset to the root group. A group is a uint64 child count
 * followed by that many uint64 child references; the high bit of a reference
 * marks a data block rather than a group, and a reference of 0 means empty.
 * A data block is a uint64 byte size followed by that many bytes.
 *
 * Alembic prefixes every property sample with a 16-byte digest, so array data
 * starts 16 bytes into the block payload. {@link OgawaData.sample} accounts for
 * this; {@link OgawaData.raw} does not.
 */
import { ASSERT } from '@zephyr3d/base';

const OGAWA_MAGIC = 'Ogawa';
/** Alembic writes a 16-byte hash ahead of each property sample. */
const DIGEST_SIZE = 16;

/** A data block inside an Ogawa archive. */
export class OgawaData {
  /** @internal */
  private readonly _view: DataView;
  /** @internal */
  private readonly _offset: number;
  /** @internal */
  private readonly _size: number;
  /** @internal */
  constructor(view: DataView, offset: number, size: number) {
    this._view = view;
    this._offset = offset;
    this._size = size;
  }
  /** Total payload size in bytes, including the digest header. */
  get size() {
    return this._size;
  }
  /** Payload size in bytes with the digest header excluded. */
  get sampleSize() {
    return this._size > DIGEST_SIZE ? this._size - DIGEST_SIZE : 0;
  }
  /** Payload bytes including the digest header. */
  raw() {
    return new Uint8Array(this._view.buffer, this._view.byteOffset + this._offset, this._size);
  }
  /**
   * Payload bytes with the digest header skipped.
   *
   * @remarks
   * This is the view that array properties should be decoded from.
   */
  sample() {
    const size = this.sampleSize;
    return new Uint8Array(this._view.buffer, this._view.byteOffset + this._offset + DIGEST_SIZE, size);
  }
  /** Decodes the sample payload as UTF-8 text. */
  text() {
    return new TextDecoder().decode(this.raw());
  }
}

/**
 * A child reference, kept as two 32-bit halves.
 *
 * @remarks
 * The high bit selects data versus group and the low 63 bits are a file offset.
 * Collapsing that into a float64 would silently drop the flag for large offsets,
 * so the halves are carried separately.
 * @internal
 */
type OgawaRef = { lo: number; hi: number };

/** A group node inside an Ogawa archive. */
export class OgawaGroup {
  /** @internal */
  private readonly _view: DataView;
  /** @internal */
  private readonly _children: OgawaRef[];
  /** @internal */
  constructor(view: DataView, offset: number) {
    this._view = view;
    ASSERT(offset >= 0 && offset + 8 <= view.byteLength, `Ogawa group offset out of range: ${offset}`);
    const count = readU64(view, offset);
    ASSERT(
      count <= 0xffffffff && offset + 8 + count * 8 <= view.byteLength,
      `Ogawa group child count out of range: ${count}`
    );
    const children: OgawaRef[] = [];
    for (let i = 0; i < count; i++) {
      children.push(readRef(view, offset + 8 + i * 8));
    }
    this._children = children;
  }
  /** Number of child references. */
  get childCount() {
    return this._children.length;
  }
  /** True when the child at `index` is an empty reference. */
  isEmpty(index: number) {
    if (index < 0 || index >= this._children.length) {
      return true;
    }
    const ref = this._children[index];
    return ref.lo === 0 && ref.hi === 0;
  }
  /** True when the child at `index` is a data block. */
  isData(index: number) {
    return this.isEmpty(index) ? false : (this._children[index].hi & 0x80000000) !== 0;
  }
  /**
   * Reads the child at `index` as a group.
   *
   * @returns The child group, or null when the reference is empty, is a data
   * block, or points outside the archive.
   */
  group(index: number) {
    if (this.isEmpty(index) || this.isData(index)) {
      return null;
    }
    const offset = refOffset(this._children[index]);
    if (offset + 8 > this._view.byteLength) {
      return null;
    }
    return new OgawaGroup(this._view, offset);
  }
  /**
   * Reads the child at `index` as a data block.
   *
   * @returns The child data block, or null when the reference is empty, is a
   * group, or declares a payload that does not fit in the archive.
   */
  data(index: number) {
    if (this.isEmpty(index) || !this.isData(index)) {
      return null;
    }
    const offset = refOffset(this._children[index]);
    if (offset + 8 > this._view.byteLength) {
      return null;
    }
    const size = readU64(this._view, offset);
    if (offset + 8 + size > this._view.byteLength) {
      return null;
    }
    return new OgawaData(this._view, offset + 8, size);
  }
}

/** A parsed Ogawa archive. */
export class OgawaArchive {
  /** @internal */
  private readonly _root: OgawaGroup;
  /** @internal */
  private readonly _view: DataView;
  /**
   * Parses an Ogawa archive from raw bytes.
   *
   * @param buffer - Whole file contents.
   */
  constructor(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
      view.getUint8(4)
    );
    if (magic !== OGAWA_MAGIC) {
      throw new Error(
        `Not an Ogawa Alembic archive (magic '${magic}'). HDF5-backed .abc files are not supported.`
      );
    }
    this._view = view;
    this._root = new OgawaGroup(view, readU64(view, 8));
  }
  /** The archive root group. */
  get root() {
    return this._root;
  }
  /** Underlying data view, for callers that need direct access. */
  get view() {
    return this._view;
  }
}

/**
 * Reads a uint64 size as a JS number.
 *
 * @remarks
 * Sizes are byte counts of real payloads, so they stay far below 2^53.
 */
function readU64(view: DataView, offset: number) {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 0x100000000 + lo;
}

/** Reads a child reference without collapsing its high bit. @internal */
function readRef(view: DataView, offset: number): OgawaRef {
  return { lo: view.getUint32(offset, true), hi: view.getUint32(offset + 4, true) };
}

/** Extracts the file offset from a child reference. @internal */
function refOffset(ref: OgawaRef) {
  return (ref.hi & 0x7fffffff) * 0x100000000 + ref.lo;
}
