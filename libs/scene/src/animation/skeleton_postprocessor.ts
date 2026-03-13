import type { Skeleton } from './skeleton';

/**
 * Abstract base class for skeleton post-processors.
 *
 * Post-processors are applied after the base animation/bind pose layer,
 * allowing procedural modifications like IK, spring physics, or manual overrides.
 *
 * @public
 */
export abstract class SkeletonPostProcessor {
  /** Blend weight for this processor [0-1] */
  protected _weight: number;
  /** Whether this processor is enabled */
  protected _enabled: boolean;
  /** Priority for ordering (higher = applied later) */
  protected _priority: number;

  constructor(weight: number = 1.0, priority: number = 0) {
    this._weight = Math.max(0, Math.min(1, weight));
    this._enabled = true;
    this._priority = priority;
  }

  /**
   * Get the blend weight [0-1]
   */
  get weight(): number {
    return this._weight;
  }

  /**
   * Set the blend weight [0-1]
   */
  set weight(value: number) {
    this._weight = Math.max(0, Math.min(1, value));
  }

  /**
   * Get whether this processor is enabled
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Set whether this processor is enabled
   */
  set enabled(value: boolean) {
    this._enabled = value;
  }

  /**
   * Get the priority (higher = applied later)
   */
  get priority(): number {
    return this._priority;
  }

  /**
   * Set the priority (higher = applied later)
   */
  set priority(value: number) {
    this._priority = value;
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
}
