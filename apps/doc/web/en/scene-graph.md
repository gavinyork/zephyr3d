# Scene Graph

We use a structure called a scene graph to describe the objects that need to be rendered. In the scene graph, each object with spatial attributes is called a node, and all nodes are saved in a tree structure.

## Scene Node

A scene node is used to describe an object with spatial attributes, or in other words, the node itself represents a coordinate system. The position, rotation, and scale of the node describe the coordinate transformation of the node's own coordinate system relative to the parent node's coordinate system. With this hierarchical relationship of nodes, moving a parent node will cause all its child nodes to move, rotate, and scale accordingly.

Types with spatial properties, such as meshes, terrains, light sources, and cameras, all inherit from the scene node.

The following code demonstrates how to control the rotation and position of a node through its `rotation` and `position` attributes.

<<< @/../src/tut-7/main.js{55-62 js}

`rotation` is a `Quaternion`, usually built with `Quaternion.fromAxisAngle(axis, radians)`.
`position` is a `Vector3`, and you can assign just one component as shown above.

Both properties are **relative to the parent node**. In this example the sphere sits directly under
the scene root, so they read as world coordinates; once a node has a parent, they become a local
transform relative to that parent — see the next section.

<div class="showcase" case="tut-7"></div>

## Node hierarchical Relationships

Nodes in a scene are stored in a tree structure, with each node's spatial transformation being relative to its parent node. The following example demonstrates how the hierarchical relationships of nodes affect their spatial transformations.

Three spheres are chained into a sphere1 → sphere2 → sphere3 hierarchy:

<<< @/../src/tut-8/main.js{43-54 js}

Then only the first two are rotated:

<<< @/../src/tut-8/main.js{65-72 js}

When you run it, sphere3 traces a compound path through space even though it is never given a
rotation of its own — it inherits sphere2's rotation, which in turn inherits sphere1's. That is what
hierarchical transforms do: **a parent's transform accumulates onto all of its descendants**.

Note that `spherePrimitive` and `material` are shared by all three meshes (line 44). Besides saving
memory, this lets the engine merge them into instanced draws on WebGL2 and WebGPU — see
[Geometry Instancing](en/instancing-intro.md).

<div class="showcase" case="tut-8"></div>

## Traversal and Lookup

Once a node tree exists, you often need to find nodes in it or process them in bulk.

```javascript
// Find a descendant by name; returns null when not found
const head = model.findNodeByName('Head');

// Walk self and all descendants, top-down.
// Returning true means "found it / done" and aborts the walk; iterate() returns that result.
model.iterate((node) => {
  // castShadow is declared on Mesh, not SceneNode, so this type guard is required
  if (node.isMesh()) {
    node.castShadow = false;
  }
});

// Bottom-up walk, for when children must be processed before their parent
model.iterateBottomToTop((node) => { /* ... */ });
```

Inside an `iterate()` callback it is common to discriminate node types with the type-guard methods,
which also narrow the type for TypeScript: `isMesh()`, `isLight()`, `isCamera()`, `isSprite()`,
`isParticleSystem()`, `isWater()`, `isBatchGroup()` and others.

Immediate hierarchy is reachable through `parent`, `children`, `hasChild()` and `isParentOf()`.

## Visibility

Node visibility is controlled by `showState`, which is `'visible'`, `'hidden'` or `'inherit'`
(the default, inheriting from the parent):

```javascript
// Hide this node and all of its descendants
model.showState = 'hidden';
```

The read-only `hidden` property returns the **resolved** result: when a node is `'inherit'`, the
lookup walks up until it finds an ancestor explicitly set to `'visible'` or `'hidden'`. So to test
whether a node is actually visible, read `hidden` rather than `showState`.

## World Transforms and Bounding Volumes

`position`/`rotation`/`scale` are all local. When you need world-space results:

```javascript
// World-space position
const worldPos = node.getWorldPosition();

// World transform matrix (read-only)
const m = node.worldMatrix;

// Bounding volumes, in local and world space
const localBV = node.getBoundingVolume();
const worldBV = node.getWorldBoundingVolume();
```

Bounding volumes are computed on demand and cached; they drive frustum culling and ray picking.
If you mutate vertex data by hand and the bounding volume does not follow, call
`invalidateBoundingVolume()` to force a recompute.
