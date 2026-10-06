# Rigid Body Physics

Physics makes objects fall under gravity, collide, stack and roll. It comes in a separate package, `@zephyr3d/physics`, solved by [Rapier](https://rapier.rs). Projects without physics do not need it: `@zephyr3d/scene` does not depend on it.

This is not cloth or hair, which have GPU solvers of their own. This chapter is about rigid bodies: boxes, balls, doors, characters - things that keep their shape.

<div class="showcase" case="tut-76"></div>

---

## A Minimal Example

The physics engine is a WebAssembly module and has to be loaded first. Call `initPhysics()` once, and wait for it, before creating scenes with physics components:

<<< @/../src/tut-76/main.js#init

**A static object only needs a collider.** A node with a `Collider` and no `RigidBody` is static: it never moves, and other things land on it. Ground, walls and level geometry are made this way:

<<< @/../src/tut-76/main.js#ground

**Something that moves also gets a `RigidBody`.** The rigid body gives the node mass and lets the simulation move it; the `Collider` on the same node gives it a shape:

<<< @/../src/tut-76/main.js#box

Nothing else is needed: the world steps every frame and writes the bodies' positions and orientations back to their nodes. Removing a node (`node.remove()`) takes its rigid body and colliders out of the simulation.

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

- **Compound shapes**: a rigid body's shape is the colliders on its node plus those on child nodes that have no rigid body of their own. Build chairs, cars and other irregular objects from a few child nodes.
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

Changes apply from the next frame. The scene's world can also be changed directly, `PhysicsWorld.get(scene).gravity = ...`; that is not written back to the scene settings, and the settings win again when they change later.

---

## Limits and Notes

- **Call `initPhysics()` before loading scenes.** It also registers the physics components for serialization; scenes holding them cannot load without it.
- **WebGL2 and WebGPU** both work: physics runs on the CPU, independent of the rendering backend. It is single-threaded.
- **Determinism**: only fixed steps feed the simulation. The same inputs (creation order, when forces are applied) give the same results on any machine. For frame-exact reproducibility apply forces in the fixed step (see [Scripting](en/physics-scripting.md)), not by frame time in `onUpdate`.
- **Download size**: Rapier's WebAssembly is about 1.1 MB gzipped. Editor builds only ship it when the project uses physics.
- Bone chains, cloth and hair simulate independently of the rigid body world.

## Next

- [Colliders](en/physics-colliders.md): shapes, meshes and terrain, materials, triggers, collision layers
- [Scripting](en/physics-scripting.md): forces, collision events, ray and shape queries
- [Joints](en/physics-joints.md): doors, chains, ropes, springs
- [Character Controller](en/physics-character.md)
- In the editor: [Physics in the Editor](en/editor/physics.md)
