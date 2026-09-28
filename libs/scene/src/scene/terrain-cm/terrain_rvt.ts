import type { Nullable } from '@zephyr3d/base';
import { Disposable, Vector2, Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  TextureSampler
} from '@zephyr3d/device';
import type { DrawContext, RenderQueue, VirtualTextureClient } from '../../render';
import { VirtualTexture, virtualMipChain } from '../../render/virtualtexture/virtual_texture';
import { ShaderHelper } from '../../material/shader/helper';
import {
  blendTerrainAlbedo,
  blendTerrainDetailNormal,
  blendTerrainRoughness,
  terrainSplatMaskCount
} from '../../material/shader/terrain_blend';
import { fetchSampler } from '../../utility/misc';
import { getDevice } from '../../app/api';
import type { ClipmapTerrain } from './terrain-cm';

/**
 * Options of a terrain runtime virtual texture
 * @public
 */
export interface TerrainVirtualTextureOptions {
  /**
   * Virtual size in texels along the longer side of the terrain, a power of two. The shorter
   * side gets the power of two closest to the terrain aspect (UE RVT TileCount x TileSize with
   * per axis tile counts from the volume aspect). Default 32768.
   */
  virtualSize?: number;
  /** Page size in texels, default 128 */
  pageSize?: number;
  /** Physical atlas size in texels, default 4096 (961 pages, two rgba8 planes, 128 MB) */
  atlasSize?: number;
  /** Pages filled per update, default 16 */
  allocBudget?: number;
}

/**
 * Marking only takes pixels whose depth lies on the terrain: within this fraction of the view
 * distance of the height map (plus TOLERANCE_MIN_CELLS height map cells). Objects in front of
 * the terrain would otherwise request pages under them at their own footprint. The clipmap mesh
 * only matches the height map at its vertices, and its cells grow with distance, hence the
 * distance scaled tolerance. UE needs none of this: its feedback is written by the terrain's own
 * pixels.
 */
const TOLERANCE_DISTANCE_SCALE = 0.02;
const TOLERANCE_MIN_CELLS = 2;
const BORDER = 4;

/**
 * The runtime virtual texture of a clipmap terrain: the detail layers blended once per page
 * instead of per pixel, following UE's landscape runtime virtual texture.
 *
 * - Content: UE's BaseColor_Normal_Roughness material type, uncompressed (RuntimeVirtualTexture.cpp
 *   GetLayerFormat, VirtualTextureMaterial.usf): plane 0 the sRGB encoded base color, plane 1
 *   (normal.x, roughness, normal.z) of the world space normal, its up component rebuilt positive.
 *   The normal includes the height map slopes, so height edits invalidate too (UE
 *   ULandscapeInfo::DirtyRuntimeVirtualTextureForLandscapeArea).
 * - Mapping: virtual uv is the terrain region uv, the world XZ projection (VirtualTextureWorldToUV).
 * - Fill: a compute pass evaluates the terrain blend per texel, border texels included; UE draws
 *   the landscape with an orthographic top view widened by the border
 *   (RuntimeVirtualTextureProducer.cpp, RuntimeVirtualTextureRender.cpp RenderPage). Textures are
 *   sampled at the LOD of the page texel footprint, what the hardware picks for that view.
 * - Marking: from this camera's depth, see markFromDepth.
 *
 * WebGPU only.
 * @internal
 */
