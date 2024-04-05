import { Vector2, Vector3, Vector4, PRNG } from '@zephyr3d/base';
import type {
  AbstractDevice,
  GPUProgram,
  BindGroup,
  Texture2D,
  FrameBuffer,
  TextureSampler,
  TextureFormat,
  RenderStateSet
} from '@zephyr3d/device';
import { Application } from '../app';
import { Clipmap } from './clipmap';
import { Primitive } from './primitive';
import type { WaterShaderImpl } from '../shaders/water';
import {
  createProgramH0,
  createProgramHk,
  createProgramFFT2H,
  createProgramFFT2V,
  createProgramOcean,
  createProgramPostFFT2
} from '../shaders/water';
import type { Camera } from '../camera';

/** @internal */
export interface OceanFieldCascade {
  /**
   * The size of simulated patch of field. (in meters)
   */
  size: number;

  /**
   * How "croppy" this pattern would be
   */
  croppiness: number;

  /**
   * Strength factor for this pattern
   */
  strength: number;

  /**
   * Min wave length. Kind of spectrum filter. (Waves less that this thresold are not involved in spectrum generation)
   */
  minWave: number;

  /**
   * Max wave length. Kind of spectrum filter.
   */
  maxWave: number;
}

/** @internal */
export interface OceanFieldBuildParams {
  /**
   * Size of generated texture. Must be power of 2
   */
  resolution: number;

  /**
   * Ocean field sub-pattern options.
   * @see OceanFieldCascade
   */
  cascades: [OceanFieldCascade, OceanFieldCascade, OceanFieldCascade];

  /**
   * Wind vector. Module correspond to wind force.
   */
  wind: Vector2;

  /**
   * Parameter for waves motion. 0 means no wave motion
   */
  alignment: number;

  /**
   * Foam parameters
   */
  foamParams: Vector2;

  /**
   * Seed of random generator
   */
  randomSeed: number;
}

/** @internal */
export const defaultBuildParams: OceanFieldBuildParams = {
  cascades: [
    {
      size: 450.0,
      strength: 0.8,
      croppiness: -1.2,
      minWave: 0,
      maxWave: 100
    },
    {
      size: 103.0,
      strength: 0.8,
      croppiness: -1.5,
      minWave: 0,
      maxWave: 100
    },
    {
      size: 13,
      strength: 0.9,
      croppiness: -1.5,
      minWave: 0,
      maxWave: 7
    }
  ],
  resolution: 256,
  wind: new Vector2(2, 2),
  alignment: 0.01,
  foamParams: new Vector2(1, 2),
  randomSeed: 0
};

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
  waterProgram: GPUProgram;
};

type Globales = {
  programs: Programs;
  quad: Primitive;
  noiseTextures: Map<number, Texture2D>;
  butterflyTextures: Map<number, Texture2D>;
};

type WaterInstanceData = {
  h0Framebuffer: FrameBuffer;
  h0Textures: Texture2D[];
  spectrumFramebuffer: FrameBuffer;
  spectrumFramebuffer2: FrameBuffer;
  spectrumFramebuffer4: FrameBuffer;
  spectrumTextures: Texture2D[];
  pingpongFramebuffer: FrameBuffer;
  pingpongFramebuffer2: FrameBuffer;
  pingpongFramebuffer4: FrameBuffer;
  pingpongTextures: Texture2D[];
  postIfft2Framebuffer: FrameBuffer;
  postIfft2Framebuffer2: FrameBuffer;
  postIfft2Framebuffer4: FrameBuffer;
  dataTextures: Texture2D[];
};

const RENDER_NONE = 0;
const RENDER_NORMAL = 1;
const RENDER_TWO_PASS = 2;

