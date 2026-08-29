/**
 * A minimal HTMLCanvasElement stand-in for hosts without a DOM.
 *
 * @remarks
 * {@link https://github.com/gavinyork/zephyr3d | BaseDevice} keeps a canvas
 * reference and reads its width/height and client size, so a null device needs
 * an object with those properties even when no DOM exists. Only the members the
 * device layer touches are implemented; anything else throws or is a no-op.
 *
 * @public
 */
export class NullCanvas {
  /** Canvas backing store width in pixels */
  width: number;
  /** Canvas backing store height in pixels */
  height: number;
  /** CSS width in pixels */
  clientWidth: number;
  /** CSS height in pixels */
  clientHeight: number;
  /** Attributes set through {@link NullCanvas.setAttribute} */
  readonly attributes: Record<string, string>;
  /** Inline style values */
  readonly style: Record<string, string>;
  /** How many times {@link NullCanvas.focus} was called */
  focusCount: number;
  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.attributes = {};
    this.style = {};
    this.focusCount = 0;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  focus() {
    this.focusCount++;
  }
  blur() {
    // Nothing to do
  }
  addEventListener() {
    // Nothing to do
  }
  removeEventListener() {
    // Nothing to do
  }
  dispatchEvent() {
    return true;
  }
  getContext() {
    return null;
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
      toJSON() {
        return {};
      }
    };
  }
}

/**
 * Creates the canvas a null device renders into.
 *
 * @remarks
 * Uses a real canvas element when a DOM is available so that device consumers
 * relying on DOM behavior keep working, and falls back to {@link NullCanvas}
 * otherwise.
 *
 * @param width - Canvas width in pixels
 * @param height - Canvas height in pixels
 * @returns The created canvas
 * @public
 */
export function createNullCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new NullCanvas(width, height) as unknown as HTMLCanvasElement;
}
