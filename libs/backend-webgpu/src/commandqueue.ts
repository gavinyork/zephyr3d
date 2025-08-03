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
import { WebGPUMipmapGenerator } from './utils_webgpu';

export class CommandQueueImmediate {
  protected _renderPass: WebGPURenderPass;
  protected _computePass: WebGPUComputePass;
  private _bufferUploads: Map<WebGPUBuffer, number>;
  private _textureUploads: Map<WebGPUBaseTexture, number>;
  private readonly _device: WebGPUDevice;
  private _drawcallCounter: number;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._bufferUploads = new Map();
    this._textureUploads = new Map();
    this._renderPass = new WebGPURenderPass(device);
    this._computePass = new WebGPUComputePass(device);
    this._drawcallCounter = 0;
  }
  isBufferUploading(buffer: WebGPUBuffer): boolean {
    return !!this._bufferUploads.has(buffer);
  }
  isTextureUploading(tex: WebGPUBaseTexture): boolean {
    return !!this._textureUploads.has(tex);
  }
  flushUploads() {
    if (this._bufferUploads.size > 0 || this._textureUploads.size > 0) {
      this._drawcallCounter = 0;
      const bufferUploads = this._bufferUploads;
      this._bufferUploads = new Map();
      const textureUploads = this._textureUploads;
      this._textureUploads = new Map();
      const uploadCommandEncoder = this._device.device.createCommandEncoder();
      bufferUploads.forEach((_, buffer) => buffer.beginSyncChanges(uploadCommandEncoder));
      textureUploads.forEach((_, tex) => {
        tex.beginSyncChanges(uploadCommandEncoder);
        if (!tex.disposed && tex.isMipmapDirty()) {
          WebGPUMipmapGenerator.generateMipmap(this._device, tex, uploadCommandEncoder);
        }
      });
      this._device.device.queue.submit([uploadCommandEncoder.finish()]);
      bufferUploads.forEach((_, buffer) => buffer.endSyncChanges());
      textureUploads.forEach((_, tex) => tex.endSyncChanges());
    }
  }
  get currentPass(): WebGPURenderPass | WebGPUComputePass {
    return this._renderPass.active ? this._renderPass : this._computePass.active ? this._computePass : null;
  }
  beginFrame(): void {}
  endFrame(): void {
    this.flush();
  }
  flush() {
    this.flushUploads();
    if (this._renderPass.active) {
      this._renderPass.end();
    }
    if (this._computePass.active) {
      this._computePass.end();
    }
  }
  setFramebuffer(fb: WebGPUFrameBuffer): void {
    if (this._renderPass.active) {
      this.flushUploads();
    }
    this._renderPass.setFramebuffer(fb);
  }
  getFramebuffer(): WebGPUFrameBuffer {
    return this._renderPass.getFramebuffer();
  }
  getFramebufferInfo(): FrameBufferInfo {
    return this._renderPass.getFrameBufferInfo();
  }
  executeRenderBundle(renderBundle: GPURenderBundle) {
    if (this._computePass.active) {
      this.flushUploads();
      this._computePass.end();
    }
    this._renderPass.executeRenderBundle(renderBundle);
  }
  bufferUpload(buffer: WebGPUBuffer) {
    if (this._bufferUploads.has(buffer)) {
      if (this._drawcallCounter > this._bufferUploads.get(buffer)) {
        this.flush();
      }
    } else {
      this._bufferUploads.set(buffer, this._drawcallCounter);
    }
  }
  textureUpload(tex: WebGPUBaseTexture) {
    if (this._textureUploads.has(tex)) {
      if (this._drawcallCounter > this._textureUploads.get(tex)) {
        this.flush();
      }
    } else {
      this._textureUploads.set(tex, this._drawcallCounter);
    }
  }
  copyBuffer(
    srcBuffer: WebGPUBuffer,
    dstBuffer: WebGPUBuffer,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  ) {
    this.flush();
    const copyCommandEncoder = this._device.device.createCommandEncoder();
    copyCommandEncoder.copyBufferToBuffer(srcBuffer.object, srcOffset, dstBuffer.object, dstOffset, bytes);
    this._device.device.queue.submit([copyCommandEncoder.finish()]);
  }
  compute(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ) {
    this._drawcallCounter++;
    if (this._renderPass.active) {
      this.flushUploads();
      this._renderPass.end();
    }
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
    if (this._computePass.active) {
      this.flushUploads();
      this._computePass.end();
    }
    this._drawcallCounter++;
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
  capture(
    renderBundleEncoder: GPURenderBundleEncoder,
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
    this._drawcallCounter++;
    if (this._computePass.active) {
      this.flushUploads();
      this._computePass.end();
    }
    this._renderPass.capture(
      renderBundleEncoder,
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
  setViewport(vp?: number[] | DeviceViewport) {
    this._renderPass.setViewport(vp);
  }
  getViewport(): DeviceViewport {
    return this._renderPass.getViewport();
  }
  setScissor(scissor?: number[] | DeviceViewport) {
    this._renderPass.setScissor(scissor);
  }
  getScissor(): DeviceViewport {
    return this._renderPass.getScissor();
  }
  clear(color: Vector4, depth: number, stencil: number): void {
    this._renderPass.clear(color, depth, stencil);
  }
  finish() {
    return this._device.device.queue.onSubmittedWorkDone();
  }
}
