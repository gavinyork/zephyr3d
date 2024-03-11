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
  /*
    Play one of the animations
    parameter 1: animation name
    parameter 2: The number of animation loops, if it is 0, it will always loop, and the default value is 0
    parameter 3: The animation playback speed, 1 is the normal speed, if it is negative, it is reversed, and the default value is 1 
  */
 // Start play specific animation
  model.animationSet.playAnimation(animationNames[0], 0, 1);
  // ...
  // Stop playing specific animation
  model.animationSet.stopAnimation(animationNames[0]);
}

```

<div class="showcase" case="tut-24"></div>

