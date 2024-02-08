# 动画

当前我们支持骨骼动画(Skeletal Animation)和关键帧动画(Keyframe Animation)。

要播放动画，我们需要一个[AnimationSet](/doc/markdown/./scene.animationset)对象，若干[AnimationClip](/doc/markdown/./scene.animationclip)对象。AnimationClip对象代表了一个动画实例，
AnimationSet对象是一组AnimationClip的集合。一个AnimationSet中的每个AnimationClip都有一个唯一的名字。

## 骨骼动画

模型的每个顶点都受到若干关节(Joint)的影响而产生运动，这种动画称为骨骼动画。我们只支持从模型中载入骨骼动画， 不可以自己创建。

```javascript

// 载入动画模型，fetchModel()返回的对象包含一个模型节点和一个AnimationSet对象，如果模型不包含动画，AnimationSet对象为null。
const model = await assetManager.fetchModel(scene, 'assets/models/CesiumMan.glb');
// 如果模型包含动画
if（model.animationSet) {
  // AnimationSet.getAnimationNames()方法用来获取所有动画名字
  const animationNames = model.animationSet ? model.animationSet.getAnimationNames() : [];
  // 播放其中一个动画
  // 第一个参数是动画名字
  // 第二个参数是动画循环次数，如果为0则始终循环，不传默认值为0
  // 第三个参数是动画播放速度系数，1为常规速度，如果是负值则为倒放，不传默认值为1
  model.animationSet.playAnimation(animationNames[0], 0, 1);
  // ...
  // 停止播放动画
  model.animationSet.stopAnimation(animationNames[0]);
}

```

<div class="showcase" case="tut-24"></div>

## 关键帧动画

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
const animationSet = new AnimationSet(scene);
animationSet.add(animation);

// 开始播放
// 第二个参数指定循环播放次数，如果为0，则始终循环
animationSet.playAnimation('animation0', 0);

// 结束播放
animationSet.stopAnimation('animation0');

```

<div class="showcase" case="tut-25"></div>

## 自定义动画

除了预定义的轨道之外，也可以添加自定义轨道来实现自定义的动画。

```javascript

// UserTrack对象用来自定义轨道
// 第一个参数为插值方式
// 第二个参数指定插值类型，可选值为'number','vec2','vec3','vec4','quat'
// 第三个参数为关键帧数组，数组每个元素的value属性必须和插值类型对应，可以是number,Vector2,Vector3,Vector4和Quaternion
// 第四个参数为回调函数，用于将插值结果应用到调用addTrack()时传递的节点对象。
animationClip.addTrack(node, new UserTrack('linear', 'number', [{
  time: 0,
  value: 0,
}, {
  time: 1,
  value: 1
}], (node, value) => {

}));

```

下面的示例当中，我们通过自定义轨道实现了UV动画和透明度渐变。

<div class="showcase" case="tut-26"></div>
