
# Script Structure and Lifecycle

The editor has built-in support for **TypeScript scripts**.  
You can create, edit, and run scripts in the Assets panel to implement project startup procedures, scene logic, node interactions, animations, and various utility functions.

Overall, scripts are divided into three categories by purpose:

- **Attached Scripts**: Scripts mounted to scenes or scene nodes with complete lifecycle callbacks
- **Helper Scripts**: Provide utility functions, data structures, business logic, etc., imported by other scripts

---

## Basic Script Features

In this engine, scripts have the following common characteristics:

### 1. TypeScript Asset Scripts

The editor supports creating `.ts` script files directly in the **Assets** panel, where you can:

- Create new TypeScript files
- Write and modify scripts in the built-in editor
- Save and package scripts as resources with your project

The path and naming of script files serve as the basis for subsequent imports and bindings.

### 2. All Scripts Must Be ES Modules

All scripts **must** use the ES Module specification:

- Use `import` / `export` to organize code
- Don't rely on traditional global variables or script loading order
- Functions can be split into multiple modules for reuse

Example:

```ts  
// assets/scripts/math-utils.ts  
export function clamp(x: number, min: number, max: number): number {  
  return Math.max(min, Math.min(max, x));  
}  
```

### 3. All Scripts Can Import the zephyr3d Library

Whether it's a startup script, attached script, or helper script, all can directly import engine APIs from the `zephyr3d` library to manipulate scenes, nodes, materials, cameras, etc.

```ts
import { SceneNode, /* ... other types or classes you need */ } from "@zephyr3d/scene";
```

### 4. Support for Third-Party `npm` Packages

The editor supports importing `npm` packages into your project (via `https://esm.sh`).
Once an `npm` package is imported, it can be used in scripts.

---

## Script Categories and Use Cases

### 1. Attached Scripts

Attached scripts are mounted to `Scene` or `Node` objects in the scene to describe their runtime behavior logic.

You can use attached scripts to implement:

- Camera control (rotation, zoom, target following, etc.)
- Character/object movement, animation, and state machines
- Input response (keyboard, mouse, touch, gamepad)
- Triggers, interaction logic (buttons, switches, UI interactions, etc.)

#### 1.1 Basic Requirements

An attached script needs to:

- Be an ES module (using import / export)
- Default export a class
- Implement engine-defined lifecycle methods (with fixed names)

**Typical Structure**:

```ts
// assets/scripts/rotate.ts
import type { SceneNode } from "@zephyr3d/scene";
import { RuntimeScript } from "@zephyr3d/scene";

export default class RotateScript extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  private speed: number;
  private rotationY: number;

  constructor() {
    // Construction phase: instance just created, not yet bound to object
    this.speed = 2;
    this.rotationY = 0;
  }

  async onCreated(): Promise<void> {
    // Initialization logic: can be async, e.g., loading config, resources
  }

  onAttached(target: SceneNode): void {
    // Bound to specific object
    this.target = target;
  }

  onUpdate(dt: number): void {
    // Update rotation every frame
    this.rotationY += this.speed * dt;
    this.target.rotation.fromEulerAngle(0, this.rotationY, 0);;
  }

  onDetached(): void {
    // Called when unbound from object
    this.target = undefined;
  }

  onDestroy(): void {
    // Called before instance destruction: release resources, cancel subscriptions, etc.
  }
}
```

> **Note**
>
> Since the script lifecycle does not exceed the associated object's lifecycle, there's no need to use weak references to hold the associated node. Strong references should also not be used, as this would cause circular references between the script and the associated node, preventing release and causing memory leaks.

#### 1.2 Binding Method

The general workflow for using attached scripts in the editor:

1. Create a new script file in the Assets panel (e.g., rotate.ts)
2. Implement and export a class in the script (e.g., RotateScript)
3. In the editor:
    - Select a Scene or Node
    - Add a script component in the Script section of the Properties panel
    - Select the corresponding script file and exported class name
4. When the scene runs, the engine will automatically:
    - Create script instances
    - Call lifecycle callbacks (constructor → onCreated → onAttached → onUpdate …)

#### 1.3 One Attached Script Can Bind Multiple Objects

**Important Feature**:

A single attached script can be bound to multiple objects. If multiple objects have the same or similar behavior logic, you can reuse the same script class:

