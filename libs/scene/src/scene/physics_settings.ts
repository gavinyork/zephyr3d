import { Vector3 } from '@zephyr3d/base';

/** Number of collision layers. @public */
export const PHYSICS_LAYER_COUNT = 16;
const ALL_LAYERS = (1 << PHYSICS_LAYER_COUNT) - 1;

/**
 * Physics settings saved with a scene.
 *
 * @remarks
 * Plain data: the scene package does not simulate anything. A physics package
 * reads these when it simulates the scene, and picks up later changes through
 * {@link ScenePhysicsSettings.version}. A scene without settings
 * ({@link Scene.physicsSettings} null) uses the physics package's defaults,
 * which match the defaults here.
 *
 * @public
 */
export class ScenePhysicsSettings {
  private readonly _gravity: Vector3;
  private _fixedTimeStep: number;
  private _maxSubSteps: number;
  private _interpolation: boolean;
  private _waitForCollidersOnStart: boolean;
  private readonly _layerNames: string[];
  private readonly _layerMasks: number[];
  private _version: number;
  constructor() {
    this._gravity = new Vector3(0, -9.81, 0);
    this._fixedTimeStep = 1 / 60;
    this._maxSubSteps = 4;
    this._interpolation = true;
    this._waitForCollidersOnStart = true;
    this._layerNames = Array.from({ length: PHYSICS_LAYER_COUNT }, (_, i) =>
      ScenePhysicsSettings.defaultLayerName(i)
    );
    this._layerMasks = new Array<number>(PHYSICS_LAYER_COUNT).fill(ALL_LAYERS);
    this._version = 0;
  }
  /** Name a layer has until renamed. */
  static defaultLayerName(layer: number) {
    return layer === 0 ? 'Default' : `Layer ${layer}`;
  }
  /** Increases whenever a setting changes. */
  get version() {
    return this._version;
  }
  /** Gravity in m/s². Default (0, -9.81, 0). Returns a copy; assign to change it. */
  get gravity(): Vector3 {
    return new Vector3(this._gravity);
  }
  set gravity(value: Vector3) {
    if (!this._gravity.equalsTo(value)) {
      this._gravity.set(value);
      this._version++;
    }
  }
  /** Length of one simulation step, in seconds. Default 1/60. */
  get fixedTimeStep() {
    return this._fixedTimeStep;
  }
  set fixedTimeStep(value: number) {
    value = Math.max(1e-4, value);
    if (value !== this._fixedTimeStep) {
      this._fixedTimeStep = value;
      this._version++;
    }
  }
  /** Most simulation steps taken in one frame. Default 4. */
  get maxSubSteps() {
    return this._maxSubSteps;
  }
  set maxSubSteps(value: number) {
    value = Math.max(1, Math.floor(value));
    if (value !== this._maxSubSteps) {
      this._maxSubSteps = value;
      this._version++;
    }
  }
  /** Whether moving bodies are drawn between simulation steps. Default true. */
  get interpolation() {
    return this._interpolation;
  }
  set interpolation(value: boolean) {
    if (!!value !== this._interpolation) {
      this._interpolation = !!value;
      this._version++;
    }
  }
  /** Whether the simulation waits for mesh and terrain colliders before starting. Default true. */
  get waitForCollidersOnStart() {
    return this._waitForCollidersOnStart;
  }
  set waitForCollidersOnStart(value: boolean) {
    if (!!value !== this._waitForCollidersOnStart) {
      this._waitForCollidersOnStart = !!value;
      this._version++;
    }
  }
  /** Display name of a layer. */
  getLayerName(layer: number) {
    return this._layerNames[layer] ?? '';
  }
  setLayerName(layer: number, name: string) {
    if (layer >= 0 && layer < PHYSICS_LAYER_COUNT && this._layerNames[layer] !== name) {
      this._layerNames[layer] = name;
      this._version++;
    }
  }
  /** Whether colliders on layers `a` and `b` collide. All layers collide by default. */
  getLayerCollision(a: number, b: number) {
    return !!((this._layerMasks[a] ?? 0) & (1 << b));
  }
  /** Sets whether colliders on layers `a` and `b` collide; applies to both orders. */
  setLayerCollision(a: number, b: number, enabled: boolean) {
    if (a < 0 || a >= PHYSICS_LAYER_COUNT || b < 0 || b >= PHYSICS_LAYER_COUNT) {
      return;
    }
    if (this.getLayerCollision(a, b) === !!enabled && this.getLayerCollision(b, a) === !!enabled) {
      return;
    }
    if (enabled) {
      this._layerMasks[a] |= 1 << b;
      this._layerMasks[b] |= 1 << a;
    } else {
      this._layerMasks[a] &= ~(1 << b);
      this._layerMasks[b] &= ~(1 << a);
    }
    this._version++;
  }
  /** Layer names as saved: a JSON array of 16 strings. @internal */
  get layerNamesData() {
    return JSON.stringify(this._layerNames);
  }
  set layerNamesData(value: string) {
    let names: unknown;
    try {
      names = JSON.parse(value);
    } catch {
      names = null;
    }
    for (let i = 0; i < PHYSICS_LAYER_COUNT; i++) {
      const name = Array.isArray(names) ? names[i] : undefined;
      this.setLayerName(i, typeof name === 'string' ? name : ScenePhysicsSettings.defaultLayerName(i));
    }
  }
  /**
   * Collision matrix as saved: 16 comma separated masks, bit `b` of mask `a`
   * set when layers `a` and `b` collide. Made symmetric on load: a pair collides
   * if either order says so. @internal
   */
  get layerMatrixData() {
    return this._layerMasks.join(',');
  }
  set layerMatrixData(value: string) {
    const parts = value.split(',');
    const masks = Array.from({ length: PHYSICS_LAYER_COUNT }, (_, i) => {
      const n = Number(parts[i]);
      return parts[i] !== undefined && parts[i].trim() !== '' && Number.isFinite(n)
        ? n & ALL_LAYERS
        : ALL_LAYERS;
    });
    for (let a = 0; a < PHYSICS_LAYER_COUNT; a++) {
      for (let b = a; b < PHYSICS_LAYER_COUNT; b++) {
        this.setLayerCollision(a, b, !!((masks[a] >> b) & 1) || !!((masks[b] >> a) & 1));
      }
    }
  }
}
