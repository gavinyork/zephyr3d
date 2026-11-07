# 对象生命周期管理（Object Lifetime Management）

## 概述

在图形渲染引擎中，**对象生命周期管理** 是保证资源安全与系统稳定的基础。  
Zephyr3D 运行于 JavaScript 环境，而 JavaScript **没有确定性析构（Destructors）**，  
因此必须通过可控机制来管理 GPU 等系统级资源的创建与销毁时机。

Zephyr3D 通过 **智能指针系统 (`DRef` 与 `DWeakRef`)** 实现对所有资源对象的生命周期管理。  
智能指针负责引用计数、依赖关系与延迟释放逻辑，确保在正确的时间、安全地清理资源。

---

## 生命周期管理的核心痛点

1. **JavaScript GC 不确定性**  
   垃圾回收机制延迟释放，无法满足显卡资源实时回收需求。  

2. **手动释放风险高**  
   若在仍有其他对象持有引用时调用资源的 `.dispose()`，  
   将导致悬挂指针（dangling reference）或不可恢复的异常。  

3. **跨帧与多模块资源共享**  
   对象可能被多个系统（渲染、动画、场景）持有，难以确定何时安全销毁。  

---

## Zephyr3D 的解决方案：智能指针机制

### 智能指针类型

| 类型 | 类名 | 描述 |
|------|------|------|
| **强引用** | `DRef<T>` | 持有资源所有权，增加引用计数，确保资源未被提前释放 |
| **弱引用** | `DWeakRef<T>` | 仅观察目标对象，不增加引用计数，当目标被销毁后自动失效 |

智能指针不仅持有引用，还负责管理引用计数。  
对象一旦交给了引擎（赋给材质、网格、父节点等）或被 `DRef` 持有，**就不要再直接调用它的 `.dispose()`**，而应释放自己持有的那个引用。  
自己独占、确定不再使用、也没有被任何引擎对象引用的对象，可以直接 `dispose()`，例如示例中先 `node.remove()` 再 `node.dispose()`。

---

## 生命周期的底层逻辑

1. `DRef.set(obj)` —— 绑定对象并增加其引用计数。  
2. `DRef.dispose()` —— 释放引用并减少其引用计数。  
3. 当所有 `DRef` 被释放（引用计数为 0）后，**引擎将在下一帧自动调用对象的 `dispose()` 方法**来真正销毁资源。  

"下一帧"具体是指下一次 `Application.frame()` 开始时，由 `flushPendingDisposals()`（来自 `@zephyr3d/base`）统一执行。不使用 `Application` 而自己驱动渲染循环时，需要每帧自行调用 `flushPendingDisposals()`，否则这些对象永远不会被释放。

由此保证了渲染过程中不会因对象释放而引发冲突或 GPU 状态异常。

> ⚠️ 直接调用一个仍被其他对象引用的资源的 `dispose()`，会让引用方拿到已销毁的对象。  
> 共享的对象请始终通过智能指针的 `dispose()` 来管理生命周期。

---

## IDisposable 接口与 Disposable 基类

引擎中涉及 GPU 或底层资源的对象均实现了 `IDisposable` 接口：

```typescript  
interface IDisposable extends IEventTarget<{ dispose: [] }> {  
  dispose(): void;  
  readonly disposed: boolean;  
}  
```

`dispose()` 定义了对象被引擎释放时应执行的清理逻辑，`disposed` 表示对象是否已被销毁。  
自定义类通常直接继承 `Disposable` 基类，它已经实现了这些成员：

```typescript  
import { Disposable } from "@zephyr3d/base";  

class MyResource extends Disposable {  
  constructor() {  
    super();  
    // 初始化GPU资源  
  }  

  protected onDispose(): void {  
    // 实际释放逻辑（例如释放显存、解绑缓冲区）  
    console.log("MyResource released.");  
  }  
}  
```

> 注意：交给 `DRef` 托管后，不要再直接调用 `myResource.dispose()`。  
> 所有 `DRef` 释放后，引擎会自动调用该方法。

---

## 智能指针接口使用方法

### 创建与绑定

```typescript  
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("/assets/wood.png"));  
```

此时内部对象引用计数 +1。  
`DRef` 持有该对象直至主动调用 `texRef.dispose()`。

---

### 获取持有对象

```typescript  
const tex = texRef.get();  
if (tex) {  
  // 使用此tex对象
}  
```

`.get()` 返回当前绑定的对象。`DRef` 本身不检查对象是否已被销毁：只有这个 `DRef` 自己调用 `dispose()` 之后，`.get()` 才返回 `null`。需要判断对象是否已销毁时，检查对象的 `disposed` 属性，或改用会自动失效的 `DWeakRef`。

---

### 替换引用

`DRef` 的 `.set()` 方法会自动处理旧对象的引用计数递减与新对象的引用计数递增：

```typescript  
texRef.set(newTexObj);  
```

这确保对象切换时的引用关系自动正确维护。

---

### 释放引用

当不再需要对象时，应调用智能指针的 `.dispose()` 方法：

```typescript  
texRef.dispose();  
```

