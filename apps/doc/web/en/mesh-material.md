
# Mesh

A **Mesh** is a renderable object composed of vertex data and materials.

We use the `Mesh` object to represent a mesh.  
Constructing a `Mesh` object requires three parameters — **scene**, **primitive**, and **material**:  
- **scene**: the scene object to which the mesh will be added after creation.  
- **primitive**: the vertex data for the mesh. You can use the built‑in shapes `SphereShape`, `BoxShape`, `PlaneShape`, and `CylinderShape` to create spheres, boxes, planes, or cylinders, or you can manually fill your own data.  
- **material**: the material for this mesh. We support *Unlit* (non‑lit) materials, Lambert/Blinn materials, and PBR materials.

---

## Using Predefined Meshes

The system provides several predefined geometric primitives such as a box, sphere, cylinder, and plane.

The following example creates a cube mesh and assigns it a Lambert material.  
A directional light is added to illuminate the object (lighting will be discussed in later sections).

```javascript
import { Scene, Application, LambertMaterial, Mesh, OrbitCameraController, PerspectiveCamera, BoxShape } from '@zephyr3d/scene';

// ... ...

// Add a directional light to illuminate the mesh
const light = new DirectionalLight(scene);
light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

// Create a red Lambert material
const material = new LambertMaterial();
material.albedoColor = new Vector4(1, 0, 0, 1);

// Create a sphere mesh and assign the material
const sphere = new Mesh(scene, new SphereShape(), material);

// Create the main camera
// The mesh is located at world origin by default, so we place the camera at (0, 0, 4) looking toward the origin
scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
// Orbit controller with center at world origin
scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });
```

<div class="showcase" case="tut-5"></div>

Next, we'll assign a PBR material to the sphere and add texture maps.

We use [`ResourceManager`](/doc/markdown/./scene.resourcemanager)'s  
[`fetchTexture()`](/doc/markdown/./scene.resourcemanager.fetchtexture)  
method to load textures by URL.  
Loading results are cached — if a texture was already loaded, it will not be fetched again.

```javascript
// Create a PBR material
const material = new PBRMetallicRoughnessMaterial();
material.metallic = 0.9;
material.roughness = 0.6;

// Add an albedo (diffuse) texture
getEngine().resourceManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/earthcolor.jpg').then(texture => {
  material.albedoTexture = texture;
});

// Add a normal map texture
getEngine().resourceManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/earthnormal.png', {
  linearColorSpace: true
}).then(texture => {
  material.normalTexture = texture;
});
```

<div class="showcase" case="tut-6"></div>

---

## Loading Existing Materials

When using the editor workflow, you can create custom materials within the editor,  
then load them at runtime using  
[`ResourceManager.fetchMaterial()`](/doc/markdown/./scene.resourcemanager.fetchmaterial).

```javascript
const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    // When using the editor workflow, the asset path must be correctly configured
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-50')
  }
});

myApp.ready().then(function () {
  // Create scene and main light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Load material and create the mesh
  getEngine()
    .resourceManager.fetchMaterial('/assets/earth.zmtl')
    .then((material) => {
      new Mesh(scene, new SphereShape(), material);
    });

  // Create the main camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  // Enable interactive camera controls
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Register the scene as render layer 0
  getEngine().setRenderable(scene, 0);

  myApp.run();
});
```

<div class="showcase" case="tut-50"></div>

---

## Manually Filling Vertex Data

To create a mesh manually, you need to create vertex buffers and index buffers,
upload the data, and assign them to a mesh primitive.

The example below manually creates a simple triangle mesh using an Unlit material.

```javascript
// Create an unlit material
const material = new UnlitMaterial();
// Disable back-face culling
material.getRenderStateSet(0).useRasterizerState().setCullMode('none');
// Enable vertex colors
material.vertexColor = true;

// Fill vertex data for a triangle
const triangle = new Primitive();
const vertices = myApp.device.createVertexBuffer('position_f32x3', new Float32Array([
  2, -2, 0,
  0,  2, 0,
 -2, -2, 0
]));
const diffuse = myApp.device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255
]));
const indices = myApp.device.createIndexBuffer(new Uint16Array([0, 1, 2]));

triangle.setVertexBuffer(vertices);
triangle.setVertexBuffer(diffuse);
triangle.setIndexBuffer(indices);

// Create the mesh
const triangleMesh = new Mesh(scene, triangle, material);
```

<div class="showcase" case="tut-9"></div>

---

## Loading Models

The most common way to create a mesh is by loading an existing model.  
To keep the core lightweight, Zephyr3D does not embed file format loaders for every model type.  
Instead, models should first be imported into the editor and saved as **Zephyr3D prefabs** (`.zprefab` files),  
which can then be loaded through the `ResourceManager`.

```javascript

import { HttpFS, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    // When using the editor workflow, the asset path must be correctly configured
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-10')
  }
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Load a model
  getEngine()
    .resourceManager.instantiatePrefab(scene.rootNode, '/assets/Duck.zprefab')
    .then((model) => {
      model.position.setXYZ(0, -0.5, 0);
    });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 3), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});


```

<div class="showcase" case="tut-10"></div>
