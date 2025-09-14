# Animation Blending

Currently, we support blending of all types of animations. The usage is quite simple - you only need to play animations with specific weights. All currently playing animations will be blended together using weighted averaging based on their respective weights.

## Weight Blending

The following code simultaneously plays three animations and blends them with a ratio of 3:7:5.

```javascript

animationSet.playAnimation('animation-1', {
  weight: 3, // Weight
});

animationSet.playAnimation('animation-2', {
  weight: 7, // Weight
});

animationSet.playAnimation('animation-3', {
  weight: 5, // Weight
});

```

## Animation Transitions

Animation transitions are also implemented using weights to avoid sudden jumps when switching between two animations.

```javascript

// Assume animation A is currently playing, and we need to transition to animation B

// Stop animation A with a fade-out time of 0.3 seconds
animationSet.stopAnimation('A', {
  fadeOut: 0.3
});

// Play animation B with a fade-in time of 0.3 seconds
animationSet.playAnimation('B', {
  fadeIn: 0.3
});

```

In the example above, the weight of animation A gradually decreases to 0 within 0.3 seconds
and stops playing, while the weight of animation B gradually increases from 0 to 1 within 0.3
seconds, achieving a seamless transition between the two animations.
