/**
 * Synthesises Alembic curve archives in memory, for the hair import scenes.
 *
 * @remarks
 * The hair scenes exist to check that {@link AlembicHairImporter} turns curve
 * control points into correctly oriented ribbon geometry. Feeding them a real
 * XGen export would defeat the harness on two counts: an 84 MB binary does not
 * belong in the repository, and a captured frame full of 60,000 overlapping
 * strands cannot tell a correct import from a subtly wrong one.
 *
 * So the fixtures here build archives whose geometry has a known answer. A
 * helix, a fan and a straight comb each fail visibly and distinctly when the
 * importer gets an axis, a winding order or a width taper wrong, which a dense
 * hair cap does not.
 *
 * Everything is generated from closed-form maths, with no `Math.random()`, so
 * the archives are byte-identical run to run.
 */

/** One curve set to write into an archive. */
export type SyntheticCurveSet = {
  /** Object name, as it will appear in the parsed archive. */
  name: string;
  /** Control point positions, 3 floats per point, strands laid out end to end. */
  positions: Float32Array;
  /** Control point count per strand. */
  numVertices: Int32Array;
  /** Per-point width. */
  width: Float32Array;
  /** Per-point UV, 2 floats per point. */
  uv: Float32Array;
};

const DIGEST_SIZE = 16;
const DATA_FLAG_HI = 0x80000000;

/**
 * Builds an Ogawa archive containing the given curve sets.
 *
 * @remarks
 * This writes the same layout the reader in `@zephyr3d/loaders` expects, which
 * is a deliberately narrow slice of Ogawa: a root group holding two version
 * words, the object hierarchy, and the metadata string. Property groups follow
 * the convention that child 0 of a group is the owning object's property tree
 * and later children are nested objects.
 *
 * @param sets - Curve sets to encode, one object each.
 * @returns Archive bytes, ready to hand to the importer as a Blob.
 */
export function buildAlembicArchive(sets: SyntheticCurveSet[]): ArrayBuffer {
  const w = new OgawaWriter();

  // Each curve object: child 0 is its property group, and the trailing data block
  // of the parent lists the child object names.
  const objectRefs: Ref[] = [];
  for (const set of sets) {
    // Property groups, in the order the reader scans them. Names are not encoded
    // per property here: the reader identifies them structurally, by element
    // count against the topology, which is exactly the behaviour worth testing.
    const geomChildren: Ref[] = [
      w.group([w.data(f32(new Float32Array(12)))]), // .selfBnds placeholder
      w.group([w.data(f32(set.positions))]), // P
      w.group([w.data(i32(set.numVertices))]), // nVertices
      w.group([w.data(f32(set.uv))]), // uv
      w.group([w.data(f32(set.width))]) // width
    ];
    const geom = w.group(geomChildren);
    // An object group: child 0 is the property tree, and there are no sub-objects.
    objectRefs.push(w.group([geom, w.data(nameTable([]))]));
  }

  const hierarchy = w.group([
    // Child 0 of the hierarchy root stands in for the root object's own
    // properties; the curve objects follow, matching the name table below.
    w.group([]),
    ...objectRefs,
    w.data(nameTable(sets.map((s) => s.name)))
  ]);

  const metadata = w.data(
    latin1Bytes('_ai_AlembicVersion=Alembic 1.8.3 (synthetic);_ai_Application=zephyr3d visual-test fixture;')
  );

  const root = w.group([
    w.data(new Uint8Array([0, 0, 0, 0])),
    w.data(new Uint8Array([0, 0, 0, 0])),
    hierarchy,
    metadata
  ]);

  return w.finish(root);
}

/** A reference to a written group or data block. */
type Ref = { offset: number; isData: boolean };

/**
 * Incremental Ogawa writer.
 *
 * @remarks
 * Ogawa is written bottom-up: a group must know its children's byte offsets, so
 * children are emitted first and the group records their positions. That makes a
 * simple append-only buffer sufficient, with no patching pass.
 */
class OgawaWriter {
  /** @internal */
  private _chunks: Uint8Array[] = [];
  /** @internal */
  private _length = 16; // Header is written last but occupies the first 16 bytes.

