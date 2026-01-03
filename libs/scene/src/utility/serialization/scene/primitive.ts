import { Primitive } from '../../../render';
import {
  BoxFrameShape,
  BoxShape,
  CylinderShape,
  PlaneShape,
  SphereShape,
  TetrahedronShape,
  TorusShape
} from '../../../shapes';
import { defineProps, type SerializableClass } from '../types';

/** @internal */
export function getBoxShapeClass(): SerializableClass {
  return {
    ctor: BoxShape,
    parent: Primitive,
    name: 'BoxShape',
    getProps() {
      return defineProps([
        {
          name: 'Size',
          type: 'vec3',
          default: [1, 1, 1],
          get(this: BoxShape, value) {
            value.num[0] = this.options.sizeX ?? this.options.size;
            value.num[1] = this.options.sizeY ?? this.options.size;
            value.num[2] = this.options.sizeZ ?? this.options.size;
          },
          set(this: BoxShape, value) {
            this.options = {
              ...this.options,
              sizeX: value.num[0],
              sizeY: value.num[1],
              sizeZ: value.num[2]
            };
          }
        },
        {
          name: 'Anchor',
          type: 'vec3',
          default: [0.5, 0.5, 0.5],
          get(this: BoxShape, value) {
            value.num[0] = this.options.anchorX ?? this.options.anchor;
            value.num[1] = this.options.anchorY ?? this.options.anchor;
            value.num[2] = this.options.anchorZ ?? this.options.anchor;
          },
          set(this: BoxShape, value) {
            this.options = {
              ...this.options,
              anchorX: value.num[0],
              anchorY: value.num[1],
              anchorZ: value.num[2]
            };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getBoxFrameShapeClass(): SerializableClass {
  return {
    ctor: BoxFrameShape,
    parent: Primitive,
    name: 'BoxFrameShape',
    getProps() {
      return defineProps([
        {
          name: 'Size',
          type: 'vec3',
          default: [1, 1, 1],
          get(this: BoxShape, value) {
            value.num[0] = this.options.sizeX ?? this.options.size;
            value.num[1] = this.options.sizeY ?? this.options.size;
            value.num[2] = this.options.sizeZ ?? this.options.size;
          },
          set(this: BoxShape, value) {
            this.options = {
              ...this.options,
              sizeX: value.num[0],
              sizeY: value.num[1],
              sizeZ: value.num[2]
            };
          }
        },
        {
          name: 'Anchor',
          type: 'vec3',
          default: [0.5, 0.5, 0.5],
          get(this: BoxShape, value) {
            value.num[0] = this.options.anchorX ?? this.options.anchor;
            value.num[1] = this.options.anchorY ?? this.options.anchor;
            value.num[2] = this.options.anchorZ ?? this.options.anchor;
          },
          set(this: BoxShape, value) {
            this.options = {
              ...this.options,
              anchorX: value.num[0],
              anchorY: value.num[1],
              anchorZ: value.num[2]
            };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getTorusShapeClass(): SerializableClass {
  return {
    ctor: TorusShape,
    parent: Primitive,
    name: 'TorusShape',
    getProps() {
      return defineProps([
        {
          name: 'NumSlices',
          type: 'int',
          options: { minValue: 3, maxValue: 100 },
          default: 40,
          get(this: TorusShape, value) {
            value.num[0] = this.options.numSlices;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, numSlices: Math.max(3, Math.min(100, value.num[0])) };
          }
        },
        {
          name: 'NumSegments',
          type: 'int',
          options: { minValue: 3, maxValue: 100 },
          default: 16,
          get(this: TorusShape, value) {
            value.num[0] = this.options.numSegments;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, numSegments: Math.max(3, Math.min(100, value.num[0])) };
          }
        },
        {
          name: 'OuterRadius',
          type: 'float',
          options: { minValue: 0, maxValue: 9999 },
          default: 1,
          get(this: TorusShape, value) {
            value.num[0] = this.options.outerRadius;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, outerRadius: value.num[0] };
          }
        },
        {
          name: 'InnerRadius',
          type: 'float',
          options: { minValue: 0, maxValue: 9999 },
          default: 0.3,
          get(this: TorusShape, value) {
            value.num[0] = this.options.innerRadius;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, innerRadius: value.num[0] };
          }
        },
        {
          name: 'RadialDetail',
          type: 'int',
          options: { minValue: 3, maxValue: 100 },
          default: 20,
          get(this: TorusShape, value) {
            value.num[0] = this.options.radialDetail;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, radialDetail: Math.max(3, Math.min(100, value.num[0])) };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getPlaneShapeClass(): SerializableClass {
  return {
    ctor: PlaneShape,
    parent: Primitive,
    name: 'PlaneShape',
    getProps() {
      return defineProps([
        {
          name: 'Size',
          type: 'vec2',
          default: [1, 1],
          get(this: PlaneShape, value) {
            value.num[0] = this.options.sizeX ?? this.options.size;
            value.num[1] = this.options.sizeY ?? this.options.size;
          },
          set(this: PlaneShape, value) {
            this.options = {
              ...this.options,
              sizeX: value.num[0],
              sizeY: value.num[1]
            };
          }
        },
        {
          name: 'Resolution',
          type: 'int2',
          default: [1, 1],
          get(this: PlaneShape, value) {
            value.num[0] = this.options.resolutionX ?? this.options.resolution;
            value.num[1] = this.options.resolutionY ?? this.options.resolution;
          },
          set(this: PlaneShape, value) {
            this.options = {
              ...this.options,
              resolutionX: value.num[0],
              resolutionY: value.num[1]
            };
          }
        },
        {
          name: 'Anchor',
          type: 'vec2',
          default: [0.5, 0.5],
          options: { minValue: 0, maxValue: 1 },
          get(this: PlaneShape, value) {
            value.num[0] = this.options.anchorX ?? this.options.anchor;
            value.num[1] = this.options.anchorY ?? this.options.anchor;
          },
          set(this: PlaneShape, value) {
            this.options = {
              ...this.options,
              anchorX: value.num[0],
              anchorY: value.num[1]
            };
          }
        },
        {
          name: 'TwoSided',
          type: 'bool',
          default: false,
          get(this: PlaneShape, value) {
            value.bool[0] = this.options.twoSided;
          },
          set(this: PlaneShape, value) {
            this.options = { ...this.options, twoSided: value.bool[0] };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getCylinderShapeClass(): SerializableClass {
  return {
    ctor: CylinderShape,
    parent: Primitive,
    name: 'CylinderShape',
    getProps() {
      return defineProps([
        {
          name: 'Height',
          type: 'float',
          default: 1,
          get(this: CylinderShape, value) {
            value.num[0] = this.options.height;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, height: value.num[0] };
          }
        },
        {
          name: 'BottomRadius',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 9999 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.bottomRadius;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, bottomRadius: value.num[0] };
          }
        },
        {
          name: 'TopRadius',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 9999 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.topRadius;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, topRadius: value.num[0] };
          }
        },
        {
          name: 'HeightDetail',
          type: 'int',
          default: 1,
          options: { minValue: 1, maxValue: 100 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.heightDetail;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, heightDetail: Math.max(1, Math.min(value.num[0], 100)) };
          }
        },
        {
          name: 'RadialDetail',
          type: 'int',
          default: 20,
          options: { minValue: 2, maxValue: 100 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.radialDetail;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, radialDetail: Math.max(2, Math.min(value.num[0], 100)) };
          }
        },
        {
          name: 'Anchor',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 1 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.anchor;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, anchor: value.num[0] };
          }
        },
        {
          name: 'TopCap',
          type: 'bool',
          default: true,
          get(this: CylinderShape, value) {
            value.bool[0] = this.options.topCap;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, topCap: value.bool[0] };
          }
        },
        {
          name: 'BottomCap',
          type: 'bool',
          default: true,
          get(this: CylinderShape, value) {
            value.bool[0] = this.options.bottomCap;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, bottomCap: value.bool[0] };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getSphereShapeClass(): SerializableClass {
  return {
    ctor: SphereShape,
    parent: Primitive,
    name: 'SphereShape',
    getProps() {
      return defineProps([
        {
          name: 'Radius',
          type: 'float',
          default: 1,
          get(this: SphereShape, value) {
            value.num[0] = this.options.radius;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, radius: value.num[0] };
          }
        },
        {
          name: 'VerticalDetail',
          type: 'int',
          options: { minValue: 2, maxValue: 100 },
          default: 20,
          get(this: SphereShape, value) {
            value.num[0] = this.options.verticalDetail;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, verticalDetail: Math.max(2, Math.min(value.num[0], 100)) };
          }
        },
        {
          name: 'HorizontalDetail',
          type: 'int',
          options: { minValue: 2, maxValue: 100 },
          default: 20,
          get(this: SphereShape, value) {
            value.num[0] = this.options.horizonalDetail;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, horizonalDetail: Math.max(2, Math.min(value.num[0], 100)) };
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getTetrahedronShapeClass(): SerializableClass {
  return {
    ctor: TetrahedronShape,
    parent: Primitive,
    name: 'TetrahedronShape',
    getProps() {
      return defineProps([
        {
          name: 'Height',
          type: 'float',
          default: 1,
          get(this: TetrahedronShape, value) {
            value.num[0] = this.options.height;
          },
          set(this: TetrahedronShape, value) {
            this.options = { ...this.options, height: value.num[0] };
          }
        },
        {
          name: 'SizeX',
          type: 'float',
          get(this: TetrahedronShape, value) {
            value.num[0] = this.options.sizeX;
          },
          set(this: TetrahedronShape, value) {
            this.options = { ...this.options, sizeX: value.num[0] };
          }
        },
        {
          name: 'SizeZ',
          type: 'float',
          get(this: TetrahedronShape, value) {
            value.num[0] = this.options.sizeZ;
          },
          set(this: TetrahedronShape, value) {
            this.options = { ...this.options, sizeZ: value.num[0] };
          }
        }
      ]);
    }
  };
}
