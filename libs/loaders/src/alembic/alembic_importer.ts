/**
 * Importer for Alembic hair/fur curve archives, as exported by Maya XGen.
 *
 * @remarks
 * The archive stores strands as cubic B-spline control points. This importer
 * tessellates each strand into a camera-agnostic triangle ribbon so the result
 * can be rendered with the existing mesh pipeline. The ribbon is built in the
 * strand's own frame: the quad expands along a per-segment side vector that is
 * perpendicular to the strand direction, which keeps the geometry usable from
 * any view without a GPU expansion pass.
 *
 * The generated attributes are laid out for {@link HairMaterial}:
 * - `position`: ribbon corner positions
 * - `normal`: strand-facing normal
 * - `tangent`: strand direction, with the handedness in `w`
 * - `texCoord0`: `u` across the ribbon, `v` along the strand from root to tip
 * - `texCoord1`: root UV on the scalp, useful for tinting and masking
 */
import type { Nullable, VFS } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { VertexAttribFormat, VertexSemantic } from '@zephyr3d/device';
import {
  AssetHierarchyNode,
  AssetScene,
  type SharedModel,
  type AssetPrimitiveInfo,
  type AssetSubMeshData
} from '@zephyr3d/scene';
import { AbstractModelImporter } from '../importer';
import { parseAlembicCurves } from './parser';
import type { AlembicCurveObject } from './types';

/** Options controlling how Alembic curves are turned into renderable geometry. */
export type AlembicHairImportOptions = {
  /**
   * Uniform scale applied to control point positions.
   *
   * @remarks
   * Maya scenes are usually authored in centimetres while the engine works in
   * metres, so archives coming out of XGen normally need `0.01`. Defaults to 1.
   */
  scale?: number;
  /**
   * Keep only every Nth strand.
   *
   * @remarks
   * A full XGen description can hold tens of thousands of strands, which is far
   * more than a CPU-tessellated ribbon mesh should carry. Values above 1 thin
   * the set out evenly. Defaults to 1.
   */
  strandStride?: number;
  /**
   * Hard cap on the number of strands kept per curve object, applied after
   * `strandStride`. Defaults to no limit.
   */
  maxStrands?: number;
  /**
   * Number of ribbon segments generated per strand.
   *
   * @remarks
   * When omitted, each control point interval becomes one segment. Setting a
   * lower value resamples the strand along its spline, which is the cheapest way
   * to cut triangle count without dropping strands.
   */
  segmentsPerStrand?: number;
  /**
   * Multiplier applied to the archive's width values.
   *
   * @remarks
   * Ribbon geometry needs to be wider than a physical strand to stay visible
   * without coverage-aware shading. Defaults to 1.
   */
  widthScale?: number;
  /**
   * Minimum ribbon half-width in world units, applied after `widthScale`.
   * Defaults to 0.
   */
  minWidth?: number;
  /**
   * Emit two perpendicular ribbon sheets per strand instead of one.
   *
   * @remarks
   * A single sheet disappears when viewed edge-on. That is tolerable for a dense
   * cap, where neighbouring strands cover the gap, but not for sparse or planar
   * hair, where a whole group can share the degenerate angle and vanish at once.
   * Crossed sheets double the triangle count and remove the failure. Defaults to
   * true.
   */
  crossSection?: boolean;
  /** Name assigned to the generated root node. Defaults to `Hair`. */
  nodeName?: string;
};

type ResolvedOptions = Required<Omit<AlembicHairImportOptions, 'segmentsPerStrand' | 'maxStrands'>> & {
  segmentsPerStrand: Nullable<number>;
  maxStrands: Nullable<number>;
};

function resolveOptions(options?: AlembicHairImportOptions): ResolvedOptions {
  return {
    scale: options?.scale ?? 1,
    strandStride: Math.max(1, Math.floor(options?.strandStride ?? 1)),
    maxStrands: options?.maxStrands ?? null,
    segmentsPerStrand: options?.segmentsPerStrand ?? null,
    widthScale: options?.widthScale ?? 1,
    minWidth: options?.minWidth ?? 0,
    crossSection: options?.crossSection ?? true,
    nodeName: options?.nodeName ?? 'Hair'
  };
}