- Avoid duplicating the same logic
- Facilitate unified maintenance of behavior
- The script can perform batch operations on all bound objects internally, improving performance to some extent

Two common patterns:

1. One instance per object (most common)

```ts
// Simple example: script handles a single target object
export default class RotateScript extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  private speed: number;
  private rotationY: number;

  constructor() {
    this.speed = 2;
    this.rotationY = 0;
  }

  onAttached(target: SceneNode) {
    this.target = target;
  }

  onUpdate(dt: number) {
    this.rotationY += this.speed * dt;
    this.target.rotation.fromEulerAngle(0, this.rotationY, 0);;
  }

  onDetached() {
    this.target = null;
  }
}
```

2. One script manages multiple objects (shared behavior + batch updates)

For certain scenarios (like dozens of particle nodes, groups of moving enemies, etc.), you can use your own management script to batch manage these objects, reducing redundant logic calls:

**Example**:

```ts
// Simple example: script handles multiple target objects
export default class RotateScript extends RuntimeScript<SceneNode> {
  // Store multiple objects associated with this script
  private targets: Set<SceneNode>;
  private speed: number;
  private rotationY: number;

  constructor() {
    this.speed = 2;
    this.rotationY = 0;
    this.targets = new Set();
  }

  onAttached(target: SceneNode) {
    // Add associated object
    this.targets.add(target);
  }

  onUpdate(dt: number) {
    // Batch update
    this.rotationY += this.speed * dt;
    for (const target of this.targets) {
      target.rotation.fromEulerAngle(0, this.rotationY, 0);;
    }
  }

  onDetached(target: SceneNode) {
    // Remove associated object
    this.targets.delete(target);
  }
}

```

#### 1.4 Startup Script

Attached scripts can be set as the project's `startup script`. This script will be bound to a `null` object after engine initialization is complete and before the startup scene is loaded.

### 2. Helper Scripts

Helper scripts don't directly participate in startup or binding but provide reusable utility logic that other scripts import. Suitable for:

- Utility functions, mathematical/geometric calculations
- Common business logic (AI, pathfinding, state machines, etc.)
- Configuration and constants
- Network request encapsulation, data transformation, etc.

**Characteristics**:

- Don't need to implement any lifecycle interfaces
- Don't mount directly to scenes or nodes
- Only used by other scripts via import

**Example**:

```ts
// assets/scripts/utils/math-utils.ts
import { Vector3 } from "@zephyr3d/base";

export function moveTowards(
  current: Vector3,
  target: Vector3,
  maxDistanceDelta: number
): Vector3 {
  const toVector = Vector3.sub(target, current);
  const distance = toVector.magnitude();
  if (distance <= maxDistanceDelta) {
    return target.clone();
  }
  return Vector3.add(current, Vector3.scale(toVector, maxDistanceDelta / distance));
}
```

Used by other scripts:

```ts
// assets/scripts/follow-target.ts
import type { SceneNode } from "@zephyr3d/scene";
import { moveTowards } from "./utils/math-utils";

export default class FollowTargetScript extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  private follow?: DWeakRef<SceneNode>;
  private speed = 5.0;

  onAttached(node: SceneNode) {
    this.target = node;
    this.follow = new DWeakRef();
  }

  setFollowNode(node: SceneNode) {
    this.follow.set(node);
  }

  onUpdate(dt: number) {
    if (!this.follow.get()) {
      return;
    }
    this.target.position = moveTowards(this.target.position, this.follow.get().position, this.speed * dt);
  }
}
```

---

## Attached Script Lifecycle

Attached scripts have a clear set of lifecycle callbacks that allow you to execute different logic at different stages. The typical lifecycle of an attached script instance is as follows:

- `Constructor`: Called when instance is created
- `onCreated()`: Initialization method, supports async
- `onAttached()`: Called after script is attached to object
- `onUpdate()`: Called every frame for updates
- `onDetached()`: Called when script is detached from object
- `onDestroy()`: Called before instance destruction

Except for the constructor, all other methods are optional; you can implement only some of them as needed.

### 1. Constructor

  - **When called**: When the associated object is created, the engine loads this script and calls the constructor to create the script instance. At this point, the script is not yet associated.
  - **Parameters**: Must be implemented as a parameterless constructor.

