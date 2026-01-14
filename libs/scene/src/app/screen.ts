import type { Immutable, Nullable, Rect } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { getDevice } from './api';

/**
 * Scaling mode used to adapt the design resolution to the viewport.
 *
 * - 'fit'    – Preserve aspect ratio, show whole design area, may add letterboxing (black bars).
 * - 'fit-width'  – Match viewport width exactly; height follows aspect ratio (may crop or letterbox vertically).
 * - 'fit-height' – Match viewport height exactly; width follows aspect ratio (may crop or letterbox horizontall
 * - 'cover'  – Preserve aspect ratio, fill the entire viewport, design area may be cropped.
 * - 'stretch' – Do not preserve aspect ratio, stretch to fill the viewport.
 *
 * @public
 */
export type ScreenScaleMode = 'fit' | 'fit-width' | 'fit-height' | 'cover' | 'stretch';

/**
 * Screen adapter configuration
 *
 * @public
 */
export type ScreenConfig = {
  /** Logical width in the design resolution coordinate system. */
  designWidth: number;
  /** Logical height in the design resolution coordinate system. */
  designHeight: number;
  /** Scaling mode used to adapt the design resolution to the viewport. */
  scaleMode: ScreenScaleMode;
};

/**
 * Parameters used to describe a 2D affine transform in the form:
 *
 *  outX = inX * scaleX + offsetX
 *  outY = inY * scaleY + offsetY
 */
export type PointTransform = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Resolution transform information derived from a {@link ScreenConfig}
 * and a concrete viewport rectangle.
 */
export type ResolutionTransform = {
  /**
   * X position of the adjusted viewport in canvas coordinates (CSS pixels).
   */
  viewportX: number;
  /**
   * Y position of the adjusted viewport in canvas coordinates (CSS pixels).
   */
  viewportY: number;
  /**
   * Width of the adjusted viewport in canvas coordinates (CSS pixels).
   */
  viewportWidth: number;
  /**
   * Height of the adjusted viewport in canvas coordinates (CSS pixels).
   */
  viewportHeight: number;
  /**
   * Visible part of the adjusted viewport, i.e. intersection with original viewport.
   **/
  croppedViewport: Rect;
  /**
   * Transform from canvas coordinates to the adjusted viewport's local coordinates.
   *
   * Typically used to convert mouse / pointer positions into the active rendering region.
   */
  canvasToViewport: PointTransform;
  /**
   * Transform from canvas coordinates to logical coordinates in the
   * design resolution space.
   *
   * Typically used for UI editing and interaction, so that logic consistently
   * works in designWidth × designHeight space.
   */
  canvasToLogic: PointTransform;
};

/**
 * Adapts a given physical viewport to a logical design resolution,
 * and provides coordinate transforms between canvas and logical spaces.
 *
 * @public
 */
