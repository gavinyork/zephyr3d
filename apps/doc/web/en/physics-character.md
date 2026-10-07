# Character Controller

Player characters are rarely dynamic bodies: those get knocked over, slide on slopes and bounce off walls, and feel hard to control. `CharacterController` works differently: **you say where it should go, and it works out how far it can** - sliding along walls, walking up steps and gentle slopes, staying on the ground going down - and moves the node there.

<div class="showcase" case="tut-80"></div>

---

## A Minimal Example

The controller goes in the node's `character` slot (`node.physics.character`) and brings its own capsule collider; no `RigidBody` or `Collider` is needed. The capsule's bottom sits on the node's origin, so a character model with its origin at the feet fits as is:

<<< @/../src/tut-80/main.js#controller

Call `move` once per simulation step:

<<< @/../src/tut-80/main.js#move

`move(displacement)` takes the world space movement wanted for this step, works out the corrected result at once, moves the node, and returns:

- `movement`: how far it actually moved;
- `grounded` / `groundNormal`: whether it stands on something, and which way that faces;
- `collisions`: what the move ran into (`collider`, `node`, `point`, `normal`).

The latest result is also available as `controller.isGrounded` and `controller.groundNormal`.

---

## Gravity and Jumping Are Yours

The controller does not apply gravity (as with Unity's `CharacterController.Move`). Jumps, double jumps and air control are game logic; the usual way is to keep a vertical speed yourself:

```js
if (controller.isGrounded) {
  vy = jumpPressed ? jumpSpeed : -1;
} else {
  vy -= 9.81 * dt;
}
controller.move(new Vector3(vx * dt, vy * dt, vz * dt));
```

**Keep a small downward speed while grounded (-1 above)** rather than 0: the controller only snaps to the ground, and slides down slopes that are too steep, when it is moving down.

---

## Tuning

| Property | Default | Effect |
| --- | --- | --- |
| `height`, `radius` | 1.8, 0.3 | Capsule total height and radius |
| `skinWidth` | 0.02 | Gap kept from obstacles. Too small and it gets stuck in corners, too large and it hovers visibly |
| `slopeLimit` | 45° | Steepest slope it walks up |
| `slideSlope` | 30° | Steeper than this, it cannot stand and slides down |
| `stepHeight`, `stepMinWidth` | 0.3, 0.2 | Highest step it walks up, and the narrowest step top; `stepHeight` 0 turns stepping off |
| `snapToGround` | 0.2 | Largest drop it follows down slopes and steps; 0 turns it off |
| `pushBodies` | true | Shoves dynamic bodies it walks into |
| `characterMass` | 70 | Mass used for shoving them |
| `layer` | 0 | Collision layer |

In the example the 0.25 m steps can be walked up; the 0.5 m ledge is higher than `stepHeight` and has to be jumped; the red 55° ramp is steeper than `slopeLimit`, so it cannot be climbed, and standing on it slides you down.

---

## Notes

- **Move in the fixed step** (`world.on('fixedupdate')` or a script's `onFixedUpdate`) to make walking speed independent of the frame rate and results reproducible. Moving by frame time in `onUpdate` works too, but varies slightly with the frame rate.
- `move` sees the world as the last simulation step left it, like queries; several calls within one step each start from the latest position.
- The character's node receives `triggerenter` on its `node.physics` when it walks into a trigger. It raises no `collisionenter` against static objects (kinematic and static bodies have no contact events between them); what it ran into is in the result of `move`.
- The capsule turns with its node: turn the node about the vertical axis only, tilting it tilts the capsule.
- Do not move a character by setting its node's position except to teleport it.
