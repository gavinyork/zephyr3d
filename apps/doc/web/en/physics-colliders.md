# Colliders

A `Collider` is the shape an object has in collisions; a node's colliders are in `node.physics.colliders`. Simpler shapes simulate faster and steadier, so prefer a basic shape that roughly wraps the object, and use meshes only where needed.

<div class="showcase" case="tut-77"></div>

---

## Choosing a Shape

`Collider.shape`:

| Shape | Size from | Good for |
| --- | --- | --- |
| `box` | `size` | Crates, walls, floors |
| `sphere` | `radius` | Balls, small roundish things |
| `capsule` | `radius`, `height` (total, round ends included) | People, posts; smoothest to roll and slide |
| `cylinder` | `radius`, `height` | Barrels, wheels, pillars |
| `convex` | The node's mesh | Irregular moving things: rocks, furniture |
| `mesh` | The node's mesh | Static complex ground and buildings |
| `terrain` | The terrain's height map | `ClipmapTerrain` nodes |

- Shapes are centred on the node's origin along its local axes; `offset` moves them in node space.
- One rigid body can have several colliders, see [Rigid Body Physics](en/physics-intro.md#shapes-scale-and-centre-of-mass).

---

## Meshes and Convex Hulls

`mesh` uses the node's mesh triangles as they are:

<<< @/../src/tut-77/main.js#mesh

`convex` uses the convex hull of the mesh vertices, the smallest convex shape wrapping all of them:

<<< @/../src/tut-77/main.js#convex

Which to use:

- **A `mesh` has no volume**, it is a skin of triangles. Fine on static objects; on a dynamic body it gets pushed into other things, and the console warns about it. Use `convex` for moving objects, and several `convex` colliders on child nodes for concave ones.
- **`convex` fills in hollows**: the hull of a bowl is solid.
- `meshLod`: which level of detail of the mesh to collide with, default 0 (the full mesh); out of range picks the coarsest. A coarser level saves memory and time on large meshes that do not need exact collisions.
- Skinned meshes and meshes with morph targets cannot be `mesh` or `convex` colliders: their shape changes every frame. Put basic shapes on the bones instead.
- Generated geometry can give its triangles directly with `setMeshData(positions, indices)`, taking effect at once.

### Waiting at the Start

Mesh triangles are read back from the GPU, which takes a few frames depending on the machine. So that nothing falls before the ground is there, the world by default **waits to start until every mesh, convex and terrain collider present at the start is in** (`waitForCollidersOnStart`, can be turned off in the scene settings); time does not run meanwhile. Such colliders added later only hold back their own rigid body.

- `collider.ready` is true once the collider is in the simulation, raising `ready` when it turns true.
- `await scene.physicsWorld.whenReady()` waits for every collider still being read.
- When a shape cannot be built (say, the hull of points all in one plane) `collider.error` says why, and the console reports it.

---

## Terrain

A `terrain` collider goes on a `ClipmapTerrain` node and uses the terrain's loaded height data, without reading back from the GPU:

```js
const collider = new Collider();
collider.shape = 'terrain';
collider.terrainResolution = 2; // one sample every 2 height map texels
terrain.physics = new NodePhysics({ colliders: [collider] });
```

- A larger `terrainResolution` follows bumps less closely but uses less memory; at 1 it matches the height map texel for texel.
- A terrain collider cannot belong to a rigid body: terrain is always static.
- When the terrain's height data is updated (`setHeightData` and the like) the collider is rebuilt.

---

## Friction and Bounce

- `friction`: 0 is ice, above 1 is grippy; default 0.5. Two touching colliders use the average of theirs.
- `restitution`: 0 does not bounce (default), 1 keeps nearly all energy. Also averaged.

---

## Triggers

A collider with `isTrigger` set only detects what enters and leaves it, blocking nothing. Use it for checkpoints, pickups and damage zones:

<<< @/../src/tut-77/main.js#trigger

Both sides receive `triggerenter` / `triggerexit`, on the physics data of their nodes. Event details are in [Scripting](en/physics-scripting.md#collision-and-trigger-events).

---

## Collision Layers

There are 16 collision layers, 0 to 15. `collider.layer` says which a collider is on, default 0. Whether two layers collide is set in a symmetric matrix; by default all do.

<<< @/../src/tut-77/main.js#layers

- The matrix and the layer names are saved with the scene in `scene.physicsSettings` (`setLayerCollision`, `setLayerName`), edited in the editor in the scene's Physics settings.
- Queries (rays and so on) can look at some layers only with `layerMask`, see [Scripting](en/physics-scripting.md#queries).
- Names are for display; the layer number is the data. The same prefab in two scenes has the same layer numbers, which may show different names.

---

## Limits

- Changing a node's scale, or a collider's shape or size, while running rebuilds the collider, which costs more than moving it; do not do it every frame.
- Non-uniform scale is only approximated on `sphere`, `capsule` and `cylinder` (see the scale rules above).
- Convex decomposition (splitting concave meshes into hulls automatically) and baking collision data offline are not supported yet.
