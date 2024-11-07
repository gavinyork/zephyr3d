import { Application } from '../app';
import type { Vector4 } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Camera } from '../camera/camera';
import type { BatchDrawable, Drawable } from './drawable';
import type { DirectionalLight, PunctualLight } from '../scene/light';
import type { RenderPass } from '.';
import { QUEUE_TRANSPARENT } from '../values';
import type { BindGroup, BindGroupLayout } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { Material } from '../material';
import { ShaderHelper } from '../material';
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
  itemList: RenderQueueItem[];
  renderBundle?: RenderBundleWrapper;
  skinItemList: RenderQueueItem[];
  skinRenderBundle?: RenderBundleWrapper;
  morphItemList: RenderQueueItem[];
  morphRenderBundle?: RenderBundleWrapper;
  skinAndMorphItemList: RenderQueueItem[];
  skinAndMorphRenderBundle?: RenderBundleWrapper;
  instanceItemList: RenderQueueItem[];
  instanceRenderBundle?: RenderBundleWrapper;
  instanceList: Record<string, BatchDrawable[]>;
  materialList: Set<Material>;
  renderQueue: RenderQueue;
}

/** @internal */
export interface RenderItemListBundle {
  lit: RenderItemListInfo[];
  unlit: RenderItemListInfo[];
}

/**
 * Item list of render queue
 * @internal
 */
export interface RenderItemList {
  opaque: RenderItemListBundle;
  transmission: RenderItemListBundle;
  transparent: RenderItemListBundle;
  transmission_trans: RenderItemListBundle;
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
  bindGroup: CachedBindGroup;
  offset: number;
}

/**
 * A queue that contains the items to be rendered
 * @public
 */
