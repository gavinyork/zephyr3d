import type { Vector4 } from '@zephyr3d/base';
import { Vector2, applyMixins, nextPowerOf2 } from '@zephyr3d/base';
import { Primitive } from '../../render/primitive';
import type { BatchDrawable, Drawable, DrawContext, PickTarget } from '../../render/drawable';
import type { QuadtreeNode } from './quadtree';
import type { Camera } from '../../camera/camera';
import type {
  AbstractDevice,
  GPUDataBuffer,
  IndexBuffer,
  StructuredBuffer,
  Texture2D
} from '@zephyr3d/device';
import type { Terrain } from './terrain';
import { GrassMaterial } from '../../material/grassmaterial';
import { mixinDrawable } from '../../render/drawable_mixin';
import type { MeshMaterial } from '../../material';
import type { SceneNode } from '..';

export class GrassClusterBase {
  protected _terrain: Terrain;
  constructor(terrain: Terrain) {
    this._terrain = terrain;
  }
  getNode(): SceneNode {
    return this._terrain;
  }
}

export class GrassCluster extends applyMixins(GrassClusterBase, mixinDrawable) implements Drawable {
  private _primitive: Primitive;
  private _numInstances: number;
  private _material: GrassMaterial;
  constructor(
    device: AbstractDevice,
    terrain: Terrain,
    baseVertexBuffer: StructuredBuffer,
    indexBuffer: IndexBuffer,
    material: GrassMaterial,
    grassData: Float32Array
  ) {
    super(terrain);
    this._primitive = new Primitive();
    const instanceVertexBuffer = device.createVertexBuffer('tex1_f32x4', grassData);
    this._primitive.setVertexBuffer(baseVertexBuffer, 'vertex');
    this._primitive.setVertexBuffer(instanceVertexBuffer, 'instance');
    this._primitive.setIndexBuffer(indexBuffer);
    this._primitive.primitiveType = 'triangle-list';
    this._numInstances = grassData.length >> 2;
    this._material = material;
  }
  getName() {
    return 'GrassCluster';
  }
  getMaterial(): MeshMaterial {
    return this._material;
  }
  getPrimitive(): Primitive {
    return this._primitive;
  }
  getInstanceColor(): Vector4 {
    return this._terrain.getInstanceColor();
  }
  getPickTarget(): PickTarget {
    return { node: this._terrain };
  }
  getBoneMatrices(): Texture2D<unknown> {
    return null;
  }
  getMorphData(): Texture2D {
    return null;
  }
  getMorphInfo(): GPUDataBuffer {
    return null;
  }
  getSortDistance(camera: Camera): number {
    return this._terrain.getSortDistance(camera);
  }
  getQueueType(): number {
    return this._terrain.grassMaterial.getQueueType();
  }
  isUnlit(): boolean {
    return !this._terrain.grassMaterial.supportLighting();
  }
  needSceneColor(): boolean {
    return false;
  }
  isBatchable(): this is BatchDrawable {
    return false;
  }
  draw(ctx: DrawContext) {
    this.bind(ctx);
    this._material.draw(this._primitive, ctx, this._numInstances);
  }
}

export type GrassLayer = {
  material: GrassMaterial;
  clusters: Map<QuadtreeNode, GrassCluster>;
};

