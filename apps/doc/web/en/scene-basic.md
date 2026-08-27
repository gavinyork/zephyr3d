
# Basic Framework

## Creating an Application

First, we need to create an **application** object.

> **Note:**  
> Projects using the `@zephyr3d/scene` framework **must have exactly one application instance**!

Once the application is created, you can access the global instance using the [`getApp`](/doc/markdown/./scene.getapp) function.

```javascript
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  myApp.run();
});
```

`Application` takes two required options:

- `backend` — the rendering backend. Available choices are `backendWebGL` and `backendWebGL2`
  (both from `@zephyr3d/backend-webgl`) and `backendWebGPU` (from `@zephyr3d/backend-webgpu`).
- `canvas` — the canvas element to render into.

`ready()` returns a promise that resolves once the rendering device is initialized, and `run()`
starts the main loop. This code only brings up the rendering environment — the frame loop does
nothing yet, so you get a black window. Let's put something in it.

---

## Adding Frame Event Handling

The **frame event** is triggered once every frame during the render loop.  
We can perform scene updates or custom drawing logic within this handler.

<<< @/../src/tut-0/main.js{js}

The important call is `clearFrameBuffer()` on line 20, which clears the whole frame to green.
Its three arguments are:

- the clear color for the color buffer (a `Vector4`, RGBA);
- the depth buffer clear value — **use the `DEPTH_CLEAR_VALUE` constant from `@zephyr3d/base`
  instead of hard-coding 0 or 1**. The engine supports the reverse-Z depth convention, which
  changes which value corresponds to the near plane; this constant is correct under both;
- the stencil buffer clear value.

Passing `null` for depth or stencil skips clearing that buffer.

Now you should see a **green screen**.

<div class="showcase" case="tut-0"></div>

---

## Handling Input

Input is subscribed the same way as `tick`. The example below tracks the pointer and draws its
coordinates on screen:

<<< @/../src/tut-1/main.js{js}

A few things worth noting:

- The `pointermove` handler on line 29 only updates the `str` variable; the actual drawing happens
  in `tick` on line 26. Keeping input handling separate from rendering is deliberate: an event can
  fire several times within one frame, while drawing only needs to happen once per frame.
- Line 18 hoists `clearColor` out of the loop. Allocating `new Vector4()` every frame creates
  avoidable GC pressure, which is especially worth avoiding for math objects.
- `drawText()` requires a font to be set first via `setFont()` (line 20).

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

Rendering a scene takes three things: a `Scene` to hold the renderable elements, a camera that
decides the viewpoint, and registering the scene as an active renderable.

<<< @/../src/tut-2/main.js{js}

Looking at lines 17, 19 and 21:

- `new Scene()` creates the scene container.
- `new PerspectiveCamera(scene, ...)` creates a perspective camera. The arguments are the
  **owning scene, vertical field of view (radians), near plane and far plane**. Aspect ratio is an
  optional 5th argument, but the camera enables `autoAspect` by default and keeps it in sync with
  the render target, so you normally don't pass it. Use `OrthoCamera` for orthographic projection.
- `getEngine().setRenderable(scene, 0)` makes the scene the active renderable on layer 0. Without
  this call nothing appears on screen, even with a scene and camera set up.

Note that the camera here is never assigned to anything, yet the scene still renders: **when a
scene has no main camera yet, a newly constructed camera automatically becomes that scene's
`mainCamera`**. When you need to work with the camera afterwards — to attach a controller, for
instance — still capture it explicitly as `scene.mainCamera = new PerspectiveCamera(...)`, the way
the next section does.

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

<<< @/../src/tut-4/main.js{js}

Only two lines differ from the previous section (lines 22 and 24):

- `scene.mainCamera.controller = new OrbitCameraController({ center: ... })` attaches the
  controller, where `center` is the point to orbit around.
- `getInput().use(scene.mainCamera.handleEvent, scene.mainCamera)` wires the controller into the
  input system. **Setting `controller` without this registration leaves the controller with no
  input, and the camera will not respond to the mouse.** The second argument is the `this` value
  used when calling `handleEvent`.

Now, try dragging the left mouse button — you can rotate the camera around the scene’s target point.

<div class="showcase" case="tut-4"></div>
