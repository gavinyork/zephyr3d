# Basic framework

## Creating application

First, we need to create an application object.

**It's important to note that projects using the @zephyr3d/scene framework must have exactly one application instance!**

Once an application is created, the [getApp](/doc/markdown/./scene.getapp) global function can be used to access the global application instance.

```javascript
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Creates the application
const myApp = new Application({
  // Use WebGL2 as the rendering backend
  // Currently we support three types of backends：WebGL, WebGL2 and WebGPU。
  backend: backendWebGL2,
  // Canvas element
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device to be ready
myApp.ready().then(function(){
  // The app has been initialized, starts the rendering loop
  myApp.run();
});

```

This is the most basic application framework. It creates an application, then initializes the rendering environment and starts the main loop. Currently, we haven't done anything in the frame loop, so all you see is a black window. Next, we'll add some rendering code.
  
## Frame Event

Frame events are triggered once in every frame of the rendering loop, allowing us to execute updates and rendering within the event handler.

```javascript

import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Creates the application
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Wait for the device to be ready
myApp.ready().then(function(){
  // Respond to the frame event
  myApp.on('tick', function(){
    // clear the frame buffer to green
    myApp.device.clearFrameBuffer(new Vector4(0, 1, 0, 1), 1, 0);
  });
  // 应用已经初始化完成，开始渲染循环
  myApp.run();
});

```

In the code above, we fill the FrameBuffer with green within the frame loop. see [DeviceAPI](/en/device).

Now, you should be able to see a green screen.

<div class="showcase" case="tut-0"></div>

## Input Event

We can respond to user inputs by capturing events.

```javascript

import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Creates the application
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Wait for the device to be ready
myApp.ready().then(function () {
  let str = '';
  // Clear color
  const clearColor = new Vector4(0, 0, 0, 1);
  // Set device font
  myApp.device.setFont('16px arial');
  // Respond to frame event
  myApp.on('tick', function () {
    // Clear the frame buffer to black
    myApp.device.clearFrameBuffer(clearColor, 1, 0);
    // Draw text onto the screen
    myApp.device.drawText(str, 30, 30, '#ffff00');
  });
  // Respond to pointer move event
  myApp.on('pointermove', function (ev) {
    // update text
    str = `X:${ev.offsetX.toFixed()} Y:${ev.offsetY.toFixed()}`;
  });
  // Starts rendering loop
  myApp.run();
});

```

<div class="showcase" case="tut-1"></div>

Currently, we support capturing the following input events:

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

In many cases, when we handle input events, there is a priority involved. For example, in certain situations, we need to process the input for the UI part first. Only if the UI system has not dealt with the input do we trigger a scene click. To accommodate such scenarios, we have introduced a middleware pattern. You can sequentially register event handling functions as middleware. When there is user input, the middleware will be called in the order of registration until one of the middleware functions returns true. If all middleware returns false, then the event callback registered through [Application.on](/doc/markdown/./base.ieventtarget.on) will be called. Here is an example of using middleware:

```javascript

getInput().use(function(evt, type){
  return processGUIEvent(evt, type);
});
getInput().use(function(evt, type){
  if(type === 'pointerdown') {
    onPointerDown();
    return true;
  } else {
    return false;
  }
});

```

## Render scene

Let's demonstrate how to render a scene. First, we need to create a scene by constructing a [Scene](/doc/markdown/./scene.scene) object. A scene acts as a container that holds various elements that need to be rendered. Additionally, we require a camera object to perform the rendering of the scene. We can create a perspective camera by constructing a [PerspectiveCamera](/doc/markdown/./scene.perspectivecamera) object or an orthographic camera by constructing an [OrthoCamera](/doc/markdown/./scene.orthocamera). Finally, we render by calling the [camera.render()](/doc/markdown/./scene.camera.render) method.

```javascript

import { Application, PerspectiveCamera } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Scene } from '@zephyr3d/scene';

// Creates the application
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Wait for the device to be ready
myApp.ready().then(function () {
  // Creates a scene
  const scene = new Scene();
  // Creates a perspective camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
  // When the frame buffer size changes, reset the camera aspect ratio to avoid image distortion
  myApp.on('resize', function(width, height){
    camera.aspect = width / height;
  });
  // Process the frame event
  myApp.on('tick', function(){
    // Render the scene
    camera.render(scene);
  });
  // Starts the rendering loop
  myApp.run();
});

```

Running this code, we rendered an empty scene that only contains a default sky, with the following effect:

<div class="showcase" case="tut-2"></div>

## Tone mapping

The sky colors we rendered earlier looked a bit odd, and this is because the sky simulating atmospheric scattering requires tonemapping to achieve the correct visual effect. Let's proceed by adding a tonemapping post-process.

```javascript

// Enable tonemapping for camera. (tonemapping is enabled by default)
camera.toneMap = true;

// Passes the compositor as a second parameter to the render emthod
camera.render(scene, compositor);

```

Here is the effect after adding tonemapping:

<div class="showcase" case="tut-3"></div>

## Camera control

We control the camera by setting up controllers for it. Currently, we offer two types of controllers:

- FPSCameraController

  The FPSCameraController is designed for FPS shooting game mode, allowing camera movement and rotation through the WSAD keys and mouse movement.

- OrbitCameraController

  The OrbitCameraController enables camera control that revolves around a target point and zooms in and out.

Next, we will add a camera controller to the previously mentioned code.

```javascript

import { Application, PerspectiveCamera, OrbitCameraController } from '@zephyr3d/scene';

// ...

// Creates the camera
const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);

// Creates an orbit camera controller
camera.controller = new OrbitCameraController();

//...

// Add an input middleware to update the camera controller
getInput().use(camera.handleEvent.bind(camera));

//...

// We should update the controller state in the frame event callback
app.on('tick', function(){
  // Update camera controller state
  camera.updateController();
  // ...
  // ...
});

```  

Here is the result, try controlling the camera's viewing angle with the left mouse button.

<div class="showcase" case="tut-4"></div>
