import { Ray, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { RenderStateSet, Texture2D } from '@zephyr3d/device';
import { Quadtree } from './quadtree';
import { MAX_DETAIL_TEXTURE_LEVELS, TerrainMaterial } from '../../material/terrainmaterial';
import { GraphNode } from '../graph_node';
import { Application } from '../../app';
import { GrassManager } from './grass';
import { GrassMaterial } from '../../material/grassmaterial';
import { TerrainLightModelOptions } from '../../material/terrainlightmodel';
import type { Camera } from '../../camera/camera';
import type { BoundingVolume } from '../../utility/bounding_volume';
import type { CullVisitor } from '../../render/cull_visitor';
import type { Scene } from '../scene';
import type { QuadtreeNode } from './quadtree';

/**
 * Terrain node
 * @public
 */
export class Terrain extends GraphNode {
  /** @internal */
  private _quadtree: Quadtree;
  /** @internal */
  private _grassManager: GrassManager;
  /** @internal */
  private _maxPixelError: number;
  /** @internal */
  private _maxPixelErrorDirty: boolean;
  /** @internal */
  private _lodCamera: Camera;
  /** @internal */
  private _heightFieldScale: Vector3;
  /** @internal */
  private _patchSize: number;
  /** @internal */
  private _lastTanHalfFOVY: number;
  /** @internal */
  private _width: number;
  /** @internal */
  private _height: number;
  /** @internal */
  private _material: TerrainMaterial;
  /** @internal */
  private _grassMaterial: GrassMaterial;
  /** @internal */
  private _maxDetailTextureLevels: number;
  /** @internal */
  private _wireframe: boolean;
  /** @internal */
  private _viewPoint: Vector3;
  /** @internal */
  private _castShadow: boolean;
  /** @internal */
  private _instanceColor: Vector4;
  /** @internal */
  private _overridenStateSet: RenderStateSet;
  /**
   * Creates an instance of Terrain
   * @param scene - The scene to which the terrain belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._quadtree = null;
    this._grassManager = null;
    this._maxPixelError = 10;
    this._maxPixelErrorDirty = true;
    this._lodCamera = null;
    this._heightFieldScale = Vector3.one();
    this._patchSize = 33;
    this._lastTanHalfFOVY = 0;
    this._width = 0;
    this._height = 0;
    this._material = null;
    this._grassMaterial = null;
    this._maxDetailTextureLevels = MAX_DETAIL_TEXTURE_LEVELS;
    this._wireframe = false;
    this._viewPoint = null;
    this._castShadow = false;
    this._instanceColor = Vector4.zero();
    this._overridenStateSet = null;
  }
  /** @internal */
  get quadtree(): Quadtree {
    return this._quadtree;
  }
  /**
   * {@inheritDoc Drawable.getName}
   */
  getName(): string {
    return this._name;
  }
  /**
   * {@inheritDoc Drawable.getInstanceColor}
   */
  getInstanceColor(): Vector4 {
    return this._instanceColor;
  }
  /** Wether the mesh node casts shadows */
  get castShadow(): boolean {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    this._castShadow = !!val;
  }
  /** The maximum value of detail texture levels */
  get maxDetailTextureLevels(): number {
    return this._maxDetailTextureLevels;
  }
  /** The maximum pixel error for terrain LOD */
  get maxPixelError(): number {
    return this._maxPixelError;
  }
  set maxPixelError(val: number) {
    if (val !== this._maxPixelError) {
      this._maxPixelError = val;
      this._maxPixelErrorDirty = true;
    }
  }
  /** Camera that will be used to compute LOD level of terrain patches */
  get LODCamera(): Camera {
    return this._lodCamera;
  }
  set LODCamera(camera: Camera) {
    this._lodCamera = camera;
  }
  /** Scaled terrain width */
  get scaledWidth(): number {
    return this._width * this._heightFieldScale.x;
  }
  /** Scaled terrain height */
  get scaledHeight(): number {
    return this._height * this._heightFieldScale.z;
  }
  /** Scale value of the height field */
  get heightFieldScale(): Vector3 {
    return this._heightFieldScale;
  }
  /** @internal */
  get patchSize(): number {
    return this._patchSize;
  }
  /** Width of the terrain */
  get width(): number {
    return this._width;
  }
  /** Height of the terrain */
  get height(): number {
    return this._height;
  }
  /** Material of the terrain */
  get material(): TerrainMaterial {
    return this._material;
  }
  /** Grass material */
  get grassMaterial(): GrassMaterial {
    return this._grassMaterial;
  }
  /** Whether the terrain should be rendered in wireframe mode */
  get wireframe(): boolean {
    return this._wireframe;
  }
  set wireframe(b: boolean) {
    this._wireframe = !!b;
  }
  /** Normal map of the terrain */
  get normalMap(): Texture2D {
    return this._quadtree.normalMap;
  }
  /** @internal */
  get overridenStateSet(): RenderStateSet {
    return this._overridenStateSet;
  }
  /**
   * Creates the terrain
   *
   * @param sizeX - Terrain size in X axis
   * @param sizeZ - Terrain size in Z axis
   * @param elevations - Elevation data of the terrain
   * @param scale - Scale of the terrain
   * @param patchSize - Patch size of the terrain
   * @returns true if succeeded
   */
  create(sizeX: number, sizeZ: number, elevations: Float32Array, scale: Vector3, patchSize: number, options?: TerrainLightModelOptions): boolean {
    this._quadtree = new Quadtree(this);
    if (options?.splatMap && options.splatMap.format !== 'rgba8unorm') {
      throw new Error('SplatMap must be rgba8unorm format');
    }
    this._material = new TerrainMaterial(options);
    if (!this._quadtree.build(patchSize, sizeX, sizeZ, elevations, scale.x, scale.y, scale.z, 24)) {
      this._quadtree = null;
      return false;
    }
    this._patchSize = patchSize;
    this._heightFieldScale.set(scale);
    this._width = sizeX;
    this._height = sizeZ;
    this._material.lightModel.setNormalMap(this._quadtree.normalMap, null, -1);
    this._material.terrainInfo = new Vector4(this.scaledWidth, this.scaledHeight, 0, 0);
    this._overridenStateSet = Application.instance.device.createRenderStateSet();
    this._overridenStateSet.useRasterizerState().setCullMode('front');
    this.invalidateBoundingVolume();
    // create grass layers
    if (options?.splatMap && options?.detailMaps?.grass) {
      if (options.detailMaps.grass.findIndex(a => a && a.findIndex(b => !!b) >= 0) >= 0) {
        const splatMap = options.splatMap;
        const data = new Uint8Array(splatMap.width * splatMap.height * 4);
        splatMap.readPixels(0, 0, splatMap.width, splatMap.height, 0, 0, data).then(() => {
          for (let detail = 0; detail < 4; detail++) {
            if (options.detailMaps.grass[detail]) {
              for (const grass of options.detailMaps.grass[detail]) {
                if (grass) {
                  const d = grass.density ?? 1;
                  const bladeWidth = grass.bladeWidth ?? 4;
                  const bladeHeight = grass.bladeHeigh ?? 2;
                  const offset = grass.offset ?? 0;
                  const grassTexture = grass.texture ?? null;
                  const density = [] as number[][];
                  for (let i = 0; i < splatMap.height; i++) {
                    const row = [] as number[];
                    for (let j = 0; j < splatMap.width; j++) {
                      const val = data[i * 4 * splatMap.width + j * 4 + detail] / 255;
                      row.push(val * d);
                    }
                    density.push(row);
                  }
                  this.createGrass(density, bladeWidth, bladeHeight, offset, grassTexture);
                }
              }
            }
          }
        });
      }
    }
    return true;
  }
  /**
   * Create grass fields
   * @param maxGrassPerCell - Maximum number of grasses in a cell (world space 1x1)
   * @param density - The density map
   */
  createGrass(density: number[][], bladeWidth: number, bladeHeight: number, offset: number, grassTexture: Texture2D) {
    if (!this._grassManager) {
      this._grassManager = new GrassManager(64, density);
    }
    if (!this._grassMaterial) {
      this._grassMaterial = new GrassMaterial(new Vector2(this.scaledWidth, this.scaledHeight), this._quadtree.normalMap);
    }
    this._grassMaterial = new GrassMaterial(new Vector2(this.scaledWidth, this.scaledHeight), this._quadtree.normalMap, grassTexture);
    this._grassMaterial.stateSet.useRasterizerState().setCullMode('none');
    this._grassManager.addGrassLayer(Application.instance.device, this, density, bladeWidth, bladeHeight, offset, grassTexture);
  }
  /** Get elevation at specified position in terrain coordinate space */
  getElevation(x: number, z: number): number {
    return this._quadtree.getHeightField().getRealHeight(x, z);
  }
  /** Get normal at specified position in terrain coordinate space */
  getNormal(x: number, z: number, normal?: Vector3): Vector3 {
    return this._quadtree.getHeightField().getRealNormal(x, z, normal);
  }
  /** Get intersection distance by a ray in terrain coordinate space */
  rayIntersect(ray: Ray): number|null {
    return this._quadtree.getHeightField().rayIntersect(ray);
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   * @override
   */
  computeBoundingVolume(bv: BoundingVolume): BoundingVolume {
    return this._quadtree ? this._quadtree.getHeightField().getBBoxTree().getRootNode().bbox : null;
  }
  /**
   * Traverse quadtree node top down
   * @param callback - the callback function
   */
  traverseQuadtree(callback: (node: QuadtreeNode) => void) {
    function visitQuadtreeNode_r(node: QuadtreeNode) {
      callback(node);
      for (let i = 0; i < 4; i++) {
        const child = node.getChild(i);
        if (child) {
          visitQuadtreeNode_r(child);
        }
      }
    }
    const rootNode = this._quadtree.rootNode;
    if (rootNode) {
      visitQuadtreeNode_r(this._quadtree.rootNode)
    }
  }
  /** @internal */
  cull(cullVisitor: CullVisitor): number {
    const tanHalfFovy = cullVisitor.primaryCamera.getTanHalfFovy();
    if (tanHalfFovy !== this._lastTanHalfFOVY ||this._maxPixelErrorDirty) {
      this._maxPixelErrorDirty = false;
      this._lastTanHalfFOVY = tanHalfFovy;
      this._quadtree.setupCamera(1024, tanHalfFovy, this._maxPixelError);
    }
    const worldEyePos = cullVisitor.primaryCamera.getWorldPosition();
    this._viewPoint = this.invWorldMatrix.transformPointAffine(worldEyePos);
    return this._quadtree.cull(cullVisitor, this._viewPoint, this.worldMatrix);
  }
  /**
   * {@inheritDoc SceneNode.isTerrain}
   * @override
   */
  isTerrain(): this is Terrain {
    return true;
  }
}
