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
both. See [Depth Convention](en/reverse-z.md).

Once the application exists, `getApp()`, `getEngine()`, `getDevice()` and `getInput()` reach the
instances from anywhere, so you do not have to thread references through your code.

## Choosing a backend

The example hard-codes WebGL2. Real projects usually prefer WebGPU and fall back:

```javascript
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

async function selectBackend() {
  if (await backendWebGPU.supported()) {
    return backendWebGPU;
  }
  return backendWebGL2;
}

const myApp = new Application({
  backend: await selectBackend(),
  canvas: document.querySelector('#my-canvas')
});
```

zephyr3d no longer supports WebGL1; the WebGL backend requires WebGL2.

Backend differences matter: WebGPU supports compute shaders and WebGL2 does not at all, and some
features (GPU culling, DOM shadows, DDGI) are WebGPU-only. The engine usually falls back silently
to an alternative when a capability is missing.

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

### Render layers and render order

The second argument of `setRenderable(renderable, layer)` is a **render layer** index. The engine
keeps one renderable per layer and, every frame after the `tick` event, renders the layers in
ascending index order:

- **One renderable per layer.** Calling it again for the same layer replaces the previous
  renderable; passing `null` clears the layer. Indices need not be contiguous; empty layers are
  skipped.
- **Higher layers draw later, on top of lower ones.** Layering is mainly for overlays: layer 0
  draws the main scene, higher layers draw a minimap, picture-in-picture or a debug view. A camera
  clears its own render area to black by default, so give an overlay layer's camera a `viewport`
  limiting where it draws; a full-screen upper layer would cover everything below it.
- **A scene only updates while it is rendered.** Node updates, animation and the main camera's
  controller run as part of rendering the scene. A scene taken off all layers stops updating; a
  scene placed on several layers is still updated once per frame.
- **A layer holds a reference to its scene.** A scene on a layer is never released. Once it is
  replaced or cleared and nothing else references it, it is disposed on the next frame. If you
  switch back and forth between scenes, hold each one yourself with a `DRef` (from
  `@zephyr3d/base`), or it will already be disposed when you switch back.

The optional third argument is a hook object: `beforeRender(scene)` is called before the layer
renders and can return `false` to skip it; `afterRender(scene)` is called afterwards. Here is
picture-in-picture: the same scene sits on layers 0 and 1, and layer 1 shrinks the camera
viewport to a small window in the lower-left corner before rendering, then restores it.

<<< @/../src/tut-46/main.js{36-45 js}

`setRenderable()` also accepts a function, called every frame on that layer. Use it when you drive
rendering yourself, for example calling `camera.render(scene)` for several cameras. See
[Multi-viewport rendering](en/multi-views.md) for more.

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
