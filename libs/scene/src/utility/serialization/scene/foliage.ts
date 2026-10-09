import { FoliageSystem, FOLIAGE_INSTANCE_STRIDE, GraphNode, type SceneNode } from '../../../scene';
import { defineProps, type SerializableClass } from '../types';
import type { ResourceManager } from '../manager';
import { JSONArray } from '../json';

// 'FOLI' in little endian
const FOLIAGE_DATA_MAGIC = 0x494c4f46;
const FOLIAGE_DATA_VERSION = 1;

/** One entry of the FoliageLayers property */
type FoliageLayerData = {
  asset: string;
  castShadow?: boolean;
  cullDistance?: number;
  alignToNormal?: number;
};

function getFoliageContent(foliage: FoliageSystem): ArrayBuffer {
  let size = 3 * 4;
  for (let i = 0; i < foliage.numLayers; i++) {
    size += 4 + foliage.getLayer(i)!.count * FOLIAGE_INSTANCE_STRIDE * 4;
  }
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint32(0, FOLIAGE_DATA_MAGIC, true);
  view.setUint32(4, FOLIAGE_DATA_VERSION, true);
  view.setUint32(8, foliage.numLayers, true);
  let offset = 12;
  for (let i = 0; i < foliage.numLayers; i++) {
    const instances = foliage.getLayer(i)!.getInstances();
    view.setUint32(offset, instances.length / FOLIAGE_INSTANCE_STRIDE, true);
    offset += 4;
    new Float32Array(buffer, offset, instances.length).set(instances);
    offset += instances.length * 4;
  }
  return buffer;
}

/** @internal */
export function getFoliageSystemClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: FoliageSystem,
    name: 'FoliageSystem',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new FoliageSystem(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'ChunkSize',
          description:
            'Edge length in meters of the square chunks the instances are drawn and culled in. Smaller chunks cull more tightly, larger ones draw in fewer batches.',
          type: 'float',
          default: 64,
          options: { minValue: 4, maxValue: 1024 },
          get(this: FoliageSystem, value) {
            value.num[0] = this.chunkSize;
          },
          set(this: FoliageSystem, value) {
            this.chunkSize = value.num[0];
          }
        },
        {
          name: 'FoliageLayers',
          description: 'Scattered assets and their settings, one entry per layer',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONArray] },
          isNullable() {
            return true;
          },
          get(this: FoliageSystem, value) {
            const data: FoliageLayerData[] = [];
            for (let i = 0; i < this.numLayers; i++) {
              const layer = this.getLayer(i)!;
              data.push({
                asset: layer.asset,
                castShadow: layer.castShadow,
                cullDistance: layer.cullDistance,
                alignToNormal: layer.alignToNormal
              });
            }
            value.object[0] = new JSONArray(null, data);
          },
          set(this: FoliageSystem, value) {
            const json = value.object[0] as JSONArray;
            const data = (json?.data as FoliageLayerData[]) ?? [];
            this.clearLayers();
            for (const info of data) {
              this.addLayer(String(info?.asset ?? ''), {
                castShadow: info?.castShadow,
                cullDistance: info?.cullDistance,
                alignToNormal: info?.alignToNormal
              });
            }
          }
        },
        {
          name: 'FoliageInstances',
          description: 'Serialized foliage instances',
          type: 'embedded',
          default: null,
          phase: 1,
          isHidden() {
            return true;
          },
          get(this: FoliageSystem, value) {
            value.str[0] = `assets/.embedded.dir/${this.persistentId}-foliage.bin`;
            value.object[0] = Promise.resolve(getFoliageContent(this));
          },
          async set(this: FoliageSystem, value) {
            if (!value.str[0]) {
              return;
            }
            const data = (await manager.VFS.readFile(value.str[0], { encoding: 'binary' }).catch(
              () => null
            )) as ArrayBuffer;
            if (!data || data.byteLength < 12) {
              console.error(`Load foliage instances failed: ${value.str[0]}`);
              return;
            }
            const view = new DataView(data);
            if (view.getUint32(0, true) !== FOLIAGE_DATA_MAGIC) {
              console.error('Invalid foliage instance data');
              return;
            }
            const numLayers = view.getUint32(8, true);
            if (numLayers !== this.numLayers) {
              console.error('Number of foliage layers mismatch');
              return;
            }
            let offset = 12;
            for (let i = 0; i < numLayers; i++) {
              const count = view.getUint32(offset, true);
              offset += 4;
              this.setInstances(i, new Float32Array(data, offset, count * FOLIAGE_INSTANCE_STRIDE));
              offset += count * FOLIAGE_INSTANCE_STRIDE * 4;
            }
          }
        }
      ]);
    }
  };
}
