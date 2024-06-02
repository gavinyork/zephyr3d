# Skeletal animation

Each vertex of the model is influenced by several joints, resulting in motion. This type of animation is known as skeletal animation. We only support loading skeletal animations from models and do not allow for their creation.

```javascript

// When loading an animation model, the object returned by fetchModel() contains a model node and an AnimationSet object,
// and if the model does not contain animations, the AnimationSet object is null.
const model = await assetManager.fetchModel(scene, 'assets/models/CesiumMan.glb');
// If the model contains animations
if（model.animationSet) {
  // The AnimationSet.getAnimationNames() method is used to get all animation names
  const animationNames = model.animationSet ? model.animationSet.getAnimationNames() : [];
  // Start play specific animation
  model.animationSet.playAnimation(animationNames[0], {
    // Number of loops, 0 for infinite loops. Default value is 0
    repeat: 0,
    // Speed factor, the larger the absolute value, the faster the speed.
    // If it is a negative value, it plays in reverse. Default value is 1
    speedRatio: 1,
    // Blending weight, when multiple animations are playing at the same time,
    // all animations are weighted and averaged using this weight. Default value is 1
    weight: 1,
    // How long it takes for the animation weight to increase from 0 to weight,
    // default is 0, indicating no fade-in effect. Usually used in conjunction
    // with the fadeOut parameter of stopAnimation() for seamless transition
    // between two animations
    fadeIn: 0, 
  });
  // Stop playing specific animation
  model.animationSet.stopAnimation(animationNames[0], {
    // How long it takes for the animation weight to decrease from current weight
    // to 0, default is 0, indicating no fade-out effect. Usually used in conjunction
    // with the fadeIn parameter of playAnimation() for seamless transition between
    // two animations
    fadeOut: 0
  });
}

```

<div class="showcase" case="tut-24"></div>

