/**
 * Alembic curve data types.
 *
 * @remarks
 * Only the subset of Alembic needed for hair/fur curve import is modeled here:
 * the Ogawa container plus the `AbcGeom_Curve_v2` schema. Alembic's HDF5
 * container and its mesh/subdivision/points schemas are out of scope.
 */
import type { Nullable } from '@zephyr3d/base';

/** Basis of a curve set, as stored in the `curveBasisAndType` property. */
export type AlembicCurveBasis = 'no' | 'bezier' | 'bspline' | 'catmullrom' | 'hermite' | 'power';

/** Topology of a curve set. */
export type AlembicCurveType = 'cubic' | 'linear' | 'variableOrder';

/** Whether curves are open or closed (periodic). */
export type AlembicCurvePeriodicity = 'nonPeriodic' | 'periodic';

/**
 * A single Alembic data property: a typed array plus enough metadata to
 * interpret it.
 */
export type AlembicProperty = {
  /** Property name as stored in the file, for example `P`, `width`, `nVertices`. */
  name: string;
  /** Raw sample bytes, with Alembic's 16-byte digest header already stripped. */
  data: ArrayBuffer;
  /** Number of scalar components per element, for example 3 for a point. */
  extent: number;
  /** Scalar type of the stored data. */
  podType: AlembicPodType;
  /** Number of elements, that is scalar count divided by extent. */
  count: number;
};

/** Scalar storage types that appear in the curve schema. */
export type AlembicPodType = 'int32' | 'uint32' | 'float32' | 'float64' | 'int16' | 'uint16' | 'uint8';

/**
 * One `AbcGeom_Curve_v2` object, decoded into flat typed arrays.
 *
 * @remarks
 * Control points are stored contiguously: strand `i` owns the
 * `numVertices[i]` points starting at the running sum of previous counts.
 */
export type AlembicCurveObject = {
  /** Full object path in the Alembic hierarchy. */
  path: string;
  /** Leaf name of the object. */
  name: string;
  /** Control point positions, 3 floats per point. */
  positions: Float32Array;
  /** Control point count for each curve. */
  numVertices: Int32Array;
  /** Per-point or per-curve width, or null when the property is absent. */
  width: Nullable<Float32Array>;
  /** True when `width` holds one value per curve rather than per point. */
  widthPerCurve: boolean;
  /** Per-curve root UV, 2 floats per curve, or null when absent. */
  uv: Nullable<Float32Array>;
  /** Per-point direction vectors written by XGen, or null when absent. */
  direction: Nullable<Float32Array>;
  /** Curve basis. */
  basis: AlembicCurveBasis;
  /** Curve topology. */
  curveType: AlembicCurveType;
  /** Curve periodicity. */
  periodicity: AlembicCurvePeriodicity;
  /** Local-to-world transform accumulated from ancestor xform objects. */
  transform: Nullable<Float32Array>;
  /** Extra properties that were decoded but have no dedicated field. */
  extras: Record<string, AlembicProperty>;
  /** Total control point count, that is the sum of `numVertices`. */
  totalPoints: number;
};

/** Result of parsing an Alembic archive for curve data. */
export type AlembicArchive = {
  /** Alembic library version string, when the archive records one. */
  version: string;
  /** Writer application, for example `XGen Spline Abc Writer`. */
  application: string;
  /** All curve objects found in the archive. */
  curves: AlembicCurveObject[];
};
