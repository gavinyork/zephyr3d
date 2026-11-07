# 脚本结构与生命周期

编辑器内置对 **TypeScript 脚本** 的支持。  
你可以在资产面板中创建、编辑并运行脚本，用于实现项目的启动流程、场景逻辑、节点交互、动画以及各种辅助功能。

> 本页代码为片段示意，省略了部分 import。

总体上，脚本按用途分为两类：

- **绑定脚本**：挂载到场景或场景节点上的脚本，拥有完整生命周期回调
- **辅助脚本**：提供工具函数、数据结构、业务逻辑等，被其他脚本导入使用

---

## 脚本基础特性

在本引擎中，脚本具有以下通用特性：

### 1. TypeScript 资产脚本

编辑器支持在 **资产（Assets）** 面板中直接创建 `.ts` 脚本文件，你可以：

- 新建 TypeScript 文件
- 在内置编辑器中编写和修改脚本
- 将脚本作为资源与项目一起保存和打包

脚本文件的路径和命名会作为后续导入、绑定时的依据。

### 2. 所有脚本必须为 ES 模块

所有脚本都 **必须** 使用 ES Module 规范：

- 使用 `import` / `export` 组织代码
- 不依赖传统的全局变量或脚本加载顺序
- 可以将功能拆分至多个模块中进行复用

示例：

```ts  
// assets/scripts/math-utils.ts  
export function clamp(x: number, min: number, max: number): number {  
  return Math.max(min, Math.min(max, x));  
}  
```

### 3. 所有脚本都可以导入 zephyr3d 库

无论是启动脚本、绑定脚本还是辅助脚本，都可以直接从 `zephyr3d` 库中导入引擎 API，用于操作场景、节点、材质、摄像机等。

```ts
import { SceneNode, /* ... 其他你需要的类型或类*/ } from "@zephyr3d/scene";
```

### 4. 支持引入第三方`npm`包

编辑器支持将`npm`包引入到项目(借助`https://esm.sh`)。
一旦引入了`npm`包，即可在脚本中导入。

---

## 脚本分类与使用场景

### 1. 绑定脚本（Attached Scripts）

绑定脚本是挂载到 `场景（Scene）` 或 `场景中的节点对象（Node）` 上的脚本，用来描述这些对象在运行时的行为逻辑。

你可以使用绑定脚本实现：

- 摄像机控制（旋转、缩放、跟随目标等）
- 角色/物体的运动、动画和状态机
- 输入响应（键盘、鼠标、触摸、手柄）
- 触发器、交互逻辑（按钮、开关、UI 交互等）

#### 1.1 基本要求

一个绑定脚本需要：

- 是一个 ES 模块（使用 import / export）
- 默认导出一个类
- 该类实现引擎约定的生命周期方法（名称固定）

**典型结构**：

```ts
// assets/scripts/rotate.ts
import type { SceneNode } from "@zephyr3d/scene";
import { RuntimeScript } from "@zephyr3d/scene";

export default class RotateScript extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  // 用字段初始化器设置初始值，不需要写构造函数
  private speed = 2;
  private rotationY = 0;

  async onCreated(): Promise<void> {
    // 初始化逻辑：可异步，例如加载配置、资源
  }

  onAttached(target: SceneNode): void {
    // 绑定到具体对象
    this.target = target;
  }

  onUpdate(dt: number): void {
    // 每帧更新旋转
    this.rotationY += this.speed * dt;
    this.target?.rotation.fromEulerAngle(0, this.rotationY, 0);
  }

  onDetached(): void {
    // 从对象上解绑时调用
    this.target = undefined;
  }

  onDestroy(): void {
    // 实例销毁前调用：释放资源、取消订阅等
  }
}
```

> **注意**
>
> 宿主被销毁时，引擎会先调用脚本的 `onDetached()`，再销毁脚本，因此像上面这样用普通字段保存宿主是安全的，只要在 `onDetached()` 里把字段清空即可。不要用 `DRef` 持有宿主：`DRef` 会让宿主的引用计数加一，宿主因此无法被自动销毁。
>
> 如果要自己写构造函数，第一行必须调用 `super()`，否则实例化时会抛出 `ReferenceError`。

#### 1.2 绑定方式

