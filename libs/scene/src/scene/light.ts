import { Vector3, Vector4, Matrix4x4 } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';
import { ShadowMapper } from '../shadow/shadowmapper';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import type { Scene } from './scene';

/**
 * Base class for any kind of light node
 * @public
 */
export abstract class BaseLight extends GraphNode {
  /** @internal */
  protected _type: number;
  /** @internal */
  protected _intensity: number;
  /** @internal */
  protected _positionRange: Vector4;
  /** @internal */
  protected _directionCutoff: Vector4;
  /** @internal */
  protected _diffuseIntensity: Vector4;
  /**
   * Creates a light node
   * @param scene - The scene to which the light node belongs
   * @param type - Type of the light node
   */
  constructor(scene: Scene, type: number) {
    super(scene);
    this._intensity = 1;
    this._type = type;
    this._positionRange = null;
    this._directionCutoff = null;
    this._diffuseIntensity = null;
  }
  /** Gets the light type */
  get lightType(): number {
    return this._type;
  }
  /** Intensity of the light */
  get intensity() {
    return this._intensity;
  }
  set intensity(val: number) {
    this.setIntensity(val);
  }
  /**
   * Position and range of the light
   *
   * @remarks
   * Gets the position in world space of the light.
   * Light range is encoded into the W component.
   */
  get positionAndRange(): Vector4 {
    if (!this._positionRange) {
      this.computeUniforms();
    }
    return this._positionRange;
  }
  /**
   * Direction and cutoff of the light
   *
   * @remarks
   * Gets the direction in world space of the light
   * Light cutoff (for spot light only) is encoded into the W component.
   */
  get directionAndCutoff() {
    if (!this._directionCutoff) {
      this.computeUniforms();
    }
    return this._directionCutoff;
  }
  /**
   * Color and intensity of the light
   *
   * @remarks
   * Gets the color of the light.
   * Light intensity is encoded into the W component.
   */
  get diffuseAndIntensity() {
    if (!this._diffuseIntensity) {
      this.computeUniforms();
    }
    return this._diffuseIntensity;
  }
  /**
   * View matrix of the light
   *
   * @remarks
   * The view matrix of the light is used to transform a point
   * from the world space to the light space.
   */
  get viewMatrix(): Matrix4x4 {
    return this.invWorldMatrix;
  }
  /**
   * View-projection matrix of the light
   *
   * @remarks
   * The view-projection matrix of the light is used to transform
   * a point from the world space to the clip space of the light view
   */
  get viewProjMatrix(): Matrix4x4 {
    return null;
  }
  /**
   * Sets the intensity of the light
   * @param val - Intensity of the light
   * @returns self
   */
  setIntensity(val: number) {
    if (this._intensity !== val) {
      this._intensity = val;
      this.invalidateUniforms();
    }
    return this;
  }
  /** @internal */
  invalidateUniforms() {
    this._positionRange = null;
    this._directionCutoff = null;
    this._diffuseIntensity = null;
  }
  /** {@inheritDoc SceneNode.isLight} */
  isLight(): this is BaseLight {
    return true;
  }
  /** {@inheritDoc SceneNode.isPunctualLight} */
  isPunctualLight(): this is PunctualLight {
    return false;
  }
  /** returns true if this is a directional light */
  isDirectionLight(): this is DirectionalLight {
    return false;
  }
  /** returns true if this is a point light */
  isPointLight(): this is PointLight {
    return false;
  }
  /** returns true if this is a spot light */
  isSpotLight(): this is SpotLight {
    return false;
  }
  /** @internal */
  abstract computeUniforms(): void;
}

/*
export abstract class AmbientLight extends BaseLight {
  constructor(scene: Scene, type: number) {
    super(scene, type);
  }
  isAmbientLight(): this is AmbientLight {
    return true;
  }
}
*/

/**
 * Base class for any kind of puncual light
 * @public
 */
