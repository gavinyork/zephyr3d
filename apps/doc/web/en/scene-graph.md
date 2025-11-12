# Scene Graph

We use a structure called a scene graph to describe the objects that need to be rendered. In the scene graph, each object with spatial attributes is called a node, and all nodes are saved in a tree structure.

## Scene Node

A scene node is used to describe an object with spatial attributes, or in other words, the node itself represents a coordinate system. The position, rotation, and scale of the node describe the coordinate transformation of the node's own coordinate system relative to the parent node's coordinate system. With this hierarchical relationship of nodes, moving a parent node will cause all its child nodes to move, rotate, and scale accordingly.

Types with spatial properties, such as meshes, terrains, light sources, and cameras, all inherit from the scene node.

The following code demonstrates how to control the rotation and position of a node through its rotation and position attributes.

```javascript

  let x = 0;
  myApp.on('tick', function () {
    // Updates the sphere rotation
    sphere.rotation = Quaternion.fromAxisAngle(new Vector3(0, 1, 0), x);
    // Update the sphere position
    sphere.position.y = Math.sin(x);
    x += 0.04;
  });

```

<div class="showcase" case="tut-7"></div>

## Node hierarchical Relationships

Nodes in a scene are stored in a tree structure, with each node's spatial transformation being relative to its parent node. The following example demonstrates how the hierarchical relationships of nodes affect their spatial transformations.

```javascript

  // All sphere meshes share the same vertex data and materials, allowing for rendering with geometry instances on WebGL2 and WebGPU devices
  const spherePrimitive = new SphereShape();
  // Create a sphere mesh as the parent node
  const sphere1 = new Mesh(scene, spherePrimitive, material);
  // Create a sphere mesh as a child of sphere1 with the X axis 8 units away from the sphere1 node
  const sphere2 = new Mesh(scene, spherePrimitive, material);
  sphere2.parent = sphere1;
  sphere2.position.x = 8;
  // Create a sphere mesh as a child of sphere2 with the Y axis 4 units away from the sphere2 node
  const sphere3 = new Mesh(scene, spherePrimitive, material);
  sphere3.parent = sphere2;
  sphere3.position.y = 4;

  let x = 0;
  myApp.on('tick', function () {
    // Sphere1 rotates about the Z-axis
    sphere1.rotation = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), x);
    // Sphere2 rotates about the x-axis
    sphere2.rotation = Quaternion.fromAxisAngle(new Vector3(1, 0, 0), x * 8);
    x += 0.01;
  });

```

<div class="showcase" case="tut-8"></div>
