# Multi‑Viewport Rendering

## Overview

**Multi‑Viewport Rendering** is an advanced rendering feature in Zephyr3D that allows you to draw multiple view regions within a single canvas.  
This feature enables various effects such as:

- **Picture‑in‑Picture (PIP)** view  
- **Multi‑view layouts** (Top / Front / Side)  
- **Split‑screen rendering** for multiplayer or dual cameras  
- **Debug or auxiliary visualization windows**

By configuring each camera’s viewport (`Camera.viewport`), you can display multiple camera outputs or perspectives in a single render loop.

---

## Viewport Concept

In Zephyr3D, every camera has its own **`viewport`** property that defines where on the screen its rendering result appears.

### Format and Coordinates

`Camera.viewport` is an **array of four numbers**, in the following order:

```javascript  
camera.viewport = [x, y, width, height];  
```

| Parameter | Meaning | Unit | Description |
|------------|----------|------|-------------|
| `x` | Horizontal coordinate of the viewport’s lower‑left corner | CSS pixels | Measured from the left edge of the canvas |
| `y` | Vertical coordinate of the viewport’s lower‑left corner | CSS pixels | Measured from the bottom edge of the canvas |
| `width` | Width of the viewport | CSS pixels | Rendering area width |
| `height` | Height of the viewport | CSS pixels | Rendering area height |

> The origin of the viewport is located at the **bottom‑left** of the canvas, consistent with the WebGL coordinate system.

If `camera.viewport` is set to `null`, it means **full‑screen rendering**:

```javascript  
camera.viewport = null; // Fullscreen viewport  
```

---

## Basic Example: Picture‑in‑Picture (PIP)

The following code demonstrates how to use two viewports on the same camera to create a picture‑in‑picture effect.

```javascript  
myApp.on('tick', () => {  
  camera.updateController();  

  // Get the canvas size in CSS pixels  
  const canvasWidth = myApp.device.deviceXToScreen(myApp.device.canvas.width);  
  const canvasHeight = myApp.device.deviceYToScreen(myApp.device.canvas.height);  

  // —— First render: main fullscreen view ——  
  camera.viewport = [0, 0, canvasWidth, canvasHeight];  
  camera.aspect = camera.viewport[2] / camera.viewport[3];  
  camera.render(scene);  

  // —— Second render: small window in bottom‑right corner ——  
  camera.viewport = [30, 30, 200, 160];  
  camera.aspect = camera.viewport[2] / camera.viewport[3];  
  camera.render(scene);  
});  
```

Result: The scene is rendered fullscreen first, then drawn again as a smaller window (200×160) in the bottom‑right corner.

<div class="showcase" case="tut-46"></div>

---

## Multiple Cameras & Multi‑Viewport Layouts

You can create multiple cameras and assign each its own viewport region to achieve split or multi‑angle layouts:

```javascript  
const camMain = new Camera(scene);  
const camTop = new Camera(scene);  
const camSide = new Camera(scene);  

const w = app.device.deviceXToScreen(app.device.canvas.width);  
const h = app.device.deviceYToScreen(app.device.canvas.height);  

// Main camera: right half of the screen  
camMain.viewport = [w / 2, 0, w / 2, h];  

// Top camera: upper‑left quadrant  
camTop.viewport = [0, h / 2, w / 2, h / 2];  

// Side camera: lower‑left quadrant  
camSide.viewport = [0, 0, w / 2, h / 2];  

// Render order defines overlay priority  
camTop.render(scene);  
camSide.render(scene);  
camMain.render(scene);  
```

This layout is particularly useful in editor or modeling tools that require multiple orthographic or perspective views.

---

## Notes & Performance Tips

- Each `Camera.render()` call invokes a **separate rendering pass**.  
  The more viewports you render, the higher the rendering cost — balance performance accordingly.

- Multiple viewports can **share the same Scene** instance, avoiding duplicate resource loads.

- For slow‑updating or auxiliary windows (e.g., mini‑map, debug view),  
  you can **render to a RenderTexture** first, then display that texture in the main viewport to save performance.

- Rendering order matters: later renders will visually overlay earlier ones.

- Multi‑viewport rendering works with **Post‑Processing**, **Instancing**, and **Order‑Independent Transparency (OIT)**.  
  However, ensure that post‑processing effects are configured per camera when necessary.

---

## Typical Use Cases

| Scenario | Description |
|-----------|-------------|
| **Mini‑Map / Monitor Window** | Renders a secondary top‑down or overview view in a small area |
| **3‑View Editor** | Displays top, front, and side viewports simultaneously for precise modeling |
| **Split‑Screen Gameplay** | Different players or cameras rendering to distinct screen areas |
| **Debug / Diagnostic Window** | Visualizes shadow maps, depth buffers, or reflection probes |

---

## Summary

Multi‑viewport rendering in Zephyr3D allows flexible display of multiple camera outputs or perspectives within one canvas.

- `Camera.viewport` is an **array `[x, y, width, height]` in CSS pixels**;  
- Setting it to **`null`** means fullscreen rendering;  
- Supports **multi‑pass rendering with one camera**, or **multi‑camera parallel rendering**;  
- Ideal for tools, debug interfaces, games, and any multi‑view presentation scenario.

By carefully managing viewport placement and render order,  
you can achieve multi‑window, multi‑angle rendering with both visual clarity and optimal performance.
