import { mimeTypeOf } from '@zephyr3d/base';
import { GraphNode, RoadControlPoint, RoadSpline, type RoadHandleMode, type SceneNode } from '../../../scene';
import type { MeshMaterial } from '../../../material';
import { defineProps, type SerializableClass } from '../types';
import type { ResourceManager } from '../manager';

/** @internal */
export function getRoadControlPointClass(): SerializableClass {
  return {
    ctor: RoadControlPoint,
    name: 'RoadControlPoint',
    getProps() {
      return defineProps([
        {
          name: 'Position',
          description: 'Position of the point in the space of the road',
          type: 'vec3',
          default: [0, 0, 0],
          get(this: RoadControlPoint, value) {
            value.num[0] = this.position.x;
            value.num[1] = this.position.y;
            value.num[2] = this.position.z;
          },
          set(this: RoadControlPoint, value) {
            this.position = this.position.clone().setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Width',
          description: 'Road width at this point in meters; 0 uses the width of the road',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 100 },
          get(this: RoadControlPoint, value) {
            value.num[0] = this.width;
          },
          set(this: RoadControlPoint, value) {
            this.width = value.num[0];
          }
        },
        {
          name: 'Bank',
          description: 'Roll of the road about its direction in degrees; positive raises the right edge',
          type: 'float',
          default: 0,
          options: { minValue: -45, maxValue: 45 },
          get(this: RoadControlPoint, value) {
            value.num[0] = this.bank;
          },
          set(this: RoadControlPoint, value) {
            this.bank = value.num[0];
          }
        },
        {
          name: 'HandleMode',
          description:
            'Auto shapes the curve through the neighboring points; Aligned and Free use the handles below, Free can make a corner',
          type: 'string',
          default: 'auto',
          options: {
            enum: { labels: ['Auto', 'Aligned', 'Free'], values: ['auto', 'aligned', 'free'] }
          },
          get(this: RoadControlPoint, value) {
            value.str[0] = this.handleMode;
          },
          set(this: RoadControlPoint, value) {
            const mode = value.str[0];
            this.handleMode = mode === 'aligned' || mode === 'free' ? (mode as RoadHandleMode) : 'auto';
          }
        },
        {
          name: 'InHandle',
          description: 'Incoming handle relative to the point',
          type: 'vec3',
          default: [0, 0, 0],
          isHidden(this: RoadControlPoint) {
            return this.handleMode === 'auto';
          },
          get(this: RoadControlPoint, value) {
            value.num[0] = this.inHandle.x;
            value.num[1] = this.inHandle.y;
            value.num[2] = this.inHandle.z;
          },
          set(this: RoadControlPoint, value) {
            this.inHandle = this.inHandle.clone().setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'OutHandle',
          description: 'Outgoing handle relative to the point',
          type: 'vec3',
          default: [0, 0, 0],
          isHidden(this: RoadControlPoint) {
            return this.handleMode === 'auto';
          },
          get(this: RoadControlPoint, value) {
            value.num[0] = this.outHandle.x;
            value.num[1] = this.outHandle.y;
            value.num[2] = this.outHandle.z;
          },
          set(this: RoadControlPoint, value) {
            this.outHandle = this.outHandle.clone().setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        }
      ]);
    }
  };
}

/** A material property referring to a material asset */
function materialProp(
  manager: ResourceManager,
  name: string,
  description: string,
  getter: (road: RoadSpline) => MeshMaterial | null,
  setter: (road: RoadSpline, material: MeshMaterial | null) => void
) {
  return {
    name,
    description,
    type: 'object' as const,
    options: {
      mimeTypes: [mimeTypeOf('.zmtl')]
    },
    get(this: RoadSpline, value: { str: string[] }) {
      const m = getter(this)?.coreMaterial ?? null;
      value.str[0] = (m && manager.getAssetId(m)) || '';
    },
    async set(this: RoadSpline, value: { str: string[] }) {
      const path = value?.str?.[0];
      if (!path) {
        setter(this, null);
        return;
      }
      const material = await manager.fetchMaterial<MeshMaterial>(path);
      if (material) {
        setter(this, material);
      } else {
        console.error(`Material not found: ${path}`);
      }
    }
  };
}

/** @internal */
export function getRoadSplineClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: RoadSpline,
    name: 'RoadSpline',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new RoadSpline(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Points',
          description: 'Control points the center line of the road passes through, in order',
          type: 'object_array',
          default: [],
          options: {
            objectTypes: [RoadControlPoint],
            elementLabel: 'Point'
          },
          isNullable() {
            return false;
          },
          get(this: RoadSpline, value) {
            value.object = [];
            for (let i = 0; i < this.numPoints; i++) {
              value.object.push(this.getPoint(i));
            }
          },
          set(this: RoadSpline, value) {
            this.setPoints(
              ((value.object ?? []) as unknown[]).filter(
                (p): p is RoadControlPoint => p instanceof RoadControlPoint
              )
            );
          },
          create() {
            return new RoadControlPoint();
          },
          add(this: RoadSpline, value, index) {
            const point = value?.object?.[0];
            this.insertPoint(point instanceof RoadControlPoint ? point : new RoadControlPoint(), index);
          },
          delete(this: RoadSpline, index) {
            this.removePoint(index);
          }
        },
        {
          name: 'Length',
          description: 'Length of the center line in meters',
          type: 'float',
          readonly: true,
          isPersistent() {
            return false;
          },
          get(this: RoadSpline, value) {
            value.num[0] = this.length;
          }
        },
        {
          name: 'Closed',
          description: 'Whether the last point connects back to the first (needs at least 3 points)',
          type: 'bool',
          default: false,
          get(this: RoadSpline, value) {
            value.bool[0] = this.closed;
          },
          set(this: RoadSpline, value) {
            this.closed = value.bool[0];
          }
        },
        {
          name: 'Width',
          description: 'Road width in meters at points whose own width is 0',
          type: 'float',
          default: 6,
          options: { minValue: 0.1, maxValue: 100 },
          get(this: RoadSpline, value) {
            value.num[0] = this.width;
          },
          set(this: RoadSpline, value) {
            this.width = value.num[0];
          }
        },
        {
          name: 'ShoulderWidth',
          description:
            'Width in meters of the shoulder on each side, which lies over the ground and fades into it; 0 for none',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 20 },
          get(this: RoadSpline, value) {
            value.num[0] = this.shoulderWidth;
          },
          set(this: RoadSpline, value) {
            this.shoulderWidth = value.num[0];
          }
        },
        materialProp(
          manager,
          'Material',
          'Material of the road surface; a plain gray one when empty',
          (road) => road.material,
          (road, m) => (road.material = m)
        ),
        materialProp(
          manager,
          'ShoulderMaterial',
          'Material of the shoulders, which fade out through the alpha of their vertex colors (enable vertex color and alpha dither with a small alpha cutoff). When empty, the shoulders blend the surface material into the terrain through its runtime virtual texture if the terrain has one (WebGPU), or else fade out a dithered copy of it',
          (road) => road.shoulderMaterial,
          (road, m) => (road.shoulderMaterial = m)
        ),
        {
          name: 'UVTileLength',
          description: 'Meters along the road per repeat of the textures',
          type: 'float',
          default: 8,
          options: { minValue: 0.01, maxValue: 1000 },
          get(this: RoadSpline, value) {
            value.num[0] = this.uvTileLength;
          },
          set(this: RoadSpline, value) {
            this.uvTileLength = value.num[0];
          }
        },
        {
          name: 'UVTileWidth',
          description: 'Meters across the road per repeat of the textures, centered on the road',
          type: 'float',
          default: 6,
          options: { minValue: 0.01, maxValue: 1000 },
          get(this: RoadSpline, value) {
            value.num[0] = this.uvTileWidth;
          },
          set(this: RoadSpline, value) {
            this.uvTileWidth = value.num[0];
          }
        },
        {
          name: 'SampleSpacing',
          description: 'Distance in meters between the cross sections of the road mesh',
          type: 'float',
          default: 1,
          options: { minValue: 0.1, maxValue: 10 },
          get(this: RoadSpline, value) {
            value.num[0] = this.sampleSpacing;
          },
          set(this: RoadSpline, value) {
            this.sampleSpacing = value.num[0];
          }
        },
        {
          name: 'ChunkLength',
          description: 'Length in meters of the stretches the road is drawn and culled in',
          type: 'float',
          default: 64,
          options: { minValue: 4, maxValue: 1024 },
          get(this: RoadSpline, value) {
            value.num[0] = this.chunkLength;
          },
          set(this: RoadSpline, value) {
            this.chunkLength = value.num[0];
          }
        },
        {
          name: 'SurfaceTag',
          description:
            'Name of the kind of surface, for game code telling roads apart (e.g. gravel, asphalt)',
          type: 'string',
          default: 'gravel',
          get(this: RoadSpline, value) {
            value.str[0] = this.surfaceTag;
          },
          set(this: RoadSpline, value) {
            this.surfaceTag = value.str[0] ?? '';
          }
        },
        {
          name: 'Collision',
          description: 'Whether the road is a static obstacle in the physics simulation',
          type: 'bool',
          default: true,
          get(this: RoadSpline, value) {
            value.bool[0] = this.collision;
          },
          set(this: RoadSpline, value) {
            this.collision = value.bool[0];
          }
        },
        {
          name: 'Friction',
          description:
            'Friction of the road colliders; vehicle wheels use their own grip (frictionSlip) instead',
          type: 'float',
          default: 0.8,
          options: { minValue: 0, maxValue: 2 },
          get(this: RoadSpline, value) {
            value.num[0] = this.friction;
          },
          set(this: RoadSpline, value) {
            this.friction = value.num[0];
          }
        },
        {
          name: 'CastShadow',
          description: 'Whether the road casts shadows',
          type: 'bool',
          default: false,
          get(this: RoadSpline, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: RoadSpline, value) {
            this.castShadow = value.bool[0];
          }
        }
      ]);
    }
  };
}
