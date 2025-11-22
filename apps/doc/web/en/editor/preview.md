# Live Preview

The Zephyr3D editor provides a **Live Preview** feature that lets you run the current project in the browser and see how script logic and animation actually behave at runtime.

---

## What Live Preview Does

- **All script logic** (for example, game logic and interaction logic written in TypeScript)
- **All animation logic** (including keyframe animation, skeletal animation, vertex animation, etc.)

are only executed and visible **while the preview is running**:

- In the static editor state, none of this logic is executed;
- Script behavior, animation playback, and user interaction in the scene must be validated through Live Preview.

In other words: **to check the “real runtime behavior”, you must use Live Preview.**

---

## Project Settings Before Preview

Before starting a preview, you should configure the basic runtime parameters of the project.  
The **Project Settings** panel mainly includes the following options:

### 1. Title

- Purpose: Sets the window title of the running web page.
- Default: The current project name.
- Recommendation:
  - Use a product name, demo name, or internal version label, for example: `Zephyr3D Terrain Demo`.

### 2. Favicon

- Purpose: Sets the small icon shown on the left side of the browser tab.
- Required: **No (optional)**.
- Notes:
  - If not set, the browser default icon or a system fallback will be used;
  - A square PNG/ICO/SVG is recommended.

### 3. Splash Screen

- Purpose: Sets the splash screen shown when the application starts (for example, logo screen, loading page).
- Required: **No (optional)**.
- Notes:
  - Suitable for showing project logo, version info, or loading hints;
  - If not set, the application may directly enter the scene or use a default loading view.

### 4. Startup Scene

- Purpose: Specifies which scene to load and run first when the application starts.
- Relationship with Startup Script: **At least one of Startup Scene or Startup Script must be provided**.
- Notes:
  - If only a Startup Scene is set and no Startup Script is specified, the app will load this scene and directly enter it;
  - This is typically used for scene-driven demos, static/semi-static showcases, level previews, etc.

### 5. Startup Script

- Purpose: Specifies the script entry that runs first when the application starts.
- Relationship with Startup Scene: **At least one of Startup Scene or Startup Script must be provided**.

#### Priority and Execution Order: Startup Script vs. Startup Scene

- When **both Startup Script and Startup Scene are set**:
  1. When the app starts, it will **run the Startup Script first**;
  2. The `onCreate` and `onAttached` lifecycle callbacks of the Startup Script will be **fully executed in order**;
  3. Only after these callbacks have completed will the engine load the specified **Startup Scene**;
  4. Once the Startup Scene has finished loading:
     - Any scripts bound to the Startup Scene (as **attached scripts** on scene nodes) will run with their normal lifecycles;
     - You can split scene-specific logic into these attached scripts so they work together with the Startup Script.

- When **only Startup Script is set and Startup Scene is left empty**:
  - The engine will **not** automatically load any scene;
  - You can **manually load scenes** inside the Startup Script, for example:
    - Decide which scene to load based on conditions;
    - Load multiple scenes step by step (main scene + overlay UI scene, etc.);
    - Implement more flexible startup flows and scene management.

> **Constraints:**
>
> - `Startup Scene` and `Startup Script` — **at least one of them must be configured**;
> - If both are set, **Startup Script has higher priority**: its `onCreate` and `onAttached` callbacks run to completion before the Startup Scene is loaded;
> - Scripts attached to the Startup Scene can handle scene-level logic, or you can rely entirely on the Startup Script’s manual scene loading and control logic.

### 6. Target RHIs (Rendering Backends)

- Purpose: Defines which rendering backends (RHI, Rendering Hardware Interface) the application is allowed to use at runtime.
- Available options (multi-select):
  - `WebGL`
  - `WebGL2`
  - `WebGPU`
- Selection logic at startup:
  - On startup, the application checks the **enabled options** in the following priority order:
    1. WebGPU  
    2. WebGL2  
    3. WebGL
  - The first backend in this order that is both **enabled** and **available** in the current browser/device environment will be used.
- Examples:
  - If you enable `WebGL2` and `WebGPU`:
    - On browsers that support WebGPU, the app will prefer WebGPU;
    - On browsers that only support WebGL2, it will fall back to WebGL2.
  - If you only enable `WebGL`:
    - WebGL is used even if the environment supports WebGPU or WebGL2.

---

## Starting a Live Preview

Once the project settings are configured, you can start a Live Preview via the **Play button** on the toolbar:

1. In the editor toolbar, locate and click the **Play** button;
2. The editor will open a **new browser window or tab** to run the project;
3. In the newly opened page:
   - The project will start according to the configured `Startup Scene` / `Startup Script`;
   - All script logic will begin to execute;
   - All related animations will start running;
   - You can interact with the scene, observe runtime behavior, and debug both logic and animation.

> **Tips:**
>
> - After changing scripts, animations, or project settings, click the **Play** button again to launch a fresh preview with the new configuration;
> - You can keep both the editor and the preview page open: edit in the editor, then restart the preview page to validate the changes.

---

In the following video, we add a cube to a scene, create an auto-playing rotation animation around the Y axis, save this as the Startup Scene, and then run it via Live Preview:

<video src="https://cdn.zephyr3d.org/doc/assets/videos/play-project.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

