import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * The detail layer blend of the clipmap terrain, the only definition of it: the material's live
 * path and the runtime virtual texture page fill both go through these, so the two cannot drift.
 * The callers differ only in how a layer texture is sampled (screen derivatives when shading,
 * the page texel footprint when filling).
 */

/**
 * Samples layer `layer` of a detail texture at the already scaled detail uv. `ddx`/`ddy` are the
 * gradients of that uv when known (sample with them), null to sample with implicit derivatives.
 */
export type TerrainLayerSampler = (
  scope: PBInsideFunctionScope,
  layer: number,
  uv: PBShaderExp,
  ddx: PBShaderExp | null,
  ddy: PBShaderExp | null
) => PBShaderExp;

/** Gradients of the terrain uv across one pixel (or one page texel) */
export interface TerrainUVGrad {
  ddx: PBShaderExp;
  ddy: PBShaderExp;
}

/** Layers using hex tiling, see terrainHexTile */
export interface TerrainHexTiling {
  /** Bit i set: layer i uses hex tiling */
  mask: number;
  /** Per layer (rotation amount, scale amount, contrast, 0) */
  params: PBShaderExp;
}

/** Number of splat mask vectors for `numLayers` detail layers, 4 weights each */
export function terrainSplatMaskCount(numLayers: number) {
  return (numLayers + 3) >> 2;
}

/** Splat weight of a layer */
function weight(masks: PBShaderExp[], layer: number) {
  return masks[layer >> 2][layer & 3] as PBShaderExp;
}

function useHex(hex: TerrainHexTiling | null, grad: TerrainUVGrad | null, layer: number) {
  return !!hex && !!grad && (hex.mask & (1 << layer)) !== 0;
}

function terrainHexTile(
  scope: PBInsideFunctionScope,
  prefix: string,
  coord: PBShaderExp,
  rotationAmount: PBShaderExp,
  scaleAmount: PBShaderExp
) {
  const pb = scope.$builder;
  pb.func('zTerrainHexHash', [pb.vec2('p')], function () {
    // https://www.shadertoy.com/view/4djSRW, mx_hextile_hash
    this.$l.p3 = pb.fract(pb.mul(pb.vec3(this.p.x, this.p.y, this.p.x), pb.vec3(0.1031, 0.103, 0.0973)));
    this.p3 = pb.add(this.p3, pb.vec3(pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33)))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xx, this.p3.yz), this.p3.zy)));
  });
  pb.func(
    'zTerrainHexTile',
    [
      pb.vec2('coord'),
      pb.float('rotation'),
      pb.float('scale'),
      pb.vec2('c1').out(),
      pb.vec2('c2').out(),
      pb.vec2('c3').out(),
      pb.vec3('w').out(),
      pb.vec3('r').out(),
      pb.vec3('s').out()
    ],
    function () {
      const sqrt3x2 = Math.sqrt(3) * 2;
      // scale to keep the original fit, then skew into the simplex triangle grid
      // (GLSL mat2(1, 0, -0.57735027, 1.15470054) * st)
      this.$l.st = pb.mul(this.coord, sqrt3x2);
      this.$l.skewed = pb.vec2(
        pb.sub(this.st.x, pb.mul(this.st.y, 0.57735027)),
        pb.mul(this.st.y, 1.15470054)
      );
      this.$l.f = pb.fract(this.skewed);
      this.$l.z = pb.sub(pb.sub(1, this.f.x), this.f.y);
      this.$l.sv = pb.step(0, pb.neg(this.z));
      this.$l.s2 = pb.sub(pb.mul(this.sv, 2), 1);
      this.w = pb.vec3(
        pb.mul(pb.neg(this.z), this.s2),
        pb.sub(this.sv, pb.mul(this.f.y, this.s2)),
        pb.sub(this.sv, pb.mul(this.f.x, this.s2))
      );
      // vertex ids and hexagon centres (GLSL mat2(1, 0, 0.5, 1 / 1.15470054) * id)
      this.$l.base = pb.floor(this.skewed);
      this.$l.id1 = pb.add(this.base, pb.vec2(this.sv, this.sv));
      this.$l.id2 = pb.add(this.base, pb.vec2(this.sv, pb.sub(1, this.sv)));
      this.$l.id3 = pb.add(this.base, pb.vec2(pb.sub(1, this.sv), this.sv));
      const centre = (id: PBShaderExp) =>
        pb.div(pb.vec2(pb.add(id.x, pb.mul(id.y, 0.5)), pb.div(id.y, 1.15470054)), sqrt3x2);
      this.$l.ctr1 = centre(this.id1);
      this.$l.ctr2 = centre(this.id2);
      this.$l.ctr3 = centre(this.id3);
      this.$l.rand1 = this.zTerrainHexHash(pb.add(this.id1, pb.vec2(0.12345)));
      this.$l.rand2 = this.zTerrainHexHash(pb.add(this.id2, pb.vec2(0.12345)));
      this.$l.rand3 = this.zTerrainHexHash(pb.add(this.id3, pb.vec2(0.12345)));
      // rotation range 0..360 degrees, scale range 0.5..2, offset range 0..1 at amount 1
      this.$l.rv = pb.mul(
        pb.vec3(this.rand1.x, this.rand2.x, this.rand3.x),
        pb.mul(this.rotation, Math.PI * 2)
      );
      this.$l.sv3 = pb.mix(
        pb.vec3(1),
        pb.mix(pb.vec3(0.5), pb.vec3(2), pb.vec3(this.rand1.y, this.rand2.y, this.rand3.y)),
        pb.vec3(this.scale)
      );
      // ((coord - ctr) * rm / scale) + ctr + offset; GLSL v * mat2(c, -s, s, c) rotates v by +r
      const rotate = (v: PBShaderExp, r: PBShaderExp) =>
        pb.vec2(
          pb.sub(pb.mul(v.x, pb.cos(r)), pb.mul(v.y, pb.sin(r))),
          pb.add(pb.mul(v.x, pb.sin(r)), pb.mul(v.y, pb.cos(r)))
        );
      this.c1 = pb.add(
        pb.add(pb.div(rotate(pb.sub(this.coord, this.ctr1), this.rv.x), this.sv3.x), this.ctr1),
        this.rand1
      );
      this.c2 = pb.add(
        pb.add(pb.div(rotate(pb.sub(this.coord, this.ctr2), this.rv.y), this.sv3.y), this.ctr2),
        this.rand2
      );
      this.c3 = pb.add(
        pb.add(pb.div(rotate(pb.sub(this.coord, this.ctr3), this.rv.z), this.sv3.z), this.ctr3),
        this.rand3
      );
      this.r = this.rv;
      this.s = this.sv3;
    }
  );
  for (const name of ['C1', 'C2', 'C3']) {
    scope.$l[`${prefix}${name}`] = pb.vec2();
  }
  for (const name of ['W', 'R', 'S']) {
    scope.$l[`${prefix}${name}`] = pb.vec3();
  }
  pb.getGlobalScope().zTerrainHexTile(
    coord,
    rotationAmount,
    scaleAmount,
    scope[`${prefix}C1`],
    scope[`${prefix}C2`],
    scope[`${prefix}C3`],
    scope[`${prefix}W`],
    scope[`${prefix}R`],
    scope[`${prefix}S`]
  );
}