export abstract class PunctualLight extends BaseLight {
  /** @internal */
  protected _color: Vector4;
  /** @internal */
  protected _castShadow: boolean;
  /** @internal */
  protected _lightViewProjectionMatrix: Matrix4x4;
  /** @internal */
  protected _shadowMapper: ShadowMapper;
  /**
   * Creates an instance of punctual light
   * @param scene - The scene to which the punctual light belongs
   * @param type - The light type
   */
  constructor(scene: Scene, type: number) {
    super(scene, type);
    this._color = Vector4.one();
    this._castShadow = false;
    this._lightViewProjectionMatrix = Matrix4x4.identity();
    this._shadowMapper = new ShadowMapper(this);
  }
  /** Color of the light */
  get color(): Vector4 {
    return this._color;
  }
  set color(clr: Vector4) {
    this.setColor(clr);
  }
  /**
   * Sets color of the light
   * @param color - The color to set
   * @returns self
   */
  setColor(color: Vector4) {
    this._color.set(color);
    this.invalidateUniforms();
    return this;
  }
  /** Whether this light casts shadows */
  get castShadow(): boolean {
    return this._castShadow;
  }
  set castShadow(b: boolean) {
    this.setCastShadow(b);
  }
  /**
   * Sets whether this light casts shadows
   * @param b - true if the light casts shadows
   * @returns self
   */
  setCastShadow(b: boolean): this {
    this._castShadow = b;
    return this;
  }
  /**
   * {@inheritDoc BaseLight.viewProjMatrix}
   * @override
   */
  get viewProjMatrix(): Matrix4x4 {
    return this._lightViewProjectionMatrix;
  }
  set viewProjMatrix(mat: Matrix4x4) {
    this.setLightViewProjectionMatrix(mat);
  }
  /** The shadow mapper for this light */
  get shadow(): ShadowMapper {
    return this._shadowMapper;
  }
  /**
   * Sets the view projection matrix for this light
   * @param mat - The matrix to set
   * @returns self
   */
  setLightViewProjectionMatrix(mat: Matrix4x4): this {
    this._lightViewProjectionMatrix.set(mat);
    return this;
  }
  /**
   * {@inheritDoc BaseLight.isPunctualLight}
   * @override
   */
  isPunctualLight(): this is PunctualLight {
    return true;
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean) {
    super._onTransformChanged(invalidateLocal);
    this.invalidateUniforms();
    // this._transformCallback(true, false);
  }
}

/**
 * Directional light
 * @public
 */
