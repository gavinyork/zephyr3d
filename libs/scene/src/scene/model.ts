import { AnimationClip } from '../animation/animation';
import { GraphNode } from './graph_node';
import type { Scene, SceneUpdateEvent } from './scene';

/**
 * Model node
 * @public
 */
export class Model extends GraphNode {
  /** @internal */
  private _animations: Record<string, AnimationClip>;
  /** @internal */
  private _animationIndex: number;
  /** @internal */
  private _updateCallback: (evt: SceneUpdateEvent) => void;
  /**
   * Creates an instance of model node
   * @param scene - The scene to which the model belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._animations = {};
    this._animationIndex = 0;
    this._updateCallback = (evt: SceneUpdateEvent) => {
      if (this.attached) {
        this.update();
      }
    };
  }
  /**
   * Creates a new animation for the model
   * @param name - Name of the animation to be created
   * @returns The created animation
   */
  createAnimation(name?: string): AnimationClip {
    if (!name) {
      for (;;) {
        name = `animation${this._animationIndex++}`;
        if (!this._animationIndex[name]) {
          break;
        }
      }
    }
    if (this._animations[name]) {
      console.error(`Model.createAnimation() failed: animation '${name}' already exists`);
      return null;
    } else {
      const ani = new AnimationClip(name, this);
      this._animations[name] = ani;
      return ani;
    }
  }
  /**
   * Deletes an animation of this model
   * @param name - Name of the animation to be deleted
   */
  deleteAnimation(name: string): void {
    this.stopAnimation(name);
    delete this._animations[name];
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
   * @param repeat - The repeat times, 0 for always repeating
   */
  playAnimation(name: string, repeat = 1): void {
    const ani = this._animations[name];
    if (ani && !ani.isPlaying()) {
      for (const name of this.getAnimationNames()) {
        if (this.isPlayingAnimation(name)) {
          this.stopAnimation(name);
        }
      }
      ani.play(repeat, 1);
      this.scene.on('sceneupdate', this._updateCallback);
    }
  }
  /**
   * Stops playing an animation of the model
   * @param name - Name of the animation to stop playing
   */
  stopAnimation(name: string): void {
    const isPlaying = this.isPlayingAnimation();
    this._animations[name]?.stop();
    if (isPlaying && !this.isPlayingAnimation()) {
      this.scene.off('sceneupdate', this._updateCallback);
    }
  }
}
