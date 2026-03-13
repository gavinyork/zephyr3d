# Multi-Chain Spring System Examples

## Example 1: Simple Skirt (8 Chains)

```typescript
import { SpringChain, MultiChainSpringSystem, Vector3 } from '@zephyr3d/scene';

// Assume you have a character model with skirt bones
// Each skirt segment has a chain of bones from waist to hem
const skirtBones = [
  { root: model.findNodeByName('Skirt_Front'), tip: model.findNodeByName('Skirt_Front_End') },
  { root: model.findNodeByName('Skirt_FrontRight'), tip: model.findNodeByName('Skirt_FrontRight_End') },
  { root: model.findNodeByName('Skirt_Right'), tip: model.findNodeByName('Skirt_Right_End') },
  { root: model.findNodeByName('Skirt_BackRight'), tip: model.findNodeByName('Skirt_BackRight_End') },
  { root: model.findNodeByName('Skirt_Back'), tip: model.findNodeByName('Skirt_Back_End') },
  { root: model.findNodeByName('Skirt_BackLeft'), tip: model.findNodeByName('Skirt_BackLeft_End') },
  { root: model.findNodeByName('Skirt_Left'), tip: model.findNodeByName('Skirt_Left_End') },
  { root: model.findNodeByName('Skirt_FrontLeft'), tip: model.findNodeByName('Skirt_FrontLeft_End') }
];

// Create multi-chain system
const skirtSystem = new MultiChainSpringSystem({
  iterations: 8,
  gravity: new Vector3(0, -9.8, 0),
  wind: new Vector3(0, 0, 0)
});

// Add all chains
for (const bone of skirtBones) {
  const chain = SpringChain.fromBoneChain(
    bone.root,
    bone.tip,
    1,  // 1 particle per bone
    {
      mass: 1.0,
      damping: 0.95,
      stiffness: 0.8
    }
  );
  skirtSystem.addChain(chain);
}

// Create radial constraints between adjacent chains
// This keeps the skirt shape and prevents chains from passing through each other
skirtSystem.createRadialConstraints({
  stiffness: 0.6,        // Softer than intra-chain constraints
  maxDistance: 0.5,      // Only connect nearby particles
  skipRows: 1,           // Skip first particle (waist anchor)
  connectDistance: 1     // Connect to next chain only
});

// Update loop
scene.onUpdate = (deltaTime) => {
  skirtSystem.update(deltaTime);
  skirtSystem.applyToNodes(1.0);
};
```

## Example 2: Cape with Multiple Chains

```typescript
import { SpringChain, MultiChainSpringSystem, Vector3 } from '@zephyr3d/scene';

// Cape with 5 vertical chains
const capeChains = [
  SpringChain.fromBoneChain(leftEdge, leftEdgeTip, 1, { stiffness: 0.7 }),
  SpringChain.fromBoneChain(leftMid, leftMidTip, 1, { stiffness: 0.7 }),
  SpringChain.fromBoneChain(center, centerTip, 1, { stiffness: 0.7 }),
  SpringChain.fromBoneChain(rightMid, rightMidTip, 1, { stiffness: 0.7 }),
  SpringChain.fromBoneChain(rightEdge, rightEdgeTip, 1, { stiffness: 0.7 })
];

const capeSystem = new MultiChainSpringSystem({
  iterations: 10,
  gravity: new Vector3(0, -9.8, 0),
  wind: new Vector3(2, 0, 1)  // Wind effect
});

// Add chains
for (const chain of capeChains) {
  capeSystem.addChain(chain);
}

// Create horizontal constraints between chains
// This creates a cloth-like structure
capeSystem.createRadialConstraints({
  stiffness: 0.5,
  maxDistance: 1.0,
  skipRows: 1,
  connectDistance: 1
});

// Optional: Add diagonal constraints for more stability
for (let i = 0; i < capeChains.length - 1; i++) {
  const chainA = capeChains[i];
  const chainB = capeChains[i + 1];

  // Connect each particle to the next chain's adjacent particles
  for (let row = 1; row < Math.min(chainA.particles.length, chainB.particles.length) - 1; row++) {
    // Diagonal constraint (row to row+1)
    capeSystem.addInterChainConstraint({
      chainAIndex: i,
      chainBIndex: i + 1,
      particleAIndex: row,
      particleBIndex: row + 1,
      restLength: Vector3.distance(
        chainA.particles[row].position,
        chainB.particles[row + 1].position
      ),
      stiffness: 0.4
    });
  }
}

scene.onUpdate = (deltaTime) => {
  capeSystem.update(deltaTime);
  capeSystem.applyToNodes(1.0);
};
```

