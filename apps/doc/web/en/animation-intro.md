
# Animation

Zephyr3D’s animation system supports two main types of animation:

- **Skeletal Animation** — used for skinned meshes with bones  
- **Keyframe Animation** — used for animating position, rotation, scale, or custom properties  

The system is organized in a hierarchical structure:  
**AnimationSet → AnimationClip → AnimationTrack**,  
providing flexible control for playback, blending, and updates.

---

## Animation System Overview

| Class | Purpose | Description |
|--------|----------|-------------|
| `AnimationSet` | Animation Collection | Manages all animation clips (`AnimationClip`) for a model, including creation, playback, updating, and blending. |
| `AnimationClip` | Animation Clip | Contains one or more animation tracks, each controlling a property of a specific target object. |
| `AnimationTrack` | Animation Track | Abstract base class. Subclasses implement `calculateState()`, `applyState()`, `mixState()`, and related methods. |
| `Skeleton` | Skeleton Object | Provides joint matrices, skinning transforms, and GPU textures for skeletal animations. |

---

## AnimationSet — Animation Collection

Each model (`SceneNode`) can have an associated `AnimationSet` to manage its animations at runtime.

```javascript
// Get the animation set from a node or model
const animSet = model.animationSet;
```

### Creating and Managing Animations
```javascript
// Create a new animation clip named "move"
const moveClip = animSet.createAnimation("move");

// Get or delete an animation clip
const clip = animSet.getAnimationClip("move");
animSet.deleteAnimation("move");
```

### Playing and Stopping Animations
```javascript
// Play an animation with looping, speed, and fade‑in options
animSet.playAnimation("move", {
  repeat: 0,     // 0 means infinite loop
  speedRatio: 1, // playback speed multiplier
  fadeIn: 0.3    // fade in over 0.3 seconds
});

// Stop an animation with optional fade‑out
animSet.stopAnimation("move", { fadeOut: 0.2 });
```

### Update Cycle
Animation updates are handled **automatically** by the engine—  
you do not need to manually call an update function each frame.

---

## AnimationClip — Animation Clip

`AnimationClip` represents a complete playable animation (e.g., “Run,” “Jump,” etc.).

```javascript
const moveClip = animSet.createAnimation("move");

// Add animation tracks to control properties of a scene node
moveClip.addTrack(model, myTranslationTrack);

// Set the total duration (in seconds)
moveClip.timeDuration = 2.0;
```

---

## AnimationTrack — Base Class

Animation tracks define *how* the animation is computed, applied, and blended.

```typescript
abstract class AnimationTrack<StateType> {
  abstract calculateState(target: object, currentTime: number): StateType;
  abstract applyState(target: object, state: StateType): void;
  abstract mixState(a: StateType, b: StateType, t: number): StateType;
  abstract getBlendId(): unknown;
  abstract getDuration(): number;
  reset(target: object) {}
}
```

### Core Methods
| Method | Description |
|---------|--------------|
| `calculateState(target, time)` | Calculates the current state based on elapsed time (e.g., position or rotation). |
| `applyState(target, state)` | Applies the calculated state to the target object. |
| `mixState(a, b, t)` | Blends two states for smooth transitions. |
| `getBlendId()` | Returns a blending identifier; tracks with the same ID can be blended together. |
| `getDuration()` | Returns the track duration (in seconds). |
| `reset(target)` | Resets the target to its initial state (optional). |

---

## Example: Creating a Keyframe Animation

Suppose you want a node to move up and down along the Y‑axis in a loop.

```javascript
// 1. Create a clip
const animSet = node.animationSet;
const clip = animSet.createAnimation("bob");

// 2. Define a custom animation track
class MoveYTrack extends AnimationTrack<number> {
  calculateState(target, time) {
    // Simple sine wave motion
    return Math.sin(time * Math.PI * 2) * 2.0;
  }
  applyState(target, yPos) {
    target.position.y = yPos;
  }
  mixState(a, b, t) {
    return a * (1 - t) + b * t;
  }
  getBlendId() {
    return "positionY";
  }
  getDuration() {
    return 1.0;
  }
}

// 3. Create and add the track to the animation
const moveTrack = new MoveYTrack();
clip.addTrack(node, moveTrack);
clip.timeDuration = 2.0;

// 4. Play the animation in a loop
animSet.playAnimation("bob", { repeat: 0 }); // 0 = infinite loop
```

---

> 💡 **Tip:**  
> It is recommended to use the **Zephyr3D Editor** to create and edit animations and animation tracks visually.
