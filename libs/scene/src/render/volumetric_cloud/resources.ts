import type { Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture3D
} from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { cloudPerlinFbm, cloudPerlinWorley, cloudWorleyFbm, cloudWorleyNoise } from './cloud_noise';

/** Edge of the base shape volume, [Schneider15]: 128^3 Perlin-Worley + Worley fbm. */
export const CLOUD_BASE_NOISE_SIZE = 128;
/** Edge of the detail volume, [Schneider15]: 32^3 Worley fbm. */
export const CLOUD_DETAIL_NOISE_SIZE = 32;
/** Edge of the generated weather map. */
export const CLOUD_WEATHER_MAP_SIZE = 512;

/*
 * Lattice frequencies of the generated volumes. The base volume follows 3dVXDc (Worley fbm at 4,
 * 8 and 16 cells, Perlin-Worley at 4). The detail volume keeps the same texels per cell, i.e. a
 * quarter of the frequency for a quarter of the resolution.
 */
const BASE_FREQ = 4;
const DETAIL_FREQ = 1;
/*
 * Cloud map of Nubis 2017 (slides 54-59): a low frequency noise modulates coverage where air
 * masses allow clouds, higher frequency noises make the footprints of the clouds; Perlin footprints
 * give connected formations (R). Broad single-octave Worley footprints form the isolated
 * islands (G); this shoulder replaces the original narrow Perlin-Worley peaks. B is the type.
 */
/** Footprints: 64 km / 8, about 8 km at the default scale */
const WEATHER_FOOTPRINT_FREQ = 8;
/** Broad isolated footprints: four cells per weather period, with a smooth radial falloff. */
const WEATHER_ISOLATED_FREQ = 4;
/** Air mass modulation: 64 km / 2 */
const WEATHER_MODULATION_FREQ = 2;
const WEATHER_TYPE_FREQ = 2;
/**
 * 16-quantiles of the raw connected coverage (Perlin footprints x modulation), measured over 40000
 * samples of a CPU replica of the generator. Mapping a value through this table (its empirical
 * CDF) makes the stored coverage uniform on [0, 1].
 */
const WEATHER_CONNECTED_QUANTILES = [
  0.0496, 0.1364, 0.1608, 0.1791, 0.1944, 0.2076, 0.2193, 0.2309, 0.2431, 0.255, 0.2684, 0.2829, 0.3, 0.3216,
  0.3513, 0.3956, 0.6949
];

/** Piecewise linear empirical CDF: a sum of one ramp per quantile interval. */
function empiricalCDF(scope: PBInsideFunctionScope, v: PBShaderExp, quantiles: number[]) {
  const pb = scope.$builder;
  const n = quantiles.length - 1;
  let sum: PBShaderExp | number = 0;
  for (let i = 0; i < n; i++) {
    const lo = quantiles[i];
    const hi = quantiles[i + 1];
    sum = pb.add(sum, pb.mul(pb.clamp(pb.div(pb.sub(v, lo), Math.max(hi - lo, 1e-6)), 0, 1), 1 / n));
  }
  return sum as PBShaderExp;
}

type VolumeKind = 'base' | 'detail';

let baseProgram: Nullable<GPUProgram> = null;
let detailProgram: Nullable<GPUProgram> = null;
let weatherProgram: Nullable<GPUProgram> = null;
let atlasProgram: Nullable<GPUProgram> = null;

/**
 * Integer seed offset of the hash lattice. Whole cells keep the generated volumes periodic; the
 * primes decorrelate the axes.
 */
function seedOffset(seed: number) {
  return new Vector3(seed * 1031, seed * 2053, seed * 4099);
}

