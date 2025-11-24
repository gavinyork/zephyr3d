# Geometry Instancing

## Overview

**Geometry Instancing** is an efficient rendering technique  
that allows multiple instances of the same geometry to be drawn within a single rendering call,  
without the need to issue separate draw commands for each object.

This method is especially useful for scenes that contain large numbers of identical or repetitive objects  
(such as grass, buildings, particles, trees, etc.).  
Through geometry instancing, objects **share the same geometry and material resources**,  
while each instance can have its own **position**, **rotation**, **scale**, and **material properties**.  
This dramatically reduces the number of GPU draw calls while maintaining visual diversity,  
greatly improving performance and reducing memory usage.

Zephyr3D provides native support for geometry instancing on both **WebGL2** and **WebGPU** platforms.  
Within the same scene, all Meshes that **reference the same geometry** and use **the same material or material instances**  
are automatically batched and rendered through instancing.

---

## Basic Usage

To enable instanced rendering, simply ensure that:

- All objects share the **same geometry (primitive)**.  
- All objects use **instances** of the same **material**.  
- Each instance can modify its own **transform** and **material properties**.

The following example demonstrates how to create several box instances sharing the same geometry and material:

```javascript  
// Create geometry  
const boxShape = new BoxShape();  

// Create material  
const material = new LambertMaterial();  

// Create multiple box instances  
for (let i = 0; i < 10; i++) {  
  const box = new Mesh(scene);  
  // Share the same geometry  
  box.primitive = boxShape;  
  // Use the same material but create independent material instances  
  box.material = material.createInstance();  
  // Assign a random color to each instance  
  box.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);  
  // Set the position for each instance  
  box.position.setXYZ(Math.random() * 5, Math.random() * 3, Math.random() * 5);  
}  
```

> 💡 Tip  
> - All Meshes sharing the same `primitive` and material instance are automatically batched by the engine.  

A complete demonstration can be found below:

<div class="showcase" case="tut-44"></div>

---

## Dynamic Batching

By default, the Mesh objects created above use **Dynamic Batching** during rendering.  
The engine performs **frustum culling** for each frame to determine visible objects,  
and then merges the visible ones into a single rendering batch before issuing a draw call with instancing.

**Advantages:**

- Automatically culls invisible objects, reducing GPU workload.  
- Suitable for dynamic or interactive scenes where objects change frequently.

**Disadvantages:**

- When dealing with a large number of instances, CPU‑side culling and batching can become a performance bottleneck.  
- Frequent batch rebuilding may reduce frame rate in heavy scenes.

In such cases, consider using **Static Batching** for improved performance.

---

## Static Batching

**Static Batching** caches the result of instance combination in GPU memory,  
reducing the overhead of dynamic computation and repeated batching.  
Objects within a static batch are **no longer frustum‑culled or merged in real time**,  
which significantly lowers CPU workload and improves performance.

**Usage:**

To enable static batching, simply place all instanced objects under a `BatchGroup` node.  
All meshes within that group will be automatically combined into a single static batch for rendering.

```javascript  
// Create a batch group parent node  
const batchGroup = new BatchGroup(scene);  

// Add multiple instanced objects into the batch group  
for (let i = 0; i < 100; i++) {  
  const obj = new Mesh(batchGroup);  
  obj.primitive = boxShape;  
  obj.material = material.createInstance();  
  obj.position.setXYZ(Math.random() * 20, 0, Math.random() * 20);  
}  
```

> ⚠️ Notes  
> - Objects inside a static batch can still change position, rotation, scale, or material instance properties.  
>   However, frequent changes will trigger batch rebuilding, severely impacting performance.  
> - Static batching is recommended for large numbers of instances with low update frequency.

<div class="showcase" case="tut-45"></div>

---

## Instancing for Loaded Models

Models loaded via `ResourceManager` (e.g., the same prefab or imported asset)  
do **not** automatically enable geometry instancing by default.  
You can manually enable instancing for specific `Mesh` components in the editor  
or through custom import scripts.  

This approach significantly improves performance in large or repetitive scenes,  
such as vegetation, modular architecture, and particle decorations.

---

## Transparent Objects and Instancing

Normally, transparent objects are rendered **from far to near**,  
following a depth‑based sorting order.  
However, when using geometry instancing, all instances are drawn in the same draw call,  
making it impossible to perform individual distance sorting.

Therefore, if you need to use instancing for **transparent objects**,  
it is strongly recommended to use **Order‑Independent Transparency (OIT)** techniques.  

Zephyr3D supports the following OIT implementations:

1. **Weighted Blended OIT** – supported on WebGL, WebGL2, and WebGPU  
2. **Per‑Pixel Linked List OIT** – available on WebGPU only  

For details, see [OIT Rendering](zh-cn/oit.md).

---

## Summary

Geometry Instancing is a key optimization technique in modern rendering systems.  
It reduces draw call counts and reuses shared data to achieve **lower memory usage** and **higher performance**.  

Zephyr3D’s instancing system supports **automatic batching**,  
and it can flexibly combine **dynamic** and **static** batching strategies for various scene types.

| Feature | Use Case | Advantages | Considerations |
|----------|-----------|------------|----------------|
| **Dynamic Batching** | Moderate instance count, frequently moving objects | Automatic culling, flexible | High CPU cost when instances are numerous |
| **Static Batching** | Large instance count, low update frequency | Cached batches, stable performance | Rebuilding occurs if transform or material changes frequently |
| **Transparent Instancing** | Multiple transparent objects sharing the same material | Supports OIT rendering with improved realism | No per‑distance sorting |

> ✅ Recommendations:  
> - Prefer **Static Batching** for large, mostly static instance groups.  
> - Use **Dynamic Batching** for movable or interactive objects.  
> - Combine **OIT** with instancing for correct and visually appealing transparent results.
