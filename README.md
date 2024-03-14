<div align="center">

# Zephyr3d

> WebGL & WebGPU rendering engine

[User manual](https://gavinyork.github.io/zephyr3d/) | [API reference](https://gavinyork.github.io/zephyr3d/#/doc/markdown/index) | [Demos](https://gavinyork.github.io/zephyr3d/demo.html)

[![Test](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene)](https://www.npmjs.com/package/@zephyr3d/scene)

</div>

Zephyr3d is a 3D rendering engine for browsers, developed in TypeScript. It is easy to use and highly extensible, with seamless support for both WebGL and WebGPU.

Zephyr3d primarily consists of two sets of APIs: the Device API and the Scene API.

- Device API

  Device API offers a set of low-level abstract encapsulation interfaces that allow users to invoke the WebGL, WebGL2, and WebGPU graphics interfaces in exactly the same way. These interfaces encompass most of the capabilities of the underlying APIs, facilitating easy support for cross-API graphics rendering. 

- Scene API

  Scene API is a high-level rendering framework built on top of DeviceAPI, serving both as a test environment for device API and as a direct tool for graphics development. Currently, Scene API has implemented features such as PBR/IBL rendering, clustered lighting, shadow mapping, terrain rendering, post processing, among others.

**Note: The engine is currently in the early stages of development and is not recommended for use in production projects.**

## Install

Zephyr3d is released as ES6 modules and requires npm for installation. It is designed to be used in conjunction with front-end build tools such as Webpack or Vite for development.

```bash
# Install the device API package
npm install --save @zephyr3d/device
# If you want to use WebGL as the rendering backend,
# you need to install this package.
npm install --save @zephyr3d/backend-webgl
# If you want to use WebGPU as the rendering backend,
# you need to install this package.
npm install --save @zephyr3d/backend-webgpu
# To use the scene API, you need to install this package.
npm install --save @zephyr3d/scene
```

## Usage



Here is an example of rendering a cube using the Scene API.

```javascript
import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, LambertMaterial, Mesh, OrbitCameraController, PerspectiveCamera, SphereShape, DirectionalLight } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Creates the application.
const myApp = new Application({
  // Use WebGL2 rendering backend.
  backend: backendWebGL2,
  // The canvas element
  canvas: document.querySelector('#my-canvas')
});

// Wait for the application to be ready.
myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Create a lambert material
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 0, 0, 1);
  // Create a sphere mesh
  const sphere = new Mesh(scene, new SphereShape(), material);

  // Create camera with orbit controll
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
  camera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ center: Vector3.zero() });

  // Handle camera input events
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // frame animation
  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
  });

  // Starts rendering loop
  myApp.run();
});
```

You can also directly utilize the DeviceAPI for low-level rendering, eliminating the need to include the @zephyr3d/scene package. Here is an example of rendering using the Device API.

```javascript
import { Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

(async function() {
  // Create WebGL2 device
  const canvas = document.querySelector('#canvas');
  const device = await backendWebGL2.createDevice(canvas);
  // Create vertex buffers
  const positions = device.createVertexBuffer('position_f32x2', new Float32Array([-0.3, -0.7, 0.3, -0.7, 0, 0.7]));
  const colors = device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  // Create vertex input layout object
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [{
      buffer: positions
    }, {
      buffer: colors
    }]
  });
  // We create shaders using JavaScript, which then
  // automatically generates GLSL or WGSL.
  const program = device.buildRenderProgram({
    vertex(pb) {
      // Vertex stream definitions
      this.$inputs.position = pb.vec2().attrib('position');
      this.$inputs.color = pb.vec4().attrib('diffuse');
      // Varying definitions
      this.$outputs.color = pb.vec4();
      // Entry point
      pb.main(function(){
        this.$builtins.position = pb.vec4(this.$inputs.position, 0, 1);
        this.$outputs.color = this.$inputs.color;
      });
    },
    fragment(pb) {
      // Color output
      this.$outputs.color = pb.vec4();
      // Entry point
      pb.main(function(){
        this.$outputs.color = pb.vec4(pb.pow(this.$inputs.color.rgb, pb.vec3(1/2.2)), 1);
      });
    }
  });

  // Frame animation
  function frame() {
    requestAnimationFrame(frame);
    if (device.beginFrame()) {
      // Clear frame buffers
      device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
      // Set current shader
      device.setProgram(program);
      // Set vertex input
      device.setVertexLayout(vertexLayout);
      // Render triangles
      device.draw('triangle-list', 0, 3);
      // Display some text
      device.drawText(`Device: ${device.type}`, 30, 30, '#ffffff');
      device.drawText(`FPS: ${device.frameInfo.FPS.toFixed(2)}`, 30, 50, '#ffff00');
      device.endFrame();
    }
  }

  // start rendering loop
  frame();

})();

```
## License

Zephyr3d is released under the [MIT](https://opensource.org/licenses/MIT) license.
