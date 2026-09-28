import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * The detail layer blend of the clipmap terrain, the only definition of it: the material's live
 * path and the runtime virtual texture page fill both go through these, so the two cannot drift.
 * The callers differ only in how a layer texture is sampled (screen derivatives when shading,
 * an explicit LOD from the page texel footprint when filling).
 */

/** Samples layer `layer` of a detail texture at the already scaled detail uv */
export type TerrainLayerSampler = (
  scope: PBInsideFunctionScope,
  layer: number,
  uv: PBShaderExp
) => PBShaderExp;

/** Number of splat mask vectors for `numLayers` detail layers, 4 weights each */
export function terrainSplatMaskCount(numLayers: number) {
  return (numLayers + 3) >> 2;
}

/** Splat weight of a layer */
function weight(masks: PBShaderExp[], layer: number) {
  return masks[layer >> 2][layer & 3] as PBShaderExp;
}

/**
 * Albedo: the layers weighted by the splat masks. Weights are not normalized, uncovered area
 * stays black.
 * @param detailParams - Per layer (uv scale, roughness, 0, 0)
 */
export function blendTerrainAlbedo(
  scope: PBInsideFunctionScope,
  numLayers: number,
  masks: PBShaderExp[],
  uv: PBShaderExp,
  detailParams: PBShaderExp,
  sampleAlbedo: TerrainLayerSampler
) {
  const pb = scope.$builder;
  let color: PBShaderExp = pb.vec3(0);
  for (let i = 0; i < numLayers; i++) {
    const sample = sampleAlbedo(scope, i, pb.mul(uv, detailParams.at(i).x)).rgb;
    color = pb.add(color, pb.mul(sample, weight(masks, i)));
  }
  return color;
}

/**
 * Tangent space detail normal: the decoded layer normals weighted by the splat masks, not
 * normalized.
 * @param sampleNormal - Returns the raw rgb of the layer's normal map
 */
export function blendTerrainDetailNormal(
  scope: PBInsideFunctionScope,
  numLayers: number,
  masks: PBShaderExp[],
  uv: PBShaderExp,
  detailParams: PBShaderExp,
  sampleNormal: TerrainLayerSampler
) {
  const pb = scope.$builder;
  let normal: PBShaderExp = pb.vec3(0);
  for (let i = 0; i < numLayers; i++) {
    const raw = sampleNormal(scope, i, pb.mul(uv, detailParams.at(i).x)).rgb;
    const decoded = pb.normalize(pb.sub(pb.mul(raw, 2), pb.vec3(1)));
    normal = pb.add(normal, pb.mul(decoded, weight(masks, i)));
  }
  return normal;
}

/**
 * Roughness: the layer roughness weighted by the splat masks, whatever the layers leave
 * uncovered keeps `base`, the material roughness.
 */
export function blendTerrainRoughness(
  scope: PBInsideFunctionScope,
  numLayers: number,
  masks: PBShaderExp[],
  detailParams: PBShaderExp,
  base: PBShaderExp
) {
  const pb = scope.$builder;
  let weightSum: PBShaderExp = pb.float(0);
  let roughness: PBShaderExp = pb.float(0);
  for (let i = 0; i < numLayers; i++) {
    const w = weight(masks, i);
    weightSum = pb.add(weightSum, w);
    roughness = pb.add(roughness, pb.mul(w, detailParams.at(i).y));
  }
  return pb.add(roughness, pb.mul(pb.max(pb.sub(1, weightSum), 0), base)) as PBShaderExp;
}
