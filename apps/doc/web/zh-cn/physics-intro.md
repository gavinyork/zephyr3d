# 刚体物理

让物体在重力下下落、相互碰撞、堆叠和滚动。

物理是场景节点的属性：`node.physics` 以纯数据的形式保存节点的刚体、碰撞形状、关节等。要模拟这些数据，还需要两个包：模拟层 `@zephyr3d/physics`，以及物理引擎包 `@zephyr3d/physics-rapier`（用 [Rapier](https://rapier.rs) 求解）。不用物理的项目不加载它们；只有数据时没有任何开销：没有物理引擎时，场景照常保存和加载这些数据，原样不变。

物理和布料、头发是两回事：布料和头发有各自的 GPU 求解器；本章讲的是刚体——箱子、球、门、角色这类形状不变的物体。

<div class="showcase" case="tut-76"></div>

---

## 最小可跑例

物理引擎是一个 WebAssembly 模块，使用前要先加载。用物理引擎调用一次 `initPhysics()` 并等它完成；此后每个场景都会模拟其节点上的物理数据：

<<< @/../src/tut-76/main.js#init

**静态物体只需要碰撞体。** 一个节点的物理数据里只有 `Collider`、没有 `RigidBody` 时，它就是静态的：从不移动，其他物体落在它上面。地面、墙、关卡几何都这样做：

<<< @/../src/tut-76/main.js#ground

**会动的物体再加一个 `RigidBody`。** 刚体给节点质量，让模拟来移动它；与它放在一起的 `Collider` 给它形状：

<<< @/../src/tut-76/main.js#box

之后不用写任何代码：每帧场景的物理世界自动步进，并把刚体的位置和朝向写回节点。删除节点（`node.remove()`）就把它的物理数据移出模拟；设置 `node.physics = null` 则彻底去掉这些数据。

---

## 节点的物理数据

`node.physics` 是一个 `NodePhysics`，或 null。每类部件各有一个槽位：

| 槽位 | 内容 | 参见 |
| --- | --- | --- |
| `body` | 一个 `RigidBody` | 本页 |
| `character` | 一个 `CharacterController`；节点有刚体或角色二者之一，设置一个会清掉另一个 | [角色控制器](zh-cn/physics-character.md) |
| `colliders` | 碰撞形状（`addCollider` / `removeCollider`） | [碰撞体](zh-cn/physics-colliders.md) |
| `joint` | 连到另一个刚体或世界的 `Joint` | [关节](zh-cn/physics-joints.md) |
| `vehicle` | 驱动本节点刚体的 `Vehicle` | [载具](zh-cn/physics-vehicle.md) |
| `wheel` | 上方载具的一个 `Wheel` | [载具](zh-cn/physics-vehicle.md) |

部件可以像上面那样传给构造函数，也可以之后再赋值：

```js
node.physics = new NodePhysics();
node.physics.body = new RigidBody();
node.physics.addCollider(collider);
```

一个部件同一时间只属于一个节点。所有部件都随场景保存，并可在编辑器的属性面板里编辑。

---

## 三种运动类型

`RigidBody.motionType`：

| 类型 | 谁来移动它 | 典型用途 |
| --- | --- | --- |
| `dynamic`（默认） | 物理模拟：受重力、被推动、会弹开 | 箱子、球、碎块 |
| `kinematic` | 你：移动节点（动画、脚本），刚体跟随，并推开动态物体 | 电梯、移动平台、角色身上的手 |
| `static` | 不动 | 与"只有碰撞体"等价，显式写出来更清楚 |

运动学刚体在动画之后读取节点姿态，所以挂在骨骼上的碰撞体用的是本帧的动画姿态，不会落后一帧。

---

## 形状、缩放与质心

- **复合形状**：刚体的形状是它所在节点的碰撞体，加上子节点（且子节点没有自己的刚体）的碰撞体。用几个子节点拼出椅子、汽车这类不规则物体。
- **缩放**：碰撞体尺寸乘以节点的世界缩放。`box`、`mesh`、`convex` 按各轴精确缩放；`sphere` 取三轴最大值，`capsule` 和 `cylinder` 的半径取 X、Z 最大值。非均匀缩放的球不会变成椭球。
- **质心**：刚体绕节点原点转动，不是绕形状中心。偏心的物体想正确翻滚，就把节点原点放在物体中间，用碰撞体的 `offset` 调形状位置。
- **质量**：`RigidBody.mass`，单位千克，默认 1。只有比值重要：重物推得动轻物，反过来推不动。
- **单位**：1 个单位 = 1 米，重力默认 (0, -9.81, 0)。尺寸差很多（例如把 1 毫米的螺丝做成 1 个单位）会让模拟不稳定。

各形状的选择、网格与地形碰撞体见 [碰撞体](zh-cn/physics-colliders.md)。

---

## 初始速度

给刚体一个开场就有的速度，不用写脚本：

```js
body.initialLinearVelocity = new Vector3(0, 5, -3); // m/s，世界空间
body.initialAngularVelocity = new Vector3(0, 6.28, 0); // rad/s，每秒绕 Y 转一圈
```

只在节点进入正在模拟的场景、刚体第一次建立时生效；之后改刚体设置（会重建刚体）不再生效。脚本在刚体建立前调用的 `setLinearVelocity` 优先。只对 `dynamic` 刚体有效。

---

## 步进与场景设置

物理以固定步长推进，与帧率无关：

- 默认每秒 60 步（`fixedTimeStep` = 1/60），一帧最多 4 步（`maxSubSteps`）。帧率低于 15 时多出的时间丢弃，物体看起来变慢，而不是一下子追赶。
- 渲染帧率与步长不一致时，节点位置在最近两步之间插值（`interpolation`），避免抖动。
- 碰撞层与碰撞矩阵见 [碰撞体](zh-cn/physics-colliders.md#碰撞层)。

这些设置随场景保存在 `scene.physicsSettings`（`ScenePhysicsSettings`，来自 `@zephyr3d/scene`），为 `null` 时用默认值：

```js
const settings = new ScenePhysicsSettings();
settings.gravity = new Vector3(0, -1.62, 0); // 月球
settings.fixedTimeStep = 1 / 120;
scene.physicsSettings = settings;
```

改动在下一帧生效。也可以直接改场景的物理世界：`scene.physicsWorld.gravity = ...`；这不写回场景设置，场景设置之后再被改动时以场景设置为准。

---

## 限制与须知

- **在场景开始运行前调用 `initPhysics()`。** 没有它，含物理数据的场景也能加载，但在它完成前不会被模拟，`scene.physicsWorld` 为 null。
- **WebGL2 与 WebGPU 都支持**，物理在 CPU 上运行，与渲染后端无关。不支持多线程。
- **确定性**：模拟只由固定步长驱动。相同的输入（创建顺序、施力时机）在不同机器上得到相同结果。想要逐帧可复现，就在固定步里施力（见 [脚本控制](zh-cn/physics-scripting.md)），不要依赖 `onUpdate` 的帧间隔。
- **包体积**：Rapier 的 wasm 约 1.1 MB（gzip）。编辑器导出时只有项目用到物理才打包它。
- **其他物理引擎**：模拟层通过接口（`@zephyr3d/physics` 中的 `PhysicsBackend`）与引擎通信；可以另做一个引擎包接入其他物理引擎，场景和脚本都不用改。
- 骨骼链、布料、头发的模拟与刚体世界互不影响。

## 下一步

- [碰撞体](zh-cn/physics-colliders.md)：形状、网格与地形、材质、触发器、碰撞层
- [脚本控制](zh-cn/physics-scripting.md)：施力、碰撞事件、射线与形状查询
- [关节](zh-cn/physics-joints.md)：门、链条、绳子、弹簧
- [角色控制器](zh-cn/physics-character.md)
- [摄像机碰撞](zh-cn/physics-camera.md)：不穿墙的第三人称摄像机
- [载具](zh-cn/physics-vehicle.md)：带悬挂、转向和驱动方式的车辆
- 在编辑器中使用：[编辑器中的物理](zh-cn/editor/physics.md)