export class DirectionalLight extends PunctualLight {
  private static _currentSunLight: DirectionalLight = null;
  private _sunLight: boolean;
  /**
   * Creates an instance of directional light
   * @param scene - The scene to which the light belongs
   */
  constructor(scene: Scene) {
    super(scene, LIGHT_TYPE_DIRECTIONAL);
    if (!DirectionalLight._currentSunLight) {
      DirectionalLight._currentSunLight = this;
      this._sunLight = true;
    } else {
      this._sunLight = false;
    }
  }
  /**
   * true if the light was defined as sun light
   *
   * @remarks
   * Only one directional light will be marked as sun light.
   **/
  get sunLight(): boolean {
    return this._sunLight;
  }
  set sunLight(val: boolean) {
    if (!!val !== this._sunLight) {
      this._sunLight = !!val;
      if (this._sunLight) {
        DirectionalLight._currentSunLight._sunLight = false;
        DirectionalLight._currentSunLight = this;
      } else {
        DirectionalLight._currentSunLight = null;
      }
    }
    this._sunLight = !!val;
  }
  /**
   * {@inheritDoc BaseLight.isDirectionLight}
   * @override
   */
  isDirectionLight(): this is DirectionalLight {
    return true;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    return null;
  }
  /** @internal */
  computeUniforms() {
    const a = this.worldMatrix.getRow(3);
    const b = this.worldMatrix.getRow(2).scaleBy(-1);
    this._positionRange = new Vector4(a.x, a.y, a.z, -1);
    this._directionCutoff = new Vector4(b.x, b.y, b.z, 0);
    this._diffuseIntensity = new Vector4(this.color.x, this.color.y, this.color.z, this.intensity);
  }
  // adapt from DXSDK
  /*
  private _computeNearAndFar(
    frustumMin: Vector3,
    frustumMax: Vector3,
    aabbLightSpace: Vector3[]
  ): [number, number] {
    type Triangle = { pt: [Vector3, Vector3, Vector3]; culled: boolean };
    function dupTriangle(src: Triangle): Triangle {
      return {
        pt: [
          src.pt[0] ? new Vector3(src.pt[0]) : null,
          src.pt[1] ? new Vector3(src.pt[1]) : null,
          src.pt[2] ? new Vector3(src.pt[2]) : null
        ],
        culled: src.culled
      };
    }
    let nearPlane = Number.MAX_VALUE;
    let farPlane = -Number.MAX_VALUE;
    const triangleList: Triangle[] = Array.from({ length: 16 }).map((val) => ({
      pt: [null, null, null],
      culled: false
    }));
    let triangleCount = 1;
    triangleList[0].pt[0] = aabbLightSpace[0];
    triangleList[0].pt[1] = aabbLightSpace[1];
    triangleList[0].pt[2] = aabbLightSpace[2];
    const triIndices = [
      0, 1, 2, 1, 2, 3, 4, 5, 6, 5, 6, 7, 0, 2, 4, 2, 4, 6, 1, 3, 5, 3, 5, 7, 0, 1, 4, 1, 4, 5, 2, 3, 6, 3, 6,
      7
    ];
    const pointPassesCollision: number[] = [0, 0, 0];
    const minx = frustumMin.x;
    const maxx = frustumMax.x;
    const miny = frustumMin.y;
    const maxy = frustumMax.y;
    for (let i = 0; i < 12; i++) {
      triangleList[0].pt[0] = aabbLightSpace[triIndices[i * 3 + 0]];
      triangleList[0].pt[1] = aabbLightSpace[triIndices[i * 3 + 1]];
      triangleList[0].pt[2] = aabbLightSpace[triIndices[i * 3 + 2]];
      triangleList[0].culled = false;
      triangleCount = 1;
      for (let j = 0; j < 4; j++) {
        let edge: number, comp: number;
        if (j === 0) {
          edge = minx;
          comp = 0;
        } else if (j === 1) {
          edge = maxx;
          comp = 0;
        } else if (j === 2) {
          edge = miny;
          comp = 1;
        } else {
          edge = maxy;
          comp = 1;
        }
        let k = 0;
        while (k < triangleCount) {
          if (!triangleList[k].culled) {
            let insideVertCount = 0;
            let tempOrder: Vector3 = null;
            if (j === 0) {
              for (let t = 0; t < 3; t++) {
                if (triangleList[k].pt[t].x > minx) {
                  pointPassesCollision[t] = 1;
                } else {
                  pointPassesCollision[t] = 0;
                }
                insideVertCount += pointPassesCollision[t];
              }
            } else if (j === 1) {
              for (let t = 0; t < 3; t++) {
                if (triangleList[k].pt[t].x < maxx) {
                  pointPassesCollision[t] = 1;
                } else {
                  pointPassesCollision[t] = 0;
                }
                insideVertCount += pointPassesCollision[t];
              }
            } else if (j === 2) {
              for (let t = 0; t < 3; t++) {
                if (triangleList[k].pt[t].y > miny) {
                  pointPassesCollision[t] = 1;
                } else {
                  pointPassesCollision[t] = 0;
                }
                insideVertCount += pointPassesCollision[t];
              }
            } else {
              for (let t = 0; t < 3; t++) {
                if (triangleList[k].pt[t].y < maxy) {
                  pointPassesCollision[t] = 1;
                } else {
                  pointPassesCollision[t] = 0;
                }
                insideVertCount += pointPassesCollision[t];
              }
            }
            if (pointPassesCollision[1] && !pointPassesCollision[0]) {
              tempOrder = triangleList[k].pt[0];
              triangleList[k].pt[0] = triangleList[k].pt[1];
              triangleList[k].pt[1] = tempOrder;
              pointPassesCollision[0] = 1;
              pointPassesCollision[1] = 0;
            }
            if (pointPassesCollision[2] && !pointPassesCollision[1]) {
              tempOrder = triangleList[k].pt[1];
              triangleList[k].pt[1] = triangleList[k].pt[2];
              triangleList[k].pt[2] = tempOrder;
              pointPassesCollision[1] = 1;
              pointPassesCollision[2] = 0;
            }
            if (pointPassesCollision[1] && !pointPassesCollision[0]) {
              tempOrder = triangleList[k].pt[0];
              triangleList[k].pt[0] = triangleList[k].pt[1];
              triangleList[k].pt[1] = tempOrder;
              pointPassesCollision[0] = 1;
              pointPassesCollision[1] = 0;
            }
            if (insideVertCount === 0) {
              triangleList[k].culled = true;
            } else if (insideVertCount === 1) {
              triangleList[k].culled = false;
              const v0Tov1 = Vector3.sub(triangleList[k].pt[1], triangleList[k].pt[0]);
              const v0Tov2 = Vector3.sub(triangleList[k].pt[2], triangleList[k].pt[0]);
              const hitPointTimeRatio = edge - triangleList[k].pt[0][comp];
              const distanceAlongV1 = hitPointTimeRatio / v0Tov1[comp];
              const distanceAloneV2 = hitPointTimeRatio / v0Tov2[comp];
              v0Tov1.scaleBy(distanceAlongV1);
              v0Tov1.addBy(triangleList[k].pt[0]);
              v0Tov2.scaleBy(distanceAloneV2);
              v0Tov2.addBy(triangleList[k].pt[0]);
              triangleList[k].pt[1] = v0Tov2;
              triangleList[k].pt[2] = v0Tov1;
            } else if (insideVertCount === 2) {
              triangleList[triangleCount] = dupTriangle(triangleList[k + 1]);
              triangleList[k].culled = false;
              triangleList[k + 1].culled = false;
              const v2Tov0 = Vector3.sub(triangleList[k].pt[0], triangleList[k].pt[2]);
              const v2Tov1 = Vector3.sub(triangleList[k].pt[1], triangleList[k].pt[2]);
              const hitPointTime_2_0 = edge - triangleList[k].pt[2][comp];
              const distanceAloneVec_2_0 = hitPointTime_2_0 / v2Tov0[comp];
              v2Tov0.scaleBy(distanceAloneVec_2_0);
              v2Tov0.addBy(triangleList[k].pt[2]);
              triangleList[k + 1].pt[0] = new Vector3(triangleList[k].pt[0]);
              triangleList[k + 1].pt[1] = new Vector3(triangleList[k].pt[1]);
              triangleList[k + 1].pt[2] = v2Tov0;
              const hitPointTime_2_1 = edge - triangleList[k].pt[2][comp];
              const distanceAloneVec_2_1 = hitPointTime_2_1 / v2Tov1[comp];
              v2Tov1.scaleBy(distanceAloneVec_2_1);
              v2Tov1.addBy(triangleList[k].pt[2]);
              triangleList[k].pt[0] = new Vector3(triangleList[k + 1].pt[1]);
              triangleList[k].pt[1] = new Vector3(triangleList[k + 1].pt[2]);
              triangleList[k].pt[2] = v2Tov1;
              triangleCount++;
              k++;
            } else {
              triangleList[k].culled = false;
            }
          }
          k++;
        }
      }
      for (let index = 0; index < triangleCount; index++) {
        if (!triangleList[index].culled) {
          for (let v = 0; v < 3; v++) {
            const z = triangleList[index].pt[v].z;
            if (nearPlane > z) {
              nearPlane = z;
            }
            if (farPlane < z) {
              farPlane = z;
            }
          }
        }
      }
    }
    return [nearPlane, farPlane];
  }
  */
}

