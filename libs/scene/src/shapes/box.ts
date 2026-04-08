import type { AABB, Clonable, DeepRequireOptionals, Ray } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

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
  /** Anchor */
  anchor?: number;
  /** Anchor X */
  anchorX?: number;
  /** Anchor Y */
  anchorY?: number;
  /** Anchor Z */
  anchorZ?: number;
}

/**
 * Box shape
 * @public
 */
export class BoxShape extends Shape<BoxCreationOptions> implements Clonable<BoxShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1,
    anchor: 0.5
  };
  /**
   * Creates an instance of box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  clone() {
    return new BoxShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'Box' as const;
  }
  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   */
  raycast(ray: Ray) {
    const sizeX = this._options.sizeX ?? this._options.size ?? 1;
    const sizeY = this._options.sizeY ?? this._options.size ?? 1;
    const sizeZ = this._options.sizeZ ?? this._options.size ?? 1;
    const anchorX = this._options.anchorX ?? this._options.anchor ?? 0.5;
    const anchorY = this._options.anchorY ?? this._options.anchor ?? 0.5;
    const anchorZ = this._options.anchorZ ?? this._options.anchor ?? 0.5;
    return BoxShape._raycastAABB(
      ray,
      -anchorX * sizeX,
      -anchorY * sizeY,
      -anchorZ * sizeZ,
      (1 - anchorX) * sizeX,
      (1 - anchorY) * sizeY,
      (1 - anchorZ) * sizeZ
    );
  }
  /** @internal AABB slab test: returns t >= 0 on hit, null otherwise */
  private static _raycastAABB(
    ray: Ray,
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number
  ): number | null {
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dy = ray.direction.y;
    const dz = ray.direction.z;
    let tmin = -Infinity;
    let tmax = Infinity;
    // X slab
    if (Math.abs(dx) < 1e-10) {
      if (ox < minx || ox > maxx) {
        return null;
      }
    } else {
      const invDx = 1 / dx;
      let t1 = (minx - ox) * invDx;
      let t2 = (maxx - ox) * invDx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    // Y slab
    if (Math.abs(dy) < 1e-10) {
      if (oy < miny || oy > maxy) {
        return null;
      }
    } else {
      const invDy = 1 / dy;
      let t1 = (miny - oy) * invDy;
      let t2 = (maxy - oy) * invDy;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    // Z slab
    if (Math.abs(dz) < 1e-10) {
      if (oz < minz || oz > maxz) {
        return null;
      }
    } else {
      const invDz = 1 / dz;
      let t1 = (minz - oz) * invDz;
      let t2 = (maxz - oz) * invDz;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
  }
  /**
   * Generates the data for the box shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    opt: BoxCreationOptions,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ) {
    const options = Object.assign({}, this._defaultOptions, opt ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = options?.sizeX ?? options?.size ?? 1;
    const sizeY = options?.sizeY ?? options?.size ?? 1;
    const sizeZ = options?.sizeZ ?? options?.size ?? 1;
    const anchorX = options.anchorX ?? options.anchor;
    const anchorY = options.anchorY ?? options.anchor;
    const anchorZ = options.anchorZ ?? options.anchor;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const uv = uvs ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = normals ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const frontFacePos = [minx, maxy, maxz, minx, miny, maxz, maxx, miny, maxz, maxx, maxy, maxz];
    const frontFaceNormal = normals ? [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] : null;
    const rightFacePos = [maxx, maxy, maxz, maxx, miny, maxz, maxx, miny, minz, maxx, maxy, minz];
    const rightFaceNormal = normals ? [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] : null;
    const backFacePos = [maxx, maxy, minz, maxx, miny, minz, minx, miny, minz, minx, maxy, minz];
    const backFaceNormal = normals ? [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1] : null;
    const leftFacePos = [minx, maxy, minz, minx, miny, minz, minx, miny, maxz, minx, maxy, maxz];
    const leftFaceNormal = normals ? [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = normals ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices?.push(
      0 + indexOffset,
      1 + indexOffset,
      2 + indexOffset,
      0 + indexOffset,
      2 + indexOffset,
      3 + indexOffset,
      4 + indexOffset,
      5 + indexOffset,
      6 + indexOffset,
      4 + indexOffset,
      6 + indexOffset,
      7 + indexOffset,
      8 + indexOffset,
      9 + indexOffset,
      10 + indexOffset,
      8 + indexOffset,
      10 + indexOffset,
      11 + indexOffset,
      12 + indexOffset,
      13 + indexOffset,
      14 + indexOffset,
      12 + indexOffset,
      14 + indexOffset,
      15 + indexOffset,
      16 + indexOffset,
      17 + indexOffset,
      18 + indexOffset,
      16 + indexOffset,
      18 + indexOffset,
      19 + indexOffset,
      20 + indexOffset,
      21 + indexOffset,
      22 + indexOffset,
      20 + indexOffset,
      22 + indexOffset,
      23 + indexOffset
    );
    vertices?.push(
      ...topFacePos,
      ...frontFacePos,
      ...rightFacePos,
      ...backFacePos,
      ...leftFacePos,
      ...bottomFacePos
    );
    normals?.push(
      ...topFacenormal!,
      ...frontFaceNormal!,
      ...rightFaceNormal!,
      ...backFaceNormal!,
      ...leftFaceNormal!,
      ...bottomFaceNormal!
    );
    uvs?.push(...uv!, ...uv!, ...uv!, ...uv!, ...uv!, ...uv!);
    if (tangents) {
      const pushFaceTangent = (tx: number, ty: number, tz: number) => {
        tangents.push(tx, ty, tz, 1.0, tx, ty, tz, 1.0, tx, ty, tz, 1.0, tx, ty, tz, 1.0);
      };
      // Top (+Y): u -> +X
      pushFaceTangent(+1, 0, 0);
      // Front (+Z): u -> +X
      pushFaceTangent(+1, 0, 0);
      // Right (+X): u -> -Z
      pushFaceTangent(0, 0, -1);
      // Back (-Z): u -> -X （与 front 相反，保持 TBN 右手一致）
      pushFaceTangent(-1, 0, 0);
      // Left (-X): u -> +Z
      pushFaceTangent(0, 0, +1);
      // Bottom (-Y): u -> +X
      pushFaceTangent(+1, 0, 0);
    }
    Shape._transform(options.transform, vertices, normals, start);
    if (bbox || vertexCallback) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        if (bbox) {
          bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
          bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
          bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
          bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
          bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
          bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
        }
        vertexCallback?.((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }
    return 'triangle-list' as const;
  }
  /** Box width */
  get width() {
    return this._options.sizeX ?? this._options.size ?? 1;
  }
  /** Box height */
  get height() {
    return this._options.sizeY ?? this._options.size ?? 1;
  }
  /** Box depth */
  get depth() {
    return this._options.sizeZ ?? this._options.size ?? 1;
  }
}

/**
 * Wireframe box shape
 * @public
 */
export class BoxFrameShape extends Shape<BoxCreationOptions> implements Clonable<BoxFrameShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1,
    sizeX: 1,
    sizeY: 1,
    sizeZ: 1,
    anchor: 0.5,
    anchorX: 0.5,
    anchorY: 0.5,
    anchorZ: 0.5
  };
  /**
   * Creates an instance of wireframe box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  clone() {
    return new BoxFrameShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'BoxFrame' as const;
  }
  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   */
  raycast(ray: Ray) {
    const sizeX = this._options.sizeX ?? this._options.size ?? 1;
    const sizeY = this._options.sizeY ?? this._options.size ?? 1;
    const sizeZ = this._options.sizeZ ?? this._options.size ?? 1;
    const anchorX = this._options.anchorX ?? this._options.anchor ?? 0.5;
    const anchorY = this._options.anchorY ?? this._options.anchor ?? 0.5;
    const anchorZ = this._options.anchorZ ?? this._options.anchor ?? 0.5;
    return BoxFrameShape._raycastAABB(
      ray,
      -anchorX * sizeX,
      -anchorY * sizeY,
      -anchorZ * sizeZ,
      (1 - anchorX) * sizeX,
      (1 - anchorY) * sizeY,
      (1 - anchorZ) * sizeZ
    );
  }
  /** @internal AABB slab test: returns t >= 0 on hit, null otherwise */
  private static _raycastAABB(
    ray: Ray,
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number
  ): number | null {
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dy = ray.direction.y;
    const dz = ray.direction.z;
    let tmin = -Infinity;
    let tmax = Infinity;
    if (Math.abs(dx) < 1e-10) {
      if (ox < minx || ox > maxx) {
        return null;
      }
    } else {
      const invDx = 1 / dx;
      let t1 = (minx - ox) * invDx;
      let t2 = (maxx - ox) * invDx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    if (Math.abs(dy) < 1e-10) {
      if (oy < miny || oy > maxy) {
        return null;
      }
    } else {
      const invDy = 1 / dy;
      let t1 = (miny - oy) * invDy;
      let t2 = (maxy - oy) * invDy;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    if (Math.abs(dz) < 1e-10) {
      if (oz < minz || oz > maxz) {
        return null;
      }
    } else {
      const invDz = 1 / dz;
      let t1 = (minz - oz) * invDz;
      let t2 = (maxz - oz) * invDz;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        return null;
      }
    }
    return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
  }
  /**
   * Generates the data for the box shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: DeepRequireOptionals<BoxCreationOptions>,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ) {
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = options?.sizeX ?? options?.size ?? 1;
    const sizeY = options?.sizeY ?? options?.size ?? 1;
    const sizeZ = options?.sizeZ ?? options?.size ?? 1;
    const anchorX = options.anchorX ?? options.anchor;
    const anchorY = options.anchorY ?? options.anchor;
    const anchorZ = options.anchorZ ?? options.anchor;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const uv = uvs ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = normals ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = normals ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices?.push(
      0 + indexOffset,
      1 + indexOffset,
      1 + indexOffset,
      2 + indexOffset,
      2 + indexOffset,
      3 + indexOffset,
      3 + indexOffset,
      0 + indexOffset,
      0 + indexOffset,
      5 + indexOffset,
      1 + indexOffset,
      4 + indexOffset,
      2 + indexOffset,
      7 + indexOffset,
      3 + indexOffset,
      6 + indexOffset,
      6 + indexOffset,
      5 + indexOffset,
      5 + indexOffset,
      4 + indexOffset,
      4 + indexOffset,
      7 + indexOffset,
      7 + indexOffset,
      6 + indexOffset
    );
    vertices?.push(...topFacePos, ...bottomFacePos);
    normals?.push(...topFacenormal!, ...bottomFaceNormal!);
    uvs?.push(...uv!, ...uv!, ...uv!, ...uv!, ...uv!, ...uv!);
    if (tangents) {
      const pushFaceTangent = (tx: number, ty: number, tz: number) => {
        tangents.push(tx, ty, tz, 1.0, tx, ty, tz, 1.0, tx, ty, tz, 1.0, tx, ty, tz, 1.0);
      };
      // Top (+Y): u -> +X
      pushFaceTangent(+1, 0, 0);
      // Front (+Z): u -> +X
      pushFaceTangent(+1, 0, 0);
      // Right (+X): u -> -Z
      pushFaceTangent(0, 0, -1);
      // Back (-Z): u -> -X
      pushFaceTangent(-1, 0, 0);
      // Left (-X): u -> +Z
      pushFaceTangent(0, 0, +1);
      // Bottom (-Y): u -> +X
      pushFaceTangent(+1, 0, 0);
    }
    Shape._transform(options.transform, vertices, normals, start);
    if (bbox || vertexCallback) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        if (bbox) {
          bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
          bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
          bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
          bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
          bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
          bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
        }
        vertexCallback?.((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }
    return 'line-list' as const;
  }
}
