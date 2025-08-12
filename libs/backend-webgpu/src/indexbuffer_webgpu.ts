import type { IndexBuffer } from '@zephyr3d/device';
import { PBPrimitiveTypeInfo, PBPrimitiveType, GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUBuffer } from './buffer_webgpu';
import type { WebGPUDevice } from './device';

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);

export class WebGPUIndexBuffer extends WebGPUBuffer implements IndexBuffer {
  readonly indexType: PBPrimitiveTypeInfo;
  readonly length: number;
  constructor(
    device: WebGPUDevice,
    data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    usage?: number
  ) {
    if (!(data instanceof Uint16Array) && !(data instanceof Uint32Array)) {
      throw new Error('invalid index data');
    }
    super(device, GPUResourceUsageFlags.BF_INDEX | usage, data);
    this.indexType = data instanceof Uint16Array ? typeU16 : typeU32;
    this.length = data.length;
  }
}
