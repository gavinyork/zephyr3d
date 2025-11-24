
# Animation Blending

In **Zephyr3D**, the animation system supports blending between **all types of animations**, including both keyframe and skeletal animations.  
By assigning different **playback weights (`weight`)** to multiple animations, you can control the proportion of influence each animation has.  
All currently playing animations are combined via **weighted averaging**, producing a smooth and natural blended result.

---

## Principle of Animation Blending

When multiple animations affect the same object at the same time,  
the engine assigns each animation a **weight value** and computes a **weighted average** during the update phase:

$$
S_{final} = \frac{\sum_{i=1}^{n}(S_i \times w_i)}{\sum_{i=1}^{n}w_i}
$$

Where:
- $S_i$ is the current state of the *i-th* animation (e.g., position, rotation, or scale);  
- $w_i$ is the weight assigned to that animation;  
- $S_{final}$ is the final blended result after applying all weights.

This process enables Zephyr3D to produce **smooth and natural animation transitions**,  
such as blending between “walk → run,” or layering separate upper‑body and lower‑body actions.

---

## Weighted Blending Example

The following example plays **three animations simultaneously** with weight ratios of **3 : 7 : 5**.

```javascript
animationSet.playAnimation('animation-1', {
  weight: 3, // Weight of Animation 1
});

animationSet.playAnimation('animation-2', {
  weight: 7, // Weight of Animation 2
});

animationSet.playAnimation('animation-3', {
  weight: 5, // Weight of Animation 3
});
```

In this case, the engine automatically calculates the final animation state  
by performing a linear weighted blend of the three animations in a 3 : 7 : 5 ratio.  
A higher weight means that animation contributes more to the final result.

> **Tip:**  
> - Animations without a specified `weight` default to **1**.  
> - You can adjust `weight` dynamically at runtime to achieve smooth interactive transitions.

---

## Cross‑Fade Between Animations

**Cross‑fading** is a common blending technique that smoothly transitions between two animations  
without sudden stopping or popping, by gradually altering their respective weights.

### Example

```javascript
// Suppose Animation A is currently playing, and we want to switch to Animation B

// Stop Animation A with a fade‑out duration of 0.3 seconds
animationSet.stopAnimation('A', {
  fadeOut: 0.3
});

// Play Animation B with a fade‑in duration of 0.3 seconds
animationSet.playAnimation('B', {
  fadeIn: 0.3
});
```

During this transition:
- The weight of **Animation A** smoothly decreases from **1 → 0** over 0.3 seconds.  
- The weight of **Animation B** smoothly increases from **0 → 1** over 0.3 seconds.  
- The engine blends both animations based on these weights, resulting in a **seamless transition**.

---

## Practical Tips

| Use Case | Recommended Approach |
|-----------|----------------------|
| Transition from *Walk* to *Run* | `stopAnimation("walk", { fadeOut: 0.4 })` + `playAnimation("run", { fadeIn: 0.4 })` |
| Layer upper‑body actions (e.g. waving, shooting) over lower‑body movement | Create independent animation clips for different bone groups with separate weights |
| Subtle idle-motion or breathing variation | Play multiple idle clips and dynamically adjust `weight` values |
| Smooth camera animation transitions | Use `fadeIn` / `fadeOut` to eliminate abrupt viewpoint jumps |

---

## Summary

- Zephyr3D supports **weighted blending of any number of animations**.  
- The **weight** of each animation defines its influence on the final pose or state.  
- `fadeIn` and `fadeOut` provide smooth transitions between animations.  
- Ideal for combining movement states, layered character actions, and cinematic animation systems.

