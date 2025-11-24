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
Developers should **never call a resource object’s `.dispose()` directly**.  
Instead, they must release ownership by calling the smart pointer’s `.dispose()`.

---

## Internal Lifecycle Logic

1. **`DRef.set(obj)`** — binds the object and increases its reference count.  
2. **`DRef.dispose()`** — releases ownership and decreases the reference count.  
3. When all `DRef` instances have been disposed (count = 0), the engine **automatically calls the object’s `dispose()` method during the next frame** to destroy the underlying GPU resource.

This design ensures that no GPU resource is freed during an active rendering process, preventing state corruption and runtime instability.

> ⚠️ Calling a resource’s `.dispose()` directly bypasses reference tracking  
> and may leave other pointers referencing a destroyed object.  
> Always manage lifetime through `DRef.dispose()`.

---

## IDisposable Interface and Disposable Base Class

All GPU or system resources in Zephyr3D implement the `IDisposable` interface:

```typescript
interface IDisposable {
  dispose(): void;
}
```

The `dispose()` method defines the cleanup logic executed when the engine releases the object.  
A typical resource class inherits from `Disposable` and implements `onDispose()`:

```typescript
import { Disposable } from "zephyr3d/core";

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

> Developers should **not** manually call `myResource.dispose()`.  
> Under smart pointer management, the engine automatically invokes it once all `DRef`s are released.

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

`.get()` returns the currently bound object, or `null` if it has already been destroyed.

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
const weakTex = texRef.toWeakRef();

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

---

## Resource Objects Loaded via the Resource Module

Objects obtained through the `Resource` module (textures, shaders, models, etc.) are **plain objects** —  
they are **not automatically managed by smart references**.

This means:
- These objects can safely be wrapped in a `DRef` or `DWeakRef` for lifetime management;  
- If not managed by a smart pointer, the developer **must explicitly call the object’s `.dispose()`** after use to release the resource.

Example:

```typescript
// Plain resource usage
const tex = await getEngine().resourceManager.fetchTexture("stone.png");
...
tex.dispose();  // Manual cleanup if unmanaged

// Managed usage
const texRef = new DRef(await getEngine().resourceManager.fetchTexture("stone.png"));
// Later, release by texRef.dispose()
```

---

## Best Practices

1. **All cross‑frame or shared resources must be held via `DRef` or `DWeakRef`.**  
2. **Never directly call `.dispose()` on objects managed by smart pointers.**  
3. **Unmanaged temporary resources must be cleaned up manually using `.dispose()`.**  
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
- Resources loaded via the `Resource` module must be disposed manually if unmanaged.  
- Use `.get()` to safely access or verify an object’s existence.

Through this unified model, Zephyr3D achieves near‑native engine reliability and predictable resource cleanup behavior entirely within the JavaScript environment.