function getVolumeProgram(kind: VolumeKind) {
  const cached = kind === 'base' ? baseProgram : detailProgram;
  if (cached) {
    return cached;
  }
  const program = getDevice().buildComputeProgram({
    label: kind === 'base' ? 'CloudBaseNoise' : 'CloudDetailNoise',
    workgroupSize: [4, 4, 4],
    compute(pb) {
      this.dst = pb.texStorage3D.rgba8unorm().storage(0);
      // (size, freq, 0, 0)
      this.params = pb.vec4().uniform(0);
      this.seed = pb.vec3().uniform(0);
      pb.main(function () {
        this.$l.size = pb.uint(this.params.x);
        this.$if(pb.all(pb.lessThan(this.$builtins.globalInvocationId, pb.uvec3(this.size))), function () {
          this.$l.p = pb.div(pb.add(pb.vec3(this.$builtins.globalInvocationId), pb.vec3(0.5)), this.params.x);
          this.$l.freq = this.params.y;
          this.$l.w0 = cloudWorleyFbm(this, this.p, this.freq, this.seed);
          this.$l.w1 = cloudWorleyFbm(this, this.p, pb.mul(this.freq, 2), this.seed);
          this.$l.w2 = cloudWorleyFbm(this, this.p, pb.mul(this.freq, 4), this.seed);
          if (kind === 'base') {
            // R: Perlin-Worley, GBA: Worley fbm of increasing frequency
            // Four Perlin octaves: 4..32 cells fit at least four texels per cell in 128^3.
            // Weather uses independent frequencies and octave counts below.
            this.$l.r = cloudPerlinWorley(this, this.p, this.freq, this.w0, this.seed, 4);
            this.$l.value = pb.vec4(this.r, this.w0, this.w1, this.w2);
          } else {
            // RGB: Worley fbm of increasing frequency
            this.$l.value = pb.vec4(this.w0, this.w1, this.w2, 1);
          }
          pb.textureStore(
            this.dst,
            this.$builtins.globalInvocationId,
            pb.clamp(this.value, pb.vec4(0), pb.vec4(1))
          );
        });
      });
    }
  })!;
  if (kind === 'base') {
    baseProgram = program;
  } else {
    detailProgram = program;
  }
  return program;
}

function getWeatherProgram() {
  if (!weatherProgram) {
    weatherProgram = getDevice().buildComputeProgram({
      label: 'CloudWeatherMap',
      workgroupSize: [8, 8, 1],
      compute(pb) {
        this.dst = pb.texStorage2D.rgba8unorm().storage(0);
        // (size, footprint freq, type freq, modulation freq)
        this.params = pb.vec4().uniform(0);
        this.seed = pb.vec3().uniform(0);
        pb.main(function () {
          this.$l.size = pb.uint(this.params.x);
          this.$if(
            pb.all(pb.lessThan(this.$builtins.globalInvocationId.xy, pb.uvec2(this.size))),
            function () {
              // A z = 0 slice of the periodic volume noise tiles in x and y
              this.$l.p = pb.vec3(
                pb.div(pb.add(pb.vec2(this.$builtins.globalInvocationId.xy), pb.vec2(0.5)), this.params.x),
                0
              );
              // Unlike [Schneider15]'s G precipitation, this map stores isolated coverage in G.
              // Coverage decides where clouds form, as the coverage data field of Nubis does
              // (Schneider, Nubis3, SIGGRAPH 2023, slide 19: dimensional_profile = vertical_profile *
              // cloud_coverage). Inverted Worley cells make separate clouds, a low frequency fbm
              // gathers them into fields with clear sky between.
              this.$l.modulation = pb.clamp(
                pb.add(pb.mul(cloudPerlinFbm(this, this.p, this.params.w, 4, this.seed), 0.5), 0.5),
                0,
                1
              );
              this.$l.connectedRaw = pb.mul(
                pb.clamp(
                  pb.add(pb.mul(cloudPerlinFbm(this, this.p, this.params.y, 4, this.seed), 0.5), 0.5),
                  0,
                  1
                ),
                this.modulation
              );
              // A single broad Worley cell gives each island a continuous shoulder. Ranking
              // narrow Perlin-Worley peaks through a CDF made the shoulders too steep and
              // extruded them into columns. Keep the zero gaps and radial falloff here;
              // the 3D base volume supplies the smaller billows.
              this.$l.isolated = pb.mul(
                pb.smoothStep(
                  0.35,
                  0.95,
                  cloudWorleyNoise(
                    this,
                    pb.mul(this.p, WEATHER_ISOLATED_FREQ),
                    pb.float(WEATHER_ISOLATED_FREQ),
                    this.seed
                  )
                ),
                pb.smoothStep(0.15, 0.65, this.modulation)
              );
              this.$l.connected = empiricalCDF(this, this.connectedRaw, WEATHER_CONNECTED_QUANTILES);
              // The fbm stays well inside +-0.5, so +0.5 alone spans the 0 (stratus) to 1 (cumulus)
              // range; halving it as well left nearly every texel at stratocumulus
              this.$l.cloudType = pb.add(cloudPerlinFbm(this, this.p, this.params.z, 4, this.seed), 0.5);
              pb.textureStore(
                this.dst,
                this.$builtins.globalInvocationId.xy,
                pb.clamp(pb.vec4(this.connected, this.isolated, this.cloudType, 1), pb.vec4(0), pb.vec4(1))
              );
            }
          );
        });
      }
    })!;
  }
  return weatherProgram;
}

