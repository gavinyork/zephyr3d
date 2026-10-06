# Scripting Physics

> The code on this page shows fragments; imports and application setup are left out. See the embedded example for a complete program. The physics classes come from `@zephyr3d/scene`, `Vector3` from `@zephyr3d/base`.

Rigid bodies move on their own once in a scene. To bring game logic in, you apply forces, change velocities, listen for collisions and ask what is where. This page covers those four, and when to do them.

<div class="showcase" case="tut-78"></div>

---

## Forces and Velocity

Methods of `RigidBody`, for dynamic bodies:

| Method | Effect | Good for |
| --- | --- | --- |
| `applyForce(f)` / `applyTorque(t)` | A sustained force (N) / torque (N·m) | Thrusters, wind, buoyancy |
| `applyImpulse(j)` / `applyTorqueImpulse(j)` | An instant impulse (N·s): velocity changes by impulse / mass | Explosions, hits, jumps |
| `setLinearVelocity(v)` / `setAngularVelocity(w)` | Sets the velocity | Firing projectiles, resetting |

<<< @/../src/tut-78/main.js#shoot

- **A force acts during every simulation step of the frame, then clears.** Calling `applyForce` every frame from `onUpdate` gives a steady force, whatever the frame rate.
- An impulse applies once, at the next step.
- A body at rest for a while goes to sleep (`isSleeping`) and is not simulated. Forces, impulses and setting a velocity wake it; `wakeUp()` does too. Turn off `canSleep` to keep it awake.
- Velocity along locked axes (`lockTranslationX` and so on) is ignored.

---

## The Fixed Step

The simulation advances in fixed steps; a frame may take several, or none. Logic that has to follow the step rate goes in the fixed step callback:

<<< @/../src/tut-78/main.js#fixedupdate

- `scene.physicsWorld.on('fixedupdate', (dt) => ...)`: before every simulation step, with the step length.
- In editor scripts, the `onFixedUpdate(dt)` hook of `RuntimeScript` does the same.
- **Forces applied here act on that step only**; forces applied in `onUpdate` act on the whole frame.
- For frame-exact reproducible results (replays, networking) apply forces and move characters here, not in `onUpdate`.

---

## Collision and Trigger Events

Events are raised on the **physics object**: the physics data (`node.physics`) of the node with the rigid body or character controller, or, for static colliders, of the node they are on.

<<< @/../src/tut-78/main.js#events

| Event | When |
| --- | --- |
| `collisionenter` | Two solid objects start touching |
| `collisionstay` | Every frame while they touch |
| `collisionexit` | They part |
| `triggerenter` / `triggerexit` | Entering or leaving a trigger; both sides receive it |

- **Once per pair of objects**: a body made of three colliders landing on the ground gets one `collisionenter`, however many of them touch. Several static colliders on one node are one object too.
- Events are dispatched after the frame's simulation steps, when nodes are in their new places. Changes to physics data from a handler take effect the next frame.
- **Sleeping does not raise `collisionexit`**: a stack at rest stays in contact.
- A `PhysicsContactEvent` has `other` (the other object's `NodePhysics`), `otherNode`, `normal` (from this object towards the other), `contacts` (contact points) and `impulse` (the contact impulse of the last step, N·s). Use `impulse` to tell impacts (large) from resting contact (small), for example to play a sound.
- Read contact details in the handler; they are not available after it returns.

---

## Queries

```js
const world = scene.physicsWorld;
```

<<< @/../src/tut-78/main.js#raycast

| Method | Returns |
| --- | --- |
| `raycast(origin, dir, maxDistance?, options?)` | The nearest hit, or null |
| `raycastAll(...)` | Every hit along the ray, nearest first |
| `shapeCast(shape, position, rotation, dir, maxDistance?, options?)` | What a shape swept along hits first |
| `overlap(shape, position, rotation, options?)` | Colliders overlapping a shape |
| `overlapPoint(point, options?)` | Colliders containing a point |

- A hit (`PhysicsQueryHit`) has `collider`, `body`, `object` (the `NodePhysics` it raises events on), `node`, `point`, `normal` and `distance`.
- `options.layerMask`: only some layers (bit i is layer i); `includeTriggers`: whether triggers can be hit, default false; `exclude`: a physics object to ignore, such as your own `node.physics`.
- Shapes for `shapeCast` / `overlap`: `{ type: 'box', size }`, `{ type: 'sphere', radius }`, `{ type: 'capsule', radius, height }` or `{ type: 'cylinder', radius, height }`.
- **Queries see the world as the last simulation step left it**: colliders added this frame, and nodes moved by scripts since, show up after the next step. Querying never changes the simulation.
- Picking (clicking on models) still uses `Scene.raycast` or camera picking, which work on rendered bounds and pixels; physics queries only see colliders.

---

## Driving Kinematic Bodies

A `kinematic` body follows its node: animation or scripts move the node, the body gets there at the next step and pushes dynamic bodies out of the way. Do not apply forces or velocities to kinematic bodies; move the node.

Moving a dynamic body's node directly (teleporting it) works too: the world puts the body at the new place and keeps its velocity.

## Driving the World Yourself

The world steps on its own after animation every frame. To control it (pause, slow motion, stepping in tests):

```js
world.enabled = false;
world.update(1 / 60); // advances 1/60 s, still in fixed steps
```
