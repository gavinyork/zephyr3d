import { Application } from '../app';
import type { Matrix4x4, Vector4 } from '@zephyr3d/base';
import type { Camera } from '../camera/camera';
import type { Drawable } from './drawable';
import type { DirectionalLight, PunctualLight } from '../scene/light';
import type { RenderPass } from '.';
import type { GraphNode } from '../scene';
import { QUEUE_TRANSPARENT } from '../values';
import { BindGroup } from '@zephyr3d/device';
import { ShaderHelper } from '../material';

const maxSize = 65536 >> 4;
const instanceBindGroupPool: { bindGroup: BindGroup; freeSize: number }[] = [];
let allocFrameStamp = -1;
function allocateInstanceBindGroup(framestamp: number, count: number): { bindGroup: BindGroup, offset: number } {
  // Reset if render frame changed
  if (allocFrameStamp !== framestamp) {
    allocFrameStamp = framestamp;
    for (const info of instanceBindGroupPool) {
      info.freeSize = maxSize;
    }
  }
  for (const info of instanceBindGroupPool) {
    if (info.freeSize >= count) {
      const offset = maxSize - info.freeSize;
      info.freeSize -= count;
      return {
        bindGroup: info.bindGroup,
        offset
      };
    }
  }
  const bindGroup = Application.instance.device.createBindGroup({
    entries: [{
      name: ShaderHelper.getWorldMatricesUniformName(),
      buffer: {
        hasDynamicOffset: false,
        type: 'uniform',
        uniformLayout: {
          byteSize: 65536,
          entries: []
        }
      },
      'binding'
    }]
  })
}

/**
 * Instance data
 * @public
 */
export interface InstanceData {
  data: { worldMatrix: Matrix4x4, materialData: Float32Array }[];
  nodeList?: GraphNode[];
  instanceColorList?: Vector4[];
  hash: string;
}

/**
 * Render queue item
 * @public
 */
export interface RenderQueueItem {
  drawable: Drawable;
  sortDistance: number;
  instanceColor?: Vector4;
  instanceData: InstanceData;
}

/**
 * Item list of render queue
 * @public
 */
interface RenderItemList {
  opaqueList: RenderQueueItem[];
  opaqueInstanceList: Record<string, number>;
  transList: RenderQueueItem[];
  transInstanceList: Record<string, number>;
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
  /**
   * Creates an instance of a render queue
   * @param renderPass - The render pass to which the render queue belongs
   */
  constructor(renderPass: RenderPass) {
    this._itemLists = {};
    this._renderPass = renderPass;
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
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
   * Push an item to the render queue
   * @param camera - The camera for drawing the item
   * @param drawable - The object to be drawn
   * @param renderOrder - Render order of the object
   */
  push(camera: Camera, drawable: Drawable, renderOrder: number): void {
    if (drawable) {
      let itemList = this._itemLists[renderOrder];
      if (!itemList) {
        itemList = {
          opaqueList: [],
          opaqueInstanceList: {},
          transList: [],
          transInstanceList: {}
        };
        this._itemLists[renderOrder] = itemList;
      }
      const trans = drawable.getQueueType() === QUEUE_TRANSPARENT;
      const list = trans ? itemList.transList : itemList.opaqueList;
      if (drawable.isBatchable()) {
        const instanceList = trans ? itemList.transInstanceList : itemList.opaqueInstanceList;
        const hash = drawable.getInstanceId(this._renderPass);
        const index = instanceList[hash];
        if (index === undefined || list[index].instanceData.data.length === this.getMaxBatchSize()) {
          instanceList[hash] = list.length;
          list.push({
            drawable,
            sortDistance: drawable.getSortDistance(camera),
            instanceData: {
              data: [drawable.getXForm().worldMatrix],
              hash: hash
            }
          });
        } else {
          list[index].instanceData.data.push(drawable.getXForm().worldMatrix);
        }
      } else {
        list.push({
          drawable,
          sortDistance: drawable.getSortDistance(camera),
          instanceData: null
        });
      }
    }
  }
  /**
   * Removes all items in the render queue
   */
  clear() {
    this._itemLists = {};
    this._shadowedLightList = [];
    this._unshadowedLightList = [];
    this._sunLight = null;
  }
  /**
   * Sorts the items in the render queue for rendering
   */
  sortItems() {
    for (const list of Object.values(this._itemLists)) {
      list.opaqueList.sort((a, b) => a.sortDistance - b.sortDistance);
      list.transList.sort((a, b) => b.sortDistance - a.sortDistance);
    }
  }
  private encodeInstanceColor(index: number, outColor: Float32Array) {
    outColor[0] = ((index >> 24) & 255) / 255;
    outColor[1] = ((index >> 16) & 255) / 255;
    outColor[2] = (index >> 8 && 255) / 255;
    outColor[3] = (index >> 0 && 255) / 255;
  }
  /*
  private decodeInstanceColor(value: Float32Array): number {
    return (value[0] << 24) + (value[1] << 16) + (value[2] << 8) + value[3];
  }
  */
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
}
