
# Script Structure and Lifecycle

The editor has built-in support for **TypeScript scripts**.  
You can create, edit, and run scripts in the Assets panel to implement project startup procedures, scene logic, node interactions, animations, and various utility functions.

> The code on this page is illustrative and leaves out some imports.

Overall, scripts are divided into two categories by purpose:

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
  // Field initialisers set the initial values; no constructor is needed
  private speed = 2;
  private rotationY = 0;

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
    this.target?.rotation.fromEulerAngle(0, this.rotationY, 0);
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
> When the host is destroyed, the engine calls the script's `onDetached()` before destroying the script, so keeping the host in a plain field as above is safe, as long as `onDetached()` clears it. Do not hold the host with a `DRef`: it adds to the host's reference count, so the host can no longer be destroyed automatically.
>
> If you write a constructor of your own, its first line must call `super()`, or instantiation throws a `ReferenceError`.

#### 1.2 Binding Method

The general workflow for using attached scripts in the editor:

1. In the Assets panel, right-click in the `/assets` folder and choose `Create New > Typescript` to create a script file (e.g., rotate.ts); see [Create a Script](en/editor/create-script.md)
2. Implement a class extending `RuntimeScript` in the script and make it the **default export**
3. In the editor:
    - Select a Scene or Node
    - Drag the script file from the Assets panel onto "Drop a script here to attach" in the **Scripts** section at the bottom of the Inspector
    - An object can have several scripts; the buttons in the list reorder or remove them
    - With a script selected in the list, the **Config** section below edits the parameters it declares with `@scriptProp` (see below)
4. When the scene runs, the engine will automatically:
    - Create a script instance for each attachment
    - Assign the Config values to the instance
    - Call lifecycle callbacks (onCreated → onAttached → onUpdate …)

#### 1.3 Configurable Parameters

Fields declared with the `@scriptProp` decorator appear in the Config section, can be set per object in the editor, and are saved with the scene. Their values are assigned to the instance before `onCreated()`.

```ts
import { RuntimeScript, scriptProp } from '@zephyr3d/scene';
import type { SceneNode } from '@zephyr3d/scene';

export default class extends RuntimeScript<SceneNode> {
  @scriptProp({ type: 'float', label: 'Speed', default: 1, minValue: 0 })
  speed = 1;

  @scriptProp({ type: 'asset', label: 'Texture', mimeTypes: ['image/png', 'image/jpeg'] })
  texture = '';

  @scriptProp({ type: 'node', label: 'Target Node', sceneNode: { kind: 'node' } })
  targetNode = '';
}
```

Supported types include `bool`, `int`, `float`, `vec2`/`vec3`/`vec4`, `rgb`/`rgba`, `string`, `asset`, `node` and `object_array`, with optional `label`, `group`, value ranges and enumerations. The template generated for a new script includes these examples.

#### 1.4 One Script Class Can Bind Multiple Objects

The same script class can be attached to several objects to reuse the same behaviour. By default **each attachment creates a new script instance** that serves one object, so the script keeps a single host (as in the example above).

When one instance should manage several objects (say, updating a swarm of enemies in one pass), write the script as a singleton whose constructor returns one shared instance. `onCreated()` then runs once, while `onAttached()` and `onDetached()` run once per object:

```ts
let shared: SwarmScript | null = null;

export default class SwarmScript extends RuntimeScript<SceneNode> {
  private targets = new Set<SceneNode>();
  private rotationY = 0;

  constructor() {
    super();
    // With a shared instance already made, return it: every attachment uses the same instance
    if (shared) {
      return shared;
    }
    shared = this;
  }

  onAttached(target: SceneNode) {
    this.targets.add(target);
  }

  onUpdate(dt: number) {
    this.rotationY += 2 * dt;
    for (const target of this.targets) {
      target.rotation.fromEulerAngle(0, this.rotationY, 0);
    }
  }

  onDetached(target: SceneNode) {
    this.targets.delete(target);
  }

  onDestroy() {
    shared = null;
  }
}
```

#### 1.5 Startup Script

Attached scripts can be set as the project's `startup script`. This script will be bound to a `null` object after engine initialization is complete and before the startup scene is loaded.

With only a startup script and no startup scene, the script has to load and show a scene itself:

```ts
import { getEngine, RuntimeScript } from "@zephyr3d/scene";

export default class extends RuntimeScript<null> {
  async onAttached() {
    const scene = await getEngine().loadSceneFromFile("/assets/main.zscn");
    if (scene) {
      getEngine().setRenderable(scene, 0);
    }
  }
}
```

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
  const distance = toVector.magnitude;
  if (distance <= maxDistanceDelta) {
    return target.clone();
  }
  return Vector3.add(current, Vector3.scale(toVector, maxDistanceDelta / distance));
}
```

Used by other scripts:

```ts
// assets/scripts/follow-target.ts
import { DWeakRef } from "@zephyr3d/base";
import { RuntimeScript } from "@zephyr3d/scene";
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
    // The followed node is someone else's, so it is held with a DWeakRef: get() returns null once
    // it is destroyed, and the reference does not keep it alive
    if (!this.target || !this.follow?.get()) {
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
- `onAttached(host)`: Called after script is attached to object
- `onUpdate(dt, elapsed)`: Called every frame
- `onFixedUpdate(fixedDt)`: Called before each fixed physics step, only while the scene has a physics world; put logic that must run at the physics rate, such as applying forces, here (see [Physics Scripting](en/physics-scripting.md))
- `onLateUpdate(dt)`: Called every frame after scene nodes have updated and physics has stepped and written poses back; use it to read this frame's physics results, such as pointing a camera at a moving body
- `onDetached(host)`: Called when script is detached from object
- `onDestroy()`: Called before instance destruction

All of these are optional; implement only the ones you need. The constructor can be left out too.

### 1. Constructor

  - **When called**: When the associated object is created, the engine loads this script and calls the constructor to create the script instance. At this point, the script is not yet associated.
  - **Parameters**: Must be implemented as a parameterless constructor whose first line calls `super()`. Field initialisers are usually enough, with no constructor at all.

**Suitable for**:

  - Initializing member fields (default values, cached objects, etc.)

**Not suitable for**:

  - Accessing scenes or nodes (not yet onAttached)
  - Initiating complex async flows (recommended in onCreated() instead)

**Example**:

```ts
export default class ExampleScript extends RuntimeScript<SceneNode> {
  private speed: number;
  constructor() {
    super();
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
  this.target.position.setXYZ(0, 1, 0);
}
```

### 4. onUpdate()

  - **When called**: Called once per frame after successfully associating with an object.
  - `dt` is the time (in seconds) between the current frame and the previous one, and `elapsed` the total time (in seconds) since the script started running.

**Suitable for**:

  - Animation, movement, rotation, and other time-related logic
  - Real-time input detection and response
  - State machine updates, behavior tree ticks, etc.

**Example**:

```ts
onUpdate(dt: number): void {
  if (!this.target) return;
  // rotation is a quaternion, so .y cannot be changed directly; set it from Euler angles instead
  this.angle += this.rotateSpeed * dt;
  this.target.rotation.fromEulerAngle(0, this.angle, 0);
}
```

**Performance tips**:

- Avoid performing large synchronous blocking operations in onUpdate (e.g., massive calculations, synchronous network requests)

**Reading input**: in `onUpdate`, `getInput()` (from `@zephyr3d/scene`) queries keyboard, mouse and gamepad state per frame.

> **Keyboard focus**: keyboard events are only listened for on the rendering canvas. When HTML buttons are laid over the page, clicking one moves focus away from the canvas, and keyboard input stops working afterwards. Call `event.preventDefault()` in the button's `pointerdown` handler so it does not take focus, or call `getApp().focus()` after handling the click to give focus back to the canvas.

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
import { RuntimeScript, scriptProp } from "@zephyr3d/scene";

export default class extends RuntimeScript<SceneNode> {
  private target?: SceneNode;
  // Can be set per node in the editor's Config section
  @scriptProp({ type: 'float', label: 'Speed', default: 2, minValue: 0 })
  speed = 2;
  private direction = new Vector3(1, 0, 0);

  async onCreated(): Promise<void> {
    console.log("MoveScript created");
  }

  onAttached(target: SceneNode): void {
    // Save the associated object and put it at the starting position
    this.target = target;
    target.position.setXYZ(0, 0, 0);
  }

  onUpdate(dt: number): void {
    // Move uniformly along the direction vector
    this.target?.position.addBy(Vector3.scale(this.direction, this.speed * dt));
  }

  onDetached(): void {
    console.log("MoveScript detached");
    this.target = undefined;
  }

  onDestroy(): void {
    console.log("MoveScript destroyed");
    // Release resources or globally unregister here
  }
}
```

In the editor, bind this script to multiple node objects: each node gets its own script instance and moves by the same logic, with a speed that can be set per node.

The scripts' `console.log` output appears in the browser developer tools of the preview page. The editor has no hot reload: run the preview again after changing a script.
