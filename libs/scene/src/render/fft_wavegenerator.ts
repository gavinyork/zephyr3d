import type { AABB } from '@zephyr3d/base';
import { PRNG, Vector2, Vector4 } from '@zephyr3d/base';
import { WaveGenerator } from './wavegenerator';
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
  TextureFormat
} from '@zephyr3d/device';
import { Primitive } from './primitive';
import { Application } from '../app';
import {
  createProgramFFT2H,
  createProgramFFT2V,
  createProgramH0,
  createProgramHk,
  createProgramPostFFT2
} from '../shaders';
import { fetchSampler } from '../utility/misc';

type OceanFieldCascade = {
  /** The size of simulated patch of field. (in meters) */
  size: number;
  /** How "croppy" this pattern would be */
  croppiness: number;
  /** Strength factor for this pattern */
  strength: number;
  /** Min wave length. Kind of spectrum filter. (Waves less that this thresold are not involved in spectrum generation) */
  minWave: number;
  /** Max wave length. Kind of spectrum filter. */
  maxWave: number;
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

function getDefaultBuildParams(): OceanFieldBuildParams {
  return {
    cascades: [
      {
        size: 400.0,
        strength: 0.4,
        croppiness: -1.5,
        minWave: 0,
        maxWave: 100
      },
      {
        size: 100.0,
        strength: 0.4,
        croppiness: -1.2,
        minWave: 0,
        maxWave: 100
      },
      {
        size: 15,
        strength: 0.2,
        croppiness: -0.5,
        minWave: 0,
        maxWave: 7
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
  hkProgram: GPUProgram;
  hkProgram2: GPUProgram;
  hkProgram4: GPUProgram;
  fft2hProgram: GPUProgram;
  fft2hProgram2: GPUProgram;
  fft2hProgram4: GPUProgram;
  fft2vProgram: GPUProgram;
  fft2vProgram2: GPUProgram;
  fft2vProgram4: GPUProgram;
  postfft2Program: GPUProgram;
  postfft2Program2: GPUProgram;
  postfft2Program4: GPUProgram;
};

type Globales = {
  programs: Programs;
  quad: Primitive;
  noiseTextures: Map<number, Texture2D>;
  butterflyTextures: Map<number, Texture2D>;
};

type WaterInstanceData = {
  h0Framebuffer: FrameBuffer;
  h0Textures: Texture2D[] | Texture2DArray;
  spectrumFramebuffer: FrameBuffer;
  spectrumFramebuffer2: FrameBuffer;
  spectrumFramebuffer4: FrameBuffer;
  spectrumTextures: Texture2D[] | Texture2DArray;
  pingpongFramebuffer: FrameBuffer;
  pingpongFramebuffer2: FrameBuffer;
  pingpongFramebuffer4: FrameBuffer;
  pingpongTextures: Texture2D[] | Texture2DArray;
  postIfft2Framebuffer: FrameBuffer;
  postIfft2Framebuffer2: FrameBuffer;
  postIfft2Framebuffer4: FrameBuffer;
  dataTextures: Texture2D[] | Texture2DArray;
};

const RENDER_NONE = 0;
const RENDER_NORMAL = 1;
const RENDER_TWO_PASS = 2;

const THREAD_GROUP_SIZE = 16;

/**
 * This class generates a 2D ocean field using the Fast Fourier Transform (FFT) algorithm.
 * @public
 */
export class FFTWaveGenerator extends WaveGenerator {
  private static _globals: Globales = null;
  private _useComputeShader: boolean;
  private _h0BindGroup: BindGroup;
  private _hkBindGroup: BindGroup;
  private _hkBindGroup2: BindGroup;
  private _hkBindGroup4: BindGroup;
  private _fft2hBindGroup: BindGroup;
  private _fft2vBindGroup: BindGroup;
  private _fft2hBindGroup2Used: BindGroup[][];
  private _fft2hBindGroup2Free: BindGroup[][];
  private _fft2hBindGroup4Used: BindGroup[][];
  private _fft2hBindGroup4Free: BindGroup[][];
  private _fft2vBindGroup2Used: BindGroup[][];
  private _fft2vBindGroup2Free: BindGroup[][];
  private _fft2vBindGroup4Used: BindGroup[][];
  private _fft2vBindGroup4Free: BindGroup[][];
  private _postfft2BindGroup: BindGroup;
  private _postfft2BindGroup2: BindGroup;
  private _postfft2BindGroup4: BindGroup;
  private _updateRenderStates: RenderStateSet;
  private _sizes: Vector4;
  private _croppinesses: Vector4;
  private _params: OceanFieldBuildParams;
  private _instanceData: WaterInstanceData;
  private _ifftTextures: Texture2D[] | Texture2DArray;
  private _cascades: Vector4[];
  private _paramsChanged: boolean;
  private _resolutionChanged: boolean;
  private _textureFormat: TextureFormat;
  private _h0TextureFormat: TextureFormat;
  private _dataTextureFormat: TextureFormat;
  private _renderMode: number;
  /**
   * Create a new instance of the FFTWaveGenerator class.
   * @param params - Ocean field build parameters. If not provided, default parameters will be used.
   */
  constructor(params?: OceanFieldBuildParams) {
    super();
    const device = Application.instance.device;
    const renderTargetFloat16 = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer;
    const maxDrawBuffers = /*device.type !== 'webgl' && */ renderTargetFloat16
      ? device.getDeviceCaps().framebufferCaps.maxDrawBuffers
      : 0;
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
          hkProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramHk(false, 0, null, 2) : null,
          hkProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramHk(false, 0, null, 4) : null,
          fft2hProgram:
            this._renderMode === RENDER_NORMAL
              ? createProgramFFT2H(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          fft2hProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(false, 0, null, 2) : null,
          fft2hProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(false, 0, null, 4) : null,
          fft2vProgram:
            this._renderMode === RENDER_NORMAL
              ? createProgramFFT2V(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          fft2vProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(false, 0, null, 2) : null,
          fft2vProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(false, 0, null, 4) : null,
          postfft2Program:
            this._renderMode === RENDER_NORMAL
              ? createProgramPostFFT2(this._useComputeShader, THREAD_GROUP_SIZE, this._dataTextureFormat)
              : null,
          postfft2Program2:
            this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(false, 0, null, 2) : null,
          postfft2Program4:
            this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(false, 0, null, 4) : null
        },
        quad: FFTWaveGenerator.createQuad(device),
        noiseTextures: new Map(),
        butterflyTextures: new Map()
      };
      this._params = params ?? getDefaultBuildParams();
      const programs = FFTWaveGenerator._globals.programs;
      this._h0BindGroup = device.createBindGroup(programs.h0Program.bindGroupLayouts[0]);
      this._hkBindGroup = programs.hkProgram
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.hkProgram.bindGroupLayouts[0])
        : null;
      this._hkBindGroup2 = programs.hkProgram2
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.hkProgram2.bindGroupLayouts[0])
        : null;
      this._hkBindGroup4 = programs.hkProgram4
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.hkProgram4.bindGroupLayouts[0])
        : null;
      this._fft2hBindGroup = programs.fft2hProgram
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.fft2hProgram.bindGroupLayouts[0])
        : null;
      this._fft2vBindGroup = programs.fft2vProgram
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.fft2vProgram.bindGroupLayouts[0])
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
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.postfft2Program.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup2 = programs.postfft2Program2
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.postfft2Program2.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup4 = programs.postfft2Program4
        ? device.createBindGroup(FFTWaveGenerator._globals.programs.postfft2Program4.bindGroupLayouts[0])
        : null;
      this._instanceData = null;
      this._ifftTextures = null;
      this._sizes = new Vector4();
      this._croppinesses = new Vector4();
      this._cascades = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];
      this._updateRenderStates = Application.instance.device.createRenderStateSet();
      this._updateRenderStates.useRasterizerState().setCullMode('none');
      this._updateRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this._paramsChanged = true;
    }
  }
  /*
  get params() {
    return this._params;
  }
  set params(val: OceanFieldBuildParams) {
    if (val && val !== this._params) {
      this._params = val;
      this.paramsChanged();
    }
  }
  */
  private paramsChanged() {
    this._paramsChanged = true;
  }
  /** Gets the wave alighment */
  get alignment(): number {
    return this._params.alignment;
  }
  set alignment(val: number) {
    if (this._params.alignment !== val) {
      this._params.alignment = val;
      this.paramsChanged();
    }
  }
  /** Gets the wind vector */
  get wind(): Vector2 {
    return this._params.wind;
  }
  set wind(val: Vector2) {
    if (val !== this._params.wind && (val.x !== this._params.wind.x || val.y !== this._params.wind.y)) {
      this._params.wind.x = val.x;
      this._params.wind.y = val.y;
      this.paramsChanged();
    }
  }
  /** Gets the foam width */
  get foamWidth(): number {
    return this._params.foamParams.x;
  }
  set foamWidth(val: number) {
    this._params.foamParams.x = val;
  }
  /** Gets the foam contrast */
  get foamContrast(): number {
    return this._params.foamParams.y;
  }
  set foamContrast(val: number) {
    this._params.foamParams.y = val;
  }
  /** Gets the wave length for the specified cascade */
  getWaveLength(cascade: number) {
    return this._params.cascades[cascade].size;
  }
  /**
   * Sets the wave length for the specified cascade
   * @param cascade - The cascade index
   * @param length - The new wave length for the specified cascade
   */
  setWaveLength(cascade: number, length: number) {
    if (this._params.cascades[cascade].size !== length) {
      this._params.cascades[cascade].size = length;
      this.paramsChanged();
    }
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
  private static createQuad(device: AbstractDevice): Primitive {
    const vertexData = new Float32Array([
      -1, -1, 0, 0.0, 0.0, 1, -1, 0, 1.0, 0.0, 1, 1, 0, 1.0, 1.0, -1, 1, 0, 0.0, 1.0
    ]);
    const indexData = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const prim = new Primitive();
    const vb = device.createInterleavedVertexBuffer(['position_f32x3', 'tex0_f32x2'], vertexData);
    const ib = device.createIndexBuffer(indexData);
    prim.setVertexBuffer(vb);
    prim.setIndexBuffer(ib);
    prim.primitiveType = 'triangle-list';
    prim.indexStart = 0;
    prim.indexCount = ib.length;
    return prim;
  }
  /** @internal */
  private getButterflyTexture(size: number) {
    const device = Application.instance.device;
    let tex = FFTWaveGenerator._globals.butterflyTextures.get(size);
    if (!tex) {
      tex = device.createTexture2D('rgba32f', Math.log2(size), size, {
        samplerOptions: { mipFilter: 'none' }
      });
      tex.name = `butterfly${size}`;
      tex.update(this.createButterflyTexture(size), 0, 0, tex.width, tex.height);
      FFTWaveGenerator._globals.butterflyTextures.set(size, tex);
    }
    return tex;
  }
  /** @internal */
  private generateInitialSpectrum(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    device.setProgram(FFTWaveGenerator._globals.programs.h0Program);
    device.setBindGroup(0, this._h0BindGroup);
    this._h0BindGroup.setTexture(
      'noise',
      this.getNoiseTexture(this._params.resolution, this._params.randomSeed),
      fetchSampler('repeat_nearest_nomip')
    );
    this._h0BindGroup.setValue('resolution', this._params.resolution);
    this._h0BindGroup.setValue('wind', this._params.wind);
    this._h0BindGroup.setValue('alignment', this._params.alignment);
    for (let i = 0; i < this._params.cascades.length; i++) {
      this._cascades[i].x = this._params.cascades[i].size;
      this._cascades[i].y =
        (this._params.cascades[i].strength * 0.081) /
        (this._params.cascades[i].size * this._params.cascades[i].size);
      this._cascades[i].z = (2 * Math.PI) / this._params.cascades[i].maxWave;
      this._cascades[i].w = (2 * Math.PI) / this._params.cascades[i].minWave;
    }
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
      FFTWaveGenerator._globals.quad.draw();
    }
  }
  /** @internal */
  private getNoiseTexture(size: number, randomSeed: number): Texture2D {
    const device = Application.instance.device;
    let tex = FFTWaveGenerator._globals.noiseTextures.get(size);
    if (!tex) {
      tex = device.createTexture2D(device.type === 'webgl' ? 'rgba32f' : 'rg32f', size, size, {
        samplerOptions: { mipFilter: 'none' }
      });
      tex.name = `noiseTex${size}`;
      tex.update(this.getNoise2d(size, randomSeed, device.type === 'webgl'), 0, 0, size, size);
      FFTWaveGenerator._globals.noiseTextures.set(size, tex);
    }
    return tex;
  }
  /** @internal */
  private getNoise2d(size: number, randomSeed: number, rgba: boolean) {
    const rand = new PRNG(randomSeed);
    if (rgba) {
      const array = new Float32Array(size * size * 4);
      for (let i = 0; i < size * size; i++) {
        array[i * 4 + 0] = rand.get();
        array[i * 4 + 1] = rand.get();
      }
      return array;
    } else {
      return Float32Array.from([...Array(size * size * 2)].map(() => rand.get()));
    }
  }
  /** @internal */
  private reverseBits(v: number, width: number): number {
    return parseInt(v.toString(2).padStart(width, '0').split('').reverse().join(''), 2);
  }
  /** @internal */
  private createButterflyTexture(size: number): Float32Array {
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
  private getInstanceData(): WaterInstanceData {
    if (!this._instanceData) {
      const device = Application.instance.device;
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
    linear: boolean
  ): Texture2D[] | Texture2DArray {
    const options: TextureCreationOptions = {
      samplerOptions: {
        minFilter: linear ? 'linear' : 'nearest',
        magFilter: linear ? 'linear' : 'nearest',
        mipFilter: 'none',
        addressU: 'repeat',
        addressV: 'repeat'
      },
      writable: !!this._useComputeShader
    };
    if (this._useComputeShader) {
      const tex = device.createTexture2DArray(format, size, size, num, options);
      tex.name = name;
      return tex;
    } else {
      return Array.from({ length: num }).map((val, index) => {
        const tex = device.createTexture2D(format, size, size, options);
        tex.name = `${name}-${index}`;
        return tex;
      });
    }
  }
  /** {@inheritDoc WaveGenerator.update} */
  update(time: number): void {
    const device = Application.instance.device;
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
      this._sizes[i] = this._params.cascades[i].size;
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
    device.popDeviceStates();
  }
  /** @internal */
  private disposeNTextures(texture: Texture2D[] | Texture2DArray) {
    if (Array.isArray(texture)) {
      texture.forEach((tex) => tex.dispose());
    } else if (texture) {
      texture.dispose();
    }
  }
  /** @internal */
  private disposeInstanceData(): void {
    if (this._instanceData) {
      this.disposeNTextures(this._instanceData.dataTextures);
      this._instanceData.dataTextures = null;
      this.disposeNTextures(this._instanceData.h0Textures);
      this._instanceData.h0Textures = null;
      this.disposeNTextures(this._instanceData.pingpongTextures);
      this._instanceData.pingpongTextures = null;
      this.disposeNTextures(this._instanceData.spectrumTextures);
      this._instanceData.spectrumTextures = null;
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
  private generateSpectrum(time: number): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals.programs.hkProgram);
    device.setBindGroup(0, this._hkBindGroup);
    this._hkBindGroup.setValue('t', time);
    this._hkBindGroup.setValue('resolution', this._params.resolution);
    this._hkBindGroup.setValue('sizes', this._sizes);
    if (this._useComputeShader) {
      this._hkBindGroup.setTexture('h0Texture', instanceData.h0Textures as Texture2DArray);
      this._hkBindGroup.setTexture('spectrum', instanceData.spectrumTextures as Texture2DArray);
      device.compute(
        this._params.resolution / THREAD_GROUP_SIZE,
        this._params.resolution / THREAD_GROUP_SIZE,
        1
      );
    } else {
      this._hkBindGroup.setTexture('h0Texture0', instanceData.h0Textures[0], nearestRepeatSampler);
      this._hkBindGroup.setTexture('h0Texture1', instanceData.h0Textures[1], nearestRepeatSampler);
      this._hkBindGroup.setTexture('h0Texture2', instanceData.h0Textures[2], nearestRepeatSampler);
      if (device.type === 'webgl') {
        this._hkBindGroup.setValue(
          'h0TexSize',
          new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
        );
      }
      device.setFramebuffer(instanceData.spectrumFramebuffer);
      FFTWaveGenerator._globals.quad.draw();
    }
  }
  /** @internal */
  private generateSpectrumTwoPass(time: number): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals.programs.hkProgram4);
    device.setBindGroup(0, this._hkBindGroup4);
    this._hkBindGroup4.setValue('resolution', this._params.resolution);
    this._hkBindGroup4.setValue('sizes', this._sizes);
    this._hkBindGroup4.setTexture('h0Texture0', instanceData.h0Textures[0], nearestRepeatSampler);
    this._hkBindGroup4.setTexture('h0Texture1', instanceData.h0Textures[1], nearestRepeatSampler);
    this._hkBindGroup4.setValue('t', time);
    if (device.type === 'webgl') {
      this._hkBindGroup4.setValue(
        'h0TexSize',
        new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
      );
    }
    device.setFramebuffer(instanceData.spectrumFramebuffer4);
    FFTWaveGenerator._globals.quad.draw();

    device.setProgram(FFTWaveGenerator._globals.programs.hkProgram2);
    device.setBindGroup(0, this._hkBindGroup2);
    this._hkBindGroup2.setValue('resolution', this._params.resolution);
    this._hkBindGroup2.setValue('sizes', this._sizes);
    this._hkBindGroup2.setTexture('h0Texture2', instanceData.h0Textures[2], nearestRepeatSampler);
    this._hkBindGroup2.setValue('t', time);
    if (device.type === 'webgl') {
      this._hkBindGroup2.setValue(
        'h0TexSize',
        new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
      );
    }
    device.setFramebuffer(instanceData.spectrumFramebuffer2);
    FFTWaveGenerator._globals.quad.draw();
  }
  /** @internal */
  private ifft2(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures: [Texture2D[] | Texture2DArray, Texture2D[] | Texture2DArray] = [
      instanceData.spectrumTextures,
      instanceData.pingpongTextures
    ];
    const pingPongFramebuffers: [FrameBuffer | Texture2DArray, FrameBuffer | Texture2DArray] = this
      ._useComputeShader
      ? [instanceData.pingpongTextures as Texture2DArray, instanceData.spectrumTextures as Texture2DArray]
      : [instanceData.pingpongFramebuffer, instanceData.spectrumFramebuffer];
    const butterflyTex = this.getButterflyTexture(this._params.resolution);

    let pingPong = 0;

    // horizontal ifft
    device.setProgram(FFTWaveGenerator._globals.programs.fft2hProgram);
    device.setBindGroup(0, this._fft2hBindGroup);
    this._fft2hBindGroup.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      this._fft2hBindGroup.setValue('phase', phase);
      if (this._useComputeShader) {
        this._fft2hBindGroup.setTexture(
          'spectrum',
          pingPongTextures[pingPong] as Texture2DArray,
          nearestRepeatSampler
        );
        this._fft2hBindGroup.setTexture('ifft', pingPongFramebuffers[pingPong] as Texture2DArray);
        device.compute(
          this._params.resolution / THREAD_GROUP_SIZE,
          this._params.resolution / THREAD_GROUP_SIZE,
          1
        );
      } else {
        device.setFramebuffer(pingPongFramebuffers[pingPong] as FrameBuffer);
        this._fft2hBindGroup.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
        this._fft2hBindGroup.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
        this._fft2hBindGroup.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
        this._fft2hBindGroup.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
        this._fft2hBindGroup.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
        this._fft2hBindGroup.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
        if (device.type === 'webgl') {
          this._fft2hBindGroup.setValue(
            'texSize',
            new Vector4(
              pingPongTextures[pingPong][0].width,
              pingPongTextures[pingPong][0].height,
              butterflyTex.width,
              butterflyTex.height
            )
          );
        }
        FFTWaveGenerator._globals.quad.draw();
      }
      pingPong = 1 - pingPong; //(pingPong + 1) % 2;
    }
    // vertical ifft
    device.setProgram(FFTWaveGenerator._globals.programs.fft2vProgram);
    device.setBindGroup(0, this._fft2vBindGroup);
    this._fft2vBindGroup.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      this._fft2vBindGroup.setValue('phase', phase);
      if (this._useComputeShader) {
        this._fft2vBindGroup.setTexture(
          'spectrum',
          pingPongTextures[pingPong] as Texture2DArray,
          nearestRepeatSampler
        );
        this._fft2vBindGroup.setTexture('ifft', pingPongFramebuffers[pingPong] as Texture2DArray);
        device.compute(
          this._params.resolution / THREAD_GROUP_SIZE,
          this._params.resolution / THREAD_GROUP_SIZE,
          1
        );
      } else {
        device.setFramebuffer(pingPongFramebuffers[pingPong] as FrameBuffer);
        this._fft2vBindGroup.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
        this._fft2vBindGroup.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
        this._fft2vBindGroup.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
        this._fft2vBindGroup.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
        this._fft2vBindGroup.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
        this._fft2vBindGroup.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
        if (device.type === 'webgl') {
          this._fft2vBindGroup.setValue(
            'texSize',
            new Vector4(
              pingPongTextures[pingPong][0].width,
              pingPongTextures[pingPong][0].height,
              butterflyTex.width,
              butterflyTex.height
            )
          );
        }
        FFTWaveGenerator._globals.quad.draw();
      }
      pingPong = 1 - pingPong;
    }
    this._ifftTextures = pingPongTextures[pingPong];
  }
  /** @internal */
  private getFFT2hBindGroup2(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2hBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals.programs.fft2hProgram2.bindGroupLayouts[0]
      );
    }
    this._fft2hBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2hBindGroup4(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2hBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals.programs.fft2hProgram4.bindGroupLayouts[0]
      );
    }
    this._fft2hBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2vBindGroup2(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2vBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals.programs.fft2vProgram2.bindGroupLayouts[0]
      );
    }
    this._fft2vBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private getFFT2vBindGroup4(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2vBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(
        FFTWaveGenerator._globals.programs.fft2vProgram4.bindGroupLayouts[0]
      );
    }
    this._fft2vBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  /** @internal */
  private ifft2TwoPass(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures = [
      instanceData.spectrumTextures as Texture2D[],
      instanceData.pingpongTextures as Texture2D[]
    ];
    const pingPongFramebuffers4: [FrameBuffer, FrameBuffer] = [
      instanceData.pingpongFramebuffer4,
      instanceData.spectrumFramebuffer4
    ];
    const pingPongFramebuffers2: [FrameBuffer, FrameBuffer] = [
      instanceData.pingpongFramebuffer2,
      instanceData.spectrumFramebuffer2
    ];
    const butterflyTex = this.getButterflyTexture(this._params.resolution);

    // horizontal ifft
    let pingPong = 0;
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers4[pingPong]);
      device.setProgram(FFTWaveGenerator._globals.programs.fft2hProgram4);
      const fft2hBindGroup4 = this.getFFT2hBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup4);
      fft2hBindGroup4.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2hBindGroup4.setValue('phase', phase);
      fft2hBindGroup4.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
      fft2hBindGroup4.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
      if (device.type === 'webgl') {
        fft2hBindGroup4.setValue(
          'texSize',
          new Vector4(
            pingPongTextures[pingPong][0].width,
            pingPongTextures[pingPong][0].height,
            butterflyTex.width,
            butterflyTex.height
          )
        );
      }
      FFTWaveGenerator._globals.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(FFTWaveGenerator._globals.programs.fft2hProgram2);
      const fft2hBindGroup2 = this.getFFT2hBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup2);
      fft2hBindGroup2.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2hBindGroup2.setValue('phase', phase);
      fft2hBindGroup2.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
      fft2hBindGroup2.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
      if (device.type === 'webgl') {
        fft2hBindGroup2.setValue(
          'texSize',
          new Vector4(
            pingPongTextures[pingPong][0].width,
            pingPongTextures[pingPong][0].height,
            butterflyTex.width,
            butterflyTex.height
          )
        );
      }
      FFTWaveGenerator._globals.quad.draw();
      pingPong = (pingPong + 1) % 2;
    }

    // vertical ifft
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers4[pingPong]);
      device.setProgram(FFTWaveGenerator._globals.programs.fft2vProgram4);
      const fft2vBindGroup4 = this.getFFT2vBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup4);
      fft2vBindGroup4.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2vBindGroup4.setValue('phase', phase);
      fft2vBindGroup4.setTexture('spectrum0', pingPongTextures[pingPong][0], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum1', pingPongTextures[pingPong][1], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum2', pingPongTextures[pingPong][2], nearestRepeatSampler);
      fft2vBindGroup4.setTexture('spectrum3', pingPongTextures[pingPong][3], nearestRepeatSampler);
      if (device.type === 'webgl') {
        fft2vBindGroup4.setValue(
          'texSize',
          new Vector4(
            pingPongTextures[pingPong][0].width,
            pingPongTextures[pingPong][0].height,
            butterflyTex.width,
            butterflyTex.height
          )
        );
      }
      FFTWaveGenerator._globals.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(FFTWaveGenerator._globals.programs.fft2vProgram2);
      const fft2vBindGroup2 = this.getFFT2vBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup2);
      fft2vBindGroup2.setTexture('butterfly', butterflyTex, nearestRepeatSampler);
      fft2vBindGroup2.setValue('phase', phase);
      fft2vBindGroup2.setTexture('spectrum4', pingPongTextures[pingPong][4], nearestRepeatSampler);
      fft2vBindGroup2.setTexture('spectrum5', pingPongTextures[pingPong][5], nearestRepeatSampler);
      if (device.type === 'webgl') {
        fft2vBindGroup2.setValue(
          'texSize',
          new Vector4(
            pingPongTextures[pingPong][0].width,
            pingPongTextures[pingPong][0].height,
            butterflyTex.width,
            butterflyTex.height
          )
        );
      }
      FFTWaveGenerator._globals.quad.draw();
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
  private postIfft2(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setProgram(FFTWaveGenerator._globals.programs.postfft2Program);
    device.setBindGroup(0, this._postfft2BindGroup);
    this._postfft2BindGroup.setValue('N2', this._params.resolution * this._params.resolution);
    if (this._useComputeShader) {
      this._postfft2BindGroup.setTexture('output', instanceData.dataTextures as Texture2DArray);
      this._postfft2BindGroup.setTexture('ifft', this._ifftTextures as Texture2DArray, nearestRepeatSampler);
      device.compute(
        this._params.resolution / THREAD_GROUP_SIZE,
        this._params.resolution / THREAD_GROUP_SIZE,
        1
      );
    } else {
      device.setFramebuffer(instanceData.postIfft2Framebuffer);
      this._postfft2BindGroup.setTexture('ifft0', this._ifftTextures[0], nearestRepeatSampler);
      this._postfft2BindGroup.setTexture('ifft1', this._ifftTextures[1], nearestRepeatSampler);
      this._postfft2BindGroup.setTexture('ifft2', this._ifftTextures[2], nearestRepeatSampler);
      this._postfft2BindGroup.setTexture('ifft3', this._ifftTextures[3], nearestRepeatSampler);
      this._postfft2BindGroup.setTexture('ifft4', this._ifftTextures[4], nearestRepeatSampler);
      this._postfft2BindGroup.setTexture('ifft5', this._ifftTextures[5], nearestRepeatSampler);
      if (device.type === 'webgl') {
        this._postfft2BindGroup.setValue(
          'ifftTexSize',
          new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
        );
      }
      FFTWaveGenerator._globals.quad.draw();
    }
  }
  /** @internal */
  private postIfft2TwoPass(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const nearestRepeatSampler = fetchSampler('repeat_nearest_nomip');
    device.setFramebuffer(instanceData.postIfft2Framebuffer4);
    device.setProgram(FFTWaveGenerator._globals.programs.postfft2Program4);
    device.setBindGroup(0, this._postfft2BindGroup4);
    this._postfft2BindGroup4.setValue('N2', this._params.resolution * this._params.resolution);
    this._postfft2BindGroup4.setTexture('ifft0', this._ifftTextures[0], nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft1', this._ifftTextures[1], nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft2', this._ifftTextures[2], nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft3', this._ifftTextures[3], nearestRepeatSampler);
    if (device.type === 'webgl') {
      this._postfft2BindGroup4.setValue(
        'ifftTexSize',
        new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
      );
    }
    FFTWaveGenerator._globals.quad.draw();
    device.setFramebuffer(instanceData.postIfft2Framebuffer2);
    device.setProgram(FFTWaveGenerator._globals.programs.postfft2Program2);
    device.setBindGroup(0, this._postfft2BindGroup2);
    this._postfft2BindGroup2.setValue('N2', this._params.resolution * this._params.resolution);
    this._postfft2BindGroup2.setTexture('ifft4', this._ifftTextures[4], nearestRepeatSampler);
    this._postfft2BindGroup2.setTexture('ifft5', this._ifftTextures[5], nearestRepeatSampler);
    if (device.type === 'webgl') {
      this._postfft2BindGroup2.setValue(
        'ifftTexSize',
        new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
      );
    }
    FFTWaveGenerator._globals.quad.draw();
  }
  /** {@inheritDoc WaveGenerator.setupUniforms} */
  setupUniforms(scope: PBGlobalScope): void {
    const pb = scope.$builder;
    scope.sizes = pb.vec4().uniform(0);
    scope.croppinesses = pb.vec4().uniform(0);
    if (this._useComputeShader) {
      scope.dataTexture = pb.tex2DArray().uniform(0);
    } else {
      scope.dx_hy_dz_dxdz0 = pb.tex2D().uniform(0);
      scope.sx_sz_dxdx_dzdz0 = pb.tex2D().uniform(0);
      scope.dx_hy_dz_dxdz1 = pb.tex2D().uniform(0);
      scope.sx_sz_dxdx_dzdz1 = pb.tex2D().uniform(0);
      scope.dx_hy_dz_dxdz2 = pb.tex2D().uniform(0);
      scope.sx_sz_dxdx_dzdz2 = pb.tex2D().uniform(0);
    }
    if (pb.shaderKind === 'fragment') {
      scope.foamParams = pb.vec2().uniform(0);
    }
  }
  /** {@inheritDoc WaveGenerator.calcVertexPositionAndNormal} */
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void {
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
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp): PBShaderExp {
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
      this.$l.slope = pb.vec2(
        pb.div(this.sx, pb.add(1.0, this.dxdx_dzdz.x)),
        pb.div(this.sz, pb.add(1.0, this.dxdx_dzdz.y))
      );
      this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.slope.x), 1.0, pb.neg(this.slope.y)));
      this.$return(this.normal);
    });
    return scope.calcFragmentNormal(xz);
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormalAndFoam} */
  calcFragmentNormalAndFoam(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
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
    pb.func('calcNormalAndFoam', [pb.vec2('xz')], function () {
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
      this.$l.slope = pb.vec2(
        pb.div(this.sx, pb.add(1.0, this.dxdx_dzdz.x)),
        pb.div(this.sz, pb.add(1.0, this.dxdx_dzdz.y))
      );
      this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.slope.x), 1.0, pb.neg(this.slope.y)));

      // foam
      this.$l.dxdx_dzdz0 = this._sx_sz_dxdx_dzdz0.zw;
      this.$l.dxdx_dzdz1 = this._sx_sz_dxdx_dzdz1.zw;
      this.$l.dxdx_dzdz2 = this._sx_sz_dxdx_dzdz2.zw;
      if (that._useComputeShader) {
        this.$l.dxdz0 = pb.textureArraySampleLevel(this.dataTexture, this.uv0, 0, 0).w;
        this.$l.dxdz1 = pb.textureArraySampleLevel(this.dataTexture, this.uv1, 2, 0).w;
        this.$l.dxdz2 = pb.textureArraySampleLevel(this.dataTexture, this.uv2, 4, 0).w;
      } else {
        this.$l.dxdz0 = pb.textureSampleLevel(this.dx_hy_dz_dxdz0, this.uv0, 0).w;
        this.$l.dxdz1 = pb.textureSampleLevel(this.dx_hy_dz_dxdz1, this.uv1, 0).w;
        this.$l.dxdz2 = pb.textureSampleLevel(this.dx_hy_dz_dxdz2, this.uv2, 0).w;
      }
      this.$l.dxdz = pb.add(
        pb.mul(this.dxdz0, this.croppinesses.x),
        pb.mul(this.dxdz1, this.croppinesses.y),
        pb.mul(this.dxdz2, this.croppinesses.z)
      );
      this.$l.val = this.det(this.jacobian(this.dxdx_dzdz.x, this.dxdz, this.dxdx_dzdz.y));
      this.$l.foam = pb.abs(
        pb.pow(pb.neg(pb.min(0, pb.sub(this.val, this.foamParams.x))), this.foamParams.y)
      );
      this.$return(pb.vec4(this.normal, this.foam));
    });
    return scope.calcNormalAndFoam(xz);
  }
  /** {@inheritDoc WaveGenerator.isOk} */
  isOk(): boolean {
    return this._renderMode !== RENDER_NONE;
  }
  /** {@inheritDoc WaveGenerator.applyWaterBindGroup} */
  applyWaterBindGroup(bindGroup: BindGroup): void {
    const instanceData = this.getInstanceData();
    const linearRepeatSampler = fetchSampler('repeat_linear_nomip');
    if (this._useComputeShader) {
      bindGroup.setTexture('dataTexture', instanceData.dataTextures as Texture2DArray, linearRepeatSampler);
    } else {
      bindGroup.setTexture('dx_hy_dz_dxdz0', instanceData.dataTextures[0], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz0', instanceData.dataTextures[1], linearRepeatSampler);
      bindGroup.setTexture('dx_hy_dz_dxdz1', instanceData.dataTextures[2], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz1', instanceData.dataTextures[3], linearRepeatSampler);
      bindGroup.setTexture('dx_hy_dz_dxdz2', instanceData.dataTextures[4], linearRepeatSampler);
      bindGroup.setTexture('sx_sz_dxdx_dzdz2', instanceData.dataTextures[5], linearRepeatSampler);
    }
    bindGroup.setValue('foamParams', this._params.foamParams);
    bindGroup.setValue('sizes', this._sizes);
    bindGroup.setValue('croppinesses', this._croppinesses);
  }
  /** {@inheritDoc WaveGenerator.dispose} */
  dispose() {
    this.disposeInstanceData();
  }
  /** {@inheritDoc WaveGenerator.calcClipmapTileAABB} */
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    const disturb = Math.max(Math.abs(this.wind.x), Math.abs(this.wind.y), 2);
    outAABB.minPoint.setXYZ(minX - 8 * disturb, y - 8 * disturb, minZ - 8 * disturb);
    outAABB.maxPoint.setXYZ(maxX + 8 * disturb, y + 8 * disturb, maxZ + 8 * disturb);
  }
  /** {@inheritDoc WaveGenerator.getHash} */
  getHash(): string {
    return '';
  }
}
