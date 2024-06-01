import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { AnimationTrack } from './animationtrack';
import type { BoundingBox } from '../utility/bounding_volume';
import { Application } from '../app';
import type { SceneNode } from '../scene/scene_node';
import type { Skeleton } from './skeleton';

/**
 * Bounding box information for a skeleton
 * @public
 */
export interface SkinnedBoundingBox {
  boundingVertices: Vector3[];
  boundingVertexBlendIndices: Float32Array;
  boundingVertexJointWeights: Float32Array;
  boundingBox: BoundingBox;
}

/**
 * Animation that contains multiple tracks
 * @public
 */
export class AnimationClip {
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _model: SceneNode;
  /** @internal */
  protected _repeat: number;
  /** @internal */
  protected _speedRatio: number;
  /** @internal */
  protected _repeatCounter: number;
  /** @internal */
  protected _duration: number;
  /** @internal */
  protected _isPlaying: boolean;
  /** @internal */
  protected _lastUpdateFrame: number;
  /** @internal */
  protected _currentPlayTime: number;
  /** @internal */
  protected _tracks: Map<SceneNode, AnimationTrack[]>;
  /** @internal */
  protected _skeletons: Set<Skeleton>;
  /** @internal */
  protected _tmpPosition: Vector3;
  /** @internal */
  protected _tmpRotation: Quaternion;
  /** @internal */
  protected _tmpScale: Vector3;
  /** @internal */
  protected _weight: number;
  /**
   * Creates an animation instance
   * @param name - Name of the animation
   * @param model - Parent node if this is a skeleton animation
   */
  constructor(name: string, model?: SceneNode) {
    this._name = name;
    this._model = model ?? null;
    this._tracks = new Map();
    this._duration = 0;
    this._repeat = 0;
    this._repeatCounter = 0;
    this._speedRatio = 1;
    this._isPlaying = false;
    this._currentPlayTime = 0;
    this._lastUpdateFrame = 0;
    this._skeletons = new Set();
    this._tmpRotation = new Quaternion();
    this._tmpPosition = new Vector3();
    this._tmpScale = new Vector3();
  }
  /** Disposes self */
  dispose() {
    this._model = null;
    this._tracks = null;
    this._skeletons?.forEach((val, key) => key.dispose());
    this._skeletons = null;
  }
  /** Gets the name of the animation */
  get name(): string {
    return this._name;
  }
  /** Gets weight of the animation */
  get weight(): number {
    return this._weight;
  }
  set weight(val: number) {
    this._weight = val;
  }
  /** Gets all the tracks of this animation */
  get tracks() {
    return this._tracks;
  }
  /** Gets all skeletons */
  get skeletons() {
    return this._skeletons;
  }
  /** The duration of the animation */
  get timeDuration(): number {
    return this._duration;
  }
  /**
   * Adds a skeleton to the animation
   * @param skeleton - The skeleton to be added
   * @param meshList - The meshes controlled by the skeleton
   * @param boundingBoxInfo - Bounding box information for the skeleton
   */
  addSkeleton(skeleton: Skeleton) {
    this._skeletons.add(skeleton);
  }
  /**
   * Adds an animation track to the animation
   * @param node - The node that will be controlled by the track
   * @param track - The track to be added
   * @returns self
   */
  addTrack(node: SceneNode, track: AnimationTrack): this {
    if (!track) {
      return;
    }
    if (track.animation) {
      if (track.animation === this) {
        return;
      } else {
        console.error('Track is already in another animation');
        return;
      }
    }
    const blendId = track.getBlendId();
    const tracks = this._tracks.get(node);
    if (tracks && tracks.findIndex((track) => track.getBlendId() === blendId) >= 0) {
      console.error('Tracks with same BlendId could not be added to same animation');
      return;
    }
    track.animation = this;
    let trackInfo = this._tracks.get(node);
    if (!trackInfo) {
      trackInfo = [];
      this._tracks.set(node, trackInfo);
    }
    trackInfo.push(track);
    this._duration = Math.max(this._duration, track.interpolator.maxTime);
    track.reset(node);
    return this;
  }
  /**
   * Check if the animation is playing
   * @returns true if the animation is playing, otherwise false
   */
  isPlaying(): boolean {
    return this._isPlaying;
  }
  /**
   * Updates the animation state
   */
  update(): void {
    const device = Application.instance.device;
    if (!this._isPlaying || this._lastUpdateFrame === device.frameInfo.frameCounter) {
      return;
    }
    this._lastUpdateFrame = device.frameInfo.frameCounter;
    this._tracks.forEach((trackInfo, node) => {
      for (const track of trackInfo) {
        track.apply(node, this._currentPlayTime);
      }
    });
    this._skeletons.forEach((skeleton) => {
      skeleton.apply();
    });
    const timeAdvance = device.frameInfo.elapsedFrame * 0.001 * this._speedRatio;
    this._currentPlayTime += timeAdvance;
    if (this._currentPlayTime > this._duration) {
      this._repeatCounter++;
      this._currentPlayTime = 0;
    } else if (this._currentPlayTime < 0) {
      this._repeatCounter++;
      this._currentPlayTime = this._duration;
    }
    if (this._repeat !== 0 && this._repeatCounter >= this._repeat) {
      this.stop();
    }
  }
  /**
   * Starts playing the animation
   */
  play(repeat: number, speedRatio: number) {
    this._isPlaying = true;
    this._repeat = repeat;
    this._speedRatio = speedRatio;
    this._currentPlayTime = speedRatio < 0 ? this._duration : 0;
    this.update();
  }
  /**
   * Stops the animation
   */
  stop() {
    this._isPlaying = false;
    this._skeletons.forEach((skeleton) => {
      skeleton.reset(this._model);
    });
    this._tracks.forEach((trackInfo, node) => {
      for (const track of trackInfo) {
        track.reset(node);
      }
    });
  }
  /**
   * Rewind the animation to the first frame
   */
  rewind() {
    this._currentPlayTime = 0;
  }
}
