
# 动画（Animation）

Zephyr3D 的动画系统支持两类主要的动画：

- **骨骼动画（Skeletal Animation）**：用于带骨骼的蒙皮网格；
- **关键帧动画（Keyframe Animation）**：用于位置、旋转、缩放或属性动画。

系统以 **AnimationSet → AnimationClip → AnimationTrack** 为层次结构，提供灵活的播放、混合与更新控制。

---

## 动画系统结构概览

| 类 | 作用 | 说明 |
|----|------|------|
| `AnimationSet` | 动画集合 | 管理所有动画片段（`AnimationClip`）的创建、播放、更新和混合。|
| `AnimationClip` | 动画片段 | 由若干轨道组成，每个轨道控制一个对象的某项属性。|
| `AnimationTrack` | 动画轨道 | 抽象基类。派生类应实现 `calculateState()`、`applyState()`、`mixState()` 等方法。|
| `Skeleton` | 骨骼对象 | 提供关节矩阵、蒙皮变换、GPU 纹理等，用于骨骼动画。|

---

## AnimationSet — 动画集合

管理模型上的所有动画片段。  
每个模型（`SceneNode`）在运行时可绑定一个 `AnimationSet`：

```javascript
// 获取某节点的animationSet
const animSet = model.animationSet;
```

### 创建与管理动画
```javascript
// 创建一个名为 "move" 的动画剪辑
const moveClip = animSet.createAnimation("move");

// 获取或删除动画
const clip = animSet.getAnimationClip("move");
animSet.deleteAnimation("move");
```

### 播放与停止动画

```javascript
// 播放动画，可配置循环、播放速度、淡入时间
animSet.playAnimation("move", {
  repeat: 0,     // 0 表示无限循环
  speedRatio: 1, // 播放速度
  fadeIn: 0.3    // 0.3 秒淡入
});

// 停止动画，可配置淡出时间
animSet.stopAnimation("move", { fadeOut: 0.2 });
```

### 主循环更新

动画的更新由引擎内部驱动，无需手工调用。

---

## AnimationClip — 动画片段

`AnimationClip` 代表一段完整的动画（例如“跑步”、“跳跃”）。

```javascript
const moveClip = animSet.createAnimation("move");

// 为模型节点添加动画轨道
moveClip.addTrack(model, myTranslationTrack);

// 设置循环总时长（秒）
moveClip.timeDuration = 2.0;


```

---

## AnimationTrack — 动画轨道基类

轨道类定义了动画过程中“怎么算”、“怎么用”和“怎么混合”的逻辑。

```typescript
abstract class AnimationTrack<StateType> {
  abstract calculateState(target: object, currentTime: number): StateType;
  abstract applyState(target: object, state: StateType): void;
  abstract mixState(a: StateType, b: StateType, t: number): StateType;
  abstract getBlendId(): unknown;
  abstract getDuration(): number;
  reset(target: object) {}
}
```

### 核心方法说明
| 方法 | 作用 |
|------|------|
| `calculateState(target, time)` | 根据当前时间计算状态（例如位置或旋转） |
| `applyState(target, state)` | 将状态应用到目标 |
| `mixState(a, b, t)` | 混合两个状态，用于动画混合 |
| `getBlendId()` | 返回轨道类型标识，同 ID 轨道可混合 |
| `getDuration()` | 返回轨道时长（秒） |
| `reset(target)` | 重置对象初始状态（可选） |

---

## 示例：创建关键帧动画

假设你要让模型沿 Y 轴上下移动。

```javascript
// 1. 创建Clip
const animSet = node.animationSet;
const clip = animSet.createAnimation("bob");

// 2. 自定义轨道
class MoveYTrack extends AnimationTrack<number> {
  calculateState(target, time) {
    // 简单的 sin 曲线位移
    return Math.sin(time * Math.PI * 2) * 2.0;
  }
  applyState(target, yPos) {
    target.position.y = yPos;
  }
  mixState(a, b, t) {
    return a * (1 - t) + b * t;
  }
  getBlendId() {
    return "positionY";
  }
  getDuration() {
    return 1.0;
  }
}

// 3. 新建轨道并添加到动画
const moveTrack = new MoveYTrack();
clip.addTrack(node, moveTrack);
clip.timeDuration = 2.0;

// 4. 播放动画
animSet.playAnimation("bob", { repeat: 0 }); // 无限循环


```

---

> 推荐使用zephyr3d编辑器来创建和编辑动画及轨道