export class RenderQueue {
  /** @internal */
  private _itemList: RenderItemList;
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
  /** @internal */
  private _needSceneColor: boolean;
  /** @internal */
  private _drawTransparent: boolean;
  /** @internal */
  private _objectColorMaps: Map<number, Drawable>[];
  /**
   * Creates an instance of a render queue
   * @param renderPass - The render pass to which the render queue belongs
   */
  constructor(renderPass: RenderPass, bindGroupAllocator?: InstanceBindGroupAllocator) {
    this._bindGroupAllocator = bindGroupAllocator ?? defaultInstanceBindGroupAlloator;
    this._itemList = null;
    this._renderPass = renderPass;
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
    this._ref = { ref: this };
    this._instanceInfo = new Map();
    this._needSceneColor = false;
    this._drawTransparent = false;
    this._objectColorMaps = [new Map()];
  }
  /** The sun light */
  get sunLight(): DirectionalLight {
    return this._sunLight;
  }
  set sunLight(light: DirectionalLight) {
    this._sunLight = light;
  }
  /** Whether this render queue requires scene color pass */
  get needSceneColor(): boolean {
    return this._needSceneColor;
  }
  /** Whether this render queue has transparent objects to be drawn */
  get drawTransparent(): boolean {
    return this._drawTransparent;
  }
  /** The render pass to which the render queue belongs */
  get renderPass(): RenderPass {
    return this._renderPass;
  }
  /**
   * Gets the items of the render queue
   */
  get itemList() {
    return this._itemList;
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
    const newItemLists = queue._itemList;
    if (!newItemLists) {
      return;
    }
    if (!this._itemList) {
      this._itemList = this.newRenderItemList();
    }
    this._itemList.opaque.lit.push(...newItemLists.opaque.lit);
    this._itemList.opaque.unlit.push(...newItemLists.opaque.unlit);
    this._itemList.transmission.lit.push(...newItemLists.transmission.lit);
    this._itemList.transmission.unlit.push(...newItemLists.transmission.unlit);
    this._itemList.transparent.lit.push(...newItemLists.transparent.lit);
    this._itemList.transparent.unlit.push(...newItemLists.transparent.unlit);
    this._itemList.transmission_trans.lit.push(...newItemLists.transmission_trans.lit);
    this._itemList.transmission_trans.unlit.push(...newItemLists.transmission_trans.unlit);
    this._needSceneColor ||= queue._needSceneColor;
    this._drawTransparent ||= queue._drawTransparent;
    this._objectColorMaps.push(...queue._objectColorMaps);
  }
  /**
   * Push an item to the render queue
   * @param camera - The camera for drawing the item
   * @param drawable - The object to be drawn
   */
  push(camera: Camera, drawable: Drawable): void {
    if (drawable) {
      if (!this._itemList) {
        this._itemList = this.newRenderItemList();
      }
      const trans = drawable.getQueueType() === QUEUE_TRANSPARENT;
      const unlit = drawable.isUnlit();
      const transmission = drawable.needSceneColor();
      this._needSceneColor ||= transmission;
      this._drawTransparent ||= trans;
      if (camera.enablePicking) {
        drawable.getMaterial().objectColor = drawable.getObjectColor();
        this._objectColorMaps[0].set(drawable.getId(), drawable);
      }
      if (drawable.isBatchable()) {
        const instanceList = trans
          ? transmission
            ? unlit
              ? this._itemList.transmission_trans.unlit[0].instanceList
              : this._itemList.transmission_trans.lit[0].instanceList
            : unlit
            ? this._itemList.transparent.unlit[0].instanceList
            : this._itemList.transparent.lit[0].instanceList
          : transmission
          ? unlit
            ? this._itemList.transmission.unlit[0].instanceList
            : this._itemList.transmission.lit[0].instanceList
          : unlit
          ? this._itemList.opaque.unlit[0].instanceList
          : this._itemList.opaque.lit[0].instanceList;
        const hash = drawable.getInstanceId(this._renderPass);
        let drawableList = instanceList[hash];
        if (!drawableList) {
          drawableList = [];
          instanceList[hash] = drawableList;
        }
        drawableList.push(drawable);
      } else {
        const list = trans
          ? transmission
            ? unlit
              ? this._itemList.transmission_trans.unlit[0]
              : this._itemList.transmission_trans.lit[0]
            : unlit
            ? this._itemList.transparent.unlit[0]
            : this._itemList.transparent.lit[0]
          : transmission
          ? unlit
            ? this._itemList.transmission.unlit[0]
            : this._itemList.transmission.lit[0]
          : unlit
          ? this._itemList.opaque.unlit[0]
          : this._itemList.opaque.lit[0];
        const skinAnimation = !!drawable.getBoneMatrices();
        const morphAnimation = !!drawable.getMorphData();
        let queue: RenderQueueItem[];
        if (skinAnimation && morphAnimation) {
          queue = list.skinAndMorphItemList;
        } else if (skinAnimation) {
          queue = list.skinItemList;
        } else if (morphAnimation) {
          queue = list.morphItemList;
        } else {
          queue = list.itemList;
        }
        this.binaryInsert(queue, {
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
  /** @internal */
  getDrawableByColor(c: Uint8Array) {
    const id = (c[0] << 24) + (c[1] << 16) + (c[2] << 8) + c[3];
    for (const m of this._objectColorMaps) {
      const drawable = m.get(id);
      if (drawable) {
        return drawable;
      }
    }
    return null;
  }
  /**
   * Removes all items in the render queue
   */
  reset() {
    if (this._itemList) {
      // Release all render bundles
      for (const k in this._itemList) {
        const itemListBundle: RenderItemListBundle = this._itemList[k];
        for (const l in itemListBundle) {
          const listInfo: RenderItemListInfo[] = itemListBundle[l];
          for (const info of listInfo) {
            if (info.renderQueue === this) {
              if (info.renderBundle) {
                info.renderBundle.dispose();
              }
              if (info.skinRenderBundle) {
                info.skinRenderBundle.dispose();
              }
              if (info.morphRenderBundle) {
                info.morphRenderBundle.dispose();
              }
              if (info.skinAndMorphRenderBundle) {
                info.skinAndMorphRenderBundle.dispose();
              }
              if (info.instanceRenderBundle) {
                info.instanceRenderBundle.dispose();
              }
            }
          }
        }
      }
      this._itemList = null;
    }
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
    this._needSceneColor = false;
    this._drawTransparent = false;
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
    const itemList = this._itemList;
    if (!this.itemList) {
      return this;
    }
    const lists = [
      itemList.opaque.lit,
      itemList.opaque.unlit,
      itemList.transmission.lit,
      itemList.transmission.unlit,
      itemList.transparent.lit,
      itemList.transparent.unlit,
      itemList.transmission_trans.lit,
      itemList.transmission_trans.unlit
    ];
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i];
      for (const info of list) {
        if (info.renderQueue !== this) {
          continue;
        }
        const instanceList = info.instanceList;
        for (const x in instanceList) {
          const drawables = instanceList[x];
          let bindGroup: CachedBindGroup = null;
          let item: RenderQueueItem = null;
          for (let i = 0; i < drawables.length; i++) {
            const drawable = drawables[i];
            const instanceUniforms = drawable.getInstanceUniforms();
            const instanceUniformsSize = instanceUniforms?.length ?? 0;
            const stride = ShaderHelper.MATERIAL_INSTANCE_DATA_OFFSET * 4 + instanceUniformsSize;
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
              };
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
        info.instanceList = {};
        if (createRenderBundles) {
          if (info.itemList.length > 0) {
            info.renderBundle = new RenderBundleWrapper();
          }
          if (info.skinItemList.length > 0) {
            info.skinRenderBundle = new RenderBundleWrapper();
          }
          if (info.morphItemList.length > 0) {
            info.morphRenderBundle = new RenderBundleWrapper();
          }
          if (info.skinAndMorphItemList.length > 0) {
            info.skinAndMorphRenderBundle = new RenderBundleWrapper();
          }
          if (info.instanceItemList.length > 0) {
            info.instanceRenderBundle = new RenderBundleWrapper();
          }
        }
      }
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
  sortTransparentItems(cameraPos: Vector3) {
    if (this._itemList) {
      this._itemList.transparent.lit[0].itemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.lit[0].skinItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.lit[0].morphItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.lit[0].skinAndMorphItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.unlit[0].itemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.unlit[0].skinItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.unlit[0].morphItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
      this._itemList.transparent.unlit[0].skinAndMorphItemList.sort(
        (a, b) =>
          this.drawableDistanceToCamera(b.drawable, cameraPos) -
          this.drawableDistanceToCamera(a.drawable, cameraPos)
      );
    }
  }
  private drawableDistanceToCamera(drawable: Drawable, cameraPos: Vector3) {
    const drawablePos = drawable.getXForm().position;
    return Vector3.distanceSq(drawablePos, cameraPos);
  }
  private newRenderItemListInfo(): RenderItemListInfo {
    return {
      itemList: [],
      skinItemList: [],
      morphItemList: [],
      skinAndMorphItemList: [],
      instanceItemList: [],
      materialList: new Set(),
      instanceList: {},
      renderQueue: this
    };
  }
  private newRenderItemListBundle(): RenderItemListBundle {
    return {
      lit: [this.newRenderItemListInfo()],
      unlit: [this.newRenderItemListInfo()]
    };
  }
  private newRenderItemList(): RenderItemList {
    return {
      opaque: this.newRenderItemListBundle(),
      transmission: this.newRenderItemListBundle(),
      transparent: this.newRenderItemListBundle(),
      transmission_trans: this.newRenderItemListBundle()
    };
  }
}