/** @internal */
export class WaterMesh {
  private static _globals: Globales = null;
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
  private _waterBindGroup: BindGroup;
  private _usedClipmapBindGroups: BindGroup[];
  private _freeClipmapBindGroups: BindGroup[];
  private _nearestRepeatSampler: TextureSampler;
  private _linearRepeatSampler: TextureSampler;
  private _updateRenderStates: RenderStateSet;
  private _waterRenderStates: RenderStateSet;
  private _wireframe: boolean;
  private _gridScale: number;
  private _level: number;
  private _tileSize: number;
  private _regionMin: Vector2;
  private _regionMax: Vector2;
  private _sizes: Vector4;
  private _croppinesses: Vector4;
  private _params: OceanFieldBuildParams;
  private _instanceData: WaterInstanceData;
  private _ifftTextures: Texture2D[];
  private _clipmap: Clipmap;
  private _aabbExtents: Vector2;
  private _cascades: Vector4[];
  private _paramsChanged: boolean;
  private _resolutionChanged: boolean;
  private _textureFormat: TextureFormat;
  private _h0TextureFormat: TextureFormat;
  private _dataTextureFormat: TextureFormat;
  private _renderMode: number;
  private _updateFrameStamp: number;
  constructor(device: AbstractDevice, impl?: WaterShaderImpl) {
    const renderTargetFloat32 = device.getDeviceCaps().textureCaps.supportFloatColorBuffer;
    const linearFloat32 = renderTargetFloat32 && device.getDeviceCaps().textureCaps.supportLinearFloatTexture;
    const renderTargetFloat16 = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer;
    const maxDrawBuffers = /*device.type !== 'webgl' && */ renderTargetFloat16
      ? device.getDeviceCaps().framebufferCaps.maxDrawBuffers
      : 0;
    const maxSampleBytes = device.getDeviceCaps().framebufferCaps.maxColorAttachmentBytesPerSample;
    if (maxDrawBuffers >= 6 && maxSampleBytes >= 96) {
      this._renderMode = RENDER_NORMAL;
      this._textureFormat = renderTargetFloat32 ? 'rgba32f' : 'rgba16f';
      this._h0TextureFormat = renderTargetFloat32 ? 'rgba32f' : 'rgba16f';
      this._dataTextureFormat = linearFloat32 ? 'rgba32f' : 'rgba16f';
    } else if (maxDrawBuffers >= 6 && maxSampleBytes >= 48) {
      this._renderMode = RENDER_NORMAL;
      this._textureFormat = 'rgba16f';
      this._h0TextureFormat = renderTargetFloat32 ? 'rgba32f' : 'rgba16f';
      this._dataTextureFormat = 'rgba16f';
    } else if (maxDrawBuffers >= 4 && maxSampleBytes >= 64) {
      this._renderMode = RENDER_TWO_PASS;
      this._textureFormat = renderTargetFloat32 ? 'rgba32f' : 'rgba16f';
      this._h0TextureFormat = renderTargetFloat32 ? 'rgba32f' : 'rgba16f';
      this._dataTextureFormat = renderTargetFloat32 && linearFloat32 ? 'rgba32f' : 'rgba16f';
    } else if (maxDrawBuffers >= 4 && maxSampleBytes >= 32) {
      this._renderMode = RENDER_TWO_PASS;
      this._textureFormat = 'rgba16f';
      this._h0TextureFormat = 'rgba16f';
      this._dataTextureFormat = 'rgba16f';
    } else {
      this._renderMode = RENDER_NONE;
      this._textureFormat = null;
      this._h0TextureFormat = null;
      this._dataTextureFormat = null;
    }
    if (this._renderMode !== RENDER_NONE) {
      WaterMesh._globals = WaterMesh._globals ?? {
        programs: {
          h0Program: createProgramH0(),
          hkProgram: this._renderMode === RENDER_NORMAL ? createProgramHk() : null,
          hkProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramHk(2) : null,
          hkProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramHk(4) : null,
          fft2hProgram: this._renderMode === RENDER_NORMAL ? createProgramFFT2H() : null,
          fft2hProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(2) : null,
          fft2hProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2H(4) : null,
          fft2vProgram: this._renderMode === RENDER_NORMAL ? createProgramFFT2V() : null,
          fft2vProgram2: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(2) : null,
          fft2vProgram4: this._renderMode === RENDER_TWO_PASS ? createProgramFFT2V(4) : null,
          postfft2Program: this._renderMode === RENDER_NORMAL ? createProgramPostFFT2() : null,
          postfft2Program2: this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(2) : null,
          postfft2Program4: this._renderMode === RENDER_TWO_PASS ? createProgramPostFFT2(4) : null,
          waterProgram: createProgramOcean(impl)
        },
        quad: WaterMesh.createQuad(device),
        noiseTextures: new Map(),
        butterflyTextures: new Map()
      };
      this._params = defaultBuildParams;
      const programs = WaterMesh._globals.programs;
      this._h0BindGroup = device.createBindGroup(programs.h0Program.bindGroupLayouts[0]);
      this._hkBindGroup = programs.hkProgram
        ? device.createBindGroup(WaterMesh._globals.programs.hkProgram.bindGroupLayouts[0])
        : null;
      this._hkBindGroup2 = programs.hkProgram2
        ? device.createBindGroup(WaterMesh._globals.programs.hkProgram2.bindGroupLayouts[0])
        : null;
      this._hkBindGroup4 = programs.hkProgram4
        ? device.createBindGroup(WaterMesh._globals.programs.hkProgram4.bindGroupLayouts[0])
        : null;
      this._fft2hBindGroup = programs.fft2hProgram
        ? device.createBindGroup(WaterMesh._globals.programs.fft2hProgram.bindGroupLayouts[0])
        : null;
        this._fft2vBindGroup = programs.fft2vProgram
        ? device.createBindGroup(WaterMesh._globals.programs.fft2vProgram.bindGroupLayouts[0])
        : null;
      this._fft2hBindGroup2Used = [[],[]];
      this._fft2hBindGroup2Free = [[],[]];
      this._fft2hBindGroup4Used = [[],[]];
      this._fft2hBindGroup4Free = [[],[]];
      this._fft2vBindGroup2Used = [[],[]];
      this._fft2vBindGroup2Free = [[],[]];
      this._fft2vBindGroup4Used = [[],[]];
      this._fft2vBindGroup4Free = [[],[]];
      this._postfft2BindGroup = programs.postfft2Program
        ? device.createBindGroup(WaterMesh._globals.programs.postfft2Program.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup2 = programs.postfft2Program2
        ? device.createBindGroup(WaterMesh._globals.programs.postfft2Program2.bindGroupLayouts[0])
        : null;
      this._postfft2BindGroup4 = programs.postfft2Program4
        ? device.createBindGroup(WaterMesh._globals.programs.postfft2Program4.bindGroupLayouts[0])
        : null;
      this._waterBindGroup = device.createBindGroup(
        WaterMesh._globals.programs.waterProgram.bindGroupLayouts[0]
      );
      this._instanceData = null;
      this._ifftTextures = null;
      this._wireframe = false;
      this._gridScale = 1;
      this._level = 0;
      this._regionMin = new Vector2(-99999, -99999);
      this._regionMax = new Vector2(99999, 99999);
      this._sizes = new Vector4();
      this._tileSize = 32;
      this._croppinesses = new Vector4();
      this._cascades = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];
      this._nearestRepeatSampler = Application.instance.device.createSampler({
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipFilter: 'none',
        addressU: 'repeat',
        addressV: 'repeat'
      });
      this._linearRepeatSampler = Application.instance.device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'none',
        addressU: 'repeat',
        addressV: 'repeat'
      });
      this._updateRenderStates = Application.instance.device.createRenderStateSet();
      this._updateRenderStates.useRasterizerState().setCullMode('none');
      this._updateRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this._waterRenderStates = Application.instance.device.createRenderStateSet();
      this._waterRenderStates.useRasterizerState().setCullMode('none');
      this._waterRenderStates.useDepthState().enableTest(true).enableWrite(true).setCompareFunc('le');
      this._clipmap = new Clipmap(this._tileSize);
      this._aabbExtents = new Vector2();
      this._paramsChanged = true;
      this._resolutionChanged = true;
      this._updateFrameStamp = -1;
      this._usedClipmapBindGroups = [];
      this._freeClipmapBindGroups = [];
    }
  }
  get params() {
    return this._params;
  }
  private paramsChanged() {
    this._paramsChanged = true;
  }
  /*
  private resolutionChanged() {
    this._resolutionChanged = true;
    this._paramsChanged = true;
  }
  */
  get alignment(): number {
    return this._params.alignment;
  }
  set alignment(val: number) {
    if (this._params.alignment !== val) {
      this._params.alignment = val;
      this.paramsChanged();
    }
  }
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
  get foamWidth(): number {
    return this._params.foamParams.x;
  }
  set foamWidth(val: number) {
    this._params.foamParams.x = val;
  }
  get foamContrast(): number {
    return this._params.foamParams.y;
  }
  set foamContrast(val: number) {
    this._params.foamParams.y = val;
  }
  getWaveLength(cascade: number) {
    return this._params.cascades[cascade].size;
  }
  setWaveLength(cascade: number, size: number) {
    if (this._params.cascades[cascade].size !== size) {
      this._params.cascades[cascade].size = size;
      this.paramsChanged();
    }
  }
  getWaveStrength(cascade: number) {
    return this._params.cascades[cascade].strength;
  }
  setWaveStrength(cascade: number, strength: number) {
    if (this._params.cascades[cascade].strength !== strength) {
      this._params.cascades[cascade].strength = strength;
      this.paramsChanged();
    }
  }
  getWaveCroppiness(cascade: number) {
    return this._params.cascades[cascade].croppiness;
  }
  setWaveCroppiness(cascade: number, croppiness: number) {
    if (this._params.cascades[cascade].croppiness !== croppiness) {
      this._params.cascades[cascade].croppiness = croppiness;
      this.paramsChanged();
    }
  }
  get bindGroup(): BindGroup {
    return this._waterBindGroup;
  }
  get level() {
    return this._level;
  }
  set level(val: number) {
    this._level = val;
  }
  get wireframe() {
    return this._wireframe;
  }
  set wireframe(val: boolean) {
    this._wireframe = val;
  }
  get gridScale() {
    return this._gridScale;
  }
  set gridScale(val: number) {
    this._gridScale = val;
  }
  get tileSize() {
    return this._tileSize;
  }
  set tileSize(val: number) {
    if (val !== this._tileSize) {
      this._tileSize = val;
      if (!this._clipmap) {
        this._clipmap = new Clipmap(this._tileSize);
      } else {
        this._clipmap.tileResolution = this._tileSize;
      }
    }
  }
  get regionMin() {
    return this._regionMin;
  }
  set regionMin(val: Vector2) {
    this._regionMin.set(val);
  }
  get regionMax() {
    return this._regionMax;
  }
  set regionMax(val: Vector2) {
    this._regionMax.set(val);
  }
  getClipmapBindGroup(device: AbstractDevice) {
    let bindGroup = this._usedClipmapBindGroups.pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(WaterMesh._globals.programs.waterProgram.bindGroupLayouts[1]);
    }
    this._freeClipmapBindGroups.push(bindGroup);
    return bindGroup;
  }
  render(camera: Camera, flip?: boolean) {
    if (this._renderMode === RENDER_NONE) {
      return;
    }
    const device = Application.instance.device;
    device.pushDeviceStates();
    if (true || device.frameInfo.frameCounter !== this._updateFrameStamp) {
      this._updateFrameStamp = device.frameInfo.frameCounter;
      this.update(device, device.frameInfo.elapsedOverall * 0.001);
    }
    device.popDeviceStates();
    const cameraPos = camera.getWorldPosition();
    const instanceData = this.getInstanceData();
    device.setProgram(WaterMesh._globals.programs.waterProgram);
    device.setBindGroup(0, this._waterBindGroup);
    device.setRenderStates(this._waterRenderStates);
    const sampler = this._linearRepeatSampler;
    this._waterBindGroup.setTexture('dx_hy_dz_dxdz0', instanceData.dataTextures[0], sampler);
    this._waterBindGroup.setTexture('sx_sz_dxdx_dzdz0', instanceData.dataTextures[1], sampler);
    this._waterBindGroup.setTexture('dx_hy_dz_dxdz1', instanceData.dataTextures[2], sampler);
    this._waterBindGroup.setTexture(
      'sx_sz_dxdx_dzdz1',
      instanceData.dataTextures[3],
      this._linearRepeatSampler
    );
    this._waterBindGroup.setTexture(
      'dx_hy_dz_dxdz2',
      instanceData.dataTextures[4],
      this._linearRepeatSampler
    );
    this._waterBindGroup.setTexture(
      'sx_sz_dxdx_dzdz2',
      instanceData.dataTextures[5],
      this._linearRepeatSampler
    );
    this._waterBindGroup.setValue('foamParams', this._params.foamParams);
    this._waterBindGroup.setValue('sizes', this._sizes);
    this._waterBindGroup.setValue('regionMin', this._regionMin);
    this._waterBindGroup.setValue('regionMax', this._regionMax);
    this._waterBindGroup.setValue('croppinesses', this._croppinesses);
    this._waterBindGroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    this._waterBindGroup.setValue('level', this._level);
    this._waterBindGroup.setValue('pos', cameraPos);
    this._waterBindGroup.setValue('flip', flip ? 1 : 0);
    const that = this;
    const position = new Vector3(cameraPos.x, cameraPos.z, 0);
    const distX = Math.max(
      Math.abs(position.x - this._regionMin.x),
      Math.abs(position.x - this._regionMax.x)
    );
    const distY = Math.max(
      Math.abs(position.y - this._regionMin.y),
      Math.abs(position.y - this._regionMax.y)
    );
    const maxDist = Math.min(Math.max(distX, distY), camera.getFarPlane());
    const gridScale = Math.max(0.01, this._gridScale);
    const mipLevels = Math.ceil(Math.log2(maxDist / (this._tileSize * gridScale))) + 1;
    const disturb = Math.max(this.wind.x, this.wind.y, 2);
    this._aabbExtents.setXY(disturb * 2, disturb * 8 + this._level);
    this._clipmap.draw(
      {
        camera,
        position,
        minWorldPos: this._regionMin,
        maxWorldPos: this._regionMax,
        gridScale: gridScale,
        AABBExtents: this._aabbExtents,
        drawPrimitive(prim, modelMatrix, offset, scale, gridScale) {
          const clipmapBindGroup = that.getClipmapBindGroup(device);
          clipmapBindGroup.setValue('modelMatrix', modelMatrix);
          clipmapBindGroup.setValue('offset', offset);
          clipmapBindGroup.setValue('scale', scale);
          clipmapBindGroup.setValue('gridScale', gridScale);
          device.setBindGroup(1, clipmapBindGroup);
          prim.primitiveType = that._wireframe ? 'line-strip' : 'triangle-list';
          prim.draw();
        }
      },
      mipLevels
    );
    this._usedClipmapBindGroups.push(...this._freeClipmapBindGroups);
    this._freeClipmapBindGroups.length = 0;
  }
  update(device: AbstractDevice, time: number): void {
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
  }
  disposeInstanceData(): void {
    if (this._instanceData) {
      this._instanceData.dataTextures.forEach((tex) => tex.dispose());
      this._instanceData.dataTextures = null;
      this._instanceData.h0Textures.forEach((tex) => tex.dispose());
      this._instanceData.h0Textures = null;
      this._instanceData.pingpongTextures.forEach((tex) => tex.dispose());
      this._instanceData.pingpongTextures = null;
      this._instanceData.spectrumTextures.forEach((tex) => tex.dispose());
      this._instanceData.spectrumTextures = null;
      this._instanceData.h0Framebuffer.dispose();
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
  private generateSpectrum(time: number): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    device.setProgram(WaterMesh._globals.programs.hkProgram);
    device.setBindGroup(0, this._hkBindGroup);
    this._hkBindGroup.setValue('resolution', this._params.resolution);
    this._hkBindGroup.setValue('sizes', this._sizes);
    this._hkBindGroup.setTexture('h0Texture0', instanceData.h0Textures[0], this._nearestRepeatSampler);
    this._hkBindGroup.setTexture('h0Texture1', instanceData.h0Textures[1], this._nearestRepeatSampler);
    this._hkBindGroup.setTexture('h0Texture2', instanceData.h0Textures[2], this._nearestRepeatSampler);
    this._hkBindGroup.setValue('t', time);
    if (device.type === 'webgl') {
      this._hkBindGroup.setValue(
        'h0TexSize',
        new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
      );
    }
    device.setFramebuffer(instanceData.spectrumFramebuffer);
    WaterMesh._globals.quad.draw();
  }
  private generateSpectrumTwoPass(time: number): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();

    device.setProgram(WaterMesh._globals.programs.hkProgram4);
    device.setBindGroup(0, this._hkBindGroup4);
    this._hkBindGroup4.setValue('resolution', this._params.resolution);
    this._hkBindGroup4.setValue('sizes', this._sizes);
    this._hkBindGroup4.setTexture('h0Texture0', instanceData.h0Textures[0], this._nearestRepeatSampler);
    this._hkBindGroup4.setTexture('h0Texture1', instanceData.h0Textures[1], this._nearestRepeatSampler);
    this._hkBindGroup4.setValue('t', time);
    if (device.type === 'webgl') {
      this._hkBindGroup4.setValue(
        'h0TexSize',
        new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
      );
    }
    device.setFramebuffer(instanceData.spectrumFramebuffer4);
    WaterMesh._globals.quad.draw();

    device.setProgram(WaterMesh._globals.programs.hkProgram2);
    device.setBindGroup(0, this._hkBindGroup2);
    this._hkBindGroup2.setValue('resolution', this._params.resolution);
    this._hkBindGroup2.setValue('sizes', this._sizes);
    this._hkBindGroup2.setTexture('h0Texture2', instanceData.h0Textures[2], this._nearestRepeatSampler);
    this._hkBindGroup2.setValue('t', time);
    if (device.type === 'webgl') {
      this._hkBindGroup2.setValue(
        'h0TexSize',
        new Vector2(instanceData.h0Textures[0].width, instanceData.h0Textures[0].height)
      );
    }
    device.setFramebuffer(instanceData.spectrumFramebuffer2);
    WaterMesh._globals.quad.draw();
  }
  private ifft2(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures: [Texture2D[], Texture2D[]] = [
      instanceData.spectrumTextures,
      instanceData.pingpongTextures
    ];
    const pingPongFramebuffers: [FrameBuffer, FrameBuffer] = [
      instanceData.pingpongFramebuffer,
      instanceData.spectrumFramebuffer
    ];
    const butterflyTex = this.getButterflyTexture(this._params.resolution);

    // horizontal ifft
    let pingPong = 0;
    device.setProgram(WaterMesh._globals.programs.fft2hProgram);
    device.setBindGroup(0, this._fft2hBindGroup);
    this._fft2hBindGroup.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers[pingPong]);
      this._fft2hBindGroup.setValue('phase', phase);
      this._fft2hBindGroup.setTexture('spectrum0', pingPongTextures[pingPong][0], this._nearestRepeatSampler);
      this._fft2hBindGroup.setTexture('spectrum1', pingPongTextures[pingPong][1], this._nearestRepeatSampler);
      this._fft2hBindGroup.setTexture('spectrum2', pingPongTextures[pingPong][2], this._nearestRepeatSampler);
      this._fft2hBindGroup.setTexture('spectrum3', pingPongTextures[pingPong][3], this._nearestRepeatSampler);
      this._fft2hBindGroup.setTexture('spectrum4', pingPongTextures[pingPong][4], this._nearestRepeatSampler);
      this._fft2hBindGroup.setTexture('spectrum5', pingPongTextures[pingPong][5], this._nearestRepeatSampler);
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
      WaterMesh._globals.quad.draw();
      pingPong = 1 - pingPong;//(pingPong + 1) % 2;
    }

    // vertical ifft
    device.setProgram(WaterMesh._globals.programs.fft2vProgram);
    device.setBindGroup(0, this._fft2vBindGroup);
    this._fft2vBindGroup.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers[pingPong]);
      this._fft2vBindGroup.setValue('phase', phase);
      this._fft2vBindGroup.setTexture('spectrum0', pingPongTextures[pingPong][0], this._nearestRepeatSampler);
      this._fft2vBindGroup.setTexture('spectrum1', pingPongTextures[pingPong][1], this._nearestRepeatSampler);
      this._fft2vBindGroup.setTexture('spectrum2', pingPongTextures[pingPong][2], this._nearestRepeatSampler);
      this._fft2vBindGroup.setTexture('spectrum3', pingPongTextures[pingPong][3], this._nearestRepeatSampler);
      this._fft2vBindGroup.setTexture('spectrum4', pingPongTextures[pingPong][4], this._nearestRepeatSampler);
      this._fft2vBindGroup.setTexture('spectrum5', pingPongTextures[pingPong][5], this._nearestRepeatSampler);
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
      WaterMesh._globals.quad.draw();
      pingPong = (pingPong + 1) % 2;
    }

    this._ifftTextures = pingPongTextures[pingPong];
  }
  private getFFT2hBindGroup2(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2hBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(WaterMesh._globals.programs.fft2hProgram2.bindGroupLayouts[0]);
    }
    this._fft2hBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  private getFFT2hBindGroup4(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2hBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(WaterMesh._globals.programs.fft2hProgram4.bindGroupLayouts[0])
    }
    this._fft2hBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  private getFFT2vBindGroup2(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2vBindGroup2Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(WaterMesh._globals.programs.fft2vProgram2.bindGroupLayouts[0]);
    }
    this._fft2vBindGroup2Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  private getFFT2vBindGroup4(device: AbstractDevice, pingpong: number): BindGroup {
    let bindGroup = this._fft2vBindGroup4Used[pingpong].pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(WaterMesh._globals.programs.fft2vProgram4.bindGroupLayouts[0])
    }
    this._fft2vBindGroup4Free[pingpong].push(bindGroup);
    return bindGroup;
  }
  private ifft2TwoPass(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    const phases = Math.log2(this._params.resolution);
    const pingPongTextures: [Texture2D[], Texture2D[]] = [
      instanceData.spectrumTextures,
      instanceData.pingpongTextures
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
      device.setProgram(WaterMesh._globals.programs.fft2hProgram4);
      const fft2hBindGroup4 = this.getFFT2hBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup4);
      fft2hBindGroup4.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
      fft2hBindGroup4.setValue('phase', phase);
      fft2hBindGroup4.setTexture(
        'spectrum0',
        pingPongTextures[pingPong][0],
        this._nearestRepeatSampler
      );
      fft2hBindGroup4.setTexture(
        'spectrum1',
        pingPongTextures[pingPong][1],
        this._nearestRepeatSampler
      );
      fft2hBindGroup4.setTexture(
        'spectrum2',
        pingPongTextures[pingPong][2],
        this._nearestRepeatSampler
      );
      fft2hBindGroup4.setTexture(
        'spectrum3',
        pingPongTextures[pingPong][3],
        this._nearestRepeatSampler
      );
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
      WaterMesh._globals.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(WaterMesh._globals.programs.fft2hProgram2);
      const fft2hBindGroup2 = this.getFFT2hBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2hBindGroup2);
      fft2hBindGroup2.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
      fft2hBindGroup2.setValue('phase', phase);
      fft2hBindGroup2.setTexture(
        'spectrum4',
        pingPongTextures[pingPong][4],
        this._nearestRepeatSampler
      );
      fft2hBindGroup2.setTexture(
        'spectrum5',
        pingPongTextures[pingPong][5],
        this._nearestRepeatSampler
      );
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
      WaterMesh._globals.quad.draw();
      pingPong = (pingPong + 1) % 2;
    }

    // vertical ifft
    for (let phase = 0; phase < phases; phase++) {
      device.setFramebuffer(pingPongFramebuffers4[pingPong]);
      device.setProgram(WaterMesh._globals.programs.fft2vProgram4);
      const fft2vBindGroup4 = this.getFFT2vBindGroup4(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup4);
      fft2vBindGroup4.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
      fft2vBindGroup4.setValue('phase', phase);
      fft2vBindGroup4.setTexture(
        'spectrum0',
        pingPongTextures[pingPong][0],
        this._nearestRepeatSampler
      );
      fft2vBindGroup4.setTexture(
        'spectrum1',
        pingPongTextures[pingPong][1],
        this._nearestRepeatSampler
      );
      fft2vBindGroup4.setTexture(
        'spectrum2',
        pingPongTextures[pingPong][2],
        this._nearestRepeatSampler
      );
      fft2vBindGroup4.setTexture(
        'spectrum3',
        pingPongTextures[pingPong][3],
        this._nearestRepeatSampler
      );
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
      WaterMesh._globals.quad.draw();
      device.setFramebuffer(pingPongFramebuffers2[pingPong]);
      device.setProgram(WaterMesh._globals.programs.fft2vProgram2);
      const fft2vBindGroup2 = this.getFFT2vBindGroup2(device, pingPong);
      device.setBindGroup(0, fft2vBindGroup2);
      fft2vBindGroup2.setTexture('butterfly', butterflyTex, this._nearestRepeatSampler);
      fft2vBindGroup2.setValue('phase', phase);
      fft2vBindGroup2.setTexture(
        'spectrum4',
        pingPongTextures[pingPong][4],
        this._nearestRepeatSampler
      );
      fft2vBindGroup2.setTexture(
        'spectrum5',
        pingPongTextures[pingPong][5],
        this._nearestRepeatSampler
      );
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
      WaterMesh._globals.quad.draw();
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
  private postIfft2(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    device.setFramebuffer(instanceData.postIfft2Framebuffer);
    device.setProgram(WaterMesh._globals.programs.postfft2Program);
    device.setBindGroup(0, this._postfft2BindGroup);
    this._postfft2BindGroup.setValue('N2', this._params.resolution * this._params.resolution);
    this._postfft2BindGroup.setTexture('ifft0', this._ifftTextures[0], this._nearestRepeatSampler);
    this._postfft2BindGroup.setTexture('ifft1', this._ifftTextures[1], this._nearestRepeatSampler);
    this._postfft2BindGroup.setTexture('ifft2', this._ifftTextures[2], this._nearestRepeatSampler);
    this._postfft2BindGroup.setTexture('ifft3', this._ifftTextures[3], this._nearestRepeatSampler);
    this._postfft2BindGroup.setTexture('ifft4', this._ifftTextures[4], this._nearestRepeatSampler);
    this._postfft2BindGroup.setTexture('ifft5', this._ifftTextures[5], this._nearestRepeatSampler);
    if (device.type === 'webgl') {
      this._postfft2BindGroup.setValue(
        'ifftTexSize',
        new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
      );
    }
    WaterMesh._globals.quad.draw();
  }
  private postIfft2TwoPass(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    device.setFramebuffer(instanceData.postIfft2Framebuffer4);
    device.setProgram(WaterMesh._globals.programs.postfft2Program4);
    device.setBindGroup(0, this._postfft2BindGroup4);
    this._postfft2BindGroup4.setValue('N2', this._params.resolution * this._params.resolution);
    this._postfft2BindGroup4.setTexture('ifft0', this._ifftTextures[0], this._nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft1', this._ifftTextures[1], this._nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft2', this._ifftTextures[2], this._nearestRepeatSampler);
    this._postfft2BindGroup4.setTexture('ifft3', this._ifftTextures[3], this._nearestRepeatSampler);
    if (device.type === 'webgl') {
      this._postfft2BindGroup4.setValue(
        'ifftTexSize',
        new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
      );
    }
    WaterMesh._globals.quad.draw();
    device.setFramebuffer(instanceData.postIfft2Framebuffer2);
    device.setProgram(WaterMesh._globals.programs.postfft2Program2);
    device.setBindGroup(0, this._postfft2BindGroup2);
    this._postfft2BindGroup2.setValue('N2', this._params.resolution * this._params.resolution);
    this._postfft2BindGroup2.setTexture('ifft4', this._ifftTextures[4], this._nearestRepeatSampler);
    this._postfft2BindGroup2.setTexture('ifft5', this._ifftTextures[5], this._nearestRepeatSampler);
    if (device.type === 'webgl') {
      this._postfft2BindGroup2.setValue(
        'ifftTexSize',
        new Vector2(this._ifftTextures[0].width, this._ifftTextures[0].height)
      );
    }
    WaterMesh._globals.quad.draw();
  }
  private createNTextures(
    device: AbstractDevice,
    format: TextureFormat,
    size: number,
    num: number,
    name: string,
    linear: boolean
  ): Texture2D[] {
    return Array.from({ length: num }).map((val, index) => {
      const tex = device.createTexture2D(format, size, size, { samplerOptions: { mipFilter: 'none' } });
      tex.name = `${name}-${index}`;
      tex.samplerOptions = {
        minFilter: linear ? 'linear' : 'nearest',
        magFilter: linear ? 'linear' : 'nearest',
        mipFilter: 'none',
        addressU: 'repeat',
        addressV: 'repeat'
      };
      return tex;
    });
  }
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
        false
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
        h0Framebuffer: device.createFrameBuffer(h0Textures, null),
        spectrumFramebuffer:
          this._renderMode === RENDER_NORMAL ? device.createFrameBuffer(spectrumTextures, null) : null,
        spectrumFramebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(spectrumTextures.slice(4, 6), null)
            : null,
        spectrumFramebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(spectrumTextures.slice(0, 4), null)
            : null,
        pingpongFramebuffer: device.createFrameBuffer(pingpongTextures, null),
        pingpongFramebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(pingpongTextures.slice(4, 6), null)
            : null,
        pingpongFramebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(pingpongTextures.slice(0, 4), null)
            : null,
        postIfft2Framebuffer: device.createFrameBuffer(dataTextures, null),
        postIfft2Framebuffer2:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(dataTextures.slice(4, 6), null)
            : null,
        postIfft2Framebuffer4:
          this._renderMode === RENDER_TWO_PASS
            ? device.createFrameBuffer(dataTextures.slice(0, 4), null)
            : null
      };
    }
    return this._instanceData;
  }
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
  private getButterflyTexture(size: number) {
    const device = Application.instance.device;
    let tex = WaterMesh._globals.butterflyTextures.get(size);
    if (!tex) {
      tex = device.createTexture2D('rgba32f', Math.log2(size), size, {
        samplerOptions: { mipFilter: 'none' }
      });
      tex.name = `butterfly${size}`;
      tex.update(this.createButterflyTexture(size), 0, 0, tex.width, tex.height);
      WaterMesh._globals.butterflyTextures.set(size, tex);
    }
    return tex;
  }
  private generateInitialSpectrum(): void {
    const device = Application.instance.device;
    const instanceData = this.getInstanceData();
    device.setFramebuffer(instanceData.h0Framebuffer);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setProgram(WaterMesh._globals.programs.h0Program);
    device.setBindGroup(0, this._h0BindGroup);
    this._h0BindGroup.setTexture(
      'noise',
      this.getNoiseTexture(this._params.resolution, this._params.randomSeed),
      this._nearestRepeatSampler
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
    WaterMesh._globals.quad.draw();
  }
  private getNoiseTexture(size: number, randomSeed: number): Texture2D {
    const device = Application.instance.device;
    let tex = WaterMesh._globals.noiseTextures.get(size);
    if (!tex) {
      tex = device.createTexture2D(device.type === 'webgl' ? 'rgba32f' : 'rg32f', size, size, {
        samplerOptions: { mipFilter: 'none' }
      });
      tex.name = `noiseTex${size}`;
      tex.update(this.getNoise2d(size, randomSeed, device.type === 'webgl'), 0, 0, size, size);
      WaterMesh._globals.noiseTextures.set(size, tex);
    }
    return tex;
  }
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
  private reverseBits(v: number, width: number): number {
    return parseInt(v.toString(2).padStart(width, '0').split('').reverse().join(''), 2);
  }
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
}
