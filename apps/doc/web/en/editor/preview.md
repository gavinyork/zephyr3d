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

### 3. Splash Screen / Splash Background (Loading Screen)

- Purpose: Sets the loading screen shown while the application starts.
- `Splash Screen`: whether the engine's built-in loading screen is shown, **on by default**.
- `Splash Background`: the loading screen's background color (black by default), available while `Splash Screen` is on.
- Notes:
  - The loading screen is drawn by the web page itself and appears as soon as the page opens, with the engine logo, a progress bar and a status line. It covers downloading the engine, creating the rendering device, precompiling pipelines, prefetching assets, running the startup script and loading the startup scene, and fades out once the first frame of the startup scene is on screen;
  - The progress bar moves through stages: compiling pipelines when some have been recorded (see [Build and Deploy](en/editor/build-deploy.md)), prefetching the assets the startup scene uses, then loading the scene;
  - If startup fails (for example, the browser supports none of the selected rendering backends), the loading screen stays up and shows the error;
  - With `Splash Screen` off there is no loading screen; the page shows a black background while it starts. For a fully custom loading screen, turn it off and implement the `LoadingScreen` protocol yourself.

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
  2. The `onCreated` and `onAttached` lifecycle callbacks of the Startup Script will be **fully executed in order**;
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
> - If both are set, **Startup Script has higher priority**: its `onCreated` and `onAttached` callbacks run to completion before the Startup Scene is loaded;
> - Scripts attached to the Startup Scene can handle scene-level logic, or you can rely entirely on the Startup Script’s manual scene loading and control logic.

### 6. Targeted RHIs (Rendering Backends)

- Purpose: Defines which rendering backends (RHI, Rendering Hardware Interface) the application is allowed to use at runtime.
- Available options (multi-select):
  - `WebGL2`
  - `WebGPU`
- Selection logic at startup:
  - On startup, the application checks the **enabled options** in the following priority order:
    1. WebGPU  
    2. WebGL2  
  - The first backend in this order that is both **enabled** and **available** in the current browser/device environment will be used.
- Examples:
  - If you enable `WebGL2` and `WebGPU`:
    - On browsers that support WebGPU, the app will prefer WebGPU;
    - On browsers that only support WebGL2, it will fall back to WebGL2.
  - If you only enable `WebGL2`:
    - WebGL2 is used even if the environment supports WebGPU.


### 7. Other Settings

| Setting | Effect |
| --- | --- |
| `Enable MSAA` | Turn on multisample anti-aliasing |
| `Render Scale` | Rendering resolution relative to the page resolution; lower it to trade quality for performance |
| `Precompile Recorded Pipelines` | Precompile the recorded render pipelines at startup; see [Build and Deploy](en/editor/build-deploy.md) |
| `Morph Target Limit` / `Active Morph Upload Limit` | The most morph targets a mesh may have, and the most that can be active at once |
| `Max Skin Influences` | The most bones that may influence one vertex |
| `Additional packages` | Extra npm packages the project depends on |

---

## Starting a Live Preview

Once the project settings are done, start a preview with one of the three run buttons on the right of the toolbar. Each opens the running page in a **new browser tab**:

| Button | Effect |
| --- | --- |
| **Play** (play icon) | Runs the whole project from the `Startup Scene` / `Startup Script` in the project settings, the same way a build starts. It runs the **saved** files; unsaved changes are not included |
| **Preview** (eye icon) | Runs only the current scene, asking you to save it first |
| **Record Pipelines** (camera icon) | Same as Play, while recording the render pipelines the run uses so builds can precompile them. Read-only projects cannot record. See [Build and Deploy](en/editor/build-deploy.md) |

On the opened page all script logic runs and all associated animations play, so you can interact with the project, observe how it runs, and debug logic and animation.

> **Tips:**
>
> - While a preview window is open, the editor viewport pauses rendering to leave the GPU to the preview; it resumes when the preview closes.
> - After changing scripts, animations or project settings, save and run the preview again.
> - Project settings are under `Project > Project Settings...` in the main menu.

---

In the following video, we add a cube to a scene, create an auto-playing rotation animation around the Y axis, save this as the Startup Scene, and then run it via Live Preview:

<video src="https://cdn.zephyr3d.org/doc/assets/videos/play-project.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