function getAtlasProgram() {
  if (!atlasProgram) {
    atlasProgram = getDevice().buildComputeProgram({
      label: 'CloudVolumeFromAtlas',
      workgroupSize: [4, 4, 4],
      compute(pb) {
        this.src = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.dst = pb.texStorage3D.rgba8unorm().storage(0);
        // (slice edge, slices per atlas row, 0, 0)
        this.params = pb.vec4().uniform(0);
        pb.main(function () {
          this.$l.edge = pb.uint(this.params.x);
          this.$l.cols = pb.uint(this.params.y);
          this.$l.id = this.$builtins.globalInvocationId;
          this.$if(pb.all(pb.lessThan(this.id, pb.uvec3(this.edge))), function () {
            // Slice z sits in atlas column z % cols, row z / cols, rows running down
            this.$l.texel = pb.add(
              pb.mul(pb.uvec2(pb.mod(this.id.z, this.cols), pb.div(this.id.z, this.cols)), this.edge),
              this.id.xy
            );
            pb.textureStore(this.dst, this.id, pb.textureLoad(this.src, pb.ivec2(this.texel), 0));
          });
        });
      }
    })!;
  }
  return atlasProgram;
}

/**
 * Slice layout of a 2D atlas holding a cubic volume: N slices of N x N texels in a grid of
 * `cols` x `rows` slices, so that N^3 = width * height. Null when the size is no such layout.
 * @internal
 */
export function getVolumeAtlasLayout(width: number, height: number) {
  const edge = Math.round(Math.cbrt(width * height));
  if (edge < 1 || width % edge !== 0 || height % edge !== 0) {
    return null;
  }
  const cols = width / edge;
  const rows = height / edge;
  return cols * rows === edge ? { edge, cols, rows } : null;
}

/**
 * Noise volumes and weather map of the volumetric clouds.
 *
 * Each is generated on the GPU when no texture was assigned, or converted from the assigned
 * texture: the noise volumes are imported as 2D atlases of their slices (see
 * {@link getVolumeAtlasLayout}), the weather map is used as is. Generation runs once per seed;
 * every volume gets a full mip chain.
 *
 * @internal
 */
