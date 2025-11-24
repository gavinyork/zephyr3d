# 几何体实例化（Geometry Instancing）

## 概述

**几何体实例化（Geometry Instancing）** 是一种高效的图形渲染技术，  
它允许在一次渲染调用中绘制同一几何体的多个实例，而无需为每个对象单独提交渲染命令。

这种方法非常适合需要重复绘制大量相同对象的场景（例如：草地、建筑、粒子、树木等）。  
通过几何体实例化，多个对象可以 **共享相同的几何结构与材质资源**，  
但又能分别修改 **位置（Position）**、**旋转（Rotation）**、**缩放（Scale）** 和 **材质属性**，  
从而在保证视觉多样性的同时大幅减少 GPU 绘制调用（Draw Call）数量，显著提升渲染性能。

Zephyr3D 在 **WebGL2** 和 **WebGPU** 平台均提供原生的几何体实例化支持。  
在同一场景中，所有 **引用相同几何体** 且使用 **同一材质或其材质实例** 的 Mesh，  
会被引擎自动合并为一个批次，通过实例化方式进行渲染。

---

## 基础用法

在代码中，要让多个对象使用实例化渲染，只需确保：

- 所有对象使用 **同一个几何体（Geometry）**；
- 使用 **同一材质（Material）** 的 **多个实例**；
- 每个实例可分别修改自身的 **变换（Transform）** 与 **材质属性**。

以下示例展示如何创建多个共享同一几何体与材质的盒子实例：

```javascript  
// 创建几何体  
const boxShape = new BoxShape();  

// 创建材质  
const material = new LambertMaterial();  

// 创建若干盒子实例  
for (let i = 0; i < 10; i++) {  
  const box = new Mesh(scene);  
  // 所有实例共享同一个几何体  
  box.primitive = boxShape;  
  // 使用同一材质并为每个实例创建独立的材质实例  
  box.material = material.createInstance();  
  // 为每个实例设置不同的颜色  
  box.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);  
  // 设置每个对象的位置  
  box.position.setXYZ(Math.random() * 5, Math.random() * 3, Math.random() * 5);  
}  
```

> 💡 提示  
> - 所有共享同一 `primitive` 与同一 `Material`实例会被引擎自动合批。  

以下为完整示例演示：

<div class="showcase" case="tut-44"></div>

---

## 动态合批（Dynamic Batching）

默认情况下，以上创建的 Mesh 在渲染过程中采用 **动态合批** 方式。  
引擎会在每帧根据摄像机视锥体（Frustum Culling）对对象进行可见性判断，  
然后将可见对象合并到一个渲染批次中再提交所需的实例调用。

**优点：**

- 自动剔除不可见对象，减少 GPU 负载。  
- 适合动态场景或实时变化的实例。

**缺点：**

- 当实例数量很大时，CPU 端的剔除与合批逻辑会成为性能瓶颈。  
- 频繁重建批次在某些场景下可能降低帧率。

在这种情况下，可以考虑使用 **静态合批** 来进一步优化。

---

## 静态合批（Static Batching）

**静态合批** 通过将实例合并结果缓存在显存中，从而减少动态计算与频繁合批的开销。  
静态批次中的对象在渲染时 **不再进行视锥剔除和实时合并**，  
可以显著降低 CPU 负载并提升整体性能。

**使用方法：**

只需将需要实例化的对象统一放入一个 `BatchGroup` 节点下，  
该组内的所有实例将被自动合并为一个静态批次进行绘制。

```javascript  
// 创建批次组父节点  
const batchGroup = new BatchGroup(scene);  

// 将多个实例化对象加入批次组  
for (let i = 0; i < 100; i++) {  
  const obj = new Mesh(batchGroup);  
  obj.primitive = boxShape;  
  obj.material = material.createInstance();  
  obj.position.setXYZ(Math.random() * 20, 0, Math.random() * 20);  
}  
```

> 注意  
> - 静态批次内的对象仍可改变位置、缩放、旋转或材质属性，  
>   但若频繁修改将触发批次重建，严重影响性能。  
> - 适用于实例数量大、更新频率低的场景。

<div class="showcase" case="tut-45"></div>

---

## 加载模型的实例化

通过 `ResourceManager` 加载的模型（例如使用相同预制体的多个实例）默认不会自动启用几何体实例化。  
在编辑器或自定义导入脚本中，可以手动指定模型中某些 `Mesh` 启用实例化渲染。  
这有助于在大型场景或重复模型（例如植被、建筑模块）中显著优化性能。

---

## 透明物体与实例化

通常情况下，透明物体需要根据视距（由远到近）进行排序再绘制。  
然而，当使用几何体实例化时，所有实例在同一次绘制调用中提交，无法实现精确的距离排序。  

因此，如果需要对 **透明对象** 使用实例化渲染，推荐使用顺序无关透明渲染技术（**Order‑Independent Transparency, OIT**）。  
Zephyr3D 提供以下两种 OIT 实现方案：

1. **Weighted Blended OIT** – 兼容 WebGL、WebGL2 和 WebGPU  
2. **Per‑Pixel Linked List OIT** – 仅支持 WebGPU  

详细说明请参考：[OIT 渲染](zh-cn/oit.md)

---

## 总结

几何体实例化是现代图形渲染中提升性能的关键手段之一。  
它通过减少渲染调用次数（Draw Call）并复用共享资源，实现了 **内存占用更低、性能更高** 的绘制流程。

Zephyr3D 的实例化渲染机制支持自动合批，并可灵活地结合动态或静态批处理策略：

| 功能 | 使用场景 | 优点 | 注意事项 |
|------|------------|-------|-----------|
| **动态合批** | 实例数量中等，对象频繁移动 | 视锥体剔除自动化，灵活性高 | 大量实例会产生 CPU 负载 |
| **静态合批** | 实例数量巨大，变化较少 | 合批结果缓存，高效稳定 | 修改位置或属性会触发批次重建 |
| **透明实例化** | 多个透明对象共享材质 | 支持 OIT 渲染，提高表现力 | 不支持基于距离排序 |

> 建议：  
> - 对于数量庞大且分布稳定的对象优先使用静态合批。  
> - 动态对象可保持默认的自动动态批次机制。  
> - 透明对象结合 **OIT** 渲染可获得正确且美观的视觉效果。