/**
 * Model importer for Alembic curve archives.
 *
 * @remarks
 * Only the Ogawa container and the curve schema are supported; mesh and point
 * archives are rejected. Register it for the `model/alembic` MIME type.
 * @public
 */
export class AlembicHairImporter extends AbstractModelImporter {
  /** @internal */
  private readonly _options: ResolvedOptions;
  /**
   * Creates an importer.
   *
   * @param options - Tessellation and scaling options.
   */
  constructor(options?: AlembicHairImportOptions) {
    super();
    this._options = resolveOptions(options);
  }
  // Curve archives are self-contained: there are no external textures or buffers
  // to resolve, so the base path and VFS are unused.
  async import(data: Blob, model: SharedModel, _basePath: string, _vfs?: VFS) {
    const buffer = await data.arrayBuffer();
    const archive = parseAlembicCurves(buffer);
    if (archive.curves.length === 0) {
      throw new Error('Alembic archive contains no curve objects');
    }
    const opt = this._options;
    const root = new AssetHierarchyNode(opt.nodeName, model);
    for (const [index, curve] of archive.curves.entries()) {
      const primitive = tessellateStrands(curve, opt);
      if (!primitive) {
        continue;
      }
      const name = curve.name || `Curves${index}`;
      const node = new AssetHierarchyNode(name, model, root);
      const subMesh: AssetSubMeshData = {
        primitive,
        material: null,
        rawPositions: null,
        rawBlendIndices: null,
        rawJointWeights: null,
        name,
        numTargets: 0
      };
      node.mesh = { subMeshes: [subMesh] };
      model.addPrimitive(primitive);
    }
    const scene = new AssetScene(opt.nodeName);
    scene.rootNodes.push(root);
    model.scenes.push(scene);
    model.activeScene = 0;
  }
}

/**
 * Builds a triangle-ribbon primitive for one curve object.
 *
 * @returns The primitive, or null when no strand survived filtering.
 * @internal
 */
