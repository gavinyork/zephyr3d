# IK (Inverse Kinematics) System for Zephyr3D

A complete FABRIK-based IK solver with constraint support for skeletal animation.

## Features

- ✅ **FABRIK Solver**: Fast, stable multi-joint IK algorithm
- ✅ **Angle Constraints**: Limit joint bending (e.g., elbow/knee limits)
- ✅ **Pole Vector Constraints**: Control joint chain twist/rotation
- ✅ **Animation Integration**: Seamless blending with animation system
- ✅ **Blend Weights**: Mix IK with other animations
- ✅ **Chain Builders**: Easy creation from nodes, skeleton, or hierarchy

## Quick Start

### Basic IK Usage

```typescript
import { IKChainBuilder, FABRIKSolver, Vector3 } from '@zephyr3d/scene';

// Create IK chain from scene nodes
const chain = IKChainBuilder.fromNodes([shoulder, elbow, hand]);

// Create solver
const solver = new FABRIKSolver(chain);
solver.setMaxIterations(15);
solver.setTolerance(0.001);

// Solve to target position
const target = new Vector3(1.5, 0.5, 0);
solver.solve(target);

// Apply to scene nodes
solver.applyToNodes(1.0); // Full IK weight
```

### With Constraints

```typescript
import { IKAngleConstraint, IKPoleVectorConstraint } from '@zephyr3d/scene';

// Add angle constraint (elbow: 0-150 degrees)
chain.addConstraint(new IKAngleConstraint(1, 0, 150));

// Add pole vector (elbow points upward)
const poleVector = new Vector3(0, 1, 0);
chain.addConstraint(new IKPoleVectorConstraint(1, poleVector));

// Solve with constraints
solver.solve(target);
solver.applyToNodes(1.0);
```

### Animation System Integration

```typescript
import { IKTrack, AnimationSet } from '@zephyr3d/scene';

// Create IK track
const ikTrack = new IKTrack(solver);

// Add to animation system
const animationSet = new AnimationSet(rootNode);
const ikAnimation = animationSet.createAnimation('ik-reach');
ikAnimation.addTrack(rootNode, ikTrack);

// Solve IK
solver.solve(targetPosition);

// Play with blending
animationSet.playAnimation('ik-reach');
animationSet.setAnimationWeight('ik-reach', 0.8); // 80% IK, 20% other
```

## API Reference

### IKChainBuilder

Helper for creating IK chains from various sources.

```typescript
// From node array
const chain = IKChainBuilder.fromNodes([node1, node2, node3]);

// From skeleton
const chain = IKChainBuilder.fromSkeleton(skeleton, [0, 1, 2, 3]);

// From node hierarchy
const chain = IKChainBuilder.fromNodeHierarchy(startNode, endNode);
```

### FABRIKSolver

FABRIK algorithm implementation.

```typescript
const solver = new FABRIKSolver(chain, maxIterations?, tolerance?);

// Configuration
solver.setMaxIterations(15);  // Default: 15
solver.setTolerance(0.001);   // Default: 0.001

// Solving
const converged = solver.solve(targetPosition);
solver.applyToNodes(weight);  // weight: 0-1
```

### IKAngleConstraint

Limits joint bending angle.

```typescript
// jointIndex: index in chain (0 = root)
// minAngle, maxAngle: degrees (0 = straight, 180 = fully bent)
const constraint = new IKAngleConstraint(jointIndex, minAngle, maxAngle);

chain.addConstraint(constraint);

// Modify at runtime
constraint.minAngle = 10;
constraint.maxAngle = 140;
```

### IKPoleVectorConstraint

Controls joint chain twist direction.

```typescript
// jointIndex: typically the middle joint (elbow/knee)
// poleVector: world position the joint should point toward
// weight: 0-1 (default: 1)
const constraint = new IKPoleVectorConstraint(jointIndex, poleVector, weight);

chain.addConstraint(constraint);

// Modify at runtime
constraint.poleVector = new Vector3(0, 2, 0);
constraint.weight = 0.5;
```

### IKChain

Manages a chain of joints.

```typescript
const chain = new IKChain(nodes);

// Properties
chain.length;        // Number of joints
chain.totalLength;   // Sum of bone lengths
chain.root;          // First joint
chain.endEffector;   // Last joint
chain.joints;        // All joints
chain.constraints;   // All constraints

// Methods
chain.addConstraint(constraint);
chain.removeConstraint(constraint);
chain.clearConstraints();
chain.updateFromNodes();
chain.storeOriginalPositions();
chain.restoreOriginalPositions();
```

## Testing

Run the test suite to verify the IK system:

```bash
# Run test runner
node libs/scene/src/animation/ik/ik_test_runner.js

# Or integrate with your test framework
import { runAllIKTests } from '@zephyr3d/scene';
runAllIKTests();
```

The test suite includes:
1. Basic FABRIK convergence
2. Unreachable target handling
3. Angle constraint enforcement
4. Pole vector constraint
5. Chain builder utilities

## Examples

See `ik_test.ts` for comprehensive test examples, or `example.ts` for usage patterns:

- Basic IK solving
- Unreachable targets
- Blend weights
- Angle constraints
- Pole vectors
- Multiple constraints
- Animation integration
- Chain building

## Architecture

```
IKSolver (abstract)
  └─ FABRIKSolver
       └─ uses IKChain
            ├─ contains IKJoint[]
            └─ applies IKConstraint[]
                 ├─ IKAngleConstraint
                 └─ IKPoleVectorConstraint

IKTrack (extends AnimationTrack)
  └─ wraps FABRIKSolver for animation system
```

## Performance

- **FABRIK**: O(n) per iteration, typically converges in 5-15 iterations
- **Constraints**: O(c) where c = number of constraints
- **Recommended**: Max 15 iterations, 0.001 tolerance for real-time use

## Limitations

- Currently supports single-chain IK (no branching)
- Constraints are applied per-iteration (may affect convergence)
- Pole vector works best with 3+ joint chains

## Future Enhancements

Potential additions (not yet implemented):
- Multi-chain IK (branching skeletons)
- Twist constraints
- Position constraints
- CCD (Cyclic Coordinate Descent) solver
- Two-bone IK optimization
- Hinge constraints

## License

Part of Zephyr3D - see main project license.
