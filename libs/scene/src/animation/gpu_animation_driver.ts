import type { Nullable } from '@zephyr3d/base';
import { tryGetApp } from '../app/api';
import type { SceneNode } from '../scene/scene_node';
import type { AnimationClip } from './animation';
import { AnimationBank } from './animation_bank';
import type { AnimationBankTrack } from './animation_bank';
import type { AnimationSet } from './animationset';
import { NodeEulerRotationTrack } from './eulerrotationtrack';
import { NodeRotationTrack } from './rotationtrack';
import { NodeScaleTrack } from './scaletrack';
import type { SkeletonRig, SkinBinding } from './skeleton';
import { NodeTranslationTrack } from './translationtrack';

/** Joint tracks a bank can bake */
function isJointTrack(track: object) {
  return (
    track instanceof NodeTranslationTrack ||
    track instanceof NodeRotationTrack ||
    track instanceof NodeEulerRotationTrack ||
    track instanceof NodeScaleTrack
  );
}

/** Banks shared by the instances of a model, by model and skin binding */
const sharedBanks: Map<string, { bank: AnimationBank; refs: number }> = new Map();
let nextDriverId = 0;

/**
 * Plays the skeletal animation of an {@link AnimationSet} with animation bank tracks while it
 * allows, see {@link AnimationSet.gpuAnimation}.
 *
 * @remarks
 * The animation set keeps advancing playback time, loops, ranges and events; only the posing
 * of the joints is replaced: each skin binding the clip animates is skinned by a bank track that
 * is set to the playback time every frame. Banks are baked a clip at a time on first use and
 * shared by every instance of the same model.
 *
 * Playback falls back to the joint nodes, at once and without a visible jump, whenever a frame
 * does not meet the conditions of a bank: exactly one active clip, animating joints only, no
 * skeleton modifier, no GPU cloth, and nothing attached to the joints that would follow them.
 *
 * @internal
 */
