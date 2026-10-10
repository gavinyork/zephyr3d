import { mimeTypeOf } from '@zephyr3d/base';
import {
  FoliageLayer,
  FoliageSystem,
  FOLIAGE_INSTANCE_STRIDE,
  GraphNode,
  type FoliageCollision,
  type FoliageCollisionShape,
  type FoliageSurface,
  type SceneNode
} from '../../../scene';
import { defineProps, type SerializableClass } from '../types';
import type { ResourceManager } from '../manager';

// 'FOLI' in little endian
const FOLIAGE_DATA_MAGIC = 0x494c4f46;
const FOLIAGE_DATA_VERSION = 2;

/**
 * Instances and density masks of every layer: a header of magic, version and layer count,
 * then per layer the generated instances, the manual instances (each a count and the floats)
 * and the density mask tiles.
 */
function getFoliageContent(foliage: FoliageSystem): ArrayBuffer {
  const layers: { generated: Float32Array; manual: Float32Array; layer: FoliageLayer }[] = [];
  let size = 3 * 4;
  for (let i = 0; i < foliage.numLayers; i++) {
    const layer = foliage.getLayer(i)!;
    const entry = {
      layer,
      generated: layer.getInstances('generated'),
      manual: layer.getInstances('manual')
    };
    layers.push(entry);
    size += 8 + (entry.generated.length + entry.manual.length) * 4 + layer.mask.byteSize;
  }
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint32(0, FOLIAGE_DATA_MAGIC, true);
  view.setUint32(4, FOLIAGE_DATA_VERSION, true);
  view.setUint32(8, layers.length, true);
  let offset = 12;
  for (const { layer, generated, manual } of layers) {
    for (const data of [generated, manual]) {
      view.setUint32(offset, data.length / FOLIAGE_INSTANCE_STRIDE, true);
      offset += 4;
      new Float32Array(buffer, offset, data.length).set(data);
      offset += data.length * 4;
    }
    offset = layer.mask.write(view, offset);
  }
  return buffer;
}

/** Reads what {@link getFoliageContent} wrote into the layers of a foliage system */
function setFoliageContent(foliage: FoliageSystem, data: ArrayBuffer) {
  const view = new DataView(data);
  if (data.byteLength < 12 || view.getUint32(0, true) !== FOLIAGE_DATA_MAGIC) {
    console.error('Invalid foliage instance data');
    return;
  }
  if (view.getUint32(4, true) !== FOLIAGE_DATA_VERSION) {
    console.error(`Unsupported foliage instance data version ${view.getUint32(4, true)}`);
    return;
  }
  const numLayers = view.getUint32(8, true);
  if (numLayers !== foliage.numLayers) {
    console.error('Number of foliage layers mismatch');
    return;
  }
  let offset = 12;
  for (let i = 0; i < numLayers; i++) {
    for (const group of ['generated', 'manual'] as const) {
      const count = view.getUint32(offset, true);
      offset += 4;
      foliage.setInstances(i, new Float32Array(data, offset, count * FOLIAGE_INSTANCE_STRIDE), group);
      offset += count * FOLIAGE_INSTANCE_STRIDE * 4;
    }
    offset = foliage.getLayer(i)!.mask.read(view, offset);
  }
}

/** Changes one field of the collision of a layer; nothing when the layer has none */
function updateCollision(layer: FoliageLayer, change: (c: FoliageCollision) => void) {
  const c = layer.collision;
  if (c) {
    change(c);
    layer.collision = c;
  }
}

const hasCollision = (layer: FoliageLayer) => !!layer.collision;
const collisionShape = (layer: FoliageLayer) => layer.collision?.shape ?? null;
/** Sizes and offset come from the asset's own colliders with shape asset */
const hasFittedShape = (layer: FoliageLayer) => hasCollision(layer) && collisionShape(layer) !== 'asset';

