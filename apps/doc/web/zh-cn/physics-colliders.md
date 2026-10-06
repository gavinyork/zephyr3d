# 碰撞体

`Collider` 决定物体在碰撞中是什么形状，节点的碰撞体在 `node.physics.colliders` 里。形状越简单，模拟越快、越稳定，所以优先用能大致包住物体的基本形状，只在必要时用网格。

<div class="showcase" case="tut-77"></div>

---

## 选择形状

`Collider.shape`：

| 形状 | 尺寸属性 | 适合 |
| --- | --- | --- |
| `box` | `size` | 箱子、墙、地板 |
| `sphere` | `radius` | 球、近似圆的小物体 |
| `capsule` | `radius`、`height`（总高，含两端半球） | 人物、柱状物；滚动和滑动最平顺 |
| `cylinder` | `radius`、`height` | 桶、轮子、柱子 |
| `convex` | 节点网格 | 不规则的动态物体：石头、家具 |
| `mesh` | 节点网格 | 静态的复杂地形、建筑 |
| `terrain` | 地形高度图 | `ClipmapTerrain` 节点 |

- 形状以节点原点为中心，沿节点局部轴摆放；`offset` 在节点局部空间里平移它。
- 一个刚体可以由多个碰撞体组成，见 [刚体物理](zh-cn/physics-intro.md)。

---

## 网格与凸包

`mesh` 直接用节点网格的三角形：

<<< @/../src/tut-77/main.js#mesh

`convex` 用网格顶点的凸包（包住所有顶点的最小凸形状）：

<<< @/../src/tut-77/main.js#convex

两者的取舍：

- **`mesh` 没有体积**，只是一层三角形面。放在静态物体上没问题；放在动态刚体上，它会被推进别的东西里，控制台会给出警告。动态物体用 `convex`，凹形的动态物体用几个子节点上的 `convex` 拼起来。
- **`convex` 会填平凹处**：一只碗的凸包是实心的。
- `meshLod`：用网格的哪一级 LOD 作为碰撞几何，默认 0（原始网格），越界时取最粗的一级。远处不需要精确碰撞的大网格用粗一级能省不少内存和时间。
- 蒙皮网格和带变形目标的网格不能作为 `mesh`/`convex`，它们每帧形状都在变；在骨骼上挂基本形状代替。
- 用代码生成的几何可以用 `setMeshData(positions, indices)` 直接给出三角形，立即生效。

### 开场等待

网格的三角形要从 GPU 读回，需要几帧，具体多少取决于机器。为了不让物体在地面就绪前掉下去，世界默认**等开场时的所有网格、凸包、地形碰撞体都就绪后才开始模拟**（`waitForCollidersOnStart`，可在场景设置中关闭）；等待期间时间不流逝。之后再加入的这类碰撞体只会让它自己所属的刚体等待。

- `collider.ready` 为 true 表示已经进入模拟，变为 true 时触发 `ready` 事件。
- `await scene.physicsWorld.whenReady()` 等待所有正在读取的碰撞体。
- 建不出来时（例如凸包的点全在一个平面上）`collider.error` 给出原因，控制台也会报告。

---

## 地形

`terrain` 碰撞体挂在 `ClipmapTerrain` 节点上，用地形加载时的高度数据，不经过 GPU 读回：

```js
const collider = new Collider();
collider.shape = 'terrain';
collider.terrainResolution = 2; // 每 2 个高度图像素采样一次
terrain.physics = new NodePhysics({ colliders: [collider] });
```

- `terrainResolution` 越大，碰撞面越粗糙、内存越少；1 时与高度图逐像素一致。
- 地形碰撞体不能属于刚体，地形总是静态的。
- 地形的高度数据被更新（`setHeightData` 等）后，碰撞体会自动重建。

---

## 摩擦与弹性

- `friction`：0 像冰，1 以上很涩，默认 0.5。两个物体接触时取两者的平均值。
- `restitution`：0 完全不反弹（默认），1 几乎不损失能量。同样取两者的平均值。

---

## 触发器

`isTrigger` 为 true 的碰撞体只检测谁进入、谁离开，不阻挡任何东西。用来做检查点、拾取物、伤害区域：

<<< @/../src/tut-77/main.js#trigger

双方都会在各自节点的物理数据上收到 `triggerenter` / `triggerexit`。事件的细节见 [脚本控制](zh-cn/physics-scripting.md#碰撞与触发事件)。

---

## 碰撞层

16 个碰撞层（0–15），`collider.layer` 指定它属于哪一层，默认 0。层与层之间是否碰撞由一张对称的矩阵决定，默认全部碰撞。

<<< @/../src/tut-77/main.js#layers

- 矩阵和层名随场景保存在 `scene.physicsSettings` 里（`setLayerCollision`、`setLayerName`），编辑器里在场景的 Physics 设置中编辑。
- 查询（射线等）用 `layerMask` 只看某些层，见 [脚本控制](zh-cn/physics-scripting.md#查询)。
- 层名只用于显示，层号才是数据：同一个预制体放进两个场景，层号相同，显示的名字可能不同。

---

## 限制

- 运行时改节点的缩放、碰撞体的形状或尺寸会重建碰撞体，代价比移动大；不要每帧改。
- 非均匀缩放对 `sphere`、`capsule`、`cylinder` 只是近似（见上文缩放规则）。
- 凸分解（把凹形网格自动拆成多个凸包）和离线烘焙碰撞数据尚未支持。