  /** Appends a data block and returns a reference to it. */
  data(payload: Uint8Array): Ref {
    const offset = this._length;
    // uint64 size, then the payload. The reader treats the first 16 bytes of the
    // payload as Alembic's per-sample digest and skips them.
    const header = new Uint8Array(8);
    writeU64(header, 0, payload.length);
    this._push(header);
    this._push(payload);
    return { offset, isData: true };
  }

  /** Appends a group with the given children and returns a reference to it. */
  group(children: Ref[]): Ref {
    const offset = this._length;
    const buf = new Uint8Array(8 + children.length * 8);
    writeU64(buf, 0, children.length);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      writeU64(buf, 8 + i * 8, child.offset);
      if (child.isData) {
        // Set the high bit of the high word to mark a data block.
        const hiPos = 8 + i * 8 + 4;
        const hi = readU32(buf, hiPos) | DATA_FLAG_HI;
        writeU32(buf, hiPos, hi);
      }
    }
    this._push(buf);
    return { offset, isData: false };
  }

  /** Emits the file header pointing at `root` and returns the whole archive. */
  finish(root: Ref): ArrayBuffer {
    const out = new Uint8Array(this._length);
    // "Ogawa" magic, then a version/flag word, then the root group offset.
    out.set(latin1Bytes('Ogawa'), 0);
    out[5] = 0xff;
    out[6] = 0x00;
    out[7] = 0x01;
    writeU64(out, 8, root.offset);
    let cursor = 16;
    for (const chunk of this._chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out.buffer;
  }

  /** @internal */
  private _push(chunk: Uint8Array) {
    this._chunks.push(chunk);
    this._length += chunk.length;
  }
}

/** Wraps a float array in the digest header the reader skips. */
function f32(values: Float32Array): Uint8Array {
  const out = new Uint8Array(DIGEST_SIZE + values.byteLength);
  out.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), DIGEST_SIZE);
  return out;
}

/** Wraps an int array in the digest header the reader skips. */
function i32(values: Int32Array): Uint8Array {
  const out = new Uint8Array(DIGEST_SIZE + values.byteLength);
  out.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), DIGEST_SIZE);
  return out;
}

/**
 * Encodes a child-object name table.
 *
 * @remarks
 * Each entry is a uint32 length, the ASCII name, then a one-byte metadata index.
 * The trailing byte is easy to overlook and its absence would make the reader
 * stop after the first name, so the fixture writes the real layout.
 */
