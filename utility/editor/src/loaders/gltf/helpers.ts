import type { Accessor, AccessorSparse } from './gltf_types';
import type { TypedArray } from '@zephyr3d/base';
import type { GLTFContent } from './gltf_importer';

/** @internal */
export const enum ComponentType {
  UNKNOWN = 0,
  BYTE = 5120, // GL.BYTE
  UBYTE = 5121, // GL.UNSIGNED_BYTE
  SHORT = 5122, // GL.SHORT
  USHORT = 5123, // GL.UNSIGNED_SHORT
  INT = 5124, // GL.INT
  UINT = 5125, // GL.UNSIGNED_INT
  FLOAT = 5126 // GL.FLOAT
}

/** @internal */
export type GLTFComponentType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';

/** @internal */
export class GLTFAccessor {
  bufferView: number;
  byteOffset: number;
  componentType: ComponentType;
  normalized: boolean;
  count: number;
  type: GLTFComponentType;
  max: number[];
  min: number[];
  sparse: AccessorSparse;
  name: string;
  private _typedView: TypedArray;
  private _filteredView: TypedArray;
  private _normalizedFilteredView: TypedArray;
  private _normalizedTypedView: TypedArray;
  constructor(accessorInfo: Accessor) {
    this.bufferView = accessorInfo.bufferView;
    this.byteOffset = accessorInfo.byteOffset ?? 0;
    this.componentType = accessorInfo.componentType;
    this.normalized = !!accessorInfo.normalized;
    this.count = accessorInfo.count;
    this.type = accessorInfo.type;
    this.max = accessorInfo.max;
    this.min = accessorInfo.min;
    this.sparse = accessorInfo.sparse;
    this.name = accessorInfo.name;
    this._typedView = null;
    this._filteredView = null;
    this._normalizedFilteredView = null;
    this._normalizedTypedView = null;
  }
  getTypedView(gltf: GLTFContent) {
    if (this._typedView) {
      return this._typedView;
    }

    if (this.bufferView !== undefined) {
      const bufferView = gltf.bufferViews[this.bufferView];
      const buffer = gltf._loadedBuffers[bufferView.buffer];
      const byteOffset = this.byteOffset + (bufferView.byteOffset ?? 0);

      const componentSize = this.getComponentSize(this.componentType);
      const componentCount = this.getComponentCount(this.type);

      let arrayLength = 0;
      if (bufferView.byteStride !== undefined && bufferView.byteStride !== 0) {
        if (componentSize !== 0) {
          arrayLength = (bufferView.byteStride / componentSize) * (this.count - 1) + componentCount;
        } else {
          console.warn("Invalid component type in accessor '" + (this.name ? this.name : '') + "'");
        }
      } else {
        arrayLength = this.count * componentCount;
      }

      if (arrayLength * componentSize > buffer.byteLength - byteOffset) {
        arrayLength = (buffer.byteLength - byteOffset) / componentSize;
        console.warn("Count in accessor '" + (this.name ? this.name : '') + "' is too large.");
      }

      switch (this.componentType) {
        case ComponentType.BYTE:
          this._typedView = new Int8Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.UBYTE:
          this._typedView = new Uint8Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.SHORT:
          this._typedView = new Int16Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.USHORT:
          this._typedView = new Uint16Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.INT:
          this._typedView = new Int32Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.UINT:
          this._typedView = new Uint32Array(buffer, byteOffset, arrayLength);
          break;
        case ComponentType.FLOAT:
          this._typedView = new Float32Array(buffer, byteOffset, arrayLength);
          break;
      }
    } else if (this.sparse !== undefined) {
      this._typedView = this.createView();
    }

    if (!this._typedView) {
      console.warn('Failed to convert buffer view to typed view!: ' + this.bufferView);
    } else if (this.sparse !== undefined) {
      this.applySparse(gltf, this._typedView);
    }

    return this._typedView;
  }

  // getNormalizedTypedView provides an alternative view to the accessors data,
  // where quantized data is already normalized. This is useful if the data is not passed
  // to vertexAttribPointer but used immediately (like e.g. animations)
  getNormalizedTypedView(gltf: GLTFContent) {
    if (this._normalizedTypedView) {
      return this._normalizedTypedView;
    }

    const typedView = this.getTypedView(gltf);
    this._normalizedTypedView = this.normalized
      ? GLTFAccessor.dequantize(typedView, this.componentType)
      : typedView;
    return this._normalizedTypedView;
  }

