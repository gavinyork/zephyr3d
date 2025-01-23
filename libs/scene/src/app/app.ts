import { makeEventTarget } from '@zephyr3d/base';
import type { AbstractDevice, DeviceBackend } from '@zephyr3d/device';
import { InputManager } from './inputmgr';

type appEventMap = {
  resize: [width: number, height: number];
  tick: [];
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
export class Application extends makeEventTarget(Object)<appEventMap>() {
  private _options: AppOptions;
  private _device: AbstractDevice;
  private _inputManager: InputManager;
  private _ready: boolean;
  private _logger: Logger;
  private _elapsed: number;
  private static _instance: Application;
  /**
   * Creates an instance of Application
   * @param opt - The creation options
   */
  constructor(opt: Partial<AppOptions>) {
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
    this._ready = false;
    this._elapsed = 0;
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
  /** The options that was used to create the application */
  get options(): AppOptions {
    return this._options;
  }
  /**
   * Query time elapsed since last frame in seconds
   */
  get timeElapsedInSeconds(): number {
    return this._elapsed;
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
    if (this._ready) {
      this._elapsed = this.device.frameInfo.elapsedFrame * 0.001;
      this.device.setFramebuffer(null);
      this.device.setViewport(null);
      this.device.setScissor(null);
      this.dispatchEvent('tick');
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
