
# 关键帧动画（Keyframe Animation）

在 Zephyr3D 中，**关键帧动画**通过一系列轨道（`AnimationTrack`）来控制对象的属性变化。  
每个动画片段（`AnimationClip`）由若干轨道组成，每个轨道控制一个节点对象的某一属性（如平移、旋转、缩放等）。  
系统内置了多种常用轨道类型，你也可以创建自定义轨道以控制任意属性。

---

## AnimationClip 与 AnimationTrack 的关系

- 一个 **`AnimationClip`** 表示一个完整的动画片段（如 “移动”、“旋转” 等）；  
- 每个 **`AnimationTrack`** 负责控制一个目标节点的一种属性变化；  
- 不同轨道可共同作用于同一对象，实现复杂动画。

---

## 系统内置轨道类型

| 轨道类名 | 控制属性 | 插值类型 | 说明 |
|-----------|------------|-----------|------|
| `NodeTranslationTrack` | 平移 (`Vector3`) | 线性 / 阶跃 / 三次样条 | 控制节点的位置变化 |
| `NodeEulerRotationTrack` | 欧拉角旋转 (`Vector3`) | 线性 / 阶跃 / 三次样条 | 控制节点的旋转（以欧拉角存储） |
| `NodeScaleTrack` | 缩放 (`Vector3`) | 线性 / 阶跃 / 三次样条 | 控制节点的缩放比例 |
| `PropertyTrack` | 任意属性 | 取决于属性类型 | 可自定义关键帧控制任意对象属性 |

---

## 示例：创建关键帧动画

以下示例展示了如何创建一个简单的动画，  
让一个盒子在 Y 轴方向上上下移动，并同时沿 Y 轴旋转。

```javascript
// 创建节点
const box = new Mesh(scene, new BoxShape(), new LambertMaterial());

// 创建 AnimationClip 并指定动画名称
const clip = box.animationSet.createAnimation('move');

// 添加一个内置的平移动画轨道（NodeTranslationTrack）
// 参数解释：
//   第一个参数 'linear' 表示关键帧之间通过线性插值
//   第二个参数为关键帧数组，每个关键帧由 time 和 value 两个字段组成
clip.addTrack(
  box,
  new NodeTranslationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 1, value: new Vector3(0, 3, 0) },
    { time: 2, value: new Vector3(0, 0, 0) }
  ])
);

// 添加一个欧拉旋转轨道（NodeEulerRotationTrack）
// 让节点在 2 秒内绕 Y 轴旋转 4 圈
clip.addTrack(
  box,
  new NodeEulerRotationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 2, value: new Vector3(0, 8 * Math.PI, 0) }
  ])
);

// 播放动画（循环播放）
box.animationSet.playAnimation('move', { repeat: 0 });

// 停止动画
box.animationSet.stopAnimation('move');
```

<div class="showcase" case="tut-25"></div>

---

## 插值类型（Interpolation Modes）

在创建轨道实例时，第一个参数定义关键帧间的插值方式：

| 插值模式 | 说明 |
|-----------|------|
| `'linear'` | 线性插值（默认），平滑过渡最常用 |
| `'step'` | 阶跃变化（无过渡），每帧直接跳变到下个数值 |
| `'cubicspline'` | 三次样条插值，适用于高精度连续动画 |

> 可根据动画需求选择不同插值方式，  
> 如动作序列或机械式动画可用 `step`，自然运动倾向选择 `linear` 或 `cubicspline`。

---

## 注意事项

- 每个轨道的时间值单位均为**秒（seconds）**。  
- 动画播放通过节点自带的 `animationSet` 控制。  
- 可以在同一个节点上叠加多个轨道以实现复合动画（例如同时平移与旋转）。  
- 若要实现多个动画间的平滑切换，可利用 `playAnimation()` 的 `fadeIn` 与 `stopAnimation()` 的 `fadeOut` 参数。

---

## 小结

- **AnimationClip**：一个完整动画序列；  
- **AnimationTrack**：定义具体动画轨迹与关键帧数据；  
- **关键帧数据**：记录属性随时间变化的值；  
- **内置轨道类**：可直接创建平移、旋转、缩放动画；  
- **自定义轨道**：可扩展至任意属性动画。

---

> **提示：**
> 推荐使用 **Zephyr3D 编辑器** 进行关键帧动画的创建与编辑，  
> 可通过可视化界面快速调整关键帧时间轴与插值方式，大幅提高工作效率。