export class TerrainVirtualTexture extends Disposable implements VirtualTextureClient {
  private readonly _terrain: ClipmapTerrain;
  private readonly _options: Required<TerrainVirtualTextureOptions>;
  private _vt: VirtualTexture;
  private _fillProgram: Nullable<GPUProgram>;
  private _fillBindGroup: Nullable<BindGroup>;
  private _fillLayers: number;
  private _markProgram: Nullable<GPUProgram>;
  private _markBindGroup: Nullable<BindGroup>;
  private _depthSampler: Nullable<TextureSampler>;
  /** What the resident pages were filled from, see sync() */
  private _contentVersion: number;
  private readonly _contentParams: Float32Array<ArrayBuffer>;
  private readonly _fillParams: Vector4;
  private readonly _fillSizes: Vector4;
  constructor(terrain: ClipmapTerrain, options?: TerrainVirtualTextureOptions) {
    super();
    this._terrain = terrain;
    this._options = {
      virtualSize: options?.virtualSize ?? 32768,
      pageSize: options?.pageSize ?? 128,
      atlasSize: options?.atlasSize ?? 4096,
      allocBudget: options?.allocBudget ?? 16
    };
    this._fillProgram = null;
    this._fillBindGroup = null;
    this._fillLayers = -1;
    this._markProgram = null;
    this._markBindGroup = null;
    this._depthSampler = null;
    this._contentVersion = -1;
    this._contentParams = new Float32Array(8 * 4 + 5);
    this._fillParams = new Vector4();
    this._fillSizes = new Vector4();
    this._vt = this.createVirtualTexture();
  }
  get virtualTexture() {
    return this._vt;
  }
  get options(): Readonly<Required<TerrainVirtualTextureOptions>> {
    return this._options;
  }
  isActive(_ctx: DrawContext, _renderQueue: RenderQueue) {
    return !!this._terrain.material?.virtualTextureUsed;
  }
  /**
   * Marks the resident pages covering a world XZ rectangle for refilling
   */
  invalidateWorldRegion(x0: number, z0: number, x1: number, z1: number) {
    const region = this._terrain.worldRegion;
    const sx = region.z - region.x;
    const sz = region.w - region.y;
    if (sx > 0 && sz > 0) {
      this._vt.invalidateRegion(
        (Math.min(x0, x1) - region.x) / sx,
        (Math.min(z0, z1) - region.y) / sz,
        (Math.max(x0, x1) - region.x) / sx,
        (Math.max(z0, z1) - region.y) / sz
      );
    }
  }
  invalidate() {
    this._vt.invalidate();
  }
  /**
   * Marks the pages this camera sees on the terrain, one thread per depth pixel: the world
   * position is rebuilt from the depth and projected to the terrain uv, the level comes from the
   * uv step to the neighbouring pixels (UE VirtualTextureWorldToUVDeriv + MipLevelAniso2D without
   * anisotropy, the larger axis). A neighbour off the terrain is never taken as zero footprint,
   * see plans/sparse-virtual-texture.md, phase 2.
   */
  markFromDepth(ctx: DrawContext, linearDepth: Texture2D) {
    this.sync();
    const device = getDevice();
    const camera = ctx.camera;
    const material = this._terrain.material!;
    if (!this._markProgram) {
      this._markProgram = this.createMarkProgram();
      this._markBindGroup = device.createBindGroup(this._markProgram.bindGroupLayouts[0]);
      this._depthSampler = device.createSampler({
        addressU: 'clamp',
        addressV: 'clamp',
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none'
      });
    }
    const bindGroup = this._markBindGroup!;
    const region = this._terrain.worldRegion;
    const heightMap = material.heightMap;
    const cell = Math.max((region.z - region.x) / heightMap.width, (region.w - region.y) / heightMap.height);
    const cameraPos = camera.getWorldPosition();
    this._vt.applyBindings(bindGroup);
    bindGroup.setTexture('depthTex', linearDepth, this._depthSampler!);
    bindGroup.setTexture('heightMap', heightMap, fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('invVP', camera.invViewProjectionMatrix);
    bindGroup.setValue('nearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
    bindGroup.setValue('depthSize', new Vector2(linearDepth.width, linearDepth.height));
    bindGroup.setValue('region', region);
    bindGroup.setValue(
      'markParams',
      new Vector4(this._terrain.worldMatrix.m13, material.terrainScale.y, cell * TOLERANCE_MIN_CELLS, 0)
    );
    bindGroup.setValue('cameraPos', cameraPos);
    device.setProgram(this._markProgram);
    device.setBindGroup(0, bindGroup);
    device.compute(Math.ceil(linearDepth.width / 8), Math.ceil(linearDepth.height / 8), 1);
  }
  fill(_ctx: DrawContext) {
    const material = this._terrain.material!;
    const numLayers = material.numDetailMaps;
    if (!this._fillProgram || this._fillLayers !== numLayers) {
      this._fillBindGroup?.dispose();
      this._fillProgram = this.createFillProgram(numLayers);
      this._fillBindGroup = getDevice().createBindGroup(this._fillProgram.bindGroupLayouts[0]);
      this._fillLayers = numLayers;
    }
    const bindGroup = this._fillBindGroup!;
    const region = this._terrain.worldRegion;
    const heightMap = material.heightMap;
    const splatMap = material.getSplatMap()!;
    this._fillParams.setXYZW(
      region.z - region.x,
      region.w - region.y,
      material.terrainScale.y,
      material.roughness
    );
    this._fillSizes.setXYZW(
      heightMap.width,
      heightMap.height,
      splatMap.width,
      material.detailMapArray!.width
    );
    bindGroup.setTexture('splatMap', splatMap, fetchSampler('clamp_linear'));
    bindGroup.setTexture('detailAlbedoMap', material.detailMapArray!, fetchSampler('repeat_linear'));
    bindGroup.setTexture('detailNormalMap', material.detailNormalMapArray!, fetchSampler('repeat_linear'));
    bindGroup.setValue('detailParams', material.detailMapParams.subarray(0, numLayers * 4));
    bindGroup.setTexture(
      'heightMap',
      heightMap,
      fetchSampler(heightMap.mipLevelCount > 1 ? 'clamp_linear' : 'clamp_linear_nomip')
    );
    bindGroup.setValue('fillParams', this._fillParams);
    bindGroup.setValue('fillSizes', this._fillSizes);
    this._vt.fill(this._fillProgram, bindGroup);
  }
  /**
   * Keeps the pages in step with what they are filled from: a new virtual size (region aspect)
   * rebuilds the texture, any other change refills every page. Brush edits invalidate their own
   * area through ClipmapTerrain.invalidateRuntimeVirtualTexture instead.
   */
  sync() {
    const material = this._terrain.material!;
    const [width, height] = this.virtualDimensions();
    const l0 = this._vt.levels[0];
    if (l0.pagesX * this._vt.pageSize !== width || l0.pagesY * this._vt.pageSize !== height) {
      this.rebuild();
      return;
    }
    const region = this._terrain.worldRegion;
    const params = this._contentParams;
    const current = new Float32Array(params.length);
    current.set(material.detailMapParams.subarray(0, 32));
    current.set(
      [
        material.numDetailMaps,
        material.roughness,
        region.z - region.x,
        region.w - region.y,
        material.terrainScale.y
      ],
      32
    );
    let changed = this._contentVersion !== material.contentVersion;
    for (let i = 0; i < params.length && !changed; i++) {
      changed = params[i] !== current[i];
    }
    if (changed) {
      params.set(current);
      this._contentVersion = material.contentVersion;
      this._vt.invalidate();
    }
  }
  /** Recreates the virtual texture, e.g. after the options or the terrain aspect changed */
  rebuild() {
    this._vt.dispose();
    this._markProgram = null;
    this._markBindGroup?.dispose();
    this._markBindGroup = null;
    this._fillProgram = null;
    this._fillBindGroup?.dispose();
    this._fillBindGroup = null;
    this._contentVersion = -1;
    this._vt = this.createVirtualTexture();
    const material = this._terrain.material;
    if (material) {
      material.virtualTexture = this._vt;
    }
  }
  setOptions(options: TerrainVirtualTextureOptions) {
    Object.assign(this._options, options);
    this.rebuild();
  }
  private virtualDimensions(): [number, number] {
    const size = this._options.virtualSize;
    const region = this._terrain.worldRegion;
    const sx = Math.max(region.z - region.x, 1e-6);
    const sz = Math.max(region.w - region.y, 1e-6);
    // The shorter side by the power of two closest to the aspect, at least one page
    const ratio = 2 ** Math.round(Math.log2(Math.max(sx, sz) / Math.min(sx, sz)));
    const shorter = Math.max(this._options.pageSize, size / ratio);
    return sx >= sz ? [size, shorter] : [shorter, size];
  }
  private createVirtualTexture() {
    const [width, height] = this.virtualDimensions();
    return new VirtualTexture(getDevice(), {
      levels: virtualMipChain(width, height, this._options.pageSize),
      pageSize: this._options.pageSize,
      border: BORDER,
      atlasSize: this._options.atlasSize,
      planes: [
        { name: 'baseColor', format: 'rgba8unorm' },
        { name: 'normalRoughness', format: 'rgba8unorm' }
      ],
      allocBudget: this._options.allocBudget,
      residencyMipBias: true
    });
  }
  private createMarkProgram() {
    const vt = this._vt;
    return getDevice().buildComputeProgram({
      label: 'TerrainVirtualTextureMark',
      workgroupSize: [8, 8, 1],
      compute(pb) {
        vt.declareBindings(this, 0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.heightMap = pb.tex2D().uniform(0);
        this.invVP = pb.mat4().uniform(0);
        this.nearFar = pb.vec2().uniform(0);
        this.depthSize = pb.vec2().uniform(0);
        this.region = pb.vec4().uniform(0);
        // (terrain origin y, height scale, minimum height tolerance, 0)
        this.markParams = pb.vec4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        // (terrain uv, 1) at a pixel whose depth lies on the terrain, z = 0 otherwise
        pb.func('terrainUV', [pb.ivec2('p')], function () {
          this.$l.d = pb.textureLoad(this.depthTex, this.p, 0).r;
          this.$l.nonLinear = ShaderHelper.linearNormalizedToNonLinearDepth(this, this.d, this.nearFar);
          this.$l.screenUV = pb.div(pb.add(pb.vec2(this.p), pb.vec2(0.5)), this.depthSize);
          this.$l.clip = pb.vec4(
            pb.sub(pb.mul(this.screenUV, 2), pb.vec2(1)),
            ShaderHelper.deviceDepthToClipZ(this, pb.clamp(this.nonLinear, 0, 1)),
            1
          );
          this.$l.w = pb.mul(this.invVP, this.clip);
          this.$l.pos = pb.div(this.w.xyz, this.w.w);
          this.$l.uv = pb.div(pb.sub(this.pos.xz, this.region.xy), pb.sub(this.region.zw, this.region.xy));
          this.$l.h = pb.add(
            this.markParams.x,
            pb.mul(pb.textureSampleLevel(this.heightMap, this.uv, 0).r, this.markParams.y)
          );
          this.$l.tolerance = pb.max(
            this.markParams.z,
            pb.mul(pb.distance(this.pos, this.cameraPos), TOLERANCE_DISTANCE_SCALE)
          );
          this.$l.onTerrain = pb.and(
            pb.and(
              pb.lessThan(this.d, 0.9999),
              pb.lessThanEqual(pb.abs(pb.sub(this.pos.y, this.h)), this.tolerance)
            ),
            pb.and(
              pb.all(pb.greaterThanEqual(this.uv, pb.vec2(0))),
              pb.all(pb.lessThanEqual(this.uv, pb.vec2(1)))
            )
          );
          this.$return(pb.vec3(this.uv, pb.float(this.onTerrain)));
        });
        // Change of the terrain uv to the next pixel along `step`, forward if that pixel is on
        // the terrain, else backward: (duv, 1), or (0, 0, 0) when neither neighbour is
        pb.func('axisDelta', [pb.ivec2('p'), pb.ivec2('step'), pb.vec2('uv')], function () {
          this.$l.size = pb.ivec2(this.depthSize);
          this.$l.f = pb.add(this.p, this.step);
          this.$if(
            pb.and(pb.lessThan(this.f.x, this.size.x), pb.lessThan(this.f.y, this.size.y)),
            function () {
              this.$l.nf = this.terrainUV(this.f);
              this.$if(pb.notEqual(this.nf.z, 0), function () {
                this.$return(pb.vec3(pb.sub(this.nf.xy, this.uv), 1));
              });
            }
          );
          this.$l.b = pb.sub(this.p, this.step);
          this.$if(pb.and(pb.greaterThanEqual(this.b.x, 0), pb.greaterThanEqual(this.b.y, 0)), function () {
            this.$l.nb = this.terrainUV(this.b);
            this.$if(pb.notEqual(this.nb.z, 0), function () {
              this.$return(pb.vec3(pb.sub(this.uv, this.nb.xy), 1));
            });
          });
          this.$return(pb.vec3(0));
        });
        pb.main(function () {
          this.$l.p = pb.ivec2(this.$builtins.globalInvocationId.xy);
          this.$l.size = pb.ivec2(this.depthSize);
          this.$if(
            pb.or(pb.greaterThanEqual(this.p.x, this.size.x), pb.greaterThanEqual(this.p.y, this.size.y)),
            function () {
              this.$return();
            }
          );
          this.$l.c = this.terrainUV(this.p);
          this.$if(pb.equal(this.c.z, 0), function () {
            this.$return();
          });
          // An axis without a neighbour on the terrain uses the other axis alone, a pixel
          // without any is not marked (it resolves to a resident ancestor)
          this.$l.ax = this.axisDelta(this.p, pb.ivec2(1, 0), this.c.xy);
          this.$l.ay = this.axisDelta(this.p, pb.ivec2(0, 1), this.c.xy);
          this.$if(pb.equal(pb.add(this.ax.z, this.ay.z), 0), function () {
            this.$return();
          });
          this.$l.dx = pb.select(this.ay.xy, this.ax.xy, pb.notEqual(this.ax.z, 0));
          this.$l.dy = pb.select(this.ax.xy, this.ay.xy, pb.notEqual(this.ay.z, 0));
          this.$l.level = pb.uint(pb.floor(vt.levelFromFootprint(this, this.dx, this.dy)));
          vt.request(this as PBInsideFunctionScope, this.level as PBShaderExp, this.c.xy as PBShaderExp);
        });
      }
    })!;
  }
  /**
   * The page fill: the same blend as the material's live path (terrain_blend.ts), each texture
   * sampled at the LOD of one texel of the page's level, and the height map tangent frame of
   * ClipmapTerrainMaterial.calculateTerrainTBN on the same footprint.
   */
  private createFillProgram(numLayers: number) {
    const vt = this._vt;
    return vt.createFillProgram(
      `TerrainVirtualTextureFill${numLayers}`,
      (scope) => {
        const pb = scope.$builder;
        scope.splatMap = pb.tex2DArray().uniform(0);
        scope.detailAlbedoMap = pb.tex2DArray().uniform(0);
        scope.detailNormalMap = pb.tex2DArray().uniform(0);
        scope.detailParams = pb.vec4[numLayers]().uniform(0);
        scope.heightMap = pb.tex2D().uniform(0);
        // (region width, region depth, height scale, material roughness)
        scope.fillParams = pb.vec4().uniform(0);
        // (height map width, height map height, splat map size, detail map size)
        scope.fillSizes = pb.vec4().uniform(0);
      },
      (scope, level, texel) => {
        const pb = scope.$builder;
        scope.$l.levelTexels = vt.levelTexels(scope, level);
        scope.$l.uv = pb.div(texel, scope.levelTexels);
        // Terrain uv covered by one texel of this level
        scope.$l.footprint = pb.div(1, pb.min(scope.levelTexels.x, scope.levelTexels.y));
        scope.$l.splatLod = pb.max(pb.log2(pb.mul(scope.footprint, scope.fillSizes.z)), 0);
        const masks: PBShaderExp[] = [];
        for (let i = 0; i < terrainSplatMaskCount(numLayers); i++) {
          scope.$l[`mask${i}`] = pb.textureArraySampleLevel(scope.splatMap, scope.uv, i, scope.splatLod);
          masks.push(scope[`mask${i}`]);
        }
        const detailLod = (s: PBInsideFunctionScope, i: number) =>
          pb.max(pb.log2(pb.mul(s.footprint, s.detailParams.at(i).x, s.fillSizes.w)), 0);
        scope.$l.albedo = blendTerrainAlbedo(
          scope,
          numLayers,
          masks,
          scope.uv,
          scope.detailParams,
          (s, i, uv) => pb.textureArraySampleLevel(s.detailAlbedoMap, uv, i, detailLod(s, i))
        );
        scope.$l.detailNormal = blendTerrainDetailNormal(
          scope,
          numLayers,
          masks,
          scope.uv,
          scope.detailParams,
          (s, i, uv) => pb.textureArraySampleLevel(s.detailNormalMap, uv, i, detailLod(s, i))
        );
        scope.$l.roughness = blendTerrainRoughness(
          scope,
          numLayers,
          masks,
          scope.detailParams,
          scope.fillParams.w
        );
        // Height map tangent frame, ClipmapTerrainMaterial.calculateTerrainTBN
        scope.$l.heightLod = pb.max(
          pb.log2(pb.max(pb.mul(scope.footprint, pb.max(scope.fillSizes.x, scope.fillSizes.y)), 0.0001)),
          0
        );
        scope.$l.offset = pb.mul(
          pb.div(pb.vec2(1), scope.fillSizes.xy),
          pb.mul(pb.exp2(scope.heightLod), 0.5)
        );
        const height = (uv: PBShaderExp) => pb.textureSampleLevel(scope.heightMap, uv, scope.heightLod).r;
        scope.$l.hL = height(pb.sub(scope.uv, pb.vec2(scope.offset.x, 0)));
        scope.$l.hR = height(pb.add(scope.uv, pb.vec2(scope.offset.x, 0)));
        scope.$l.hU = height(pb.sub(scope.uv, pb.vec2(0, scope.offset.y)));
        scope.$l.hD = height(pb.add(scope.uv, pb.vec2(0, scope.offset.y)));
        scope.$l.sampleDist = pb.mul(scope.fillParams.xy, pb.mul(scope.offset, 2));
        scope.$l.dHdU = pb.div(pb.mul(pb.sub(scope.hR, scope.hL), scope.fillParams.z), scope.sampleDist.x);
        scope.$l.dHdV = pb.div(pb.mul(pb.sub(scope.hD, scope.hU), scope.fillParams.z), scope.sampleDist.y);
        scope.$l.t = pb.normalize(pb.vec3(1, scope.dHdU, 0));
        scope.$l.b = pb.normalize(pb.vec3(0, scope.dHdV, 1));
        scope.$l.n = pb.normalize(pb.cross(scope.b, scope.t));
        scope.$l.normal = pb.normalize(pb.mul(pb.mat3(scope.t, scope.b, scope.n), scope.detailNormal));
        // PackNormal and LinearToSrgb (VirtualTextureMaterial.usf)
        scope.$l.packed = pb.add(pb.mul(scope.normal, 127 / 255), pb.vec3(127 / 255));
        scope.$l.srgb = pb.mix(
          pb.sub(pb.mul(pb.pow(scope.albedo, pb.vec3(1 / 2.4)), 1.055), pb.vec3(0.055)),
          pb.mul(scope.albedo, 12.92),
          pb.vec3(pb.lessThanEqual(scope.albedo, pb.vec3(0.0031308)))
        );
        return [
          pb.vec4(pb.clamp(scope.srgb, pb.vec3(0), pb.vec3(1)), 1),
          pb.vec4(scope.packed.x, scope.roughness, scope.packed.z, 1)
        ];
      }
    );
  }
  protected onDispose() {
    super.onDispose();
    this._vt.dispose();
    this._markBindGroup?.dispose();
    this._fillBindGroup?.dispose();
  }
}
