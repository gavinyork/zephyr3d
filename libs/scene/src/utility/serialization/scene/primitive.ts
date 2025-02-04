import { Primitive } from '../../../render';
import { BoxFrameShape, BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '../../../shapes';
import type { SerializableClass } from '../types';

export function getPrimitiveClass(): SerializableClass {
  return {
    ctor: Primitive,
    className: 'Primitive',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new Primitive();
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [];
    }
  };
}
export function getBoxShapeClass(): SerializableClass {
  return {
    ctor: BoxShape,
    parent: getPrimitiveClass(),
    className: 'BoxShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new BoxShape({ size: 1 });
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'Size',
          type: 'vec3',
          default: { num: [1, 1, 1] },
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
          default: { num: [0.5, 0.5, 0.5] },
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
      ];
    }
  };
}

export function getBoxFrameShapeClass(): SerializableClass {
  return {
    ctor: BoxFrameShape,
    parent: getPrimitiveClass(),
    className: 'BoxFrameShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new BoxFrameShape({ size: 1 });
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'Size',
          type: 'vec3',
          default: { num: [1, 1, 1] },
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
          default: { num: [0.5, 0.5, 0.5] },
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
      ];
    }
  };
}

export function getTorusShapeClass(): SerializableClass {
  return {
    ctor: TorusShape,
    parent: getPrimitiveClass(),
    className: 'TorusShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new TorusShape();
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'NumSlices',
          type: 'int',
          options: { minValue: 3, maxValue: 100 },
          default: { num: [40] },
          get(this: TorusShape, value) {
            value.num[0] = this.options.numSlices;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, numSlices: value.num[0] };
          }
        },
        {
          name: 'NumSegments',
          type: 'int',
          options: { minValue: 3, maxValue: 100 },
          default: { num: [16] },
          get(this: TorusShape, value) {
            value.num[0] = this.options.numSegments;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, numSegments: value.num[0] };
          }
        },
        {
          name: 'OuterRadius',
          type: 'float',
          options: { minValue: 0, maxValue: 9999 },
          default: { num: [1] },
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
          default: { num: [0.3] },
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
          default: { num: [20] },
          get(this: TorusShape, value) {
            value.num[0] = this.options.radialDetail;
          },
          set(this: TorusShape, value) {
            this.options = { ...this.options, radialDetail: value.num[0] };
          }
        }
      ];
    }
  };
}

export function getPlaneShapeClass(): SerializableClass {
  return {
    ctor: PlaneShape,
    parent: getPrimitiveClass(),
    className: 'PlaneShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new PlaneShape({ size: 1 });
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'Size',
          type: 'vec2',
          default: { num: [1, 1] },
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
          default: { num: [1, 1] },
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
          default: { num: [0.5, 0.5] },
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
          default: { bool: [false] },
          get(this: PlaneShape, value) {
            value.bool[0] = this.options.twoSided;
          },
          set(this: PlaneShape, value) {
            this.options = { ...this.options, twoSided: value.bool[0] };
          }
        }
      ];
    }
  };
}

export function getCylinderShapeClass(): SerializableClass {
  return {
    ctor: CylinderShape,
    parent: getPrimitiveClass(),
    className: 'CylinderShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new CylinderShape();
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'Height',
          type: 'float',
          default: { num: [1] },
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
          default: { num: [1] },
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
          default: { num: [1] },
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
          default: { num: [1] },
          options: { minValue: 1, maxValue: 100 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.heightDetail;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, heightDetail: value.num[0] };
          }
        },
        {
          name: 'RadialDetail',
          type: 'int',
          default: { num: [20] },
          options: { minValue: 2, maxValue: 100 },
          get(this: CylinderShape, value) {
            value.num[0] = this.options.radialDetail;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, radialDetail: value.num[0] };
          }
        },
        {
          name: 'Anchor',
          type: 'float',
          default: { num: [0] },
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
          default: { bool: [true] },
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
          default: { bool: [true] },
          get(this: CylinderShape, value) {
            value.bool[0] = this.options.bottomCap;
          },
          set(this: CylinderShape, value) {
            this.options = { ...this.options, bottomCap: value.bool[0] };
          }
        }
      ];
    }
  };
}

export function getSphereShapeClass(): SerializableClass {
  return {
    ctor: SphereShape,
    parent: getPrimitiveClass(),
    className: 'SphereShape',
    createFunc(ctx, initParams) {
      let primitive = Primitive.findPrimitiveById(initParams.persistentId);
      if (primitive) {
        return { obj: primitive, loadProps: false };
      } else {
        primitive = new SphereShape();
        primitive.persistentId = initParams.persistentId;
        return { obj: primitive, loadProps: true };
      }
    },
    getInitParams(obj: BoxShape) {
      return { persistentId: obj.persistentId };
    },
    getProps() {
      return [
        {
          name: 'Radius',
          type: 'float',
          default: { num: [1] },
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
          default: { num: [20] },
          get(this: SphereShape, value) {
            value.num[0] = this.options.verticalDetail;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, verticalDetail: value.num[0] };
          }
        },
        {
          name: 'HorizontalDetail',
          type: 'int',
          options: { minValue: 2, maxValue: 100 },
          default: { num: [20] },
          get(this: SphereShape, value) {
            value.num[0] = this.options.horizonalDetail;
          },
          set(this: SphereShape, value) {
            this.options = { ...this.options, horizonalDetail: value.num[0] };
          }
        }
      ];
    }
  };
}