export class GpuAnimationDriver {
  private readonly _set: AnimationSet;
  private readonly _id: number;
  private readonly _tracks: Map<SkinBinding, AnimationBankTrack>;
  /** Shared bank keys acquired by this driver, by skin binding */
  private readonly _bankKeys: Map<SkinBinding, string>;
  private readonly _clipInfo: WeakMap<AnimationClip, Nullable<SkinBinding[]>>;
  private _clip: Nullable<AnimationClip>;
  private _time: number;
  private _structureTag: number;
  private _structureCheckedTag: number;
  private _structureOk: boolean;
  /** Frames the model has held a still pose with no clip active, see update() */
  private _idleFrames: number;
  private readonly _onStructureChanged: () => void;
  constructor(animationSet: AnimationSet) {
    this._set = animationSet;
    this._id = ++nextDriverId;
    this._tracks = new Map();
    this._bankKeys = new Map();
    this._clipInfo = new WeakMap();
    this._clip = null;
    this._time = 0;
    this._structureTag = 0;
    this._structureCheckedTag = -1;
    this._structureOk = false;
    this._idleFrames = 0;
    this._onStructureChanged = () => {
      this._structureTag++;
    };
    animationSet.model.on('nodeattached', this._onStructureChanged);
    animationSet.model.on('noderemoved', this._onStructureChanged);
  }
  /** Whether the pose currently comes from bank tracks */
  get active() {
    return this._tracks.size > 0;
  }
  /**
   * Pose the model for this frame by bank tracks if the conditions allow.
   *
   * @param clip - The only active clip, or null if none or more than one is active
   * @param time - Playback time of the clip
   * @returns true if bank tracks pose the model, so the joints are not to be posed this frame
   */
  update(clip: Nullable<AnimationClip>, time: number) {
    if (!clip) {
      return this.updateIdle();
    }
    this._idleFrames = 0;
    const bindings = this.getClipBindings(clip);
    if (!bindings || !this.canDrive(bindings)) {
      this.leave(true);
      return false;
    }
    if (clip !== this._clip) {
      // Joints the new clip leaves alone keep the pose they had on the regular path
      this.syncJoints();
      if (!this.untouchedJointsAtBindPose(clip, bindings)) {
        this.leave(false);
        return false;
      }
    }
    for (const binding of bindings) {
      const bank = this.acquireBank(binding);
      const index = bank.addClip(this._set, binding, clip.name);
      if (index < 0) {
        this.leave(false);
        return false;
      }
      let track = this._tracks.get(binding);
      if (!track) {
        track = bank.createTrack(index, { position: time, autoPlay: false, loop: false });
        track.attach(this._set.model, binding);
        this._tracks.set(binding, track);
      } else if (track.entryIndex !== index) {
        track.setClip(index, time);
      }
      track.position = time;
    }
    this._clip = clip;
    this._time = time;
    return true;
  }
  /**
   * With no clip active the pose does not change, so once the palettes hold it the skin bindings
   * stop rewriting them, and with that the skinned meshes stop recomputing their bounds.
   *
   * @remarks
   * Two frames are left to the regular path first: the first writes the pose, and the second
   * writes it again so the previous pose equals the current one and the meshes show no motion.
   */
  private updateIdle() {
    this.leave(true);
    const bindings = this._set.skinBindings
      .map((ref) => ref.get())
      .filter((binding): binding is SkinBinding => !!binding);
    if (bindings.length === 0 || !this.canDrive(bindings)) {
      this._idleFrames = 0;
      return false;
    }
    return ++this._idleFrames > 2;
  }
  /**
   * Hand the pose back to the joint nodes.
   *
   * @param sync - Pose the joints as the clip was at the last frame posed by bank tracks
   */
  leave(sync = true) {
    if (this._tracks.size > 0) {
      if (sync) {
        this.syncJoints();
      }
      for (const track of this._tracks.values()) {
        track.dispose();
      }
      this._tracks.clear();
    }
    this._clip = null;
  }
  /** Release the tracks and shared banks of this driver */
  dispose() {
    this.leave(false);
    for (const key of this._bankKeys.values()) {
      const shared = sharedBanks.get(key);
      if (shared && --shared.refs === 0) {
        shared.bank.dispose();
        sharedBanks.delete(key);
      }
    }
    this._bankKeys.clear();
    this._set.model.off('nodeattached', this._onStructureChanged);
    this._set.model.off('noderemoved', this._onStructureChanged);
  }
  /** Conditions checked every frame, as they change without the scene graph changing */
  private canDrive(bindings: SkinBinding[]) {
    // Clips may be edited in the editor while a bank holds an older bake of them
    if (tryGetApp()?.editorMode === 'editor') {
      return false;
    }
    for (const binding of bindings) {
      if (binding.rig.modifiers.length > 0) {
        return false;
      }
    }
    if (this._structureCheckedTag !== this._structureTag) {
      this._structureCheckedTag = this._structureTag;
      this._structureOk = this.checkStructure(bindings);
    }
    return this._structureOk;
  }
  /**
   * No GPU cloth, no mesh with skinning suspended, and nothing but joints below the joints,
   * which would otherwise follow joint nodes that bank tracks no longer move
   */
  private checkStructure(bindings: SkinBinding[]) {
    const joints = new Set<SceneNode>();
    for (const binding of bindings) {
      for (const joint of binding.joints) {
        joints.add(joint);
      }
    }
    for (const joint of joints) {
      if (joint.children.some((child) => !joints.has(child))) {
        return false;
      }
    }
    let ok = true;
    this._set.model.iterate((node) => {
      if (node.gpuClothComponents.length > 0 || (node.isMesh() && node.suspendSkinning)) {
        ok = false;
      }
      return !ok;
    });
    return ok;
  }
  /** Skin bindings a clip animates, or null if it animates anything other than their joints */
  private getClipBindings(clip: AnimationClip) {
    if (this._clipInfo.has(clip)) {
      return this._clipInfo.get(clip)!;
    }
    const rigByJoint = new Map<object, SkeletonRig>();
    for (const ref of this._set.skinBindings) {
      const rig = ref.get()?.rig;
      if (rig) {
        for (const joint of rig.joints) {
          rigByJoint.set(joint, rig);
        }
        if (rig.rootJoint) {
          rigByJoint.set(rig.rootJoint, rig);
        }
      }
    }
    const rigs = new Set<SkeletonRig>();
    let result: Nullable<SkinBinding[]> = null;
    let ok = clip.tracks.size > 0;
    for (const [target, tracks] of clip.tracks) {
      const rig = rigByJoint.get(target);
      if (!rig || !tracks.every(isJointTrack)) {
        ok = false;
        break;
      }
      rigs.add(rig);
    }
    if (ok) {
      result = this._set.skinBindings
        .map((ref) => ref.get())
        .filter((binding): binding is SkinBinding => !!binding && rigs.has(binding.rig));
      if (result.length === 0) {
        result = null;
      }
    }
    this._clipInfo.set(clip, result);
    return result;
  }
  /** A bank bakes the joints a clip leaves alone at their bind pose, so they must be there */
  private untouchedJointsAtBindPose(clip: AnimationClip, bindings: SkinBinding[]) {
    for (const binding of bindings) {
      for (const joint of binding.joints) {
        if (clip.tracks.has(joint)) {
          continue;
        }
        const pose = binding.rig.getBindPoseForJoint(joint);
        if (
          pose &&
          !(
            joint.position.equalsTo(pose.position, 1e-5) &&
            joint.rotation.equalsTo(pose.rotation, 1e-5) &&
            joint.scale.equalsTo(pose.scale, 1e-5)
          )
        ) {
          return false;
        }
      }
    }
    return true;
  }
  /** Pose the joint nodes as the last clip posed by bank tracks was at its last time */
  private syncJoints() {
    const clip = this._clip;
    if (!clip || this._tracks.size === 0) {
      return;
    }
    for (const [target, tracks] of clip.tracks) {
      for (const track of tracks) {
        // The same mapping from clip time to track time as AnimationSet.update()
        const t = clip.timeDuration > 0 ? (this._time / clip.timeDuration) * track.getDuration() : 0;
        track.applyState(target, track.calculateState(target, t));
      }
    }
  }
  /**
   * The bank of a skin binding, shared by the instances of the model: keyed by the prefab or model
   * asset the model was created from and the index of the binding in it
   */
  private acquireBank(binding: SkinBinding) {
    let key = this._bankKeys.get(binding);
    if (!key) {
      const prefabId = this._set.model.getPrefabNode()?.prefabId;
      const index = this._set.skinBindings.findIndex((ref) => ref.get() === binding);
      key = `${prefabId || `driver:${this._id}`}|${index}|${binding.joints.length}`;
      let shared = sharedBanks.get(key);
      if (!shared || !shared.bank.isCompatible(binding)) {
        // An incompatible bank under the same key comes from an edited copy of the model
        key = shared ? `driver:${this._id}|${index}` : key;
        shared = sharedBanks.get(key);
        if (!shared) {
          shared = { bank: new AnimationBank(this._set, binding, []), refs: 0 };
          sharedBanks.set(key, shared);
        }
      }
      shared.refs++;
      this._bankKeys.set(binding, key);
    }
    return sharedBanks.get(key)!.bank;
  }
}
