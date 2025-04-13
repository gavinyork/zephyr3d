import { Vector4, Vector3, Matrix4x4 } from '@zephyr3d/base';
import type { AbstractDevice, GPUProgram, BindGroup, RenderStateSet } from '@zephyr3d/device';
import { Application } from '../app';
import { Clipmap } from './clipmap';
import type { WaterShaderImpl } from '../shaders/water';
import { createProgramOcean } from '../shaders/water';
import type { Camera } from '../camera';
import type { WaveGenerator } from './wavegenerator';

/** @internal */
export class WaterMesh {
  private _impl: WaterShaderImpl;
  private _waveGenerator: WaveGenerator;
  private _waterBindGroup: BindGroup;
  private _usedClipmapBindGroups: BindGroup[];
  private _freeClipmapBindGroups: BindGroup[];
  private _waterRenderStates: RenderStateSet;
  private _wireframe: boolean;
  private _gridScale: number;
  private _speed: number;
  private _level: number;
  private _tileSize: number;
  private _region: Vector4;
  private _clipmap: Clipmap;
  private _updateFrameStamp: number;
  private _waterProgram: GPUProgram;
  private _waveGeneratorHash: string;
  constructor() {
    this._waterProgram = null; //this._impl ? createProgramOcean(this._useComputeShader, this._impl) : null;
    this._waterBindGroup = null; //this._waterProgram ? device.createBindGroup(this._waterProgram.bindGroupLayouts[0]) : null;
    this._wireframe = false;
    this._gridScale = 1;
    this._speed = 1.5;
    this._level = 0;
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._tileSize = 32;
    this._waterRenderStates = Application.instance.device.createRenderStateSet();
    this._waterRenderStates.useRasterizerState().setCullMode('none');
    this._waterRenderStates.useDepthState().enableTest(true).enableWrite(true).setCompareFunc('le');
    this._clipmap = new Clipmap(this._tileSize);
    this._updateFrameStamp = -1;
    this._usedClipmapBindGroups = [];
    this._freeClipmapBindGroups = [];
    this._waveGeneratorHash = '';
  }
  get speed() {
    return this._speed;
  }
  set speed(val: number) {
    this._speed = val;
  }
  /** @internal */
  get shadingImpl(): WaterShaderImpl {
    return this._impl;
  }
  /** @internal */
  set shadingImpl(val: WaterShaderImpl) {
    if (val && val !== this._impl) {
      this._impl = val;
      this._waterProgram?.dispose();
      this._waterProgram = null;
      this._waterBindGroup?.dispose();
      this._waterBindGroup = null;
    }
  }
  /** @internal */
  get waveImpl(): WaveGenerator {
    return this._waveGenerator;
  }
  /** @internal */
  set waveImpl(val: WaveGenerator) {
    if (val && val !== this._waveGenerator) {
      this._waveGenerator = val;
      this._waterProgram?.dispose();
      this._waterProgram = null;
      this._waterBindGroup?.dispose();
      this._waterBindGroup = null;
    }
  }
  /** @internal */
  getWaterBindGroup(device: AbstractDevice): BindGroup {
    return this.prepareForRender(device) ? this._waterBindGroup : null;
  }
  /** @internal */
  prepareForRender(device: AbstractDevice): boolean {
    if (!this._impl || !this._waveGenerator?.isOk(device)) {
      return false;
    }
    if (this._waterProgram && this._waveGeneratorHash !== this._waveGenerator.getHash()) {
      this._waterProgram.dispose();
      this._waterProgram = null;
      this._waterBindGroup.dispose();
      this._waterBindGroup = null;
    }
    if (!this._waterProgram) {
      this._waterProgram = createProgramOcean(this._waveGenerator, this._impl);
      this._waterBindGroup = device.createBindGroup(this._waterProgram.bindGroupLayouts[0]);
      this._waveGeneratorHash = this._waveGenerator.getHash();
    }
    if (!this._waterRenderStates) {
      this._waterRenderStates = device.createRenderStateSet();
      this._waterRenderStates.useRasterizerState().setCullMode('none');
      this._waterRenderStates.useDepthState().enableTest(true).enableWrite(true).setCompareFunc('le');
    }
    return true;
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
  get region() {
    return this._region;
  }
  set region(val: Vector4) {
    this._region.set(val);
  }
  getClipmapBindGroup(device: AbstractDevice) {
    let bindGroup = this._usedClipmapBindGroups.pop();
    if (!bindGroup) {
      bindGroup = device.createBindGroup(this._waterProgram.bindGroupLayouts[1]);
    }
    this._freeClipmapBindGroups.push(bindGroup);
    return bindGroup;
  }
  render(device: AbstractDevice, camera: Camera, flip?: boolean) {
    if (!this.prepareForRender(device)) {
      return;
    }
    if (device.frameInfo.frameCounter !== this._updateFrameStamp) {
      this._updateFrameStamp = device.frameInfo.frameCounter;
      this._waveGenerator.update(device.frameInfo.elapsedOverall * 0.001 * this._speed);
    }
    const cameraPos = camera.getWorldPosition();
    device.setProgram(this._waterProgram);
    device.setBindGroup(0, this._waterBindGroup);
    device.setRenderStates(this._waterRenderStates);
    this._waveGenerator.applyWaterBindGroup(this._waterBindGroup);
    this._waterBindGroup.setValue('region', this._region);
    this._waterBindGroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    this._waterBindGroup.setValue('level', this._level);
    this._waterBindGroup.setValue('pos', cameraPos);
    this._waterBindGroup.setValue('flip', flip ? 1 : 0);
    const that = this;
    this._clipmap.draw({
      camera,
      minMaxWorldPos: this._region,
      gridScale: Math.max(0.01, this._gridScale),
      userData: this,
      calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
        const wm = userData as WaterMesh;
        that._waveGenerator.calcClipmapTileAABB(minX, maxX, minZ, maxZ, wm.level, outAABB);
      },
      drawPrimitive(prim, modelMatrix, offset, scale, gridScale) {
        const clipmapBindGroup = that.getClipmapBindGroup(device);
        const worldMatrix = new Matrix4x4(modelMatrix)
          .scaleLeft(new Vector3(scale, scale, 1))
          .translateLeft(new Vector3(offset.x, offset.y, 0))
          .scaleLeft(new Vector3(gridScale, gridScale, 1));
        clipmapBindGroup.setValue('worldMatrix', worldMatrix);
        device.setBindGroup(1, clipmapBindGroup);
        prim.primitiveType = that._wireframe ? 'line-strip' : 'triangle-list';
        prim.draw();
      }
    });
    this._usedClipmapBindGroups.push(...this._freeClipmapBindGroups);
    this._freeClipmapBindGroups.length = 0;
  }
}
