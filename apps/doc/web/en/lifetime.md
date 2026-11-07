# Object Lifetime Management

## Overview

In a graphics engine, **object lifetime management** is fundamental to maintaining system stability and resource safety.  
Zephyr3D operates in a JavaScript environment, which **does not provide deterministic destructors**,  
so the engine must implement an explicit mechanism to manage the creation and destruction of GPU and system‑level resources.

Zephyr3D uses a **smart pointer system (`DRef` and `DWeakRef`)** to manage the lifetime of all resource objects.  
Smart pointers handle reference counting, dependency tracking, and delayed release, ensuring resources are safely cleaned up at the correct time.

---

## Core Challenges of Lifetime Management

1. **Non‑deterministic JavaScript GC**  
   The garbage collector releases memory asynchronously and cannot guarantee real‑time GPU resource reclamation.  

2. **High risk of manual disposal**  
   Calling a resource’s `.dispose()` while it is still referenced elsewhere  
   can result in dangling references or unrecoverable runtime errors.  

3. **Cross‑frame and multi‑module sharing**  
   Objects may be referenced by multiple subsystems (e.g., rendering, animation, scenes), making it difficult to determine when destruction is safe.

---

## Zephyr3D’s Solution: Smart References

### Smart Pointer Types

| Type | Class | Description |
|------|--------|-------------|
| **Strong Reference** | `DRef<T>` | Holds ownership of an object, increments its reference count, ensuring it cannot be destroyed prematurely |
| **Weak Reference** | `DWeakRef<T>` | Observes an object without increasing its reference count; automatically becomes invalid when the object is destroyed |

Smart pointers not only hold references but also manage reference counting internally.  
Once an object has been handed to the engine (assigned to a material, a mesh, a parent node and so on) or is held by a `DRef`, **do not call its `.dispose()` directly**; release the reference you hold instead.  
An object you own exclusively, will not use again and that no engine object references can be disposed directly, as in the examples that call `node.remove()` followed by `node.dispose()`.

---

## Internal Lifecycle Logic

1. **`DRef.set(obj)`** — binds the object and increases its reference count.  
2. **`DRef.dispose()`** — releases ownership and decreases the reference count.  
3. When all `DRef` instances have been disposed (count = 0), the engine **automatically calls the object’s `dispose()` method during the next frame** to destroy the underlying GPU resource.

"The next frame" means the start of the next `Application.frame()`, where `flushPendingDisposals()` (from `@zephyr3d/base`) runs. If you drive the render loop yourself instead of through `Application`, call `flushPendingDisposals()` every frame, or these objects are never released.

This design ensures that no GPU resource is freed during an active rendering process, preventing state corruption and runtime instability.

> ⚠️ Calling `.dispose()` on a resource that other objects still reference  
> leaves them holding a destroyed object.  
> Manage the lifetime of shared objects through `DRef.dispose()`.

---

## IDisposable Interface and Disposable Base Class

All GPU or system resources in Zephyr3D implement the `IDisposable` interface:

```typescript
interface IDisposable extends IEventTarget<{ dispose: [] }> {
  dispose(): void;
  readonly disposed: boolean;
}
```

The `dispose()` method defines the cleanup logic executed when the engine releases the object.  
A typical resource class inherits from `Disposable` and implements `onDispose()`:

```typescript
import { Disposable } from "@zephyr3d/base";

class MyResource extends Disposable {
  constructor() {
    super();
    // Initialize GPU resource
  }

  protected onDispose(): void {
    // Actual cleanup logic (release GPU memory, unbind buffers, etc.)
    console.log("MyResource released.");
  }
}
```

> Once a `DRef` manages it, do **not** call `myResource.dispose()` yourself.  
> The engine invokes it once all `DRef`s are released.

---

## Using Smart References

### Creating and Binding

```typescript
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("/assets/wood.png"));  
```

At this point, the resource’s reference count is incremented by one.  
The `DRef` holds the object until `texRef.dispose()` is called.

---

### Getting the Object

```typescript
const tex = texRef.get();
if (tex) {
  // Use the texture here
}
```

`.get()` returns the currently bound object. A `DRef` does not check whether the object has been destroyed: `.get()` only returns `null` after this `DRef` itself has been disposed. To find out whether an object is destroyed, check its `disposed` property, or use a `DWeakRef`, which invalidates itself.

---

### Replacing a Reference

The `.set()` method automatically adjusts reference counts for both the old and new target objects:

```typescript
texRef.set(newTexObj);
```

This ensures correct ownership transitions without manual bookkeeping.

---

### Releasing Ownership

When the object is no longer needed, invoke the smart pointer’s `.dispose()` method:

