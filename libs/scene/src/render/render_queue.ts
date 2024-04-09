import { Application } from '../app';
import type { Vector4 } from '@zephyr3d/base';
import type { Camera } from '../camera/camera';
import type { BatchDrawable, Drawable } from './drawable';
import type { DirectionalLight, PunctualLight } from '../scene/light';
import type { RenderPass } from '.';
import { QUEUE_TRANSPARENT } from '../values';
import type { BindGroup, BindGroupLayout } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { Material, ShaderHelper } from '../material';
import { RenderBundleWrapper } from './renderbundle_wrapper';

/** @internal */
export type CachedBindGroup = {
  bindGroup: BindGroup;
  buffer: Float32Array;
  offset: number;
  dirty: boolean;
};

const maxBufferSizeInFloats = 65536 / 4;

/** @internal */
export class InstanceBindGroupAllocator {
  private static _instanceBindGroupLayout: BindGroupLayout = null;
  _bindGroupList: CachedBindGroup[] = [];
  private _allocFrameStamp: number;
  constructor() {
    this._allocFrameStamp = -1;
    this._bindGroupList = [];
  }
  allocateInstanceBindGroup(framestamp: number, sizeInFloats: number): CachedBindGroup {
    // Reset if render frame changed
    if (this._allocFrameStamp !== framestamp) {
      this._allocFrameStamp = framestamp;
      for (const k of this._bindGroupList) {
        k.offset = 0;
      }
    }
    for (const k of this._bindGroupList) {
      if (k.offset + sizeInFloats <= maxBufferSizeInFloats) {
        k.dirty = true;
        return k;
      }
    }
    if (!InstanceBindGroupAllocator._instanceBindGroupLayout) {
      const buildInfo = new ProgramBuilder(Application.instance.device).buildRender({
        vertex(pb) {
          this[ShaderHelper.getInstanceDataUniformName()] = pb.vec4[65536 >> 4]().uniformBuffer(3);
          pb.main(function () {});
        },
        fragment(pb) {
          pb.main(function () {});
        }
      });
      InstanceBindGroupAllocator._instanceBindGroupLayout = buildInfo[2][3];
    }
    const bindGroup = {
      bindGroup: Application.instance.device.createBindGroup(
        InstanceBindGroupAllocator._instanceBindGroupLayout
      ),
      buffer: new Float32Array(maxBufferSizeInFloats),
      offset: 0,
      dirty: true
    };
    this._bindGroupList.push(bindGroup);
    return bindGroup;
  }
}

const defaultInstanceBindGroupAlloator = new InstanceBindGroupAllocator();

/**
 * Instance data
 * @public
 */
export interface InstanceData {
  bindGroup: CachedBindGroup;
  stride: number;
  offset: number;
  numInstances: number;
}

/**
 * Render queue item
 * @internal
 */
export interface RenderQueueItem {
  drawable: Drawable;
  sortDistance: number;
  instanceColor?: Vector4;
  instanceData: InstanceData;
}

/** @internal */
export interface RenderItemListInfo {
  itemList: RenderQueueItem[],
  renderBundle?: RenderBundleWrapper;
  skinItemList: RenderQueueItem[],
  skinRenderBundle?: RenderBundleWrapper;
  instanceItemList: RenderQueueItem[],
  instanceRenderBundle?: RenderBundleWrapper;
  instanceList: Record<string, BatchDrawable[]>;
  materialList: Set<Material>;
  renderQueue: RenderQueue;
}

/** @internal */
export interface RenderItemListBundle {
  lit: RenderItemListInfo[],
  unlit: RenderItemListInfo[]
}

/**
 * Item list of render queue
 * @internal
 */
export interface RenderItemList {
  opaque: RenderItemListBundle,
  transparent: RenderItemListBundle
}

/**
 * Render queue reference
 * @internal
 */
export interface RenderQueueRef {
  ref: RenderQueue;
}

/**
 * Drawable instance information
 * @internal
 */
export interface DrawableInstanceInfo {
  bindGroup: CachedBindGroup,
  offset: number
}

