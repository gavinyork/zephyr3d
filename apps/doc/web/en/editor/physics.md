# Physics in the Editor

In the editor you give nodes rigid bodies and colliders, then press Play or Preview to see them simulated. What each part means and how to tune it is in the [Rigid Body Physics](en/physics-intro.md) chapter; this page covers working with them in the editor.

**The edited scene is never simulated**: while editing, things stay where you put them, and the simulation runs only in the page Play or Preview opens. So simulating cannot disturb your layout, and there is nothing to save or restore.

---

## Adding Physics

A node's physics is its **Physics** property in the property panel: empty for nodes without physics. The quickest way to fill it is a preset, from either of two places:

- a node's context menu in the scene hierarchy → **Add Physics**;
- the **Add Physics** button at the bottom of the property panel.

| Preset | Adds |
| --- | --- |
| Static Collider | A box collider fitted around the node and its children |
| Dynamic Body | A dynamic rigid body, plus a fitted box collider if nothing on or below the node has a collider |
| Kinematic Body | The same, kinematic |
| Trigger Zone | A fitted box collider that is a trigger |
| Character | A character controller (`physics.character`) |
| Vehicle Chassis | A 1000 kg dynamic body (unless it has one), a collider if needed, and a vehicle |
| Wheel | A wheel, its radius fitted to the node |
| Hinge Joint | A hinge joint |

Presets add to what the node has, replacing only the part they set; a fitted box is usually right as is. **Remove Physics** in the context menu clears a node's physics. Both can be undone, and with several nodes selected, each gets data of its own.

Everything a preset sets can be changed in the property panel, under **Physics**: **Body** (a rigid body or a character controller), **Colliders** (add and remove shapes), **Joint**, **Vehicle** and **Wheel**; empty slots can be filled there too. Hover a property's name for what it does. Properties that only matter for some settings hide otherwise; mass and initial velocity, for example, only show on dynamic bodies.

A static floor and a falling ball:

1. Floor: add a Box mesh, then **Add Physics → Static Collider**;
2. Ball: add a Sphere mesh, then **Add Physics → Dynamic Body**; set the added collider's Shape to Sphere and its Radius to the ball's radius (1 for the built-in sphere);
3. To throw the ball from the start, set the body's **InitialLinearVelocity**;
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
| White | Wheels: the circle at rest, the suspension up to where it is attached, and its travel |

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

Physics data is reached from scripts through `node.physics`, and the scene's world through `scene.physicsWorld`; the classes come from `@zephyr3d/scene`, with type hints. The `onFixedUpdate(dt)` hook of `RuntimeScript` is called before every simulation step. For example:

```ts
import type { SceneNode } from '@zephyr3d/scene';
import type { RigidBody } from '@zephyr3d/scene';
import { RuntimeScript } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

export default class extends RuntimeScript<SceneNode> {
  private body: RigidBody | null = null;
  onAttached(host: SceneNode) {
    this.body = host.physics?.body ?? null;
    host.physics?.on('collisionenter', (ev) => console.log(`hit ${ev.otherNode?.name}`));
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
- Building, the editor checks scenes, prefabs and scripts: if any node has physics data or a script imports `@zephyr3d/physics` or `@zephyr3d/physics-rapier`, the physics modules and Rapier's WebAssembly (about 1.1 MB gzipped) are shipped and loaded at startup; otherwise none of them are.
