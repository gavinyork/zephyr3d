# Animation

Currently, we support both Skeletal Animation and Keyframe Animation. 

To play an animation, an [AnimationSet](/doc/markdown/./scene.animationset) object and several [AnimationClip](/doc/markdown/./scene.animationclip) objects are required. An AnimationClip object represents an animation instance, while an AnimationSet object is a collection of AnimationClip objects. Each AnimationClip within an AnimationSet has a unique name.

## Skeletal animation

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

## Keyframe animation

An AnimationClip comprises several animation tracks, each containing a set of keyframe data and the node object controlled by the track. Users can utilize pre-defined tracks, such as translation, rotation, and scaling, or create custom tracks.

```javascript

// Creates mesh
const box = new Mesh(scene, new BoxShape(), new LambertMaterial());

// Create an AnimationClip and specify a name for the animation
const animation = new AnimationClip('Animation0');

/*
  A system-predefined TranslationTrack is added to the animation,
  and the keyframe data contains the time (in seconds) and the translation position,
  specifying the track control node box
  The first parameter, 'linear', specifies linear interpolation between keyframes, and optional values include 'linear', 'step', 'cubicspline'
  The second parameter is an array of keyframes, the time of the keyframe object is the time of the frame, the unit is seconds, and the value object is the numerical value of the frame
*/

// Add a track to make the node pan from the origin to (0, 3, 0) and back again in 2 seconds.
animation.addTrack(box, new TranslationTrack('linear', [{
  time: 0,
  value: new Vector3(0, 0, 0)  
}, {
  time: 1,
  value: new Vector3(0, 3, 0)
}, {
  time: 2,
  value: new Vector3(0, 0, 0)
}]));

// Adding a track causes the node to rotate 4 times from the Y axis in 2 seconds
animation.addTrack(box, new EulerRotationTrack('linear', [{
  time: 0,
  value: new Vector3(0, 0, 0, 'ZYX')
}, {
  time: 2,
  value: new Vector3(0, 8 * Math.PI, 0, 'ZYX')
}]));

// Add the animation to an animation set
const animationSet = new AnimationSet(scene);
animationSet.add(animation);

// Start playing 
animationSet.playAnimation('animation0', 0);

// Stop playing
animationSet.stopAnimation('animation0');

```

<div class="showcase" case="tut-25"></div>

## Custom animations

In addition to predefined tracks, custom tracks can also be added to create custom animations.

```javascript

/*
  The UserTrack object is used to customize the track

  parameter 1: Interpolation method
  parameter 2: Interpolation type, optional values are 'number', 'vec2', 'vec3', 'vec4', 'quat'
  parameter 3: For keyframe arrays, the value property of each element of the array must correspond to the interpolation type, which can be number, Vector2, Vector3, Vector4, and Quaternion
  parameter 4: A callback function that applies the interpolation result to the node object passed when addTrack() is called.

*/
animationClip.addTrack(node, new UserTrack('linear', 'number', [{
  time: 0,
  value: 0,
}, {
  time: 1,
  value: 1
}], (node, value) => {

}));

```

In the following example, we have implemented UV animation and opacity fading through custom tracks.

<div class="showcase" case="tut-26"></div>