  // getDeinterlacedView provides a view to the accessors data in form of
  // a TypedArray. In contrast to getTypedView, getDeinterlacedView deinterlaces
  // data, i.e. stripping padding and unrelated components from the array. It then
  // only contains the data of the accessor
  getDeinterlacedView(gltf: GLTFContent) {
    if (this._filteredView) {
      return this._filteredView;
    }

    const componentSize = this.getComponentSize(this.componentType);
    const componentCount = this.getComponentCount(this.type);
    const arrayLength = this.count * componentCount;

    let func = 'getFloat32';
    switch (this.componentType) {
      case ComponentType.BYTE:
        this._filteredView = new Int8Array(arrayLength);
        func = 'getInt8';
        break;
      case ComponentType.UBYTE:
        this._filteredView = new Uint8Array(arrayLength);
        func = 'getUint8';
        break;
      case ComponentType.SHORT:
        this._filteredView = new Int16Array(arrayLength);
        func = 'getInt16';
        break;
      case ComponentType.USHORT:
        this._filteredView = new Uint16Array(arrayLength);
        func = 'getUint16';
        break;
      case ComponentType.INT:
        this._filteredView = new Int32Array(arrayLength);
        func = 'getInt32';
        break;
      case ComponentType.UINT:
        this._filteredView = new Uint32Array(arrayLength);
        func = 'getUint32';
        break;
      case ComponentType.FLOAT:
        this._filteredView = new Float32Array(arrayLength);
        func = 'getFloat32';
        break;
      default:
        return;
    }

    if (this.bufferView !== undefined) {
      const bufferView = gltf.bufferViews[this.bufferView];
      const buffer = gltf._loadedBuffers[bufferView.buffer];
      const byteOffset = this.byteOffset + (bufferView.byteOffset ?? 0);
      const stride =
        bufferView.byteStride !== undefined && bufferView.byteStride !== 0
          ? bufferView.byteStride
          : componentCount * componentSize;
      const dataView = new DataView(buffer, byteOffset, this.count * stride);
      for (let i = 0; i < arrayLength; ++i) {
        const offset = Math.floor(i / componentCount) * stride + (i % componentCount) * componentSize;
        this._filteredView[i] = dataView[func](offset, true);
      }
    } else if (this.sparse !== undefined) {
      this._filteredView = this.createView();
    }

    if (this.sparse !== undefined) {
      this.applySparse(gltf, this._filteredView);
    }

    return this._filteredView;
  }

  createView() {
    const size = this.count * this.getComponentCount(this.type);
    if (this.componentType == ComponentType.BYTE) {
      return new Int8Array(size);
    }
    if (this.componentType == ComponentType.UBYTE) {
      return new Uint8Array(size);
    }
    if (this.componentType == ComponentType.SHORT) {
      return new Int16Array(size);
    }
    if (this.componentType == ComponentType.USHORT) {
      return new Uint16Array(size);
    }
    if (this.componentType == ComponentType.INT) {
      return new Int32Array(size);
    }
    if (this.componentType == ComponentType.UINT) {
      return new Uint32Array(size);
    }
    if (this.componentType == ComponentType.FLOAT) {
      return new Float32Array(size);
    }
    return undefined;
  }

  // getNormalizedDeinterlacedView provides an alternative view to the accessors data,
  // where quantized data is already normalized. This is useful if the data is not passed
  // to vertexAttribPointer but used immediately (like e.g. animations)
  getNormalizedDeinterlacedView(gltf: GLTFContent) {
    if (this._normalizedFilteredView) {
      return this._normalizedFilteredView;
    }

    const filteredView = this.getDeinterlacedView(gltf);
    this._normalizedFilteredView = this.normalized
      ? GLTFAccessor.dequantize(filteredView, this.componentType)
      : filteredView;
    return this._normalizedFilteredView;
  }

