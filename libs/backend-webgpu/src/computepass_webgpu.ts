import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUBindGroup } from './bindgroup_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';

const VALIDATION_FAILED = 1 << 0;

export class WebGPUComputePass {
  private _device: WebGPUDevice;
  private _computeCommandEncoder: GPUCommandEncoder;
  private _computePassEncoder: GPUComputePassEncoder;
  constructor(device: WebGPUDevice, frameBuffer?: WebGPUFrameBuffer) {
    this._device = device;
    this._computeCommandEncoder = this._device.device.createCommandEncoder();
    this._computePassEncoder = null;
  }
  get active(): boolean {
    return !!this._computePassEncoder;
  }
  compute(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ): void {
    const validation = this.validateCompute(program, bindGroups);
    if (validation & VALIDATION_FAILED) {
      return;
    }
    if (!this._computePassEncoder) {
      this.begin();
    }
    this.setBindGroupsForCompute(this._computePassEncoder, program, bindGroups, bindGroupOffsets);
    const pipeline = this._device.pipelineCache.fetchComputePipeline(program);
    if (pipeline) {
      this._computePassEncoder.setPipeline(pipeline);
      this._computePassEncoder.dispatchWorkgroups(workgroupCountX, workgroupCountY, workgroupCountZ);
    }
  }
  private setBindGroupsForCompute(
    computePassEncoder: GPUComputePassEncoder,
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[]
  ): boolean {
    if (bindGroups) {
      for (let i = 0; i < 4; i++) {
        if (i < program.bindGroupLayouts.length) {
          const bindGroup = bindGroups[i].bindGroup;
          if (!bindGroup) {
            return false;
          }
          computePassEncoder.setBindGroup(i, bindGroup, bindGroupOffsets?.[i] || undefined);
        } else {
          computePassEncoder.setBindGroup(i, this._device.emptyBindGroup);
        }
      }
    }
    return true;
  }
  begin(): void {
    if (this.active) {
      console.error('WebGPUComputePass.begin() failed: WebGPUComputePass.begin() has already been called');
      return;
    }
    this._computeCommandEncoder = this._device.device.createCommandEncoder();
    this._computePassEncoder = this._computeCommandEncoder.beginComputePass();
  }
  end() {
    if (this.active) {
      this._computePassEncoder.end();
      this._computePassEncoder = null;
      this._device.device.queue.submit([
        this._computeCommandEncoder.finish()
      ]);
      this._computeCommandEncoder = null;
    }
  }
  private validateCompute(program: WebGPUProgram, bindGroups: WebGPUBindGroup[]): number {
    let validation = 0;
    if (bindGroups) {
      for (let i = 0; i < program.bindGroupLayouts.length; i++) {
        const bindGroup = bindGroups[i];
        if (bindGroup) {
          if (bindGroup.bindGroup) {
            for (const ubo of bindGroup.bufferList) {
              if (ubo.disposed) {
                validation |= VALIDATION_FAILED;
              }
            }
            for (const tex of bindGroup.textureList) {
              if (tex.disposed) {
                validation |= VALIDATION_FAILED;
              }
            }
          }
        } else {
          console.error(`Missing bind group (${i}) when compute with program '${program.name}'`);
          return VALIDATION_FAILED;
        }
      }
    }
    return validation;
  }
}
