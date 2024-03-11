# 骨骼动画

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