export class GrassManager {
  private _clusterSize: number;
  private _baseVertexBuffer: Map<string, StructuredBuffer>;
  private _indexBuffer: IndexBuffer;
  private _layers: GrassLayer[];
  constructor(clusterSize: number, density: number[][]) {
    this._clusterSize = clusterSize;
    this._baseVertexBuffer = new Map();
    this._indexBuffer = null;
    this._layers = [];
  }
  private getBaseVertexBuffer(device: AbstractDevice, bladeWidth: number, bladeHeight: number) {
    const hash = `${bladeWidth}-${bladeHeight}`;
    let baseVertexBuffer = this._baseVertexBuffer.get(hash);
    if (baseVertexBuffer) {
      return baseVertexBuffer;
    }
    const r = bladeWidth * 0.5;
    const t = bladeHeight;
    const c = r * Math.cos(Math.PI / 3);
    const s = r * Math.sin(Math.PI / 3);
    const vertices = new Float32Array([
      r,
      0,
      0,
      0,
      1,
      r,
      t,
      0,
      0,
      0,
      -r,
      t,
      0,
      1,
      0,
      -r,
      0,
      0,
      1,
      1,

      c,
      0,
      s,
      0,
      1,
      -c,
      0,
      -s,
      1,
      1,
      -c,
      t,
      -s,
      1,
      0,
      c,
      t,
      s,
      0,
      0,

      -c,
      0,
      s,
      0,
      1,
      c,
      0,
      -s,
      1,
      1,
      c,
      t,
      -s,
      1,
      0,
      -c,
      t,
      s,
      0,
      0
    ]);
    baseVertexBuffer = device.createInterleavedVertexBuffer(['position_f32x3', 'tex0_f32x2'], vertices);
    this._baseVertexBuffer.set(hash, baseVertexBuffer);
    return baseVertexBuffer;
  }
  getIndexBuffer(device: AbstractDevice) {
    if (!this._indexBuffer) {
      this._indexBuffer = device.createIndexBuffer(
        new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11])
      );
    }
    return this._indexBuffer;
  }
  addGrassLayer(
    device: AbstractDevice,
    terrain: Terrain,
    density: number[][],
    bladeWidth: number,
    bladeHeigh: number,
    offset: number,
    grassTexture: Texture2D
  ): GrassLayer {
    const densityHeight = density.length;
    const densityWidth = density[0].length;
    const hfScale = terrain.heightFieldScale;
    this._clusterSize = Math.min(nextPowerOf2(this._clusterSize), terrain.width - 1, terrain.height - 1);
    let layer: GrassLayer = null;
    terrain.traverseQuadtree((node) => {
      const size = node.getPatch().getStep() * (terrain.patchSize - 1);
      if (size === this._clusterSize) {
        const bbox = node.getPatch().getBoundingBox();
        const grassData: number[] = [];
        const minX = bbox.minPoint.x;
        const minZ = bbox.minPoint.z;
        let index = 0;
        for (let i = 0; i < this._clusterSize; i++) {
          for (let j = 0; j < this._clusterSize; j++) {
            const x0 = minX + j * hfScale.x;
            const z0 = minZ + i * hfScale.z;
            const x1 = x0 + hfScale.x;
            const z1 = z0 + hfScale.z;
            const u = x0 / terrain.scaledWidth;
            const v = z0 / terrain.scaledHeight;
            const du = (densityWidth * u) >> 0;
            const dv = (densityHeight * v) >> 0;
            const val = density[dv][du] * hfScale.x * hfScale.z;
            let grassCount = 0;
            if (val > 0) {
              if (val < 1) {
                grassCount = Math.random() <= val ? 1 : 0;
              } else {
                grassCount = val >> 0;
              }
            }
            //const grassCount = (this._density[dv][du] * hfScale.x * hfScale.z) >> 0;
            for (let k = 0; k < grassCount; k++) {
              const x = Math.random() * (x1 - x0) + x0;
              const z = Math.random() * (z1 - z0) + z0;
              const y = terrain.getElevation(x, z);
              const rot = Math.random() * Math.PI * 2;
              grassData[index++] = x;
              grassData[index++] = y + offset;
              grassData[index++] = z;
              grassData[index++] = rot;
            }
          }
        }
        if (grassData.length > 0) {
          if (!layer) {
            layer = {
              material: new GrassMaterial(
                new Vector2(terrain.scaledWidth, terrain.scaledHeight),
                terrain.quadtree.normalMap,
                grassTexture
              ),
              clusters: new Map()
            };
            this._layers.push(layer);
          }
          const cluster = new GrassCluster(
            device,
            terrain,
            this.getBaseVertexBuffer(device, bladeWidth, bladeHeigh),
            this.getIndexBuffer(device),
            layer.material,
            new Float32Array(grassData)
          );
          layer.clusters.set(node, cluster);
          //const cluster = new GrassCluster(device, terrain, this.getBaseVertexBuffer(device, bladeWidth, bladeHeigh), this.getIndexBuffer(device), grassTexture, new Float32Array(grassData));

          node.grassClusters.push(cluster);
        }
      }
    });
    return layer;
  }
  /*
  private calculateXForm(x: number, z: number, mat: Matrix4x4) {
    const height = this._terrain.getElevation(x, z);
    const normal = this._terrain.getNormal(x, z);
    const q0 = Quaternion.fromAxisAngle(Vector3.axisPY(), Math.random() * Math.PI * 2);
    const q = Quaternion.unitVectorToUnitVector(Vector3.axisPY(), normal);
    tmpV3.setXYZ(x, height, z);
    mat.identity().rotateLeft(q.multiplyRight(q0)).translation(tmpV3);
  }
  */
}
/*
function interpolate(val: number, oldMin: number, oldMax: number, newMin: number, newMax: number) {
  return ((val - oldMin) * (newMax - newMin)) / (oldMax - oldMin) + newMin
}

function createGrassBladePrimitive(device: AbstractDevice) {
  const p = new Primitive();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
}

function getPrimitive(device: AbstractDevice): Primitive {
  if (!primitive) {
    primitive = new Primitive();
    const vertices: number[] = [-0.1, 0, 0, 0.1, 0, 0, 0.1, 0.8, 0, -0.1, 0.8, 0];
    const indices: number[] = [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
    const vb = device.createInterleavedVertexBuffer(['position_f32x3', 'normal_f32x3', 'tex0_f32x2'], new Float32Array(vertices));
    const ib = device.createIndexBuffer(new Uint16Array(indices));
    primitive.setVertexBuffer(vb);
    primitive.setIndexBuffer(ib)
    primitive.indexStart = 0;
    primitive.indexCount = indices.length;
    primitive.primitiveType = 'triangle-list';
  }
  return primitive;
}
*/
