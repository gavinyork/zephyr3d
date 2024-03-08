# 动画

当前我们支持骨骼动画(Skeletal Animation)和关键帧动画(Keyframe Animation)。

以下几个类和动画播放有关：

- [AnimationClip](/doc/markdown/./scene.animationclip)

  AnimationClip是一个动画实例，内部包含了若干组动画轨道，每个轨道控制一个场景节点。

- [AnimationSet](/doc/markdown/./scene.animationset)

  AnimationSet是一组AnimationClip的集合，用于控制集合中动画的播放和停止。

- [AnimationTrack](/doc/markdown/./scene.animationtrack)

  AnimationTrack是所有动画轨道类型的抽象基类。

- [TranslationTrack](/doc/markdown/./scene.translationtrack)

  控制场景节点平移的动画轨道类

- [RotationTrack](/doc/markdown/./scene.rotationtrack)

  控制场景节点旋转的动画轨道类，以Quaternion类型存储关键帧。

- [EulerRotationTrack](/doc/markdown/./scene.eulerrotationtrack)

  控制场景节点旋转的动画轨道类，以欧拉角类型存储关键帧

- [ScaleTrack](/doc/markdown/./scene.scaletrack)

  控制场景节点缩放的动画轨道类

- [UserTrack](/doc/markdown/./scene.usertrack)

  用户自定义轨道类型，允许用户指定关键帧数据通过回调函数实现自定义动画。

