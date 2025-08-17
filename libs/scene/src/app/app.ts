import { Observable, VFS, flushPendingDisposals } from '@zephyr3d/base';
import type { AbstractDevice, DeviceBackend } from '@zephyr3d/device';
import { InputManager } from './inputmgr';
import { RuntimeManager } from '@zephyr3d/runtime';

type appEventMap = {
  resize: [width: number, height: number];
  tick: [deltaTimeMs: number, elapsedTimeMs: number];
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
 * The creation options for Application
 * @public
 */
export type AppOptions = {
  /** The canvas element */
  canvas: HTMLCanvasElement;
  /** The backend that will be used to create the rendering device */
  backend: DeviceBackend;
  /** Whether to enable MSAA */
  enableMSAA?: boolean;
  /** The device pixel ratio */
  pixelRatio?: number;
  /** Options for runtime scripting system */
  runtimeOptions?: {
    /** VFS for reading script files, default is HttpFS at '.' */
    VFS?: VFS;
    /** Root directory for script files, default is '/' */
    scriptsRoot?: string;
    /** Whether application is running in editor mode, should always be true for user application */
    editorMode?: boolean;
    /** Wether enable runtime scripting system, should always be true for user application */
    enabled?: boolean;
  };
};

/**
 * Log mode
 * @public
 */
export type LogMode = 'info' | 'warn' | 'error' | 'debug';

/**
 * Logger interface
 * @public
 */
export interface Logger {
  log(text: string, mode?: LogMode): void;
}

/**
 * Application class
 *
 * @remarks
 * This is the entry point of your application.
 * The Application is responsible for initializing the rendering device
 * and doing the rendering loop.
 * The Application can not be created more than once. You can get the
 * instance by calling the 'Application.instance' static method.
 *
 * @public
 */
export class Application extends Observable<appEventMap> {
  private readonly _options: AppOptions;
  private _device: AbstractDevice;
  private readonly _inputManager: InputManager;
  private readonly _runtimeManager: RuntimeManager;
  private _ready: boolean;
  private _logger: Logger;
  private static _instance: Application;
  /**
   * Creates an instance of Application
   * @param opt - The creation options
   */
  constructor(opt: AppOptions) {
    super();
    if (Application._instance) {
      throw new Error('It is not allowed to have multiple Application instances');
    }
    Application._instance = this;
    this._options = {
      backend: opt.backend,
      enableMSAA: opt.enableMSAA ?? false,
      pixelRatio: opt.pixelRatio ?? window.devicePixelRatio ?? 1,
      canvas: opt.canvas
    };
    this._inputManager = new InputManager(this);
    this._runtimeManager = new RuntimeManager(
      opt.runtimeOptions?.VFS,
      opt.runtimeOptions?.scriptsRoot,
      opt.runtimeOptions?.editorMode,
      opt.runtimeOptions?.enabled
    );
    this._ready = false;
    this._logger = {
      log(text: string, mode?: LogMode) {
        if (mode === 'warn') {
          console.warn(text);
        } else if (mode === 'error') {
          console.error(text);
        } else if (mode === 'debug') {
          console.debug(text);
        } else if (mode === 'info') {
          console.info(text);
        } else {
          console.log(text);
        }
      }
    };
  }
  /** The input manager instance */
  get inputManager(): InputManager {
    return this._inputManager;
  }
  /** The runtime manager instance */
  get runtimeManager(): RuntimeManager {
    return this._runtimeManager;
  }
  /** The options that was used to create the application */
  get options(): AppOptions {
    return this._options;
  }
  /** Gets the singleton instance of the application */
  static get instance(): Application {
    return this._instance;
  }
  /** The rendering device that was initialized by the application */
  get device(): AbstractDevice {
    return this._device;
  }
  /** Gets the device type */
  get deviceType(): string {
    return this._options.backend.typeName();
  }
  /** The logger object */
  get logger(): Logger {
    return this._logger;
  }
  set logger(val: Logger) {
    this._logger = val;
  }
  /** Set focus */
  focus() {
    this._device.canvas.focus();
  }
  /** Wait until the application is ready. */
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
      this._inputManager.start();
      this._device.on('resize', (width, height) => {
        this.dispatchEvent('resize', width, height);
      });
      this._ready = true;
    }
  }
  /** Render one frame */
  frame() {
    // Processes all pending disposals from the previous frame.
    flushPendingDisposals();
    if (this._ready) {
      this.device.setFramebuffer(null);
      this.device.setViewport(null);
      this.device.setScissor(null);
      const dt = this.device.frameInfo.elapsedFrame;
      const elapsed = this.device.frameInfo.elapsedOverall;
      this._runtimeManager.update(dt, elapsed);
      this.dispatchEvent('tick', dt, elapsed);
    }
  }
  /** Start running the rendering loop */
  run() {
    this.device.runLoop(() => {
      this.frame();
    });
  }
  /** Stop running the rendering loop */
  stop() {
    this.device.exitLoop();
  }
  /** Message log */
  log(text: string, mode?: LogMode) {
    this._logger?.log(text, mode);
  }
}
