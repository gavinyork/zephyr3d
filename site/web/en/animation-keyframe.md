# Keyframe animation

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

// Add the animation to box's animation set
const animationSet = box.animationSet;
animationSet.add(animation);

// Start playing 
animationSet.playAnimation('animation0');

// Stop playing
animationSet.stopAnimation('animation0');

```

<div class="showcase" case="tut-25"></div>

