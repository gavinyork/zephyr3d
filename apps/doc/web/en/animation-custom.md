
# Custom Animation

In addition to built‑in animation tracks (such as translation, rotation, and scaling),  
**Zephyr3D** allows developers to **create custom tracks** by extending the `AnimationTrack` class.  
This enables you to implement fully customized animations — for example, **UV scrolling**, **material changes**, or **color fading**.

---

## Core Concept of Custom Tracks

A **custom animation track** is implemented by subclassing `AnimationTrack`.  
You must override four key methods to define how the track computes, mixes, and applies animation states.

| Method | Description |
|---------|-------------|
| **`calculateState(target, currentTime)`** | Calculates the track’s state at a given time (e.g., position, rotation, number, etc.) and returns a state object. The type can be `Vector3`, `Quaternion`, `Number`, or any custom data type. |
| **`mixState(stateA, stateB, t)`** | Interpolates between two states. Used during animation blending and must return a **new state object**. |
| **`applyState(target, state)`** | Applies the current track state to the target object. The target is typically a `SceneNode`. |
| **`getBlendId()`** | Returns a unique identifier for the track type. Tracks sharing the same `blendId` can be blended, but they cannot coexist within the same `AnimationClip`. |

> 💡 **Note:**  
> You cannot add two tracks with the same `blendId` to a single `AnimationClip`,  
> as the system assumes they control the same property.

---

## Example: Creating a Custom UV Animation Track

The following example shows how to create a custom animation track that moves a material’s texture coordinates,  
producing a looping UV scroll effect.

```javascript
// Custom animation track: UV animation
class MyAnimationTrack extends AnimationTrack {
  _state; // Current track state (Float32Array)
  _interpolator; // Interpolator used to calculate keyframe values

  // Constructor: receives a keyframe interpolator
  constructor(interpolator) {
    super();
    this._interpolator = interpolator;
    this._state = new Float32Array(1);
  }

  // Clone this track (abstract, must be implemented)
  clone() {
    return new MyAnimationTrack(this._interpolator);
  }

  // Calculate and return the state at the given time
  calculateState(target, currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }

  // Blend two states (used for animation blending)
  mixState(a, b, t) {
    const result = new Float32Array(1);
    result[0] = a[0] + (b[0] - a[0]) * t;
    return result;
  }

  // Apply the computed state to the target node
  applyState(target, state) {
    // Traverse all meshes under the node
    target.iterate((child) => {
      if (child.isMesh()) {
        // Apply UV transformation (UV scroll effect)
        child.material.albedoTexCoordMatrix = Matrix4x4.translation(
          new Vector3(state[0], 0, 0)
        );
      }
    });
  }

  // Unique identifier for this type of track
  getBlendId() {
    return 'uv-animation';
  }

  // Track duration in seconds (abstract, must be implemented)
  getDuration() {
    return this._interpolator.maxTime;
  }
}
```

> `AnimationTrack` has six abstract members that must all be implemented: `clone()`,
> `calculateState()`, `applyState()`, `mixState()`, `getBlendId()` and `getDuration()`.
> Omitting any of them fails to compile under TypeScript.

---

## Using a Custom Track

The full process includes five steps:

1. **Load a model**  
2. **Create an animation clip**  
3. **Create an interpolator**  
4. **Create and add the custom track**  
5. **Play the animation**

```javascript
// Step 1: Load a model
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/BoxTextured.zprefab'
);

// Step 2: Create an animation clip
const animation = model.animationSet.createAnimation('UserTrackTest');

// Step 3: Create a keyframe interpolator
const interpolator = new Interpolator(
  'linear',                  // Interpolation mode ('linear', 'step', 'cubicspline')
  null,                      // Automatically infer element size from arrays
  new Float32Array([0, 2]),  // Time keyframes: 0s → 2s
  new Float32Array([0, 1])   // Value keyframes: UV offset from 0 → 1
);

// Step 4: Create and add the custom track
const track = new MyAnimationTrack(interpolator);
animation.addTrack(model, track);

// Step 5: Play the animation
model.animationSet.playAnimation('UserTrackTest', {
  repeat: 0,     // Loop count (0 = infinite loop)
  speedRatio: 1, // Playback speed multiplier
  weight: 1,     // Blending weight when multiple animations are playing
  fadeIn: 0,     // Fade‑in duration
});
```

<div class="showcase" case="tut-26"></div>

---

## Method Implementations Explained

### `calculateState()`
Computes the state of the track based on the current playback time.  
This method is called every frame, and the result is later applied via `applyState()`.

### `mixState()`
Called when two animations with the same `blendId` are played simultaneously.  
Returns a new blended state by interpolating between `stateA` and `stateB` using ratio `t`.

### `applyState()`
Applies the computed state to the target object.  
This can include actions like:
- Updating position, rotation, or scale  
- Adjusting material or color properties  
- Controlling custom attributes like light intensity or texture offsets  

### `getBlendId()`
Defines the unique identity of the track type.  
Tracks with identical `blendId` can be blended; otherwise, they are handled independently.

---

## Practical Tips

| Use Case | Recommended Implementation |
|-----------|----------------------------|
| Custom material animations (UV scroll, flicker) | Modify material properties like `UV` or `emission` |
| Camera effects (focus, depth‑of‑field) | Animate camera parameters directly |
| Light animations (intensity, color) | Track modifies lighting attributes |
| Environment transitions (fog, exposure) | Animate global rendering parameters |

---

## Summary

- Extend **`AnimationTrack`** to create fully custom animations  
- Implement the four essential methods: `calculateState()`, `mixState()`, `applyState()`, and `getBlendId()`  
- Combine with **Interpolator** for precise keyframe‑based control  
- Custom tracks are powerful — they can animate **any property** in the engine

---

> 💡 **Suggestions:**  
> - Keep each track’s `blendId` unique to prevent conflicts  
> - Custom animations are suitable for complex material, environment, or effect systems  
> - The **Zephyr3D Editor** supports creating keyframe animations for most object properties directly