/**
 * Point light
 * @public
 */
export class PointLight extends PunctualLight {
  /** @internal */
  protected _range: number;
  /**
   * Creates an instance of point light
   * @param scene - The scene to which the light belongs
   */
  constructor(scene: Scene) {
    super(scene, LIGHT_TYPE_POINT);
    this._range = 10;
    this.invalidateBoundingVolume();
  }
  /** The range of the light */
  get range() {
    return this._range;
  }
  set range(val: number) {
    this.setRange(val);
  }
  /**
   * Sets the range of the light
   * @param val - The value to set
   * @returns self
   */
  setRange(val: number) {
    val = val < 0 ? 0 : val;
    if (this._range !== val) {
      this._range = val;
      this.invalidateUniforms();
      this.invalidateBoundingVolume();
    }
    return this;
  }
  /**
   * {@inheritDoc BaseLight.isPointLight}
   * @override
   */
  isPointLight(): this is PointLight {
    return true;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    const bbox = new BoundingBox();
    bbox.minPoint = new Vector3(-this._range, -this._range, -this._range);
    bbox.maxPoint = new Vector3(this._range, this._range, this._range);
    return bbox;
  }
  /** @internal */
  computeUniforms() {
    const a = this.worldMatrix.getRow(3);
    const b = this.worldMatrix.getRow(2);
    this._positionRange = new Vector4(a.x, a.y, a.z, this.range);
    this._directionCutoff = new Vector4(b.x, b.y, b.z, -1);
    this._diffuseIntensity = new Vector4(this.color.x, this.color.y, this.color.z, this.intensity);
  }
}