function nameTable(names: string[]): Uint8Array {
  let size = 0;
  for (const n of names) {
    size += 4 + n.length + 1;
  }
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const n of names) {
    writeU32(out, cursor, n.length);
    cursor += 4;
    for (let i = 0; i < n.length; i++) {
      out[cursor++] = n.charCodeAt(i) & 0x7f;
    }
    out[cursor++] = 0;
  }
  return out;
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function writeU32(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(buf: Uint8Array, offset: number) {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

function writeU64(buf: Uint8Array, offset: number, value: number) {
  writeU32(buf, offset, value >>> 0);
  writeU32(buf, offset + 4, Math.floor(value / 0x100000000));
}

/** Shared builder: allocates the arrays for a uniform-topology curve set. */
function allocate(name: string, strands: number, pointsPerStrand: number): SyntheticCurveSet {
  const total = strands * pointsPerStrand;
  const numVertices = new Int32Array(strands);
  numVertices.fill(pointsPerStrand);
  return {
    name,
    positions: new Float32Array(total * 3),
    numVertices,
    width: new Float32Array(total),
    uv: new Float32Array(total * 2)
  };
}

/**
 * Strands rising in a helix around the Y axis.
 *
 * @remarks
 * A helix is the shape that catches frame errors. Every strand curves
 * continuously in all three axes, so a transposed axis, a mirrored winding or a
 * side vector computed against the wrong reference turns the clean spiral into
 * something obviously wrong rather than into a slightly different tangle. The
 * width tapers root to tip, which pins the width interpolation as well.
 *
 * @param strands - Number of helices, evenly spaced in starting phase.
 * @param pointsPerStrand - Control points per helix.
 */
export function helixCurves(strands = 24, pointsPerStrand = 24): SyntheticCurveSet {
  const set = allocate('Helix', strands, pointsPerStrand);
  const radius = 0.55;
  const height = 1.6;
  const turns = 1.35;
  let p = 0;
  let w = 0;
  let t = 0;
  for (let s = 0; s < strands; s++) {
    const phase = (s / strands) * Math.PI * 2;
    for (let i = 0; i < pointsPerStrand; i++) {
      const f = i / (pointsPerStrand - 1);
      const angle = phase + f * turns * Math.PI * 2;
      set.positions[p++] = Math.cos(angle) * radius;
      set.positions[p++] = -height * 0.5 + f * height;
      set.positions[p++] = Math.sin(angle) * radius;
      // Taper from root to tip so the width ramp is part of the baseline.
      set.width[w++] = 0.05 * (1 - 0.75 * f);
      set.uv[t++] = s / strands;
      set.uv[t++] = f;
    }
  }
  return set;
}

/**
 * Strands fanning out in a single plane.
 *
 * @remarks
 * A planar fan is the shape that catches ribbon orientation. All strands lie in
 * the XY plane, so a correct import shows ribbons of even apparent width, while
 * a side vector that drifts toward the view direction collapses some of them to
 * near-invisible slivers. That failure is impossible to see on a helix, where
 * varying apparent width is expected.
 *
 * @param strands - Number of strands in the fan.
 * @param pointsPerStrand - Control points per strand.
 */
export function fanCurves(strands = 16, pointsPerStrand = 12): SyntheticCurveSet {
  const set = allocate('Fan', strands, pointsPerStrand);
  const length = 1.5;
  const spread = Math.PI * 0.75;
  // Wide relative to a real strand: at a physical width these read as sub-pixel
  // slivers, and a baseline made of slivers is dominated by rasterisation noise
  // rather than by the geometry it is supposed to pin.
  const widthScale = 4;
  let p = 0;
  let w = 0;
  let t = 0;
  for (let s = 0; s < strands; s++) {
    const a = -spread * 0.5 + (strands === 1 ? 0 : (s / (strands - 1)) * spread);
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    for (let i = 0; i < pointsPerStrand; i++) {
      const f = i / (pointsPerStrand - 1);
      // Bend the tips outward so the strands are curves rather than straight rays.
      const bend = f * f * 0.35;
      set.positions[p++] = dx * length * f * (1 + bend);
      set.positions[p++] = -0.75 + dy * length * f;
      set.positions[p++] = 0;
      set.width[w++] = 0.045 * widthScale * (1 - 0.6 * f);
      set.uv[t++] = s / Math.max(1, strands - 1);
      set.uv[t++] = f;
    }
  }
  return set;
}

/**
 * A row of straight vertical strands with strongly varying width.
 *
 * @remarks
 * Straight strands remove curvature from the picture entirely, which isolates
 * the width path: each strand is a flat quad whose silhouette is a direct
 * readout of the width values, so a broken taper or a wrongly applied
 * `minWidth` shows as uneven bars. The varying per-strand thickness also makes
 * ribbon-corner ordering legible, because a flipped quad reads as a bow tie.
 *
 * @param strands - Number of bars.
 * @param pointsPerStrand - Control points per bar.
 */
export function combCurves(strands = 10, pointsPerStrand = 6): SyntheticCurveSet {
  const set = allocate('Comb', strands, pointsPerStrand);
  const height = 1.5;
  let p = 0;
  let w = 0;
  let t = 0;
  for (let s = 0; s < strands; s++) {
    const x = strands === 1 ? 0 : -0.8 + (s / (strands - 1)) * 1.6;
    // Thickness climbs across the row, so every bar is distinguishable. The range
    // is deliberately wide: a bar has to span several pixels for its silhouette to
    // be a usable readout of the width values.
    const base = 0.03 + (s / Math.max(1, strands - 1)) * 0.14;
    for (let i = 0; i < pointsPerStrand; i++) {
      const f = i / (pointsPerStrand - 1);
      set.positions[p++] = x;
      set.positions[p++] = -height * 0.5 + f * height;
      set.positions[p++] = 0;
      set.width[w++] = base * (1 - 0.8 * f);
      set.uv[t++] = s / Math.max(1, strands - 1);
      set.uv[t++] = f;
    }
  }
  return set;
}