```typescript
texRef.dispose();
```

This action:
1. Immediately disassociates the pointer from the resource;  
2. Decrements the reference count;  
3. If the count reaches zero, the engine schedules disposal in **the next frame**.

---

### Accessing via Weak Reference

`DWeakRef` does not hold ownership and never alters reference counts.  
Its `.get()` method can temporarily access the target if it still exists:

```typescript
import { DWeakRef } from "@zephyr3d/base";

// Construct the weak reference directly from the referenced object
const weakTex = new DWeakRef(texRef.get());

const tex = weakTex.get();
if (tex) {
  // Use the texture safely
}
```

When the resource has been released, `weakTex.get()` will return `null`.

---

## Lifecycle Diagram

```
┌───────────────────────────────┐
│ new DRef(object)              │
└─────────────┬─────────────────┘
              │ (ref count +1)
              ▼
     Object alive and in use
              │
        Call DRef.dispose()
              │ (ref count -1)
              ▼
  If count > 0: object remains alive
  If count = 0:
     │
     ▼
Next frame:
  engine calls object.dispose() → free GPU resource
```

---

## Managed Resource Types in Zephyr3D

The following core engine objects are managed under the smart‑pointer lifecycle system:

| Category | Examples | Description |
|-----------|-----------|-------------|
| **Scene & Nodes** | `Scene`, `SceneNode` | Hierarchical scene structure |
| **Material System** | `Material` | Shader and pipeline state management |
| **Geometry** | `Primitive` | Vertex and index buffer data |
| **Animation System** | `AnimationClip`, `AnimationSet` | Animation and motion resources |
| **Low‑Level Graphics** | `Texture`, `Buffer`, `FrameBuffer` | GPU resource abstractions |

### Who holds scene nodes and scenes

- A parent node holds its children through `DRef`s. After `node.remove()` (which sets `parent` to `null`), a node that no other `DRef` holds is destroyed at the start of the next frame. To detach a node and attach it again a few frames later, hold it with a `DRef` of your own first; attaching it again within the same frame is fine.
- `getEngine().setRenderable(scene, layer)` also holds the scene through a `DRef`. When another scene takes its place, the old one is destroyed unless another `DRef` holds it. To switch back and forth between scenes, hold each with a `DRef` (tut-66 on the [Water](en/water.md) page does this).

---

## Objects Loaded Through the Resource Manager

Textures, models and other objects loaded through `getEngine().resourceManager` are not held by any `DRef` when you get them.

- Once you hand one to an engine object (assign it to a texture property of a material, or set it as a mesh's primitive or material), the engine holds it through a `DRef`. **Do not `dispose()` it yourself** after that, or you destroy a resource that is still in use.
- `fetchTexture()` returns the same cached instance for the same URL, so disposing it by hand affects everything that uses it.
- Only an object that was never handed to an engine object and is not held by a `DRef` has to be disposed by hand after use. It is safer to hold it with a `DRef` and release that when done.

Example:

```typescript
// Held by the material once assigned; do not dispose it by hand
material.albedoTexture = await getEngine().resourceManager.fetchTexture("stone.png");

// Held by you: wrap it in a DRef and release that reference when done
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("stone.png"));
// ...
texRef.dispose();
```

---

## Best Practices

1. **All cross‑frame or shared resources must be held via `DRef` or `DWeakRef`.**  
2. **Never directly call `.dispose()` on objects held by smart pointers or engine objects.**  
3. **Objects never handed to the engine and not held by a smart pointer must be disposed manually after use.**  
4. **Access resources through `.get()` — there are no `.value` or `.valid` properties.**

---

## Advantages and Features

- **Explicit, safe reference control**  
  `set()` and `dispose()` automatically update reference counts.  

- **Prevents premature destruction**  
  The engine releases resources only when no references remain.  

- **Frame‑delayed destruction**  
  Actual disposal occurs on the next frame to avoid mid‑frame hazards.  

- **Integrates user‑defined types**  
  Custom classes implementing `IDisposable` fit seamlessly into the same system.

---

## Summary

Zephyr3D’s `DRef` / `DWeakRef` system provides deterministic, reference‑count‑based lifetime management with delayed destruction.  
This approach shifts resource cleanup responsibility from individual objects to their managing smart pointers, ensuring both **safety** and **efficiency**.

- Always call the smart pointer’s `.dispose()`, not the resource’s.  
- The engine automatically calls the internal `dispose()` once all references are released.  
- Objects loaded through the resource manager but never handed to the engine or held by a `DRef` must be disposed manually after use.  
- Use `.get()` to safely access or verify an object’s existence.

