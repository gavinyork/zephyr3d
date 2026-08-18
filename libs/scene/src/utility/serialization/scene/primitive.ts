import { Primitive } from '../../../render';
import {
  BoxFrameShape,
  BoxShape,
  CapsuleShape,
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
          description: 'Box size in (X, Y, Z) axis',
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
          description: 'Anchor point of the box',
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
export function getCapsuleShapeClass(): SerializableClass {
  return {
    ctor: CapsuleShape,
    parent: Primitive,
    name: 'CapsuleShape',
    getProps() {
      return defineProps([
        {
          name: 'Radius',
          description: 'capsule radius',
          type: 'float',
          default: 1,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.radius ?? 1;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              radius: value.num[0]
            };
          }
        },
        {
          name: 'Height',
          description: 'capsule height',
          type: 'float',
          default: 1,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.height ?? 1;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              height: value.num[0]
            };
          }
        },
        {
          name: 'RadialDetail',
          description: 'Number of radial segments around the capsule',
          type: 'int',
          default: 20,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.radialDetail ?? 10;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              radialDetail: value.num[0]
            };
          }
        },
        {
          name: 'HemisphereDetail',
          description: 'Number of segments used for each capsule hemisphere',
          type: 'int',
          default: 10,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.hemisphereDetail ?? 10;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              hemisphereDetail: value.num[0]
            };
          }
        },
        {
          name: 'HeightDetail',
          description: 'Number of segments along the straight section of the capsule',
          type: 'int',
          default: 1,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.heightDetail ?? 1;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              heightDetail: value.num[0]
            };
          }
        },
        {
          name: 'Anchor',
          description: 'Normalized anchor position along the capsule height',
          type: 'float',
          default: 0.5,
          get(this: CapsuleShape, value) {
            value.num[0] = this.options.anchor ?? 0.5;
          },
          set(this: CapsuleShape, value) {
            this.options = {
              ...this.options,
              anchor: value.num[0]
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
          description: 'Box size in (X, Y, Z) axis',
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
          description: 'Anchor point of the box frame',
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
          description: 'Number of slices around the torus ring',
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
          description: 'Number of segments around the torus tube',
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
          description: 'Outer radius from the torus center to the tube center',
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
          description: 'Radius of the torus tube',
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
          description: 'Number of radial segments around the torus tube',
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
          description: 'width and height of the plane in (X, Z) axis',
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
          description: 'Subdivision counts of the plane along its X and Z axes',
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
          description: 'Anchor point of the plane in normalized local coordinates',
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
          description: 'If true, the plane is rendered on both sides',
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
          description: 'Height of the cylinder',
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
          description: 'Radius of the bottom cap of the cylinder',
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
          description: 'Radius of the top cap of the cylinder',
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
          description: 'Number of segments along the cylinder height',
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
          description: 'Number of radial segments around the cylinder',
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
          description: 'Normalized anchor position along the cylinder height',
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
          description: 'If true, generates a top cap for the cylinder',
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
          description: 'If true, generates a bottom cap for the cylinder',
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
          description: 'Radius of the sphere',
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
          description: 'Number of vertical segments of the sphere',
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
          description: 'Number of horizontal segments of the sphere',
          type: 'int',
          options: { minValue: 2, maxValue: 100 },
          default: 20,
          get(this: SphereShape, value) {
            value.num[0] = this.options.horizonalDetail;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, horizonalDetail: Math.max(2, Math.min(value.num[0], 100)) };
          }
        },
        {
          name: 'EyeCompatible',
          description: 'Generate planar UVs and +U tangents for EyeMaterial',
          type: 'bool',
          default: false,
          get(this: SphereShape, value) {
            value.bool[0] = this.options.eyeCompatible;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, eyeCompatible: value.bool[0] };
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
          description: 'Height of the tetrahedron',
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
          description: 'Width of the tetrahedron base along the X axis',
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
          description: 'Depth of the tetrahedron base along the Z axis',
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
