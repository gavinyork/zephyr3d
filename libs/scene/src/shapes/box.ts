import { Vector3 } from "@zephyr3d/base";
import { BoundingBox } from "../utility/bounding_volume";
import { ShapeCreationOptions, Shape } from "./shape";

/**
 * Creation options for box shape
 * @public
 */
export interface BoxCreationOptions extends ShapeCreationOptions {
  /** Size of all axises, default 1 */
  size?: number;
  /** Size of axis x, default 1 */
  sizeX?: number;
  /** Size of axis y, default 1 */
  sizeY?: number;
  /** Size of axis z, default 1 */
  sizeZ?: number;
  /** Anchor point of axis x, relative to the size of axis x, default 0 */
  anchorX?: number;
  /** Anchor point of axis y, relative to the size of axis y, default 0 */
  anchorY?: number;
  /** Anchor point of axis z, relative to the size of axis z, default 0 */
  anchorZ?: number;
}

/**
 * Box shape
 * @public
 */
export class BoxShape extends Shape<BoxCreationOptions> {
  /**
   * Creates an instance of box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.size = 1;
    return options;
  }
  /** @internal */
  protected _createArrays(
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number
  ) {
    const needTangent = this._options.needTangent;
    const needNormal = this._options.needNormal || needTangent;
    const needUV = this._options.needUV;
    const uv = needUV ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = needNormal ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const frontFacePos = [minx, maxy, maxz, minx, miny, maxz, maxx, miny, maxz, maxx, maxy, maxz];
    const frontFaceNormal = needNormal ? [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] : null;
    const rightFacePos = [maxx, maxy, maxz, maxx, miny, maxz, maxx, miny, minz, maxx, maxy, minz];
    const rightFaceNormal = needNormal ? [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] : null;
    const backFacePos = [maxx, maxy, minz, maxx, miny, minz, minx, miny, minz, minx, maxy, minz];
    const backFaceNormal = needNormal ? [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1] : null;
    const leftFacePos = [minx, maxy, minz, minx, miny, minz, minx, miny, maxz, minx, maxy, maxz];
    const leftFaceNormal = needNormal ? [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = needNormal ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices &&
      indices.push(
        0,
        1,
        2,
        0,
        2,
        3,
        4,
        5,
        6,
        4,
        6,
        7,
        8,
        9,
        10,
        8,
        10,
        11,
        12,
        13,
        14,
        12,
        14,
        15,
        16,
        17,
        18,
        16,
        18,
        19,
        20,
        21,
        22,
        20,
        22,
        23
      );
    vertices &&
      vertices.push(
        ...topFacePos,
        ...frontFacePos,
        ...rightFacePos,
        ...backFacePos,
        ...leftFacePos,
        ...bottomFacePos
      );
    needNormal &&
      normals &&
      normals.push(
        ...topFacenormal,
        ...frontFaceNormal,
        ...rightFaceNormal,
        ...backFaceNormal,
        ...leftFaceNormal,
        ...bottomFaceNormal
      );
    needUV && uvs && uvs.push(...uv, ...uv, ...uv, ...uv, ...uv, ...uv);
    this.primitiveType = 'triangle-list';
  }
  /** @internal */
  protected _create(): boolean {
    const needNormal = this._options.needNormal;
    const needUV = this._options.needUV;
    const sizeX = this._options.sizeX ?? this._options.size ?? 1;
    const sizeY = this._options.sizeY ?? this._options.size ?? 1;
    const sizeZ = this._options.sizeZ ?? this._options.size ?? 1;
    const anchorX = this._options.anchorX ?? 0;
    const anchorY = this._options.anchorY ?? 0;
    const anchorZ = this._options.anchorZ ?? 0;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = needNormal ? [] : null;
    const uvs: number[] = needUV ? [] : null;
    this._createArrays(vertices, normals, uvs, indices, minx, miny, minz, maxx, maxy, maxz);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(new Vector3(minx, miny, minz), new Vector3(maxx, maxy, maxz)));
    this.indexCount = indices.length;
    return true;
  }
}

/**
 * Wireframe box shape
 * @public
 */
export class BoxFrameShape extends Shape<BoxCreationOptions> {
  /**
   * Creates an instance of wireframe box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.size = 1;
    options.needNormal = false;
    options.needTangent = false;
    options.needUV = false;
    return options;
  }
  /** @internal */
  protected _createArrays(
    vertices: number[],
    indices: number[],
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number
  ) {
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    indices && indices.push(0, 1, 1, 2, 2, 3, 3, 0, 0, 5, 1, 4, 2, 7, 3, 6, 6, 5, 5, 4, 4, 7, 7, 6);
    vertices && vertices.push(...topFacePos, ...bottomFacePos);
    this.primitiveType = 'line-list';
  }
  /** @internal */
  protected _create(): boolean {
    const sizeX = this._options.sizeX ?? this._options.size ?? 1;
    const sizeY = this._options.sizeY ?? this._options.size ?? 1;
    const sizeZ = this._options.sizeZ ?? this._options.size ?? 1;
    const anchorX = this._options.anchorX ?? 0;
    const anchorY = this._options.anchorY ?? 0;
    const anchorZ = this._options.anchorZ ?? 0;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const vertices: number[] = [];
    const indices: number[] = [];
    this._createArrays(vertices, indices, minx, miny, minz, maxx, maxy, maxz);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(new Vector3(minx, miny, minz), new Vector3(maxx, maxy, maxz)));
    this.indexCount = indices.length;
    return true;
  }
}

