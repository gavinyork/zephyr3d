# Joints

A joint links two rigid bodies, or a body and the world, allowing only certain motion between them: a door turning on its hinge, a drawer sliding on its rail, the links of a chain, a lamp hanging on a rope.

<div class="showcase" case="tut-79"></div>

---

## Where a Joint Goes and What It Joins

A `Joint` component can go on any node, and **that node is the joint's frame**:

- the **pivot** is the node's origin, moved by `anchor` (node space) if given;
- the **axis** is the node's local `axis`, Y by default, for hinges and sliders.

So joints usually get a child node of their own, placed at the door frame and turned the right way. In the editor, place it with the move and rotate tools instead of typing coordinates:

<<< @/../src/tut-79/main.js#hinge

The two ends:

- **The joint's own body**: the nearest `RigidBody` on the joint node or above it. Above, the joint node is a child of the door, so that is the door.
- **The other end**: `connectedBody` names another node (its nearest rigid body at or above it). Empty connects to the world, at the joint's position when it was made. `connectedBody` is saved by the node's persistent id, so the node may enter the scene after the joint.

A joint records the two ends' relative pose when it is made, and **that is angle 0**. Moving either end afterwards does not realign them, which is the physically correct behaviour; only changing the joint, or rebuilding either body, does.

---

## Types

`Joint.type`:

| Type | Allows | Examples |
| --- | --- | --- |
| `fixed` | Nothing, welded | Gluing two objects into one, detachable parts |
| `hinge` | Turning about the axis | Doors, wheels, levers |
| `slider` | Sliding along the axis | Drawers, pistons, lift rails |
| `ball` | Turning any way about the pivot | Chains, a ragdoll's shoulder |
| `rope` | Distance up to `length`, closer is free | Ropes, slack chains |
| `spring` | Stretching around `length` | Springs, suspension |

A chain is a row of `ball` joints, each link joined to the previous one:

<<< @/../src/tut-79/main.js#chain

`rope` and `spring` join two points: `anchor` on the joint's body, and `connectedAnchor` on the other end, in the connected body's node space, or world space when connected to the world:

<<< @/../src/tut-79/main.js#rope

- `collideConnected`: whether the two joined bodies still collide with each other, default false, so a door does not catch on its frame.

---

## Limits

- `hinge`: with `limitsEnabled`, the angle stays between `lowerLimit` and `upperLimit` (degrees).
- `slider`: the same properties, in metres.
- `ball`: `swingLimit` limits tilting away from the axis, `twistLimit` turning about it, both in degrees each way. This is a per-axis approximation, not an exact cone.

The current value can be read while running: `joint.angle` (hinge, degrees) and `joint.position` (slider, metres).

---

## Motors

Hinges and sliders can be driven by a motor, `motorMode`:

<<< @/../src/tut-79/main.js#motor

| Mode | `motorTarget` | Use |
| --- | --- | --- |
| `off` | - | Free (default) |
| `velocity` | Speed to reach: degrees or metres per second | Fans, conveyors, automatic doors |
| `position` | Angle or position to reach | Self-closing doors, servos |

- `motorStiffness`: how hard a position motor pulls towards its target; `motorDamping`: resists overshoot, and for a velocity motor sets how quickly it gets up to speed.
- `motorMaxForce`: the most force (or torque) the motor uses, 0 for no limit. With a limit, a blocked door's motor gives up instead of flinging what is in the way.

---

## Limits and Troubleshooting

- Joints cannot break under load: Rapier's JavaScript API gives no access to joint forces. To snap one, compare the ends' distance or speed in a script and `removeComponent` it yourself.
- There is no generic six-degrees-of-freedom joint; the six types above cover the common needs.
- A joint between two bodies that are not dynamic is made, but does nothing.
- When `connectedBody` names a node that does not exist, or both ends resolve to the same body, no joint is made, and `joint.error` says why.
- Long chains (dozens of links) may stretch or jitter: a higher step rate (smaller `fixedTimeStep` in the scene settings) helps.