**Suitable for**:

  - Initializing member fields (default values, cached objects, etc.)

**Not suitable for**:

  - Accessing scenes or nodes (not yet onAttached)
  - Initiating complex async flows (recommended in onCreated() instead)

**Example**:

```ts
export class ExampleScript {
  private speed: number;
  constructor() {
    this.speed = 1.0;
  }
}
```

### 2. onCreated()

  - **When called**: Called after instance creation, supports async. This is the recommended main entry point for initialization (especially async initialization).

**Suitable for**:

  - Async loading of resources (textures, models, config files, etc.)
  - Initializing global or shared state independent of specific objects
  - Registering global events/message buses, etc.

**Example**:

```ts
async onCreated(): Promise<void> {
  const res = await fetch("https://example.com/config.json");
  this.config = await res.json();
}
```

If async is not needed, you can also write onCreated as a regular synchronous function.

### 3. onAttached()

  - **When called**: Called after the script is attached to a specific object (Scene or Node).

**Suitable for**:

  - Saving references to the object (target scene or node)
  - Initializing state dependent on the object itself (initial position, scale, component lookup, etc.)
  - Registering object-level events (e.g., collision, click callbacks)
  - Performing async initialization related to the associated object

**Example**:

```ts
import type { SceneNode } from "@zephyr3d/scene";

onAttached(target: SceneNode): void {
  this.target = target;
  this.target.position.set(0, 1, 0);
}
```

### 4. onUpdate()

  - **When called**: Called once per frame after successfully associating with an object.
  - Receives a dt parameter representing the time interval (in seconds) between the current frame and the previous frame.

**Suitable for**:

  - Animation, movement, rotation, and other time-related logic
  - Real-time input detection and response
  - State machine updates, behavior tree ticks, etc.

**Example**:

```ts
onUpdate(dt: number): void {
  if (!this.target || !(this.target instanceof SceneNode)) return;
  // Simple rotation example
  this.target.rotation.y += this.rotateSpeed * dt;
}
```

**Performance tips**:

- Avoid performing large synchronous blocking operations in onUpdate (e.g., massive calculations, synchronous network requests)

### 5. onDetached()

  - **When called**: Called when the script is unbound from the object (e.g., script component is removed, node is destroyed, etc.).

**Suitable for**:

  - Canceling event subscriptions (to avoid memory leaks)
  - Clearing references to the object
  - Undoing modifications that only take effect during binding (e.g., temporary materials, states)

**Example**:

```ts
onDetached(): void {
  console.log("Script detached from object");
  this.target = undefined;
}
```

### 6. onDestroy()

  - **When called**: Called before the script instance is about to be destroyed. Even if the script has been unbound from the object, this callback will still be executed before destruction.

**Suitable for**:

  - Releasing resources held by the script (cached textures, models, handles, etc.)
  - Terminating incomplete async tasks (e.g., polling, timers)
  - Unregistering globally registered listeners/services, etc.

**Example**:

```ts
onDestroy(): void {
  if (this.timerId != null) {
    clearInterval(this.timerId);
    this.timerId = null;
  }
}
```

## Example

Below is a more complete attached script example that can be bound to multiple scene nodes to implement movement animation:

```ts
// assets/scripts/move.ts
import type { SceneNode } from "@zephyr3d/scene";
import { Vector3 } from "@zephyr3d/base";
import { RuntimeScript } from "@zephyr3d/scene";

export default class extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  private speed: number;
  private direction: Vector3;

  constructor() {
    // Construction phase: only initialize simple fields
    this.speed = 2.0;
    this.direction = new Vector3();
  }

  async onCreated(): Promise<void> {
    console.log("RotateScript created");
  }

  onAttached(target: SceneNode): void {
    // Save associated object
    this.target = target;

    if (target instanceof Node) {
      // Place node at starting position
      target.position.set(0, 0, 0);
    }
  }

  onUpdate(dt: number): void {
    // Move uniformly along the direction vector
    this.target.position.addBy(Vector3.scale(this.direction, this.speed * dt));
  }

  onDetached(): void {
    console.log("RotateScript detached");
    this.target = undefined;
  }

  onDestroy(): void {
    console.log("RotateScript destroyed");
    // Release resources or globally unregister here
  }
}
```

In the editor, bind this script to multiple node objects, and these nodes will all move according to the same logic.
