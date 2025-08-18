import * as zephyr3d_base from '@zephyr3d/base';
import * as zephyr3d_device from '@zephyr3d/device';
import * as zephyr3d_scene from '@zephyr3d/scene';
import * as zephyr3d_runtime from '@zephyr3d/runtime';
import * as zephyr3d_backend_webgl from '@zephyr3d/backend-webgl';
import * as zephyr3d_backend_webgpu from '@zephyr3d/backend-webgpu';

export function shareZephyr3dModules() {
  zephyr3d_base.moduleSharing.shareModules({
    '@zephyr3d/base': zephyr3d_base,
    '@zephyr3d/device': zephyr3d_device,
    '@zephyr3d/scene': zephyr3d_scene,
    '@zephyr3d/runtime': zephyr3d_runtime,
    '@zephyr3d/backend-webgl': zephyr3d_backend_webgl,
    '@zephyr3d/backend-webgpu': zephyr3d_backend_webgpu
  });
}
