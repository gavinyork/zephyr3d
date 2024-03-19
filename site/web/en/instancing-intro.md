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
