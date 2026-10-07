# 编辑器中的物理

在编辑器里给节点加刚体和碰撞体，按 Play 或 Preview 就能看到模拟。各部件的含义与参数见 [刚体物理](zh-cn/physics-intro.md) 一章，本页只讲编辑器里的操作。

**编辑器场景本身不模拟物理**：编辑时物体停在你摆放的位置，模拟只在 Play / Preview 打开的运行页里进行。所以摆放好的场景不会被模拟"弄乱"，也不需要保存或恢复。

---

## 添加物理

节点的物理就是属性面板里它的 **Physics** 属性，没有物理的节点此项为空。最快的填法是用预设，有两个入口：

- 场景层级里节点的右键菜单 → **Add Physics**；
- 属性面板底部的 **Add Physics** 按钮。

| 预设 | 添加内容 |
| --- | --- |
| Static Collider | 一个按节点（含子节点）包围盒初始化的盒子碰撞体 |
| Dynamic Body | 一个动态刚体；如果节点及其子节点上还没有碰撞体，再补一个包住它的盒子碰撞体 |
| Kinematic Body | 同上，运动学刚体 |
| Trigger Zone | 一个包住节点的触发器盒子 |
| Character | 角色控制器（`physics.character`） |
| Vehicle Chassis | 一个 1000 kg 的动态刚体（已有则保留）、需要时补碰撞体，再加一个载具 |
| Wheel | 一个轮子，半径按节点包围盒初始化 |
| Hinge Joint | 一个铰链关节 |

预设在节点已有的数据上追加，只替换它设置的那一项；自动初始化的盒子大多数情况下不用再调。右键菜单的 **Remove Physics** 清除节点的全部物理数据。两者都可以撤销；多选时每个选中的节点各得到一份自己的数据。

预设设置的一切都可以在属性面板的 **Physics** 下修改：**Body**（刚体或角色控制器）、**Colliders**（增删形状）、**Joint**、**Vehicle**、**Wheel**；空的槽位也可以在这里直接填。鼠标悬停在属性名上有说明。只对某些设置有意义的属性会自动隐藏，例如只有动态刚体才显示质量和初始速度。

一个静态地面加一个会落下的球：

1. 地面：加一个 Box 网格，**Add Physics → Static Collider**；
2. 球：加一个 Sphere 网格，**Add Physics → Dynamic Body**，然后把自动补上的碰撞体的 Shape 改为 Sphere，Radius 设为球的半径（内置球体是 1）；
3. 想让球一开始就飞出去，设置刚体的 **InitialLinearVelocity**；
4. 点 Preview。

---

## 碰撞体线框

选中节点时，它和它子节点上的碰撞体以线框显示。线框就是模拟实际使用的形状：缩放已经算进去，凸包是物理引擎实际算出的结果，网格用的是所选的 LOD 级别，地形按采样间隔画出（每条线都在碰撞面上）。被模型挡住的部分以半透明显示。

| 颜色 | 含义 |
| --- | --- |
| 绿 | 静态 |
| 橙 | 动态 |
| 蓝 | 运动学 |
| 黄 | 触发器 |
| 青 | 角色控制器的胶囊 |
| 品红 | 关节：支点十字、铰链/滑轨的轴、到另一端的连线 |
| 白 | 轮子：静止位置的轮圈、到挂点的悬挂线、行程刻度 |

- **View → Show All Colliders** 显示整个场景的碰撞体，选中节点的仍然加亮。
- 网格、凸包、地形碰撞体的形状要从 GPU 读回，选中后过几帧才出现。
- 碰撞体建不出来（例如凸包的点都在一个平面上）时没有线框，属性面板里会出现 **ColliderError** 说明原因。

---

## 场景的物理设置

选中场景根节点，在属性面板里找到 **Physics**，点击创建。它随场景保存，没有创建时使用默认值。

- **Gravity**：重力；
- **StepRate**：每秒模拟步数，越高越稳但越耗时；
- **MaxSubSteps**：一帧最多几步，游戏卡顿时多出的时间丢弃，物体看起来变慢；
- **Interpolation**：在步与步之间插值，帧率与步频不一致时消除抖动；
- **WaitForCollidersOnStart**：开场等网格和地形碰撞体就绪再开始，防止物体掉出地面；
- **Edit Collision Layers...**：打开碰撞层对话框，给 16 个层命名，并在下三角矩阵里勾选哪些层之间碰撞。

碰撞体和角色控制器的 **Layer** 属性填层号（0–15）。

---

## 在脚本里使用物理

脚本通过 `node.physics` 访问物理数据，通过 `scene.physicsWorld` 访问场景的物理世界；相关的类来自 `@zephyr3d/scene`，有类型提示。`RuntimeScript` 的 `onFixedUpdate(dt)` 钩子在每个物理步之前调用。例子：

```ts
import type { SceneNode } from '@zephyr3d/scene';
import type { RigidBody } from '@zephyr3d/scene';
import { RuntimeScript } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

export default class extends RuntimeScript<SceneNode> {
  private body: RigidBody | null = null;
  onAttached(host: SceneNode) {
    this.body = host.physics?.body ?? null;
    host.physics?.on('collisionenter', (ev) => console.log(`hit ${ev.otherNode?.name}`));
  }
  onFixedUpdate() {
    // 一个向上的持续推力
    this.body?.applyForce(new Vector3(0, 12, 0));
  }
}
```

更多见 [脚本控制](zh-cn/physics-scripting.md)。

---

## 预览与导出

- Play 和 Preview 都会加载物理引擎并模拟。
- 导出时，编辑器检查场景、预制体和脚本：只要有节点带物理数据，或脚本引用了 `@zephyr3d/physics` 或 `@zephyr3d/physics-rapier`，就打包物理模块和 Rapier 的 wasm（约 1.1 MB gzip），并在启动时加载；否则完全不打包。
