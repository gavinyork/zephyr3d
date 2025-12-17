import type { Immutable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { getDevice } from './api';

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
  /**
   * Scaling mode used to adapt the design resolution to the viewport.
   *
   * - 'fit'    – Preserve aspect ratio, show whole design area, may add letterboxing (black bars).
   * - 'cover'  – Preserve aspect ratio, fill the entire viewport, design area may be cropped.
   * - 'stretch' – Do not preserve aspect ratio, stretch to fill the viewport.
   */
  scaleMode: 'fit' | 'cover' | 'stretch';
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
  private _config: ScreenConfig;
  private _transform: ResolutionTransform;
  private _viewport: Immutable<number[]>;
  /**
   * Creates a new {@link ScreenAdapter}.
   *
   * @param config - Optional initial screen configuration. If omitted,
   *   a default of 1920×1080 with 'stretch' mode is used.
   */
  constructor(config?: ScreenConfig) {
    this._viewport = null;
    this._transform = null;
    this.configure(config);
  }
  /**
   * Returns the current design resolution configuration.
   */
  get config(): Immutable<ScreenConfig> {
    return this._config;
  }
  /**
   * Returns the viewport of the screen
   */
  get viewport(): Immutable<number[]> {
    return this._viewport;
  }
  set viewport(vp: Immutable<number[]>) {
    vp = vp ?? null;
    if (this._viewport !== vp) {
      this._viewport = vp?.slice() ?? null;
      this._transform = null;
    }
  }
  /**
   * Returns the calculated resolution transform
   */
  get transform(): Immutable<ResolutionTransform> {
    if (!this._transform) {
      const device = getDevice();
      const vp = this._viewport ?? [
        0,
        0,
        device.deviceXToScreen(device.getDrawingBufferWidth()),
        device.deviceYToScreen(device.getDrawingBufferHeight())
      ];
      this._transform = this.calculateResolutionTransform(vp[0], vp[1], vp[2], vp[3]);
    }
    return this._transform;
  }
  /**
   * Configures the design resolution and scale mode.
   *
   * @param config - Design resolution configuration. Any missing fields
   *   are filled with default values: 1920×1080 and 'stretch' mode.
   */
  configure(_config: ScreenConfig): void {
    this._config = this._config = {
      designWidth: 1920,
      designHeight: 1080,
      scaleMode: 'stretch',
      ..._config
    };
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
  ): ResolutionTransform {
    const { designWidth, designHeight, scaleMode } = this._config;

    // Guard against invalid dimensions.
    if (viewportWidth <= 0 || viewportHeight <= 0 || designWidth <= 0 || designHeight <= 0) {
      return {
        viewportX,
        viewportY,
        viewportWidth: 0,
        viewportHeight: 0,
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
  canvasPosToViewport(canvasPos: Vector2, viewportPosOut?: Vector2): Vector2 {
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
  canvasPosToLogic(canvasPos: Vector2, logicPosOut?: Vector2): Vector2 {
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
  transformPoint(transform: PointTransform, pointIn: Vector2, pointOut?: Vector2): Vector2 {
    const out = pointOut ?? new Vector2();
    out.x = pointIn.x * transform.scaleX + transform.offsetX;
    out.y = pointIn.y * transform.scaleY + transform.offsetY;
    return out;
  }
}
