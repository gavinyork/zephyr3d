import type { VFS } from '@zephyr3d/base';
import { Observable, flushPendingDisposals } from '@zephyr3d/base';
import type { AbstractDevice, DeviceBackend } from '@zephyr3d/device';
import { InputManager } from './inputmgr';
import { Engine } from './engine';
import { getApp, setApp } from './api';
import { ScreenConfig } from './screen';

type appEventMap = {
  /**
   * Emitted when the drawing surface (canvas/device) is resized.
   *
   * @param width - New drawable width in device pixels.
   * @param height - New drawable height in device pixels.
   */
  resize: [width: number, height: number];
  /**
   * Emitted every frame with timing information.
   *
   * @param deltaTimeMs - Elapsed time since last frame in milliseconds.
   * @param elapsedTimeMs - Elapsed time since app start in milliseconds.
   */
  tick: [deltaTimeMs: number, elapsedTimeMs: number];
  /** Pointer/mouse and keyboard input events forwarded by the Application. */
  click: [evt: PointerEvent];
  dblclick: [evt: PointerEvent];
  pointerdown: [evt: PointerEvent];
  pointerup: [evt: PointerEvent];
  pointermove: [evt: PointerEvent];
  pointercancel: [evt: PointerEvent];
  pointerenter: [evt: PointerEvent];
  pointerleave: [evt: PointerEvent];
  pointerover: [evt: PointerEvent];
  pointerout: [evt: PointerEvent];
  wheel: [evt: WheelEvent];
  keydown: [evt: KeyboardEvent];
  keyup: [evt: KeyboardEvent];
  keypress: [evt: KeyboardEvent];
  drag: [evt: DragEvent];
  dragenter: [evt: DragEvent];
  dragleave: [evt: DragEvent];
  dragover: [evt: DragEvent];
  dragstart: [evt: DragEvent];
  dragend: [evt: DragEvent];
  drop: [evt: DragEvent];
};

/**
 * Creation options for Application.
 *
 * Provides the canvas, device backend, and optional runtime and device configuration.
 * @public
 */
export type AppOptions = {
  /**
   * Target canvas element to attach the rendering device to.
   */
  canvas: HTMLCanvasElement;
  /**
   * Device backend implementation to use for GPU creation (e.g., WebGL/WebGPU backend).
   */
  backend: DeviceBackend;
  /**
   * Whether to enable multi-sample anti-aliasing (MSAA) if supported by the backend.
   * Defaults to false.
   */
  enableMSAA?: boolean;
  /**
   * Device pixel ratio used when creating the device. Defaults to `window.devicePixelRatio` or 1.
   */
  pixelRatio?: number;
  /**
   * Options for the runtime scripting system.
   */
  runtimeOptions?: {
    /**
     * Virtual file system used to load scripts. Defaults to HttpFS at '.' if not provided.
     */
    VFS?: VFS;
    /**
     * Root directory for script files. Defaults to '/'.
     */
    scriptsRoot?: string;
    /**
     * Whether the application is running in editor mode. Should be true for user applications.
     */
    editorMode?: boolean;
    /**
     * Whether the runtime scripting system is enabled. Should be true for user applications.
     */
    enabled?: boolean;
    /**
     * Screen configuration
     */
    screen?: ScreenConfig;
  };
};

/**
 * Log severity levels.
 * @public
 */
export type LogMode = 'info' | 'warn' | 'error' | 'debug';

/**
 * Application
 *
 * Entry-point and lifecycle coordinator for the engine. Responsible for:
 * - Creating and owning the rendering device from a chosen backend.
 * - Managing the per-frame loop, including timing and viewport setup.
 * - Forwarding device/DOM input events via an observable event map.
 * - Hosting the runtime scripting system and input manager.
 *
 * Singleton:
 * - Only one instance may exist at a time. Access via `{@link getApp}`.
 *
 * Events:
 * - See `appEventMap` for all emitted events (resize, tick, pointer/keyboard/drag).
 *
 * Usage:
 * - Construct with `AppOptions`, await `ready()`, then call `run()` to start the loop.
 *
 * @public
 */
