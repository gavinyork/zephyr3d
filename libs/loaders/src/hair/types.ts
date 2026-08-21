/**
 * Types for the HAIR model format (Cem Yuksel's `cyHairFile`).
 *
 * @remarks
 * The format is a flat binary: a fixed 128-byte header followed by up to six
 * optional arrays, present or absent according to a bit field in the header.
 * There is no container, no object hierarchy and no compression, so a file is
 * exactly one strand set.
 *
 * See {@link https://www.cemyuksel.com/research/hairmodels/ | HAIR Model Files}.
 */
import type { Nullable } from '@zephyr3d/base';
import type { StrandCurveSet, StrandUpAxis } from '../curves';

/** Size of the fixed header, in bytes. @public */
export const HAIR_HEADER_SIZE = 128;
/** Size of the header's free-form info string, in bytes. @public */
export const HAIR_INFO_SIZE = 88;

/** The `arrays` bit that marks a per-strand segment count array. @public */
export const HAIR_ARRAY_SEGMENTS = 1;
/** The `arrays` bit that marks a per-point position array. @public */
export const HAIR_ARRAY_POINTS = 2;
/** The `arrays` bit that marks a per-point thickness array. @public */
export const HAIR_ARRAY_THICKNESS = 4;
/** The `arrays` bit that marks a per-point transparency array. @public */
export const HAIR_ARRAY_TRANSPARENCY = 8;
/** The `arrays` bit that marks a per-point colour array. @public */
export const HAIR_ARRAY_COLORS = 16;
/**
 * The `arrays` bit that marks a per-point UV array.
 *
 * @remarks
 * A later addition to `cyHairFile`; files written by older tools stop after the
 * colour array and never set this bit.
 * @public
 */
export const HAIR_ARRAY_UVS = 32;

/**
 * The fixed header of a HAIR file.
 *
 * @remarks
 * The defaults stand in for whichever arrays the writer left out, which is how
 * a groom with uniform thickness or a uniform segment count avoids paying for a
 * full per-point array.
 * @public
 */
export type HairFileHeader = {
  /** Number of hair strands, the file's `hair_count`. */
  strandCount: number;
  /** Total control point count across all strands, the file's `point_count`. */
  pointCount: number;
  /** Bit field of which optional arrays follow the header. */
  arrays: number;
  /** Segment count used for every strand when the segments array is absent. */
  defaultSegments: number;
  /** Thickness used when the thickness array is absent. */
  defaultThickness: number;
  /** Transparency used when the transparency array is absent. */
  defaultTransparency: number;
  /** Colour used when the colour array is absent, as RGB. */
  defaultColor: [number, number, number];
  /** Free-form description written by the exporting tool, NUL padding removed. */
  info: string;
};

/**
 * A decoded HAIR file.
 *
 * @remarks
 * Extends {@link StrandCurveSet}, so it feeds the shared ribbon tessellator and
 * the GPU strand path without conversion. `width` carries the file's thickness
 * values, interpreted as a diameter to match the rest of the engine, and
 * `positions` is already in the engine's Y-up frame.
 * @public
 */
export type HairFileModel = StrandCurveSet & {
  /** The file's header, including the defaults used for absent arrays. */
  header: HairFileHeader;
  /**
   * Up axis the file's points were read as, and so the rotation that was undone
   * to bring `positions` into the engine's Y-up frame.
   */
  sourceUpAxis: StrandUpAxis;
  /** Per-point transparency, or null when the file carries none. */
  transparency: Nullable<Float32Array>;
  /** Per-point colour, 3 floats each, or null when the file carries none. */
  colors: Nullable<Float32Array>;
};
