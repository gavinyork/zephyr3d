# Scene Picking

Scene picking is a technique for selecting objects in a virtual scene using a mouse or other input device, and it is crucial for implementing scene interactions. There are mainly two picking techniques: Raycasting and Color Picking.

## Raycasting

Raycasting is a CPU-based picking algorithm. The principle is to generate a ray in the world coordinate system (or camera coordinate system) based on the position of the mouse or other input device and then perform collision detection between the ray and the objects in the scene to identify the picked object.

### Implementation Steps:

1. Construct a ray passing through the screen coordinates based on the mouse position.
2. Detect intersections between the ray and the scene.
3. Return the picked scene node, intersection distance, and intersection point.

```javascript

// Assuming x and y are the screen coordinates relative to the top-left corner of the viewport, pick the object at that position.

const ray = camera.constructRay(x, y);
// Perform raycasting on the scene
const pickResult = scene.raycast(ray);
// Return the picked scene node, intersection distance, and intersection point; otherwise, return null.
if (pickResult) {
  console.log(`Node: ${pickResult.node}`);
  console.log(`Distance: ${pickResult.dist}`);
  console.log(`Intersection Point: ${pickResult.point}`);
}

```

<div class="showcase" case="tut-47"></div>

## Color Picking

Color Picking uses the GPU for pixel-level picking. The principle is to render objects with different colors to a 1x1 texture, then read that texture to determine the picked object based on the color.

Notes:
- For WebGL devices, reading textures is a blocking operation and may cause stuttering. Therefore, it is recommended to use Color Picking on WebGL2 or WebGPU devices.
- Color Picking requires a scene rendering.
- For scenarios where picking is performed every frame, the result is from the previous frame. For single-shot picking, the result needs to be obtained asynchronously.

### Implementation Steps:

1. Enable the camera's picking functionality.
2. Update the picking position in the mouse move event.
3. Render the scene and get the picking result.

```javascript

// Enable picking while rendering
camera.enablePicking = true;

// Update picking position on mouse move
app.device.canvas.addEventListener('pointermove', (ev) => {
  camera.pickPosX = ev.offsetX;
  camera.pickPosY = ev.offsetY;
});

// After rendering, get the picking result
// Note: For WebGL2 and WebGPU devices, picking is an asynchronous process, so the result obtained this time is actually from the previous frame.
app.on('tick', () => {
  // Render the scene first
  camera.render(scene);
  // Get the picking result. If no object is picked, return null.
  const pickResult = camera.pickResult;
  if (pickResult) {
    // drawable is the picked rendering object
    console.log(pickResult.drawable);
    // node is the picked node
    console.log(pickResult.node);
  }
});

```

<div class="showcase" case="tut-48"></div>

### Asynchronously Getting Single-Shot Picking Results

When picking is not needed every frame, it is possible to get the result asynchronously. 
For example, picking once upon a mouse click:

```javascript

// Enable picking while rendering
camera.enablePicking = true;

// Update picking position on mouse move
app.device.canvas.addEventListener('pointermove', (ev) => {
  camera.pickPosX = ev.offsetX;
  camera.pickPosY = ev.offsetY;
});

app.on('tick', () => {
  // Render the scene first
  camera.render(scene);
  // Asynchronously get the picking result. If no object is picked, return null.
  camera.pickResultAsync.then((pickResult) => {
    if (pickResult) {
      // drawable is the picked rendering object
      console.log(pickResult.drawable);
      // node is the picked node
      console.log(pickResult.node);
    }
  });
});

```