export class Application extends Observable<appEventMap> {
  private readonly _options: AppOptions;
  private _device: AbstractDevice;
  private readonly _inputManager: InputManager;
  private readonly _engine: Engine;
  private _ready: boolean;
  /**
   * Construct the Application singleton with the provided options.
   *
   * Throws if an instance already exists.
   *
   * @param opt - Application creation options (canvas, backend, and optional runtime/device settings).
   */
  constructor(opt: AppOptions) {
    super();
    if (getApp()) {
      throw new Error('It is not allowed to have multiple Application instances');
    }
    setApp(this);

    this._options = {
      backend: opt.backend,
      enableMSAA: opt.enableMSAA ?? false,
      pixelRatio: opt.pixelRatio ?? window.devicePixelRatio ?? 1,
      canvas: opt.canvas
    };
    this._inputManager = new InputManager(this);
    this._engine = new Engine(
      opt.runtimeOptions?.VFS,
      opt.runtimeOptions?.scriptsRoot,
      opt.runtimeOptions?.editorMode,
      opt.runtimeOptions?.enabled
    );
    if (opt.runtimeOptions?.screen) {
      this._engine.screen.configure(opt.runtimeOptions.screen);
    }
    this._ready = false;
  }
  /**
   * The input manager instance handling pointer/keyboard event routing.
   */
  get inputManager(): InputManager {
    return this._inputManager;
  }
  /**
   * Get the instanceof {@link Engine}.
   */
  get engine(): Engine {
    return this._engine;
  }
  /**
   * The (sanitized) options used to create this application.
   *
   * Note: Defaults are applied for `enableMSAA` and `pixelRatio` if omitted.
   */
  get options(): AppOptions {
    return this._options;
  }
  /**
   * The initialized rendering device.
   *
   * Available after `await ready()`.
   */
  get device(): AbstractDevice {
    return this._device;
  }
  /**
   * Convenience accessor for the device type name provided by the backend.
   */
  get deviceType(): string {
    return this._options.backend.typeName();
  }
  /**
   * Set keyboard focus to the device's canvas element.
   */
  focus() {
    this._device.canvas.focus();
  }
  /**
   * Initialize the rendering device and start input processing.
   *
   * @throws If device creation fails.
   */
  async ready() {
    if (!this._ready) {
      this._device = await this._options.backend.createDevice(this._options.canvas, {
        dpr: this._options.pixelRatio,
        msaa: !!this._options.enableMSAA
      });
      if (!this._device) {
        throw new Error('App.init(): create device failed');
      }
      this._device.canvas.focus();
      await this._engine.init();
      this._inputManager.start();
      this._device.on('resize', (width, height) => {
        this.dispatchEvent('resize', width, height);
      });
      this._ready = true;
    }
  }
  /**
   * Render a single frame.
   *
   * Steps:
   * - Flushes pending disposals from the previous frame.
   * - Clears device state (framebuffer, viewport, scissor).
   * - Queries frame timing from the device (`elapsedFrame`, `elapsedOverall`).
   * - Updates the runtime manager (scripting/behaviors).
   * - Emits `tick` with delta/elapsed times.
   *
   * Safe to call manually; also used by the run loop.
   */
  frame() {
    // Processes all pending disposals from the previous frame.
    flushPendingDisposals();
    if (this._ready) {
      this.device.setFramebuffer(null);
      this.device.setViewport(null);
      this.device.setScissor(null);
      const dt = this.device.frameInfo.elapsedFrame;
      const elapsed = this.device.frameInfo.elapsedOverall;
      this.dispatchEvent('tick', dt, elapsed);
      this._engine.update(dt * 0.001, elapsed * 0.001);
      this._engine.render();
    }
  }
  /**
   * Start the application's render loop.
   *
   * Uses the device's internal scheduling (`device.runLoop`) to repeatedly call `frame()`.
   */
  run() {
    this.device.runLoop(() => {
      this.frame();
    });
  }
  /**
   * Stop the application's render loop.
   *
   * Uses `device.exitLoop()` to end the scheduling started by `run()`.
   */
  stop() {
    this.device.exitLoop();
  }
}