在编辑器中使用绑定脚本的一般流程：

1. 在资产面板的 `/assets` 目录下右键 `Create New > Typescript`，新建脚本文件（例如 rotate.ts），见[创建脚本](zh-cn/editor/create-script.md)
2. 在脚本中实现一个继承 `RuntimeScript` 的类并**默认导出**
3. 在编辑器中：
    - 选中场景（Scene）或某个节点（Node）
    - 把脚本文件从资产面板拖到 Inspector 底部 **Scripts** 区域的 "Drop a script here to attach" 处
    - 一个对象可以挂多个脚本；列表中的按钮可以调整顺序或移除脚本
    - 选中列表中的脚本后，下方的 **Config** 区域可以编辑它用 `@scriptProp` 声明的参数（见下文）
4. 运行场景后，引擎会自动：
    - 为每个挂载创建一个脚本实例
    - 把 Config 中的参数值赋给实例
    - 调用生命周期回调（onCreated → onAttached → onUpdate …）

#### 1.3 可配置参数

用 `@scriptProp` 装饰器声明的字段会出现在 Config 区域，可以在编辑器里按对象分别设置，并随场景保存。参数值在 `onCreated()` 之前赋给实例。

```ts
import { RuntimeScript, scriptProp } from '@zephyr3d/scene';
import type { SceneNode } from '@zephyr3d/scene';

export default class extends RuntimeScript<SceneNode> {
  @scriptProp({ type: 'float', label: 'Speed', default: 1, minValue: 0 })
  speed = 1;

  @scriptProp({ type: 'asset', label: 'Texture', mimeTypes: ['image/png', 'image/jpeg'] })
  texture = '';

  @scriptProp({ type: 'node', label: 'Target Node', sceneNode: { kind: 'node' } })
  targetNode = '';
}
```

支持的类型包括 `bool`、`int`、`float`、`vec2`/`vec3`/`vec4`、`rgb`/`rgba`、`string`、`asset`、`node` 和 `object_array`，还可以设置 `label`、`group`、取值范围和枚举。新建脚本时生成的模板里就带有这些示例。

#### 1.4 一个脚本类可以绑定到多个对象

同一个脚本类可以挂到多个对象上，复用相同的行为逻辑。默认情况下，**每次挂载都会创建一个新的脚本实例**，每个实例只服务一个对象，所以脚本里保存单个宿主即可（如上面的示例）。

需要一个实例统一管理多个对象时（例如批量更新成群的敌人），可以把脚本写成单例：构造函数返回同一个共享实例。这时 `onCreated()` 只调用一次，`onAttached()` 和 `onDetached()` 会随每个对象各调用一次：

```ts
let shared: SwarmScript | null = null;

export default class SwarmScript extends RuntimeScript<SceneNode> {
  private targets = new Set<SceneNode>();
  private rotationY = 0;

  constructor() {
    super();
    // 已有共享实例时直接返回它，所有挂载都使用同一个实例
    if (shared) {
      return shared;
    }
    shared = this;
  }

  onAttached(target: SceneNode) {
    this.targets.add(target);
  }

  onUpdate(dt: number) {
    this.rotationY += 2 * dt;
    for (const target of this.targets) {
      target.rotation.fromEulerAngle(0, this.rotationY, 0);
    }
  }

  onDetached(target: SceneNode) {
    this.targets.delete(target);
  }

  onDestroy() {
    shared = null;
  }
}
```

#### 1.5 启动脚本

绑定脚本可以设置为项目的`启动脚本`，这个脚本会在引擎初始化完毕且在启动场景加载前被绑定到`null`对象。

只设置了启动脚本、没有设置启动场景时，需要在脚本里自己加载并显示场景：

```ts
import { getEngine, RuntimeScript } from "@zephyr3d/scene";

export default class extends RuntimeScript<null> {
  async onAttached() {
    const scene = await getEngine().loadSceneFromFile("/assets/main.zscn");
    if (scene) {
      getEngine().setRenderable(scene, 0);
    }
  }
}
```

### 2. 辅助脚本（Helper Scripts）

辅助脚本不直接参与启动或绑定，而是提供复用的工具逻辑，被其他脚本导入。适合放置：