  applySparse(gltf: GLTFContent, view: TypedArray) {
    // Gather indices.

    const indicesBufferView = gltf.bufferViews[this.sparse.indices.bufferView];
    const indicesBuffer = gltf._loadedBuffers[indicesBufferView.buffer];
    const indicesByteOffset = (this.sparse.indices.byteOffset ?? 0) + (indicesBufferView.byteOffset ?? 0);

    const indicesComponentSize = this.getComponentSize(this.sparse.indices.componentType);
    let indicesComponentCount = 1;

    if (indicesBufferView.byteStride !== undefined && indicesBufferView.byteStride !== 0) {
      indicesComponentCount = indicesBufferView.byteStride / indicesComponentSize;
    }

    const indicesArrayLength = this.sparse.count * indicesComponentCount;

    let indicesTypedView;
    switch (this.sparse.indices.componentType) {
      case ComponentType.UBYTE:
        indicesTypedView = new Uint8Array(indicesBuffer, indicesByteOffset, indicesArrayLength);
        break;
      case ComponentType.USHORT:
        indicesTypedView = new Uint16Array(indicesBuffer, indicesByteOffset, indicesArrayLength);
        break;
      case ComponentType.UINT:
        indicesTypedView = new Uint32Array(indicesBuffer, indicesByteOffset, indicesArrayLength);
        break;
    }

    // Gather values.

    const valuesBufferView = gltf.bufferViews[this.sparse.values.bufferView];
    const valuesBuffer = gltf._loadedBuffers[valuesBufferView.buffer];
    const valuesByteOffset = (this.sparse.values.byteOffset ?? 0) + (valuesBufferView.byteOffset ?? 0);

    const valuesComponentSize = this.getComponentSize(this.componentType);
    let valuesComponentCount = this.getComponentCount(this.type);

    if (valuesBufferView.byteStride !== undefined && valuesBufferView.byteStride !== 0) {
      valuesComponentCount = valuesBufferView.byteStride / valuesComponentSize;
    }

    const valuesArrayLength = this.sparse.count * valuesComponentCount;

    let valuesTypedView: TypedArray;
    switch (this.componentType) {
      case ComponentType.BYTE:
        valuesTypedView = new Int8Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.UBYTE:
        valuesTypedView = new Uint8Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.SHORT:
        valuesTypedView = new Int16Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.USHORT:
        valuesTypedView = new Uint16Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.INT:
        valuesTypedView = new Int32Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.UINT:
        valuesTypedView = new Uint32Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
      case ComponentType.FLOAT:
        valuesTypedView = new Float32Array(valuesBuffer, valuesByteOffset, valuesArrayLength);
        break;
    }

    // Overwrite values.

    for (let i = 0; i < this.sparse.count; ++i) {
      for (let k = 0; k < valuesComponentCount; ++k) {
        view[indicesTypedView[i] * valuesComponentCount + k] = valuesTypedView[i * valuesComponentCount + k];
      }
    }
  }

  // dequantize can be used to perform the normalization from WebGL2 vertexAttribPointer explicitly
  static dequantize(typedArray: TypedArray, componentType: ComponentType) {
    switch (componentType) {
      case ComponentType.BYTE:
        return new Float32Array(typedArray).map((c) => Math.max(c / 127.0, -1.0));
      case ComponentType.UBYTE:
        return new Float32Array(typedArray).map((c) => c / 255.0);
      case ComponentType.SHORT:
        return new Float32Array(typedArray).map((c) => Math.max(c / 32767.0, -1.0));
      case ComponentType.USHORT:
        return new Float32Array(typedArray).map((c) => c / 65535.0);
      default:
        return typedArray;
    }
  }

  getComponentCount(type: GLTFComponentType) {
    switch (type) {
      case 'SCALAR':
        return 1;
      case 'VEC2':
        return 2;
      case 'VEC3':
        return 3;
      case 'VEC4':
        return 4;
      case 'MAT2':
        return 4;
      case 'MAT3':
        return 9;
      case 'MAT4':
        return 16;
      default:
        return 0;
    }
  }

  getComponentSize(componentType: ComponentType) {
    switch (componentType) {
      case ComponentType.BYTE:
      case ComponentType.UBYTE:
        return 1;
      case ComponentType.SHORT:
      case ComponentType.USHORT:
        return 2;
      case ComponentType.INT:
      case ComponentType.UINT:
      case ComponentType.FLOAT:
        return 4;
      default:
        return 0;
    }
  }
}