export class VolumetricCloudResources extends Disposable {
  private readonly _baseNoise: DRef<Texture3D>;
  private readonly _detailNoise: DRef<Texture3D>;
  private readonly _weatherMap: DRef<Texture2D>;
  private readonly _baseNoiseSource: DRef<Texture2D>;
  private readonly _detailNoiseSource: DRef<Texture2D>;
  private readonly _weatherMapSource: DRef<Texture2D>;
  /** Seed and source the current textures were made from; -1 when not made yet. */
  private _baseSeed: number;
  private _detailSeed: number;
  private _weatherSeed: number;
  private _baseFrom: Nullable<Texture2D>;
  private _detailFrom: Nullable<Texture2D>;
  /** One bind group per program, so dispatches recorded in one frame never share one. */
  private readonly _bindGroups: Map<GPUProgram, BindGroup>;
  constructor() {
    super();
    this._baseNoise = new DRef();
    this._detailNoise = new DRef();
    this._weatherMap = new DRef();
    this._baseNoiseSource = new DRef();
    this._detailNoiseSource = new DRef();
    this._weatherMapSource = new DRef();
    this._baseSeed = -1;
    this._detailSeed = -1;
    this._weatherSeed = -1;
    this._baseFrom = null;
    this._detailFrom = null;
    this._bindGroups = new Map();
  }
  /** Imported base shape volume as a slice atlas, or null to generate it. */
  get baseNoiseSource() {
    return this._baseNoiseSource.get();
  }
  set baseNoiseSource(tex: Nullable<Texture2D>) {
    this._baseNoiseSource.set(tex);
  }
  /** Imported detail volume as a slice atlas, or null to generate it. */
  get detailNoiseSource() {
    return this._detailNoiseSource.get();
  }
  set detailNoiseSource(tex: Nullable<Texture2D>) {
    this._detailNoiseSource.set(tex);
  }
  /** Imported weather map, or null to generate it. */
  get weatherMapSource() {
    return this._weatherMapSource.get();
  }
  set weatherMapSource(tex: Nullable<Texture2D>) {
    this._weatherMapSource.set(tex);
  }
  /** Base shape volume, valid after {@link VolumetricCloudResources.update}. */
  get baseNoise() {
    return this._baseNoise.get();
  }
  /** Detail volume, valid after {@link VolumetricCloudResources.update}. */
  get detailNoise() {
    return this._detailNoise.get();
  }
  /** Weather map, valid after {@link VolumetricCloudResources.update}. */
  get weatherMap() {
    return this._weatherMapSource.get() ?? this._weatherMap.get();
  }
  /** Makes or remakes whatever is missing or out of date. */
  update(seed: number) {
    this._updateVolume('base', seed);
    this._updateVolume('detail', seed);
    if (!this._weatherMapSource.get() && (this._weatherSeed !== seed || !this._weatherMap.get())) {
      this._generateWeatherMap(seed);
      this._weatherSeed = seed;
    }
  }
  protected onDispose() {
    super.onDispose();
    this._baseNoise.dispose();
    this._detailNoise.dispose();
    this._weatherMap.dispose();
    this._baseNoiseSource.dispose();
    this._detailNoiseSource.dispose();
    this._weatherMapSource.dispose();
    for (const bindGroup of this._bindGroups.values()) {
      bindGroup.dispose();
    }
    this._bindGroups.clear();
  }
  private _updateVolume(kind: VolumeKind, seed: number) {
    const target = kind === 'base' ? this._baseNoise : this._detailNoise;
    const source = (kind === 'base' ? this._baseNoiseSource : this._detailNoiseSource).get();
    const from = kind === 'base' ? this._baseFrom : this._detailFrom;
    const madeSeed = kind === 'base' ? this._baseSeed : this._detailSeed;
    let layout = source ? getVolumeAtlasLayout(source.width, source.height) : null;
    if (source && !layout) {
      console.error(
        `Volumetric cloud ${kind} noise: ${source.width}x${source.height} is not an atlas of N slices of NxN texels, using generated noise`
      );
      layout = null;
    }
    if (layout && source) {
      if (from !== source || !target.get()) {
        this._fromAtlas(
          target,
          source,
          layout.edge,
          layout.cols,
          kind === 'base' ? 'CloudBaseNoise(Imported)' : 'CloudDetailNoise(Imported)'
        );
        this._setMade(kind, -1, source);
      }
    } else if (from || madeSeed !== seed || !target.get()) {
      this._generateVolume(kind, target, seed);
      this._setMade(kind, seed, null);
    }
  }
  private _setMade(kind: VolumeKind, seed: number, from: Nullable<Texture2D>) {
    if (kind === 'base') {
      this._baseSeed = seed;
      this._baseFrom = from;
    } else {
      this._detailSeed = seed;
      this._detailFrom = from;
    }
  }
  private _ensureVolume(target: DRef<Texture3D>, edge: number, name: string) {
    let tex = target.get();
    if (!tex || tex.width !== edge) {
      tex = getDevice().createTexture3D('rgba8unorm', edge, edge, edge, {
        writable: true,
        samplerOptions: {
          addressU: 'repeat',
          addressV: 'repeat',
          addressW: 'repeat',
          magFilter: 'linear',
          minFilter: 'linear',
          mipFilter: 'linear'
        }
      })!;
      target.set(tex);
    }
    tex.name = name;
    return tex;
  }
  private _dispatch(
    program: GPUProgram,
    setup: (bindGroup: BindGroup) => void,
    x: number,
    y: number,
    z: number
  ) {
    const device = getDevice();
    let bindGroup = this._bindGroups.get(program);
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._bindGroups.set(program, bindGroup);
    }
    setup(bindGroup);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.compute(x, y, z);
  }
  private _generateVolume(kind: VolumeKind, target: DRef<Texture3D>, seed: number) {
    const edge = kind === 'base' ? CLOUD_BASE_NOISE_SIZE : CLOUD_DETAIL_NOISE_SIZE;
    const tex = this._ensureVolume(target, edge, kind === 'base' ? 'CloudBaseNoise' : 'CloudDetailNoise');
    const groups = Math.ceil(edge / 4);
    this._dispatch(
      getVolumeProgram(kind),
      (bindGroup) => {
        bindGroup.setTextureView('dst', tex, 0, 0, 1);
        bindGroup.setValue('params', new Vector4(edge, kind === 'base' ? BASE_FREQ : DETAIL_FREQ, 0, 0));
        bindGroup.setValue('seed', seedOffset(seed));
      },
      groups,
      groups,
      groups
    );
    tex.generateMipmaps();
  }
  private _fromAtlas(target: DRef<Texture3D>, source: Texture2D, edge: number, cols: number, name: string) {
    const tex = this._ensureVolume(target, edge, name);
    const groups = Math.ceil(edge / 4);
    this._dispatch(
      getAtlasProgram(),
      (bindGroup) => {
        bindGroup.setTexture('src', source, fetchSampler('clamp_nearest_nomip'));
        bindGroup.setTextureView('dst', tex, 0, 0, 1);
        bindGroup.setValue('params', new Vector4(edge, cols, 0, 0));
      },
      groups,
      groups,
      groups
    );
    tex.generateMipmaps();
  }
  private _generateWeatherMap(seed: number) {
    let tex = this._weatherMap.get();
    if (!tex) {
      tex = getDevice().createTexture2D('rgba8unorm', CLOUD_WEATHER_MAP_SIZE, CLOUD_WEATHER_MAP_SIZE, {
        samplerOptions: { addressU: 'repeat', addressV: 'repeat' }
      })!;
      this._weatherMap.set(tex);
    }
    tex.name = 'CloudWeatherMap';
    const groups = Math.ceil(CLOUD_WEATHER_MAP_SIZE / 8);
    this._dispatch(
      getWeatherProgram(),
      (bindGroup) => {
        bindGroup.setTextureView('dst', tex, 0, 0, 1);
        bindGroup.setValue(
          'params',
          new Vector4(
            CLOUD_WEATHER_MAP_SIZE,
            WEATHER_FOOTPRINT_FREQ,
            WEATHER_TYPE_FREQ,
            WEATHER_MODULATION_FREQ
          )
        );
        bindGroup.setValue('seed', seedOffset(seed));
      },
      groups,
      groups,
      1
    );
    tex.generateMipmaps();
  }
}
