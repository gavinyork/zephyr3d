# 角色控制器

玩家角色很少用动态刚体来做：它会被推倒、在斜坡上打滑、撞墙时弹开，手感难以控制。`CharacterController` 换一种思路：**你告诉它想往哪里走，它算出实际能走多远**——沿墙滑过去、走上台阶和缓坡、下坡时贴着地面——并直接移动节点。

<div class="showcase" case="tut-80"></div>

---

## 最小可跑例

角色控制器作为节点的身体（`node.physics.body`），自带一个胶囊碰撞体，不需要再加 `RigidBody` 和 `Collider`。胶囊底部对齐节点原点，所以角色模型的原点放在脚底就能直接用：

<<< @/../src/tut-80/main.js#controller

每个物理步调用一次 `move`：

<<< @/../src/tut-80/main.js#move

`move(displacement)` 接收这一步想移动的世界空间位移，立即算出修正后的结果并移动节点，返回：

- `movement`：实际移动的距离；
- `grounded` / `groundNormal`：是否站在东西上，以及地面的朝向；
- `collisions`：这次移动碰到的东西（`collider`、`node`、`point`、`normal`）。

最近一次的结果也可以随时从 `controller.isGrounded`、`controller.groundNormal` 读取。

---

## 重力和跳跃由你处理

控制器不内置重力（与 Unity 的 `CharacterController.Move` 相同）。跳跃、二段跳、空中控制都是游戏逻辑，标准写法是自己维护竖直速度：

```js
if (controller.isGrounded) {
  vy = jumpPressed ? jumpSpeed : -1;
} else {
  vy -= 9.81 * dt;
}
controller.move(new Vector3(vx * dt, vy * dt, vz * dt));
```

**着地时保持一个小的向下速度（上例的 -1）**，不要设为 0：控制器只在有向下的输入时才贴地、才在太陡的坡上滑下来。

---

## 调参

| 属性 | 默认 | 作用 |
| --- | --- | --- |
| `height`、`radius` | 1.8、0.3 | 胶囊总高与半径 |
| `skinWidth` | 0.02 | 角色与障碍物之间保留的间隙。太小会卡在墙角，太大会看起来悬空 |
| `slopeLimit` | 45° | 能走上去的最陡坡度 |
| `slideSlope` | 30° | 超过这个坡度就站不住、会滑下来 |
| `stepHeight`、`stepMinWidth` | 0.3、0.2 | 自动上台阶的最大高度与台阶面最小宽度；`stepHeight` 设 0 关闭 |
| `snapToGround` | 0.2 | 下坡、下台阶时贴地的最大落差，0 关闭 |
| `pushBodies` | true | 走路时推开动态物体 |
| `characterMass` | 70 | 推物体时按这个质量计算 |
| `layer` | 0 | 碰撞层 |

示例里的台阶高 0.25 米，能直接走上去；0.5 米的平台超过 `stepHeight`，要跳上去；55° 的红色斜坡超过 `slopeLimit`，走不上去，站上去会滑下来。

---

## 须知

- **在固定步里移动**（`world.on('fixedupdate')` 或脚本的 `onFixedUpdate`），走路速度才与帧率无关、结果可复现。在 `onUpdate` 里按帧间隔移动也能用，但结果会随帧率略有不同。
- `move` 看到的世界是上一次物理步之后的（与查询相同）；同一步内多次调用都基于最新的位置。
- 角色进入触发区时，它节点的 `node.physics` 会收到 `triggerenter`。角色撞到静态物体不产生 `collisionenter`（运动学物体与静态物体之间没有接触事件），撞到了什么从 `move` 的结果里取。
- 胶囊跟随节点的朝向：转向时只绕竖直轴旋转节点，让节点倾斜会让胶囊也倾斜。
- 不要直接设置节点位置来移动角色，除非是传送（瞬移到新地点）。
