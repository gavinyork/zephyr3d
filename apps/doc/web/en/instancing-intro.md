# Geometry instancing

Geometry instancing is an efficient graphics rendering technique that allows multiple instances
of the same renderable object to be drawn in a single draw call. This approach is particularly
useful for scenes that require rendering large numbers of identical objects repeatedly. With geometry
instancing, each instance shares the same geometry and material, but can have different positions,
rotations, and scales, as well as different material properties, significantly reducing memory usage
and improving rendering performance.

Zephyr3d provides support for instanced rendering for WebGL2 and WebGPU devices. The engine automatically
merges meshes that use the same geometry and material into one or several draw calls within the same scene.
In your code, you need to assign the same geometry and a copy of the same material to the objects that you
want to render as instances. A copy of the material is required because even for the same material, each
rendered instance may need to set different material properties individually.

The following code creates several boxes that are rendered as instances by sharing the same geometry and material:

```javascript

// Create the geometry
const boxShape = new BoxShape();

// Create the material
const material = new LambertMaterial();

// Create several boxes
for (let i = 0; i < 10; i++) {
  const box = new Mesh(scene);
  // Shares the same geometry
  box.primitive = boxShape;
  // Standalone material instance
  box.material = material.createInstance();
  // Set color of the material instance
  box.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
  // Set position of the instanace
  box.position.setXYZ(1, 2, 3);
}

```

Here is a complete example:

<div class="showcase" case="tut-44"></div>

## Dynamic batching

When using Mesh objects created with the above code, each object needs to undergo frustum culling
during the rendering process, and the visible objects are dynamically merged into a single draw
call. The advantage of this approach is that the number of instances is controlled through frustum
culling. However, if the number of instances is large, the culling and merging operations can result
in significant performance overhead. In such cases, static batching can be used instead.

## Static batching

Static batching accelerates rendering by caching the batched results of instances. For static batches,
instances will no longer perform frustum culling and dynamic merging. Objects in static batches can
change position, scale, and rotation, but changes to material instance properties will no longer take
effect. Using static batching is also straightforward; simply create a BatchGroup node as the parent
node of all instances.

<div class="showcase" case="tut-45"></div>

## Loading models

For models loaded with AssetManager, instanced rendering of the model can be enabled through the
[enableInstancing](/doc/markdown/./scene.modelfetchoptions) attribute in the loading options. Once
this attribute is added, the material will automatically call the createInstance() method.

```javascript

  const instancedModels = [];
  const nonInstancedModels = [];
  // model URL
  const modelUrl = 'http://model/path';
  for (let i = 0; i < 100; i++) {
    // Loading the same model and setting the enableInstancing property to true
    // automatically utilizes instanced rendering for these models.
    instancedModels.push(await getEngine().resourceManager.fetchModel(url, scene, {
      enableInstancing: true
    }));
  }
  for (let i = 0; i < 100; i++) {
    // Loading the same model without setting the enableInstancing property to true
    // will not use instanced rendering
    nonInstancedModels.push(await getEngine().resourceManager.fetchModel(url, scene));
  }

```

## Transparent Objects

In most cases, transparent objects need to be rendered from far to near, but if geometry instancing is used,
distance sorting is not possible. When using geometry instancing for transparent objects, it is recommended
to use Order-Independent Transparency (OIT) rendering techniques. We currently support two OIT rendering methods:

1. Weighted Blended, suitable for WebGL, WebGL2, and WebGPU devices
2. Per-Pixel Linked List, only applicable to WebGPU devices

For more details, refer to: [OIT Rendering](en/oit.md)
