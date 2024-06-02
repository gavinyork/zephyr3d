# Animation

Currently, we support skeletal animation and keyframe animation. 

The following classes are related to animation playback:

- [AnimationClip](/doc/markdown/./scene.animationclip)

  AnimationClip is an animation instance that contains several animation tracks, with each track controlling a scene node.

- [AnimationSet](/doc/markdown/./scene.animationset)

  AnimationSet is a collection of AnimationClips, used to control the playback and stopping of animations in the collection.

- [AnimationTrack](/doc/markdown/./scene.animationtrack)

  AnimationTrack serves as the abstract base class for all types of animation tracks.

- [TranslationTrack](/doc/markdown/./scene.translationtrack)

  A class for animation tracks that control the translation of scene nodes.

- [RotationTrack](/doc/markdown/./scene.rotationtrack)

  A class for animation tracks that control the rotation of scene nodes, storing keyframes as Quaternions.

- [EulerRotationTrack](/doc/markdown/./scene.eulerrotationtrack)

  A class for animation tracks that control the rotation of scene nodes, storing keyframes as Euler angles.

- [ScaleTrack](/doc/markdown/./scene.scaletrack)

  A class for animation tracks that control the scaling of scene nodes.

