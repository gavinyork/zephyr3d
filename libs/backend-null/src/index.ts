/**
 * A GPU-less device backend for zephyr3d, intended for unit testing.
 *
 * @remarks
 * The null backend implements the whole device interface with plain JavaScript
 * objects: buffers and textures keep their content in system memory, draw and
 * clear calls are recorded instead of executed, and no browser API is required.
 * Tests can therefore exercise device-facing engine logic without mocking the
 * device.
 *
 * @example
 * ```ts
 * const device = await createNullDevice({ type: 'webgl2' });
 * device.beginFrame();
 * device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
 * device.endFrame();
 * expect(device.getCommandCount('clear')).toBe(1);
 * ```
 *
 * @module backend-null
 * @packageDocumentation
 */
import type { AbstractDevice, DeviceBackend, DeviceEventMap } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { makeObservable } from '@zephyr3d/base';
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH, NullDevice } from './device_null';
import { createNullCanvas } from './canvas_null';
import type { NullDeviceOptions } from './types';

export * from './types';
export * from './canvas_null';
export * from './capabilities_null';
export * from './gpuobject_null';
export * from './basetexture_null';
export * from './texture2d_null';
export * from './texture2darray_null';
export * from './texture3d_null';
export * from './texturecube_null';
export * from './texturevideo_null';
export * from './buffer_null';
export * from './structuredbuffer_null';
export * from './sampler_null';
export * from './framebuffer_null';
export * from './vertexlayout_null';
export * from './bindgroup_null';
export * from './gpuprogram_null';
export * from './renderstate_null';
export * from './device_null';

/**
 * The device backend interface of the null backend.
 *
 * @remarks
 * Widens {@link https://github.com/gavinyork/zephyr3d | DeviceBackend.createDevice}
 * so the extra {@link NullDeviceOptions} fields can be passed, and allows a null
 * canvas so that a device can be created without a DOM.
 *
 * @public
 */
export interface NullDeviceBackend extends DeviceBackend {
  createDevice(
    cvs: Nullable<HTMLCanvasElement>,
    options?: NullDeviceOptions
  ): Promise<Nullable<AbstractDevice>>;
}

/**
 * The null device backend
 *
 * @remarks
 * Pass this backend to the application in the same way as the WebGL or WebGPU
 * backends. Device options accept the extra {@link NullDeviceOptions} fields, so
 * the emulated device type and capabilities can be selected per device.
 *
 * @public
 */
export const backendNull: NullDeviceBackend = {
  typeName() {
    return 'null';
  },
  async supported() {
    return true;
  },
  async createDevice(
    cvs: Nullable<HTMLCanvasElement>,
    options?: NullDeviceOptions
  ): Promise<Nullable<AbstractDevice>> {
    try {
      const factory = makeObservable(NullDevice)<DeviceEventMap>();
      const canvas =
        cvs ??
        createNullCanvas(options?.width ?? DEFAULT_CANVAS_WIDTH, options?.height ?? DEFAULT_CANVAS_HEIGHT);
      const device = new factory(this, canvas, options) as unknown as NullDevice;
      await device.initContext();
      return device as unknown as AbstractDevice;
    } catch (err) {
      console.error(err);
      return null;
    }
  }
};

/**
 * Creates a null device without an application or a canvas.
 *
 * @remarks
 * This is the entry point intended for unit tests: it creates the backing
 * canvas (a real one when a DOM is present, a stub otherwise) and returns a
 * ready to use device.
 *
 * @param options - The creation options
 * @returns The created device
 * @public
 */
export async function createNullDevice(options?: NullDeviceOptions): Promise<NullDevice> {
  const canvas = createNullCanvas(
    options?.width ?? DEFAULT_CANVAS_WIDTH,
    options?.height ?? DEFAULT_CANVAS_HEIGHT
  );
  const factory = makeObservable(NullDevice)<DeviceEventMap>();
  const device = new factory(backendNull, canvas, options) as unknown as NullDevice;
  await device.initContext();
  return device;
}
