
# Keyframe Animation

In **Zephyr3D**, *keyframe animation* controls object property changes through a collection of animation tracks (`AnimationTrack`).  
Each animation clip (`AnimationClip`) contains multiple tracks, and each track controls one property (such as translation, rotation, or scaling) of a specific node.  
The system provides several built‑in track types, and you can also define custom tracks to animate any property.

---

## Relationship Between AnimationClip and AnimationTrack

- An **`AnimationClip`** represents a complete animation sequence (for example, “Move,” “Rotate,” etc.).  
- Each **`AnimationTrack`** controls a single property of a target node.  
- Multiple tracks can affect the same object simultaneously to create complex motions.

---

## Built‑in Track Types

| Track Class | Controls | Interpolation | Description |
|--------------|-----------|----------------|--------------|
| `NodeTranslationTrack` | Translation (`Vector3`) | Linear / Step / Cubic Spline | Controls the node’s position changes |
| `NodeEulerRotationTrack` | Euler Rotation (`Vector3`) | Linear / Step / Cubic Spline | Controls node rotation using Euler angles |
| `NodeScaleTrack` | Scale (`Vector3`) | Linear / Step / Cubic Spline | Controls node scaling |
| `PropertyTrack` | Any property | Depends on property type | Allows custom keyframe animation of arbitrary properties |

---

## Example: Creating a Keyframe Animation

The example below shows how to create a simple animation that moves a box up and down along the Y‑axis  
while simultaneously rotating it about the Y‑axis.

```javascript
// Create a node
const box = new Mesh(scene, new BoxShape(), new LambertMaterial());

// Create an AnimationClip and assign an animation name
const clip = box.animationSet.createAnimation('move');

// Add a built‑in translation track (NodeTranslationTrack)
// Parameters:
//   The first argument 'linear' defines linear interpolation between keyframes
//   The second argument is an array of keyframes, each with a time (seconds) and value
clip.addTrack(
  box,
  new NodeTranslationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 1, value: new Vector3(0, 3, 0) },
    { time: 2, value: new Vector3(0, 0, 0) }
  ])
);

// Add a rotation track (NodeEulerRotationTrack)
// Spins the box around the Y‑axis four times over two seconds
clip.addTrack(
  box,
  new NodeEulerRotationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 2, value: new Vector3(0, 8 * Math.PI, 0) }
  ])
);

// Play the animation in a loop
box.animationSet.playAnimation('move', { repeat: 0 });

// Stop playback
box.animationSet.stopAnimation('move');
```

<div class="showcase" case="tut-25"></div>

---

## Interpolation Modes

When creating a track instance, the first parameter defines the interpolation type between keyframes:

| Interpolation Mode | Description |
|--------------------|--------------|
| `'linear'` | Linear interpolation (default), produces smooth transitions |
| `'step'` | Step‑based transition (no blending), jumps directly to the next value |
| `'cubicspline'` | Cubic spline interpolation, used for highly continuous or smooth motion |

> Choose an interpolation mode according to your animation style:  
> Use `step` for discrete events or mechanical motion,  
> and `linear` or `cubicspline` for natural or continuous movement.

---

## Notes

- Time values for all keyframes are measured in **seconds**.  
- All animations are managed by a node’s built‑in `animationSet`.  
- You can combine multiple tracks on the same node (for example, translation + rotation) to create complex motion.  
- For smooth transitions between multiple animations, use `playAnimation()`’s `fadeIn` together with `stopAnimation()`’s `fadeOut` parameter.

---

## Summary

- **AnimationClip** – a complete animation sequence  
- **AnimationTrack** – defines how properties change over time  
- **Keyframe Data** – contains time‑value pairs describing property changes  
- **Built‑in Tracks** – provide translation, rotation, and scale control  
- **Custom Tracks** – extendable for any property you want to animate  

---

> **Tip:**  
> It is recommended to use the **Zephyr3D Editor** to create and edit keyframe animations visually.  
> The editor allows intuitive timeline editing and interpolation control, significantly improving workflow efficiency.