function tessellateStrands(curve: AlembicCurveObject, opt: ResolvedOptions): Nullable<AssetPrimitiveInfo> {
  const selected = selectStrands(curve, opt);
  if (selected.length === 0) {
    return null;
  }
  // Two perpendicular sheets per strand, so a strand stays visible from any
  // direction. A single sheet has a viewing angle that reduces it to an edge, and
  // for planar hair - a flat fringe, or any archive whose strands share a plane -
  // that angle is one a camera actually ends up at.
  const sheets = opt.crossSection ? 2 : 1;
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const strand of selected) {
    vertexTotal += (strand.segments + 1) * 2 * sheets;
    indexTotal += strand.segments * 6 * sheets;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const tangents = new Float32Array(vertexTotal * 4);
  const uvs = new Float32Array(vertexTotal * 2);
  const rootUVs = new Float32Array(vertexTotal * 2);
  const use32 = vertexTotal > 65535;
  const indices = use32 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  const boxMin = new Vector3(Infinity, Infinity, Infinity);
  const boxMax = new Vector3(-Infinity, -Infinity, -Infinity);

  const pos = curve.positions;
  const scale = opt.scale;
  let vCursor = 0;
  let iCursor = 0;
  const p = new Vector3();
  const dir = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  const normal = new Vector3();

  for (const strand of selected) {
    const { first, count, segments } = strand;
    for (let sheet = 0; sheet < sheets; sheet++) {
      const baseVertex = vCursor;
      for (let s = 0; s <= segments; s++) {
        const t = segments === 0 ? 0 : s / segments;
        // Sample position and direction along the control polygon.
        samplePolyline(pos, first, count, t, p, dir);
        p.scaleBy(scale);
        // A stable side vector: cross the strand direction with whichever world axis
        // it is least aligned with, so nearly-vertical strands stay well conditioned.
        pickReferenceAxis(dir, up);
        Vector3.cross(dir, up, side);
        const sideLen = side.magnitude;
        if (sideLen > 1e-6) {
          side.scaleBy(1 / sideLen);
        } else {
          side.setXYZ(1, 0, 0);
        }
        Vector3.cross(side, dir, normal);
        normal.inplaceNormalize();
        // The second sheet swaps the two frame axes, putting it at right angles to
        // the first, so the pair reads as a cross-section rather than a flat card.
        if (sheet === 1) {
          const tx = side.x;
          const ty = side.y;
          const tz = side.z;
          side.setXYZ(normal.x, normal.y, normal.z);
          normal.setXYZ(tx, ty, tz);
        }
        const halfWidth = strandHalfWidth(curve, strand, t, opt);
        for (let corner = 0; corner < 2; corner++) {
          const sign = corner === 0 ? -1 : 1;
          const vi = vCursor * 3;
          const x = p.x + side.x * halfWidth * sign;
          const y = p.y + side.y * halfWidth * sign;
          const z = p.z + side.z * halfWidth * sign;
          positions[vi] = x;
          positions[vi + 1] = y;
          positions[vi + 2] = z;
          normals[vi] = normal.x;
          normals[vi + 1] = normal.y;
          normals[vi + 2] = normal.z;
          const ti = vCursor * 4;
          tangents[ti] = dir.x;
          tangents[ti + 1] = dir.y;
          tangents[ti + 2] = dir.z;
          tangents[ti + 3] = 1;
          const ui = vCursor * 2;
          uvs[ui] = corner;
          uvs[ui + 1] = t;
          rootUVs[ui] = strand.rootU;
          rootUVs[ui + 1] = strand.rootV;
          if (x < boxMin.x) {
            boxMin.x = x;
          }
          if (y < boxMin.y) {
            boxMin.y = y;
          }
          if (z < boxMin.z) {
            boxMin.z = z;
          }
          if (x > boxMax.x) {
            boxMax.x = x;
          }
          if (y > boxMax.y) {
            boxMax.y = y;
          }
          if (z > boxMax.z) {
            boxMax.z = z;
          }
          vCursor++;
        }
      }
      emitQuads(indices, iCursor, baseVertex, segments);
      iCursor += segments * 6;
    }
  }

  const vertices = {} as Record<VertexSemantic, { format: VertexAttribFormat; data: Float32Array }>;
  vertices.position = { format: 'position_f32x3' as VertexAttribFormat, data: positions };
  vertices.normal = { format: 'normal_f32x3' as VertexAttribFormat, data: normals };
  vertices.tangent = { format: 'tangent_f32x4' as VertexAttribFormat, data: tangents };
  vertices.texCoord0 = { format: 'tex0_f32x2' as VertexAttribFormat, data: uvs };
  vertices.texCoord1 = { format: 'tex1_f32x2' as VertexAttribFormat, data: rootUVs };

  return {
    name: curve.name,
    vertices: vertices as AssetPrimitiveInfo['vertices'],
    indices,
    indexCount: indexTotal,
    type: 'triangle-list',
    boxMin,
    boxMax
  };
}

/**
 * Writes the two triangles of each ribbon segment.
 * @internal
 */
function emitQuads(indices: Uint16Array | Uint32Array, start: number, baseVertex: number, segments: number) {
  let iCursor = start;
  for (let s = 0; s < segments; s++) {
    const a = baseVertex + s * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[iCursor++] = a;
    indices[iCursor++] = c;
    indices[iCursor++] = b;
    indices[iCursor++] = b;
    indices[iCursor++] = c;
    indices[iCursor++] = d;
  }
}

