# Scene Picking

## Overview

**Scene Picking** refers to the technique of selecting or identifying objects in a virtual 3D scene through mouse, touch, or other input devices.  
It provides the foundation for interactive systems, enabling users to select, manipulate, or interact with objects in three‑dimensional space.

The engine provides two main picking methods:

1. **Ray‑based Picking** — a CPU‑driven geometric intersection algorithm  
2. **Color‑based Picking** — a GPU‑driven pixel‑accurate method  

---

## Ray‑based Picking

**Ray‑based picking** is a picking algorithm executed on the CPU.  
The principle is simple: based on the input position on screen, a ray is generated from the camera through that position in world (or camera) space.  
This ray is then tested against the bounding volumes of scene objects to determine which object is intersected.

Example:

```javascript  
// Assume (x, y) are the screen coordinates relative to the top-left of the viewport  
// Construct a ray from the camera through this screen position  
const ray = camera.constructRay(x, y);  

// Perform ray intersection test in the scene  
const pickResult = scene.raycast(ray);  

// If an object is hit, pickResult contains intersection information  
if (pickResult) {  
  console.log(`Node: ${pickResult.target.node}`);  
  console.log(`Distance: ${pickResult.dist}`);  
  console.log(`Intersection: ${pickResult.point}`);  
}  
```

> Ray‑based picking tests intersections using object **bounding boxes**,  
> so it is approximate by nature — for irregular meshes, transparent surfaces, or skinned/animated geometry,  
> the picked result may be inaccurate.  
> For pixel‑level accuracy or complex object selection, **Color‑based Picking** is recommended.

<div class="showcase" case="tut-47"></div>

---

## Color‑based Picking

**Color‑based picking** is a GPU‑based picking method capable of **pixel‑accurate selection**.  
The principle is: render each selectable object using a **unique encoded color** into a very small offscreen texture (usually 1×1),  
then read that pixel asynchronously to determine which object was picked.

Example usage:

```javascript  
let lastPickResult;  

let x = 0;  
let y = 0;  

// Update picking position on mouse movement  
myApp.on('pointermove', (ev) => {  
  x = ev.offsetX;  
  y = ev.offsetY;  
});  

// Asynchronous picking routine  
function picking() {  
  scene.mainCamera.pickAsync(x, y).then((pickResult) => {  
    if (lastPickResult !== pickResult?.target.node) {  
      // Reset previously picked object  
      if (lastPickResult) {  
        lastPickResult.material.emissiveColor = Vector3.zero();  
        lastPickResult = null;  
      }  
      // Highlight newly picked object  
      if (pickResult) {  
        lastPickResult = pickResult.target.node;  
        lastPickResult.material.emissiveColor = new Vector3(1, 1, 0);  
      }  
    }  
  });  
}  

// Perform picking once per frame  
myApp.on('tick', picking);  
```

<div class="showcase" case="tut-48"></div>

---

## Method Comparison and Recommendations

| Method | Execution | Precision | Use Case | Advantages | Limitations |
|---------|------------|------------|------------|-------------|--------------|
| **Ray‑based Picking** | CPU | Bounding box (approximate) | Simple models, low‑precision selection | High performance, no GPU dependency | Inaccurate for detailed or deforming meshes |
| **Color‑based Picking** | GPU | Pixel‑accurate | Editors, precise user interaction | High accuracy, supports complex geometry | May cause stalls under WebGL due to synchronous readback |

---

## Summary

Scene picking is a fundamental feature for building interactive 3D applications.  
Zephyr3D provides both **Ray‑based** and **Color‑based** picking solutions, allowing developers to balance precision and performance based on their needs:

- For simple scenes or frequent, lightweight interactions, use **Ray‑based Picking** (fast but approximate).  
- For high‑precision selection or editor‑style tools, use **Color‑based Picking** (accurate but more demanding).  
- On **WebGL2** or **WebGPU**, color‑based picking is recommended as the preferred approach.