## Example 3: Hair Strands with Inter-Strand Constraints

```typescript
import { SpringChain, MultiChainSpringSystem, Vector3 } from '@zephyr3d/scene';

// Multiple hair strands
const hairStrands = [
  SpringChain.fromBoneChain(hair1Root, hair1Tip, 1, { stiffness: 0.9, damping: 0.98 }),
  SpringChain.fromBoneChain(hair2Root, hair2Tip, 1, { stiffness: 0.9, damping: 0.98 }),
  SpringChain.fromBoneChain(hair3Root, hair3Tip, 1, { stiffness: 0.9, damping: 0.98 }),
  SpringChain.fromBoneChain(hair4Root, hair4Tip, 1, { stiffness: 0.9, damping: 0.98 })
];

const hairSystem = new MultiChainSpringSystem({
  iterations: 5,
  gravity: new Vector3(0, -9.8, 0),
  wind: new Vector3(0.5, 0, 0)
});

// Add all hair strands
for (const strand of hairStrands) {
  hairSystem.addChain(strand);
}

// Add weak constraints between nearby strands
// This prevents strands from separating too much
hairSystem.createRadialConstraints({
  stiffness: 0.3,        // Very soft constraints
  maxDistance: 0.2,      // Only connect very close strands
  skipRows: 1,
  connectDistance: 1
});

scene.onUpdate = (deltaTime) => {
  hairSystem.update(deltaTime);
  hairSystem.applyToNodes(1.0);
};
```

## Example 4: Dynamic Wind Effect

```typescript
// Add dynamic wind that changes over time
let windTime = 0;

scene.onUpdate = (deltaTime) => {
  windTime += deltaTime;

  // Sinusoidal wind
  const windStrength = 2.0;
  const windX = Math.sin(windTime * 0.5) * windStrength;
  const windZ = Math.cos(windTime * 0.3) * windStrength * 0.5;

  skirtSystem.setWind(new Vector3(windX, 0, windZ));

  skirtSystem.update(deltaTime);
  skirtSystem.applyToNodes(1.0);
};
```

## Example 5: Blending with Animation

```typescript
// Blend spring physics with keyframe animation
const blendWeight = 0.7;  // 70% physics, 30% animation

scene.onUpdate = (deltaTime) => {
  // Update animation first
  animationMixer.update(deltaTime);

  // Then apply spring physics with blending
  skirtSystem.update(deltaTime);
  skirtSystem.applyToNodes(blendWeight);
};
```

## Performance Tips

1. **Iterations**: Start with 5-8 iterations and increase only if needed
2. **Particle Count**: Fewer particles = better performance
3. **Constraint Count**: Use `maxDistance` to limit inter-chain constraints
4. **Update Frequency**: Consider updating physics at a lower frequency than rendering
5. **LOD**: Disable physics for distant objects

## Common Parameters

### Skirt
- Iterations: 8-10
- Stiffness: 0.7-0.8 (intra-chain), 0.5-0.6 (inter-chain)
- Damping: 0.95
- Gravity: (0, -9.8, 0)

### Cape/Cloak
- Iterations: 10-15
- Stiffness: 0.6-0.7 (intra-chain), 0.4-0.5 (inter-chain)
- Damping: 0.93-0.95
- Gravity: (0, -9.8, 0)
- Wind: Recommended for realism

### Hair
- Iterations: 5-8
- Stiffness: 0.8-0.9 (intra-chain), 0.2-0.4 (inter-chain)
- Damping: 0.97-0.98
- Gravity: (0, -9.8, 0)
