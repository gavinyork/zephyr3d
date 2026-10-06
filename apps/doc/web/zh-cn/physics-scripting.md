# 脚本控制

> 本页代码为片段示意，省略了 import 与应用初始化。完整可运行示例见页内嵌入的实例。物理相关的类都来自 `@zephyr3d/physics`，`Vector3` 来自 `@zephyr3d/base`。

刚体放进场景后自己会动；要让游戏逻辑参与进来，就要施力、改速度、监听碰撞、查询"那里有什么"。本页讲这四件事，以及什么时候在哪一步做它们。

<div class="showcase" case="tut-78"></div>

---

## 施力与速度

`RigidBody` 上的方法，只对 `dynamic` 刚体有效：

| 方法 | 作用 | 适合 |
| --- | --- | --- |
| `applyForce(f)` / `applyTorque(t)` | 持续的力（N）/ 力矩（N·m） | 推进器、风、浮力 |
| `applyImpulse(j)` / `applyTorqueImpulse(j)` | 瞬间的冲量（N·s），速度改变 = 冲量 / 质量 | 爆炸、击打、跳跃 |
| `setLinearVelocity(v)` / `setAngularVelocity(w)` | 直接设定速度 | 发射子弹、重置状态 |

<<< @/../src/tut-78/main.js#shoot

- **力在一帧的所有物理步里生效，然后清零。** 在 `onUpdate` 里每帧调用 `applyForce`，效果是一个持续的力，与帧率无关。
- 冲量在下一步一次性生效。
- 刚体静止一段时间后会睡眠（`isSleeping`），不再计算。施力、冲量和设速度会唤醒它；需要时也可以 `wakeUp()`。不想让它睡眠就关掉 `canSleep`。
- 被锁定的轴（`lockTranslationX` 等）上的速度分量会被忽略。

---

## 固定步回调

模拟以固定步长推进，一帧可能走几步，也可能一步都不走。需要按物理步长做的逻辑放在固定步回调里：

<<< @/../src/tut-78/main.js#fixedupdate

- `PhysicsWorld.get(scene).on('fixedupdate', (dt) => ...)`：每个物理步之前调用，`dt` 是步长。
- 编辑器脚本里用 `RuntimeScript` 的 `onFixedUpdate(dt)` 钩子，效果相同。
- **在这里施加的力只作用于这一步**；在 `onUpdate` 里施加的力作用于整帧。
- 想让结果逐帧可复现（回放、联网），施力和移动角色都放在这里，而不是 `onUpdate`。

---

## 碰撞与触发事件

事件挂在**物理对象**上：有刚体的就挂在 `RigidBody` 上，没有刚体的静态碰撞体就挂在 `Collider` 自己身上。

<<< @/../src/tut-78/main.js#events

| 事件 | 时机 |
| --- | --- |
| `collisionenter` | 两个实体物体开始接触 |
| `collisionstay` | 持续接触时每帧一次 |
| `collisionexit` | 分开 |
| `triggerenter` / `triggerexit` | 进入或离开触发器，双方都会收到 |

- **每对物体一次**：一个由三个碰撞体组成的刚体撞到地面，只收到一次 `collisionenter`，不管有几个碰撞体同时接触。
- 事件在这一帧所有物理步之后派发，此时节点已经在新位置。在回调里改物理组件，下一帧生效。
- **睡眠不会触发 `collisionexit`**：静止堆叠的物体一直保持接触。
- `PhysicsContactEvent` 提供 `other`（另一个物理对象）、`otherNode`、`normal`（从自己指向对方）、`contacts`（接触点）和 `impulse`（这一步的接触冲量，N·s）。用 `impulse` 区分撞击（大）和静止接触（小），例如播放碰撞声音。
- 接触细节在回调里读取；回调返回之后不再可用。

---

## 查询

```js
const world = PhysicsWorld.get(scene);
```

<<< @/../src/tut-78/main.js#raycast

| 方法 | 返回 |
| --- | --- |
| `raycast(origin, dir, maxDistance?, options?)` | 最近的命中，或 null |
| `raycastAll(...)` | 沿射线的所有命中，按距离排序 |
| `shapeCast(shape, position, rotation, dir, maxDistance?, options?)` | 把一个形状扫过去，最先碰到的东西 |
| `overlap(shape, position, rotation, options?)` | 与形状重叠的碰撞体 |
| `overlapPoint(point, options?)` | 包含该点的碰撞体 |

- 命中结果（`PhysicsQueryHit`）有 `collider`、`body`、`node`、`point`、`normal`、`distance`。
- `options.layerMask`：只看某些层（第 i 位对应第 i 层）；`includeTriggers`：是否命中触发器，默认否；`exclude`：忽略某个物理对象，例如自己。
- `shapeCast` / `overlap` 的形状是 `{ type: 'box', size }`、`{ type: 'sphere', radius }`、`{ type: 'capsule', radius, height }` 或 `{ type: 'cylinder', radius, height }`。
- **查询看到的是上一次物理步之后的世界**：本帧刚加入的碰撞体、刚被脚本挪动的节点，要到下一步之后才查得到。查询从不改变模拟。
- 拾取（鼠标点选模型）仍用 `Scene.raycast` 或相机拾取；它们按渲染包围盒和像素工作，物理查询只看碰撞体。

---

## 驱动运动学刚体

`kinematic` 刚体跟随节点：动画或脚本移动节点，刚体在下一步移到那里，并推开挡路的动态物体。不要对运动学刚体施力或设速度，直接移动节点即可。

脚本里直接"瞬移"一个动态刚体（改节点位置）也可以，世界会把刚体放到新位置并保留它的速度。

## 自己驱动世界

世界默认在每帧动画之后自动步进。要手动控制（例如暂停、慢动作、在测试里逐步推进）：

```js
world.enabled = false;
world.update(1 / 60); // 推进 1/60 秒，内部仍按固定步长
```
