import { Disposable, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../app/api';
import type { Mesh } from '../scene/mesh';
import type { SceneNode } from '../scene/scene_node';
import { BoundingBox } from '../utility/bounding_volume';
import type { AnimationSet } from './animationset';
import type { SkinBinding } from './skeleton';
import { SkinPaletteAtlas } from './skin_palette_atlas';
import { AnimationBankGpuEvaluator } from './animation_bank_gpu';
import type { SkinPaletteBlock } from './skin_palette_atlas';

/**
 * Rate clips are sampled at when baked into a bank, as `ANIM_BANK_SAMPLE_RATE` in UE
 * (Shaders/Shared/SkinningDefinitions.h)
 */
export const ANIMATION_BANK_SAMPLE_RATE = 30;

/** Floats in one baked joint key: position xyz, rotation quaternion xyzw, scale xyz */
const KEY_FLOATS = 10;

/**
 * One clip baked into an animation bank.
 *
 * @public
 */
export interface AnimationBankEntry {
  /** Name of the source clip */
  readonly name: string;
  /** Number of sampled frames, the first at time 0 and the last at {@link playLength} */
  readonly frameCount: number;
  /** Length of the baked clip in seconds */
  readonly playLength: number;
  /**
   * Joint keys of all frames, frame after frame, each frame holding one key per joint of the
   * bank: position, rotation and scale relative to the reference node of the skin binding
   */
  readonly keys: Float32Array<ArrayBuffer>;
}

/**
 * Options of a track playing a bank entry.
 *
 * @public
 */
export interface AnimationBankTrackOptions {
  /** Start position in seconds, default 0 */
  position?: number;
  /** Playback rate, default 1. Negative values play backwards */
  playRate?: number;
  /** Whether playback wraps around at either end, default true. Otherwise it stops at the end */
  loop?: boolean;
  /** Whether the position advances with time, default true */
  autoPlay?: boolean;
  /**
   * Where the palette is evaluated: 'auto' on the GPU where supported (WebGPU), 'cpu' always on the
   * CPU. Default 'auto'
   */
  evaluation?: 'auto' | 'cpu';
}

const tmpMatrix = new Matrix4x4();
const tmpMatrix2 = new Matrix4x4();
const tmpPosition = new Vector3();
const tmpRotation = new Quaternion();
const tmpScale = new Vector3();
const tmpPoint = new Vector3();
const tmpPoint2 = new Vector3();
const tmpHeader = new Float32Array(16);

/**
 * Skeletal animation clips of one skin baked into joint poses, played back without the joint
 * scene nodes the clips were made for.
 *
 * @remarks
 * Follows the animation bank of UE (`UAnimBank`, Engine/Private/Animation/AnimBank.cpp): every clip
 * is sampled at {@link ANIMATION_BANK_SAMPLE_RATE} frames per second into joint poses relative to the
 * root of the skin, so that a pose is evaluated per joint without walking the joint hierarchy.
 *
 * A bank is played by {@link AnimationBankTrack}s. Each track owns one palette in the skin palette
 * atlas, and any number of instances of the model skin their meshes by it, so a crowd costs the
 * evaluation of its tracks rather than of its characters.
 *
 * Unlike UE, which keeps rotation and translation only, keys keep the joint scale as well, since
 * imported rigs often scale their joints.
 *
 * Meshes skinned by a track do not run IK, joint dynamics or any other skeleton modifier, and do
 * not blend clips.
 *
 * @public
 */
export class AnimationBank extends Disposable {
  private readonly _jointCount: number;
  private readonly _jointNames: string[];
  private readonly _inverseBindMatrices: Matrix4x4[];
  private readonly _entries: AnimationBankEntry[];
  private readonly _tracks: Set<AnimationBankTrack>;
  private _version: number;
  /**
   * Bake clips of an animation set into a bank for one skin.
   *
   * @remarks
   * Sampling poses the joints of the skin; their transforms are restored afterwards. Only tracks
   * targeting the joints of the skin, or the root joint of its rig, are sampled, and skeleton
   * modifiers do not run.
   *
   * @param animationSet - Animation set holding the clips
   * @param binding - Skin binding whose joints the clips animate
   * @param clipNames - Names of the clips to bake, default all clips of the set. More can be added
   *   later with {@link addClip}
   */
  constructor(animationSet: AnimationSet, binding: SkinBinding, clipNames?: string[]) {
    super();
    this._jointCount = binding.joints.length;
    this._jointNames = binding.joints.map((joint) => joint.name);
    this._inverseBindMatrices = binding.inverseBindMatrices.map((m) => new Matrix4x4(new Float32Array(m)));
    this._entries = [];
    this._tracks = new Set();
    this._version = 0;
    const names = clipNames ?? animationSet.getAnimationNames();
    for (const name of names) {
      this.addClip(animationSet, binding, name);
    }
  }
  /**
   * Bake one more clip into the bank.
   *
   * @param animationSet - Animation set holding the clip
   * @param binding - Skin binding the bank was baked for, or a compatible one
   * @param name - Name of the clip
   * @returns Index of the entry, the existing one if the clip has been baked already, or -1 if
   *   the clip does not animate the joints of the skin
   */
  addClip(animationSet: AnimationSet, binding: SkinBinding, name: string) {
    const index = this.getEntryIndex(name);
    if (index >= 0) {
      return index;
    }
    const entry = this.bakeClip(animationSet, binding, name);
    if (!entry) {
      return -1;
    }
    this._entries.push(entry);
    this._version++;
    return this._entries.length - 1;
  }
  /** Increased each time a clip is added */
  get version() {
    return this._version;
  }
  /** Number of joints of the skin */
  get jointCount() {
    return this._jointCount;
  }
  /** Baked clips */
  get entries(): readonly AnimationBankEntry[] {
    return this._entries;
  }
  /** Inverse bind matrices of the joints of the skin */
  get inverseBindMatrices(): readonly Matrix4x4[] {
    return this._inverseBindMatrices;
  }
  /**
   * Gets the index of a baked clip by name.
   *
   * @param name - Name of the clip
   * @returns Index of the entry, or -1 if the clip has not been baked
   */
  getEntryIndex(name: string) {
    return this._entries.findIndex((entry) => entry.name === name);
  }
  /**
   * Whether a skin binding has the joints this bank was baked for, in the same order.
   *
   * @param binding - Skin binding to check
   */
  isCompatible(binding: SkinBinding) {
    const joints = binding.joints;
    return (
      joints.length === this._jointCount &&
      joints.every((joint, i) => joint.name === this._jointNames[i]) &&
      // Skins sharing a rig differ by their inverse bind matrices
      binding.inverseBindMatrices.every((m, i) => m.equalsTo(this._inverseBindMatrices[i], 1e-4))
    );
  }
  /**
   * Create a track playing a baked clip.
   *
   * @param clip - Name or entry index of the clip
   * @param options - Playback options
   * @returns The track
   */
  createTrack(clip: string | number, options?: AnimationBankTrackOptions) {
    const index = typeof clip === 'number' ? clip : this.getEntryIndex(clip);
    if (index < 0 || index >= this._entries.length) {
      throw new Error(`AnimationBank.createTrack(): clip not baked: ${clip}`);
    }
    const track = new AnimationBankTrack(this, index, options);
    this._tracks.add(track);
    return track;
  }
  /**
   * Write the skinning palette of a pose to the skin palette atlas.
   *
   * @remarks
   * Follows `SampleAnimBank` of UE (Renderer/Private/Skinning/AnimBankTransformProvider.cpp):
   * the two keys around the position are blended, positions and scales linearly and rotations by
   * normalized linear interpolation along the shorter arc (`BlendBoneTransformsWithScale` and
   * `QuatSlerpApproximate` in Shaders/Private/BoneTransform.ush and Quaternion.ush), and the pose
   * is followed by the inverse bind matrix.
   *
   * @internal
   */
  writePalette(entryIndex: number, position: number, slot: number, out: Float32Array<ArrayBuffer>) {
    const entry = this._entries[entryIndex];
    const { key0, key1, alpha } = getKeyIndicesFromTime(position, entry.frameCount, entry.playLength);
    const keys = entry.keys;
    const n = this._jointCount;
    for (let i = 0; i < n; i++) {
      blendKeys(keys, (key0 * n + i) * KEY_FLOATS, (key1 * n + i) * KEY_FLOATS, alpha, tmpMatrix);
      Matrix4x4.multiplyAffine(tmpMatrix, this._inverseBindMatrices[i], tmpMatrix2);
      out.set(tmpMatrix2, i * 16);
    }
    SkinPaletteAtlas.instance.writeSlots(slot, out);
  }
  /**
   * Compute the bounds of a mesh over all frames of a baked clip.
   *
   * @remarks
   * UE bounds a clip by the joint positions of its keys (`FAnimBankBuildAsyncCacheTask`). Here the
   * representative vertices of the mesh, which bound it at runtime when skinned by its skin
   * binding, are skinned by every frame instead, which fits the mesh more closely.
   *
   * @param entryIndex - Index of the baked clip
   * @param mesh - Mesh skinned by the bank
   * @returns Bounds in the local space of the mesh, or null if the mesh has no skinned bounding data
   * @internal
   */
  computeBoundingBox(entryIndex: number, mesh: Mesh): Nullable<BoundingBox> {
    const info = mesh.skinnedBoundingInfo;
    if (!info) {
      return null;
    }
    const entry = this._entries[entryIndex];
    const skinSpace = mesh.getSkinSpaceMatrix();
    const influenceCount = Math.max(1, info.influenceCount ?? 4);
    const n = this._jointCount;
    const box = new BoundingBox();
    box.beginExtend();
    for (let frame = 0; frame < entry.frameCount; frame++) {
      for (let v = 0; v < info.boundingVertices.length; v++) {
        tmpPoint.setXYZ(0, 0, 0);
        for (let j = 0; j < influenceCount; j++) {
          const weight = Number(info.boundingVertexJointWeights[v * influenceCount + j]) || 0;
          const joint = Number(info.boundingVertexBlendIndices[v * influenceCount + j]) || 0;
          if (weight <= 0 || joint >= n) {
            continue;
          }
          const offset = (frame * n + joint) * KEY_FLOATS;
          blendKeys(entry.keys, offset, offset, 0, tmpMatrix);
          Matrix4x4.multiplyAffine(tmpMatrix, this._inverseBindMatrices[joint], tmpMatrix2);
          tmpMatrix2.transformPointAffine(info.boundingVertices[v], tmpPoint2).scaleBy(weight);
          tmpPoint.addBy(tmpPoint2);
        }
        box.extend(skinSpace.transformPointAffine(tmpPoint, tmpPoint));
      }
    }
    return box.isValid() ? box : null;
  }
  /** @internal */
  removeTrack(track: AnimationBankTrack) {
    this._tracks.delete(track);
  }
  /** Dispose all tracks of the bank */
  protected onDispose() {
    super.onDispose();
    for (const track of [...this._tracks]) {
      track.dispose();
    }
  }
  private bakeClip(animationSet: AnimationSet, binding: SkinBinding, name: string) {
    const clip = animationSet.get(name);
    if (!clip) {
      console.error(`AnimationBank: animation not found: ${name}`);
      return null;
    }
    const rig = binding.rig;
    const joints = new Set<object>(binding.joints);
    if (rig.rootJoint) {
      joints.add(rig.rootJoint);
    }
    const tracks = [...clip.tracks].filter(([target]) => joints.has(target));
    if (tracks.length === 0) {
      return null;
    }
    // Keep the joint transforms so baking leaves the model as it was
    const saved = [...joints].map((joint) => {
      const node = joint as SceneNode;
      return {
        node,
        position: node.position.clone(),
        rotation: node.rotation.clone(),
        scale: node.scale.clone()
      };
    });
    const playLength = clip.timeDuration;
    // UE samples round(length * rate) frames from time 0, which leaves out the pose at the end of
    // the clip; one more frame is sampled here so the last key is the end pose, letting a looping
    // track interpolate all the way back to the start
    const frameCount = Math.max(1, Math.round(playLength * ANIMATION_BANK_SAMPLE_RATE) + 1);
    const n = binding.joints.length;
    const keys = new Float32Array(frameCount * n * KEY_FLOATS);
    const reference = binding.referenceNode;
    try {
      rig.computeBindPose();
      for (let frame = 0; frame < frameCount; frame++) {
        const time = frameCount > 1 ? (playLength * frame) / (frameCount - 1) : 0;
        for (const [target, targetTracks] of tracks) {
          for (const track of targetTracks) {
            const t = playLength > 0 ? (time / playLength) * track.getDuration() : 0;
            track.applyState(target, track.calculateState(target, t));
          }
        }
        const invReference = reference ? Matrix4x4.invertAffine(reference.worldMatrix, tmpMatrix2) : null;
        for (let i = 0; i < n; i++) {
          const world = binding.joints[i].worldMatrix;
          if (invReference) {
            Matrix4x4.multiplyAffine(invReference, world, tmpMatrix);
          } else {
            tmpMatrix.set(world);
          }
          tmpMatrix.decompose(tmpScale, tmpRotation, tmpPosition);
          const offset = (frame * n + i) * KEY_FLOATS;
          keys[offset] = tmpPosition.x;
          keys[offset + 1] = tmpPosition.y;
          keys[offset + 2] = tmpPosition.z;
          keys[offset + 3] = tmpRotation.x;
          keys[offset + 4] = tmpRotation.y;
          keys[offset + 5] = tmpRotation.z;
          keys[offset + 6] = tmpRotation.w;
          keys[offset + 7] = tmpScale.x;
          keys[offset + 8] = tmpScale.y;
          keys[offset + 9] = tmpScale.z;
        }
      }
    } finally {
      for (const { node, position, rotation, scale } of saved) {
        node.position.set(position);
        node.rotation.set(rotation);
        node.scale.set(scale);
      }
    }
    return { name, frameCount, playLength: frameCount > 1 ? playLength : 0, keys } as AnimationBankEntry;
  }
}

/**
 * A playing clip of an animation bank, owning one skinning palette that any number of meshes
 * of compatible skins are skinned by.
 *
 * @remarks
 * Tracks advance once per frame before the skin palette atlas is uploaded. The palette keeps
 * the previous pose as well, for motion vectors.
 *
 * Where supported (WebGPU), palettes are evaluated in a compute pass, see
 * {@link AnimationBankTrackOptions.evaluation}; elsewhere on the CPU. Both produce the same pose.
 *
 * @public
 */
export class AnimationBankTrack extends Disposable {
  private static readonly _activeTracks: Set<AnimationBankTrack> = new Set();
  private static _updateFrame = -1;
  private readonly _bank: AnimationBank;
  private _entryIndex: number;
  private _position: number;
  /** Position at the previous evaluation, for the previous pose of GPU evaluation */
  private _previousPosition: number;
  /** Position the palette was last evaluated at */
  private _evaluatedPosition: number;
  /** Whether the palette is evaluated on the GPU, into fixed current and previous sets */
  private readonly _gpu: boolean;
  private _playRate: number;
  private _loop: boolean;
  private _autoPlay: boolean;
  private _block: Nullable<SkinPaletteBlock>;
  /** Offsets of the current and previous sets in the block, as `SkinBinding` keeps them */
  private readonly _offsets: [number, number];
  private _dirty: boolean;
  private readonly _palette: Float32Array<ArrayBuffer>;
  private readonly _meshes: Map<Mesh, Nullable<BoundingBox>>;
  /** @internal */
  constructor(bank: AnimationBank, entryIndex: number, options?: AnimationBankTrackOptions) {
    super();
    this._bank = bank;
    this._entryIndex = entryIndex;
    this._playRate = options?.playRate ?? 1;
    this._loop = options?.loop ?? true;
    this._autoPlay = options?.autoPlay ?? true;
    this._position = this.wrap(options?.position ?? 0);
    this._previousPosition = this._position;
    this._evaluatedPosition = this._position;
    this._gpu = (options?.evaluation ?? 'auto') === 'auto' && AnimationBankGpuEvaluator.isSupported();
    this._block = SkinPaletteAtlas.instance.allocate(bank.jointCount * 2 + 1);
    this._offsets = [0, 0];
    this._dirty = true;
    this._palette = new Float32Array(this._gpu ? 0 : bank.jointCount * 16);
    this._meshes = new Map();
    AnimationBankTrack._activeTracks.add(this);
    if (this._gpu) {
      // Fixed sets, both rewritten by every dispatch
      this._offsets[0] = 1;
      this._offsets[1] = 1 + bank.jointCount;
      this.writeHeader();
      AnimationBankGpuEvaluator.addTrack(this);
    } else {
      this.evaluate();
    }
  }
  /**
   * Advance all tracks by the frame time, once per device frame.
   *
   * @internal
   */
  static updateAll(deltaInSeconds: number) {
    const frame = getDevice().frameInfo.frameCounter;
    if (frame !== this._updateFrame) {
      this._updateFrame = frame;
      for (const track of this._activeTracks) {
        track.update(deltaInSeconds);
      }
    }
  }
  /** The bank this track plays */
  get bank() {
    return this._bank;
  }
  /** Name of the clip playing */
  get clipName() {
    return this._bank.entries[this._entryIndex].name;
  }
  /** Length of the clip in seconds */
  get playLength() {
    return this._bank.entries[this._entryIndex].playLength;
  }
  /** Playback position in seconds */
  get position() {
    return this._position;
  }
  set position(val: number) {
    this._position = this.wrap(val);
    this._dirty = true;
  }
  /** Playback rate, negative values play backwards */
  get playRate() {
    return this._playRate;
  }
  set playRate(val: number) {
    this._playRate = val;
  }
  /** Whether playback wraps around at either end */
  get loop() {
    return this._loop;
  }
  set loop(val: boolean) {
    this._loop = val;
  }
  /** Whether the position advances with time */
  get autoPlay() {
    return this._autoPlay;
  }
  set autoPlay(val: boolean) {
    this._autoPlay = val;
  }
  /** Slot index of the palette header in the skin palette atlas */
  get paletteBase() {
    return this._block?.base ?? 0;
  }
  /** Whether the palette is evaluated on the GPU */
  get gpuEvaluated() {
    return this._gpu;
  }
  /** @internal */
  get entryIndex() {
    return this._entryIndex;
  }
  /** @internal Position of the previous pose */
  get previousPosition() {
    return this._previousPosition;
  }
  /**
   * Play another clip of the bank, keeping the playback options.
   *
   * @remarks
   * The pose changes at once; tracks do not blend clips. The bounds of attached meshes are
   * recomputed for the new clip.
   *
   * @param clip - Name or entry index of the clip
   * @param position - Position to start at in seconds, default 0
   */
  setClip(clip: string | number, position = 0) {
    const index = typeof clip === 'number' ? clip : this._bank.getEntryIndex(clip);
    if (index < 0 || index >= this._bank.entries.length) {
      throw new Error(`AnimationBankTrack.setClip(): clip not baked: ${clip}`);
    }
    this._entryIndex = index;
    this._position = this.wrap(position);
    // The previous pose belonged to another clip, so the new one starts still
    this._previousPosition = this._position;
    this._evaluatedPosition = this._position;
    this._dirty = true;
    for (const mesh of this._meshes.keys()) {
      this.attachMesh(mesh);
    }
  }
  /**
   * Skin all meshes under a node by this track.
   *
   * @remarks
   * Meshes whose skin binding has other joints than the bank are skipped. The skin bindings of the
   * attached meshes stop updating their own palettes until detached.
   *
   * @param node - Root of the model, typically an instance of the model the bank was baked from
   * @param binding - If given, only meshes skinned by this binding are attached
   * @returns Number of meshes attached
   */
  attach(node: SceneNode, binding?: SkinBinding) {
    let count = 0;
    node.iterate((child) => {
      if (child.isMesh() && this.attachMesh(child, binding)) {
        count++;
      }
      return false;
    });
    return count;
  }
  /**
   * Skin the meshes under a node by their skin bindings again.
   *
   * @param node - Node passed to {@link attach}
   */
  detach(node: SceneNode) {
    node.iterate((child) => {
      if (child.isMesh() && this._meshes.has(child)) {
        this.detachMesh(child);
      }
      return false;
    });
  }
  /**
   * Advance the position by the frame time and write the new pose.
   *
   * @remarks
   * Follows `FAnimBankTrackPackedData::Update` and `Wrap` of UE (Engine/Private/Animation/AnimBank.cpp).
   *
   * @internal
   */
  update(deltaInSeconds: number) {
    if (this._autoPlay && this._playRate !== 0) {
      this._position = this.wrap(this._position + this._playRate * deltaInSeconds);
      this._dirty = true;
    }
    if (this._gpu) {
      // Evaluated by the next dispatch; a still pose evaluates to the same matrices twice
      this._previousPosition = this._evaluatedPosition;
      this._evaluatedPosition = this._position;
      this._dirty = false;
    } else if (this._dirty) {
      this.evaluate();
    } else if (this._offsets[1] !== this._offsets[0]) {
      // A still pose: point the previous set at the current one so motion vectors become zero
      this._offsets[1] = this._offsets[0];
      this.writeHeader();
    }
  }
  /** Release the palette and skin the attached meshes by their skin bindings again */
  protected onDispose() {
    super.onDispose();
    for (const mesh of [...this._meshes.keys()]) {
      this.detachMesh(mesh);
    }
    AnimationBankTrack._activeTracks.delete(this);
    if (this._gpu) {
      AnimationBankGpuEvaluator.removeTrack(this);
    }
    this._bank.removeTrack(this);
    if (this._block) {
      SkinPaletteAtlas.instance.free(this._block);
      this._block = null;
    }
  }
  private attachMesh(mesh: Mesh, only?: SkinBinding) {
    const binding = mesh.findSkinBindingById(mesh.skinBindingName);
    if (!binding || (only && binding !== only) || !this._bank.isCompatible(binding)) {
      return false;
    }
    const previous = mesh.getSkinPaletteOverride();
    if (previous?.owner && previous.owner !== this) {
      previous.owner.detachMesh(mesh);
    }
    if (!this._meshes.has(mesh)) {
      binding.suspendPalette(true);
    }
    const boundingBox = this._bank.computeBoundingBox(this._entryIndex, mesh);
    this._meshes.set(mesh, boundingBox);
    mesh.setSkinPaletteOverride({ paletteBase: this.paletteBase, boundingBox, owner: this });
    return true;
  }
  /** @internal */
  detachMesh(mesh: Mesh) {
    if (this._meshes.delete(mesh)) {
      mesh.findSkinBindingById(mesh.skinBindingName)?.suspendPalette(false);
      if (mesh.getSkinPaletteOverride()?.owner === this) {
        mesh.setSkinPaletteOverride(null);
      }
    }
  }
  /** Write the pose at the position into the set not holding the previous pose */
  private evaluate() {
    if (!this._block) {
      return;
    }
    const n = this._bank.jointCount;
    if (this._offsets[0] === 0) {
      this._offsets[0] = 1;
      this._offsets[1] = 1;
    } else {
      this._offsets[1] = this._offsets[0];
      this._offsets[0] = n - this._offsets[0] + 2;
    }
    this._bank.writePalette(
      this._entryIndex,
      this._position,
      this._block.base + this._offsets[0],
      this._palette
    );
    this.writeHeader();
    this._dirty = false;
  }
  private writeHeader() {
    const base = this._block!.base;
    tmpHeader[0] = base + this._offsets[0];
    tmpHeader[1] = base + this._offsets[1];
    SkinPaletteAtlas.instance.writeSlots(base, tmpHeader);
  }
  /** As `GetAnimBankTrackLoopedPosition` of UE, or clamped when not looping */
  private wrap(position: number) {
    const length = this.playLength;
    if (this._loop) {
      position = length === 0 ? 0 : position % length;
      if (position < 0) {
        position += length;
      }
      return position;
    }
    return Math.min(Math.max(position, 0), length);
  }
}

/**
 * Keys around a time and the weight of the second, as `FAnimationRuntime::GetKeyIndicesFromTime` of
 * UE (Engine/Private/Animation/AnimationRuntime.cpp) with the frame rate derived from the length.
 */
function getKeyIndicesFromTime(time: number, numKeys: number, sequenceLength: number) {
  if (time <= 0 || numKeys === 1) {
    return { key0: 0, key1: 0, alpha: 0 };
  }
  const lastIndex = numKeys - 1;
  if (time >= sequenceLength) {
    return { key0: lastIndex, key1: 0, alpha: 0 };
  }
  const keyPos = time * (lastIndex / sequenceLength);
  const key0 = Math.min(Math.max(Math.floor(keyPos), 0), lastIndex);
  const alpha = keyPos - key0;
  const key1 = key0 + 1 === numKeys ? key0 : key0 + 1;
  return { key0, key1, alpha };
}

/** Blend two keys into a joint pose matrix */
function blendKeys(keys: Float32Array, a: number, b: number, alpha: number, out: Matrix4x4) {
  const beta = 1 - alpha;
  // Rotations are normalized before and after blending, along the shorter arc
  let ax = keys[a + 3],
    ay = keys[a + 4],
    az = keys[a + 5],
    aw = keys[a + 6];
  let bx = keys[b + 3],
    by = keys[b + 4],
    bz = keys[b + 5],
    bw = keys[b + 6];
  let len = Math.hypot(ax, ay, az, aw) || 1;
  ax /= len;
  ay /= len;
  az /= len;
  aw /= len;
  len = Math.hypot(bx, by, bz, bw) || 1;
  const sign = ax * bx + ay * by + az * bz + aw * bw < 0 ? -1 / len : 1 / len;
  bx *= sign;
  by *= sign;
  bz *= sign;
  bw *= sign;
  let x = ax * beta + bx * alpha;
  let y = ay * beta + by * alpha;
  let z = az * beta + bz * alpha;
  let w = aw * beta + bw * alpha;
  len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  const sx = keys[a + 7] * beta + keys[b + 7] * alpha;
  const sy = keys[a + 8] * beta + keys[b + 8] * alpha;
  const sz = keys[a + 9] * beta + keys[b + 9] * alpha;
  // Column-major translation * rotation * scale
  out[0] = (1 - 2 * (y * y + z * z)) * sx;
  out[1] = 2 * (x * y + z * w) * sx;
  out[2] = 2 * (x * z - y * w) * sx;
  out[3] = 0;
  out[4] = 2 * (x * y - z * w) * sy;
  out[5] = (1 - 2 * (x * x + z * z)) * sy;
  out[6] = 2 * (y * z + x * w) * sy;
  out[7] = 0;
  out[8] = 2 * (x * z + y * w) * sz;
  out[9] = 2 * (y * z - x * w) * sz;
  out[10] = (1 - 2 * (x * x + y * y)) * sz;
  out[11] = 0;
  out[12] = keys[a] * beta + keys[b] * alpha;
  out[13] = keys[a + 1] * beta + keys[b + 1] * alpha;
  out[14] = keys[a + 2] * beta + keys[b + 2] * alpha;
  out[15] = 1;
  return out;
}
