import { InputManager } from "./input/inputmgr";
import { makeEventTarget, Vector4 } from "@zephyr3d/base";
import type { AbstractDevice, DeviceBackend } from "@zephyr3d/device";

/**
 * Event that will be fired every frame
 *
 * @remarks
 * This is where all the rendering work is done.
 *
 * @public
 */
 export class AppTickEvent {
  type = 'tick';
}

/**
 * This event will be fired whenever the device size changes
 * @public
 */
export class AppResizeEvent {
  width: number;
  height: number;
  type: string;
  constructor(width: number, height: number) {
    this.type = 'resize';
    this.width = width;
    this.height = height;
  }
}

type appEventMap = {
  resize: AppResizeEvent,
  tick: AppTickEvent,
  click: PointerEvent,
  dblclick: PointerEvent,
  pointerdown: PointerEvent,
  pointerup: PointerEvent,
  pointermove: PointerEvent,
  pointercancel: PointerEvent,
  pointerenter: PointerEvent,
  pointerleave: PointerEvent,
  pointerover: PointerEvent,
  pointerout: PointerEvent,
  wheel: WheelEvent,
  keydown: KeyboardEvent,
  keyup: KeyboardEvent,
  keypress: KeyboardEvent,
  drag: DragEvent,
  dragenter: DragEvent,
  dragleave: DragEvent,
  dragover: DragEvent,
  dragstart: DragEvent,
  dragend: DragEvent,
  drop: DragEvent
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
}

/**
 * Log mode
 * @public
 */
export type LogMode = 'info'|'warn'|'error'|'debug';

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
export class Application extends makeEventTarget(Object)<appEventMap>(){
  private _options: AppOptions;
  private _device: AbstractDevice;
  private _inputManager: InputManager;
  private _running: number;
  private _ready: boolean;
  private _canRender: boolean;
  private _drawEvent: AppTickEvent;
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
    this._running = null;
    this._ready = false;
    this._canRender = false;
    this._elapsed = 0;
    this._drawEvent = new AppTickEvent();
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
    }
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
   * Query if the device is ok to render objects now.
   *
   * @remarks
   * False will be returned if the device is lost.
   */
  get canRender(): boolean {
    return this._canRender;
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
      this._device.on('resize', ev => {
        this.dispatchEvent(new AppResizeEvent(ev.width, ev.height));
      });
      this._ready = true;
    }
  }
  /** Render one frame */
  frame() {
    if (this._ready) {
      this._canRender = this.device.beginFrame();
      this._elapsed = this.device.frameInfo.elapsedFrame * 0.001;
      this.device.setFramebuffer(null);
      this.device.setViewport(null);
      this.device.setScissor(null);
      this.dispatchEvent(this._drawEvent);
      this.device.endFrame();
    }
  }
  /** Start running the rendering loop */
  run() {
    if (this._running) {
      return;
    }
    const that = this;
    (function entry() {
      that._running = requestAnimationFrame(entry);
      that.frame();
    })();
  }
  /** Stop running the rendering loop */
  stop() {
    if (this._running) {
      cancelAnimationFrame(this._running);
      this._running = null;
    }
  }
  /** Message log */
  log(text: string, mode?: LogMode) {
    this._logger?.log(text, mode);
  }
}

