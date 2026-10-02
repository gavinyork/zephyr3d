import { DRef } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { BindGroup, GPUDataBuffer, GPUProgram } from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import { getDevice } from '../app/api';
import { ShaderHelper } from '../material/shader/helper';
import type { Drawable } from './drawable';
import type { Primitive } from './primitive';
import type { CachedBindGroup, RenderQueue, RenderQueueItem } from './render_queue';

/** Threads of one workgroup, culling the instances of one batch */
const WORKGROUP_SIZE = 64;
/** vec4s in the instance data uniform buffer */
const INSTANCE_DATA_VEC4S = 65536 >> 4;
/**
 * Fewest vec4s an instance takes in the instance data, its world and previous world matrices and
 * framestamp. Instances start at least this far apart, so their vec4 offset divided by it numbers
 * them, which indexes their bounds.
 */
const MIN_INSTANCE_VEC4S = ShaderHelper.MATERIAL_INSTANCE_DATA_OFFSET;
const MAX_BOUNDS_SLOTS = Math.ceil(INSTANCE_DATA_VEC4S / MIN_INSTANCE_VEC4S);
/** Most instances one batch can hold */
const MAX_BATCH_INSTANCES = MAX_BOUNDS_SLOTS;
/**
 * Most batches one instance bind group holds, each instance taking at least MIN_INSTANCE_VEC4S.
 * Batch descriptors are read from a uniform buffer, since loop bounds around workgroup barriers
 * must be uniform, which values read from storage buffers are not.
 */
const MAX_BATCHES = 512;
/** uint32 in the indirect arguments of one batch: indexCount, instanceCount, firstIndex, baseVertex, firstInstance */
const ARGS_U32 = 5;

/**
 * Draw arguments of a batch whose instances are culled on the GPU.
 *
 * @public
 */
export interface InstanceCullingDraw {
  /** Group 3 bind group holding the instances left after culling, laid out as the source */
  bindGroup: BindGroup;
  /** Indirect draw arguments, the instance count written by culling */
  argsBuffer: GPUDataBuffer;
  /** Byte offset of the arguments */
  argsOffset: number;
  /** Primitive the arguments draw; any other (an edge primitive) draws unculled */
  primitive: Primitive;
}

/** Culling resources for the batches whose instance data lives in one instance bind group */
interface CullGroup {
  source: CachedBindGroup;
  /** Instance data left after culling, bound as the instance data uniform buffer when drawing */
  output: DRef<GPUDataBuffer>;
  outputBindGroup: DRef<BindGroup>;
  /** Local bounds of the instances by slot: (center, always visible), (half extent, unused) */
  bounds: DRef<GPUDataBuffer>;
  boundsData: Float32Array<ArrayBuffer>;
  boundsDirty: boolean;
  /** Per batch: (first vec4 of the instances, instance count, vec4s per instance, arguments index) */
  batches: DRef<GPUDataBuffer>;
  batchCount: number;
  computeBindGroup: DRef<BindGroup>;
}

/**
 * Frustum culling of the instances of batched draws on the GPU, for render queues whose batches
 * are recorded once and replayed (BatchGroup).
 *
 * @remarks
 * Such a queue serves every view it is pushed to (main camera, every shadow cascade and cube
 * face) and replays render bundles recorded once, so what a view sees cannot be baked into the
 * draws. Instead each batch draws indirectly from arguments and instance data that a compute pass
 * fills for the view right before its draws: every instance's local bounds, transformed by the
 * world matrix in its instance data, are tested against the planes of the view's cull camera the
 * same way {@link CullVisitor} tests bounding boxes on the CPU, and the instances left are packed,
 * in order, into a copy of the instance data. Vertex shaders and materials read it as usual.
 *
 * WebGPU only.
 *
 * @internal
 */
