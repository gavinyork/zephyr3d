# 骨骼动画

模型的每个顶点都受到若干关节(Joint)的影响而产生运动，这种动画称为骨骼动画。我们只支持从模型中载入骨骼动画， 不可以自己创建。

```javascript

// 载入动画模型
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/CesiumMan.zprefab'
);
// 播放模型包含的动画
model.animationSet.playAnimation(model.animationSet.getAnimationNames()[0]， {
  // 循环次数，0为无限循环。默认值为0
  repeat: 0,
  // 速度因子，绝对值越大速度越快，如果为负值则反向播放。默认值为1
  speedRatio: 1,
  // 多个动画融合时此动画的权重，默认为1
  weight: 1,
  // 动画需要多长时间权值从0增长到weight，默认为0，表示无淡入效果，通常和stopAnimation()的fadeOut参数配合用于两个动画无缝切换
  fadeIn: 0,
});
// ...
// 停止播放动画
model.animationSet.stopAnimation(animationNames[0]);

```

<div class="showcase" case="tut-24"></div>