/** A strand that survived filtering, with its slice of the control point array. */
type SelectedStrand = {
  first: number;
  count: number;
  segments: number;
  rootU: number;
  rootV: number;
  widthFirst: number;
  widthCount: number;
};

/**
 * Applies stride and cap filtering, returning the strands to tessellate.
 * @internal
 */
function selectStrands(curve: AlembicCurveObject, opt: ResolvedOptions): SelectedStrand[] {
  const out: SelectedStrand[] = [];
  const counts = curve.numVertices;
  const uv = curve.uv;
  const uvPerPoint = !!uv && uv.length === curve.totalPoints * 2;
  let offset = 0;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (i % opt.strandStride === 0 && count >= 2) {
      if (opt.maxStrands === null || out.length < opt.maxStrands) {
        const segments = opt.segmentsPerStrand ? Math.max(1, opt.segmentsPerStrand) : count - 1;
        let rootU = 0;
        let rootV = 0;
        if (uv) {
          const uvIndex = uvPerPoint ? offset * 2 : i * 2;
          rootU = uv[uvIndex];
          rootV = uv[uvIndex + 1];
        }
        out.push({
          first: offset,
          count,
          segments,
          rootU,
          rootV,
          widthFirst: curve.widthPerCurve ? i : offset,
          widthCount: curve.widthPerCurve ? 1 : count
        });
      }
    }
    offset += count;
  }
  return out;
}

/**
 * Half-width of the ribbon at parameter `t` along a strand.
 * @internal
 */
function strandHalfWidth(curve: AlembicCurveObject, strand: SelectedStrand, t: number, opt: ResolvedOptions) {
  let raw = 0.001;
  const width = curve.width;
  if (width) {
    if (strand.widthCount === 1) {
      raw = width[strand.widthFirst];
    } else {
      const f = t * (strand.widthCount - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(i0 + 1, strand.widthCount - 1);
      const frac = f - i0;
      const w0 = width[strand.widthFirst + i0];
      const w1 = width[strand.widthFirst + i1];
      raw = w0 + (w1 - w0) * frac;
    }
  }
  // Alembic stores width as a diameter in the archive's own units.
  const half = raw * 0.5 * opt.scale * opt.widthScale;
  return half < opt.minWidth ? opt.minWidth : half;
}

/**
 * Samples a control polyline at normalized parameter `t`, writing the position
 * and the unit direction.
 *
 * @remarks
 * The archive stores cubic B-spline control points, but for ribbon geometry the
 * control polygon is close enough and far cheaper: strands carry 30 points over
 * a few centimetres, so the polygon and the spline differ by well under a pixel.
 * @internal
 */
function samplePolyline(
  points: Float32Array,
  first: number,
  count: number,
  t: number,
  outPos: Vector3,
  outDir: Vector3
) {
  const f = t * (count - 1);
  let i0 = Math.floor(f);
  if (i0 >= count - 1) {
    i0 = count - 2;
  }
  const i1 = i0 + 1;
  const frac = f - i0;
  const a = (first + i0) * 3;
  const b = (first + i1) * 3;
  const ax = points[a];
  const ay = points[a + 1];
  const az = points[a + 2];
  const bx = points[b];
  const by = points[b + 1];
  const bz = points[b + 2];
  outPos.setXYZ(ax + (bx - ax) * frac, ay + (by - ay) * frac, az + (bz - az) * frac);
  outDir.setXYZ(bx - ax, by - ay, bz - az);
  const len = outDir.magnitude;
  if (len > 1e-8) {
    outDir.scaleBy(1 / len);
  } else {
    outDir.setXYZ(0, 1, 0);
  }
}

/**
 * Chooses a reference axis that is not parallel to `dir`.
 * @internal
 */
function pickReferenceAxis(dir: Vector3, out: Vector3) {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ax <= ay && ax <= az) {
    out.setXYZ(1, 0, 0);
  } else if (ay <= az) {
    out.setXYZ(0, 1, 0);
  } else {
    out.setXYZ(0, 0, 1);
  }
}
