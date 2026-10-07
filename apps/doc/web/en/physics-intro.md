# Rigid Body Physics

Physics makes objects fall under gravity, collide, stack and roll.

Physics is a property of scene nodes: `node.physics` holds a node's rigid body, collision shapes, joint and so on, as plain data. Simulating that data takes two more packages: `@zephyr3d/physics`, the simulation, and a physics engine package, `@zephyr3d/physics-rapier`, which solves it with [Rapier](https://rapier.rs). Projects without physics do not load them, and the data alone costs nothing: without an engine, scenes keep, save and load it unchanged.

This is not cloth or hair, which have GPU solvers of their own. This chapter is about rigid bodies: boxes, balls, doors, characters - things that keep their shape.

<div class="showcase" case="tut-76"></div>

---

## A Minimal Example

The physics engine is a WebAssembly module and has to be loaded first. Call `initPhysics()` with the engine once, and wait for it; from then on every scene simulates the physics data of its nodes:

<<< @/../src/tut-76/main.js#init

**A static object only needs a collider.** A node whose physics data has a `Collider` and no `RigidBody` is static: it never moves, and other things land on it. Ground, walls and level geometry are made this way:

<<< @/../src/tut-76/main.js#ground

**Something that moves also gets a `RigidBody`.** The rigid body gives the node mass and lets the simulation move it; the `Collider` beside it gives it a shape:

<<< @/../src/tut-76/main.js#box

Nothing else is needed: the scene's physics world steps every frame and writes the bodies' positions and orientations back to their nodes. Removing a node (`node.remove()`) takes its physics data out of the simulation; setting `node.physics = null` removes the data for good.

---

## The Physics Data of a Node

`node.physics` is a `NodePhysics`, or null. It has a slot for each kind of part:

| Slot | Holds | See |
| --- | --- | --- |
| `body` | A `RigidBody` | This page |
| `character` | A `CharacterController`; a node has a body or a character, setting one clears the other | [Character Controller](en/physics-character.md) |
| `colliders` | Collision shapes (`addCollider` / `removeCollider`) | [Colliders](en/physics-colliders.md) |
| `joint` | A `Joint` to another body or the world | [Joints](en/physics-joints.md) |
| `vehicle` | A `Vehicle` driving the node's rigid body | [Vehicles](en/physics-vehicle.md) |
| `wheel` | A `Wheel` of the vehicle above | [Vehicles](en/physics-vehicle.md) |

Parts can be passed to the constructor, as above, or assigned later:

```js
node.physics = new NodePhysics();
node.physics.body = new RigidBody();
node.physics.addCollider(collider);
```

A part belongs to one node at a time. All of them are saved with the scene, and edited in the editor's inspector.

---

## Motion Types

`RigidBody.motionType`:

| Type | Moved by | Typical use |
| --- | --- | --- |
| `dynamic` (default) | The simulation: gravity, pushes, bounces | Boxes, balls, debris |
| `kinematic` | You: move the node (animation, scripts) and the body follows, pushing dynamic bodies aside | Lifts, moving platforms, a character's hands |
| `static` | Nothing | Same as a collider alone, but explicit |

Kinematic bodies read their node's pose after animation, so colliders on bones use this frame's animated pose rather than the last one.

---

## Shapes, Scale and Centre of Mass

- **Compound shapes**: a rigid body's shape is the colliders of its node plus those of child nodes that have no rigid body of their own. Build chairs, cars and other irregular objects from a few child nodes.
- **Scale**: collider sizes are multiplied by the node's world scale. `box`, `mesh` and `convex` scale exactly along each axis; `sphere` takes the largest of the three, and the radius of `capsule` and `cylinder` the larger of X and Z. A non-uniformly scaled sphere does not become an ellipsoid.
- **Centre of mass**: a body turns about its node's origin, not the middle of its shape. For an off-centre object to tumble right, put the node's origin in its middle and position the shape with the collider's `offset`.
- **Mass**: `RigidBody.mass` in kilograms, default 1. Only ratios matter: a heavy body pushes a light one aside, not the other way round.
- **Units**: 1 unit = 1 metre; gravity defaults to (0, -9.81, 0). Wildly different sizes (a 1 mm screw modelled as 1 unit) make the simulation unstable.

Choosing shapes, and mesh and terrain colliders, are covered in [Colliders](en/physics-colliders.md).

---

## Initial Velocity

A body can start out moving without a script:

```js
body.initialLinearVelocity = new Vector3(0, 5, -3); // m/s, world space
body.initialAngularVelocity = new Vector3(0, 6.28, 0); // rad/s: one turn a second about Y
```

It applies when the node enters a simulated scene and its body is built for the first time; changing the body's settings later (which rebuilds it) does not apply it again. A velocity set with `setLinearVelocity` before the body is built wins. Dynamic bodies only.

---

## Stepping and Scene Settings

The simulation advances in fixed steps, independent of the frame rate:

- 60 steps a second by default (`fixedTimeStep` = 1/60), at most 4 per frame (`maxSubSteps`). Below 15 frames a second the extra time is dropped: things slow down instead of catching up in a burst.
- When the frame rate differs from the step rate, nodes are drawn between the last two steps (`interpolation`) to avoid stutter.
- Collision layers and the collision matrix are in [Colliders](en/physics-colliders.md#collision-layers).

These are saved with the scene in `scene.physicsSettings` (a `ScenePhysicsSettings` from `@zephyr3d/scene`); null means defaults:

```js
const settings = new ScenePhysicsSettings();
settings.gravity = new Vector3(0, -1.62, 0); // the moon
settings.fixedTimeStep = 1 / 120;
scene.physicsSettings = settings;
```

Changes apply from the next frame. The scene's world can also be changed directly, `scene.physicsWorld.gravity = ...`; that is not written back to the scene settings, and the settings win again when they change later.

---

## Limits and Notes

- **Call `initPhysics()` before scenes start running.** Scenes with physics data load without it, but are not simulated until it has completed. `scene.physicsWorld` is null until then.
- **WebGL2 and WebGPU** both work: physics runs on the CPU, independent of the rendering backend. It is single-threaded.
- **Determinism**: only fixed steps feed the simulation. The same inputs (creation order, when forces are applied) give the same results on any machine. For frame-exact reproducibility apply forces in the fixed step (see [Scripting](en/physics-scripting.md)), not by frame time in `onUpdate`.
- **Download size**: Rapier's WebAssembly is about 1.1 MB gzipped. Editor builds only ship it when the project uses physics.
- **Other engines**: the simulation talks to the engine through an interface (`PhysicsBackend` in `@zephyr3d/physics`); another engine can be added as a package of its own without changing scenes or scripts.
- Bone chains, cloth and hair simulate independently of the rigid body world.

## Next

- [Colliders](en/physics-colliders.md): shapes, meshes and terrain, materials, triggers, collision layers
- [Scripting](en/physics-scripting.md): forces, collision events, ray and shape queries
- [Joints](en/physics-joints.md): doors, chains, ropes, springs
- [Character Controller](en/physics-character.md)
- [Camera Collision](en/physics-camera.md): a third person camera that stays out of walls
- [Vehicles](en/physics-vehicle.md): cars with suspension, steering and drive layouts
- In the editor: [Physics in the Editor](en/editor/physics.md)
