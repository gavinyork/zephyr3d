import type { Skeleton } from './skeleton';

/**
 * Abstract base class for skeleton post-processors.
 *
 * Post-processors are applied after the base animation/bind pose layer,
 * allowing procedural modifications like IK, spring physics, or manual overrides.
 *
 * @public
 */
export abstract class SkeletonModifier {
  /** Whether this processor is enabled */
  protected _enabled: boolean;

  constructor() {
    this._enabled = true;
  }

  /**
   * Get the blend weight [0-1]
   */
  get weight(): number {
    return this._getWeight();
  }

  set weight(value: number) {
    this._setWeight(value);
  }

  /**
   * Get whether this processor is enabled
   */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  /**
   * Apply post-processing to skeleton joints.
   *
   * This method is called after the base animation/bind pose has been applied.
   * Implementations should modify joint transforms and blend with the current state
   * using the processor's weight.
   *
   * @param skeleton - The skeleton to process
   * @param deltaTime - Time elapsed since last frame (in seconds)
   */
  abstract apply(skeleton: Skeleton, deltaTime: number): void;

  /**
   * Reset the processor to its initial state.
   *
   * Called when the skeleton or animation state changes significantly.
   */
  abstract reset(): void;

  /**
   * Get the blend weight for this processor.
   */
  protected abstract _getWeight(): number;

  /**
   * Set the blend weight for this processor.
   * @param _value - New blend weight (0-1)
   */
  protected abstract _setWeight(_value: number): void;
}