/**
 * A queue that contains the items to be rendered
 * @public
 */
export class RenderQueue {
  /** @internal */
  private _itemLists: Record<number, RenderItemList>;
  /** @internal */
  private _renderPass: RenderPass;
  /** @internal */
  private _shadowedLightList: PunctualLight[];
  /** @internal */
  private _unshadowedLightList: PunctualLight[];
  /** @internal */
  private _sunLight: DirectionalLight;
  /** @internal */
  private _bindGroupAllocator: InstanceBindGroupAllocator;
  /** @internal */
  private _ref: RenderQueueRef;
  /** @internal */
  private _instanceInfo: Map<Drawable, DrawableInstanceInfo>;
  /**
   * Creates an instance of a render queue
   * @param renderPass - The render pass to which the render queue belongs
   */
  constructor(renderPass: RenderPass, bindGroupAllocator?: InstanceBindGroupAllocator) {
    this._bindGroupAllocator = bindGroupAllocator ?? defaultInstanceBindGroupAlloator;
    this._itemLists = {};
    this._renderPass = renderPass;
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
    this._ref = { ref: this };
    this._instanceInfo = new Map();
  }
  /** The sun light */
  get sunLight(): DirectionalLight {
    return this._sunLight;
  }
  set sunLight(light: DirectionalLight) {
    this._sunLight = light;
  }
  /** The render pass to which the render queue belongs */
  get renderPass(): RenderPass {
    return this._renderPass;
  }
  /**
   * Gets the items of the render queue
   */
  get items() {
    return this._itemLists;
  }
  /**
   * Gets the shadowed lights
   */
  get shadowedLights() {
    return this._shadowedLightList;
  }
  /**
   * Gets the unshadowed lights
   */
  get unshadowedLights() {
    return this._unshadowedLightList;
  }
  /**
   * Gets the indirect reference of this
   */
  get ref(): RenderQueueRef {
    return this._ref;
  }
  /**
   * Gets the instance information for given drawable object
   * @param drawable - The drawable object
   * @returns The instane information for given drawable object, null if no exists
   */
  getInstanceInfo(drawable: Drawable) {
    return this._instanceInfo.get(drawable);
  }
  /**
   * Gets the maximum batch size of a given device
   * @returns The maximum batch size of the device
   *
   * @internal
   */
  getMaxBatchSize() {
    return Application.instance.device.getDeviceCaps().shaderCaps.maxUniformBufferSize / 64;
  }
  /**
   * Push a punctual light
   * @param light - The light to be pushed
   */
  pushLight(light: PunctualLight) {
    if (light.castShadow) {
      this._shadowedLightList.push(light);
    } else {
      this._unshadowedLightList.push(light);
    }
    if (light.isDirectionLight() && light.sunLight) {
      this.sunLight = light;
    }
  }
  /**
   * Push items from another render queue
   * @param queue - The render queue to be pushed
   */
  pushRenderQueue(queue: RenderQueue) {
    for (const order in queue._itemLists) {
      let itemLists = this._itemLists[order];
      if (!itemLists) {
        itemLists = this.newRenderItemList(true);
        this._itemLists[order] = itemLists;
      }
      const newItemLists = queue._itemLists[order];
      itemLists.opaque.lit.push(...newItemLists.opaque.lit);
      itemLists.opaque.unlit.push(...newItemLists.opaque.unlit);
      itemLists.transparent.lit.push(...newItemLists.transparent.lit);
      itemLists.transparent.unlit.push(...newItemLists.transparent.unlit);
    }
  }
  /**
   * Push an item to the render queue
   * @param camera - The camera for drawing the item
   * @param drawable - The object to be drawn
   * @param renderOrder - Render order of the object
   */
  push(camera: Camera, drawable: Drawable, renderOrder: number): void {
    if (drawable) {
      let itemList = this._itemLists[renderOrder];
      if (!itemList) {
        itemList = this.newRenderItemList(false);
        this._itemLists[renderOrder] = itemList;
      }
      const trans = drawable.getQueueType() === QUEUE_TRANSPARENT;
      const unlit = drawable.isUnlit();
      if (drawable.isBatchable()) {
        const instanceList = trans
          ? unlit
            ? itemList.transparent.unlit[0].instanceList
            : itemList.transparent.lit[0].instanceList
          : unlit
            ? itemList.opaque.unlit[0].instanceList
            : itemList.opaque.lit[0].instanceList;
        const hash = drawable.getInstanceId(this._renderPass);
        let drawableList = instanceList[hash];
        if (!drawableList) {
          drawableList = [];
          instanceList[hash] = drawableList;
        }
        drawableList.push(drawable);
      } else {
        const list = trans
        ? unlit
          ? itemList.transparent.unlit[0]
          : itemList.transparent.lit[0]
        : unlit
          ? itemList.opaque.unlit[0]
          : itemList.opaque.lit[0];
        this.binaryInsert((drawable.getBoneMatrices() ? list.skinItemList : list.itemList), {
          drawable,
          sortDistance: drawable.getSortDistance(camera),
          instanceData: null
        });
        drawable.applyTransformUniforms(this);
        const mat = drawable.getMaterial();
        if (mat) {
          list.materialList.add(mat.coreMaterial);
        }
      }
      drawable.pushRenderQueueRef(this._ref);
    }
  }
  /**
   * Removes all items in the render queue
   */
  reset() {
    this._itemLists = {};
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
  }
  /** @internal */
  dispose() {
    this._ref.ref = null;
    this._ref = null;
    this.reset();
  }
  /** @internal */
  end(camera: Camera, createRenderBundles?: boolean): this {
    const frameCounter = Application.instance.device.frameInfo.frameCounter;
    for (const k in this._itemLists) {
      const itemList = this._itemLists[k];
      const lists = [itemList.opaque.lit, itemList.opaque.unlit, itemList.transparent.lit, itemList.transparent.unlit];
      for (let i = 0; i < 4; i++) {
        const list = lists[i];
        for (const info of list) {
          if (info.renderQueue !== this) {
            continue;
          }
          const instanceList = info.instanceList
          for (const x in instanceList) {
            const drawables = instanceList[x];
            if (drawables.length === 1) {
              this.binaryInsert(info.itemList, {
                drawable: drawables[0],
                sortDistance: drawables[0].getSortDistance(camera),
                instanceData: null
              });
              drawables[0].applyTransformUniforms(this);
              const mat = drawables[0].getMaterial();
              if (mat) {
                info.materialList.add(mat.coreMaterial);
              }
            } else {
              let bindGroup: CachedBindGroup = null;
              let item: RenderQueueItem = null;
              for (let i = 0; i < drawables.length; i++) {
                const drawable = drawables[i];
                const instanceUniforms = drawable.getInstanceUniforms();
                const instanceUniformsSize = instanceUniforms?.length ?? 0;
                const stride = 16 + instanceUniformsSize;
                if (!bindGroup || bindGroup.offset + stride > maxBufferSizeInFloats) {
                  bindGroup = this._bindGroupAllocator.allocateInstanceBindGroup(frameCounter, stride);
                  item = {
                    drawable,
                    sortDistance: drawable.getSortDistance(camera),
                    instanceData: {
                      bindGroup,
                      offset: bindGroup.offset,
                      numInstances: 0,
                      stride
                    }
                  }
                  this.binaryInsert(info.instanceItemList, item);
                  drawable.applyInstanceOffsetAndStride(this, stride, bindGroup.offset);
                }
                const instanceInfo = { bindGroup, offset: bindGroup.offset };
                this._instanceInfo.set(drawable, instanceInfo);
                drawable.applyTransformUniforms(this);
                drawable.applyMaterialUniforms(instanceInfo);
                bindGroup.offset += stride;
                item.instanceData.numInstances++;
                const mat = drawable.getMaterial();
                if (mat) {
                  info.materialList.add(mat.coreMaterial);
                }
              }
            }
          }
          info.instanceList = {}
          if (createRenderBundles) {
            if (info.itemList.length > 0) {
              info.renderBundle = new RenderBundleWrapper();
            }
            if (info.skinItemList.length > 0) {
              info.skinRenderBundle = new RenderBundleWrapper();
            }
            if (info.instanceItemList.length > 0) {
              info.instanceRenderBundle = new RenderBundleWrapper();
            }
          }
        }
      }
      /*
      itemList.opaque.lit.forEach(info => {
        info.itemList.sort((a, b) => (a.drawable.getMaterial()?.instanceId ?? 0) - (b.drawable.getMaterial()?.instanceId ?? 0))
      });
      itemList.opaque.unlit.forEach(info => {
        info.itemList.sort((a, b) => (a.drawable.getMaterial()?.instanceId ?? 0) - (b.drawable.getMaterial()?.instanceId ?? 0))
      });
      */
    }
    return this;
  }
  binaryInsert(itemList: RenderQueueItem[], item: RenderQueueItem) {
    let left = 0;
    let right = itemList.length - 1;
    const newInstanceId = item.drawable.getMaterial().instanceId;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const instanceId = itemList[mid].drawable.getMaterial().instanceId;
      if (instanceId === newInstanceId) {
        itemList.splice(mid + 1, 0, item);
        return;
      } else if (instanceId < newInstanceId) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    itemList.splice(left, 0, item);
  }
  /**
   * Sorts the items in the render queue for rendering
   */
  sortTransparentItems() {
    for (const list of Object.values(this._itemLists)) {
      list.transparent.lit[0].itemList.sort((a, b) => b.sortDistance - a.sortDistance);
      list.transparent.lit[0].skinItemList.sort((a, b) => b.sortDistance - a.sortDistance);
      list.transparent.unlit[0].itemList.sort((a, b) => b.sortDistance - a.sortDistance);
      list.transparent.unlit[0].skinItemList.sort((a, b) => b.sortDistance - a.sortDistance);
    }
  }
  private newRenderItemList(empty: boolean): RenderItemList {
    return {
      opaque: {
        lit: empty ? [] : [{
          itemList: [],
          skinItemList: [],
          instanceItemList: [],
          materialList: new Set(),
          instanceList: {},
          renderQueue: this
        }],
        unlit: empty ? [] : [{
          itemList: [],
          skinItemList: [],
          instanceItemList: [],
          materialList: new Set(),
          instanceList: {},
          renderQueue: this
        }]
      },
      transparent: {
        lit: empty ? [] : [{
          itemList: [],
          skinItemList: [],
          instanceItemList: [],
          materialList: new Set(),
          instanceList: {},
          renderQueue: this
        }],
        unlit: empty ? [] : [{
          itemList: [],
          skinItemList: [],
          instanceItemList: [],
          materialList: new Set(),
          instanceList: {},
          renderQueue: this
        }]
      }
    };
  }
  /*
  private encodeInstanceColor(index: number, outColor: Float32Array) {
    outColor[0] = ((index >> 24) & 255) / 255;
    outColor[1] = ((index >> 16) & 255) / 255;
    outColor[2] = (index >> 8 && 255) / 255;
    outColor[3] = (index >> 0 && 255) / 255;
  }
  private decodeInstanceColor(value: Float32Array): number {
    return (value[0] << 24) + (value[1] << 16) + (value[2] << 8) + value[3];
  }
  setInstanceColors(): GraphNode[] {
    const nodes: GraphNode[] = [];
    let id = 0;
    for (const k in this._itemLists) {
      const lists = this._itemLists[k];
      for (const item of lists.opaqueList) {
        if (item.instanceColor) {
          item.instanceData.instanceColorList = [];
          for (let i = 0; i < item.instanceData.data.length; i++) {
            const v = item.drawable.getInstanceColor();
            this.encodeInstanceColor(id, v);
            nodes[id] = item.drawable.getPickTarget();
            item.instanceData.instanceColorList.push(v);
            id++;
          }
        }
      }
    }
    return nodes;
  }
  */
}
