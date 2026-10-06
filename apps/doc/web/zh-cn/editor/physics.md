# 编辑器中的物理

在编辑器里给节点加刚体和碰撞体，按 Play 或 Preview 就能看到模拟。物理组件的含义与参数见 [刚体物理](zh-cn/physics-intro.md) 一章，本页只讲编辑器里的操作。

**编辑器场景本身不模拟物理**：编辑时物体停在你摆放的位置，模拟只在 Play / Preview 打开的运行页里进行。所以摆放好的场景不会被模拟"弄乱"，也不需要保存或恢复。

---

## 添加物理组件

两个入口，菜单相同：

- 场景层级里节点的右键菜单 → **Add Component → Physics**；
- 属性面板底部的 **Add Component** 按钮。

可选 Rigid Body、Collider、Joint、Character Controller。删除用右键菜单的 **Remove Component**。添加和删除都可以撤销。

便利规则：

- **加 Collider 时**，盒子的尺寸和偏移按节点（含子节点）的包围盒初始化，大多数情况下不用再调。
- **加 Rigid Body 时**，如果节点及其子节点上还没有碰撞体，会自动补一个包住它的盒子碰撞体，否则刚体没有形状、会穿过一切。
- 多选时每个选中的节点各加一个组件。

组件的属性在属性面板里编辑，鼠标悬停在属性名上有说明。只对某些设置有意义的属性会自动隐藏，例如只有动态刚体才显示质量和初始速度。

一个静态地面加一个会落下的球：

1. 地面：加一个 Box 网格，**Add Component → Physics → Collider**（没有刚体即静态）；
2. 球：加一个 Sphere 网格，**Add Component → Physics → Rigid Body**，然后把自动补上的 Collider 的 Shape 改为 Sphere，Radius 设为球的半径（内置球体是 1）；
3. 想让球一开始就飞出去，设置 Rigid Body 的 **InitialLinearVelocity**；
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

编辑器脚本可以直接 `import { RigidBody, PhysicsWorld } from '@zephyr3d/physics'`，有类型提示。`RuntimeScript` 的 `onFixedUpdate(dt)` 钩子在每个物理步之前调用。例子：

```ts
import type { SceneNode } from '@zephyr3d/scene';
import { RuntimeScript } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';
import { RigidBody } from '@zephyr3d/physics';

export default class extends RuntimeScript<SceneNode> {
  private body: RigidBody | null = null;
  onAttached(host: SceneNode) {
    this.body = host.getComponent(RigidBody);
    this.body?.on('collisionenter', (ev) => console.log(`hit ${ev.otherNode?.name}`));
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
- 导出时，编辑器检查场景、预制体和脚本：只要有物理组件或脚本引用了 `@zephyr3d/physics`，就打包物理模块和 Rapier 的 wasm（约 1.1 MB gzip），并在启动时加载；否则完全不打包。