调用后：
1. 该 `DRef` 与资源对象的关联关系立即断开；
2. 资源引用计数减少；
3. 若引用计数减至 0，引擎将在**下一帧自动销毁对象**。

---

### 弱引用访问

`DWeakRef` 不持有所有权，不能阻止对象销毁。  
使用 `.get()` 方法可临时访问对象：

```typescript  
import { DWeakRef } from "@zephyr3d/base";  

// 直接用被引用对象构造弱引用
const weakTex = new DWeakRef(texRef.get());  

const tex = weakTex.get();
if (tex) {  
  // 使用tex对象
}  
```

当资源销毁后，`weakTex.get()` 会返回 `null`。

---

## 生命周期示意图

```  
┌───────────────────────────────┐  
│ new DRef(object)              │  
└─────────────┬─────────────────┘  
              │ (引用计数 +1)  
              ▼  
     持有对象，安全使用  
              │  
        调用 DRef.dispose()  
              │ (引用计数 -1)  
              ▼  
  若计数 > 0：对象仍存活  
  若计数 = 0：  
     │  
     ▼  
下一帧由引擎自动调用  
  object.dispose() → 释放GPU资源  
```

---

## 引擎中的受管资源类型

Zephyr3D 引擎中大部分核心对象都由智能指针托管：

| 类别 | 示例 | 描述 |
|------|------|------|
| **场景与节点** | `Scene`, `SceneNode` | 场景树结构与对象实例 |
| **材质系统** | `Material` | 着色程序与渲染状态 |
| **几何数据** | `Primitive` | 顶点与索引数据 |
| **动画系统** | `AnimationClip`, `AnimationSet` | 动画与资源集 |
| **图形底层对象** | `Texture`, `Buffer`, `FrameBuffer` | GPU 驱动资源封装 |

### 场景节点与场景的持有关系

- 父节点用 `DRef` 持有子节点。`node.remove()`（即把 `parent` 设为 `null`）之后，如果没有别的 `DRef` 持有这个节点，它会在下一帧开始时被销毁。想把节点暂时摘下、过几帧再挂回去，要先用自己的 `DRef` 持有它；在同一帧内重新挂回则不受影响。
- `getEngine().setRenderable(scene, layer)` 同样用 `DRef` 持有场景。切换到另一个场景后，旧场景如果没有别的 `DRef` 持有，会被销毁。要在几个场景之间来回切换，就用 `DRef` 分别持有它们（[水面](zh-cn/water.md)页的 tut-66 就是这样做的）。

---

## 从资源管理器加载的对象

通过 `getEngine().resourceManager` 加载得到的纹理、模型等对象，刚拿到时没有被任何 `DRef` 持有。

- 把它交给引擎对象后（例如赋给材质的纹理属性，或设为网格的图元、材质），引擎会用 `DRef` 持有它。此时**不要再手动 `dispose()`**，否则会销毁正在使用的资源。
- `fetchTexture()` 对同一个 URL 返回缓存中的同一个实例，手动 `dispose()` 会影响所有使用它的地方。
- 只有从未交给任何引擎对象、也没有用 `DRef` 持有的对象，才需要在用完后手动调用 `.dispose()`。更稳妥的做法是用 `DRef` 持有它，用完时释放这个 `DRef`。

示例：

```typescript
// 交给材质后由材质持有，不要再手动 dispose
material.albedoTexture = await getEngine().resourceManager.fetchTexture("stone.png");

// 自己持有：用 DRef 包起来，不再需要时释放这个引用
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("stone.png"));
// ...
texRef.dispose();
```

---

## 实践建议

1. **跨帧或共享资源必须使用 `DRef` / `DWeakRef` 持有。**  
2. **不要手动调用由智能指针或引擎对象持有的对象的 `.dispose()` 方法。**  
3. **从未交给引擎、也没有用智能指针持有的对象，用完需手动释放。**  
4. **使用 `.get()` 访问与检测对象，不存在 `.value` 或 `.valid` 属性。**

---

## 优势与特性

- **显式且安全的引用控制**  
  `.set()` 与 `.dispose()` 自动管理引用计数；  

- **防止提早销毁或悬挂引用**  
  引擎仅在确定无引用时才销毁对象；  

- **帧级延迟释放机制**  
  对象销毁延迟到下一渲染帧，防止影响当前任务；  

- **扩展性良好**  
  自定义对象可通过实现 `IDisposable` 统一纳入生命周期体系。

---

## 总结

Zephyr3D 通过 `DRef` / `DWeakRef` 实现精确的**引用计数与延迟销毁机制**。  
这一机制将资源释放控制从对象层转移至智能指针层，使资源管理既安全又高效。

- 应始终通过智能指针调用 `.dispose()` 来释放持有关系；  
- 引擎在引用计数清零后的下一帧自动调用资源对象的 `.dispose()`；  
- 从资源管理器加载、但从未交给引擎也未用 `DRef` 持有的对象，用完需手动执行 `.dispose()`；  
- 开发者应使用 `.get()` 获取对象状态与访问引用。