- 工具函数、数学/几何运算
- 通用业务逻辑（AI、路径规划、状态机等）
- 配置与常量
- 网络请求封装、数据转换等

**特点**：

- 不需要实现任何生命周期接口
- 不直接挂载到场景或节点上
- 仅通过 import 被其他脚本使用

**示例**：

```ts
// assets/scripts/utils/math-utils.ts
import { Vector3 } from "@zephyr3d/base";

export function moveTowards(
  current: Vector3,
  target: Vector3,
  maxDistanceDelta: number
): Vector3 {
  const toVector = Vector3.sub(target, current);
  const distance = toVector.magnitude;
  if (distance <= maxDistanceDelta) {
    return target.clone();
  }
  return Vector3.add(current, Vector3.scale(toVector, maxDistanceDelta / distance));
}
```

被其他脚本使用：

```ts
// assets/scripts/follow-target.ts
import { DWeakRef } from "@zephyr3d/base";
import { RuntimeScript } from "@zephyr3d/scene";
import type { SceneNode } from "@zephyr3d/scene";
import { moveTowards } from "./utils/math-utils";

export default class FollowTargetScript extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  private follow?: DWeakRef<SceneNode>;
  private speed = 5.0;

  onAttached(node: SceneNode) {
    this.target = node;
    this.follow = new DWeakRef();
  }

  setFollowNode(node: SceneNode) {
    this.follow.set(node);
  }

  onUpdate(dt: number) {
    // 跟随的是另一个节点，用 DWeakRef 持有：它被销毁后 get() 返回 null，也不会阻止它被销毁
    if (!this.target || !this.follow?.get()) {
      return;
    }
    this.target.position = moveTowards(this.target.position, this.follow.get().position, this.speed * dt);
  }
}
```

---

## 绑定脚本的生命周期

绑定脚本有一套清晰的生命周期回调，使你可以在不同阶段执行不同逻辑。一个绑定脚本实例的典型生命周期如下：

- `构造函数`：实例创建时调用
- `onCreated()`：初始化方法，支持异步
- `onAttached(host)`：脚本附加到对象后调用
- `onUpdate(dt, elapsed)`：每帧调用
- `onFixedUpdate(fixedDt)`：每个物理固定步之前调用，只在场景有物理世界时调用；施力等需要按物理步长执行的逻辑放在这里（见[脚本控制物理](zh-cn/physics-scripting.md)）
- `onLateUpdate(dt)`：每帧在场景节点更新、物理步进并写回位置之后调用，适合读取本帧的物理结果，例如让相机跟随运动的物体
- `onDetached(host)`：脚本从对象上解除附加时调用
- `onDestroy()`：实例销毁前调用

这些方法都是可选的，根据需要实现其中若干个即可；构造函数也可以不写。

### 1. 构造函数

  - 调用时机：关联对象被创建时，引擎加载此脚本并调用构造函数创建脚本实例。此时脚本还未关联。
  - 参数：必须实现为无参数构造，且第一行调用 `super()`。多数情况下用字段初始化器即可，不需要写构造函数。

**适合做的事情**：

  - 初始化成员字段（默认数值、缓存对象等）

**不适合做的事情**：

  - 访问场景或节点（尚未 onAttached）
  - 发起复杂的异步流程（推荐在 onCreated() 中进行）

**示例**：

```ts
export default class ExampleScript extends RuntimeScript<SceneNode> {
  private speed: number;
  constructor() {
    super();
    this.speed = 1.0;
  }
}
```

### 2. onCreated()

  - 调用时机：实例创建后调用，支持 async。这是推荐进行初始化（尤其是异步初始化）的主要入口。

**适合做的事情**：

  - 异步加载资源（纹理、模型、配置文件等）
  - 初始化与具体对象无关的全局或共享状态
  - 注册全局事件/消息总线等

**示例**：

```ts
async onCreated(): Promise<void> {
  const res = await fetch("https://example.com/config.json");
  this.config = await res.json();
}
```

若无需异步，你也可以将 onCreated 写成普通同步函数。

### 3. onAttached()

  - 调用时机：脚本被附加到具体对象（Scene 或 Node）后调用。

