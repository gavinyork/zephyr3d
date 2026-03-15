# Inertial Forces in Spring System

## Overview

The spring system now supports inertial forces (centrifugal and Coriolis effects) that occur when the root node rotates. This creates more realistic physics behavior for hair, tails, and cloth when characters spin or turn.

## Physics Background

When an object rotates, particles attached to it experience two types of inertial forces:

### Centrifugal Force
Pushes particles outward from the rotation axis. The acceleration is:
```
a_centrifugal = ω × (ω × r)
```
where:
- `ω` is the angular velocity vector
- `r` is the position vector from the rotation center

### Coriolis Force
Affects particles moving within the rotating reference frame. The acceleration is:
```
a_coriolis = -2ω × v_relative
```
where:
- `v_relative` is the particle's velocity relative to the rotating frame

## Usage

### Enabling/Disabling

Inertial forces are **enabled by default**. You can control them via options:

```typescript
// Enable inertial forces (default)
const springSystem = new SpringSystem(chain, {
  enableInertialForces: true
});

// Disable for artistic control or performance
const springSystem = new SpringSystem(chain, {
  enableInertialForces: false
});

// Toggle at runtime
springSystem.setEnableInertialForces(false);
```

### Example: Character Spinning

```typescript
import { SpringChain, SpringSystem, Vector3 } from '@zephyr3d/scene';

// Create a hair spring chain
const hairChain = SpringChain.fromBoneChain(hairRoot, hairTip);

// Create system with inertial forces enabled
const springSystem = new SpringSystem(hairChain, {
  iterations: 5,
  gravity: new Vector3(0, -9.8, 0),
  enableInertialForces: true  // Hair will swing outward when spinning
});

// In your update loop
scene.onUpdate = (deltaTime) => {
  // Rotate the character
  character.rotation = Quaternion.fromAxisAngle(
    Vector3.axisPY(),
    time * 2.0  // 2 rad/s rotation
  );

  // Update spring physics - hair will naturally swing outward
  springSystem.update(deltaTime);
  springSystem.applyToNodes(1.0);
};
```

## Implementation Details

### Global Rotation Estimation

The system estimates rotation by analyzing the movement of **fixed particles** (anchor points):

1. **Calculate velocities**: For each fixed particle, compute `v = (position - lastFramePosition) / dt`
2. **Estimate rotation center**:
   - **Single fixed particle**: Use position history (last 3-5 frames) to fit a circle and find the center
   - **Multiple fixed particles**: Use their average position as the rotation center
3. **Estimate angular velocity**: Use least-squares fitting to find ω that best explains fixed particle velocities

```
For each fixed particle with velocity v at position p:
  r = p - center
  ω_i = (r × v) / |r|²

Average all ω_i to get the global angular velocity
```

### Why Only Fixed Particles?

The implementation uses **only fixed particles** to estimate rotation because:

1. **Fixed particles follow the skeleton**: They directly reflect the bone hierarchy's rotation
2. **Free particles are affected by physics**: Their motion includes spring forces, damping, and constraints - not just rotation
3. **Timing issue**: At the point of calculation, free particles haven't been updated yet by Verlet integration
4. **Accurate rotation inference**: Fixed particles give us the "ground truth" of how the skeleton is rotating

Once we estimate the global rotation from fixed particles, we apply the resulting inertial forces to **all free particles**.

### Single Fixed Particle Case

For chains with only one fixed particle (common for hair/tail), the system uses **position history** to estimate the rotation center:

- **With 3+ frames of history**: Fits a circle through the historical positions to find the center
- **With less history**: Estimates the center using velocity direction and an assumed radius

This solves the problem where a single fixed particle would otherwise have zero rotation radius (center = particle position).

### Inertial Force Application

The estimated rotation parameters are used to calculate inertial forces for all free particles:

