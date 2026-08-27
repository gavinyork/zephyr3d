
# 自定义动画（Custom Animation）

除了系统提供的预定义轨道（如平移、旋转、缩放等）外，  
Zephyr3D 还允许开发者**通过继承 `AnimationTrack` 类创建自定义轨道**，  
从而实现任意效果的自定义动画（如 UV 滚动、材质变化、颜色淡入淡出等）。

---

## 自定义轨道的核心原理

自定义轨道（`Custom AnimationTrack`）是通过继承基类 `AnimationTrack` 实现的。  
你需要重写以下四个关键方法，以定义轨道如何计算状态、混合状态并应用到目标上。

| 方法 | 说明 |
|------|------|
| **`calculateState(target, currentTime)`** | 计算指定时刻的轨道状态（如位置、旋转、数值等），返回一个状态对象，可为 `Vector3`、`Quaternion`、`Number` 或任何类型。 |
| **`mixState(stateA, stateB, t)`** | 在两个状态间插值，用于动作融合。必须返回新状态对象。 |
| **`applyState(target, state)`** | 将当前轨道状态应用到目标对象上。目标对象通常为 `SceneNode`。 |
| **`getBlendId()`** | 返回轨道的唯一标识。具有相同 `blendId` 的轨道被认为可相互混合，但不能同时存在于一个动画片段中。 |

> 💡 **注意：**  
> 同一 `AnimationClip` 中，不允许添加两个具有相同 `blendId` 的轨道，
> 否则系统会认为它们控制的是同一属性。

---

## 示例：创建自定义 UV 动画轨道

下面示例演示如何编写一个自定义动画轨道，使模型材质的贴图产生循环滚动的 UV 动画效果。

```javascript
// 自定义动画轨道：实现UV动画
class MyAnimationTrack extends AnimationTrack {
  _state; // 当前轨道状态（Float32Array）
  _interpolator; // 插值器，用于计算关键帧间的状态

  // 构造函数：接收一个关键帧插值器
  constructor(interpolator) {
    super();
    this._interpolator = interpolator;
    this._state = new Float32Array(1);
  }

  // 克隆该轨道（抽象方法，必须实现）
  clone() {
    return new MyAnimationTrack(this._interpolator);
  }

  // 计算并返回给定时刻的轨道状态
  calculateState(target, currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }

  // 混合两个动画状态（用于融合）
  mixState(a, b, t) {
    const result = new Float32Array(1);
    result[0] = a[0] + (b[0] - a[0]) * t;
    return result;
  }

  // 将状态应用至节点
  applyState(target, state) {
    // 遍历节点下的所有Mesh
    target.iterate((child) => {
      if (child.isMesh()) {
        // 应用UV动画（平移UV坐标）
        child.material.albedoTexCoordMatrix = Matrix4x4.translation(
          new Vector3(state[0], 0, 0)
        );
      }
    });
  }

  // Blend ID用于区分轨道类型
  getBlendId() {
    return 'uv-animation';
  }

  // 轨道时长（秒），抽象方法，必须实现
  getDuration() {
    return this._interpolator.maxTime;
  }
}
```

> `AnimationTrack` 共有六个抽象成员必须实现：`clone()`、`calculateState()`、`applyState()`、
> `mixState()`、`getBlendId()` 和 `getDuration()`。遗漏任意一个在 TypeScript 下都无法通过编译。

---

## 应用自定义轨道

完整应用流程包括以下几步：

1. **加载模型**
2. **创建动画片段**
3. **构建插值器（Interpolator）**
4. **创建并添加自定义轨道**
5. **播放动画**

```javascript
// 步骤 1：加载模型
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/BoxTextured.zprefab'
);

// 步骤 2：创建一个动画片段
const animation = model.animationSet.createAnimation('UserTrackTest');

// 步骤 3：创建一个关键帧插值器
const interpolator = new Interpolator(
  'linear',                  // 插值模式（'linear' / 'step' / 'cubicspline'）
  null,                      // 自动计算关键帧维度
  new Float32Array([0, 2]),  // 时间关键帧：0s → 2s
  new Float32Array([0, 1])   // 值关键帧：UV 从 0 滚动到 1
);

// 步骤 4：创建并添加自定义轨道
const track = new MyAnimationTrack(interpolator);
animation.addTrack(model, track);

// 步骤 5：播放动画
model.animationSet.playAnimation('UserTrackTest', {
  repeat: 0,     // 循环次数（0 表示无限循环）
  speedRatio: 1, // 播放速度
  weight: 1,     // 融合权值（多个动画叠加时使用）
  fadeIn: 0,     // 淡入时间
});
```

<div class="showcase" case="tut-26"></div>

---

## 方法实现说明

### `calculateState()`
用于根据当前播放时间计算轨道状态，如位置或数值变化。  
系统每帧调用此方法，然后通过 `applyState()` 将结果应用到目标节点。

### `mixState()`
当两个具有相同 `blendId` 的动画同时播放时调用此方法，  
返回两个状态按比例 `t` 混合后的新状态，用于动画融合。

### `applyState()`
实际将计算得到的轨道状态作用于节点，例如：
- 修改位移、旋转、缩放；
- 调整材质或颜色属性；
- 更新自定义属性（如灯光强度或贴图偏移）。

### `getBlendId()`
用于定义轨道类型唯一性。  
系统通过 `blendId` 判定轨道能否融合或是否冲突。

---

## 实用技巧

| 使用场景 | 建议实现方式 |
|-----------|--------------|
| 自定义材质动画（UV滚动、闪烁） | 通过材质属性实现（如 `UV` 或 `emission`） |
| 摄像机特效（焦距、景深变化） | 轨道直接修改摄像机参数 |
| 灯光动画（明暗变化） | 轨道修改光照强度或颜色 |
| 环境变化（雾效、曝光） | 控制全局渲染参数实现 |

---

## 小结

- 通过继承 **`AnimationTrack`** 可实现各种自定义动画；
- 必须实现 `calculateState()`、`mixState()`、`applyState()`、`getBlendId()` 四个核心方法；
- 可结合 **Interpolator** 实现精准的关键帧控制；
- 自定义轨道的强大之处在于——**几乎可以对引擎中任何可动画参数进行控制**。

---

> **建议：**
> - 保持各轨道的 `blendId` 唯一以避免冲突；
> - 自定义动画适合用于高级材质、环境或特效系统；
> - **Zephyr3D 编辑器** 支持为大部分节点对象属性创建关键帧动画；
