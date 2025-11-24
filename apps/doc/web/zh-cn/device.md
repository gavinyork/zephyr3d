# 渲染设备

渲染设备([Device](/doc/markdown/./device.abstractdevice))是一个抽象接口，提供了大多数底层图形API功能的封装，是DeviceAPI的核心。

## 创建设备

渲染设备是一个抽象的接口，目前我们实现了WebGL, WebGL2, WebGPU三个后端。要创建渲染设备实例，需要选择其中一个后端。

```javascript

// 引入WebGL后端
// import { backendWebGL } from '@zephyr3d/backend-webgl';
// 引入WebGL2后端
// import { backendWebGL2 } from '@zephyr3d/backend-webgl';
// 引入WebGPU后端
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// 用于创建设备的画布
const canvas = document.querySelector('#canvas');
// 如果系统支持，创建设备
if (backendWebGPU.supported()) {
  const device = await backendWebGPU.createDevice(canvas);
  //
  if (!device) {
    console.error('Create device failed');
  }
}

```

## 渲染循环

使用Device渲染的每一帧必需包括在[device.beginFrame()](/doc/markdown/./device.abstractdevice.beginframe)和[device.endFrame()](/doc/markdown/./device.abstractdevice.endframe)之间，以下为实现渲染循环的方式

```javascript

function frame() {
  if(device.beginFrame()) {
    // DoSomething
    device.endFrame();
  }
  requestAnimationFrame(frame);
}

```

也可以使用[device.runLoop()](/doc/markdown/./device.abstractdevice.runloop)方法:

```javascript

device.runLoop(device => {
  // DoSomething
});

```

使用runLoop方法无需调用beginFrame()/endFrame()。
