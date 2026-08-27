# Your First Application

This page starts from an empty project and gets something on screen. It assumes you have
[installed the packages](en/installation.md) and use a bundler such as Vite.

## The HTML scaffold

The engine renders into a canvas element. Let it fill the window:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Zephyr3d app</title>
    <style>
      * { margin: 0; padding: 0; }
      html, body { width: 100vw; height: 100vh; }
      canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <canvas id="my-canvas"></canvas>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

The canvas CSS size drives the render resolution, and the engine follows changes to it
automatically — you do not need to handle window resize yourself.

## Creating the application

A Zephyr3d project has **exactly one** `Application` instance.

<<< @/../src/tut-0/main.js{js}

Three steps:

1. `new Application({ backend, canvas })` — pick a backend and a canvas.
2. `myApp.ready()` — returns a promise that resolves once the rendering device is initialized.
   Every engine call belongs after this.
3. `myApp.run()` — starts the main loop.

The main loop fires a `tick` event once per frame, and updates and drawing go in its callback. The
example clears the frame to green each frame, so you get a solid green screen.

<div class="showcase" case="tut-0"></div>

About the depth argument to `clearFrameBuffer()`: **use the `DEPTH_CLEAR_VALUE` constant from
`@zephyr3d/base` instead of hard-coding 0 or 1**. The engine supports the reverse-Z depth
convention, which changes which value corresponds to the near plane; this constant is correct under
both.

Once the application exists, `getApp()`, `getEngine()`, `getDevice()` and `getInput()` reach the
instances from anywhere, so you do not have to thread references through your code.

## Choosing a backend

The example hard-codes WebGL2. Real projects usually prefer WebGPU and fall back:

```javascript
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

async function selectBackend() {
  if (await backendWebGPU.supported()) {
    return backendWebGPU;
  }
  if (await backendWebGL2.supported()) {
    return backendWebGL2;
  }
  return backendWebGL1;
}

const myApp = new Application({
  backend: await selectBackend(),
  canvas: document.querySelector('#my-canvas')
});
```

Backend differences matter: WebGPU supports compute shaders and WebGL does not at all, and some
features (ABuffer OIT, DOM shadows) are WebGPU-only. The engine usually falls back silently to an
alternative when a capability is missing, so **test on your target devices** rather than assuming
that code without errors means the feature is active.

## Rendering a scene

Clearing the screen is not yet 3D. Rendering a scene takes three things: a `Scene` holding the
renderable objects, a camera defining the viewpoint, and registering the scene as an active
renderable.

<<< @/../src/tut-2/main.js{16-21 js}

- `new Scene()` creates the scene container.
- `new PerspectiveCamera(scene, fovY, near, far)` creates a perspective camera. Aspect ratio is an
  optional 5th argument; `autoAspect` is on by default and follows the render target, so you
  normally omit it. Use `OrthoCamera` for orthographic projection.
- `getEngine().setRenderable(scene, 0)` makes the scene the active renderable on layer 0.
  **Without this call nothing appears, even with a scene and camera set up.**

The camera above is never assigned to a variable yet still works, because **when a scene has no main
camera, a newly constructed camera automatically becomes that scene's `mainCamera`**. Still capture
it explicitly when you need to work with it later.

<div class="showcase" case="tut-2"></div>

## Making the camera interactive

The scene is empty and the camera cannot move yet. Add an orbit controller:

<<< @/../src/tut-4/main.js{20-24 js}

Both lines are needed: setting `controller` only attaches the controller — it also has to be wired
into the input system with `getInput().use(...)` before it receives any events. The second argument
is the `this` value used when calling `handleEvent`.

Beyond that, a controller also needs its state **advanced every frame** to work, since that is when
it applies inertia, damping and smooth follow. The entry point is `camera.updateController()`:

```javascript
myApp.on('tick', function () {
  scene.mainCamera.updateController();
});
```

The example above omits this line because **the scene's `mainCamera` is updated automatically**: the
scene's per-frame update calls `mainCamera.updateController()` for you. With a single main camera you
do not need to call it yourself.

These two cases do require calling it, or the controller will appear to do nothing despite being
attached:

- the camera is **not** the scene's `mainCamera` (a secondary camera in multi-viewport rendering, for
  instance);
- you bypass `setRenderable()` and drive rendering yourself with `camera.render(scene)` inside
  `tick`, for a camera that is not the `mainCamera`.

Conversely, **each camera should be updated exactly once per frame**. The engine makes no guarantee
that calling it more than once within a frame is safe, so do not add a manual call for a main camera
that is already updated automatically.

<div class="showcase" case="tut-4"></div>

Try dragging with the left mouse button and zooming with the wheel.

## Next

You now have an interactive, empty scene. Time to put things in it:

- [Adding Models and Materials](en/first-scene.md) — meshes, model loading, lighting
- [Shadows and Post-processing](en/first-polish.md) — making it look presentable
