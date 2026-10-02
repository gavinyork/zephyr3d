import { DRef } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { BindGroup, GPUDataBuffer, GPUProgram } from '@zephyr3d/device';
import { getDevice } from '../app/api';
import type { AnimationBank, AnimationBankTrack } from './animation_bank';
import { SkinPaletteAtlas } from './skin_palette_atlas';

/** Threads in one workgroup, one joint of one job each */
const WORKGROUP_SIZE = 64;
/** Floats in one baked joint key, as `KEY_FLOATS` of animation_bank.ts */
const KEY_FLOATS = 10;
/** vec4s describing one job: (key offset, frame count, play length, time), (output slot, -, -, -) */
const JOB_VEC4S = 2;

/** GPU copies of the baked keys and inverse bind matrices of one bank */
interface BankResources {
  keys: DRef<GPUDataBuffer>;
  inverseBind: DRef<GPUDataBuffer>;
  jobs: DRef<GPUDataBuffer>;
  jobCapacity: number;
  jobData: Float32Array<ArrayBuffer>;
  bindGroup: DRef<BindGroup>;
  /** Offset of the keys of each entry in the key buffer, in floats */
  entryOffsets: number[];
}

/**
 * Evaluates the palettes of animation bank tracks in a compute pass, following `BankEvaluateCS`
 * of UE (Shaders/Private/Skinning/AnimBankEval.usf).
 *
 * @remarks
 * Each job poses every joint of one palette set at one time; a track runs two jobs per frame, its
 * current and its previous position, into fixed sets of its palette block. Unlike the
 * double-buffered sets of the CPU path, both are written each frame, which also makes the GPU
 * slots immune to rows of the atlas being re-uploaded from its CPU mirror: evaluation is
 * dispatched after every upload. UE does the same for the previous pose when it is not a copy of
 * the current one (`EPreviousBoneTransformUpdateMode::UpdatePrevious`).
 *
 * WebGPU only, since it writes the atlas as a storage texture.
 *
 * @internal
 */