export class InstanceCuller {
  private static _program: Nullable<GPUProgram> = null;
  private static readonly _planes = new Float32Array(24);
  private static readonly _params = new Float32Array(4);
  private readonly _groups: Map<CachedBindGroup, CullGroup>;
  private readonly _args: DRef<GPUDataBuffer>;
  private _argsCapacity: number;
  /** Bounds slot of each instance, by drawable */
  private readonly _slots: Map<Drawable, { group: CullGroup; slot: number }>;
  private _lastParent: Nullable<RenderQueue>;
  private _lastFrame: number;
  constructor() {
    this._groups = new Map();
    this._args = new DRef();
    this._argsCapacity = 0;
    this._slots = new Map();
    this._lastParent = null;
    this._lastFrame = -1;
  }
  /** Whether the device can cull instances on the GPU */
  static isSupported() {
    const device = getDevice();
    return device.type === 'webgpu' && !!device.getDeviceCaps().miscCaps.supportDrawIndirect;
  }
  /**
   * Set the batches up for culling after the queue built them.
   *
   * @param items - Instanced batches of the queue
   * @param instanceInfo - Instance data block of each batched drawable
   */
  rebuild(
    items: RenderQueueItem[],
    instanceInfo: Map<Drawable, { bindGroup: CachedBindGroup; offset: number }>
  ) {
    const device = getDevice();
    this._slots.clear();
    this._lastParent = null;
    const used = new Set<CullGroup>();
    const batchData = new Map<CullGroup, number[]>();
    // Also allocated with no batches, the arguments of a group whose meshes are not batched yet
    if (!this._args.get() || items.length > this._argsCapacity) {
      this._argsCapacity = Math.max(items.length, this._argsCapacity * 2, 16);
      this._args.set(
        device.createBuffer(this._argsCapacity * ARGS_U32 * 4, { usage: 'indirect', storage: true })
      );
      // Groups bind the arguments buffer, so they are rebound below
      for (const group of this._groups.values()) {
        group.computeBindGroup.dispose();
      }
    }
    const args = new Uint32Array(this._argsCapacity * ARGS_U32);
    items.forEach((item, index) => {
      const data = item.instanceData!;
      const primitive = item.drawable.getPrimitive();
      const lod = item.lod ?? 0;
      if (!primitive) {
        data.culled = null;
        return;
      }
      const group = this.getGroup(data.bindGroup);
      used.add(group);
      const [first, count] = primitive.getLodRange(lod);
      args[index * ARGS_U32] = count;
      args[index * ARGS_U32 + 2] = first;
      let batches = batchData.get(group);
      if (!batches) {
        batches = [];
        batchData.set(group, batches);
      }
      batches.push(data.offset >> 2, data.numInstances, data.stride >> 2, index);
      data.culled = {
        bindGroup: group.outputBindGroup.get()!,
        argsBuffer: this._args.get()!,
        argsOffset: index * ARGS_U32 * 4,
        primitive
      };
    });
    this._args.get()!.bufferSubData(0, args);
    for (const [group, batches] of batchData) {
      group.batchCount = batches.length / 4;
      if (!group.batches.get()) {
        group.batches.set(device.createBuffer(MAX_BATCHES * 16, { usage: 'uniform' }));
        group.computeBindGroup.dispose();
      }
      group.batches.get()!.bufferSubData(0, new Float32Array(batches));
    }
    for (const [key, group] of this._groups) {
      if (!used.has(group)) {
        this.releaseGroup(group);
        this._groups.delete(key);
      }
    }
    for (const [drawable, info] of instanceInfo) {
      const group = this._groups.get(info.bindGroup);
      if (group) {
        const entry = { group, slot: Math.floor(info.offset / 4 / MIN_INSTANCE_VEC4S) };
        this._slots.set(drawable, entry);
        this.writeBounds(drawable, entry);
      }
    }
  }
  /** Have the local bounds of a batched drawable uploaded again before the next culling */
  markBoundsDirty(drawable: Drawable) {
    const entry = this._slots.get(drawable);
    if (entry) {
      this.writeBounds(drawable, entry);
    }
  }
  /**
   * Cull the batches for the view a queue was culled for, unless they were last culled for it.
   *
   * @param parent - Queue of the view, which this queue was pushed to
   */
  cull(parent: RenderQueue) {
    const camera = parent.cullCamera;
    if (!camera || this._groups.size === 0) {
      return;
    }
    const frame = getDevice().frameInfo.frameCounter;
    if (this._lastParent === parent && this._lastFrame === frame) {
      return;
    }
    this._lastParent = parent;
    this._lastFrame = frame;
    this.setPlanes(camera);
    const device = getDevice();
    const program = InstanceCuller.getProgram();
    for (const group of this._groups.values()) {
      if (group.batchCount === 0) {
        continue;
      }
      if (group.boundsDirty) {
        group.bounds.get()!.bufferSubData(0, group.boundsData);
        group.boundsDirty = false;
      }
      let bindGroup = group.computeBindGroup.get();
      if (!bindGroup) {
        bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
        bindGroup.setBuffer(
          'src',
          group.source.bindGroup.getBuffer(ShaderHelper.getInstanceDataUniformName())!
        );
        bindGroup.setBuffer('dst', group.output.get()!);
        bindGroup.setBuffer('bounds', group.bounds.get()!);
        bindGroup.setBuffer('batches', group.batches.get()!);
        bindGroup.setBuffer('args', this._args.get()!);
        group.computeBindGroup.set(bindGroup);
      }
      InstanceCuller._params[0] = group.batchCount;
      bindGroup.setValue('params', InstanceCuller._params);
      bindGroup.setValue('planes', InstanceCuller._planes);
      device.setProgram(program);
      device.setBindGroup(0, bindGroup);
      device.compute(group.batchCount, 1, 1);
    }
  }
  /** Release all GPU resources */
  dispose() {
    for (const group of this._groups.values()) {
      this.releaseGroup(group);
    }
    this._groups.clear();
    this._slots.clear();
    this._args.dispose();
    this._argsCapacity = 0;
  }
  /** Planes of the cull camera, those masked out by it made ones everything is inside of */
  private setPlanes(camera: Camera) {
    const planes = InstanceCuller._planes;
    const frustumPlanes = camera.frustum.planes;
    const mask = camera.clipMask || 0x3f;
    for (let i = 0; i < 6; i++) {
      const p = frustumPlanes[i];
      const enabled = !!(mask & (1 << i));
      planes[i * 4] = enabled ? p.a : 0;
      planes[i * 4 + 1] = enabled ? p.b : 0;
      planes[i * 4 + 2] = enabled ? p.c : 0;
      planes[i * 4 + 3] = enabled ? p.d : 1e30;
    }
  }
  private writeBounds(drawable: Drawable, entry: { group: CullGroup; slot: number }) {
    const node = drawable.getNode();
    const bv = node.clipTestEnabled ? (node.getBoundingVolume()?.toAABB() ?? null) : null;
    const data = entry.group.boundsData;
    const o = entry.slot * 8;
    if (bv) {
      const min = bv.minPoint;
      const max = bv.maxPoint;
      data[o] = (min.x + max.x) * 0.5;
      data[o + 1] = (min.y + max.y) * 0.5;
      data[o + 2] = (min.z + max.z) * 0.5;
      data[o + 3] = 0;
      data[o + 4] = (max.x - min.x) * 0.5;
      data[o + 5] = (max.y - min.y) * 0.5;
      data[o + 6] = (max.z - min.z) * 0.5;
    } else {
      // No bounds, or clip testing turned off for the node: always drawn
      data[o + 3] = 1;
    }
    entry.group.boundsDirty = true;
  }
  private getGroup(source: CachedBindGroup) {
    let group = this._groups.get(source);
    if (!group) {
      const device = getDevice();
      const output = device.createBuffer(INSTANCE_DATA_VEC4S * 16, { usage: 'uniform', storage: true });
      const outputBindGroup = device.createBindGroup(source.bindGroup.getLayout());
      outputBindGroup.setBuffer(ShaderHelper.getInstanceDataUniformName(), output);
      const boundsData = new Float32Array(MAX_BOUNDS_SLOTS * 8);
      group = {
        source,
        output: new DRef(output),
        outputBindGroup: new DRef(outputBindGroup),
        bounds: new DRef(device.createBuffer(boundsData.byteLength, { usage: 'uniform', storage: true })),
        boundsData,
        boundsDirty: true,
        batches: new DRef(),
        batchCount: 0,
        computeBindGroup: new DRef()
      };
      this._groups.set(source, group);
    }
    return group;
  }
  private releaseGroup(group: CullGroup) {
    group.output.dispose();
    group.outputBindGroup.dispose();
    group.bounds.dispose();
    group.batches.dispose();
    group.computeBindGroup.dispose();
  }
  private static getProgram() {
    if (!this._program) {
      this._program = getDevice().buildComputeProgram({
        label: 'InstanceCulling',
        workgroupSize: [WORKGROUP_SIZE, 1, 1],
        compute(pb) {
          // (batch count, unused, unused, unused)
          this.params = pb.vec4().uniform(0);
          this.planes = pb.vec4[6]().uniform(0);
          this.src = pb.vec4[INSTANCE_DATA_VEC4S]().uniformBuffer(0);
          this.dst = pb.vec4[0]().storageBuffer(0);
          this.bounds = pb.vec4[0]().storageBufferReadonly(0);
          this.batches = pb.vec4[MAX_BATCHES]().uniformBuffer(0);
          this.args = pb.uint[0]().storageBuffer(0);
          this.visibility = pb.uint[MAX_BATCH_INSTANCES]().workgroup();
          this.position = pb.uint[MAX_BATCH_INSTANCES]().workgroup();
          // AABB against the planes as AABB.getClipStateWithFrustum(): outside when its corner
          // farthest along a plane's normal is behind it. No early return, which would make the
          // control flow of the caller non-uniform for the workgroup barriers that follow
          pb.func('isVisible', [pb.uint('base')], function () {
            this.$l.slot = pb.div(this.base, MIN_INSTANCE_VEC4S);
            this.$l.center = this.bounds.at(pb.mul(this.slot, 2));
            this.$l.visible = true;
            this.$l.extent = this.bounds.at(pb.add(pb.mul(this.slot, 2), 1)).xyz;
            // World matrix by columns, the first four vec4s of the instance
            this.$l.c0 = this.src.at(this.base).xyz;
            this.$l.c1 = this.src.at(pb.add(this.base, 1)).xyz;
            this.$l.c2 = this.src.at(pb.add(this.base, 2)).xyz;
            this.$l.c3 = this.src.at(pb.add(this.base, 3)).xyz;
            this.$l.wc = pb.add(
              pb.mul(this.c0, this.center.x),
              pb.mul(this.c1, this.center.y),
              pb.mul(this.c2, this.center.z),
              this.c3
            );
            this.$l.we = pb.add(
              pb.mul(pb.abs(this.c0), this.extent.x),
              pb.mul(pb.abs(this.c1), this.extent.y),
              pb.mul(pb.abs(this.c2), this.extent.z)
            );
            this.$for(pb.int('i'), 0, 6, function () {
              this.$l.p = this.planes.at(this.i);
              this.$if(
                pb.lessThan(
                  pb.add(pb.dot(this.p.xyz, this.wc), pb.dot(pb.abs(this.p.xyz), this.we), this.p.w),
                  0
                ),
                function () {
                  this.visible = false;
                }
              );
            });
            // Always drawn without bounds
            this.$return(pb.or(this.visible, pb.greaterThan(this.center.w, 0)));
          });
          pb.main(function () {
            this.$l.lid = this.$builtins.localInvocationId.x;
            this.$l.batch = this.batches.at(this.$builtins.workGroupId.x);
            this.$l.first = pb.uint(this.batch.x);
            this.$l.count = pb.uint(this.batch.y);
            this.$l.stride = pb.uint(this.batch.z);
            this.$l.argsIndex = pb.uint(this.batch.w);
            this.$l.chunks = pb.div(pb.add(this.count, WORKGROUP_SIZE - 1), WORKGROUP_SIZE);
            // Barriers stay at the top level of the entry point, where control flow is
            // uniform: the loops around them read bounds from buffers WGSL takes for non-uniform
            this.$for(pb.uint('c'), 0, this.chunks, function () {
              this.$l.k = pb.add(pb.mul(this.c, WORKGROUP_SIZE), this.lid);
              this.$if(pb.lessThan(this.k, this.count), function () {
                this.visibility.setAt(
                  this.k,
                  pb.select(
                    pb.uint(0),
                    pb.uint(1),
                    this.isVisible(pb.add(this.first, pb.mul(this.k, this.stride)))
                  )
                );
              });
            });
            pb.workgroupBarrier();
            // Order preserving positions of the visible instances, a few hundred at most
            this.$if(pb.equal(this.lid, 0), function () {
              this.$l.total = pb.uint(0);
              this.$for(pb.uint('i'), 0, this.count, function () {
                this.position.setAt(this.i, this.total);
                this.total = pb.add(this.total, this.visibility.at(this.i));
              });
              this.args.setAt(pb.add(pb.mul(this.argsIndex, ARGS_U32), 1), this.total);
            });
            pb.workgroupBarrier();
            this.$for(pb.uint('c'), 0, this.chunks, function () {
              this.$l.k = pb.add(pb.mul(this.c, WORKGROUP_SIZE), this.lid);
              this.$if(pb.lessThan(this.k, this.count), function () {
                this.$if(pb.notEqual(this.visibility.at(this.k), 0), function () {
                  this.$l.src0 = pb.add(this.first, pb.mul(this.k, this.stride));
                  this.$l.dst0 = pb.add(this.first, pb.mul(this.position.at(this.k), this.stride));
                  this.$for(pb.uint('j'), 0, this.stride, function () {
                    this.dst.setAt(pb.add(this.dst0, this.j), this.src.at(pb.add(this.src0, this.j)));
                  });
                });
              });
            });
          });
        }
      })!;
    }
    return this._program;
  }
}
