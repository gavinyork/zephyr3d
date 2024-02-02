import { WebGPUDevice } from "./device";
import { DeviceBackend, DeviceEventMap } from "@zephyr3d/device";
import { makeEventTarget } from "@zephyr3d/base";

/**
 * The WebGPU backend
 * @public
 */
export const backendWebGPU: DeviceBackend = {
  typeName() {
    return 'webgpu';
  },
  supported() {
    return !!window.GPU && navigator.gpu instanceof window.GPU;
  },
  async createDevice(cvs, options?) {
    try {
      const factory = makeEventTarget(WebGPUDevice)<DeviceEventMap>();
      const device = new factory(this, cvs, options);
      await device.initContext();
      device.setViewport();
      device.setScissor();
      return device;
    } catch (err) {
      console.error(err);
      return null;
    }
  },
}

