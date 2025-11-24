
# Skeletal Animation

In skeletal animation, each vertex of a model is influenced by one or more **joints (bones)** that define how the mesh deforms and moves.  
This technique is primarily used for animating characters, creatures, and other articulated objects.

Zephyr3D **supports loading skeletal animations from models**, but **you cannot create skeletal animations manually** via code.

---

## Example

```javascript
// Load a model that contains skeletal animation.
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/CesiumMan.zprefab'
);

// Play the first animation included in the model
model.animationSet.playAnimation(model.animationSet.getAnimationNames()[0], {
  // Number of loops; use 0 for infinite looping (default is 0)
  repeat: 0,
  // Playback speed multiplier; higher = faster, negative = reverse playback (default is 1)
  speedRatio: 1,
  // Weight for animation blending (default is 1)
  weight: 1,
  // Duration for fade‑in effect, in seconds; set to 0 for instant start.
  // Often used with stopAnimation()’s fadeOut parameter for seamless cross‑fading.
  fadeIn: 0,
});

// ...

// Stop playback of the animation
model.animationSet.stopAnimation(animationNames[0]);
```

<div class="showcase" case="tut-24"></div>

---

> 💡 **Note:**  
> - The **`AnimationSet`** object manages all animations linked to a model.  
> - Use `getAnimationNames()` to retrieve available animation names.  
> - Playback options such as *repeat*, *speedRatio*, and *fadeIn* allow fine‑grained control.  
> - For smooth transitions between animations, use `fadeIn` with a corresponding `fadeOut` parameter when stopping another animation.
