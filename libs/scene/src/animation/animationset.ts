import type { Scene } from '../scene';
import type { AnimationClip } from './animation';

/**
 * Animation set
 * @public
 */
export class AnimationSet {
  /** @internal */
  private _animations: Record<string, AnimationClip>;
  /** @internal */
  private _scene: Scene;
  /**
   * Creates an instance of AnimationSet
   * @param scene - The scene to which the animation set belongs
   */
  constructor(scene: Scene) {
    this._scene = scene;
    this._scene.animationSet.push(this);
    this._animations = {};
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
      this._animations[k].update();
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
   * @param repeat - The repeat times, 0 for always repeating, default is 0
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
}
