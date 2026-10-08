import type { Nullable } from '@zephyr3d/base';
import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { IControllerMouseEvent, IControllerWheelEvent, CameraControllerUpdatePhase } from './base';
import { BaseCameraController } from './base';
import type { SceneNode } from '../scene/scene_node';
import type { NodePhysics } from '../physics/node_physics';

/**
 * Options of {@link FollowCameraController}. Angles are in radians, distances in
 * world units, rates in 1/s.
 *
 * @public
 */
export interface FollowCameraOptions {
  /**
   * `'free'`: the player turns the camera; it stays where it was turned.
   * `'chase'`: as free, but after `recenterDelay` seconds without look input the
   * camera swings back behind the target while the target moves.
   */
  mode: 'free' | 'chase';
  /** World-space offset from the target's origin to the point the camera orbits and looks at. */
  pivotOffset: Vector3;
  /** Wanted distance from the pivot. Changed by zoom input within the limits below. */
  armLength: number;
  minArmLength: number;
  maxArmLength: number;
  /** Lowest and highest pitch. Positive pitch puts the camera above the pivot, looking down. */
  minPitch: number;
  maxPitch: number;
  /** How fast the pivot catches up with the target; 0 follows rigidly. */
  positionLag: number;
  /** Chase mode: the target's local forward axis. */
  forwardAxis: Vector3;
  /** Chase mode: pitch the camera returns to. */
  chasePitch: number;
  /** Chase mode: how fast the camera swings back behind the target. */
  chaseStiffness: number;
  /** Chase mode: seconds without look input before swinging back. */
  recenterDelay: number;
  /** Chase mode: the target must move at least this fast for the camera to swing back. */
  recenterMinSpeed: number;
  /**
   * Radius of the sphere swept from the pivot to the camera. Keep it at least the
   * near plane's half-diagonal, or the near plane can still cut into walls.
   */
  probeRadius: number;
  /** Collider layers that block the camera, as bits `1 << layer`. */
  collisionMask: number;
  /** Physics object the sweep ignores. Defaults to the target's own `physics`. */
  exclude: Nullable<NodePhysics>;
  /** How fast the camera moves back out after an obstacle clears. Moving in is immediate. */
  zoomOutSpeed: number;
  /** Radians per pixel of mouse drag, for input through `camera.handleEvent`. */
  mouseSensitivity: number;
  /** Mouse buttons (as `MouseEvent.button`) that rotate the camera when dragged; empty for none. */
  mouseButtons: number[];
  /**
   * Widen the field of view with the target's speed: by `maxBoost` at `maxSpeed`
   * and above. Perspective cameras only; null disables it.
   */
  fovBoost: Nullable<{ maxBoost: number; maxSpeed: number }>;
}

const defaultOptions = (): FollowCameraOptions => ({
  mode: 'free',
  pivotOffset: new Vector3(0, 1.5, 0),
  armLength: 4,
  minArmLength: 1.5,
  maxArmLength: 12,
  minPitch: -1.0,
  maxPitch: 1.3,
  positionLag: 10,
  forwardAxis: new Vector3(0, 0, 1),
  chasePitch: 0.3,
  chaseStiffness: 3,
  recenterDelay: 1.5,
  recenterMinSpeed: 1,
  probeRadius: 0.15,
  collisionMask: ~0,
  exclude: null,
  zoomOutSpeed: 4,
  mouseSensitivity: 0.005,
  mouseButtons: [0, 2],
  fovBoost: null
});

const identity = Quaternion.identity();

/**
 * Third-person camera on a spring arm.
 *
 * The camera orbits a pivot above its target at `armLength`, turned by look
 * input. A sphere is swept from the pivot to the camera through the scene's
 * physics world: an obstacle pulls the camera in at once, and it eases back out
 * once clear. In `'chase'` mode it swings back behind a moving target when the
 * player stops turning it, as driving games do.
 *
 * Its {@link FollowCameraController.updatePhase} is `'late'`: it is updated after
 * physics, so it follows the pose of the target rendered this frame. Feed it look
 * input from an action map, or let it read mouse drags through `camera.handleEvent`.
 *
 * The camera should have no parent; it is placed in world space.
 *
 * @example
 * ```ts
 * const follow = new FollowCameraController(car, { mode: 'chase', armLength: 7 });
 * camera.controller = follow;
 * myApp.on('tick', () => {
 *   const look = driving.vector2('look');
 *   follow.addLookInput(look.x, look.y);
 * });
 * ```
 *
 * @public
 */
