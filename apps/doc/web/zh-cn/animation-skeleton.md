# 骨骼动画

模型的每个顶点都受到若干关节(Joint)的影响而产生运动，这种动画称为骨骼动画。骨骼动画通常从模型或动画资源中载入，然后通过 `AnimationSet` 播放、混合、创建遮罩动画或在兼容的人形骨架之间重定向。

```javascript
// 载入动画模型
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/CesiumMan.zprefab'
);

const animationNames = model.animationSet.getAnimationNames();

// 播放模型包含的动画
model.animationSet.playAnimation(animationNames[0], {
  // 循环次数，0为无限循环。默认值为0
  repeat: 0,
  // 速度因子，绝对值越大速度越快，如果为负值则反向播放。默认值为1
  speedRatio: 1,
  // 多个动画融合时此动画的权重，默认为1
  weight: 1,
  // 动画需要多长时间权值从0增长到weight，默认为0，表示无淡入效果，
  // 通常和stopAnimation()的fadeOut参数配合用于两个动画无缝切换
  fadeIn: 0
});

// ...

// 停止播放动画
model.animationSet.stopAnimation(animationNames[0]);
```

<div class="showcase" case="tut-24"></div>

## AnimationMask

`AnimationMask` 用于从已有骨骼动画中生成只影响部分关节的新 `AnimationClip`。生成后的动画仍然是普通动画片段，可以用 `playAnimation()` 播放，也可以和其他动画按权重混合。常见用法是把全身动作拆成上半身、下半身或单侧肢体动作，例如让角色下半身播放跑步，上半身播放射击或挥手。

通过 `AnimationSet.createSkeletalMaskedAnimation(sourceName, targetName, options)` 创建遮罩动画：

```javascript
// 从完整动作中拆出上半身和下半身动画
model.animationSet.createSkeletalMaskedAnimation('walk', 'walk_upper', {
  type: 'humanoid',
  preset: 'upperBody'
});

model.animationSet.createSkeletalMaskedAnimation('walk', 'walk_lower', {
  type: 'humanoid',
  preset: 'lowerBody'
});

// 两个互补遮罩动画可以同时播放，不会互相覆盖未包含的身体部位
model.animationSet.playAnimation('walk_upper');
model.animationSet.playAnimation('walk_lower');
```

人形骨架可以使用语义遮罩：

- `preset` 支持 `fullBody`、`upperBody`、`lowerBody`、`head`、`arms`、`leftArm`、`rightArm`、`legs`、`leftLeg`、`rightLeg`。
- `includeBody` / `excludeBody` 可以按 `HumanoidBodyRig` 语义关节增减选择范围。
- `includeLeftHand`、`includeRightHand`、`excludeLeftHand`、`excludeRightHand` 可以按手指语义关节控制手部。
- `includeDescendants` 表示被选中或排除的关节是否连同所有子关节一起生效。人形语义遮罩默认值为 `true`。

```javascript
import { HumanoidBodyRig } from '@zephyr3d/scene';

// 只保留左臂及其子关节，不包含根运动
model.animationSet.createSkeletalMaskedAnimation('attack', 'attack_left_arm', {
  type: 'humanoid',
  includeBody: [HumanoidBodyRig.LeftUpperArm],
  includeDescendants: true,
  rootMotion: 'exclude'
});
```

非人形骨架可以使用关节名遮罩：

```javascript
// 选择 Spine 及其子关节，但排除 LeftHand 分支
model.animationSet.createSkeletalMaskedAnimation('full_body', 'upper_without_left_hand', {
  type: 'joints',
  include: ['Spine'],
  exclude: ['LeftHand'],
  includeDescendants: true
});
```

`rootMotion` 控制根位移轨道如何复制，可选值为 `include`、`exclude`、`only`。未显式指定时，`fullBody` 和 `lowerBody` 人形遮罩默认包含根运动，其他遮罩默认排除根运动。`unsupportedTracks` 可设置为 `skip` 或 `error`，用于决定遇到非节点变换轨道时跳过还是创建失败。

## 骨骼动画重定向

骨骼动画重定向用于把一个人形角色的动画复制到另一个人形角色上。Zephyr3D 通过 `AnimationSet.copyHumanoidAnimationFrom()` 完成重定向，它按 `HumanoidBodyRig` / `HumanoidHandRig` 语义映射匹配关节，而不是按关节名称匹配，因此源模型和目标模型的骨骼命名可以不同。

使用条件：

- 源骨架和目标骨架都需要有 `humanoidJointMapping`。
- 源动画片段必须能解析到唯一的骨架。
- 目标 `AnimationSet` 中不能已经存在同名动画。
- 未映射的关节会被跳过；非根关节的平移轨道默认跳过，以保留目标骨架比例。

```javascript
// sourceModel 只提供动作，targetModel 是要播放动作的角色
const retargeted = targetModel.animationSet.copyHumanoidAnimationFrom(
  sourceModel.animationSet,
  'walk',
  'walk_retargeted',
  {
    // 默认值为 scaled，会按目标角色腿长缩放根运动
    rootMotion: 'scaled',
    // 锁定 Y 轴可避免根运动改变目标角色的绑定姿态高度
    lockRootMotionAxes: { y: true }
  }
);

if (retargeted) {
  targetModel.animationSet.playAnimation('walk_retargeted', {
    fadeIn: 0.2
  });
}
```

`rootMotion` 支持以下模式：

- `scaled`：默认模式，重定向根运动并按目标骨架尺寸缩放。
- `copy`：重定向根运动但不缩放位移。
- `locked`：写入目标骨架绑定姿态下的常量根位移。
- `none`：不生成根位移轨道。

`rootMotionScale` 可以设置为 `legLength`、`none` 或具体数字；`lockRootMotionAxes` 可以锁定 `x`、`y`、`z` 中的任意轴；如果确实需要保留非根关节平移轨道，可设置 `jointTranslations: 'preserve'`。

<div class="showcase" case="tut-55"></div>