**适合做的事情**：

  - 保存对象（目标场景或节点）的引用
  - 初始化依赖于对象本身的状态（初始位置、缩放、组件查找等）
  - 注册对象级别事件（例如碰撞、点击回调）
  - 执行和关联对象有关的异步初始化

**示例**：

```ts
onAttached(target: SceneNode): void {
  this.target = target;
  this.target.position.setXYZ(0, 1, 0);
}
```

### 4. onUpdate()

  - 调用时机：成功关联到对象后，每帧调用一次。
  - 参数 `dt` 是当前帧与上一帧之间的时间间隔（秒），`elapsed` 是脚本开始运行以来的总时间（秒）。

**适合做的事情**：

  - 动画、移动、旋转等与时间相关的逻辑
  - 实时输入检测和响应
  - 状态机更新、行为树 tick 等

**示例**：

```ts
onUpdate(dt: number): void {
  if (!this.target) return;
  // rotation 是四元数，不能直接修改 .y；用欧拉角重新设置
  this.angle += this.rotateSpeed * dt;
  this.target.rotation.fromEulerAngle(0, this.angle, 0);
}
```

**性能建议**：

- 避免在 onUpdate 中进行大量同步阻塞操作（例如大规模计算、同步网络请求）

**读取输入**：在 `onUpdate` 中可以通过 `getInput()`（来自 `@zephyr3d/scene`）按帧查询键盘、鼠标和手柄状态。

> **键盘焦点**：键盘事件只在渲染画布上监听。如果页面上叠加了 HTML 按钮，点击按钮后焦点会离开画布，之后键盘输入不再生效。可以在按钮的 `pointerdown` 事件里调用 `event.preventDefault()` 防止抢走焦点，或在点击处理完后调用 `getApp().focus()` 把焦点还给画布。

### 5. onDetached()

  - 调用时机：脚本从对象上解除绑定时调用（例如脚本组件被移除、节点被销毁等）。

**适合做的事情**：

  - 取消事件订阅（避免内存泄漏）
  - 清理对对象的引用
  - 撤销一些只在绑定期间生效的修改（如临时材质、状态）

**示例**：

```ts
onDetached(): void {
  console.log("Script detached from object");
  this.target = undefined;
}
```

### 6. onDestroy()

  - 调用时机：脚本实例即将被销毁前调用。即便脚本已经从对象上解绑，在销毁前仍会执行此回调。

**适合做的事情**：

  - 释放脚本内部持有的资源（缓存的纹理、模型、句柄等）
  - 终止未完成的异步任务（如轮询、定时器）
  - 取消注册到全局的监听/服务等

**示例**：

```ts
onDestroy(): void {
  if (this.timerId != null) {
    clearInterval(this.timerId);
    this.timerId = null;
  }
}
```

## 示例

下面是一个更完整的绑定脚本示例，可绑定到多个场景节点实现移动动画：

```ts
// assets/scripts/move.ts
import type { SceneNode } from "@zephyr3d/scene";
import { Vector3 } from "@zephyr3d/base";
import { RuntimeScript, scriptProp } from "@zephyr3d/scene";

export default class extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  // 在编辑器的 Config 区域可以按节点分别设置
  @scriptProp({ type: 'float', label: 'Speed', default: 2, minValue: 0 })
  speed = 2;
  private direction = new Vector3(1, 0, 0);

  async onCreated(): Promise<void> {
    console.log("MoveScript created");
  }

  onAttached(target: SceneNode): void {
    // 保存关联对象，并放到起始位置
    this.target = target;
    target.position.setXYZ(0, 0, 0);
  }

  onUpdate(dt: number): void {
    // 沿 direction 方向匀速移动
    this.target?.position.addBy(Vector3.scale(this.direction, this.speed * dt));
  }

  onDetached(): void {
    console.log("MoveScript detached");
    this.target = undefined;
  }

  onDestroy(): void {
    console.log("MoveScript destroyed");
    // 在此处做资源释放或全局解注册
  }
}
```

在编辑器中，将此脚本绑定到多个节点对象，每个节点会得到自己的脚本实例，按照相同逻辑移动，速度可以分别设置。

脚本的 `console.log` 输出在预览页面的浏览器开发者工具中查看。编辑器没有热重载：修改脚本后需要重新运行预览。

