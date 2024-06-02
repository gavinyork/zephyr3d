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
  model.animationSet.playAnimation(animationNames[0], {
    // 循环次数，0为无限循环。默认值为0
    repeat: 0,
    // 速度因子，绝对值越大速度越快，如果为负值则反向播放。默认值为1
    speedRatio: 1,
    // 融合权值，当多个动画同时播放时，所有动画通过这个权值做加权平均，默认为1
    weight: 1,
    // 动画需要多长时间权值从0增长到weight，默认为0，表示无淡入效果，通常和stopAnimation()的fadeOut参数配合用于两个动画无缝切换
    fadeIn: 0,
  });
  // ...
  // 停止播放动画
  model.animationSet.stopAnimation(animationNames[0]);
}

```

<div class="showcase" case="tut-24"></div>
