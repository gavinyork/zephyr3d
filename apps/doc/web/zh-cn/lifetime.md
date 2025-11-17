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
开发者**永远不应直接调用资源对象的 `.dispose()`**，  
而应通过智能指针的 `.dispose()` 主动释放引用。

---

## 生命周期的底层逻辑

1. `DRef.set(obj)` —— 绑定对象并增加其引用计数。  
2. `DRef.dispose()` —— 释放引用并减少其引用计数。  
3. 当所有 `DRef` 被释放（引用计数为 0）后，**引擎将在下一帧自动调用对象的 `dispose()` 方法**来真正销毁资源。  

由此保证了渲染过程中不会因对象释放而引发冲突或 GPU 状态异常。

> ⚠️ 直接调用资源对象的 `dispose()` 将破坏引用追踪机制。  
> 请始终通过智能指针的 `dispose()` 来管理生命周期。

---

## IDisposable 接口与 Disposable 基类

引擎中涉及 GPU 或底层资源的对象均实现了 `IDisposable` 接口：

```typescript  
interface IDisposable {  
  dispose(): void;  
}  
```

`dispose()` 定义了对象被引擎释放时应执行的清理逻辑。  
通常通过继承 `Disposable` 基类实现：

```typescript  
import { Disposable } from "zephyr3d/core";  

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

> 注意：开发者不应直接调用 `myResource.dispose()`。  
> 在智能指针管理下，仅当所有 `DRef` 释放后，引擎才会自动调用该方法。

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

`.get()` 会返回当前绑定的对象，若资源已被释放则返回 `null`。

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
const weakTex = texRef.toWeakRef();  

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

---

## 关于 Resource 模块加载的资源对象

通过 `Resource` 模块加载得到的资源（如纹理、着色器、模型等）为**裸对象**，  
即它们**不是默认受智能指针托管的实例**。  

这意味着：
- 这些对象可以安全地交给 `DRef` 或 `DWeakRef` 托管；  
- 如果不打算用智能指针托管，则**必须在使用完后手动调用对象的 `.dispose()` 方法**释放资源。  

示例：

```typescript  
// 裸对象使用示例  
const tex = await getEngine().resourceManager.fetchTexture("stone.png");  
...  
tex.dispose();  // 若不托管，使用完必须手动销毁  

// 托管使用示例  
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("stone.png"));  
// 引用结束时交由 texRef.dispose() 自动处理  
```

---

## 实践建议

1. **跨帧或共享资源必须使用 `DRef` / `DWeakRef` 持有。**  
2. **不要手动调用由智能指针管理对象的 `.dispose()` 方法。**  
3. **在不使用智能指针的场合（如临时加载）需手动释放对象。**  
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
- Resource 模块加载的资源若未托管，必须手动执行 `.dispose()` 释放；  
- 开发者应使用 `.get()` 获取对象状态与访问引用。

这种严格的一致性设计，使 Zephyr3D 在 JavaScript 环境下实现了接近原生引擎的  
**确定性生命周期管理与安全资源回收机制**。
