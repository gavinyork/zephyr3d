/**
 * Conversion from source curve archives to the engine's `.zhair` container.
 *
 * @remarks
 * Opening a groom is expensive. The sample XGen archive is 84 MB of Ogawa
 * container holding two million control points, and reading it means walking an
 * object tree and cross-checking property blocks before a single strand appears.
 * `.zhair` exists so that happens once, at import, rather than on every scene
 * load - and this is the step that does it.
 *
 * Nothing is decimated here. The file keeps the groom at authored density and
 * the node that draws it decides how much to use, so an artist can change strand
 * count without returning to the source archive.
 */
import type { Nullable, VFS } from '@zephyr3d/base';
import { PathUtils } from '@zephyr3d/base';
import { encodeZHair, type ZHairStrandSetSource } from '@zephyr3d/scene';
import { parseAlembicCurves } from '../alembic/parser';
import { parseHairFile } from '../hair/parser';
import { applyStrandOriginAnchor, type StrandOriginAnchor } from './origin';
import type { StrandUpAxis } from './upaxis';

/** Container a groom arrived in. @public */
export type CurveSourceFormat = 'alembic' | 'hair';

/**
 * Options for converting a curve archive.
 * @public
 */
export type ZHairConvertOptions = {
  /**
   * Scale recorded in the file, converting its units to metres.
   *
   * @remarks
   * Defaults per format: Alembic to 0.01, because Maya authors in centimetres;
   * `.hair` to 1, because the format records no unit at all and any other guess
   * would be arbitrary. Positions are stored unscaled either way, so this stays
   * adjustable after import.
   */
  unitScale?: number;
  /**
   * Up axis of a `.hair` file's points.
   *
   * @remarks
   * `cyHairFile` models are conventionally Z-up, which is the default. Ignored
   * for Alembic, which carries its own orientation.
   */
  upAxis?: StrandUpAxis;
  /**
   * Point of the groom's bounding box to move onto the origin.
   *
   * @remarks
   * Null or absent leaves the control points where the archive put them, which
   * is the historical behaviour. A groom combed in place carries the offset its
   * character had in the authoring scene, so an archive that looks fine in Maya
   * can arrive tens of units from its own origin; anchoring it makes the node's
   * transform mean what it says. Applied after the up-axis conversion, so the
   * anchor's axes are the engine's rather than the source's.
   */
  originAnchor?: Nullable<StrandOriginAnchor>;
  /** Path recorded in the file so it can be traced back to its source. */
  sourcePath?: string;
};

/**
 * Detects which curve container a buffer holds.
 *
 * @remarks
 * By content rather than by extension: both formats have a signature at offset
 * zero, and a mislabelled file is more useful diagnosed than mis-parsed.
 *
 * @param buffer - Bytes to inspect.
 * @returns The container, or null when it is neither.
 *
 * @public
 */
export function detectCurveFormat(buffer: ArrayBuffer): CurveSourceFormat | null {
  if (buffer.byteLength < 8) {
    return null;
  }
  const bytes = new Uint8Array(buffer, 0, 8);
  // Ogawa archives open with "Ogawa".
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x61 && bytes[3] === 0x77 && bytes[4] === 0x61) {
    return 'alembic';
  }
  // cyHairFile opens with "HAIR".
  if (bytes[0] === 0x48 && bytes[1] === 0x41 && bytes[2] === 0x49 && bytes[3] === 0x52) {
    return 'hair';
  }
  return null;
}

/**
 * Converts a curve archive into `.zhair` bytes.
 *
 * @param buffer - The source archive.
 * @param options - Unit scale, origin anchor and provenance.
 * @returns The `.zhair` file.
 *
 * @public
 */
export function convertCurvesToZHair(buffer: ArrayBuffer, options?: ZHairConvertOptions): ArrayBuffer {
  const format = detectCurveFormat(buffer);
  if (!format) {
    throw new Error('convertCurvesToZHair: buffer is neither an Alembic archive nor a HAIR file');
  }
  const sets: ZHairStrandSetSource[] = [];
  if (format === 'alembic') {
    const archive = parseAlembicCurves(buffer);
    if (archive.curves.length === 0) {
      throw new Error('convertCurvesToZHair: Alembic archive contains no curve objects');
    }
    for (const curve of archive.curves) {
      sets.push({
        name: curve.name,
        positions: curve.positions,
        pointCounts: curve.numVertices,
        widths: curve.width,
        widthPerStrand: curve.widthPerCurve,
        // Alembic root UV is authored per curve; the flag stays off so a reader
        // indexes it by strand.
        uv: curve.uv
      });
    }
  } else {
    const hair = parseHairFile(buffer, { upAxis: options?.upAxis });
    sets.push({
      name: hair.name,
      positions: hair.positions,
      pointCounts: hair.numVertices,
      widths: hair.width,
      widthPerStrand: hair.widthPerCurve,
      uv: hair.uv,
      uvPerPoint: !!hair.uv && hair.uv.length >= hair.totalPoints * 2,
      // Channels the ribbon tessellator has no use for and drops. Kept here
      // because the file is the only copy that will exist once the source
      // archive is out of the picture.
      colors: hair.colors,
      transparency: hair.transparency
    });
  }
  if (options?.originAnchor) {
    // After both branches, so the whole archive moves as one piece and its curve
    // objects keep their positions relative to each other.
    applyStrandOriginAnchor(sets, options.originAnchor);
  }
  return encodeZHair(sets, {
    unitScale: options?.unitScale ?? (format === 'alembic' ? 0.01 : 1),
    sourceFormat: format,
    sourcePath: options?.sourcePath
  });
}

/**
 * Reads a curve archive from a VFS and writes the `.zhair` beside it.
 *
 * @param srcVFS - Filesystem holding the source archive.
 * @param srcPath - Path of the source archive.
 * @param dstVFS - Filesystem to write into.
 * @param dstPath - Destination path, which should end in `.zhair`.
 * @param options - Unit scale, up axis and origin anchor.
 * @returns The number of bytes written.
 *
 * @public
 */
export async function importCurvesToZHairFile(
  srcVFS: VFS,
  srcPath: string,
  dstVFS: VFS,
  dstPath: string,
  options?: Omit<ZHairConvertOptions, 'sourcePath'>
): Promise<number> {
  const data = (await srcVFS.readFile(srcPath, { encoding: 'binary' })) as ArrayBuffer;
  const converted = convertCurvesToZHair(data, {
    ...options,
    sourcePath: PathUtils.basename(srcPath)
  });
  await dstVFS.writeFile(dstPath, converted, { encoding: 'binary', create: true });
  return converted.byteLength;
}
