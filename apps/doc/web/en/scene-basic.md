
# Basic Framework

## Creating an Application

First, we need to create an **application** object.

> **Note:**  
> Projects using the `@zephyr3d/scene` framework **must have exactly one application instance**!

Once the application is created, you can access the global instance using the [`getApp`](/doc/markdown/./scene.getapp) function.

```javascript
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Create an application instance
const myApp = new Application({
  // Use WebGL2 as the rendering backend
  // Currently supported backends: WebGL, WebGL2, and WebGPU
  backend: backendWebGL2,
  // Canvas element used for rendering
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device to initialize
myApp.ready().then(function () {
  // Application is ready, start the render loop
  myApp.run();
});
```

The above example shows the most basic application framework. It creates the application, initializes the rendering environment, and starts the main loop.  
Since nothing is rendered yet, the window will simply appear black. Let’s add some rendering logic next.

---

## Adding Frame Event Handling

The **frame event** is triggered once every frame during the render loop.  
We can perform scene updates or custom drawing logic within this handler.

```javascript
// Import Vector4
import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Create an application instance
const myApp = new Application({
  // Use WebGL2 as the rendering backend
  backend: backendWebGL2,
  // Canvas element used for rendering
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device to be ready
myApp.ready().then(function () {
  // Add a frame event handler
  myApp.on('tick', function () {
    // 'device' is the rendering device.
    // clearFrameBuffer clears the screen — 
    // first argument: RGBA color, second: depth clear value, third: stencil clear value
    myApp.device.clearFrameBuffer(new Vector4(0, 1, 0, 1), 1, 0);
  });

  // Start the render loop
  myApp.run();
});
```

Now you should see a **green screen**.

<div class="showcase" case="tut-0"></div>

---

## Handling Input

We can respond to user input by handling events exposed by the application instance.

```javascript
// Import Vector4
import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Create an application instance
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device
myApp.ready().then(function () {
  let str = '';
  // Set a font for text rendering
  myApp.device.setFont('16px arial');

  // Frame event handler
  myApp.on('tick', function () {
    // Clear framebuffer to black
    myApp.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
    // Draw text on the screen
    myApp.device.drawText(str, 30, 30, '#ffff00');
  });

  // Pointer move event handler
  myApp.on('pointermove', function (ev) {
    // Update coordinate text
    str = `X:${ev.offsetX.toFixed()} Y:${ev.offsetY.toFixed()}`;
  });

  // Start render loop
  myApp.run();
});
```

<div class="showcase" case="tut-1"></div>

The canvas automatically binds the following input events and forwards them through the `Application` instance:

- pointerdown  
- pointerup  
- pointermove  
- pointercancel  
- keydown  
- keyup  
- keypress  
- drag  
- dragenter  
- dragleave  
- dragstart  
- dragend  
- dragover  
- drop  
- wheel  
- compositionstart  
- compositionupdate  
- compositionend

In many cases, input events have **priority layers** — for example, you may want to handle UI events first before passing unhandled inputs to the scene.  

For such scenarios, Zephyr3D provides an **input middleware system**.  
You can register multiple middleware functions; they are executed sequentially until one returns `true`.  
If all return `false`, then event handlers registered via `Application.on` will be called.

Example:

```javascript
// Prioritize UI event handling
getInput().use(function (evt, type) {
  return processGUIEvent(evt, type);
});

// If UI did not handle the event (processGUIEvent returns false),
// this middleware will handle it
getInput().use(function (evt, type) {
  if (type === 'pointerdown') {
    onPointerDown();
    return true;
  } else {
    return false;
  }
});
```

---

## Rendering a Scene

Now, let’s look at how to render an actual scene.

First, create a **Scene** object, which serves as a container for renderable elements.  
Then, create a camera — either a **PerspectiveCamera** (for perspective projection) or an **OrthoCamera** (for orthographic projection).  
Finally, use the engine’s `setRenderable()` method to set the active renderable scene.

```javascript
import { Application, PerspectiveCamera, Scene } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Create an application instance
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device
myApp.ready().then(function () {
  // Create a scene
  const scene = new Scene();
  // Create the main camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  // Set the scene as the active renderable for layer 0
  getEngine().setRenderable(scene, 0);
  // Start the render loop
  myApp.run();
});
```

With this code, we render an empty scene. The result should look like this:

<div class="showcase" case="tut-2"></div>

---

## Camera Control

We can control the camera by assigning a **controller** to it.  
Currently, Zephyr3D provides two built-in camera controllers:

- **FPSCameraController**  
  Implements a first-person shooter–style camera control.  
  Move the camera using **W/A/S/D** keys, and look around with the mouse.

- **OrbitCameraController**  
  Enables orbiting and zooming around a target point.

Let’s extend the previous example with a camera controller:

```javascript
import { Application, PerspectiveCamera, OrbitCameraController } from '@zephyr3d/scene';

// ...

// Create the camera
scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);

// Add an orbit camera controller
scene.mainCamera.controller = new OrbitCameraController();

// Enable camera controller to receive input by registering it as middleware
getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

// ...
```

Now, try dragging the left mouse button — you can rotate the camera around the scene’s target point.

<div class="showcase" case="tut-4"></div>
