import type { Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, PBShaderExp, Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import {
  applyGrassGroundOcclusion,
  blendTerrainAlbedo,
  terrainSplatMaskCount
} from '../../material/shader/terrain_blend';
import type { ClipmapTerrain } from './terrain-cm';

/** Texels along the longer side of the capture; GI only needs the low frequencies. */
const CAPTURE_SIZE = 1024;
/** Albedo of the default checker material far away, where it fades to its mean. */
const CHECKER_MEAN_ALBEDO = 0.7;

/**
 * Top-down capture of a terrain's material albedo for global illumination, after the Lumen
 * surface cache, which captures a landscape into a heightfield card seen from above
 * (LumenSceneCardCapture.cpp) and reads it where heightfield rays hit.
 *
 * One rgba8 texture over the terrain region, 1024 texels along its longer side, with mips so
 * coarse material voxels read an average. Each texel blends the detail layers by the splat map
 * as the terrain material does ({@link blendTerrainAlbedo}), with the texel step as the uv
 * gradient so the layers come from the mip of that footprint, as the runtime virtual texture
 * fills its pages. Recaptured where the splat map is edited (through
 * {@link ClipmapTerrain.invalidateRuntimeVirtualTexture}) or wholly when the layers change.
 *
 * WebGPU only.
 * @internal
 */
export class TerrainGIAlbedo extends Disposable {
  private readonly _terrain: ClipmapTerrain;
  private readonly _texture: DRef<Texture2D>;
  private _program: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  private _programKey: string;
  /** Terrain uv rectangle (u0, v0, u1, v1) waiting to be recaptured, or null */
  private _dirty: Nullable<[number, number, number, number]>;
  private _contentVersion: number;
  private _contentParams: Float32Array<ArrayBuffer>;
  private readonly _params: Vector4;
  constructor(terrain: ClipmapTerrain) {
    super();
    this._terrain = terrain;
    this._texture = new DRef();
    this._program = null;
    this._bindGroup = null;
    this._programKey = '';
    this._dirty = [0, 0, 1, 1];
    this._contentVersion = -1;
    this._contentParams = new Float32Array(0);
    this._params = new Vector4();
  }
  /** The capture, null before the first {@link TerrainGIAlbedo.update} */
  get texture() {
    return this._texture.get() ?? null;
  }
  /** Marks a world XZ rectangle, or the whole terrain, for recapture */
  invalidate(x0?: number, z0?: number, x1?: number, z1?: number) {
    let rect: [number, number, number, number] = [0, 0, 1, 1];
    if (x0 !== undefined && z0 !== undefined && x1 !== undefined && z1 !== undefined) {
      const region = this._terrain.worldRegion;
      const sx = region.z - region.x;
      const sz = region.w - region.y;
      if (!(sx > 0 && sz > 0)) {
        return;
      }
      rect = [
        Math.max(0, (Math.min(x0, x1) - region.x) / sx),
        Math.max(0, (Math.min(z0, z1) - region.y) / sz),
        Math.min(1, (Math.max(x0, x1) - region.x) / sx),
        Math.min(1, (Math.max(z0, z1) - region.y) / sz)
      ];
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) {
        return;
      }
    }
    const d = this._dirty;
    this._dirty = d
      ? [Math.min(d[0], rect[0]), Math.min(d[1], rect[1]), Math.max(d[2], rect[2]), Math.max(d[3], rect[3])]
      : rect;
  }
  /**
   * Recaptures what changed since the last call.
   * @returns The world XZ rectangle (x0, z0, x1, z1) recaptured, or null when nothing was
   */
  update(): Nullable<[number, number, number, number]> {
    const material = this._terrain.material;
    if (!material) {
      return null;
    }
    this.ensureTexture();
    this.syncContent();
    const dirty = this._dirty;
    if (!dirty) {
      return null;
    }
    this._dirty = null;
    const texture = this._texture.get()!;
    const numLayers = material.numDetailMaps;
    const hexMask = numLayers > 0 ? material.hexTilingMask : 0;
    const key = `${numLayers}:${hexMask}`;
    if (!this._program || this._programKey !== key) {
      this.releaseProgram();
      this._program = createCaptureProgram(numLayers, hexMask);
      this._bindGroup = getDevice().createBindGroup(this._program.bindGroupLayouts[0]);
      this._programKey = key;
    }
    // Texel rectangle covering the dirty uv rectangle
    const w = texture.width;
    const h = texture.height;
    const tx0 = Math.max(0, Math.floor(dirty[0] * w));
    const ty0 = Math.max(0, Math.floor(dirty[1] * h));
    const tx1 = Math.min(w, Math.ceil(dirty[2] * w));
    const ty1 = Math.min(h, Math.ceil(dirty[3] * h));
    if (tx1 <= tx0 || ty1 <= ty0) {
      return null;
    }
    const bindGroup = this._bindGroup!;
    bindGroup.setTextureView('dst', texture, 0, 0, 1);
    this._params.setXYZW(w, h, tx0, ty0);
    bindGroup.setValue('params', this._params);
    if (numLayers > 0) {
      const splatMap = material.getSplatMap()!;
      bindGroup.setTexture('splatMap', splatMap, fetchSampler('clamp_linear'));
      bindGroup.setTexture('detailAlbedoMap', material.detailMapArray!, fetchSampler('repeat_linear'));
      bindGroup.setValue('detailParams', material.detailMapParams.subarray(0, numLayers * 4));
      if (hexMask) {
        bindGroup.setValue('detailHexParams', material.detailHexParams.subarray(0, numLayers * 4));
      }
      bindGroup.setValue('splatSize', splatMap.width);
      bindGroup.setTexture(
        'grassOcclusion',
        material.grassOcclusionTexture,
        fetchSampler('clamp_linear_nomip')
      );
    }
    const device = getDevice();
    device.setProgram(this._program);
    device.setBindGroup(0, bindGroup);
    device.compute(Math.ceil((tx1 - tx0) / 8), Math.ceil((ty1 - ty0) / 8), 1);
    texture.generateMipmaps();
    const region = this._terrain.worldRegion;
    const sx = region.z - region.x;
    const sz = region.w - region.y;
    return [
      region.x + (tx0 / w) * sx,
      region.y + (ty0 / h) * sz,
      region.x + (tx1 / w) * sx,
      region.y + (ty1 / h) * sz
    ];
  }
  /** Sized to the region's aspect, 1024 texels along the longer side */
  private ensureTexture() {
    const region = this._terrain.worldRegion;
    const sx = Math.max(region.z - region.x, 1e-6);
    const sz = Math.max(region.w - region.y, 1e-6);
    const w = sx >= sz ? CAPTURE_SIZE : Math.max(1, Math.round((CAPTURE_SIZE * sx) / sz));
    const h = sz >= sx ? CAPTURE_SIZE : Math.max(1, Math.round((CAPTURE_SIZE * sz) / sx));
    const tex = this._texture.get();
    if (!tex || tex.width !== w || tex.height !== h) {
      const created = getDevice().createTexture2D('rgba8unorm', w, h)!;
      created.name = '@TerrainGIAlbedo';
      this._texture.set(created);
      this._dirty = [0, 0, 1, 1];
    }
  }
  /** A full recapture when the layers, their parameters or the textures changed */
  private syncContent() {
    const material = this._terrain.material!;
    const numLayers = material.numDetailMaps;
    const current = new Float32Array(numLayers * 8 + 2);
    current.set(material.detailMapParams.subarray(0, numLayers * 4));
    current.set(material.detailHexParams.subarray(0, numLayers * 4), numLayers * 4);
    current[numLayers * 8] = numLayers;
    current[numLayers * 8 + 1] = numLayers > 0 ? material.hexTilingMask : 0;
    let changed =
      this._contentVersion !== material.contentVersion || current.length !== this._contentParams.length;
    for (let i = 0; i < current.length && !changed; i++) {
      changed = current[i] !== this._contentParams[i];
    }
    if (changed) {
      this._contentParams = current;
      this._contentVersion = material.contentVersion;
      this._dirty = [0, 0, 1, 1];
    }
  }
  private releaseProgram() {
    this._bindGroup?.dispose();
    this._bindGroup = null;
    this._program?.dispose();
    this._program = null;
  }
  protected onDispose() {
    super.onDispose();
    this._texture.dispose();
    this.releaseProgram();
  }
}

