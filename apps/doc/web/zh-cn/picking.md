# 场景拾取

## 概述

**场景拾取（Scene Picking）** 是指在虚拟场景中，通过鼠标、触摸或其他输入设备，选择或识别场景中物体的一项关键技术。  
它为交互系统提供基础支持，使用户能够与三维空间中的对象进行选择、操作或交互。

引擎提供了以下两种拾取方式：

1. **射线检测（Ray‑based Picking）** — 基于 CPU 的几何射线求交算法  
2. **颜色拾取（Color‑based Picking）** — 基于 GPU 的像素级拾取方案  

---

## 射线检测

**射线检测** 是一种在 CPU 上执行的拾取算法。  
其原理是：根据鼠标或其他输入设备在屏幕上的坐标位置，从摄像机位置向该坐标方向发出一条射线，  
并计算这条射线与场景中物体的几何体（包围盒）是否相交，从而确定被拾取的对象。

以下示例展示了如何使用射线检测实现场景拾取：

```javascript  
// 假设 x 和 y 是相对于视口左上角的屏幕坐标  
// 构造一条从摄像机原点穿过该屏幕坐标的射线  
const ray = camera.constructRay(x, y);  

// 对场景执行射线检测  
const pickResult = scene.raycast(ray);  

// 若拾取到物体，则 pickResult 包含拾取结果信息  
if (pickResult) {  
  console.log(`节点: ${pickResult.target.node}`);  
  console.log(`距离: ${pickResult.dist}`);  
  console.log(`交点: ${pickResult.point}`);  
}  
```

> 射线检测通过与物体的**包围盒（Bounding Box）**求交来计算命中结果，  
> 因此精度有限 —— 对于不规则网格、透明物体或具有骨骼变形的物体，可能无法精确拾取。  
> 若需像素级精度或拾取透明/复杂对象，建议使用 **颜色拾取**。

<div class="showcase" case="tut-47"></div>

---

## 颜色拾取

**颜色拾取** 是一种基于 GPU 的拾取方法，可实现像素级精确拾取。  
其原理是：将场景中每个可选择物体以**唯一的编码颜色**渲染到一张极小的离屏纹理（通常为 1×1），  
再异步读取该像素的颜色值以确定被拾取的对象。

以下示例展示如何使用颜色拾取获取鼠标下的物体：

```javascript  
let lastPickResult;

let x = 0;
let y = 0;
// 鼠标移动时更新拾取位置
myApp.on('pointermove', (ev) => {
  x = ev.offsetX;
  y = ev.offsetY;
});
// 异步拾取方法
function picking() {
  scene.mainCamera.pickAsync(x, y).then((pickResult) => {
    if (lastPickResult !== pickResult?.target.node) {
      if (lastPickResult) {
        lastPickResult.material.emissiveColor = Vector3.zero();
        lastPickResult = null;
      }
      if (pickResult) {
        lastPickResult = pickResult.target.node;
        lastPickResult.material.emissiveColor = new Vector3(1, 1, 0);
      }
    }
  });
}
// 每帧执行异步拾取
myApp.on('tick', picking);
```

<div class="showcase" case="tut-48"></div>

---

## 方法对比与建议

| 拾取方式 | 执行位置 | 精度 | 适用场景 | 优点 | 缺点 |
|-----------|-----------|-------|------------|-------|------|
| **射线检测** | CPU | 基于包围盒（近似） | 简单模型、低精度选取 | 性能高，不依赖 GPU | 对复杂模型不准确 |
| **颜色拾取** | GPU | 像素级精确 | 编辑器、高精度交互 | 精度高，支持复杂形状 | WebGL 模式下可能卡顿 |

---

## 总结

场景拾取是实现 3D 交互系统的基础功能。  
Zephyr3D 同时提供 **射线检测**与**颜色拾取**两种方案，可根据精度与性能需求灵活选择：

- 若场景简单或交互频繁，可选择 **射线检测**（快速但近似）；  
- 若需要高精度拾取或编辑器类功能，可选择 **颜色拾取**（准确但开销较大）；  

