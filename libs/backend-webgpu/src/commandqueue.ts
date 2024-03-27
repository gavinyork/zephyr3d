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
  private _bufferUploads: Set<WebGPUBuffer>;
  private _textureUploads: Set<WebGPUBaseTexture>;
  private _device: WebGPUDevice;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._bufferUploads = new Set();
    this._textureUploads = new Set();
    this._renderPass = new WebGPURenderPass(device);
    this._computePass = new WebGPUComputePass(device);
  }
  isBufferUploading(buffer: WebGPUBuffer): boolean {
    return !!this._bufferUploads.has(buffer);
  }
  isTextureUploading(tex: WebGPUBaseTexture): boolean {
    return !!this._textureUploads.has(tex);
  }
  flushUploads() {
    if (this._bufferUploads.size > 0 || this._textureUploads.size > 0) {
      this._renderPass.end();
      this._computePass.end();
      const uploadCommandEncoder = this._device.device.createCommandEncoder();
      this._bufferUploads.forEach((buffer) => buffer.beginSyncChanges(uploadCommandEncoder));
      this._textureUploads.forEach((tex) => {
        tex.beginSyncChanges(uploadCommandEncoder);
        if (tex.isMipmapDirty()) {
          WebGPUMipmapGenerator.generateMipmap(this._device, tex, uploadCommandEncoder);
        }
      });
      this._device.device.queue.submit([uploadCommandEncoder.finish()]);
      this._bufferUploads.forEach((buffer) => buffer.endSyncChanges());
      this._textureUploads.forEach((tex) => tex.endSyncChanges());
      this._bufferUploads.clear();
      this._textureUploads.clear();
    }
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
    this.flushUploads();
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
  executeRenderBundle(renderBundle: GPURenderBundle) {
    this._computePass.end();
    this._renderPass.executeRenderBundle(renderBundle);
  }
  bufferUpload(buffer: WebGPUBuffer) {
    this._bufferUploads.add(buffer);
  }
  textureUpload(tex: WebGPUBaseTexture) {
    this._textureUploads.add(tex);
  }
  compute(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ) {
    // flush buffer and texture uploads
    this.flushUploads();
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
    // flush buffer and texture uploads
    this.flushUploads();
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
    // flush buffer and texture uploads
    this.flushUploads();
    this._computePass.end();
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
}