/**
 * Spot light
 * @public
 */
export class SpotLight extends PunctualLight {
  /** @internal */
  protected _range: number;
  /** @internal */
  protected _cutoff: number;
  /**
   * Creates an instance of spot light
   * @param scene - The scene to which the light belongs
   */
  constructor(scene: Scene) {
    super(scene, LIGHT_TYPE_SPOT);
    this._range = 10;
    this._cutoff = Math.cos(Math.PI / 4);
    this.invalidateBoundingVolume();
  }
  /** The range of the light */
  get range() {
    return this._range;
  }
  set range(val: number) {
    this.setRange(val);
  }
  /**
   * Sets the range of the light
   * @param val - The value to set
   * @returns self
   */
  setRange(val: number) {
    val = val < 0 ? 0 : val;
    if (this._range !== val) {
      this._range = val;
      this.invalidateUniforms();
      this.invalidateBoundingVolume();
    }
    return this;
  }
  /** The cutoff of the light */
  get cutoff() {
    return this._cutoff;
  }
  set cutoff(val: number) {
    this.setCutoff(val);
  }
  /**
   * Sets the cutoff of the light
   * @param val - The value to set
   * @returns self
   */
  setCutoff(val: number) {
    val = val < 0 ? 0 : val;
    if (this._cutoff !== val) {
      this._cutoff = val;
      this.invalidateUniforms();
      this.invalidateBoundingVolume();
    }
    return this;
  }
  /**
   * {@inheritDoc BaseLight.isSpotLight}
   * @override
   */
  isSpotLight(): this is SpotLight {
    return true;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    const bbox = new BoundingBox();
    const cosCutoff = Math.cos(this._cutoff);
    const r = (this._range / cosCutoff) * Math.sqrt(1 - cosCutoff * cosCutoff);
    bbox.minPoint = new Vector3(-r, -r, 0);
    bbox.maxPoint = new Vector3(r, r, this._range);
    return bbox;
  }
  /** @internal */
  computeUniforms() {
    const a = this.worldMatrix.getRow(3);
    const b = this.worldMatrix.getRow(2).scaleBy(-1);
    this._positionRange = new Vector4(a.x, a.y, a.z, this.range);
    this._directionCutoff = new Vector4(b.x, b.y, b.z, Math.cos(this.cutoff));
    this._diffuseIntensity = new Vector4(this.color.x, this.color.y, this.color.z, this.intensity);
  }
}
