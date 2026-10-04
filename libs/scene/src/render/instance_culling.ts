import { DEBUG_VIEWS, DRef } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { BindGroup, GPUDataBuffer, GPUProgram } from '@zephyr3d/device';
import { Vector3 } from '@zephyr3d/base';
import type { Camera } from '../camera/camera';
import type { Mesh } from '../scene/mesh';
import { getDevice } from '../app/api';
import { ShaderHelper } from '../material/shader/helper';
import type { Drawable } from './drawable';
import type { Primitive } from './primitive';
import type { CachedBindGroup, RenderQueue, RenderQueueItem } from './render_queue';

const tmpViewPos = new Vector3();

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
/** uint32 in the indirect arguments of one draw: indexCount, instanceCount, firstIndex, baseVertex, firstInstance */
const ARGS_U32 = 5;
/** vec4s describing one batch, see CullGroup.batches */
const BATCH_VEC4S = 4;
/** Most levels of detail a batch selects among, MAX_MESH_LODS */
const MAX_LODS = 8;
/** Sets of arguments: the solid ones, and with debug views those of the wireframe edges */
const EDGE_ARGS_SETS = DEBUG_VIEWS ? 2 : 1;

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
  /** Byte offset of the arguments of the first level */
  argsOffset: number;
  /**
   * Levels of detail the instances are spread over by culling, each drawn from its own arguments
   * following the first, 20 bytes apart; 1 when the level was chosen on the CPU
   */
  lodCount: number;
  /** Primitive the arguments draw */
  primitive: Primitive;
  /**
   * Byte offset of the arguments of the first level for the edges of the primitive in a wireframe
   * view, laid out as the solid ones: culling writes them with twice the index count and first
   * index, see Primitive.drawIndirect. -1 without debug views.
   */
  edgeArgsOffset: number;
}

