# Mesh

A Mesh is a rendering object composed of vertex data and materials.

To represent a mesh, we use a [Mesh](/doc/markdown/./scene.mesh) object, which requires three parameters for its construction: scene, primitive, and material. The scene refers to the scene object to which the mesh will be added after its construction. The primitive is the vertex data of the mesh. This can be created using built-in shapes such as [SphereShape](/doc/markdown/./scene.sphereshape), [BoxShape](/doc/markdown/./scene.boxshape), [PlaneShape](/doc/markdown/./scene.planeshape), and [CylinderShape](/doc/markdown/./scene.cylindershape) for spheres, boxes, planes, and cylinders, respectively, or it can be manually filled. The material is the mesh's material, supporting various types including non-illuminated (unlit) materials, Lambert/Blinn materials, and PBR (Physically Based Rendering) materials.

## Predefined Meshes

The system comes equipped with several common types of mesh vertex data, such as boxes, spheres, cylinders, and planes.

The following code snippet creates a cube mesh and applies a Lambert material to it.

We also add a directional light to the scene to illuminate the mesh. Details on light sources and lighting will be covered in-depth in subsequent chapters.

```javascript

import { Scene, Application, LambertMaterial, Mesh, OrbitCameraController, PerspectiveCamera, BoxShape } from '@zephyr3d/scene';

// ... ...

// Add a directional light to illuminate the object
const light = new DirectionalLight(scene);
light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

// Create a red Lambert material
const material = new LambertMaterial();
material.albedoColor = new Vector4(1, 0, 0, 1);

// Create a sphere mesh and assign the material we just created
const sphere = new Mesh(scene, new SphereShape(), material);

// Creates the camera
// The created mesh is at the world coordinate system origin by default, and we place the camera at (0,0,4) and look at the origin
scene.mainCamera = new PerspectiveCamera(scene, Math.PI/3, 1, 100);
scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
// Set center of orbit camera controller to origin
scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });

```

<div class="showcase" case="tut-5"></div>

Next, we'll apply a PBR material to the sphere and add textures.

To load the textures, we use the fetchTexture() method of the [AssetManager](/doc/markdown/./scene.assetmanager) class. The [AssetManager.fetchTexture()](/doc/markdown/./scene.assetmanager.fetchtexture) method requires a URL address as a parameter and an optional Options object.

The AssetManager caches loaded resources, avoiding reloading if the resource has already been loaded.


```javascript

import { AssetManager } from "@zephyr3d/scene";

// ... ...

const assetManager = new AssetManager();

// Creates a PBR material
const material = new PBRMetallicRoughnessMaterial();
// metallic 0.9
material.metallic = 0.9;
// roughness 0.6
material.roughness = 0.6;
// Adds the diffuse texture
assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/earthcolor.jpg').then(texture => {
  material.albedoTexture = texture;
});
// Adds the normal map
assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/earthnormal.png', {
  linearColorSpace: true
}).then(texture => {
  material.normalTexture = texture;
});

```

<div class="showcase" case="tut-6"></div>

## Manually populate mesh vertices

To manually populate vertex data, we need to create vertex buffer and index buffer device objects, and then submit the vertex and index data.
For more details about vertex buffer, see [Buffer](/en/buffer).

Below, we'll create an unlit triangle mesh by manually populating the vertex data.

```javascript

  // Creates an unlit material
  const material = new UnlitMaterial();
  // Disable backface culling
  material.getRenderStateSet(0).useRasterizerState().setCullMode('none');
  // Use vertex color
  material.vertexColor = true;

  // Populate vertex data
  const triangle = new Primitive();
  const vertices = myApp.device.createVertexBuffer('position_f32x3', new Float32Array([2, -2, 0, 0, 2, 0, -2, -2, 0]));
  const diffuse = myApp.device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  const indices = myApp.device.createIndexBuffer(new Uint16Array([0, 1, 2]));
  triangle.setVertexBuffer(vertices);
  triangle.setVertexBuffer(diffuse);
  triangle.setIndexBuffer(indices);
  // Create the mesh
  const triangleMesh = new Mesh(scene, triangle, material);

```
<div class="showcase" case="tut-9"></div>

## Load model

The most common method for creating meshes is to load existing models. Currently, we support GLTF/GLB models. Loading models can be conveniently done through the AssetManager.

```javascript

  // Load model into scene
  getEngine().serializationManager.fetchModel('assets/models/Duck.glb', scene).then(info => {
    info.group.position.setXYZ(0, 0, -10);
  });

```

<div class="showcase" case="tut-10"></div>
