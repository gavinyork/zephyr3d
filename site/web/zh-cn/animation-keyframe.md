# 关键帧动画

一个AnimationClip中包含若干动画轨道(AnimationTrack)。每个轨道包含一组关键帧数据以及该轨道控制的节点对象。
可以使用系统预先定义的轨道例如平移，旋转缩放等，也可以自定义轨道。

```javascript

// 创建节点
const box = new Mesh(scene, new BoxShape(), new LambertMaterial());

// 创建AnimationClip并指定动画名称
const animation = new AnimationClip('Animation0');

// 动画内添加一个系统预定义的平移轨道(TranslationTrack)，关键帧数据包含时间（单位为秒）和平移位置，指定该轨道控制节点box
// 第一个参数'linear'指定关键帧之间进行线性插值，参数可选值包括'linear','step','cubicspline'
// 第二个参数是关键帧数组，关键帧对象time为该帧的时间，单位为秒，value对象为该帧的数值

// 添加轨道令节点在2秒内从原点平移到(0, 3, 0)再回到原点
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

// 添加轨道令节点在2秒内从绕Y轴旋转4圈
animation.addTrack(box, new EulerRotationTrack('linear', [{
  time: 0,
  value: new Vector3(0, 0, 0, 'ZYX')
}, {
  time: 2,
  value: new Vector3(0, 8 * Math.PI, 0, 'ZYX')
}]));

// 将动画添加到动画组
const animationSet = box.animationSet;
animationSet.add(animation);

// 开始播放
animationSet.playAnimation('animation0');

// 结束播放
animationSet.stopAnimation('animation0');

```

<div class="showcase" case="tut-25"></div>

