import { Matrix4x4 } from '@zephyr3d/base';
import type { Scene } from '../scene';
import type { AnimationClip } from './animation';
import { Skeleton } from './skeleton';
import { Application } from '../app';
import { Texture2D } from '@zephyr3d/device';

/** @internal */
export type AnimationTexInfo = {
  texture: Texture2D,
  offsets: Record<string, {
    duration: number,
    offset: number,
    numKeyframes: number
  }>
};

/**
 * Animation set
 * @public
 */
export class AnimationSet {
  /** @internal */
  private _animations: Record<string, AnimationClip>;
  /** @internal */
  private _scene: Scene;
  /** @internal */
  private _animationTexInfo: Map<Skeleton, AnimationTexInfo>;
  /**
   * Creates an instance of AnimationSet
   * @param scene - The scene to which the animation set belongs
   */
  constructor(scene: Scene) {
    this._scene = scene;
    this._scene.animationSet.push(this);
    this._animations = {};
    this._animationTexInfo = null;
  }
  /**
   * How many animations in this set
   */
  get numAnimations(): number {
    return Object.getOwnPropertyNames(this._animations).length;
  }
  /**
   * Gets an animation clip by name
   * @param name - name of the animation to get
   */
  get(name: string): AnimationClip {
    return this._animations[name] ?? null;
  }
  /**
   * Adds an animation
   */
  add(animation: AnimationClip) {
    this._animations[animation.name] = animation;
  }
  /**
   * Gets names of all the animations of the model
   * @returns An array of string that contains the animation names
   */
  getAnimationNames(): string[] {
    return Object.keys(this._animations);
  }
  /**
   * Updates all animations of the model
   */
  update(): void {
    for (const k in this._animations) {
      this._animations[k].update(this._animationTexInfo);
    }
  }
  /**
   * Checks whether an animation is playing
   * @param name - Name of the animation to be checked
   * @returns true if the animation is playing, otherwise false
   */
  isPlayingAnimation(name?: string): boolean {
    if (name) {
      return this._animations[name]?.isPlaying();
    } else {
      for (const k in this._animations) {
        if (this._animations[k].isPlaying()) {
          return true;
        }
      }
      return false;
    }
  }
  /**
   * Starts playing an animation of the model
   * @param name - Name of the animation to play
   * @param repeat - The repeat times, 0 for always repeating, default is 1
   * @param ratio - The speed ratio, default is 1. Use negative value to play backwards
   */
  playAnimation(name: string, repeat = 0, speedRatio = 1): void {
    const ani = this._animations[name];
    if (ani && !ani.isPlaying()) {
      for (const name of this.getAnimationNames()) {
        if (this.isPlayingAnimation(name)) {
          this.stopAnimation(name);
        }
      }
      ani.play(repeat, speedRatio);
    }
  }
  /**
   * Stops playing an animation of the model
   * @param name - Name of the animation to stop playing
   */
  stopAnimation(name: string): void {
    this._animations[name]?.stop();
  }
  dispose() {
    const index = this._scene.animationSet.indexOf(this);
    if (index >= 0) {
      this._scene.animationSet.splice(index, 1);
    }
    for (const k in this._animations) {
      this._animations[k].dispose();
    }
    this._animations = {};
  }
  /** @internal */
  createAnimationTextures(numKeyframesPerSecond: number): void {
    const map = new Map<Skeleton, AnimationTexInfo>();
    for (const k in this._animations) {
      const animation = this._animations[k];
      const skeletons = animation.getSkeletons();
      for (const skeleton of skeletons) {
        if (!map.get(skeleton)) {
          map.set(skeleton, this._createAnimationTexture(numKeyframesPerSecond, skeleton));
        }
      }
    }
    this._animationTexInfo = map;
  }
  /** @internal */
  protected _createAnimationTexture(numKeyframesPerSecond: number, skeleton: Skeleton): AnimationTexInfo {
    const textureSize = this.calculateAnimationTextureSize(numKeyframesPerSecond, skeleton);
    const data = new Float32Array(textureSize * textureSize * 4);
    const numMatrices = (textureSize * textureSize) >> 2;
    const matrices: Matrix4x4[] = [];
    for (let i = 0; i < numMatrices; i++) {
      matrices.push(new Matrix4x4(data.buffer, i * 16 * 4));
    }
    const animationTexInfo: AnimationTexInfo = {
      texture: null,
      offsets: {}
    };
    let offset = 0;
    for (const k in this._animations) {
      const animation = this._animations[k];
      if (animation.isSkeletonUsed(skeleton)) {
        const numKeyframes = Math.ceil(animation.timeDuration * numKeyframesPerSecond);
        animationTexInfo.offsets[k] = { offset: offset * 4, numKeyframes, duration: animation.timeDuration };
        // bindpose
        skeleton.computeJointMatrices(matrices, offset, true);
        offset += skeleton.numJoints;
        for (let i = 0; i < numKeyframes; i++) {
          const t = i * animation.timeDuration / numKeyframes;
          animation.updateTracks(t * animation.timeDuration);
          skeleton.computeJointMatrices(matrices, offset, false);
          offset += skeleton.numJoints;
        }
      }
    }
    animationTexInfo.texture = Application.instance.device.createTexture2D('rgba32f', textureSize, textureSize, {
      samplerOptions: {
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none',
      }
    });
    return animationTexInfo;
  }
  /** @internal */
  private calculateAnimationTextureSize(numKeyframesPerSecond: number, skeleton: Skeleton): number {
    let totalKeyframes = 0;
    for (const k in this._animations) {
      const animation = this._animations[k];
      if (animation.isSkeletonUsed(skeleton)) {
        totalKeyframes += Math.ceil(animation.timeDuration * numKeyframesPerSecond);
        // bindpose
        totalKeyframes++;
      }
    }
    let size = 8;
    while (size * size < totalKeyframes * skeleton.numJoints * 4) {
      size *= 2;
    }
    return size;
  }
}
