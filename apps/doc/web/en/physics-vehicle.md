# Vehicles

`Vehicle` turns a rigid body into a car, truck or other wheeled vehicle: accelerator, brake and steering, and four-wheel suspension you can see working. It wraps Rapier's ray cast vehicle (a port of Bullet's `btRaycastVehicle`), the most common way cars are made in games.

<div class="showcase" case="tut-81"></div>

---

## A Minimal Example

The body is a dynamic rigid body with colliders, plus a `Vehicle` in the same node's physics data:

<<< @/../src/tut-81/main.js#car

Each wheel is a child node below the body, with a `Wheel` in its physics data:

<<< @/../src/tut-81/main.js#wheels

**Place each wheel node where the wheel's centre is with the suspension at rest** - in the editor, drag the wheel model into its wheel arch. The suspension is attached to the body `suspensionRestLength` above that centre. While simulating, the wheel nodes move up and down with the suspension, turn with the steering and roll with the car's motion, without any code; they go back to where they were when the simulation ends.

Then set the inputs every frame (or in the fixed step):

<<< @/../src/tut-81/main.js#input

---

## Conventions

- Up is the body node's +Y.
- The front is `vehicle.forward`: `'+z'` (default, the way glTF models face), `'-z'`, `'+x'` or `'-x'`.
- The axle runs across the body. So a wheel model's own orientation only has to look right: the cylinder above stands upright by default, and lying it on its side makes its axis the axle.

---

## Driving

| Input | Range | Effect |
| --- | --- | --- |
| `throttle` | -1 to 1 | Accelerator; negative drives backwards |
| `brake` | 0 to 1 | Brake pedal |
| `handbrake` | boolean | Handbrake |
| `steering` | -1 to 1 | Steering wheel; **positive turns left** |

Inputs stay until changed and apply at every simulation step. `vehicle.speed` is the speed along the front direction (m/s, negative going backwards).

How the inputs reach each wheel is set by the wheels' shares:

| Vehicle property | Wheel share | Each wheel gets |
| --- | --- | --- |
| `maxEngineForce` (N) | `drive` | throttle × max engine force × `drive` |
| `maxBrakeForce` (N) | `brake` | brake × max brake force × `brake` |
| `maxHandbrakeForce` (N) | `handbrake` | handbrake force × `handbrake` |
| `maxSteerAngle` (degrees) | `steer` | steering × max angle × `steer` |

The drive layout is just `drive`: 0.5 on each rear wheel for rear wheel drive, 0.5 on each front wheel for front wheel drive, 0.25 on all four for four wheel drive. A `steer` of -1 is rear wheel steering against the front.

<<< @/../src/tut-81/main.js#drive

For your own differential or traction control, give single wheels extra input: `wheel.engineForce` (N), `wheel.brakeForce` (N) and `wheel.steerAngle` (degrees) are added to what their shares give them.

- **Braking does nothing on a wheel under throttle**: Rapier ignores the brake on a driven wheel. That is why the example brakes first while back is held, and only reverses once stopped.
- **No rolling resistance**: off the throttle and brake, the car coasts on. Give the body a small `RigidBody.linearDamping` (around 0.1) for it.

---

## Tuning Suspension and Tyres

`Wheel` properties:

| Property | Default | Effect |
| --- | --- | --- |
| `radius` | 0.4 | Wheel radius |
| `suspensionRestLength` | 0.3 | Suspension length at rest |
| `suspensionStiffness` | 30 | Spring strength **per kilogram of vehicle**: the same value feels the same on a light and a heavy car |
| `suspensionCompression` | 2.2 | Damping while compressing: higher takes bumps more stiffly |
| `suspensionRelaxation` | 3.3 | Damping while extending: higher stops the body bouncing sooner |
| `maxSuspensionTravel` | 0.3 | How far the wheel moves from rest |
| `maxSuspensionForce` | 1000000 | Strongest push of the suspension (N); too low and a heavy vehicle sags to the ground |
| `frictionSlip` | 1.5 | Grip, like a friction coefficient: lower spins and slides more easily |
| `sideFriction` | 1 | Scales sideways grip: below 1 the car slides out in corners |

- **Sag at rest**: with four wheels sharing the load equally, the suspension compresses by 9.81 / (4 × stiffness) metres, about 8 cm at the default 30. Too soft and the body bottoms out over bumps.
- **Damping**: Bullet's rule of thumb is damping = k × 2√stiffness with k between 0.1 and 0.3, less for compression than for relaxation; the defaults follow it. Too little and the car keeps bouncing; too much and it rides as if it had no suspension.
- **Centre of mass**: the body turns about its node's origin (see [Rigid Body Physics](en/physics-intro.md)). The higher it is, the more easily the car rolls over; put the body node's origin low and raise the shape with the collider's `offset` for a steadier car.

---

## Limits

- **A wheel is a ray**: holes narrower than the wheel swallow it, and step edges are seen late.
- **Wheels do not collide**: a wheel brushing a wall is not stopped by it; the body's colliders are. Make them cover the car's outline.
- There is no engine torque curve, gearbox, differential, anti-roll bar or air drag. Where needed, work out `throttle` or forces from the speed in a fixed step script, for example air drag:

```js
world.on('fixedupdate', () => {
  const v = body.getLinearVelocity();
  body.applyForce(Vector3.scale(v, -0.4 * v.magnitude)); // grows with speed squared
});
```

- Once the body sleeps, the vehicle is not updated until there is input; any input wakes it.
- Wheel rays find ground only on layers `vehicle.layer` collides with, and ignore triggers.
- `vehicle.error` / `wheel.error` say why something could not be built: no dynamic rigid body on the vehicle's node, no wheels below it, or a wheel not below any vehicle.
