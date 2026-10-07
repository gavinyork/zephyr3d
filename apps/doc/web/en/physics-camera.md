# Camera Collision

A third person camera hangs behind the character on an invisible arm. When a wall, a pillar or a low ceiling comes between them, a camera that ignores the world ends up inside the geometry and shows its back faces, or the view is blocked entirely. The usual fix, and what Unreal Engine's `USpringArmComponent` does, is to **sweep a small sphere along the arm and pull the camera in to where it stops**.

<div class="showcase" case="tut-82"></div>

---

## The Spring Arm

Each frame:

1. **Origin**: a point on the character to look at, here 1.5 m above its feet. It follows the character with a little lag, so the camera trails behind when the character moves. The lag is on the origin, not on the camera, so turning the camera is never delayed.
2. **Wanted position**: the origin moved back along the view direction by the arm length.
3. **Sweep**: `shapeCast` a sphere from the origin towards the wanted position, as far as the arm length. If it hits, the camera goes where the sphere stopped; if not, to the wanted position.

<<< @/../src/tut-82/main.js#springarm

---

## First Person

A first person camera sits at the character's eyes, inside its capsule. The capsule keeps the eyes a radius (0.3 m here) from every wall, much more than the near plane needs, so walking and looking around need no test at all. The near plane only has to stay smaller than the radius.

What does need one is moving the eyes out of the capsule: leaning out round a corner, head bob, a camera placed ahead of the body. Sweep that move the same way, from the head to where the eyes should go, and stop where the sphere stops. In the example, Q and E lean out by up to 0.6 m:

<<< @/../src/tut-82/main.js#firstperson

The character's own mesh is hidden in first person: leaning takes the eyes outside it, where it would block the view.

---

## Details

- **Use the hit's `distance`, not its `point`.** `distance` is how far the sphere's centre travelled before touching, so `origin + direction * distance` is the centre at that moment: the radius away from the wall. `point` is on the wall's surface; a camera put there sits right on the wall and the near plane cuts into it.
- **The probe radius** keeps the near plane out of the wall. It should be at least as large as the near plane's half diagonal; Unreal uses 12 cm. Too large and the camera is pulled in by gaps it could fit through.
- **Skip the character** with `exclude: hero.physics`: the sweep starts inside its capsule. This also skips a character controller's own capsule.
- **Skip small dynamic objects** with `layerMask`. The crates in the example are on their own layer, which the sweep leaves out: otherwise the camera jumps in and out whenever one rolls past. This is what Unreal's `ECC_Camera` channel is for.
- **The camera is pulled in at once, and goes back out at once** when the way is clear. Easing it back out is common in games and is easy to add on top: move the distance towards the swept result over time, but never further out than the result.
- Like all queries, the sweep sees the world as the last simulation step left it. Bodies moved since then are seen where they were.

Turn off **Collision test** in the example to see the camera go through the walls, the tunnel roof and the pillars.
