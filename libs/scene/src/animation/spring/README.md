# Spring Physics System

A particle-spring based physics simulation system for Zephyr3D, designed for hair and cloth effects.

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
The physics engine that:
- Performs Verlet integration
- Solves constraints iteratively
- Applies external forces (gravity, wind)
- Updates scene node rotations based on simulation

## Usage Example

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
  wind: new Vector3(1, 0, 0)
});

// In your update loop
scene.onUpdate = (deltaTime) => {
  springSystem.update(deltaTime);
  springSystem.applyToNodes(1.0);
};
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
- `spring_system.ts` - Physics engine
- `index.ts` - Public API exports

## See Also

- IK System (`libs/scene/src/animation/ik/`) - Similar standalone tool pattern
- Particle System (`libs/scene/src/scene/particlesys.ts`) - Alternative particle simulation
