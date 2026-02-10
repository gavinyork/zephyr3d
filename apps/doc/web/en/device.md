# Rending device

The ([rendering device](/doc/markdown/./device.abstractdevice)) is an abstract interface that encapsulates most of the underlying graphics API functions, serving as the core of the Device API.

## Creating device

The rendering device is an abstract interface, and we have currently implemented three backends: WebGL, WebGL2, and WebGPU. To create an instance of the rendering device, one of these backends must be selected.

```javascript

// Importing WebGL backend
// import { backendWebGL } from '@zephyr3d/backend-webgl';
// Importing WebGL2 backend
// import { backendWebGL2 } from '@zephyr3d/backend-webgl';
// Importing WebGPU backend
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// The canvas element for creating device
const canvas = document.querySelector('#canvas');
// Creates device if it is being supported
if (await backendWebGPU.supported()) {
  const device = await backendWebGPU.createDevice(canvas);
  if (!device) {
    console.error('Create device failed');
  }
}

```

## Rendering Loop

Every frame rendered using a Device must be enclosed between [device.beginFrame()](/doc/markdown/./device.abstractdevice.beginframe) and [device.endFrame()](/doc/markdown/./device.abstractdevice.endframe). 


```javascript

function frame() {
  // Frame begins
  if(device.beginFrame()) {

    // Do some rendering 
    // ...

    // Frame ends
    device.endFrame();
  }
  requestAnimationFrame(frame);
}

```

You can also use the [device.runLoop()](/doc/markdown/./device.abstractdevice.runloop) method without calling beginFrame() and endFrame():

```javascript

device.runLoop(device => {
    // Do some rendering 
    // ...
});

```
