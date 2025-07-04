# Custom animations

In addition to predefined tracks, custom tracks can be added to implement custom animations.

Custom tracks need to inherit the AnimationTrack class and implement the following methods:

- [AnimationTrack.calculateState()](/doc/markdown/./scene.animationtrack.calculatestate)

  This method is used to calculate and return the state of an animation track at a specific time. For example, it can return a Vector3 type displacement, a Quaternion type rotation, or a Number type transparency, etc. The state value is used for the track itself, so it can be a member of the track.

- [AnimationTrack.mixState()](/doc/markdown/./scene.animationtrack.mixstate)

  This method is used to interpolate between two track states, mainly for action blending. This method must return a new state object.

- [AnimationTrack.applyState()](/doc/markdown/./scene.animationtrack.applystate)

  This method is used to apply the track state to a node.

- [AnimationTrack.getBlendId()](/doc/markdown/./scene.animationtrack.getblendid)

  This method returns a value (usually a string, but can also be an object). Tracks in the system with the same BlendID are considered blendable. Additionally, tracks with the same BlendID are not allowed to be added to the same AnimationClip.

```javascript

// Custom animation track for UV animation and opacity animation of nodes
class MyAnimationTrack extends AnimationTrack {
  // Track state, a Float32Array of length 2, the first element stores the UV displacement, the second element stores the opacity
  _state;
  // The constructor takes an interpolator object that stores keyframes
  constructor(interpolator) {
    super(interpolator);
    this._state = new Float32Array(2);
  }
  // Use the interpolator to calculate and return the track state at a given time
  calculateState(target, currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }
  // Blend two tracks by interpolation and return the blended state
  mixState(stateA, stateB, t) {
    const result = new Float32Array(2);
    result[0] = a[0] + (b[0] - a[0]) * t;
    result[1] = a[1] + (b[1] - a[1]) * t;
    return result;
  }
  // Apply the track state to the node
  applyState(node, state) {
    // Here we apply the track animation to the node and all its child Mesh nodes node
    node.iterate((child) => {
      if (child.isMesh()) {
        // Set the UV transformation matrix
        mesh.material.albedoTexCoordMatrix = Matrix4x4.translation(new Vector3(state[0], 0, 0));
        // Set the opacity
        mesh.material.opacity = state[1];
      }
    });
  }
  // The BlendId of this track type
  getBlendId() {
    // Return a unique id so that all MyAnimationTracks can blend with each other
    return 'my-animation-track';
  }
}

// Create animations and use custom tracks

// Assume model is a loaded model
const model = await assetManager.fetchModel(scene, MODEL_URL);
// Get the animation set object of this model
const animationSet = model.group.animationSet;
// Create an animation
const animation = new AnimationClip('UserTrackTest');
// Create an interpolator to store keyframes for the custom animation
const interpolator = new Interpolator(
  // Linear interpolation
  'linear',
  // Automatically calculate the number of elements per keyframe: output.length/input.length
  null,
  // input, the time of each keyframe in seconds
  new Float32Array([0, 1, 2]),
  // output, each keyframe data has two elements, the first is the UV displacement, the second is the opacity
  // Three keyframe data:
  // (0, 0.9), (0.5, 0), (1, 0.9)
  new Float32Array([0, 0.9, 0.5, 0, 1, 0.9])
);
// Create a custom track using the keyframe data
const track = new MyAnimationTrack(interpolator);
// Add the track to the animation and specify the node that the track should control
animation.addTrack(model.group, track);
// Add the animation to the animation set
animationSet.add(animation);

// Start playing this animation
animationSet.playAnimation('UserTrackTest', {
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

```

In the following example, we have implemented UV animation and opacity fading through custom tracks.

<div class="showcase" case="tut-26"></div>
