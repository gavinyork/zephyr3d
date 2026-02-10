import { WebGPUDevice } from './device';
import type { DeviceBackend, DeviceEventMap } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { makeObservable } from '@zephyr3d/base';

let webGPUStatus: Nullable<Promise<boolean>> = null;

/**
 * The WebGPU backend
 * @public
 */
export const backendWebGPU: DeviceBackend = {
  typeName() {
    return 'webgpu';
  },
  async supported() {
    if (!webGPUStatus) {
      webGPUStatus = new Promise<boolean>(async (resolve) => {
        let status = true;
        try {
          if (!('gpu' in navigator)) {
            status = false;
          }
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) {
            status = false;
          } else {
            const device = await adapter.requestDevice();
            if (!device) {
              status = false;
            } else if (typeof device.destroy === 'function') {
              device.destroy();
            }
            status = true;
          }
        } catch {
          status = false;
        }
        resolve(status);
      });
    }
    return webGPUStatus;
  },
  async createDevice(cvs, options?) {
    try {
      const factory = makeObservable(WebGPUDevice)<DeviceEventMap>();
      const device = new factory(this, cvs, options);
      await device.initContext();
      device.setViewport(null);
      device.setScissor(null);
      return device;
    } catch (err) {
      console.error(err);
      return null;
    }
  }
};