/** @internal */
export function getFoliageLayerClass(): SerializableClass {
  return {
    ctor: FoliageLayer,
    name: 'FoliageLayer',
    getProps() {
      return defineProps([
        {
          name: 'Asset',
          description: 'Prefab or model scattered by this layer; every mesh in it is drawn at each instance',
          type: 'string',
          default: '',
          options: {
            mimeTypes: [
              mimeTypeOf('.zprefab'),
              mimeTypeOf('.glb'),
              mimeTypeOf('.gltf'),
              mimeTypeOf('.fbx'),
              mimeTypeOf('.obj')
            ]
          },
          get(this: FoliageLayer, value) {
            value.str[0] = this.asset;
          },
          set(this: FoliageLayer, value) {
            this.asset = value.str[0] ?? '';
          }
        },
        {
          name: 'GeneratedInstances',
          description: 'Copies grown where the layer is painted; paint, erase or regenerate to change them',
          type: 'int',
          readonly: true,
          isPersistent() {
            return false;
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.generatedCount;
          }
        },
        {
          name: 'PlacedInstances',
          description:
            'Copies placed directly, e.g. by the scatter tool; painting leaves them alone, erasing removes them',
          type: 'int',
          readonly: true,
          isPersistent() {
            return false;
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.manualCount;
          }
        },
        {
          name: 'CastShadow',
          description: 'Whether the instances cast shadows; off saves time for small plants',
          type: 'bool',
          default: true,
          get(this: FoliageLayer, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: FoliageLayer, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'CullDistance',
          description: 'Instances farther than this from the camera, in meters, disappear',
          type: 'float',
          default: 300,
          options: { minValue: 0, maxValue: 10000 },
          get(this: FoliageLayer, value) {
            value.num[0] = this.cullDistance;
          },
          set(this: FoliageLayer, value) {
            this.cullDistance = value.num[0];
          }
        },
        {
          name: 'AlignToNormal',
          description:
            'How much the instances tilt with the slope of the terrain: 0 stands upright, 1 leans with the ground. Painted copies on any surface always stand upright',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 1 },
          isHidden(this: FoliageLayer) {
            // Only a terrain gives the slope when the instances are drawn; on any surface the
            // painted copies store their height alone. Placed copies still follow the terrain.
            return this.generation.surface === 'any' && this.manualCount === 0;
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.alignToNormal;
          },
          set(this: FoliageLayer, value) {
            this.alignToNormal = value.num[0];
          }
        },
        {
          name: 'Spacing',
          description:
            'Distance between the spots painted copies can grow at, about the closest two get. Smaller grows a denser layer. Regenerate the layer to apply it to what is painted',
          type: 'float',
          default: 4,
          options: { group: 'Generation', minValue: 0.05, maxValue: 100 },
          get(this: FoliageLayer, value) {
            value.num[0] = this.generation.spacing;
          },
          set(this: FoliageLayer, value) {
            this.generation = { spacing: value.num[0] };
          }
        },
        {
          name: 'ScaleRange',
          description: 'Smallest and largest size of the painted copies, picked at random for each',
          type: 'vec2',
          default: [0.8, 1.2],
          options: { group: 'Generation', minValue: 0.01, maxValue: 100 },
          get(this: FoliageLayer, value) {
            const r = this.generation.scaleRange;
            value.num[0] = r[0];
            value.num[1] = r[1];
          },
          set(this: FoliageLayer, value) {
            this.generation = { scaleRange: [value.num[0], value.num[1]] };
          }
        },
        {
          name: 'SlopeRange',
          description: 'Painted copies only grow on ground this steep, in degrees: 0 is flat, 90 a wall',
          type: 'vec2',
          default: [0, 45],
          options: { group: 'Generation', minValue: 0, maxValue: 90 },
          get(this: FoliageLayer, value) {
            const r = this.generation.slopeRange;
            value.num[0] = r[0];
            value.num[1] = r[1];
          },
          set(this: FoliageLayer, value) {
            this.generation = { slopeRange: [value.num[0], value.num[1]] };
          }
        },
        {
          name: 'LimitHeight',
          description: 'Painted copies only grow between two world heights, e.g. above the water line',
          type: 'bool',
          default: false,
          options: { group: 'Generation' },
          get(this: FoliageLayer, value) {
            value.bool[0] = !!this.generation.heightRange;
          },
          set(this: FoliageLayer, value) {
            const g = this.generation;
            this.generation = { heightRange: value.bool[0] ? (g.heightRange ?? [0, 100]) : null };
          }
        },
        {
          name: 'HeightRange',
          description: 'Lowest and highest world height painted copies grow at',
          type: 'vec2',
          default: [0, 100],
          options: { group: 'Generation' },
          isHidden(this: FoliageLayer) {
            return !this.generation.heightRange;
          },
          get(this: FoliageLayer, value) {
            const r = this.generation.heightRange ?? [0, 100];
            value.num[0] = r[0];
            value.num[1] = r[1];
          },
          set(this: FoliageLayer, value) {
            if (this.generation.heightRange) {
              this.generation = { heightRange: [value.num[0], value.num[1]] };
            }
          }
        },
        {
          name: 'YOffset',
          description:
            'Raises painted copies above the ground, or sinks them into it when negative, in meters',
          type: 'float',
          default: 0,
          options: { group: 'Generation', minValue: -100, maxValue: 100 },
          get(this: FoliageLayer, value) {
            value.num[0] = this.generation.yOffset;
          },
          set(this: FoliageLayer, value) {
            this.generation = { yOffset: value.num[0] };
          }
        },
        {
          name: 'RandomYaw',
          description:
            'Turns each painted copy a random way about the vertical, so they do not all face alike',
          type: 'bool',
          default: true,
          options: { group: 'Generation' },
          get(this: FoliageLayer, value) {
            value.bool[0] = this.generation.randomYaw;
          },
          set(this: FoliageLayer, value) {
            this.generation = { randomYaw: value.bool[0] };
          }
        },
        {
          name: 'Seed',
          description: 'Picks another random arrangement of the painted copies; regenerate to see it',
          type: 'int',
          default: 0,
          options: { group: 'Generation' },
          get(this: FoliageLayer, value) {
            value.num[0] = this.generation.seed;
          },
          set(this: FoliageLayer, value) {
            this.generation = { seed: value.num[0] };
          }
        },
        {
          name: 'Surface',
          description:
            'What painted copies stand on. Terrain follows the ground when it is reshaped; Any surface lands them on whatever has a collider below, rocks and buildings included, and keeps that height',
          type: 'string',
          default: 'terrain',
          options: {
            group: 'Generation',
            enum: { labels: ['Terrain', 'Any surface'], values: ['terrain', 'any'] }
          },
          get(this: FoliageLayer, value) {
            value.str[0] = this.generation.surface;
          },
          set(this: FoliageLayer, value) {
            this.generation = { surface: value.str[0] as FoliageSurface };
          }
        },
        {
          name: 'PlaceScript',
          description:
            'Optional rule deciding where painted copies grow: function place(p, api, input) returning how likely a copy is at p, as for the scatter tool',
          type: 'string',
          default: '',
          options: { group: 'Generation', multiline: true },
          get(this: FoliageLayer, value) {
            value.str[0] = this.generation.placeScript;
          },
          set(this: FoliageLayer, value) {
            this.generation = { placeScript: value.str[0] ?? '' };
          }
        },
        {
          name: 'CollisionShape',
          description:
            'Makes the instances obstacles in the physics simulation, such as tree trunks and big rocks. Asset uses the colliders set on the asset itself; None for bushes and stones vehicles drive over',
          type: 'string',
          default: 'none',
          options: {
            group: 'Collision',
            enum: {
              labels: ['None', 'Box', 'Sphere', 'Capsule', 'Cylinder', 'From asset'],
              values: ['none', 'box', 'sphere', 'capsule', 'cylinder', 'asset']
            }
          },
          get(this: FoliageLayer, value) {
            value.str[0] = this.collision?.shape ?? 'none';
          },
          set(this: FoliageLayer, value) {
            const shape = value.str[0];
            if (!shape || shape === 'none') {
              this.collision = null;
            } else {
              this.collision = { ...(this.collision ?? {}), shape: shape as FoliageCollisionShape };
            }
          }
        },
        {
          name: 'CollisionSize',
          description:
            "Width, height and depth of the box, in the asset's units; 0 on an axis fits it to the asset there",
          type: 'vec3',
          default: [0, 0, 0],
          options: { group: 'Collision', minValue: 0 },
          isHidden(this: FoliageLayer) {
            return collisionShape(this) !== 'box';
          },
          get(this: FoliageLayer, value) {
            const size = this.collision?.size;
            value.num[0] = size?.[0] ?? 0;
            value.num[1] = size?.[1] ?? 0;
            value.num[2] = size?.[2] ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              const size: [number, number, number] = [value.num[0], value.num[1], value.num[2]];
              c.size = size.every((v) => v > 0) ? size : undefined;
            });
          }
        },
        {
          name: 'CollisionRadius',
          description:
            "Radius of the sphere, capsule or cylinder, in the asset's units; 0 fits it to the asset. For a tree, give the trunk radius",
          type: 'float',
          default: 0,
          options: { group: 'Collision', minValue: 0 },
          isHidden(this: FoliageLayer) {
            const shape = collisionShape(this);
            return shape !== 'sphere' && shape !== 'capsule' && shape !== 'cylinder';
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.collision?.radius ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.radius = value.num[0] > 0 ? value.num[0] : undefined;
            });
          }
        },
        {
          name: 'CollisionHeight',
          description:
            "Total height of the capsule or cylinder, in the asset's units; 0 makes it as tall as the asset",
          type: 'float',
          default: 0,
          options: { group: 'Collision', minValue: 0 },
          isHidden(this: FoliageLayer) {
            const shape = collisionShape(this);
            return shape !== 'capsule' && shape !== 'cylinder';
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.collision?.height ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.height = value.num[0] > 0 ? value.num[0] : undefined;
            });
          }
        },
        {
          name: 'CollisionAutoOffset',
          description:
            'Places the shape on the asset: a capsule or cylinder stands on its base, a box or sphere is centred on it',
          type: 'bool',
          default: true,
          options: { group: 'Collision' },
          isHidden(this: FoliageLayer) {
            return !hasFittedShape(this);
          },
          get(this: FoliageLayer, value) {
            value.bool[0] = !this.collision?.offset;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.offset = value.bool[0] ? undefined : (c.offset ?? [0, 0, 0]);
            });
          }
        },
        {
          name: 'CollisionOffset',
          description: "Centre of the shape, in the asset's units, measured from the asset's origin",
          type: 'vec3',
          default: [0, 0, 0],
          options: { group: 'Collision' },
          isHidden(this: FoliageLayer) {
            return !hasFittedShape(this) || !this.collision?.offset;
          },
          get(this: FoliageLayer, value) {
            const offset = this.collision?.offset;
            value.num[0] = offset?.[0] ?? 0;
            value.num[1] = offset?.[1] ?? 0;
            value.num[2] = offset?.[2] ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              if (c.offset) {
                c.offset = [value.num[0], value.num[1], value.num[2]];
              }
            });
          }
        },
        {
          name: 'CollisionFriction',
          description: 'Grip against sliding along the instances: 0 is ice, around 1 is rubber',
          type: 'float',
          default: 0.5,
          options: { group: 'Collision', minValue: 0, maxValue: 2 },
          isHidden(this: FoliageLayer) {
            return !hasFittedShape(this);
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.collision?.friction ?? 0.5;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.friction = value.num[0];
            });
          }
        },
        {
          name: 'CollisionRestitution',
          description: 'Bounciness of the instances: 0 stops things dead, 1 bounces them back fully',
          type: 'float',
          default: 0,
          options: { group: 'Collision', minValue: 0, maxValue: 1 },
          isHidden(this: FoliageLayer) {
            return !hasFittedShape(this);
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.collision?.restitution ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.restitution = value.num[0];
            });
          }
        },
        {
          name: 'CollisionLayer',
          description:
            'Collision layer 0-15 of the instances; the world decides which layers pass through each other',
          type: 'int',
          default: 0,
          options: { group: 'Collision', minValue: 0, maxValue: 15 },
          isHidden(this: FoliageLayer) {
            return !hasFittedShape(this);
          },
          get(this: FoliageLayer, value) {
            value.num[0] = this.collision?.layer ?? 0;
          },
          set(this: FoliageLayer, value) {
            updateCollision(this, (c) => {
              c.layer = value.num[0];
            });
          }
        }
      ]);
    }
  };
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
          name: 'MaskCellSize',
          description:
            'Size in meters of the squares the foliage brush paints in. Smaller follows the brush more closely, larger saves memory',
          type: 'float',
          default: 1,
          options: { minValue: 0.05, maxValue: 16 },
          get(this: FoliageSystem, value) {
            value.num[0] = this.maskCellSize;
          },
          set(this: FoliageSystem, value) {
            this.maskCellSize = value.num[0];
          }
        },
        {
          name: 'Layers',
          description: 'Kinds of objects scattered over the terrain, one asset and its settings per layer',
          type: 'object_array',
          default: [],
          options: { objectTypes: [FoliageLayer] },
          isNullable() {
            return false;
          },
          get(this: FoliageSystem, value) {
            value.object = [];
            for (let i = 0; i < this.numLayers; i++) {
              value.object.push(this.getLayer(i));
            }
          },
          set(this: FoliageSystem, value) {
            this.setLayers(
              ((value.object ?? []) as unknown[]).filter((l): l is FoliageLayer => l instanceof FoliageLayer)
            );
          },
          create() {
            return new FoliageLayer();
          },
          add(this: FoliageSystem, value, index) {
            const layer = value?.object?.[0];
            this.insertLayer(layer instanceof FoliageLayer ? layer : new FoliageLayer(), index);
          },
          delete(this: FoliageSystem, index) {
            this.removeLayer(index);
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
            if (!data) {
              console.error(`Load foliage instances failed: ${value.str[0]}`);
              return;
            }
            setFoliageContent(this, data);
          }
        }
      ]);
    }
  };
}