export class FollowCameraController extends BaseCameraController {
  /** Options; may be changed at any time. */
  readonly options: FollowCameraOptions;
  private _target: Nullable<SceneNode>;
  private _yaw: number;
  private _pitch: number;
  private readonly _pivot: Vector3;
  private readonly _lastTargetPos: Vector3;
  private _distance: number;
  private _idleTime: number;
  private _speed: number;
  private _baseFovY: number;
  private _snap: boolean;
  private _blendTime: number;
  private _blendElapsed: number;
  private readonly _blendEye: Vector3;
  private readonly _blendLookAt: Vector3;
  private readonly _eye: Vector3;
  private readonly _lookAt: Vector3;
  private _dragging: boolean;
  private _lastX: number;
  private _lastY: number;
  /**
   * @param target - Node to follow.
   * @param options - Options; unspecified ones take their defaults.
   */
  constructor(target: Nullable<SceneNode>, options?: Partial<FollowCameraOptions>) {
    super();
    this.options = { ...defaultOptions(), ...options };
    this._target = target;
    this._yaw = 0;
    this._pitch = this.options.chasePitch;
    this._pivot = new Vector3();
    this._lastTargetPos = new Vector3();
    this._distance = this.options.armLength;
    this._idleTime = 0;
    this._speed = 0;
    this._baseFovY = 0;
    this._snap = true;
    this._blendTime = 0;
    this._blendElapsed = 0;
    this._blendEye = new Vector3();
    this._blendLookAt = new Vector3();
    this._eye = new Vector3();
    this._lookAt = new Vector3();
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;
  }
  /** @override */
  get updatePhase(): CameraControllerUpdatePhase {
    return 'late';
  }
  /** The node being followed. */
  get target() {
    return this._target;
  }
  /** Horizontal angle of the arm. 0 puts the camera on the pivot's +Z side. */
  get yaw() {
    return this._yaw;
  }
  set yaw(val: number) {
    this._yaw = val;
  }
  /** Vertical angle of the arm, clamped to the pitch limits. */
  get pitch() {
    return this._pitch;
  }
  set pitch(val: number) {
    this._pitch = Math.min(Math.max(val, this.options.minPitch), this.options.maxPitch);
  }
  /** Current camera distance from the pivot, after collision. */
  get distance() {
    return this._distance;
  }
  /** Speed of the target in units per second, estimated from its movement. */
  get targetSpeed() {
    return this._speed;
  }
  /**
   * Switches to another target, e.g. when the player gets into a vehicle.
   *
   * @param target - Node to follow.
   * @param options - `blendTime`: seconds to ease from the current view to the new
   *   one, 0 to cut. `options`: options to change at the same time.
   */
  setTarget(
    target: Nullable<SceneNode>,
    options?: { blendTime?: number; options?: Partial<FollowCameraOptions> }
  ) {
    const camera = this._getCamera();
    this._blendTime = options?.blendTime ?? 0;
    this._blendElapsed = 0;
    if (camera && this._blendTime > 0 && !this._snap) {
      this._blendEye.set(this._eye);
      this._blendLookAt.set(this._lookAt);
    } else {
      this._blendTime = 0;
    }
    Object.assign(this.options, options?.options ?? {});
    this._target = target;
    this._snap = true;
  }
  /**
   * Turns the camera. Call every frame with the frame's look input, such as the
   * value of a look action.
   *
   * @param x - Radians to turn right.
   * @param y - Radians to turn up.
   */
  addLookInput(x: number, y: number) {
    if (x !== 0 || y !== 0) {
      this._yaw -= x;
      this.pitch = this._pitch - y;
      this._idleTime = 0;
    }
  }
  /**
   * Zooms the camera. The arm length is scaled by `exp(amount)`: positive moves
   * the camera out.
   *
   * @param amount - Zoom amount.
   */
  addZoomInput(amount: number) {
    const o = this.options;
    o.armLength = Math.min(Math.max(o.armLength * Math.exp(amount), o.minArmLength), o.maxArmLength);
  }
  /** Jumps to the wanted view on the next update, without lag or easing. */
  snap() {
    this._snap = true;
    this._blendTime = 0;
  }
  /** @override */
  reset() {
    this._snap = true;
    this._blendTime = 0;
  }
  /** @override */
  protected _onMouseDown(evt: IControllerMouseEvent): boolean {
    if (this.options.mouseButtons.includes(evt.button)) {
      this._dragging = true;
      this._lastX = evt.offsetX;
      this._lastY = evt.offsetY;
      return true;
    }
    return false;
  }
  /** @override */
  protected _onMouseUp(evt: IControllerMouseEvent): boolean {
    if (this._dragging && this.options.mouseButtons.includes(evt.button)) {
      this._dragging = false;
      return true;
    }
    return false;
  }
  /** @override */
  protected _onMouseMove(evt: IControllerMouseEvent): boolean {
    if (this._dragging) {
      const s = this.options.mouseSensitivity;
      this.addLookInput((evt.offsetX - this._lastX) * s, -(evt.offsetY - this._lastY) * s);
      this._lastX = evt.offsetX;
      this._lastY = evt.offsetY;
      return true;
    }
    return false;
  }
  /** @override */
  protected _onMouseWheel(evt: IControllerWheelEvent): boolean {
    this.addZoomInput(evt.deltaY * 0.001);
    return true;
  }
  /** @override */
  protected _onUpdate(dt: number) {
    const camera = this._getCamera();
    const target = this._target;
    if (!camera || !target) {
      return;
    }
    const o = this.options;
    const targetPos = target.getWorldPosition();
    const wantedPivot = Vector3.add(targetPos, o.pivotOffset);
    if (this._snap) {
      this._pivot.set(wantedPivot);
      this._lastTargetPos.set(targetPos);
      this._speed = 0;
      this._idleTime = o.recenterDelay;
      if (o.mode === 'chase') {
        this._yaw = this._chaseYaw(target);
        this.pitch = o.chasePitch;
      }
    } else {
      // Exponential approach: frame-rate independent
      const t = o.positionLag > 0 ? 1 - Math.exp(-o.positionLag * dt) : 1;
      this._pivot.combineBy(wantedPivot, 1 - t, t);
      if (dt > 0) {
        const speed = Vector3.distance(targetPos, this._lastTargetPos) / dt;
        this._speed += (speed - this._speed) * (1 - Math.exp(-8 * dt));
      }
      this._lastTargetPos.set(targetPos);
      this._idleTime += dt;
      if (o.mode === 'chase' && this._idleTime >= o.recenterDelay && this._speed >= o.recenterMinSpeed) {
        const t = 1 - Math.exp(-o.chaseStiffness * dt);
        let diff = this._chaseYaw(target) - this._yaw;
        // Shortest way round
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this._yaw += diff * t;
        this.pitch = this._pitch + (o.chasePitch - this._pitch) * t;
      }
    }
    // Spring arm: sweep from the pivot back along the view direction
    const cosPitch = Math.cos(this._pitch);
    const back = new Vector3(
      Math.sin(this._yaw) * cosPitch,
      Math.sin(this._pitch),
      Math.cos(this._yaw) * cosPitch
    );
    const free = this._sweep(back, o.armLength);
    if (this._snap || free < this._distance) {
      this._distance = free;
    } else {
      this._distance = Math.min(free, this._distance + o.zoomOutSpeed * dt);
    }
    this._lookAt.set(this._pivot);
    Vector3.combine(this._pivot, back, 1, this._distance, this._eye);
    let eye = this._eye;
    let lookAt = this._lookAt;
    if (this._blendTime > 0) {
      this._blendElapsed += dt;
      const x = Math.min(this._blendElapsed / this._blendTime, 1);
      const s = x * x * (3 - 2 * x);
      eye = Vector3.combine(this._blendEye, this._eye, 1 - s, s);
      lookAt = Vector3.combine(this._blendLookAt, this._lookAt, 1 - s, s);
      if (x >= 1) {
        this._blendTime = 0;
      }
    }
    camera.lookAt(eye, lookAt, Vector3.axisPY());
    if (camera.isPerspective()) {
      const perspective = camera as unknown as { fovY: number };
      if (o.fovBoost) {
        // The field of view without boost is taken when boosting starts
        if (!this._baseFovY) {
          this._baseFovY = perspective.fovY;
        }
        const k = Math.min(this._speed / o.fovBoost.maxSpeed, 1);
        perspective.fovY = this._baseFovY + o.fovBoost.maxBoost * k;
      } else if (this._baseFovY) {
        // Boost was turned off: restore once, then leave the field of view alone
        perspective.fovY = this._baseFovY;
        this._baseFovY = 0;
      }
    }
    this._snap = false;
  }
  /** Yaw that puts the camera behind the target */
  private _chaseYaw(target: SceneNode) {
    const fwd = target.worldMatrix.transformVectorAffine(this.options.forwardAxis, new Vector3());
    if (fwd.x === 0 && fwd.z === 0) {
      return this._yaw;
    }
    return Math.atan2(-fwd.x, -fwd.z);
  }
  /** How far the camera can go back from the pivot along `dir`, up to `length` */
  private _sweep(dir: Vector3, length: number) {
    const world = this._getCamera()?.scene?.physicsWorld;
    if (!world || length <= 0) {
      return length;
    }
    const o = this.options;
    const hit = world.shapeCast(
      { type: 'sphere', radius: o.probeRadius },
      this._pivot,
      identity,
      dir,
      length,
      {
        layerMask: o.collisionMask,
        exclude: o.exclude ?? this._target?.physics ?? null
      }
    );
    return hit ? hit.distance : length;
  }
}