/** Culling resources for the batches whose instance data lives in one instance bind group */
interface CullGroup {
  source: CachedBindGroup;
  /** Instance data left after culling, bound as the instance data uniform buffer when drawing */
  output: DRef<GPUDataBuffer>;
  outputBindGroup: DRef<BindGroup>;
  /**
   * Local bounds of the instances by slot: (center, always visible), (half extent, level of
   * detail limit: the finest level allowed, or -(level + 1) for a forced level)
   */
  bounds: DRef<GPUDataBuffer>;
  boundsData: Float32Array<ArrayBuffer>;
  boundsDirty: boolean;
  /**
   * Per batch, BATCH_VEC4S vec4s: (first vec4 of the instances, instance count, vec4s per
   * instance, index of the arguments of the first level), (level count, 0, 0, 0), then the screen
   * sizes of levels 1 to 7, the last component unused
   */
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
  private static readonly _lodView = new Float32Array(4);
  private static readonly _lodParams = new Float32Array(4);
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
   * Whether culling also selects the level of detail of each instance of a drawable, which then
   * joins one batch with all its levels rather than one batch per level. Needs indirect draws to
   * start at a level's first instance, and levels, which are index ranges.
   */
  static selectsLod(drawable: Drawable) {
    const primitive = drawable.getPrimitive();
    return (
      !!primitive &&
      primitive.lodCount > 1 &&
      !!primitive.getIndexBuffer() &&
      !!getDevice().getDeviceCaps().miscCaps.supportIndirectFirstInstance
    );
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
    const lodCounts = items.map((item) =>
      InstanceCuller.selectsLod(item.drawable) ? item.drawable.getPrimitive()!.lodCount : 1
    );
    const argsCount = lodCounts.reduce((sum, n) => sum + n, 0);
    // Also allocated with no batches, the arguments of a group whose meshes are not batched yet
    if (!this._args.get() || argsCount > this._argsCapacity) {
      this._argsCapacity = Math.max(argsCount, this._argsCapacity * 2, 16);
      // Solid arguments, then with debug views the edge arguments of wireframe draws at the same
      // index plus capacity
      this._args.set(
        device.createBuffer(this._argsCapacity * EDGE_ARGS_SETS * ARGS_U32 * 4, {
          usage: 'indirect',
          storage: true
        })
      );
      // Groups bind the arguments buffer, so they are rebound below
      for (const group of this._groups.values()) {
        group.computeBindGroup.dispose();
      }
    }
    const args = new Uint32Array(this._argsCapacity * EDGE_ARGS_SETS * ARGS_U32);
    let argsBase = 0;
    items.forEach((item, index) => {
      const data = item.instanceData!;
      const primitive = item.drawable.getPrimitive();
      const lodCount = lodCounts[index];
      const base = argsBase;
      argsBase += lodCount;
      if (!primitive) {
        data.culled = null;
        return;
      }
      const group = this.getGroup(data.bindGroup);
      used.add(group);
      // The one level chosen on the CPU, or every level of the primitive for culling to choose from
      for (let level = 0; level < lodCount; level++) {
        const [first, count] = primitive.getLodRange(lodCount > 1 ? level : (item.lod ?? 0));
        args[(base + level) * ARGS_U32] = count;
        args[(base + level) * ARGS_U32 + 2] = first;
      }
      let batches = batchData.get(group);
      if (!batches) {
        batches = [];
        batchData.set(group, batches);
      }
      const sizes = new Array<number>(MAX_LODS).fill(0);
      if (lodCount > 1) {
        primitive.lods.forEach((lod, i) => (sizes[i] = lod.screenSize));
      }
      batches.push(data.offset >> 2, data.numInstances, data.stride >> 2, base, lodCount, 0, 0, 0, ...sizes);
      data.culled = {
        bindGroup: group.outputBindGroup.get()!,
        argsBuffer: this._args.get()!,
        argsOffset: base * ARGS_U32 * 4,
        lodCount,
        primitive,
        edgeArgsOffset: DEBUG_VIEWS ? (this._argsCapacity + base) * ARGS_U32 * 4 : -1
      };
    });
    this._args.get()!.bufferSubData(0, args);
    for (const [group, batches] of batchData) {
      group.batchCount = batches.length / (BATCH_VEC4S * 4);
      if (!group.batches.get()) {
        group.batches.set(device.createBuffer(MAX_BATCHES * BATCH_VEC4S * 16, { usage: 'uniform' }));
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
   * Levels of detail are selected for the queue's level of detail camera, the main camera in a
   * shadow view.
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
    this.setLodView(parent.lodCamera ?? camera);
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
      InstanceCuller._params[1] = this._argsCapacity;
      bindGroup.setValue('params', InstanceCuller._params);
      bindGroup.setValue('planes', InstanceCuller._planes);
      bindGroup.setValue('lodView', InstanceCuller._lodView);
      bindGroup.setValue('lodParams', InstanceCuller._lodParams);
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
  /** View position and projection scale the levels of detail are measured with, as computeBoundsScreenRadiusSquared */
  private setLodView(camera: Camera) {
    const pos = camera.getWorldPosition(tmpViewPos);
    const proj = camera.getProjectionMatrix();
    const view = InstanceCuller._lodView;
    view[0] = pos.x;
    view[1] = pos.y;
    view[2] = pos.z;
    view[3] = camera.isPerspective() ? 1 : 0;
    const params = InstanceCuller._lodParams;
    params[0] = Math.max(0.5 * Math.abs(proj.m00), 0.5 * Math.abs(proj.m11));
    params[1] = camera.lodDistanceScale;
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
    const mesh = (node.isMesh() ? node : null) as Nullable<Mesh>;
    const forcedLod = mesh?.forcedLod ?? -1;
    data[o + 7] = forcedLod >= 0 ? -(forcedLod + 1) : (mesh?.minLod ?? 0);
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
          // (batch count, index of the edge arguments of the first draw, unused, unused)
          this.params = pb.vec4().uniform(0);
          this.planes = pb.vec4[6]().uniform(0);
          // Level of detail view: (position, 1 if perspective), (screen multiple, distance scale, 0, 0)
          this.lodView = pb.vec4().uniform(0);
          this.lodParams = pb.vec4().uniform(0);
          this.src = pb.vec4[INSTANCE_DATA_VEC4S]().uniformBuffer(0);
          this.dst = pb.vec4[0]().storageBuffer(0);
          this.bounds = pb.vec4[0]().storageBufferReadonly(0);
          this.batches = pb.vec4[MAX_BATCHES * BATCH_VEC4S]().uniformBuffer(0);
          this.args = pb.uint[0]().storageBuffer(0);
          this.visibility = pb.uint[MAX_BATCH_INSTANCES]().workgroup();
          this.position = pb.uint[MAX_BATCH_INSTANCES]().workgroup();
          // Visible instances per level, then where the next instance of each level goes
          this.levelCount = pb.uint[MAX_LODS]().workgroup();
          this.levelNext = pb.uint[MAX_LODS]().workgroup();
          pb.func('classify', [pb.uint('base'), pb.uint('batchIndex')], function () {
            this.$l.slot = pb.div(this.base, MIN_INSTANCE_VEC4S);
            this.$l.center = this.bounds.at(pb.mul(this.slot, 2));
            this.$l.visible = true;
            this.$l.extent4 = this.bounds.at(pb.add(pb.mul(this.slot, 2), 1));
            this.$l.extent = this.extent4.xyz;
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
            this.visible = pb.or(this.visible, pb.greaterThan(this.center.w, 0));
            this.$l.lodCount = pb.int(this.batches.at(pb.add(this.batchIndex, 1)).x);
            this.$l.limit = pb.int(this.extent4.w);
            this.$l.level = pb.int(0);
            this.$if(pb.lessThan(this.limit, 0), function () {
              // Forced level
              this.level = pb.min(pb.sub(pb.neg(this.limit), 1), pb.sub(this.lodCount, 1));
            }).$else(function () {
              this.$l.toView = pb.sub(this.wc, this.lodView.xyz);
              this.$l.distSq = pb.select(
                pb.float(1),
                pb.max(pb.dot(this.toView, this.toView), 1e-4),
                pb.greaterThan(this.lodView.w, 0)
              );
              this.$l.screenRadius = pb.mul(this.lodParams.x, pb.length(this.we));
              this.$l.r2 = pb.div(pb.mul(this.screenRadius, this.screenRadius), this.distSq);
              this.$l.sizes0 = this.batches.at(pb.add(this.batchIndex, 2));
              this.$l.sizes1 = this.batches.at(pb.add(this.batchIndex, 3));
              // Sizes shrink level by level, so the last level still larger than the projected
              // size is the coarsest one, the first ComputeStaticMeshLOD finds from the end
              this.$l.size1 = pb.mul(this.sizes0.x, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(1, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size1, this.size1), 0.25), this.r2)
                ),
                function () {
                  this.level = 1;
                }
              );
              this.$l.size2 = pb.mul(this.sizes0.y, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(2, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size2, this.size2), 0.25), this.r2)
                ),
                function () {
                  this.level = 2;
                }
              );
              this.$l.size3 = pb.mul(this.sizes0.z, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(3, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size3, this.size3), 0.25), this.r2)
                ),
                function () {
                  this.level = 3;
                }
              );
              this.$l.size4 = pb.mul(this.sizes0.w, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(4, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size4, this.size4), 0.25), this.r2)
                ),
                function () {
                  this.level = 4;
                }
              );
              this.$l.size5 = pb.mul(this.sizes1.x, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(5, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size5, this.size5), 0.25), this.r2)
                ),
                function () {
                  this.level = 5;
                }
              );
              this.$l.size6 = pb.mul(this.sizes1.y, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(6, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size6, this.size6), 0.25), this.r2)
                ),
                function () {
                  this.level = 6;
                }
              );
              this.$l.size7 = pb.mul(this.sizes1.z, this.lodParams.y);
              this.$if(
                pb.and(
                  pb.lessThan(7, this.lodCount),
                  pb.greaterThan(pb.mul(pb.mul(this.size7, this.size7), 0.25), this.r2)
                ),
                function () {
                  this.level = 7;
                }
              );
              // Without bounds there is no projected size: the finest level allowed
              this.$if(pb.greaterThan(this.center.w, 0), function () {
                this.level = 0;
              });
              this.level = pb.max(this.level, pb.min(this.limit, pb.sub(this.lodCount, 1)));
            });
            this.$return(pb.select(pb.uint(0), pb.add(pb.uint(this.level), 1), this.visible));
          });
          pb.main(function () {
            this.$l.lid = this.$builtins.localInvocationId.x;
            this.$l.batchIndex = pb.mul(this.$builtins.workGroupId.x, BATCH_VEC4S);
            this.$l.batch = this.batches.at(this.batchIndex);
            this.$l.first = pb.uint(this.batch.x);
            this.$l.count = pb.uint(this.batch.y);
            this.$l.stride = pb.uint(this.batch.z);
            this.$l.argsBase = pb.uint(this.batch.w);
            this.$l.lodCount = pb.uint(this.batches.at(pb.add(this.batchIndex, 1)).x);
            this.$l.chunks = pb.div(pb.add(this.count, WORKGROUP_SIZE - 1), WORKGROUP_SIZE);
            // Barriers stay at the top level of the entry point, where control flow is
            // uniform: the loops around them read bounds from buffers WGSL takes for non-uniform
            this.$for(pb.uint('c'), 0, this.chunks, function () {
              this.$l.k = pb.add(pb.mul(this.c, WORKGROUP_SIZE), this.lid);
              this.$if(pb.lessThan(this.k, this.count), function () {
                this.visibility.setAt(
                  this.k,
                  this.classify(pb.add(this.first, pb.mul(this.k, this.stride)), this.batchIndex)
                );
              });
            });
            pb.workgroupBarrier();
            // Order preserving positions of the visible instances, a few hundred at most, grouped
            // by level: the instances of a level follow those of the finer levels, and each level
            // draws from its own arguments, starting at its first instance
            this.$if(pb.equal(this.lid, 0), function () {
              this.$for(pb.uint('l'), 0, MAX_LODS, function () {
                this.levelCount.setAt(this.l, 0);
              });
              this.$for(pb.uint('i'), 0, this.count, function () {
                this.$l.v = this.visibility.at(this.i);
                this.$if(pb.notEqual(this.v, 0), function () {
                  this.$l.lv = pb.sub(this.v, 1);
                  this.levelCount.setAt(this.lv, pb.add(this.levelCount.at(this.lv), 1));
                });
              });
              this.$l.start = pb.uint(0);
              this.$for(pb.uint('l'), 0, this.lodCount, function () {
                this.$l.a = pb.mul(pb.add(this.argsBase, this.l), ARGS_U32);
                this.args.setAt(pb.add(this.a, 1), this.levelCount.at(this.l));
                this.args.setAt(pb.add(this.a, 4), this.start);
                if (DEBUG_VIEWS) {
                  // The same instances for the wireframe edges, whose index buffer holds 6 edge
                  // indices per triangle, twice the triangle indices
                  this.$l.e = pb.add(this.a, pb.mul(pb.uint(this.params.y), ARGS_U32));
                  this.args.setAt(this.e, pb.mul(this.args.at(this.a), 2));
                  this.args.setAt(pb.add(this.e, 1), this.levelCount.at(this.l));
                  this.args.setAt(pb.add(this.e, 2), pb.mul(this.args.at(pb.add(this.a, 2)), 2));
                  this.args.setAt(pb.add(this.e, 4), this.start);
                }
                this.levelNext.setAt(this.l, this.start);
                this.start = pb.add(this.start, this.levelCount.at(this.l));
              });
              this.$for(pb.uint('i'), 0, this.count, function () {
                this.$l.v = this.visibility.at(this.i);
                this.$if(pb.notEqual(this.v, 0), function () {
                  this.$l.lv = pb.sub(this.v, 1);
                  this.position.setAt(this.i, this.levelNext.at(this.lv));
                  this.levelNext.setAt(this.lv, pb.add(this.levelNext.at(this.lv), 1));
                });
              });
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
