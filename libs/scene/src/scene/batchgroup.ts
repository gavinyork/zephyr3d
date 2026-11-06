import { GraphNode } from './graph_node';
import type { CullVisitor, RenderPass } from '../render';
import { RenderQueue, InstanceBindGroupAllocator } from '../render';
import { InstanceCuller } from '../render/instance_culling';
import type { Scene } from './scene';
import type { Mesh } from './mesh';
import type { SceneNode } from './scene_node';
import { BoundingBox, type BoundingVolume } from '../utility/bounding_volume';
import { Matrix4x4 } from '@zephyr3d/base';

const tmpMatrix = new Matrix4x4();

/** Child meshes of a batch group split by how they are drawn, collected at tag */
interface BatchGroupMeshSplit {
  tag: number;
  /** Meshes the cached queues hold, recorded into render bundles */
  cached: Mesh[];
  /**
   * Meshes whose level of detail the CPU selects from the view, culled like any mesh every frame
   * instead: a cached queue holding them would be rebuilt, with all its render bundles recorded
   * again, whenever one switched level, which happens every few frames while the view moves
   */
  dynamic: Mesh[];
}

/**
 * Batch group node
 * @public
 */
export class BatchGroup extends GraphNode {
  private readonly _renderQueueMap: Map<
    RenderPass,
    {
      queue: RenderQueue;
      tag: number;
      /** Whether the queue was built for a camera coloring levels of detail */
      lodColoration: boolean;
    }
  >;
  private readonly _bindGroupAllocator: InstanceBindGroupAllocator;
  private _changeTag: number;
  /**
   * Child meshes split by how they are drawn, keyed by whether GPU instance culling selects the
   * levels of detail of the queue, see getMeshSplit
   */
  private readonly _meshSplits: Map<boolean, BatchGroupMeshSplit>;
  private _staticBV: boolean;
  private _gpuInstanceCulling: boolean;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._renderQueueMap = new Map();
    this._changeTag = 0;
    this._meshSplits = new Map();
    this._bindGroupAllocator = new InstanceBindGroupAllocator();
    this._staticBV = false;
    this._gpuInstanceCulling = true;
    const bvCallback = (node: SceneNode) => {
      if (!this._staticBV) {
        this.invalidateBoundingVolume();
      }
      // Bounds of the child mesh, transformed or animated
      if (node?.isMesh()) {
        for (const { queue } of this._renderQueueMap.values()) {
          queue.markInstanceBoundsDirty(node);
        }
      }
    };
    const primitiveCallback = () => {
      if (!this._staticBV) {
        this.invalidateBoundingVolume();
      }
      this.invalidate();
    };
    const materialCallback = () => {
      this.invalidate();
    };
    // A forced level decides whether the view selects the mesh's level, so the meshes are split
    // again; cached queues hold forced levels as they were built with, so they are rebuilt too.
    // Levels selected by GPU culling read the level limits of the mesh with its bounds
    const lodCallback = (mesh: Mesh) => {
      for (const { queue } of this._renderQueueMap.values()) {
        queue.markInstanceBoundsDirty(mesh);
      }
      this.invalidate();
    };
    this.on('visiblechanged', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          this.invalidate();
          return true;
        }
        return false;
      });
    });
    this.on('nodeattached', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          child.placeToOctree = false;
          if (!this._staticBV) {
            this.invalidateBoundingVolume();
          }
          child.on('bvchanged', bvCallback);
          child.on('primitive_changed', primitiveCallback);
          child.on('material_changed', materialCallback);
          child.on('lod_changed', lodCallback);
          this.invalidate();
        }
      });
    });
    this.on('noderemoved', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          child.placeToOctree = true;
          if (!this._staticBV) {
            this.invalidateBoundingVolume();
          }
          child.off('bvchanged', bvCallback);
          child.off('primitive_changed', primitiveCallback);
          child.off('material_changed', materialCallback);
          child.off('lod_changed', lodCallback);
          this.invalidate();
        }
      });
    });
  }
  /**
   * Whether the instances of the child meshes are frustum culled on the GPU, for each view the
   * group is drawn in (WebGPU only). Default true.
   *
   * @remarks
   * The group draws its child meshes as batches recorded once, which the CPU only culls as a whole.
   * With this on, each view also drops the meshes it does not see from the batches before drawing
   * them, which cuts the vertex work of large groups seen in part, shadow cascades included.
   */
  get gpuInstanceCulling() {
    return this._gpuInstanceCulling;
  }
  set gpuInstanceCulling(val: boolean) {
    if (val !== this._gpuInstanceCulling) {
      this._gpuInstanceCulling = val;
      for (const { queue } of this._renderQueueMap.values()) {
        queue.dispose();
      }
      this._renderQueueMap.clear();
    }
  }
  /** Gets the batch group name. */
  getName() {
    return this._name;
  }
  /**
   * {@inheritDoc SceneNode.isBatchGroup}
   */
  isBatchGroup(): this is BatchGroup {
    return true;
  }
  /**
   * Force the batch state to be rebuilt
   */
  invalidate() {
    this._changeTag++;
  }
  /** @internal */
  protected _onDetached() {
    super._onDetached();
    // Usually the node will be garbage collected after it is detached,
    // We should reset the render queue to release the render bundles.
    this._renderQueueMap.forEach((val) => {
      val.queue.reset();
    });
    this.invalidate();
  }
  /** @internal */
  protected _onAttached() {
    // Reset the render queue when attached to a new scene.
    this.invalidate();
  }
  /** Release cached queues and their private instance bind groups. */
  protected onDispose() {
    for (const { queue } of this._renderQueueMap.values()) {
      queue.dispose();
    }
    this._renderQueueMap.clear();
    this._bindGroupAllocator.dispose();
    super.onDispose();
  }
  /** @internal */
  computeBoundingVolume() {
    const bv = new BoundingBox();
    const invWorldMatrix = Matrix4x4.invertAffine(this.worldMatrix);
    bv.beginExtend();
    this.iterate((node) => {
      if (node.isMesh()) {
        Matrix4x4.multiplyAffine(invWorldMatrix, node.worldMatrix, tmpMatrix);
        const wb = node.getBoundingVolume()!.transform(tmpMatrix).toAABB();
        bv.extend(wb.minPoint);
        bv.extend(wb.maxPoint);
      }
    });
    return bv.isValid() ? bv : null;
  }
  /** @internal */
  setBoundingVolume(bv: BoundingVolume) {
    this._staticBV = !!bv;
    super.setBoundingVolume(bv);
  }
  /** @internal */
  cull(cullVisitor: CullVisitor) {
    let queueInfo = this._renderQueueMap.get(cullVisitor.renderPass);
    if (!queueInfo) {
      queueInfo = {
        queue: new RenderQueue(cullVisitor.renderPass, this._bindGroupAllocator, this._gpuInstanceCulling),
        tag: -1,
        lodColoration: false
      };
      this._renderQueueMap.set(cullVisitor.renderPass, queueInfo);
    }
    // The cached queue holds its meshes at the levels of detail they were built with, none of
    // which the view selects, so moving the view does not rebuild it
    const lodColoration = !!cullVisitor.camera?.lodColoration;
    const split = this.getMeshSplit(queueInfo.queue.culledOnGpu && !lodColoration);
    if (queueInfo.tag !== this._changeTag || queueInfo.lodColoration !== lodColoration) {
      queueInfo.tag = this._changeTag;
      queueInfo.lodColoration = lodColoration;
      queueInfo.queue.reset();
      const frustumCulling = cullVisitor.frustumCulling;
      const renderQueue = cullVisitor.renderQueue;
      cullVisitor.frustumCulling = false;
      cullVisitor.renderQueue = queueInfo.queue;
      for (const mesh of split.cached) {
        cullVisitor.visit(mesh);
      }
      queueInfo.queue.end(cullVisitor.camera, true, cullVisitor.lodCamera);
      cullVisitor.frustumCulling = frustumCulling;
      cullVisitor.renderQueue = renderQueue;
    } else if (cullVisitor.camera?.getPickResultResolveFunc()) {
      // The queue is kept across frames and was built in one that did not pick, so its drawables
      // have neither their object colors nor a place in the picking lookup
      queueInfo.queue.registerObjectColors();
    }
    cullVisitor.pushRenderQueue(queueInfo.queue);
    // Culled, and their levels selected, in the view's queue as if they were not in the group
    for (const mesh of split.dynamic) {
      cullVisitor.visit(mesh);
    }
  }
  /**
   * Splits the child meshes into those the cached queues hold and the dynamic ones, whose level of
   * detail the CPU selects from the view: a primitive with levels, no forced level, and GPU culling
   * not selecting the level. Batchable meshes are dynamic too when the CPU selects their level
   * (WebGL, no indirect first instance, or level coloration).
   *
   * @remarks
   * Taken again whenever the group changes. Forcing or freeing the level of a mesh does so through
   * lod_changed; assigning Primitive.lods to a primitive already in the group does not, and it is
   * only picked up with the next change.
   *
   * @param gpuLod - Whether GPU instance culling selects the levels of the queue's batches
   */
  private getMeshSplit(gpuLod: boolean) {
    let split = this._meshSplits.get(gpuLod);
    if (!split || split.tag !== this._changeTag) {
      split = { tag: this._changeTag, cached: [], dynamic: [] };
      this._meshSplits.set(gpuLod, split);
      this.iterate((node) => {
        if (node.isMesh()) {
          const viewLod =
            (node.primitive?.lodCount ?? 1) > 1 &&
            node.forcedLod < 0 &&
            !(gpuLod && node.isBatchable() && InstanceCuller.selectsLod(node));
          (viewLod ? split!.dynamic : split!.cached).push(node);
        }
        return false;
      });
    }
    return split;
  }
}