/** Rotates a 2D vector by `r` radians, counter clockwise */
function rotate2(scope: PBInsideFunctionScope, v: PBShaderExp, r: PBShaderExp) {
  const pb = scope.$builder;
  return pb.vec2(
    pb.sub(pb.mul(v.x, pb.cos(r)), pb.mul(v.y, pb.sin(r))),
    pb.add(pb.mul(v.x, pb.sin(r)), pb.mul(v.y, pb.cos(r)))
  );
}

/**
 * The three hex tiling samples of a layer: the gradients follow each sample's rotation and scale
 * (mx_hextile_coord ddx1..3), so the mip is chosen from the continuous coordinate and the jumps
 * at hexagon edges do not show.
 */
function sampleHexTiled(
  scope: PBInsideFunctionScope,
  prefix: string,
  layer: number,
  sample: TerrainLayerSampler,
  ddx: PBShaderExp,
  ddy: PBShaderExp
) {
  const pb = scope.$builder;
  return ([1, 2, 3] as const).map((k) => {
    const comp = (['x', 'y', 'z'] as const)[k - 1];
    const r = scope[`${prefix}R`][comp] as PBShaderExp;
    const s = scope[`${prefix}S`][comp] as PBShaderExp;
    return sample(
      scope,
      layer,
      scope[`${prefix}C${k}`],
      pb.div(rotate2(scope, ddx, r), s),
      pb.div(rotate2(scope, ddy, r), s)
    );
  });
}

/** Blend weights of the three samples: pow(barycentric, 7), normalized (mx_hextiledimage) */
function hexWeights(scope: PBInsideFunctionScope, prefix: string, colorWeights: PBShaderExp | null) {
  const pb = scope.$builder;
  let w = pb.pow(scope[`${prefix}W`], pb.vec3(7)) as PBShaderExp;
  if (colorWeights) {
    w = pb.mul(colorWeights, w);
  }
  scope.$l[`${prefix}BW`] = w;
  return pb.div(scope[`${prefix}BW`], pb.dot(scope[`${prefix}BW`], pb.vec3(1))) as PBShaderExp;
}

/**
 * Albedo: the layers weighted by the splat masks. Weights are not normalized, uncovered area
 * stays black.
 * @param detailParams - Per layer (uv scale, roughness, 0, 0)
 * @param grad - Gradients of `uv`; required for hex tiled layers, which are sampled flat otherwise
 */
