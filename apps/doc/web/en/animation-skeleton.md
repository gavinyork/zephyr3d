
# Skeletal Animation

In skeletal animation, each vertex of a model is influenced by one or more **joints (bones)** that define how the mesh deforms and moves. This technique is primarily used for animating characters, creatures, and other articulated objects.

Skeletal animations are usually loaded from models or animation assets. Once loaded, an `AnimationSet` can play and blend them, generate masked clips, or retarget compatible humanoid animations between rigs.

## Example

```javascript
// Load a model that contains skeletal animation.
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/CesiumMan.zprefab'
);

const animationNames = model.animationSet.getAnimationNames();

// Play the first animation included in the model
model.animationSet.playAnimation(animationNames[0], {
  // Number of loops; use 0 for infinite looping (default is 0)
  repeat: 0,
  // Playback speed multiplier; higher = faster, negative = reverse playback (default is 1)
  speedRatio: 1,
  // Weight for animation blending (default is 1)
  weight: 1,
  // Duration for fade-in effect, in seconds; set to 0 for instant start.
  // Often used with stopAnimation()'s fadeOut parameter for seamless cross-fading.
  fadeIn: 0
});

// ...

// Stop playback of the animation
model.animationSet.stopAnimation(animationNames[0]);
```

<div class="showcase" case="tut-24"></div>

## AnimationMask

`AnimationMask` creates a new `AnimationClip` from an existing skeletal clip and keeps only the tracks that affect selected joints. The generated clip is a normal animation clip, so it can be played with `playAnimation()` and blended with other clips. A common use case is splitting a full-body animation into upper-body, lower-body, or one-side limb clips, such as running with the legs while the upper body plays an aiming or waving animation.

Use `AnimationSet.createSkeletalMaskedAnimation(sourceName, targetName, options)` to create a masked clip:

```javascript
// Split a full-body clip into upper-body and lower-body clips.
model.animationSet.createSkeletalMaskedAnimation('walk', 'walk_upper', {
  type: 'humanoid',
  preset: 'upperBody'
});

model.animationSet.createSkeletalMaskedAnimation('walk', 'walk_lower', {
  type: 'humanoid',
  preset: 'lowerBody'
});

// Complementary masks can play together without affecting unrelated body parts.
model.animationSet.playAnimation('walk_upper');
model.animationSet.playAnimation('walk_lower');
```

Humanoid rigs can use semantic masks:

- `preset` supports `fullBody`, `upperBody`, `lowerBody`, `head`, `arms`, `leftArm`, `rightArm`, `legs`, `leftLeg`, and `rightLeg`.
- `includeBody` / `excludeBody` add or remove joints by `HumanoidBodyRig` semantic names.
- `includeLeftHand`, `includeRightHand`, `excludeLeftHand`, and `excludeRightHand` control hand joints by semantic names.
- `includeDescendants` controls whether selected or excluded joints also affect all descendants. Humanoid semantic masks default to `true`.

```javascript
import { HumanoidBodyRig } from '@zephyr3d/scene';

// Keep only the left arm and its descendants, without root motion.
model.animationSet.createSkeletalMaskedAnimation('attack', 'attack_left_arm', {
  type: 'humanoid',
  includeBody: [HumanoidBodyRig.LeftUpperArm],
  includeDescendants: true,
  rootMotion: 'exclude'
});
```

Non-humanoid rigs can use joint-name masks:

```javascript
// Select Spine and its descendants, but remove the LeftHand branch.
model.animationSet.createSkeletalMaskedAnimation('full_body', 'upper_without_left_hand', {
  type: 'joints',
  include: ['Spine'],
  exclude: ['LeftHand'],
  includeDescendants: true
});
```

`rootMotion` controls how root translation tracks are copied. Valid values are `include`, `exclude`, and `only`. When omitted, `fullBody` and `lowerBody` humanoid masks include root motion by default, while other masks exclude it. `unsupportedTracks` can be `skip` or `error`, controlling whether non-node-transform tracks are skipped or fail clip creation.

## Skeletal Animation Retargeting

Skeletal animation retargeting copies a humanoid animation from one character to another. Zephyr3D uses `AnimationSet.copyHumanoidAnimationFrom()` for this. It matches joints through `HumanoidBodyRig` / `HumanoidHandRig` semantic mappings instead of joint names, so source and destination skeletons may use different bone names.

Requirements:

- Both the source and destination rigs need `humanoidJointMapping`.
- The source clip must resolve to exactly one rig.
- The destination `AnimationSet` must not already contain an animation with the target name.
- Unmapped joints are skipped. Non-root joint translation tracks are skipped by default to keep the destination skeleton proportions.

```javascript
// sourceModel provides the motion; targetModel is the character that will play it.
const retargeted = targetModel.animationSet.copyHumanoidAnimationFrom(
  sourceModel.animationSet,
  'walk',
  'walk_retargeted',
  {
    // Default is scaled, which scales root motion by the target leg length.
    rootMotion: 'scaled',
    // Locking Y keeps the target bind-pose height for root motion.
    lockRootMotionAxes: { y: true }
  }
);

if (retargeted) {
  targetModel.animationSet.playAnimation('walk_retargeted', {
    fadeIn: 0.2
  });
}
```

`rootMotion` supports these modes:

- `scaled`: default mode. Retargets root motion and scales it to the destination rig size.
- `copy`: retargets root motion without scaling translation.
- `locked`: writes a constant destination bind-pose root translation.
- `none`: does not generate a root translation track.

`rootMotionScale` can be `legLength`, `none`, or a number. `lockRootMotionAxes` can lock any of `x`, `y`, and `z`. If an asset really needs non-root joint translation tracks, set `jointTranslations: 'preserve'`.

<div class="showcase" case="tut-55"></div>
