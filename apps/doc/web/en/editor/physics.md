# Physics in the Editor

In the editor you give nodes rigid bodies and colliders, then press Play or Preview to see them simulated. What the components mean and how to tune them is in the [Rigid Body Physics](en/physics-intro.md) chapter; this page covers working with them in the editor.

**The edited scene is never simulated**: while editing, things stay where you put them, and the simulation runs only in the page Play or Preview opens. So simulating cannot disturb your layout, and there is nothing to save or restore.

---

## Adding Physics Components

Two places, with the same menu:

- a node's context menu in the scene hierarchy → **Add Component → Physics**;
- the **Add Component** button at the bottom of the property panel.

Pick Rigid Body, Collider, Joint or Character Controller. Remove one with **Remove Component** in the context menu. Adding and removing can be undone.

Conveniences:

- **Adding a Collider** sizes and offsets its box to fit the node and its children, which is usually right as is.
- **Adding a Rigid Body** to a node with no collider on it or below it adds a box collider around it too; a body without a shape would fall through everything.
- With several nodes selected, each gets a component of its own.

Component properties are edited in the property panel; hover a property's name for what it does. Properties that only matter for some settings hide otherwise; mass and initial velocity, for example, only show on dynamic bodies.

A static floor and a falling ball:

1. Floor: add a Box mesh, then **Add Component → Physics → Collider** (no rigid body means static);
2. Ball: add a Sphere mesh, then **Add Component → Physics → Rigid Body**; set the added Collider's Shape to Sphere and its Radius to the ball's radius (1 for the built-in sphere);
3. To throw the ball from the start, set the Rigid Body's **InitialLinearVelocity**;
4. Press Preview.

---

## Collider Outlines

Selecting a node draws the colliders on it and its children as outlines. Outlines are the shapes the simulation uses: scale applied, convex hulls as the physics engine computes them, meshes at the chosen level of detail, terrain at its sampling resolution (every line lies on the collision surface). Parts hidden behind models are drawn faded.

| Colour | Meaning |
| --- | --- |
| Green | Static |
| Orange | Dynamic |
| Blue | Kinematic |
| Yellow | Trigger |
| Cyan | A character controller's capsule |
| Magenta | Joints: pivot cross, hinge or slider axis, line to the other end |

- **View → Show All Colliders** draws every collider in the scene, the selected ones highlighted.
- Mesh, convex and terrain shapes are read back from the GPU and appear a few frames after selecting.
- A collider whose shape cannot be built (say, a hull of points in one plane) has no outline, and **ColliderError** in the property panel says why.

---

## Scene Physics Settings

Select the scene's root node and find **Physics** in the property panel; click it to create the settings. They are saved with the scene; without them the defaults apply.

- **Gravity**;
- **StepRate**: simulation steps per second, steadier when higher but more costly;
- **MaxSubSteps**: the most steps in one frame; time beyond is dropped when the game lags, and things slow down;
- **Interpolation**: draws between steps, removing stutter when the frame rate differs from the step rate;
- **WaitForCollidersOnStart**: holds the start until mesh and terrain colliders are ready, so nothing falls through the ground;
- **Edit Collision Layers...**: opens the collision layer dialog: names for the 16 layers, and a lower-triangle matrix of which layers collide.

The **Layer** property of colliders and character controllers takes a layer number, 0 to 15.

---

## Physics in Scripts

Editor scripts can `import { RigidBody, PhysicsWorld } from '@zephyr3d/physics'`, with type hints. The `onFixedUpdate(dt)` hook of `RuntimeScript` is called before every simulation step. For example:

```ts
import type { SceneNode } from '@zephyr3d/scene';
import { RuntimeScript } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';
import { RigidBody } from '@zephyr3d/physics';

export default class extends RuntimeScript<SceneNode> {
  private body: RigidBody | null = null;
  onAttached(host: SceneNode) {
    this.body = host.getComponent(RigidBody);
    this.body?.on('collisionenter', (ev) => console.log(`hit ${ev.otherNode?.name}`));
  }
  onFixedUpdate() {
    // A steady upward push
    this.body?.applyForce(new Vector3(0, 12, 0));
  }
}
```

More in [Scripting Physics](en/physics-scripting.md).

---

## Preview and Build

- Play and Preview both load the physics engine and simulate.
- Building, the editor checks scenes, prefabs and scripts: if any holds a physics component or a script imports `@zephyr3d/physics`, the physics module and Rapier's WebAssembly (about 1.1 MB gzipped) are shipped and loaded at startup; otherwise neither is.