```
For each free particle:
  r = particle.position - rotationCenter

  Centrifugal: a_c = ω × (ω × r)
  Coriolis: a_cor = -2ω × v_particle

  Total inertial acceleration = a_c + a_cor
```

This creates the effect where free particles (hair, cloth) swing outward when the skeleton rotates.

### Performance Considerations

Inertial force calculation adds minimal overhead:
- One velocity calculation per fixed particle per frame
- One inertial acceleration calculation per free particle per frame
- Total cost: ~O(n) where n is the number of particles

For most use cases (hair, tails, cloth), the performance impact is negligible.

## Visual Effects

### With Inertial Forces (Default)
- Hair swings outward when character spins
- Tails lag behind and swing wide during turns
- Cloth billows outward during rotation
- More dynamic and realistic motion

### Without Inertial Forces
- Hair/cloth only responds to gravity and wind
- No outward swing during rotation
- Simpler, more predictable behavior
- Useful for stylized or low-motion scenarios

## Multi-Chain Systems

The `MultiChainSpringSystem` also supports inertial forces:

```typescript
const skirtSystem = new MultiChainSpringSystem({
  iterations: 8,
  gravity: new Vector3(0, -9.8, 0),
  enableInertialForces: true  // Skirt will flare out when spinning
});

// Add chains...
for (const chain of skirtChains) {
  skirtSystem.addChain(chain);
}

// Runtime control
skirtSystem.setEnableInertialForces(false);
```

## Troubleshooting

### Hair/cloth swings too much when rotating
- Reduce damping (try 0.90-0.93 instead of 0.95)
- Increase stiffness (try 0.85-0.95 instead of 0.8)
- Reduce the number of particles in the chain
- **Reduce centrifugal scale**: `springSystem.setCentrifugalScale(0.5)`

### Hair/cloth doesn't swing enough
- Increase damping (try 0.97-0.98)
- Decrease stiffness (try 0.6-0.75)
- Ensure `enableInertialForces` is true
- **Increase centrifugal scale**: `springSystem.setCentrifugalScale(2.0)` or higher

### Effect is too subtle
Try these settings for more obvious effects:
```typescript
const springSystem = new SpringSystem(springChain, {
  iterations: 3,
  gravity: new Vector3(0, -5.0, 0),
  enableInertialForces: true,
  centrifugalScale: 3.0,  // 3x stronger centrifugal force
  coriolisScale: 1.0
});
```

### Only want centrifugal force (no Coriolis)
```typescript
const springSystem = new SpringSystem(springChain, {
  enableInertialForces: true,
  centrifugalScale: 1.0,
  coriolisScale: 0.0  // Disable Coriolis
});
```

### Unstable behavior during fast rotation
- Increase constraint solver iterations (try 8-10 instead of 5)
- Reduce deltaTime clamping if needed
- Check that fixed particles are properly anchored

## API Reference

### SpringSystem

```typescript
interface SpringSystemOptions {
  enableInertialForces?: boolean;  // Default: true
  centrifugalScale?: number;       // Default: 1.0
  coriolisScale?: number;          // Default: 1.0
}

class SpringSystem {
  get enableInertialForces(): boolean;
  setEnableInertialForces(enabled: boolean): void;

  get centrifugalScale(): number;
  setCentrifugalScale(scale: number): void;

  get coriolisScale(): number;
  setCoriolisScale(scale: number): void;
}
```

### MultiChainSpringSystem

```typescript
interface MultiChainSpringSystemOptions {
  enableInertialForces?: boolean;  // Default: true
  centrifugalScale?: number;       // Default: 1.0
  coriolisScale?: number;          // Default: 1.0
}

class MultiChainSpringSystem {
  get enableInertialForces(): boolean;
  setEnableInertialForces(enabled: boolean): void;

  get centrifugalScale(): number;
  setCentrifugalScale(scale: number): void;

  get coriolisScale(): number;
  setCoriolisScale(scale: number): void;
}
```
