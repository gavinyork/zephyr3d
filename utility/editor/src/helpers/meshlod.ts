// Builds the level of detail chain of a mesh for the derived mesh cache. Pure data
// work with the simplifier passed in, so it runs in the encoding worker and in unit
// tests alike.
//
// Follows UE static mesh LODs: every level is reduced from the source mesh
// (BaseReduceLodIndex 0) to a fraction of its triangles, and the switch sizes come
// from the reduction error (StaticMesh.cpp, FStaticMeshRenderData::ResolveSectionInfo
// with bAutoComputeLODScreenSize). Levels share the source vertices: meshoptimizer
// simplification only writes a new index buffer, so skins and morph targets, which
// address vertices by position in the buffer, stay valid.

/** The subset of meshoptimizer's MeshoptSimplifier used here */
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

export interface MeshLodSettings {
  /** Levels including the source, 1 or more */
  lodCount: number;
  /** Fraction of the source triangles kept per level step */
  lodReduction: number;
  /** UE ReductionSettings.PixelError */
  lodPixelError: number;
}

export interface MeshLodLevel {
  indexStart: number;
  indexCount: number;
  screenSize: number;
  hysteresis: number;
  /** Largest distance between the level and the source surface, in mesh units */
  error: number;
}

/** UE StaticMesh.cpp Constants::LOD0ScreenSize */
const LOD0_SCREEN_SIZE = 2;
/** UE StaticMesh.cpp Constants::AutoComputeLODPowerBase, used when a level has no measured error */
const AUTO_LOD_POWER_BASE = 0.75;
/** UE FSkeletalMeshLODInfo::LODHysteresis given to generated levels (SkeletalMesh.cpp) */
const LOD_HYSTERESIS = 0.02;
/**
 * Weight of the vertex normals in the simplification error. The meshoptimizer README advises
 * "around 1.0" for normalized attributes; texture seams are kept from the index topology alone.
 */
const NORMAL_WEIGHT = 1;
/** An error bound the simplifier never reaches, within float range */
const NO_ERROR_LIMIT = 1e30;

/**
 * UE CalculateViewDistance (StaticMesh.cpp): the view distance at which a deviation projects to
 * the allowed pixel error on a 1920 wide view with a 90 degree horizontal field of view.
 */
export function calculateViewDistance(maxDeviation: number, pixelError: number) {
  return (maxDeviation * 960) / Math.max(pixelError, Number.EPSILON);
}

/**
 * UE ComputeBoundsScreenSize (SceneManagement.cpp) for the projection UE builds the automatic
 * sizes with: FPerspectiveMatrix(PI / 4, 1920, 1080, 1), whose (0, 0) and (1, 1) are 1 and
 * 1920 / 1080. UE clamps the distance to 1 cm, here 0.01 mesh units.
 */
export function autoScreenSize(sphereRadius: number, viewDistance: number) {
  const screenMultiple = Math.max(0.5, (0.5 * 1920) / 1080);
  const screenRadius = (screenMultiple * sphereRadius) / Math.max(0.01, viewDistance);
  return screenRadius * 2;
}

/**
 * Simplifies a triangle list into a level of detail chain. Returns the indices of every level
 * back to back, the source first, and the level table; levels that would not remove triangles
 * are dropped, so the chain may be shorter than asked.
 *
 * @param simplifier - meshoptimizer's simplifier, ready
 * @param indices - Source triangle list
 * @param positions - 3 floats per vertex
 * @param normals - 3 floats per vertex, or null
 * @param sphereRadius - Radius of the sphere around the mesh bounds, as the runtime measures it
 * @param settings - Level settings
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
  for (let i = 1; i < settings.lodCount; i++) {
    const target = Math.floor((indices.length * settings.lodReduction ** i) / 3) * 3;
    if (target < 3) {
      break;
    }
    // Reduced to the target count alone, UE's percent triangles criterion: the error bound is
    // never reached. ErrorAbsolute returns the error in mesh units, UE's MaxDeviation.
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
    const previous = levels[levels.length - 1];
    let screenSize =
      error > 0
        ? autoScreenSize(sphereRadius, calculateViewDistance(error, settings.lodPixelError) + sphereRadius)
        : AUTO_LOD_POWER_BASE ** i;
    // UE keeps automatic sizes decreasing from level to level
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
