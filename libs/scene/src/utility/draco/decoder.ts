import type { TypedArray, TypedArrayConstructor } from "@zephyr3d/base";
import type { Decoder, Mesh, DecoderModule, DataType } from "draco3d";

export class DracoMeshDecoder {
  private _module: DecoderModule;
  private _decoder: Decoder;
  private _mesh: Mesh;
  constructor(data: ArrayBuffer, decoderModule: DecoderModule) {
    this._module = decoderModule;
    this._decoder = new this._module.Decoder();
    const buffer = new this._module.DecoderBuffer();
    buffer.Init(new Int8Array(data), data.byteLength);
    const geometryType = this._decoder.GetEncodedGeometryType(buffer);
    this._module.destroy(buffer);
    if (geometryType !== this._module.TRIANGULAR_MESH) {
      this._module.destroy(this._decoder);
      this._decoder = null;
      throw new Error(`Unsupported geometry type: ${geometryType}`);
    }
    this._mesh = new this._module.Mesh();
    const status = this._decoder.DecodeBufferToMesh(buffer, this._mesh);
    if (!status.ok() || this._mesh.ptr === 0) {
      this._module.destroy(this._decoder);
      this._decoder = null;
      this._module.destroy(this._mesh);
      this._mesh = null;
      throw new Error(status.error_msg());
    }
  }
  getIndexBuffer() {
    if (!this._decoder || !this._mesh) {
      return null;
    }
    const numFaces = this._mesh.num_faces();
    const numIndices = numFaces * 3;
    // Uint32
    const indexBuffer = new Uint32Array(numIndices);
    const ptr = this._module._malloc(indexBuffer.byteLength);
    this._decoder.GetTrianglesUInt32Array(this._mesh, indexBuffer.byteLength, ptr);
    const tmpBuffer = new Uint32Array(this._module.HEAPU32.buffer, ptr, numIndices);
    indexBuffer.set(tmpBuffer);
    this._module._free(ptr);
    return indexBuffer;
  }
  getAttributeBuffer(id: number, buffer: TypedArray) {
    if (!this._decoder || !this._mesh) {
      return null;
    }
    const attribute = this._decoder.GetAttributeByUniqueId(this._mesh, id);
    if (!attribute) {
      return null;
    }
    const numComponents = attribute.num_components();
    const numPoints = this._mesh.num_points();
    const numValues = numPoints * numComponents;
    if (buffer.length !== numValues) {
      console.error(`getAttributeBuffer(): buffer length must be ${numValues}`);
      return null;
    }
    const ptr = this._module._malloc(buffer.byteLength);
    this._decoder.GetAttributeDataArrayForAllPoints(this._mesh, attribute, this.getDracoDataType(buffer), buffer.byteLength, ptr);
    const tmpBuffer = new (buffer.constructor as TypedArrayConstructor)(this.getDracoHeap(buffer).buffer, ptr, numValues);
    buffer.set(tmpBuffer);
    this._module._free(ptr);
    return buffer;
  }
  private getDracoDataType(buffer: TypedArray): DataType {
    if (buffer instanceof Float32Array) {
      return this._module.DT_FLOAT32;
    }
    if (buffer instanceof Int8Array) {
      return this._module.DT_INT8;
    }
    if (buffer instanceof Int16Array) {
      return this._module.DT_INT16;
    }
    if (buffer instanceof Int32Array) {
      return this._module.DT_INT32;
    }
    if (buffer instanceof Uint8Array) {
      return this._module.DT_UINT8;
    }
    if (buffer instanceof Uint16Array) {
      return this._module.DT_UINT16;
    }
    if (buffer instanceof Uint32Array) {
      return this._module.DT_UINT32;
    }
    throw new Error(`getDracoDataType(): invalid buffer type`);
  }
  private getDracoHeap(buffer: TypedArray): TypedArray {
    if (buffer instanceof Float32Array) {
      return this._module.HEAPF32;
    }
    if (buffer instanceof Int8Array) {
      return this._module.HEAP8;
    }
    if (buffer instanceof Int16Array) {
      return this._module.HEAP16;
    }
    if (buffer instanceof Int32Array) {
      return this._module.HEAP32;
    }
    if (buffer instanceof Uint8Array) {
      return this._module.HEAPU8;
    }
    if (buffer instanceof Uint16Array) {
      return this._module.HEAPU16;
    }
    if (buffer instanceof Uint32Array) {
      return this._module.HEAPU32;
    }
    throw new Error(`getDracoHeap(): invalid buffer type`);
  }
}