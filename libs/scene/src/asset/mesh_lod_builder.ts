// Builds the level of detail chain of a mesh, for the editor's derived mesh cache and
// for SharedModel.generateLods at runtime. Pure data work with the simplifier passed in,
// no other engine module imported, so it also runs in the editor's encoding worker.

/**
 * The subset of meshoptimizer's MeshoptSimplifier the level of detail generation uses. The engine
 * does not ship the simplifier: pass meshoptimizer's, which `loadMeshoptSimplifier()` of the
 * loaders package returns.
 * @public
 */
export interface MeshSimplifier {
  simplify(
    indices: Uint32Array,
    positions: Float32Array,
    positionsStride: number,
    targetIndexCount: number,
    targetError: number,
    flags?: string[]
  ): [Uint32Array, number];
  simplifyWithAttributes(
    indices: Uint32Array,
    positions: Float32Array,
    positionsStride: number,
    attributes: Float32Array,
    attributesStride: number,
    attributeWeights: number[],
    vertexLock: Uint8Array | null,
    targetIndexCount: number,
    targetError: number,
    flags?: string[]
  ): [Uint32Array, number];
}

/**
 * How levels of detail are generated, see {@link MeshImportSettings} for the same settings of the
 * editor.
 * @public
 */
export interface MeshLodSettings {
  /** Fewest triangles a generated level may have; the level count follows from it */
  lodMinTriangles: number;
  /** Fraction of the source triangles kept per level step */
  lodReduction: number;
  /** Pixel error the automatic switch distances allow */
  lodPixelError: number;
}

/**
 * A generated level of detail.
 * @public
 */
export interface MeshLodLevel {
  indexStart: number;
  indexCount: number;
  screenSize: number;
  hysteresis: number;
  /** Largest distance between the level and the source surface, in mesh units */
  error: number;
}

const MAX_LEVELS = 8;
const LOD0_SCREEN_SIZE = 2;
const AUTO_LOD_POWER_BASE = 0.75;
const LOD_HYSTERESIS = 0.02;
/**
 * Weight of the vertex normals in the simplification error. The meshoptimizer README advises
 * "around 1.0" for normalized attributes; texture seams are kept from the index topology alone.
 */
const NORMAL_WEIGHT = 1;
/** An error bound the simplifier never reaches, within float range */
const NO_ERROR_LIMIT = 1e30;

function calculateViewDistance(maxDeviation: number, pixelError: number) {
  return (maxDeviation * 960) / Math.max(pixelError, Number.EPSILON);
}

function autoScreenSize(sphereRadius: number, viewDistance: number) {
  const screenMultiple = Math.max(0.5, (0.5 * 1920) / 1080);
  const screenRadius = (screenMultiple * sphereRadius) / Math.max(0.01, viewDistance);
  return screenRadius * 2;
}

/**
 * Simplifies a triangle list into a level of detail chain. Returns the indices of every level
 * back to back, the source first, and the level table. Levels are added while the next target
 * keeps at least `lodMinTriangles` triangles, as getMeshLodTargets in the engine predicts; the
 * chain ends early when simplification stops removing triangles or falls below that minimum.
 *
 * @param simplifier - meshoptimizer's simplifier, ready
 * @param indices - Source triangle list
 * @param positions - 3 floats per vertex
 * @param normals - 3 floats per vertex, or null
 * @param sphereRadius - Radius of the sphere around the mesh bounds, as the runtime measures it
 * @param settings - Level settings
 * @public
 */
export function buildLodChain(
  simplifier: MeshSimplifier,
  indices: Uint32Array,
  positions: Float32Array,
  normals: Float32Array | null,
  sphereRadius: number,
  settings: MeshLodSettings
) {
  const chains: Uint32Array[] = [indices];
  const levels: MeshLodLevel[] = [
    { indexStart: 0, indexCount: indices.length, screenSize: LOD0_SCREEN_SIZE, hysteresis: 0, error: 0 }
  ];
  let indexStart = indices.length;
  const minIndices = Math.max(settings.lodMinTriangles, 1) * 3;
  for (let i = 1; i < MAX_LEVELS; i++) {
    const target = Math.floor((indices.length * settings.lodReduction ** i) / 3) * 3;
    if (target < minIndices) {
      break;
    }
    const flags = ['ErrorAbsolute', 'Prune'];
    const [lod, error] = normals
      ? simplifier.simplifyWithAttributes(
          indices,
          positions,
          3,
          normals,
          3,
          [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT],
          null,
          target,
          NO_ERROR_LIMIT,
          flags
        )
      : simplifier.simplify(indices, positions, 3, target, NO_ERROR_LIMIT, flags);
    // No progress over the previous level: nothing coarser can follow either
    if (lod.length === 0 || lod.length >= chains[chains.length - 1].length) {
      break;
    }
    // Pruning disconnected parts can overshoot the target; every later target is smaller still
    if (lod.length < minIndices) {
      break;
    }
    const previous = levels[levels.length - 1];
    let screenSize =
      error > 0
        ? autoScreenSize(sphereRadius, calculateViewDistance(error, settings.lodPixelError) + sphereRadius)
        : AUTO_LOD_POWER_BASE ** i;
    if (screenSize > previous.screenSize) {
      screenSize = previous.screenSize / 2;
    }
    chains.push(lod);
    levels.push({ indexStart, indexCount: lod.length, screenSize, hysteresis: LOD_HYSTERESIS, error });
    indexStart += lod.length;
  }
  const all = new Uint32Array(indexStart);
  let offset = 0;
  for (const chain of chains) {
    all.set(chain, offset);
    offset += chain.length;
  }
  return { indices: all, levels };
}