export class AnimationBankGpuEvaluator {
  private static _program: Nullable<GPUProgram> = null;
  private static readonly _banks: Map<
    AnimationBank,
    { tracks: Set<AnimationBankTrack>; res: BankResources }
  > = new Map();
  private static _listening = false;
  private static _dispatchFrame = -1;
  private static readonly _params = new Float32Array(4);
  /** Whether palettes can be evaluated on the device */
  static isSupported() {
    return getDevice().type === 'webgpu';
  }
  /** Evaluate a track on the GPU from now on */
  static addTrack(track: AnimationBankTrack) {
    const bank = track.bank;
    let info = this._banks.get(bank);
    if (!info) {
      info = { tracks: new Set(), res: this.createResources(bank) };
      this._banks.set(bank, info);
    }
    info.tracks.add(track);
    if (!this._listening) {
      this._listening = true;
      SkinPaletteAtlas.addUploadListener((uploaded) => this.onAtlasFlushed(uploaded));
    }
  }
  /** Stop evaluating a track, releasing the resources of its bank with its last track */
  static removeTrack(track: AnimationBankTrack) {
    const info = this._banks.get(track.bank);
    if (info?.tracks.delete(track) && info.tracks.size === 0) {
      const res = info.res;
      res.keys.dispose();
      res.inverseBind.dispose();
      res.jobs.dispose();
      res.bindGroup.dispose();
      this._banks.delete(track.bank);
    }
  }
  /**
   * Evaluate once per frame, and again whenever the atlas uploads rows from its CPU mirror,
   * which may hold stale contents for the slots written here
   */
  private static onAtlasFlushed(uploaded: boolean) {
    const frame = getDevice().frameInfo.frameCounter;
    if (this._banks.size > 0 && (uploaded || frame !== this._dispatchFrame)) {
      this._dispatchFrame = frame;
      for (const [bank, info] of this._banks) {
        this.dispatch(bank, info.tracks, info.res);
      }
    }
  }
  private static dispatch(bank: AnimationBank, tracks: Set<AnimationBankTrack>, res: BankResources) {
    const n = bank.jointCount;
    const jobCount = tracks.size * 2;
    if (jobCount === 0 || n === 0) {
      return;
    }
    const device = getDevice();
    if (jobCount > res.jobCapacity) {
      res.jobCapacity = Math.max(jobCount, res.jobCapacity * 2);
      res.jobData = new Float32Array(res.jobCapacity * JOB_VEC4S * 4);
      res.jobs.set(this.createStorageBuffer(res.jobData.byteLength, true));
      res.bindGroup.get()?.setBuffer('jobs', res.jobs.get()!);
    }
    const data = res.jobData;
    let o = 0;
    for (const track of tracks) {
      const entryIndex = track.entryIndex;
      const entry = bank.entries[entryIndex];
      const base = track.paletteBase;
      for (const [time, slot] of [
        [track.position, base + 1],
        [track.previousPosition, base + 1 + n]
      ]) {
        data[o++] = res.entryOffsets[entryIndex];
        data[o++] = entry.frameCount;
        data[o++] = entry.playLength;
        data[o++] = time;
        data[o++] = slot;
        data[o++] = 0;
        data[o++] = 0;
        data[o++] = 0;
      }
    }
    res.jobs.get()!.bufferSubData(0, data, 0, o);
    const atlas = SkinPaletteAtlas.instance;
    const bindGroup = res.bindGroup.get()!;
    this._params[0] = n;
    this._params[1] = jobCount;
    this._params[2] = atlas.width;
    bindGroup.setValue('params', this._params);
    // The atlas texture is replaced when it grows
    bindGroup.setTexture('atlas', atlas.texture);
    device.setProgram(this.getProgram());
    device.setBindGroup(0, bindGroup);
    device.compute(Math.ceil((jobCount * n) / WORKGROUP_SIZE), 1, 1);
  }
  private static createResources(bank: AnimationBank): BankResources {
    const entryOffsets: number[] = [];
    let keyFloats = 0;
    for (const entry of bank.entries) {
      entryOffsets.push(keyFloats);
      keyFloats += entry.keys.length;
    }
    const keyData = new Float32Array(Math.max(4, keyFloats));
    bank.entries.forEach((entry, i) => keyData.set(entry.keys, entryOffsets[i]));
    const inverseBindData = new Float32Array(Math.max(16, bank.jointCount * 16));
    bank.inverseBindMatrices.forEach((m, i) => inverseBindData.set(m, i * 16));
    const keys = this.createStorageBuffer(keyData.byteLength, false);
    keys.bufferSubData(0, keyData);
    const inverseBind = this.createStorageBuffer(inverseBindData.byteLength, false);
    inverseBind.bufferSubData(0, inverseBindData);
    const jobCapacity = 8;
    const jobData = new Float32Array(jobCapacity * JOB_VEC4S * 4);
    const jobs = this.createStorageBuffer(jobData.byteLength, true);
    const bindGroup = getDevice().createBindGroup(this.getProgram().bindGroupLayouts[0]);
    bindGroup.setBuffer('keys', keys);
    bindGroup.setBuffer('inverseBind', inverseBind);
    bindGroup.setBuffer('jobs', jobs);
    return {
      keys: new DRef(keys),
      inverseBind: new DRef(inverseBind),
      jobs: new DRef(jobs),
      jobCapacity,
      jobData,
      bindGroup: new DRef(bindGroup),
      entryOffsets
    };
  }
  private static createStorageBuffer(bytes: number, dynamic: boolean) {
    return getDevice().createBuffer(Math.max(16, bytes), {
      usage: 'uniform',
      storage: true,
      dynamic,
      managed: false
    });
  }
  private static getProgram() {
    if (!this._program) {
      this._program = getDevice().buildComputeProgram({
        label: 'AnimationBankEvaluate',
        workgroupSize: [WORKGROUP_SIZE, 1, 1],
        compute(pb) {
          // (joint count, job count, atlas width, unused)
          this.params = pb.vec4().uniform(0);
          this.keys = pb.float[0]().storageBufferReadonly(0);
          // Columns of the inverse bind matrices, four per joint
          this.inverseBind = pb.vec4[0]().storageBufferReadonly(0);
          this.jobs = pb.vec4[0]().storageBufferReadonly(0);
          this.atlas = pb.texStorage2D.rgba32float().storage(0);
          pb.func('loadRotation', [pb.uint('o')], function () {
            this.$l.q = pb.vec4(
              this.keys.at(pb.add(this.o, 3)),
              this.keys.at(pb.add(this.o, 4)),
              this.keys.at(pb.add(this.o, 5)),
              this.keys.at(pb.add(this.o, 6))
            );
            // QuatNormalize of UE: identity for a degenerate quaternion
            this.$l.len2 = pb.dot(this.q, this.q);
            this.$return(
              pb.select(
                pb.vec4(0, 0, 0, 1),
                pb.mul(this.q, pb.inverseSqrt(this.len2)),
                pb.greaterThan(this.len2, 0)
              )
            );
          });
          pb.func('loadVec3', [pb.uint('o')], function () {
            this.$return(
              pb.vec3(this.keys.at(this.o), this.keys.at(pb.add(this.o, 1)), this.keys.at(pb.add(this.o, 2)))
            );
          });
          pb.main(function () {
            this.$l.n = pb.uint(this.params.x);
            this.$l.gid = this.$builtins.globalInvocationId.x;
            this.$l.job = pb.div(this.gid, this.n);
            this.$if(pb.lessThan(this.job, pb.uint(this.params.y)), function () {
              this.$l.joint = pb.sub(this.gid, pb.mul(this.job, this.n));
              this.$l.desc = this.jobs.at(pb.mul(this.job, JOB_VEC4S));
              this.$l.out = this.jobs.at(pb.add(pb.mul(this.job, JOB_VEC4S), 1));
              this.$l.frameCount = pb.int(this.desc.y);
              this.$l.playLength = this.desc.z;
              this.$l.time = this.desc.w;
              // GetKeyIndicesFromTime of UE, the frame rate derived from the length
              this.$l.key0 = pb.int(0);
              this.$l.key1 = pb.int(0);
              this.$l.alpha = pb.float(0);
              this.$if(pb.and(pb.greaterThan(this.time, 0), pb.greaterThan(this.frameCount, 1)), function () {
                this.$l.lastIndex = pb.sub(this.frameCount, 1);
                this.$if(pb.greaterThanEqual(this.time, this.playLength), function () {
                  this.key0 = this.lastIndex;
                }).$else(function () {
                  this.$l.keyPos = pb.mul(this.time, pb.div(pb.float(this.lastIndex), this.playLength));
                  this.key0 = pb.clamp(pb.int(pb.floor(this.keyPos)), 0, this.lastIndex);
                  this.alpha = pb.sub(this.keyPos, pb.float(this.key0));
                  this.key1 = pb.min(pb.add(this.key0, 1), this.lastIndex);
                });
              });
              this.$l.entry = pb.uint(this.desc.x);
              this.$l.a = pb.add(
                this.entry,
                pb.mul(pb.add(pb.mul(pb.uint(this.key0), this.n), this.joint), pb.uint(KEY_FLOATS))
              );
              this.$l.b = pb.add(
                this.entry,
                pb.mul(pb.add(pb.mul(pb.uint(this.key1), this.n), this.joint), pb.uint(KEY_FLOATS))
              );
              // BlendBoneTransforms of UE: positions linearly, rotations by QuatSlerpApproximate,
              // and scales linearly as BlendBoneTransformsWithScale
              this.$l.qa = this.loadRotation(this.a);
              this.$l.qb = this.loadRotation(this.b);
              this.qb = pb.select(this.qb, pb.neg(this.qb), pb.lessThan(pb.dot(this.qa, this.qb), 0));
              this.$l.q = pb.normalize(pb.mix(this.qa, this.qb, this.alpha));
              this.$l.t = pb.mix(this.loadVec3(this.a), this.loadVec3(this.b), this.alpha);
              this.$l.s = pb.mix(
                this.loadVec3(pb.add(this.a, 7)),
                this.loadVec3(pb.add(this.b, 7)),
                this.alpha
              );
              // Joint pose as translation * rotation * scale, by columns
              this.$l.x = this.q.x;
              this.$l.y = this.q.y;
              this.$l.z = this.q.z;
              this.$l.w = this.q.w;
              this.$l.pose = pb.mat4(
                pb.vec4(
                  pb.mul(
                    pb.vec3(
                      pb.sub(1, pb.mul(2, pb.add(pb.mul(this.y, this.y), pb.mul(this.z, this.z)))),
                      pb.mul(2, pb.add(pb.mul(this.x, this.y), pb.mul(this.z, this.w))),
                      pb.mul(2, pb.sub(pb.mul(this.x, this.z), pb.mul(this.y, this.w)))
                    ),
                    this.s.x
                  ),
                  0
                ),
                pb.vec4(
                  pb.mul(
                    pb.vec3(
                      pb.mul(2, pb.sub(pb.mul(this.x, this.y), pb.mul(this.z, this.w))),
                      pb.sub(1, pb.mul(2, pb.add(pb.mul(this.x, this.x), pb.mul(this.z, this.z)))),
                      pb.mul(2, pb.add(pb.mul(this.y, this.z), pb.mul(this.x, this.w)))
                    ),
                    this.s.y
                  ),
                  0
                ),
                pb.vec4(
                  pb.mul(
                    pb.vec3(
                      pb.mul(2, pb.add(pb.mul(this.x, this.z), pb.mul(this.y, this.w))),
                      pb.mul(2, pb.sub(pb.mul(this.y, this.z), pb.mul(this.x, this.w))),
                      pb.sub(1, pb.mul(2, pb.add(pb.mul(this.x, this.x), pb.mul(this.y, this.y))))
                    ),
                    this.s.z
                  ),
                  0
                ),
                pb.vec4(this.t, 1)
              );
              // Skinning matrix = pose * inverse bind, stored by columns as the CPU path does
              this.$l.slot = pb.add(pb.uint(this.out.x), this.joint);
              this.$l.width = pb.uint(this.params.z);
              this.$l.inv = pb.mul(this.joint, 4);
              this.$for(pb.uint('c'), 0, 4, function () {
                this.$l.texel = pb.add(pb.mul(this.slot, 4), this.c);
                pb.textureStore(
                  this.atlas,
                  pb.uvec2(
                    pb.sub(this.texel, pb.mul(pb.div(this.texel, this.width), this.width)),
                    pb.div(this.texel, this.width)
                  ),
                  pb.mul(this.pose, this.inverseBind.at(pb.add(this.inv, this.c)))
                );
              });
            });
          });
        }
      })!;
    }
    return this._program;
  }
}
