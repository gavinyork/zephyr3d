import type { AABB, Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, PRNG, Vector2, Vector4 } from '@zephyr3d/base';
import type { WaveGenerator } from './wavegenerator';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D,
  Texture2DArray,
  TextureCreationOptions,
  TextureFormat,
  TextureSampler
} from '@zephyr3d/device';
import { Primitive } from './primitive';
import {
  createProgramFFT2H,
  createProgramFFT2V,
  createProgramH0,
  createProgramHk,
  createProgramPostFFT2
} from '../shaders';
import { fetchSampler } from '../utility/misc';
import { getDevice } from '../app/api';

type OceanFieldCascade = {
  /** How "croppy" this pattern would be */
  croppiness: number;
  /** Strength factor for this pattern */
  strength: number;
};

type OceanFieldBuildParams = {
  /** Size of generated texture. Must be power of 2 */
  resolution: number;
  /** Ocean field sub-pattern options. */
  cascades: [OceanFieldCascade, OceanFieldCascade, OceanFieldCascade];
  /** Wind vector. Module correspond to wind force. */
  wind: Vector2;
  /** Parameter for waves motion. 0 means no wave motion */
  alignment: number;
  /** Foam parameters */
  foamParams: Vector2;
  /** Seed of random generator */
  randomSeed: number;
};

/**
 * Size of the largest cascade over the peak wavelength of the spectrum,
 * 2 pi sqrt(2) U^2 / g for the Phillips spectrum at wind speed U: the peak
 * repeats some 14 times across it, and the band below it, where no wave
 * height is left, stays out of every cascade.
 */
const CASCADE_PEAK_SPAN = 14;
/**
 * Size of a cascade over that of the next smaller one. Each covers the
 * wavelengths between the next larger one's Nyquist and its own, about three
 * octaves at this ratio; not an integer, so the tiles of the cascades do not
 * repeat in step.
 */
const CASCADE_RATIO = 7.5;
/** Sizes of the largest cascade are kept within, in meters. */
const CASCADE_MIN_SIZE = 16;
const CASCADE_MAX_SIZE = 16384;

function getDefaultBuildParams(): OceanFieldBuildParams {
  return {
    cascades: [
      {
        strength: 0.4,
        croppiness: -1.5
      },
      {
        strength: 0.4,
        croppiness: -1.2
      },
      {
        strength: 0.4,
        croppiness: -0.5
      }
    ],
    resolution: 256,
    wind: new Vector2(2, 2),
    alignment: 1,
    foamParams: new Vector2(1.2, 7.2),
    randomSeed: 0
  };
}

type Programs = {
  h0Program: GPUProgram;
  hkProgram: Nullable<GPUProgram>;
  hkProgram2: Nullable<GPUProgram>;
  hkProgram4: Nullable<GPUProgram>;
  fft2hProgram: Nullable<GPUProgram>;
  fft2hProgram2: Nullable<GPUProgram>;
  fft2hProgram4: Nullable<GPUProgram>;
  fft2vProgram: Nullable<GPUProgram>;
  fft2vProgram2: Nullable<GPUProgram>;
  fft2vProgram4: Nullable<GPUProgram>;
  postfft2Program: Nullable<GPUProgram>;
  postfft2Program2: Nullable<GPUProgram>;
  postfft2Program4: Nullable<GPUProgram>;
};

type Globales = {
  programs: Programs;
  quad: Primitive;
  /** Keyed `${size}:${randomSeed}`, since both select the contents. */
  noiseTextures: Map<string, Texture2D>;
  butterflyTextures: Map<number, Texture2D>;
  slopeSampler?: TextureSampler;
};

type WaterInstanceData = {
  h0Framebuffer: Nullable<FrameBuffer>;
  h0Textures: Texture2D[] | Texture2DArray;
  spectrumFramebuffer: Nullable<FrameBuffer>;
  spectrumFramebuffer2: Nullable<FrameBuffer>;
  spectrumFramebuffer4: Nullable<FrameBuffer>;
  spectrumTextures: Texture2D[] | Texture2DArray;
  pingpongFramebuffer: Nullable<FrameBuffer>;
  pingpongFramebuffer2: Nullable<FrameBuffer>;
  pingpongFramebuffer4: Nullable<FrameBuffer>;
  pingpongTextures: Texture2D[] | Texture2DArray;
  postIfft2Framebuffer: Nullable<FrameBuffer>;
  postIfft2Framebuffer2: Nullable<FrameBuffer>;
  postIfft2Framebuffer4: Nullable<FrameBuffer>;
  dataTextures: Texture2D[] | Texture2DArray;
};

const RENDER_NONE = 0;
const RENDER_NORMAL = 1;
const RENDER_TWO_PASS = 2;

const THREAD_GROUP_SIZE = 16;

/**
 * Mip levels of a cascade over which the share of its slope variance kept is
 * tabulated (levels 1 to this); level 0 keeps it all, the level past the table
 * none.
 */
const SLOPE_LOD_LEVELS = 8;
/**
 * Anisotropy of the slope sampling. At 1 the mip level follows the pixel's
 * long axis: soft at grazing views, but the finest near the camera. Higher
 * picks it from the short axis, and the few taps the hardware takes along the
 * long one leave the shortest waves to alias into speckle close by.
 */
const SLOPE_MAX_ANISOTROPY = 1;
/**
 * Scale of the screen derivatives the slopes are filtered by, log2 of it a bias
 * of the mip level. Above 1 hides the speckle of a higher anisotropy, but
 * softens the near waves by as much.
 */
const SLOPE_FILTER_SCALE = 1;

/**
 * This class generates a 2D ocean field using the Fast Fourier Transform (FFT) algorithm.
 * @public
 */