function createCaptureProgram(numLayers: number, hexMask: number) {
  return getDevice().buildComputeProgram({
    label: `TerrainGIAlbedo${numLayers}_${hexMask}`,
    workgroupSize: [8, 8, 1],
    compute(pb) {
      this.dst = pb.texStorage2D.rgba8unorm().storage(0);
      // (width, height, first texel x, first texel y)
      this.params = pb.vec4().uniform(0);
      if (numLayers > 0) {
        this.splatMap = pb.tex2DArray().uniform(0);
        this.detailAlbedoMap = pb.tex2DArray().uniform(0);
        this.detailParams = pb.vec4[numLayers]().uniform(0);
        if (hexMask) {
          this.detailHexParams = pb.vec4[numLayers]().uniform(0);
        }
        this.splatSize = pb.float().uniform(0);
        this.grassOcclusion = pb.tex2D().uniform(0);
      }
      pb.main(function () {
        this.$l.size = pb.vec2(this.params.xy);
        this.$l.texel = pb.add(pb.vec2(this.$builtins.globalInvocationId.xy), this.params.zw);
        this.$if(pb.all(pb.lessThan(this.texel, this.size)), function () {
          if (numLayers === 0) {
            pb.textureStore(this.dst, pb.uvec2(this.texel), pb.vec4(pb.vec3(CHECKER_MEAN_ALBEDO), 1));
            return;
          }
          this.$l.uv = pb.div(pb.add(this.texel, pb.vec2(0.5)), this.size);
          // As TerrainVirtualTexture fills a level: the texel step stands for the screen
          // derivatives, so splat and detail layers come from the mip of the texel footprint
          this.$l.splatLod = pb.max(pb.log2(pb.div(this.splatSize, pb.min(this.size.x, this.size.y))), 0);
          const masks: PBShaderExp[] = [];
          for (let i = 0; i < terrainSplatMaskCount(numLayers); i++) {
            this.$l[`mask${i}`] = pb.textureArraySampleLevel(this.splatMap, this.uv, i, this.splatLod);
            masks.push(this[`mask${i}`]);
          }
          const grad = {
            ddx: pb.vec2(pb.div(1, this.size.x), 0),
            ddy: pb.vec2(0, pb.div(1, this.size.y))
          };
          const hex = hexMask ? { mask: hexMask, params: this.detailHexParams as PBShaderExp } : null;
          this.$l.albedo = blendTerrainAlbedo(
            this,
            numLayers,
            masks,
            this.uv,
            this.detailParams,
            (s, i, uv, ddx, ddy) => pb.textureArraySampleGrad(s.detailAlbedoMap, uv, i, ddx!, ddy!),
            grad,
            hex
          );
          this.albedo = applyGrassGroundOcclusion(this, this.albedo, this.grassOcclusion, this.uv);
          pb.textureStore(
            this.dst,
            pb.uvec2(this.texel),
            pb.vec4(pb.clamp(this.albedo, pb.vec3(0), pb.vec3(1)), 1)
          );
        });
      });
    }
  })!;
}
