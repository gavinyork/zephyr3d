import { mat4, quat, vec3 } from 'gl-matrix';

export class Transform {
  set rotation(rotation: quat) {
    quat.copy(this._rotation, rotation);
    this._dirty = true;
  }

  get rotation() {
    return quat.fromValues(
      this._rotation[0],
      this._rotation[1],
      this._rotation[2],
      this._rotation[3]
    );
  }

  set position(position: vec3) {
    vec3.copy(this._position, position);
    this._dirty = true;
  }

  get position() {
    return vec3.fromValues(
      this._position[0],
      this._position[1],
      this._position[2]
    );
  }

  set scale(scale: vec3) {
    vec3.copy(this._scale, scale);
    this._dirty = true;
  }

  get scale() {
    return vec3.fromValues(this._scale[0], this._scale[1], this._scale[2]);
  }

  get forward(): vec3 {
    return [-this.transform[8], -this.transform[9], -this.transform[10]];
  }

  get right(): vec3 {
    return [this.transform[0], this.transform[1], this.transform[2]];
  }

  get up(): vec3 {
    return [this.transform[4], this.transform[5], this.transform[6]];
  }

  get transform() {
    if (this._dirty) {
      mat4.fromRotationTranslationScale(
        this._transform,
        this._rotation,
        this._position,
        this._scale
      );
      this._dirty = true;
    }
    return this._transform;
  }

  protected _transform: mat4 = mat4.create();
  protected _dirty = true;

  constructor(
    protected _position: vec3 = vec3.create(),
    protected _scale: vec3 = vec3.fromValues(1.0, 1.0, 1.0),
    protected _rotation: quat = quat.create()
  ) {}

  lookAt(eye: vec3, at: vec3) {
    const view = mat4.clone(this._transform);
    mat4.targetTo(view, eye, at, [0.0, 1.0, 0.0]);
    mat4.getTranslation(this._position, view);
    mat4.getRotation(this._rotation, view);
  }

  reset() {
    mat4.identity(this._transform);
    vec3.zero(this._position);
    quat.identity(this._rotation);
    vec3.set(this._scale, 1.0, 1.0, 1.0);
    this._dirty = false;
  }
}
