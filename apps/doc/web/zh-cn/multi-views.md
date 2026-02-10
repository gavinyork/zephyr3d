# 多视口渲染（Multi‑Viewport Rendering）

## 概述

**多视口渲染（Multi‑Viewport Rendering）** 是 Zephyr3D 引擎提供的一项高级绘制能力，  
允许在同一画布（Canvas）上渲染多个不同的画面区域，从而实现以下效果：

- **画中画（Picture‑in‑Picture）** 视图；  
- **三视图布局**（Top / Front / Side）；  
- **分屏显示（Split Screen）**；  
- **辅助或调试视图**（如阴影贴图、深度缓冲可视化等）。

通过配置相机的视口 (`Camera.viewport`)，开发者可以灵活地控制场景的绘制位置与尺寸，
在一次渲染循环中展示多个独立的观察角度或内容。

---

## 视口原理

在 Zephyr3D 中，每个 `Camera` 都拥有独立的 **`viewport`** 属性，  
用于指定相机渲染结果在屏幕上的区域。

### 格式说明

`Camera.viewport` 是一个 **包含 4 个数字的数组**，格式如下：

```javascript  
camera.viewport = [x, y, width, height];  
```

| 参数 | 含义 | 单位 | 说明 |
|------|------|------|------|
| x | 视口左下角的水平坐标 | CSS 像素 | 从画布左边缘起算 |
| y | 视口左下角的垂直坐标 | CSS 像素 | 从画布下边缘起算 |
| width | 视口宽度 | CSS 像素 | 绘制区域宽度 |
| height | 视口高度 | CSS 像素 | 绘制区域高度 |

> 原点位于 **画布左下角**，这与 WebGL 坐标系统保持一致。

当设置为 `null` 时，表示使用 **全屏视口**：

```javascript  
camera.viewport = null; // 视口覆盖整个画布（全屏绘制）  
```

---

## 基本示例：画中画（PIP）

以下示例展示如何在同一相机上使用两个视口，从而实现「画中画」效果。

```javascript  
myApp.on('tick', () => {  
  camera.updateController();  

  // 获取画布的 CSS 像素尺寸  
  const canvasWidth = myApp.device.deviceXToScreen(myApp.device.canvas.width);  
  const canvasHeight = myApp.device.deviceYToScreen(myApp.device.canvas.height);  

  // —— 第一次渲染：全屏主画面 ——  
  camera.viewport = [0, 0, canvasWidth, canvasHeight];  
  camera.aspect = camera.viewport[2] / camera.viewport[3];  
  camera.render(scene);  

  // —— 第二次渲染：右下角小窗口（画中画） ——  
  camera.viewport = [30, 30, 200, 160];  
  camera.aspect = camera.viewport[2] / camera.viewport[3];  
  camera.render(scene);  
});  
```

效果：主视图全屏显示，同时在右下角绘制一块 200×160 的小画面。

<div class="showcase" case="tut-46"></div>

---

## 多相机多视口布局

你也可以创建多个 `Camera` 对象，为它们分配不同的视口，实现多角度分屏视图。

```javascript  
const camMain = new Camera(scene);  
const camTop = new Camera(scene);  
const camSide = new Camera(scene);  

const w = app.device.deviceXToScreen(app.device.canvas.width);  
const h = app.device.deviceYToScreen(app.device.canvas.height);  

// 主相机：右半屏  
camMain.viewport = [w / 2, 0, w / 2, h];  

// 顶视相机：左上象限  
camTop.viewport = [0, h / 2, w / 2, h / 2];  

// 侧视相机：左下象限  
camSide.viewport = [0, 0, w / 2, h / 2];  

// 依次渲染（后渲染的内容将覆盖前者）  
camTop.render(scene);  
camSide.render(scene);  
camMain.render(scene);  
```

这种布局常用于 3D 编辑器等需要多角度观察的环境。

---

## 注意事项与性能建议

- 每调用一次 `Camera.render()` 都会触发独立的绘制过程，  
  视口越多，渲染代价越高；请在性能与需求之间平衡绘制次数。  

- 多视口可以共享同一 `Scene` 实例，避免重复加载资源。

- 对于更新不频繁的界面（如小地图），  
  可以将画面渲染到 **RenderTexture**，再在主画面中显示该纹理，从而提升性能。  

- 渲染顺序会影响叠加关系，后绘制的内容会显示在前者之上。

- 多视口渲染可与 **后期处理（Post‑Processing）**、**几何体实例化（Instancing）**  
  和 **顺序无关透明度（OIT）** 等系统一同使用，但请注意各相机的后处理链独立性。

---

## 常见应用场景

| 应用场景 | 说明 |
|-----------|------|
| **小地图（Mini‑Map）** | 俯视渲染小范围区域，显示在角落窗口 |
| **三视图编辑器** | 同时展示顶视、前视、侧视的模型视角 |
| **游戏分屏** | 为不同玩家或相机显示独立的屏幕区域 |
| **调试／监视窗口** | 实时显示阴影贴图、反射探头、深度缓冲等信息 |

---

## 总结

多视口渲染使 Zephyr3D 能够在同一画布中灵活呈现多个视角或画面内容：

- `Camera.viewport` 为 `[x, y, width, height]` 数组（单位：像素）；  
- 设置为 `null` 表示全屏绘制；  
- 支持单相机多次渲染或多相机分屏布局；  
- 可广泛应用于编辑器、游戏与工具化可视化场景。

通过合理规划视口布局与渲染顺序，  
你可以轻松实现高效且功能丰富的多视图呈现。
