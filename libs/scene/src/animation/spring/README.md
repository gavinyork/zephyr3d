# Spring Physics System

A particle-spring based physics simulation system for Zephyr3D, designed for hair, cloth, and multi-chain effects.

## Overview

The spring system provides a standalone physics simulation tool that works with scene node hierarchies. It uses Verlet integration for stable physics simulation and iterative constraint solving to maintain spring lengths.

## Core Components

### SpringParticle
Represents a single particle in the simulation with:
- Position (current and previous for Verlet integration)
- Mass and damping properties
- Fixed state (for anchor points)
- Optional scene node association

### SpringConstraint
Defines a spring connection between two particles with:
- Rest length
- Stiffness coefficient

### SpringChain
Manages a collection of particles and constraints:
- Create chains from bone hierarchies
- Add cross-constraints for cloth-like behavior
- Merge multiple chains together

### SpringSystem
The physics engine for single chains that:
- Performs Verlet integration
- Solves constraints iteratively
- Applies external forces (gravity, wind)
- Applies inertial forces (centrifugal, Coriolis) when root rotates
- Updates scene node rotations based on simulation

### MultiChainSpringSystem
The physics engine for multiple chains with inter-chain constraints:
- Manages multiple SpringChain instances
- Supports inter-chain constraints for cloth/skirt effects
- Unified physics update loop
- Automatic radial constraint generation

## Usage Examples

### Single Chain (Hair)

```typescript
import { SpringChain, SpringSystem, Vector3 } from '@zephyr3d/scene';

// Create a spring chain from a bone hierarchy
const hairRoot = model.findNodeByName('Hair_Root');
const hairTip = model.findNodeByName('Hair_Tip');
const springChain = SpringChain.fromBoneChain(hairRoot, hairTip);

// Create the physics system
const springSystem = new SpringSystem(springChain, {
  iterations: 5,
  gravity: new Vector3(0, -9.8, 0),
  wind: new Vector3(1, 0, 0),
  enableInertialForces: true  // Enable centrifugal/Coriolis forces (default: true)
});

// In your update loop
scene.onUpdate = (deltaTime) => {
  springSystem.update(deltaTime);
  springSystem.applyToNodes(1.0);
};
```

### Multiple Chains (Skirt)

```typescript
import { SpringChain, MultiChainSpringSystem, Vector3 } from '@zephyr3d/scene';

// Create multiple chains for skirt segments
const skirtSystem = new MultiChainSpringSystem({
  iterations: 8,
  gravity: new Vector3(0, -9.8, 0)
});

// Add 8 chains around the waist
for (let i = 0; i < 8; i++) {
  const chain = SpringChain.fromBoneChain(
    skirtBones[i].root,
    skirtBones[i].tip,
    1,
    { stiffness: 0.8, damping: 0.95 }
  );
  skirtSystem.addChain(chain);
}

// Create radial constraints between adjacent chains
skirtSystem.createRadialConstraints({
  stiffness: 0.6,
  maxDistance: 0.5,
  skipRows: 1  // Skip waist anchor points
});

// In your update loop
scene.onUpdate = (deltaTime) => {
  skirtSystem.update(deltaTime);
  skirtSystem.applyToNodes(1.0);
};
```

### Manual Inter-Chain Constraints

```typescript
// Add custom constraints between specific particles in different chains
skirtSystem.addInterChainConstraint({
  chainAIndex: 0,
  chainBIndex: 1,
  particleAIndex: 2,
  particleBIndex: 2,
  restLength: 0.3,
  stiffness: 0.7
});
```

## API Reference

### SpringChain.fromBoneChain()
Creates a spring chain from a scene node hierarchy.

**Parameters:**
- `startNode`: Root node of the chain
- `endNode`: End node of the chain (optional)
- `particlesPerBone`: Number of particles per bone segment (default: 1)
- `options`: Configuration options (mass, damping, stiffness)