export class ScreenAdapter {
  private _config!: ScreenConfig;
  private _transform: Nullable<ResolutionTransform>;
  private _viewport: Nullable<Immutable<number[]>>;
  private _resolvedViewport: Nullable<Immutable<number[]>>;
  private _version: number;
  /**
   * Creates a new {@link ScreenAdapter}.
   *
   * @param config - Optional initial screen configuration. If omitted,
   *   a default of 1920×1080 with 'stretch' mode is used.
   */
  constructor(config?: Immutable<ScreenConfig>) {
    this._viewport = null;
    this._transform = null;
    this._resolvedViewport = null;
    this._version = 1;
    this._config = { ...this.getDefaultConfig(), ...config };
  }
  /**
   * Returns the current design resolution configuration.
   */
  get config(): Immutable<ScreenConfig> {
    return this._config;
  }
  set config(config: Immutable<ScreenConfig>) {
    this._config = { ...this.getDefaultConfig(), ...config };
    this._transform = null;
    this._version++;
  }
  /**
   * Returns the viewport of the screen
   */
  get viewport(): Nullable<Immutable<number[]>> {
    return this._viewport;
  }
  set viewport(vp: Nullable<Immutable<number[]>>) {
    if (this._viewport !== vp) {
      this._viewport = vp?.slice() ?? null;
      this.resolveViewport();
    }
  }
  /**
   * Returns the version of the screen adapter
   */
  get version() {
    this.resolveViewport();
    return this._version;
  }
  /**
   * Returns the calculated resolution transform
   */
  get transform(): Immutable<ResolutionTransform> {
    this.resolveViewport();
    if (!this._transform) {
      this._transform = this.calculateResolutionTransform(
        this._resolvedViewport![0],
        this._resolvedViewport![1],
        this._resolvedViewport![2],
        this._resolvedViewport![3]
      );
    }
    return this._transform;
  }
  /**
   * Computes the resolution transform for a given viewport in canvas coordinates.
   *
   * @param viewportX - X position of the provided viewport (CSS pixels).
   * @param viewportY - Y position of the provided viewport (CSS pixels).
   * @param viewportWidth - Width of the provided viewport (CSS pixels).
   * @param viewportHeight - Height of the provided viewport (CSS pixels).
   * @returns A {@link ResolutionTransform} describing the adjusted viewport
   *   and coordinate transforms. If any dimension is non-positive, a
   *   transform with zero-sized viewport and identity-like transforms is returned.
   */
  calculateResolutionTransform(
    viewportX: number,
    viewportY: number,
    viewportWidth: number,
    viewportHeight: number
  ) {
    const { designWidth, designHeight, scaleMode } = this._config;

    // Guard against invalid dimensions.
    if (viewportWidth <= 0 || viewportHeight <= 0 || designWidth <= 0 || designHeight <= 0) {
      return {
        viewportX,
        viewportY,
        viewportWidth: 0,
        viewportHeight: 0,
        croppedViewport: { x: viewportX, y: viewportY, width: 0, height: 0 },
        canvasToViewport: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
        canvasToLogic: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
      };
    }

    const sx = viewportWidth / designWidth;
    const sy = viewportHeight / designHeight;

    let scaleX = 1;
    let scaleY = 1;
    let finalViewportWidth = viewportWidth;
    let finalViewportHeight = viewportHeight;
    let finalViewportX = viewportX;
    let finalViewportY = viewportY;

    switch (scaleMode) {
      case 'fit': {
        // Uniform scale, entire design area visible, may add letterboxing.
        const s = Math.min(sx, sy);
        scaleX = scaleY = s;
        finalViewportWidth = designWidth * s;
        finalViewportHeight = designHeight * s;
        finalViewportX = viewportX + (viewportWidth - finalViewportWidth) * 0.5;
        finalViewportY = viewportY + (viewportHeight - finalViewportHeight) * 0.5;
        break;
      }
      case 'cover': {
        // Uniform scale, viewport fully covered, design area may be cropped.
        const s = Math.max(sx, sy);
        scaleX = scaleY = s;
        finalViewportWidth = designWidth * s;
        finalViewportHeight = designHeight * s;
        finalViewportX = viewportX + (viewportWidth - finalViewportWidth) * 0.5;
        finalViewportY = viewportY + (viewportHeight - finalViewportHeight) * 0.5;
        break;
      }
      case 'stretch': {
        // Non-uniform scale, stretch to fill the viewport.
        scaleX = sx;
        scaleY = sy;
        finalViewportWidth = viewportWidth;
        finalViewportHeight = viewportHeight;
        finalViewportX = viewportX;
        finalViewportY = viewportY;
        break;
      }
      case 'fit-width': {
        // Match width exactly; height follows aspect ratio.
        const s = sx; // width-driven
        scaleX = scaleY = s;
        finalViewportWidth = designWidth * s; // == viewportWidth
        finalViewportHeight = designHeight * s; // may be > or < viewportHeight
        finalViewportX = viewportX;
        finalViewportY = viewportY + (viewportHeight - finalViewportHeight) * 0.5;
        break;
      }
      case 'fit-height': {
        // Match height exactly; width follows aspect ratio.
        const s = sy; // height-driven
        scaleX = scaleY = s;
        finalViewportHeight = designHeight * s; // == viewportHeight
        finalViewportWidth = designWidth * s; // may be > or < viewportWidth
        finalViewportY = viewportY;
        finalViewportX = viewportX + (viewportWidth - finalViewportWidth) * 0.5;
        break;
      }
    }

    // calculate cropped viewport
    const adjLeft = finalViewportX;
    const adjTop = finalViewportY;
    const adjRight = finalViewportX + finalViewportWidth;
    const adjBottom = finalViewportY + finalViewportHeight;

    const rawLeft = viewportX;
    const rawTop = viewportY;
    const rawRight = viewportX + viewportWidth;
    const rawBottom = viewportY + viewportHeight;

    const cropLeft = Math.max(adjLeft, rawLeft);
    const cropTop = Math.max(adjTop, rawTop);
    const cropRight = Math.min(adjRight, rawRight);
    const cropBottom = Math.min(adjBottom, rawBottom);

    let croppedViewport: Rect;
    if (cropRight <= cropLeft || cropBottom <= cropTop) {
      // No intersection
      croppedViewport = {
        x: viewportX,
        y: viewportY,
        width: 0,
        height: 0
      };
    } else {
      croppedViewport = {
        x: cropLeft,
        y: cropTop,
        width: cropRight - cropLeft,
        height: cropBottom - cropTop
      };
    }

    // Transform: canvas -> viewport-local
    //   viewportLocalX = canvasX - finalViewportX
    //   viewportLocalY = canvasY - finalViewportY
    const canvasToViewport: PointTransform = {
      scaleX: 1,
      scaleY: 1,
      offsetX: -finalViewportX,
      offsetY: -finalViewportY
    };

    // Transform: canvas -> logic (design space)
    //
    // canvas -> viewport-local:
    //   vx = canvasX - finalViewportX
    //   vy = canvasY - finalViewportY
    //
    // viewport-local -> logic:
    //   logicX = vx / scaleX
    //   logicY = vy / scaleY
    //
    // Combined:
    //   logicX = (canvasX - finalViewportX) / scaleX
    //          = (1 / scaleX) * canvasX + (-finalViewportX / scaleX)
    //   logicY = (canvasY - finalViewportY) / scaleY
    //          = (1 / scaleY) * canvasY + (-finalViewportY / scaleY)
    const canvasToLogic: PointTransform = {
      scaleX: 1 / scaleX,
      scaleY: 1 / scaleY,
      offsetX: -finalViewportX / scaleX,
      offsetY: -finalViewportY / scaleY
    };

    return {
      viewportX: finalViewportX,
      viewportY: finalViewportY,
      viewportWidth: finalViewportWidth,
      viewportHeight: finalViewportHeight,
      croppedViewport,
      canvasToViewport,
      canvasToLogic
    };
  }
  /**
   * Converts canvas coordinates into adjusted viewport-local coordinates.
   *
   * @remarks
   * This is mainly intended for picking / hit testing within the active
   * rendering region, where (0, 0) corresponds to the top-left of the
   * adapted viewport.
   *
   * @param canvasPos - Point in canvas coordinates (CSS pixels).
   * @param viewportPosOut - Optional output vector. If provided, it will be
   *   written into and returned; otherwise a new {@link Vector2} is allocated.
   * @returns The point in viewport-local coordinates.
   */
  canvasPosToViewport(canvasPos: Vector2, viewportPosOut?: Vector2) {
    return this.transformPoint(this.transform.canvasToViewport, canvasPos, viewportPosOut);
  }
  /**
   * Converts canvas coordinates into logical coordinates in the design
   * resolution space.
   *
   * @remarks
   * This is mainly intended for UI editing and interaction, so that logic
   * works consistently in the designWidth × designHeight coordinate system.
   *
   * @param canvasPos - Point in canvas coordinates (CSS pixels).
   * @param logicPosOut - Optional output vector. If provided, it will be
   *   written into and returned; otherwise a new {@link Vector2} is allocated.
   * @returns The point in logical (design resolution) coordinates.
   */
  canvasPosToLogic(canvasPos: Vector2, logicPosOut?: Vector2) {
    return this.transformPoint(this.transform.canvasToLogic, canvasPos, logicPosOut);
  }
  /**
   * Applies a 2D affine transform to a point.
   *
   * The transform is applied as:
   *
   *  out.x = in.x * scaleX + offsetX
   *  out.y = in.y * scaleY + offsetY
   *
   * @param transform - Transform parameters (scale and offset).
   * @param pointIn - Input point.
   * @param pointOut - Optional output vector. If provided, it will be
   *   written into and returned; otherwise a new {@link Vector2} is allocated.
   * @returns The transformed point.
   */
  transformPoint(transform: PointTransform, pointIn: Vector2, pointOut?: Vector2) {
    const out = pointOut ?? new Vector2();
    out.x = pointIn.x * transform.scaleX + transform.offsetX;
    out.y = pointIn.y * transform.scaleY + transform.offsetY;
    return out;
  }
  /**
   * Resolves the current viewport, updating internal state as needed.
   */
  resolveViewport() {
    const device = getDevice();
    const vp = this._viewport?.slice() ?? [
      0,
      0,
      device.deviceXToScreen(device.getDrawingBufferWidth()),
      device.deviceYToScreen(device.getDrawingBufferHeight())
    ];
    if (
      !this._resolvedViewport ||
      vp[0] !== this._resolvedViewport[0] ||
      vp[1] !== this._resolvedViewport[1] ||
      vp[2] !== this._resolvedViewport[2] ||
      vp[3] !== this._resolvedViewport[3]
    ) {
      this._resolvedViewport = vp;
      this._version++;
      this._transform = null;
    }
  }
  private getDefaultConfig(): ScreenConfig {
    return {
      designWidth: 1920,
      designHeight: 1080,
      scaleMode: 'stretch'
    };
  }
}