export class FFTWaveGenerator extends Disposable implements WaveGenerator {
  private static _globals: Nullable<Globales> = null;
  private readonly _useComputeShader: boolean;
  private readonly _h0BindGroup!: BindGroup;
  private readonly _hkBindGroup!: Nullable<BindGroup>;
  private readonly _hkBindGroup2!: Nullable<BindGroup>;
  private readonly _hkBindGroup4!: Nullable<BindGroup>;
  private readonly _fft2hBindGroup!: Nullable<BindGroup>;
  private readonly _fft2vBindGroup!: Nullable<BindGroup>;
  private readonly _fft2hBindGroup2Used!: BindGroup[][];
  private readonly _fft2hBindGroup2Free!: BindGroup[][];
  private readonly _fft2hBindGroup4Used!: BindGroup[][];
  private readonly _fft2hBindGroup4Free!: BindGroup[][];
  private readonly _fft2vBindGroup2Used!: BindGroup[][];
  private readonly _fft2vBindGroup2Free!: BindGroup[][];
  private readonly _fft2vBindGroup4Used!: BindGroup[][];
  private readonly _fft2vBindGroup4Free!: BindGroup[][];
  private readonly _postfft2BindGroup!: Nullable<BindGroup>;
  private readonly _postfft2BindGroup2!: Nullable<BindGroup>;
  private readonly _postfft2BindGroup4!: Nullable<BindGroup>;
  private readonly _updateRenderStates!: RenderStateSet;
  private _sizes!: Vector4;
  private _croppinesses!: Vector4;
  private readonly _params!: OceanFieldBuildParams;
  private _instanceData!: Nullable<WaterInstanceData>;
  private _ifftTextures!: Nullable<Texture2D[] | Texture2DArray>;
  private readonly _cascades!: Vector4[];
  /** Per cascade: slope (var x, var z, cov xz) in world units, and its texel size */
  private readonly _slopeVariances!: Vector4[];
  /** Per cascade, two each: share of its slope variance mip levels 1-4 and 5-8 keep */
  private readonly _slopeRetained!: Float32Array<ArrayBuffer>;
  private _paramsChanged!: boolean;
  private _version!: number;
  private _resolutionChanged!: boolean;
  private readonly _textureFormat: TextureFormat;
  private readonly _h0TextureFormat: TextureFormat;
  private readonly _dataTextureFormat: TextureFormat;
  private readonly _renderMode: number;
  /**
   * Create a new instance of the FFTWaveGenerator class.
   * @param params - Ocean field build parameters. If not provided, default parameters will be used.
   */
  constructor(params?: OceanFieldBuildParams) {
    super();
    const device = getDevice();
    const renderTargetFloat16 = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer;
    const maxDrawBuffers = renderTargetFloat16 ? device.getDeviceCaps().framebufferCaps.maxDrawBuffers : 0;
    this._textureFormat = 'rgba16f';
    this._h0TextureFormat = 'rgba16f';
    this._dataTextureFormat = 'rgba16f';
    this._useComputeShader = device.type === 'webgpu';
    const maxSampleBytes = device.getDeviceCaps().framebufferCaps.maxColorAttachmentBytesPerSample;
    if (maxDrawBuffers === 0) {
      this._renderMode = RENDER_NONE;
    } else if (this._useComputeShader || maxSampleBytes >= 48) {
      this._renderMode = RENDER_NORMAL;
    } else {
      this._renderMode = RENDER_TWO_PASS;
    }
    if (this._renderMode !== RENDER_NONE) {
      FFTWaveGenerator._globals = FFTWaveGenerator._globals ?? {
        programs: {
          h0Program: createProgramH0(this._useComputeShader, THREAD_GROUP_SIZE, this._h0TextureFormat),
          hkProgram:
            this._renderMode === RENDER_NORMAL
              ? createProgramHk(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          hkProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramHk(false, 0, undefined, 2) : null,
          hkProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramHk(false, 0, undefined, 4) : null,
          fft2hProgram:
            this._renderMode === RENDER_NORMAL
              ? createProgramFFT2H(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          fft2hProgram2:
            this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(false, 0, undefined, 2) : null,
          fft2hProgram4:
            this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(false, 0, undefined, 4) : null,
          fft2vProgram:
            this._renderMode === RENDER_NORMAL
              ? createProgramFFT2V(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          fft2vProgram2:
            this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(false, 0, undefined, 2) : null,
          fft2vProgram4:
            this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(false, 0, undefined, 4) : null,
          postfft2Program:
            this._renderMode === RENDER_NORMAL
              ? createProgramPostFFT2(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          postfft2Program2:
            this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(false, 0, undefined, 2) : null,
          postfft2Program4:
            this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(false, 0, undefined, 4) : null
        },
        quad: FFTWaveGenerator.createQuad(),
        noiseTextures: new Map(),
        butterflyTextures: new Map()
      };
      this._params = params ?? getDefaultBuildParams();
      const programs = FFTWaveGenerator._globals.programs;
      this._h0BindGroup = device.createBindGroup(programs.h0Program.bindGroupLayouts[0]);
      this._hkBindGroup = programs.hkProgram
        ? device.createBindGroup(programs.hkProgram.bindGroupLayouts[0])
        : null;
      this._hkBindGroup2 = programs.hkProgram2
        ? device.createBindGroup(programs.hkProgram2.bindGroupLayouts[0])
        : null;
      this._hkBindGroup4 = programs.hkProgram4
        ? device.createBindGroup(programs.hkProgram4.bindGroupLayouts[0])
        : null;
      this._fft2hBindGroup = programs.fft2hProgram
        ? device.createBindGroup(programs.fft2hProgram.bindGroupLayouts[0])
        : null;
      this._fft2vBindGroup = programs.fft2vProgram
        ? device.createBindGroup(programs.fft2vProgram.bindGroupLayouts[0])
        : null;
      this._fft2hBindGroup2Used = [[], []];
      this._fft2hBindGroup2Free = [[], []];
      this._fft2hBindGroup4Used = [[], []];
      this._fft2hBindGroup4Free = [[], []];
      this._fft2vBindGroup2Used = [[], []];
      this._fft2vBindGroup2Free = [[], []];
      this._fft2vBindGroup4Used = [[], []];
      this._fft2vBindGroup4Free = [[], []];
      this._postfft2BindGroup = programs.postfft2Program
        ? device.createBindGroup(programs.postfft2Program.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup2 = programs.postfft2Program2
        ? device.createBindGroup(programs.postfft2Program2.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup4 = programs.postfft2Program4
        ? device.createBindGroup(programs.postfft2Program4.bindGroupLayouts[0])
        : null;
      this._instanceData = null;
      this._ifftTextures = null;
      this._sizes = new Vector4();
      this._croppinesses = new Vector4();
      this._cascades = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];
      this._slopeVariances = [new Vector4(), new Vector4(), new Vector4()];
      this._slopeRetained = new Float32Array(6 * 4);
      this._updateRenderStates = getDevice().createRenderStateSet();
      this._updateRenderStates.useRasterizerState().setCullMode('none');
      this._updateRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this._version = 0;
      this.paramsChanged();
    }
  }
  get version() {
    return this._version;
  }
  clone() {
    return new FFTWaveGenerator(this._params) as this;
  }
  private paramsChanged() {
    this._paramsChanged = true;
    this._version++;
  }
  /** Gets the wave alighment */
  get alignment() {
    return this._params.alignment;
  }
  set alignment(val) {
    if (this._params.alignment !== val) {
      this._params.alignment = val;
      this.paramsChanged();
    }
  }
  /** Gets the wind vector */
  get wind(): Immutable<Vector2> {
    return this._params.wind;
  }
  set wind(val: Immutable<Vector2>) {
    if (val !== this._params.wind && (val.x !== this._params.wind.x || val.y !== this._params.wind.y)) {
      this._params.wind.x = val.x;
      this._params.wind.y = val.y;
      this.paramsChanged();
    }
  }
  /** Gets the foam width */
  get foamWidth() {
    return this._params.foamParams.x;
  }
  set foamWidth(val) {
    if (val !== this._params.foamParams.x) {
      this._params.foamParams.x = val;
      this.paramsChanged();
    }
  }
  /** Gets the foam contrast */
  get foamContrast() {
    return this._params.foamParams.y;
  }
  set foamContrast(val) {
    if (val !== this._params.foamParams.y) {
      this._params.foamParams.y = val;
      this.paramsChanged();
    }
  }
  /**
   * Gets the size of the patch the specified cascade simulates, in meters.
   *
   * The sizes follow the wind: the largest cascade spans the peak wavelength of
   * the spectrum some times over, and each next one is a fixed fraction of it,
   * so the three cover the waves that carry height and slope at any wind speed.
   * @param cascade - The cascade index
   */
  getWaveLength(cascade: number) {
    const windSpeed = Math.hypot(this._params.wind.x, this._params.wind.y);
    const peak = (2 * Math.PI * Math.SQRT2 * windSpeed * windSpeed) / 9.81;
    const largest = Math.min(Math.max(peak * CASCADE_PEAK_SPAN, CASCADE_MIN_SIZE), CASCADE_MAX_SIZE);
    return largest / Math.pow(CASCADE_RATIO, cascade);
  }
  /** Gets the wave strength for the specified cascade */
  getWaveStrength(cascade: number) {
    return this._params.cascades[cascade].strength;
  }
  /**
   * Sets the wave strength for the specified cascade
   * @param cascade - The cascade index
   * @param strength - The new wave strength for the specified cascade
   */
  setWaveStrength(cascade: number, strength: number) {
    if (this._params.cascades[cascade].strength !== strength) {
      this._params.cascades[cascade].strength = strength;
      this.paramsChanged();
    }
  }
  /** Gets the wave croppiness for the specified cascade */
  getWaveCroppiness(cascade: number) {
    return this._params.cascades[cascade].croppiness;
  }
  /**
   * Sets the wave croppiness for the specified cascade
   * @param cascade - The cascade index
   * @param croppiness - The new wave croppiness for the specified cascade
   */
  setWaveCroppiness(cascade: number, croppiness: number) {
    if (this._params.cascades[cascade].croppiness !== croppiness) {
      this._params.cascades[cascade].croppiness = croppiness;
      this.paramsChanged();
    }
  }
  /** @internal */
  private static createQuad() {
    const vertexData = new Float32Array([
      -1, -1, 0, 0.0, 0.0, 1, -1, 0, 1.0, 0.0, 1, 1, 0, 1.0, 1.0, -1, 1, 0, 0.0, 1.0
    ]);
    const indexData = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const prim = new Primitive();
    prim.createAndSetVertexBuffer(['position_f32x3', 'tex0_f32x2'], vertexData);
    prim.createAndSetIndexBuffer(indexData);
    prim.primitiveType = 'triangle-list';
    prim.indexStart = 0;
    prim.indexCount = indexData.length;
    return prim;
  }
  /** @internal */
  private getButterflyTexture(size: number) {
    const device = getDevice();
    let tex = FFTWaveGenerator._globals!.butterflyTextures.get(size);
    if (!tex) {
      tex = device.createTexture2D('rgba32f', Math.log2(size), size, {
        mipmapping: false
      })!;
      tex.name = `butterfly${size}`;
      tex.update(this.createButterflyTexture(size), 0, 0, tex.width, tex.height);
      FFTWaveGenerator._globals!.butterflyTextures.set(size, tex);
    }
    return tex;
  }
  /** @internal */
  private generateInitialSpectrum() {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    device.setProgram(FFTWaveGenerator._globals!.programs.h0Program);
    device.setBindGroup(0, this._h0BindGroup);
    this._h0BindGroup.setTexture(
      'noise',
      this.getNoiseTexture(this._params.resolution, this._params.randomSeed),
      fetchSampler('repeat_nearest_nomip')
    );
    this._h0BindGroup.setValue('resolution', this._params.resolution);
    this._h0BindGroup.setValue('wind', this._params.wind);
    this._h0BindGroup.setValue('alignment', this._params.alignment);
    // Bands split as in Bruneton's ocean demo (and Ceto, its Unity port): each
    // cascade keeps the wave numbers outside the square |kx|, |ky| < kMin, kMin the
    // Nyquist pi N / L of the next larger cascade (pi / L for the largest), and
    // stops at its own Nyquist, so the cascades share no wave number.
    const cascades = this._params.cascades;
    for (let i = 0; i < cascades.length; i++) {
      const size = this.getWaveLength(i);
      this._cascades[i].x = size;
      this._cascades[i].y = (cascades[i].strength * 0.081) / (size * size);
      this._cascades[i].z =
        i === 0 ? Math.PI / size : (Math.PI * this._params.resolution) / this.getWaveLength(i - 1);
      this._cascades[i].w = 0;
    }
    this.computeSlopeVariances();
    this._h0BindGroup.setValue('cascade0', this._cascades[0]);
    this._h0BindGroup.setValue('cascade1', this._cascades[1]);
    this._h0BindGroup.setValue('cascade2', this._cascades[2]);
    if (device.type === 'webgpu') {
      this._h0BindGroup.setTexture('spectrum', instanceData.h0Textures as Texture2DArray);
      device.compute(
        this._params.resolution / THREAD_GROUP_SIZE,
        this._params.resolution / THREAD_GROUP_SIZE,
        1
      );
    } else {
      device.setFramebuffer(instanceData.h0Framebuffer);
      device.clearFrameBuffer(Vector4.zero(), null, null);
      FFTWaveGenerator._globals!.quad.draw();
    }
  }
  /**
   * Expected slope covariance of each cascade, summed over the same spectrum the
   * h0 and hk programs build: E|h(k)|^2 = 2 P(k) (a(k) + a(-k)), P the Phillips
   * spectrum halved as h0 takes it, a the wind alignment, and the slopes i k h(k)
   * with the Nyquist row and column zeroed. The inverse FFT is unnormalized, so
   * a field's variance is the plain sum over the grid.
   *
   * Also how much of it each mip level of the cascade keeps: a level halving the
   * texels keeps the wave numbers below its Nyquist along both axes.
   * @internal
   */
  private computeSlopeVariances() {
    const N = this._params.resolution;
    const wind = this._params.wind;
    const windLen = Math.hypot(wind.x, wind.y);
    const wx = windLen > 0 ? wind.x / windLen : 1;
    const wz = windLen > 0 ? wind.y / windLen : 0;
    const L = (windLen * windLen) / 9.81;
    const L2 = L * L;
    const alignment = this._params.alignment;
    for (let i = 0; i < 3; i++) {
      const size = this._cascades[i].x;
      const A = this._cascades[i].y;
      const minK = this._cascades[i].z;
      let xx = 0;
      let zz = 0;
      let xz = 0;
      // Variance whose wave numbers are cut first at level 1 + n
      const cut = new Array<number>(SLOPE_LOD_LEVELS + 1).fill(0);
      const nyquist = (Math.PI * N) / size;
      if (size > 1e-3 && L2 > 0) {
        const dk = (Math.PI * 2) / size;
        for (let cy = 1; cy < N; cy++) {
          const kz = (cy - N / 2) * dk;
          for (let cx = 1; cx < N; cx++) {
            const kx = (cx - N / 2) * dk;
            if (Math.abs(kx) < minK && Math.abs(kz) < minK) {
              continue;
            }
            const k2 = kx * kx + kz * kz;
            let e = (A / (k2 * k2)) * Math.exp(-1 / (k2 * L2));
            if (alignment > 0) {
              const c = (kx * wx + kz * wz) / Math.sqrt(k2);
              e *= Math.pow(Math.max(0, c), alignment) + Math.pow(Math.max(0, -c), alignment);
            } else {
              e *= 2;
            }
            xx += kx * kx * e;
            zz += kz * kz * e;
            xz += kx * kz * e;
            // Kept up to the level whose Nyquist nyquist / 2^level it still lies below
            const kept = Math.log2(nyquist / Math.max(Math.abs(kx), Math.abs(kz)));
            cut[Math.min(Math.max(Math.ceil(kept), 1), SLOPE_LOD_LEVELS + 1) - 1] += k2 * e;
          }
        }
      }
      this._slopeVariances[i].setXYZW(xx, zz, xz, size / N);
      const total = xx + zz;
      let kept = total;
      for (let level = 1; level <= SLOPE_LOD_LEVELS; level++) {
        kept -= cut[level - 1];
        this._slopeRetained[i * SLOPE_LOD_LEVELS + level - 1] = total > 0 ? Math.max(kept / total, 0) : 0;
      }
    }
  }
  /** @internal */
  private getNoiseTexture(size: number, randomSeed: number) {
    const device = getDevice();
    // Keyed on the seed as well as the size: both select the noise.
    const key = `${size}:${randomSeed}`;
    let tex = FFTWaveGenerator._globals!.noiseTextures.get(key);
    if (!tex) {
      tex = device.createTexture2D('rg32f', size, size, {
        mipmapping: false
      })!;
      tex.name = `noiseTex${size}_${randomSeed}`;
      tex.update(this.getNoise2d(size, randomSeed), 0, 0, size, size);
      FFTWaveGenerator._globals!.noiseTextures.set(key, tex);
    }
    return tex;
  }
  /** @internal */
  private getNoise2d(size: number, randomSeed: number) {
    const rand = new PRNG(randomSeed);
    return Float32Array.from([...Array(size * size * 2)].map(() => rand.get()));
  }
  /** @internal */
  private reverseBits(v: number, width: number) {
    return parseInt(v.toString(2).padStart(width, '0').split('').reverse().join(''), 2);
  }
  /** @internal */
  private createButterflyTexture(size: number) {
    const width = Math.log2(size);
    const height = size;
    const texture = new Float32Array(width * height * 4);
    const w = (2.0 * Math.PI) / size;
    const bitReversed = [...Array(size).keys()].map((v) => this.reverseBits(v, width));

    for (let j = 0; j < width; j++) {
      for (let i = 0; i < height; i++) {
        const k = i * (size >> (j + 1));
        const c = Math.cos(k * w);
        const s = Math.sin(k * w);
        const span = 2 ** j;
        const wing = i % 2 ** (j + 1) < span ? 0 : 1; // 0 - top wing, 1 - bottom wing
        const texel = new Vector4();
        if (j === 0) {
          if (wing === 0) {
            texel.setXYZW(c, s, bitReversed[i], bitReversed[i + 1]);
          } else {
            texel.setXYZW(c, s, bitReversed[i - 1], bitReversed[i]);
          }
        } else {
          if (wing === 0) {
            texel.setXYZW(c, s, i, i + span);
          } else {
            texel.setXYZW(c, s, i - span, i);
          }
        }

        texture[(width * i + j) * 4] = texel[0];
        texture[(width * i + j) * 4 + 1] = texel[1];
        texture[(width * i + j) * 4 + 2] = texel[2];
        texture[(width * i + j) * 4 + 3] = texel[3];
      }
    }
    return texture;
  }
  /** @internal */
  private getInstanceData() {
    if (!this._instanceData) {
      const device = getDevice();
      const h0Textures = this.createNTextures(
        device,
        this._h0TextureFormat,
        this._params.resolution,
        3,
        'Water-h0',
        false
      );
      const dataTextures = this.createNTextures(
        device,
        this._dataTextureFormat,
        this._params.resolution,
        6,
        'Water-data',
        true,
        true
      );
      const spectrumTextures = this.createNTextures(
        device,
        this._textureFormat,
        this._params.resolution,
        6,
        'Water-spectrum',
        true
      );
      const pingpongTextures = this.createNTextures(
        device,
        this._textureFormat,
        this._params.resolution,
        6,
        'Water-pingpong',
        false
      );
      this._instanceData = {
        dataTextures,
        h0Textures: h0Textures,
        pingpongTextures: pingpongTextures,
        spectrumTextures: spectrumTextures,
        h0Framebuffer: this._useComputeShader
          ? null
          : device.createFrameBuffer(h0Textures as Texture2D[], null),
        spectrumFramebuffer:
          !this._useComputeShader && this._renderMode === RENDER_NORMAL
            ? device.createFrameBuffer(spectrumTextures as Texture2D[], null)
            : null,
        spectrumFramebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((spectrumTextures as Texture2D[]).slice(4, 6), null)
            : null,
        spectrumFramebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((spectrumTextures as Texture2D[]).slice(0, 4), null)
            : null,
        pingpongFramebuffer:
          !this._useComputeShader && this._renderMode === RENDER_NORMAL
            ? device.createFrameBuffer(pingpongTextures as Texture2D[], null)
            : null,
        pingpongFramebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((pingpongTextures as Texture2D[]).slice(4, 6), null)
            : null,
        pingpongFramebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((pingpongTextures as Texture2D[]).slice(0, 4), null)
            : null,
        postIfft2Framebuffer:
          !this._useComputeShader && this._renderMode === RENDER_NORMAL
            ? device.createFrameBuffer(dataTextures as Texture2D[], null)
            : null,
        postIfft2Framebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((dataTextures as Texture2D[]).slice(4, 6), null)
            : null,
        postIfft2Framebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer((dataTextures as Texture2D[]).slice(0, 4), null)
            : null
      };
    }
    return this._instanceData;
  }
  /** @internal */
  private createNTextures(
    device: AbstractDevice,
    format: TextureFormat,
    size: number,
    num: number,
    name: string,
    linear: boolean,
    mipmapping = false
  ) {
    const options: TextureCreationOptions = {
      samplerOptions: {
        minFilter: linear ? 'linear' : 'nearest',
        magFilter: linear ? 'linear' : 'nearest',
        mipFilter: mipmapping ? 'linear' : 'none',
        addressU: 'repeat',
        addressV: 'repeat'
      },
      writable: !!this._useComputeShader,
      mipmapping
    };
    if (this._useComputeShader) {
      const tex = device.createTexture2DArray(format, size, size, num, options)!;
      tex.name = name;
      return tex;
    } else {
      return Array.from({ length: num }).map((val, index) => {
        const tex = device.createTexture2D(format, size, size, options)!;
        tex.name = `${name}-${index}`;
        return tex;
      });
    }
  }
  /** {@inheritDoc WaveGenerator.update} */
  update(time: number) {
    const device = getDevice();
    device.pushDeviceStates();
    device.setRenderStates(this._updateRenderStates);
    if (this._resolutionChanged) {
      this.disposeInstanceData();
    }
    if (this._paramsChanged) {
      this.generateInitialSpectrum();
    }
    this._resolutionChanged = false;
    this._paramsChanged = false;
    for (let i = 0; i < 3; i++) {
      this._sizes[i] = this._cascades[i].x;
      this._croppinesses[i] = this._params.cascades[i].croppiness;
    }
    if (this._renderMode === RENDER_NORMAL) {
      this.generateSpectrum(time);
      this.ifft2();
      this.postIfft2();
    } else {
      this.generateSpectrumTwoPass(time);
      this.ifft2TwoPass();
      this.postIfft2TwoPass();
    }
    // The fragment normal reads the slopes filtered to the pixel
    const dataTextures = this.getInstanceData().dataTextures;
    if (Array.isArray(dataTextures)) {
      dataTextures.forEach((tex) => tex.generateMipmaps());
    } else {
      dataTextures.generateMipmaps();
    }
    device.popDeviceStates();
  }
  /** {@inheritDoc WaveGenerator.needUpdate} */
  needUpdate() {
    return true;
  }
  /** @internal */
  private disposeNTextures(texture: Nullable<Texture2D[] | Texture2DArray>) {
    if (Array.isArray(texture)) {
      texture.forEach((tex) => tex.dispose());
    } else if (texture) {
      texture.dispose();
    }
  }
  /** @internal */
  private disposeInstanceData() {
    if (this._instanceData) {
      this.disposeNTextures(this._instanceData.dataTextures);
      this.disposeNTextures(this._instanceData.h0Textures);
      this.disposeNTextures(this._instanceData.pingpongTextures);
      this.disposeNTextures(this._instanceData.spectrumTextures);
      this._instanceData.h0Framebuffer?.dispose();
      this._instanceData.pingpongFramebuffer?.dispose();
      this._instanceData.pingpongFramebuffer2?.dispose();
      this._instanceData.pingpongFramebuffer4?.dispose();
      this._instanceData.spectrumFramebuffer?.dispose();
      this._instanceData.spectrumFramebuffer2?.dispose();
      this._instanceData.spectrumFramebuffer4?.dispose();
      this._instanceData.postIfft2Framebuffer?.dispose();
      this._instanceData.postIfft2Framebuffer2?.dispose();
      this._instanceData.postIfft2Framebuffer4?.dispose();
      this._instanceData = null;
    }
  }
  /** @internal */
  private generateSpectrum(time: number) {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals!.programs.hkProgram);
    device.setBindGroup(0, this._hkBindGroup!);
    this._hkBindGroup!.setValue('t', time);
    this._hkBindGroup!.setValue('resolution', this._params.resolution);
    this._hkBindGroup!.setValue('sizes', this._sizes);
    if (this._useComputeShader) {
      this._hkBindGroup!.setTexture('h0Texture', instanceData.h0Textures as Texture2DArray);
      this._hkBindGroup!.setTexture('spectrum', instanceData.spectrumTextures as Texture2DArray);
      device.compute(
        this._params.resolution / THREAD_GROUP_SIZE,
        this._params.resolution / THREAD_GROUP_SIZE,
        1
      );
    } else {
      const h0Textures = instanceData.h0Textures as Texture2D[];
      this._hkBindGroup!.setTexture('h0Texture0', h0Textures[0], nearestRepeatSampler);
      this._hkBindGroup!.setTexture('h0Texture1', h0Textures[1], nearestRepeatSampler);
      this._hkBindGroup!.setTexture('h0Texture2', h0Textures[2], nearestRepeatSampler);
      device.setFramebuffer(instanceData.spectrumFramebuffer);
      FFTWaveGenerator._globals!.quad.draw();
    }
  }
  /** @internal */
  private generateSpectrumTwoPass(time: number) {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals!.programs.hkProgram4);
    device.setBindGroup(0, this._hkBindGroup4!);
    const h0Textures = instanceData.h0Textures as Texture2D[];
    this._hkBindGroup4!.setValue('resolution', this._params.resolution);
    this._hkBindGroup4!.setValue('sizes', this._sizes);
    this._hkBindGroup4!.setTexture('h0Texture0', h0Textures[0], nearestRepeatSampler);
    this._hkBindGroup4!.setTexture('h0Texture1', h0Textures[1], nearestRepeatSampler);
    this._hkBindGroup4!.setValue('t', time);
    device.setFramebuffer(instanceData.spectrumFramebuffer4);
    FFTWaveGenerator._globals!.quad.draw();

    device.setProgram(FFTWaveGenerator._globals!.programs.hkProgram2);
    device.setBindGroup(0, this._hkBindGroup2!);
    this._hkBindGroup2!.setValue('resolution', this._params.resolution);
    this._hkBindGroup2!.setValue('sizes', this._sizes);
    this._hkBindGroup2!.setTexture('h0Texture2', h0Textures[2], nearestRepeatSampler);
    this._hkBindGroup2!.setValue('t', time);
    device.setFramebuffer(instanceData.spectrumFramebuffer2);
    FFTWaveGenerator._globals!.quad.draw();
  }
  /** @internal */
  private ifft2() {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures: [Texture2D[] | Texture2DArray, Texture2D[] | Texture2DArray] = [
      instanceData.spectrumTextures,
      instanceData.pingpongTextures
    ];
    const pingPongFramebuffers: [
      Nullable<FrameBuffer> | Texture2DArray,
      Nullable<FrameBuffer> | Texture2DArray
    ] = this._useComputeShader
      ? [instanceData.pingpongTextures as Texture2DArray, instanceData.spectrumTextures as Texture2DArray]
      : [instanceData.pingpongFramebuffer, instanceData.spectrumFramebuffer];
    const butterflyTex = this.getButterflyTexture(this._params.resolution);

    let pingPong = 0;

    // horizontal ifft
    device.setProgram(FFTWaveGenerator._globals!.programs.fft2hProgram);
    device.setBindGroup(0, this._fft2hBindGroup!);
    this._fft2hBindGroup!.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      this._fft2hBindGroup!.setValue('phase', phase);
      if (this._useComputeShader) {
        this._fft2hBindGroup!.setTexture(
          'spectrum',
          pingPongTextures[pingPong] as Texture2DArray,
          nearestRepeatSampler
        );
        this._fft2hBindGroup!.setTexture('ifft', pingPongFramebuffers[pingPong] as Texture2DArray);
        device.compute(
          this._params.resolution / THREAD_GROUP_SIZE,
          this._params.resolution / THREAD_GROUP_SIZE,
          1
        );
      } else {
        const pingPongTexture = pingPongTextures[pingPong] as Texture2D[];
        device.setFramebuffer(pingPongFramebuffers[pingPong] as FrameBuffer);
        this._fft2hBindGroup!.setTexture('spectrum0', pingPongTexture[0], nearestRepeatSampler);
        this._fft2hBindGroup!.setTexture('spectrum1', pingPongTexture[1], nearestRepeatSampler);
        this._fft2hBindGroup!.setTexture('spectrum2', pingPongTexture[2], nearestRepeatSampler);
        this._fft2hBindGroup!.setTexture('spectrum3', pingPongTexture[3], nearestRepeatSampler);
        this._fft2hBindGroup!.setTexture('spectrum4', pingPongTexture[4], nearestRepeatSampler);
        this._fft2hBindGroup!.setTexture('spectrum5', pingPongTexture[5], nearestRepeatSampler);
        FFTWaveGenerator._globals!.quad.draw();
      }
      pingPong = 1 - pingPong; //(pingPong + 1) % 2;
    }
    // vertical ifft
    device.setProgram(FFTWaveGenerator._globals!.programs.fft2vProgram);
    device.setBindGroup(0, this._fft2vBindGroup!);
    this._fft2vBindGroup!.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      this._fft2vBindGroup!.setValue('phase', phase);
      if (this._useComputeShader) {
        this._fft2vBindGroup!.setTexture(
          'spectrum',
          pingPongTextures[pingPong] as Texture2DArray,
          nearestRepeatSampler
        );
        this._fft2vBindGroup!.setTexture('ifft', pingPongFramebuffers[pingPong] as Texture2DArray);
        device.compute(
          this._params.resolution / THREAD_GROUP_SIZE,
          this._params.resolution / THREAD_GROUP_SIZE,
          1
        );
      } else {
        const pingPongTexture = pingPongTextures[pingPong] as Texture2D[];
        device.setFramebuffer(pingPongFramebuffers[pingPong] as FrameBuffer);
        this._fft2vBindGroup!.setTexture('spectrum0', pingPongTexture[0], nearestRepeatSampler);
        this._fft2vBindGroup!.setTexture('spectrum1', pingPongTexture[1], nearestRepeatSampler);
        this._fft2vBindGroup!.setTexture('spectrum2', pingPongTexture[2], nearestRepeatSampler);
        this._fft2vBindGroup!.setTexture('spectrum3', pingPongTexture[3], nearestRepeatSampler);
        this._fft2vBindGroup!.setTexture('spectrum4', pingPongTexture[4], nearestRepeatSampler);
        this._fft2vBindGroup!.setTexture('spectrum5', pingPongTexture[5], nearestRepeatSampler);
        FFTWaveGenerator._globals!.quad.draw();
      }
      pingPong = 1 - pingPong;
    }
    this._ifftTextures = pingPongTextures[pingPong];
  }
  /** @internal */
  private getFFT2hBindGroup2(device: AbstractDevice, pingpong: number) {
    let bindGroup = this._fft2hBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals!.programs.fft2hProgram2!.bindGroupLayouts[0]
      );
    }
    this._fft2hBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2hBindGroup4(device: AbstractDevice, pingpong: number) {
    let bindGroup = this._fft2hBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals!.programs.fft2hProgram4!.bindGroupLayouts[0]
      );
    }
    this._fft2hBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2vBindGroup2(device: AbstractDevice, pingpong: number) {
    let bindGroup = this._fft2vBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals!.programs.fft2vProgram2!.bindGroupLayouts[0]
      );
    }
    this._fft2vBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2vBindGroup4(device: AbstractDevice, pingpong: number) {
    let bindGroup = this._fft2vBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals!.programs.fft2vProgram4!.bindGroupLayouts[0]
      );
    }
    this._fft2vBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private ifft2TwoPass() {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures = [
      instanceData.spectrumTextures as Texture2D[],
      instanceData.pingpongTextures as Texture2D[]
    ];
    const pingPongFramebuffers4: [FrameBuffer, FrameBuffer] = [
      instanceData.pingpongFramebuffer4!,
      instanceData.spectrumFramebuffer4!
    ];
    const pingPongFramebuffers2: [FrameBuffer, FrameBuffer] = [
      instanceData.pingpongFramebuffer2!,
      instanceData.spectrumFramebuffer2!
    ];
    const butterflyTex = this.getButterflyTexture(this._params.resolution);

    // horizontal ifft
    let pingPong = 0;
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers4[pingPong]);
      device.setProgram(FFTWaveGenerator._globals!.programs.fft2hProgram4);
      const fft2hBindGroup4 = this.getFFT2hBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup4);
      fft2hBindGroup4.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2hBindGroup4.setValue('phase', phase);
      fft2hBindGroup4.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
      FFTWaveGenerator._globals!.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(FFTWaveGenerator._globals!.programs.fft2hProgram2);
      const fft2hBindGroup2 = this.getFFT2hBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup2);
      fft2hBindGroup2.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2hBindGroup2.setValue('phase', phase);
      fft2hBindGroup2.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
      fft2hBindGroup2.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
      FFTWaveGenerator._globals!.quad.draw();
      pingPong = (pingPong + 1) % 2;
    }

    // vertical ifft
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers4[pingPong]);
      device.setProgram(FFTWaveGenerator._globals!.programs.fft2vProgram4);
      const fft2vBindGroup4 = this.getFFT2vBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup4);
      fft2vBindGroup4.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2vBindGroup4.setValue('phase', phase);
      fft2vBindGroup4.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
      FFTWaveGenerator._globals!.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(FFTWaveGenerator._globals!.programs.fft2vProgram2);
      const fft2vBindGroup2 = this.getFFT2vBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup2);
      fft2vBindGroup2.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2vBindGroup2.setValue('phase', phase);
      fft2vBindGroup2.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
      fft2vBindGroup2.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
      FFTWaveGenerator._globals!.quad.draw();
      pingPong = (pingPong + 1) % 2;
    }
    this._ifftTextures = pingPongTextures[pingPong];
    for (let i = 0; i < 2; i++) {
      this._fft2hBindGroup2Used[i].push(...this._fft2hBindGroup2Free[i]);
      this._fft2hBindGroup2Free[i].length = 0;
      this._fft2hBindGroup4Used[i].push(...this._fft2hBindGroup4Free[i]);
      this._fft2hBindGroup4Free[i].length = 0;
      this._fft2vBindGroup2Used[i].push(...this._fft2vBindGroup2Free[i]);
      this._fft2vBindGroup2Free[i].length = 0;
      this._fft2vBindGroup4Used[i].push(...this._fft2vBindGroup4Free[i]);
      this._fft2vBindGroup4Free[i].length = 0;
    }
  }
  /** @internal */
  private postIfft2() {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals!.programs.postfft2Program);
    device.setBindGroup(0, this._postfft2BindGroup!);
    if (this._useComputeShader) {
      this._postfft2BindGroup!.setTexture('output', instanceData.dataTextures as Texture2DArray);
      this._postfft2BindGroup!.setTexture('ifft', this._ifftTextures as Texture2DArray, nearestRepeatSampler);
      device.compute(
        this._params.resolution / THREAD_GROUP_SIZE,
        this._params.resolution / THREAD_GROUP_SIZE,
        1
      );
    } else {
      const ifftTextures = this._ifftTextures as Texture2D[];
      device.setFramebuffer(instanceData.postIfft2Framebuffer);
      this._postfft2BindGroup!.setTexture('ifft0', ifftTextures[0], nearestRepeatSampler);
      this._postfft2BindGroup!.setTexture('ifft1', ifftTextures[1], nearestRepeatSampler);
      this._postfft2BindGroup!.setTexture('ifft2', ifftTextures[2], nearestRepeatSampler);
      this._postfft2BindGroup!.setTexture('ifft3', ifftTextures[3], nearestRepeatSampler);
      this._postfft2BindGroup!.setTexture('ifft4', ifftTextures[4], nearestRepeatSampler);
      this._postfft2BindGroup!.setTexture('ifft5', ifftTextures[5], nearestRepeatSampler);
      FFTWaveGenerator._globals!.quad.draw();
    }
  }
  /** @internal */
  private postIfft2TwoPass() {
    const device = getDevice();
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setFramebuffer(instanceData.postIfft2Framebuffer4);
    device.setProgram(FFTWaveGenerator._globals!.programs.postfft2Program4);
    device.setBindGroup(0, this._postfft2BindGroup4!);
    const ifftTextures = this._ifftTextures as Texture2D[];
    this._postfft2BindGroup4!.setTexture('ifft0', ifftTextures[0], nearestRepeatSampler);
    this._postfft2BindGroup4!.setTexture('ifft1', ifftTextures[1], nearestRepeatSampler);
    this._postfft2BindGroup4!.setTexture('ifft2', ifftTextures[2], nearestRepeatSampler);
    this._postfft2BindGroup4!.setTexture('ifft3', ifftTextures[3], nearestRepeatSampler);
    FFTWaveGenerator._globals!.quad.draw();
    device.setFramebuffer(instanceData.postIfft2Framebuffer2);
    device.setProgram(FFTWaveGenerator._globals!.programs.postfft2Program2);
    device.setBindGroup(0, this._postfft2BindGroup2!);
    this._postfft2BindGroup2!.setTexture('ifft4', ifftTextures[4], nearestRepeatSampler);
    this._postfft2BindGroup2!.setTexture('ifft5', ifftTextures[5], nearestRepeatSampler);
    FFTWaveGenerator._globals!.quad.draw();
  }
  /** {@inheritDoc WaveGenerator.setupUniforms} */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    scope.sizes = pb.vec4().uniform(uniformGroup);
    scope.croppinesses = pb.vec4().uniform(uniformGroup);
    if (this._useComputeShader) {
      scope.dataTexture = pb.tex2DArray().uniform(uniformGroup);
    } else {
      scope.dx_hy_dz_dxdz0 = pb.tex2D().uniform(uniformGroup);
      scope.sx_sz_dxdx_dzdz0 = pb.tex2D().uniform(uniformGroup);
      scope.dx_hy_dz_dxdz1 = pb.tex2D().uniform(uniformGroup);
      scope.sx_sz_dxdx_dzdz1 = pb.tex2D().uniform(uniformGroup);
      scope.dx_hy_dz_dxdz2 = pb.tex2D().uniform(uniformGroup);
      scope.sx_sz_dxdx_dzdz2 = pb.tex2D().uniform(uniformGroup);
    }
    scope.foamParams = pb.vec2().uniform(uniformGroup);
    scope.slopeVar0 = pb.vec4().uniform(uniformGroup);
    scope.slopeVar1 = pb.vec4().uniform(uniformGroup);
    scope.slopeVar2 = pb.vec4().uniform(uniformGroup);
    scope.slopeRetained = pb.vec4[6]().uniform(uniformGroup);
  }
  /**
   * Mip level each cascade is read at by a pixel with screen derivatives
   * `xzGrad` of its xz, as anisotropic filtering picks it: from the shorter
   * axis of the pixel, or the longer over the anisotropy where that is more.
   * @internal
   */
  private cascadeLods(scope: PBInsideFunctionScope, xzGrad: PBShaderExp) {
    const pb = scope.$builder;
    pb.func('fftCascadeLods', [pb.vec4('xzGrad')], function () {
      this.$l.lx = pb.mul(pb.length(this.xzGrad.xy), SLOPE_FILTER_SCALE);
      this.$l.ly = pb.mul(pb.length(this.xzGrad.zw), SLOPE_FILTER_SCALE);
      this.$l.fp = pb.max(
        pb.max(pb.min(this.lx, this.ly), pb.div(pb.max(this.lx, this.ly), SLOPE_MAX_ANISOTROPY)),
        1e-6
      );
      this.$l.texel = pb.vec3(this.slopeVar0.w, this.slopeVar1.w, this.slopeVar2.w);
      this.$return(pb.max(pb.log2(pb.div(pb.vec3(this.fp), this.texel)), pb.vec3(0)));
    });
    return scope.fftCascadeLods(xzGrad) as PBShaderExp;
  }
  /** Trilinear, anisotropic sampler of the slope mips. @internal */
  private static getSlopeSampler() {
    const globals = FFTWaveGenerator._globals!;
    if (!globals.slopeSampler) {
      globals.slopeSampler = getDevice().createSampler({
        addressU: 'repeat',
        addressV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipFilter: 'linear',
        maxAnisotropy: SLOPE_MAX_ANISOTROPY
      });
    }
    return globals.slopeSampler;
  }
  /** {@inheritDoc WaveGenerator.calcUnresolvedSlopeVariance} */
  calcUnresolvedSlopeVariance(scope: PBInsideFunctionScope, xzGrad: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    // Share of a cascade's slope variance its mip level keeps, linear between levels
    pb.func('fftSlopeRetained', [pb.float('lod'), pb.vec4('lo'), pb.vec4('hi')], function () {
      this.$l.hatLo = pb.max(pb.sub(pb.vec4(1), pb.abs(pb.sub(pb.vec4(this.lod), pb.vec4(1, 2, 3, 4)))), pb.vec4(0));
      this.$l.hatHi = pb.max(pb.sub(pb.vec4(1), pb.abs(pb.sub(pb.vec4(this.lod), pb.vec4(5, 6, 7, 8)))), pb.vec4(0));
      this.$return(
        pb.add(
          pb.max(pb.sub(1, this.lod), 0),
          pb.dot(this.hatLo, this.lo),
          pb.mul(pb.dot(this.hatHi, this.hi), pb.clamp(pb.sub(SLOPE_LOD_LEVELS + 1, this.lod), 0, 1))
        )
      );
    });
    pb.func('fftUnresolvedSlopeVariance', [pb.vec4('xzGrad')], function () {
      this.$l.lod = that.cascadeLods(this, this.xzGrad);
      this.$l.lost = pb.sub(
        pb.vec3(1),
        pb.vec3(
          this.fftSlopeRetained(this.lod.x, this.slopeRetained.at(0), this.slopeRetained.at(1)),
          this.fftSlopeRetained(this.lod.y, this.slopeRetained.at(2), this.slopeRetained.at(3)),
          this.fftSlopeRetained(this.lod.z, this.slopeRetained.at(4), this.slopeRetained.at(5))
        )
      );
      this.$return(
        pb.add(
          pb.mul(this.slopeVar0.xyz, this.lost.x),
          pb.mul(this.slopeVar1.xyz, this.lost.y),
          pb.mul(this.slopeVar2.xyz, this.lost.z)
        )
      );
    });
    return scope.fftUnresolvedSlopeVariance(xzGrad) as PBShaderExp;
  }
  /** {@inheritDoc WaveGenerator.calcVertexPositionAndNormal} */
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'calcPositionAndNormal',
      [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out()],
      function () {
        this.$l.xz = this.inPos.xz;
        this.$l.uv0 = pb.div(this.xz, this.sizes.x);
        this.$l.uv1 = pb.div(this.xz, this.sizes.y);
        this.$l.uv2 = pb.div(this.xz, this.sizes.z);
        if (that._useComputeShader) {
          this.$l.a = pb.mul(
            pb.textureArraySampleLevel(this.dataTexture, this.uv0, 0, 0).rgb,
            pb.vec3(this.croppinesses.x, 1, this.croppinesses.x)
          );
          this.$l.b = pb.mul(
            pb.textureArraySampleLevel(this.dataTexture, this.uv1, 2, 0).rgb,
            pb.vec3(this.croppinesses.y, 1, this.croppinesses.y)
          );
          this.$l.c = pb.mul(
            pb.textureArraySampleLevel(this.dataTexture, this.uv2, 4, 0).rgb,
            pb.vec3(this.croppinesses.z, 1, this.croppinesses.z)
          );
        } else {
          this.$l.a = pb.mul(
            pb.textureSampleLevel(this.dx_hy_dz_dxdz0, this.uv0, 0).rgb,
            pb.vec3(this.croppinesses.x, 1, this.croppinesses.x)
          );
          this.$l.b = pb.mul(
            pb.textureSampleLevel(this.dx_hy_dz_dxdz1, this.uv1, 0).rgb,
            pb.vec3(this.croppinesses.y, 1, this.croppinesses.y)
          );
          this.$l.c = pb.mul(
            pb.textureSampleLevel(this.dx_hy_dz_dxdz2, this.uv2, 0).rgb,
            pb.vec3(this.croppinesses.z, 1, this.croppinesses.z)
          );
        }
        this.$l.displacement = pb.add(this.a, this.b, this.c);
        this.outPos = pb.add(this.inPos, this.displacement);
        this.outNormal = pb.vec3(0, 1, 0);
      }
    );
    scope.calcPositionAndNormal(inPos, outPos, outNormal);
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormal} */
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, _vertexNormal: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    pb.func('calcFragmentNormal', [pb.vec2('xz')], function () {
      this.$l.uv0 = pb.div(this.xz, this.sizes.x);
      this.$l.uv1 = pb.div(this.xz, this.sizes.y);
      this.$l.uv2 = pb.div(this.xz, this.sizes.z);
      if (that._useComputeShader) {
        this.$l._sx_sz_dxdx_dzdz0 = pb.textureArraySampleLevel(this.dataTexture, this.uv0, 1, 0);
        this.$l._sx_sz_dxdx_dzdz1 = pb.textureArraySampleLevel(this.dataTexture, this.uv1, 3, 0);
        this.$l._sx_sz_dxdx_dzdz2 = pb.textureArraySampleLevel(this.dataTexture, this.uv2, 5, 0);
      } else {
        this.$l._sx_sz_dxdx_dzdz0 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz0, this.uv0, 0);
        this.$l._sx_sz_dxdx_dzdz1 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz1, this.uv1, 0);
        this.$l._sx_sz_dxdx_dzdz2 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz2, this.uv2, 0);
      }
      this.$l.sx = pb.add(this._sx_sz_dxdx_dzdz0.x, this._sx_sz_dxdx_dzdz1.x, this._sx_sz_dxdx_dzdz2.x);
      this.$l.sz = pb.add(this._sx_sz_dxdx_dzdz0.y, this._sx_sz_dxdx_dzdz1.y, this._sx_sz_dxdx_dzdz2.y);
      this.$l.dxdx_dzdz = pb.add(
        pb.mul(this._sx_sz_dxdx_dzdz0.zw, this.croppinesses.x),
        pb.mul(this._sx_sz_dxdx_dzdz1.zw, this.croppinesses.y),
        pb.mul(this._sx_sz_dxdx_dzdz2.zw, this.croppinesses.z)
      );
      // Normal of the displaced surface. With the Jacobian of the horizontal
      // displacement [[A, C], [C, F]], A = 1 + croppiness*d2x, F = 1 + croppiness*d2z,
      // C = croppiness*dxdz and J = A*F - C*C, the tangents' cross product is
      //
      //   N ~ ( -sx * F, J, -sz * A )
      //
      // J must stay off the horizontal components, or the normal flips with
      // sign(J). The y component takes |J|: where the sheet folds (J < 0, the
      // foam band) the true normal points down, which the shading cannot light.
      let dxdzSamples: PBShaderExp;
      if (that._useComputeShader) {
        dxdzSamples = pb.vec3(
          pb.textureArraySampleLevel(this.dataTexture, this.uv0, 0, 0).w,
          pb.textureArraySampleLevel(this.dataTexture, this.uv1, 2, 0).w,
          pb.textureArraySampleLevel(this.dataTexture, this.uv2, 4, 0).w
        );
      } else {
        dxdzSamples = pb.vec3(
          pb.textureSampleLevel(this.dx_hy_dz_dxdz0, this.uv0, 0).w,
          pb.textureSampleLevel(this.dx_hy_dz_dxdz1, this.uv1, 0).w,
          pb.textureSampleLevel(this.dx_hy_dz_dxdz2, this.uv2, 0).w
        );
      }
      this.$l.dxdz = pb.add(
        pb.mul(dxdzSamples.x, this.croppinesses.x),
        pb.mul(dxdzSamples.y, this.croppinesses.y),
        pb.mul(dxdzSamples.z, this.croppinesses.z)
      );
      this.$l.jA = pb.add(1.0, this.dxdx_dzdz.x);
      this.$l.jF = pb.add(1.0, this.dxdx_dzdz.y);
      this.$l.jdet = pb.sub(pb.mul(this.jA, this.jF), pb.mul(this.dxdz, this.dxdz));
      this.$l.normal = pb.normalize(
        pb.vec3(pb.neg(pb.mul(this.sx, this.jF)), pb.abs(this.jdet), pb.neg(pb.mul(this.sz, this.jA)))
      );
      this.$return(this.normal);
    });
    return scope.calcFragmentNormal(xz) as PBShaderExp;
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormalAndFoam} */
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    _vertexNormal?: PBShaderExp,
    _foamSample?: PBShaderExp,
    xzGrad?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func('jacobian', [pb.float('dxdx'), pb.float('dxdz'), pb.float('dzdz')], function () {
      this.$l.Jxx = pb.add(this.dxdx, 1);
      this.$l.Jxz = this.dxdz;
      this.$l.Jzz = pb.add(this.dzdz, 1);
      this.$return(pb.vec4(this.Jxx, this.Jxz, this.Jxz, this.Jzz));
    });
    pb.func('det', [pb.vec4('jacobian')], function () {
      this.$return(
        pb.sub(pb.mul(this.jacobian.x, this.jacobian.w), pb.mul(this.jacobian.y, this.jacobian.z))
      );
    });
    const params = xzGrad ? [pb.vec2('xz'), pb.vec4('xzGrad')] : [pb.vec2('xz')];
    const funcName = xzGrad ? 'calcNormalAndFoamF' : 'calcNormalAndFoam';
    pb.func(funcName, params, function () {
      this.$l.uv0 = pb.div(this.xz, this.sizes.x);
      this.$l.uv1 = pb.div(this.xz, this.sizes.y);
      this.$l.uv2 = pb.div(this.xz, this.sizes.z);
      // Slopes and Jacobian filtered down to the pixel: each cascade read with
      // the screen derivatives of its texture coordinates, trilinear and
      // anisotropic, so the waves too short for the pixel average out rather
      // than alias into speckle
      const sample = (tex: string, layer: number, uv: string, size: string) => {
        if (!xzGrad) {
          return that._useComputeShader
            ? pb.textureArraySampleLevel(this.dataTexture, this[uv], layer, 0)
            : pb.textureSampleLevel(this[tex], this[uv], 0);
        }
        const ddx = pb.mul(this.xzGrad.xy, pb.div(SLOPE_FILTER_SCALE, this.sizes[size]));
        const ddy = pb.mul(this.xzGrad.zw, pb.div(SLOPE_FILTER_SCALE, this.sizes[size]));
        return that._useComputeShader
          ? pb.textureArraySampleGrad(this.dataTexture, this[uv], layer, ddx, ddy)
          : pb.textureSampleGrad(this[tex], this[uv], ddx, ddy);
      };
      this.$l._sx_sz_dxdx_dzdz0 = sample('sx_sz_dxdx_dzdz0', 1, 'uv0', 'x');
      this.$l._sx_sz_dxdx_dzdz1 = sample('sx_sz_dxdx_dzdz1', 3, 'uv1', 'y');
      this.$l._sx_sz_dxdx_dzdz2 = sample('sx_sz_dxdx_dzdz2', 5, 'uv2', 'z');
      this.$l.sx = pb.add(this._sx_sz_dxdx_dzdz0.x, this._sx_sz_dxdx_dzdz1.x, this._sx_sz_dxdx_dzdz2.x);
      this.$l.sz = pb.add(this._sx_sz_dxdx_dzdz0.y, this._sx_sz_dxdx_dzdz1.y, this._sx_sz_dxdx_dzdz2.y);
      this.$l.dxdx_dzdz = pb.add(
        pb.mul(this._sx_sz_dxdx_dzdz0.zw, this.croppinesses.x),
        pb.mul(this._sx_sz_dxdx_dzdz1.zw, this.croppinesses.y),
        pb.mul(this._sx_sz_dxdx_dzdz2.zw, this.croppinesses.z)
      );
      this.$l.dxdz0 = sample('dx_hy_dz_dxdz0', 0, 'uv0', 'x').w;
      this.$l.dxdz1 = sample('dx_hy_dz_dxdz1', 2, 'uv1', 'y').w;
      this.$l.dxdz2 = sample('dx_hy_dz_dxdz2', 4, 'uv2', 'z').w;
      this.$l.dxdz = pb.add(
        pb.mul(this.dxdz0, this.croppinesses.x),
        pb.mul(this.dxdz1, this.croppinesses.y),
        pb.mul(this.dxdz2, this.croppinesses.z)
      );
      this.$l.jacobian4 = this.jacobian(this.dxdx_dzdz.x, this.dxdz, this.dxdx_dzdz.y);
      this.$l.val = this.det(this.jacobian4);
      // Same Jacobian as the foam reads: N ~ (-sx*F, |J|, -sz*A), with A and F
      // packed into x and w. See calcFragmentNormal.
      this.$l.normal = pb.normalize(
        pb.vec3(
          pb.neg(pb.mul(this.sx, this.jacobian4.w)),
          pb.abs(this.val),
          pb.neg(pb.mul(this.sz, this.jacobian4.x))
        )
      );
      this.$l.foam = pb.abs(
        pb.pow(pb.neg(pb.min(0, pb.sub(this.val, this.foamParams.x))), this.foamParams.y)
      );
      this.$return(pb.vec4(this.normal, this.foam));
    });
    return (xzGrad ? scope[funcName](xz, xzGrad) : scope[funcName](xz)) as PBShaderExp;
  }
  /** {@inheritDoc WaveGenerator.isOk} */
  isOk() {
    return this._renderMode !== RENDER_NONE;
  }
  /** {@inheritDoc WaveGenerator.applyWaterBindGroup} */
  applyWaterBindGroup(bindGroup: BindGroup) {
    const instanceData = this.getInstanceData();
    const linearRepeatSampler = FFTWaveGenerator.getSlopeSampler();
    if (this._useComputeShader) {
      bindGroup.setTexture('dataTexture', instanceData.dataTextures as Texture2DArray, linearRepeatSampler);
    } else {
      const dataTextures = instanceData.dataTextures as Texture2D[];
      bindGroup.setTexture('dx_hy_dz_dxdz0', dataTextures[0], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz0', dataTextures[1], linearRepeatSampler);
      bindGroup.setTexture('dx_hy_dz_dxdz1', dataTextures[2], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz1', dataTextures[3], linearRepeatSampler);
      bindGroup.setTexture('dx_hy_dz_dxdz2', dataTextures[4], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz2', dataTextures[5], linearRepeatSampler);
    }
    bindGroup.setValue('foamParams', this._params.foamParams);
    bindGroup.setValue('sizes', this._sizes);
    bindGroup.setValue('croppinesses', this._croppinesses);
    bindGroup.setValue('slopeVar0', this._slopeVariances[0]);
    bindGroup.setValue('slopeVar1', this._slopeVariances[1]);
    bindGroup.setValue('slopeVar2', this._slopeVariances[2]);
    bindGroup.setValue('slopeRetained', this._slopeRetained);
  }
  /** {@inheritDoc WaveGenerator.calcClipmapTileAABB} */
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    const disturb = Math.max(Math.abs(this.wind.x), Math.abs(this.wind.y), 2);
    outAABB.minPoint.setXYZ(minX - 8 * disturb, y - 8 * disturb, minZ - 8 * disturb);
    outAABB.maxPoint.setXYZ(maxX + 8 * disturb, y + 8 * disturb, maxZ + 8 * disturb);
  }
  /** {@inheritDoc WaveGenerator.getHash} */
  getHash() {
    return 'FFTWaveGenerator';
  }
  protected onDispose() {
    super.onDispose();
    this.disposeInstanceData();
  }
}
