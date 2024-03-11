# Custom animations

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
