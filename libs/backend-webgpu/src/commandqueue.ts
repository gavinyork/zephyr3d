import type { Vector4 } from '@zephyr3d/base';
import { WebGPURenderPass } from './renderpass_webgpu';
import { WebGPUComputePass } from './computepass_webgpu';
import type { PrimitiveType, DeviceViewport } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUBindGroup } from './bindgroup_webgpu';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { FrameBufferInfo } from './pipeline_cache';
import type { WebGPUBuffer } from './buffer_webgpu';
import type { WebGPUBaseTexture } from './basetexture_webgpu';

export class CommandQueueImmediate {
  protected _renderPass: WebGPURenderPass;
  protected _computePass: WebGPUComputePass;
  constructor(device: WebGPUDevice) {
    this._renderPass = new WebGPURenderPass(device);
    this._computePass = new WebGPUComputePass(device);
  }
  get currentPass(): WebGPURenderPass | WebGPUComputePass {
    return this._renderPass.active ? this._renderPass : this._computePass.active ? this._computePass : null;
  }
  beginFrame(): void {}
  endFrame(): void {
    this._renderPass.end();
    this._computePass.end();
  }
  flush() {
    this._renderPass.end();
    this._computePass.end();
  }
  setFramebuffer(fb: WebGPUFrameBuffer): void {
    this._renderPass.setFramebuffer(fb);
  }
  getFramebuffer(): WebGPUFrameBuffer {
    return this._renderPass.getFramebuffer();
  }
  getFramebufferInfo(): FrameBufferInfo {
    return this._renderPass.getFrameBufferInfo();
  }
  compute(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ) {
    this._renderPass.end();
    this._computePass.compute(
      program,
      bindGroups,
      bindGroupOffsets,
      workgroupCountX,
      workgroupCountY,
      workgroupCountZ
    );
  }
  draw(
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ): void {
    this._computePass.end();
    this._renderPass.draw(
      program,
      vertexData,
      stateSet,
      bindGroups,
      bindGroupOffsets,
      primitiveType,
      first,
      count,
      numInstances
    );
  }
  setViewport(vp?: number[]|DeviceViewport) {
    this._renderPass.setViewport(vp);
  }
  getViewport(): DeviceViewport {
    return this._renderPass.getViewport();
  }
  setScissor(scissor?: number[]|DeviceViewport) {
    this._renderPass.setScissor(scissor);
  }
  getScissor(): DeviceViewport {
    return this._renderPass.getScissor();
  }
  clear(color: Vector4, depth: number, stencil: number): void {
    this._renderPass.clear(color, depth, stencil);
  }
  isBufferUploading(buffer: WebGPUBuffer): boolean {
    return this._renderPass.isBufferUploading(buffer) || this._computePass.isBufferUploading(buffer);
  }
  isTextureUploading(tex: WebGPUBaseTexture): boolean {
    return this._renderPass.isTextureUploading(tex) || this._computePass.isTextureUploading(tex);
  }
}