export function blendTerrainAlbedo(
  scope: PBInsideFunctionScope,
  numLayers: number,
  masks: PBShaderExp[],
  uv: PBShaderExp,
  detailParams: PBShaderExp,
  sampleAlbedo: TerrainLayerSampler,
  grad: TerrainUVGrad | null = null,
  hex: TerrainHexTiling | null = null
) {
  const pb = scope.$builder;
  let color: PBShaderExp = pb.vec3(0);
  for (let i = 0; i < numLayers; i++) {
    const tiling = detailParams.at(i).x as PBShaderExp;
    const coord = pb.mul(uv, tiling);
    const ddx = grad ? pb.mul(grad.ddx, tiling) : null;
    const ddy = grad ? pb.mul(grad.ddy, tiling) : null;
    let sample: PBShaderExp;
    if (useHex(hex, grad, i)) {
      const prefix = `zHexA${i}`;
      const p = hex!.params.at(i) as PBShaderExp;
      terrainHexTile(scope, prefix, coord, p.x, p.y);
      const [c1, c2, c3] = sampleHexTiled(scope, prefix, i, sampleAlbedo, ddx!, ddy!).map((c) => c.rgb);
      scope.$l[`${prefix}A1`] = c1;
      scope.$l[`${prefix}A2`] = c2;
      scope.$l[`${prefix}A3`] = c3;
      // Luminance as weights, mix(1, luma, contrast); Rec.709 coefficients for our linear
      // working space (one of mx_hextiledimage's lumacoeffs choices)
      const luma = pb.vec3(0.2126, 0.7152, 0.0722);
      const cw = pb.mix(
        pb.vec3(1),
        pb.vec3(
          pb.dot(scope[`${prefix}A1`], luma),
          pb.dot(scope[`${prefix}A2`], luma),
          pb.dot(scope[`${prefix}A3`], luma)
        ),
        pb.vec3(p.z)
      );
      scope.$l[`${prefix}NW`] = hexWeights(scope, prefix, cw);
      const w = scope[`${prefix}NW`];
      sample = pb.add(
        pb.add(pb.mul(scope[`${prefix}A1`], w.x), pb.mul(scope[`${prefix}A2`], w.y)),
        pb.mul(scope[`${prefix}A3`], w.z)
      );
    } else {
      sample = sampleAlbedo(scope, i, coord, ddx, ddy).rgb;
    }
    color = pb.add(color, pb.mul(sample, weight(masks, i)));
  }
  return color;
}

/**
 * Tangent space detail normal: the decoded layer normals weighted by the splat masks, not
 * normalized.
 *
 * A hex tiled layer blends its three samples as mx_hextilednormalmap: each normal turned with
 * its sample, then combined as surface gradients (Mikkelsen, Surface Gradient Based Bump Mapping
 * Framework, JCGT 9(3), 2020; mx_gradient_blend_3_normals), which with the tangent space normal
 * (0, 0, 1) reduces to normalize(sum(w * n.xy / |n.z|), 1). The turn is the inverse of the
 * sample's coordinate rotation: sampling at R(r) p shows the texture turned by -r on the
 * surface, and its normals with it. (MaterialX writes mx_axis_rotation_matrix row by row into a
 * column major GLSL mat3, which turns them the other way.)
 * @param sampleNormal - Returns the raw rgb of the layer's normal map
 */
export function blendTerrainDetailNormal(
  scope: PBInsideFunctionScope,
  numLayers: number,
  masks: PBShaderExp[],
  uv: PBShaderExp,
  detailParams: PBShaderExp,
  sampleNormal: TerrainLayerSampler,
  grad: TerrainUVGrad | null = null,
  hex: TerrainHexTiling | null = null
) {
  const pb = scope.$builder;
  let normal: PBShaderExp = pb.vec3(0);
  const decode = (raw: PBShaderExp) => pb.normalize(pb.sub(pb.mul(raw, 2), pb.vec3(1)));
  for (let i = 0; i < numLayers; i++) {
    const tiling = detailParams.at(i).x as PBShaderExp;
    const coord = pb.mul(uv, tiling);
    const ddx = grad ? pb.mul(grad.ddx, tiling) : null;
    const ddy = grad ? pb.mul(grad.ddy, tiling) : null;
    let decoded: PBShaderExp;
    if (useHex(hex, grad, i)) {
      const prefix = `zHexN${i}`;
      const p = hex!.params.at(i) as PBShaderExp;
      terrainHexTile(scope, prefix, coord, p.x, p.y);
      const samples = sampleHexTiled(scope, prefix, i, sampleNormal, ddx!, ddy!);
      const comps = ['x', 'y', 'z'] as const;
      samples.forEach((raw, k) => {
        scope.$l[`${prefix}N${k}`] = decode(raw.rgb);
        const n = scope[`${prefix}N${k}`];
        const xy = rotate2(scope, n.xy, pb.neg(scope[`${prefix}R`][comps[k]]));
        // surface gradient of the turned normal against (0, 0, 1)
        scope.$l[`${prefix}G${k}`] = pb.div(xy, pb.max(pb.abs(n.z), 1e-5));
      });
      scope.$l[`${prefix}NW`] = hexWeights(scope, prefix, null);
      const w = scope[`${prefix}NW`];
      const g = pb.add(
        pb.add(pb.mul(scope[`${prefix}G0`], w.x), pb.mul(scope[`${prefix}G1`], w.y)),
        pb.mul(scope[`${prefix}G2`], w.z)
      );
      decoded = pb.normalize(pb.vec3(g, 1));
    } else {
      decoded = decode(sampleNormal(scope, i, coord, ddx, ddy).rgb);
    }
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