### SpringSystem.update()
Updates the physics simulation for one time step.

**Parameters:**
- `deltaTime`: Time step in seconds

### SpringSystem.applyToNodes()
Applies simulation results to scene node rotations.

**Parameters:**
- `weight`: Blend weight [0-1] (default: 1.0)

### SpringSystem.setGravity()
Sets the gravity force vector.

### SpringSystem.setWind()
Sets the wind force vector.

### SpringSystem.setIterations()
Sets the number of constraint solver iterations.

### SpringSystem.setEnableInertialForces()
Enables or disables inertial forces (centrifugal and Coriolis effects).

**Parameters:**
- `enabled`: Boolean flag to enable/disable inertial forces

### MultiChainSpringSystem.addChain()
Adds a SpringChain to the multi-chain system.

**Returns:** Index of the added chain.

### MultiChainSpringSystem.addInterChainConstraint()
Adds a constraint between particles in different chains.

**Parameters:**
- `constraint`: InterChainConstraint object specifying chain indices, particle indices, rest length, and stiffness.

### MultiChainSpringSystem.createRadialConstraints()
Automatically creates constraints between adjacent chains for radial structures (skirts, capes).

**Parameters:**
- `stiffness`: Constraint stiffness [0-1]
- `maxDistance`: Maximum distance to create constraints
- `skipRows`: Number of rows to skip (default: 0)
- `connectDistance`: Connect to next N chains (default: 1)

## Physics Parameters

### Iterations
Number of constraint solver iterations per frame. Higher values = more stable but slower.
- Recommended: 5-10 for hair, 8-15 for cloth

### Gravity
Gravity force vector (typically negative Y).
- Default: (0, -9.8, 0)

### Wind
Wind force vector for dynamic effects.
- Default: (0, 0, 0)

### Mass
Particle mass affects inertia.
- Lower mass = more responsive
- Higher mass = more momentum

### Damping
Velocity damping coefficient [0-1].
- 0 = no damping (perpetual motion)
- 1 = full damping (no motion)
- Recommended: 0.95-0.98

### Stiffness
Spring constraint stiffness [0-1].
- 0 = no constraint (particles fly apart)
- 1 = rigid constraint
- Recommended: 0.7-0.9 for hair, 0.5-0.7 for cloth

### Inertial Forces
When enabled (default), the system calculates centrifugal and Coriolis forces when the root node rotates.
- **Centrifugal force**: Pushes particles outward when rotating (a = ω × (ω × r))
- **Coriolis force**: Affects particles moving in a rotating reference frame (a = -2ω × v)
- Essential for realistic behavior when characters spin or turn quickly
- Can be disabled for performance or artistic control via `setEnableInertialForces(false)`

## Implementation Details

### Verlet Integration
The system uses Verlet integration for numerical stability:
```
velocity = (position - prevPosition) * damping
position = position + velocity + force * dt^2 / mass
```

### Constraint Solving
Constraints are solved iteratively using position-based dynamics:
```
delta = particleB.position - particleA.position
correction = delta * (currentLength - restLength) / currentLength * stiffness
particleA.position += correction * 0.5
particleB.position -= correction * 0.5
```

### Node Rotation
Scene node rotations are calculated using:
1. Direction vector from current particle to next particle
2. Rotation from bone's local axis to direction vector
3. Conversion to local space relative to parent
4. Optional blending with current rotation

## Files

- `spring_particle.ts` - Particle interface and factory
- `spring_constraint.ts` - Constraint interface and factory
- `spring_chain.ts` - Chain management class
- `spring_system.ts` - Single-chain physics engine
- `multi_chain_spring_system.ts` - Multi-chain physics engine with inter-chain constraints
- `index.ts` - Public API exports

## See Also

- IK System (`libs/scene/src/animation/ik/`) - Similar standalone tool pattern
- Particle System (`libs/scene/src/scene/particlesys.ts`) - Alternative particle simulation
