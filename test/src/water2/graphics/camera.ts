import { mat4, vec3, glMatrix } from 'gl-matrix';

import { Transform } from './transform';

export class Camera extends Transform {
  get view() {
    mat4.invert(this._view, mat4.clone(this.transform));
    return this._view;
  }

  get projection() {
    return this._projection;
  }

  get fov(): number {
    return this._fov;
  }

  set fov(fov: number) {
    this._fov = fov;
    this.updateProjection();
  }

  get aspect(): number {
    return this._aspect;
  }

  set aspect(aspect: number) {
    this._aspect = aspect;
    this.updateProjection();
  }

  get near(): number {
    return this._near;
  }

  set near(near: number) {
    this._near = near;
    this.updateProjection();
  }

  get far(): number {
    return this._far;
  }

  set far(far: number) {
    this._far = far;
    this.updateProjection();
  }

  protected _view: mat4 = mat4.create();
  protected _projection: mat4 = mat4.create();

  constructor(
    private _fov: number,
    private _aspect: number,
    private _near: number,
    private _far: number
  ) {
    super();
    this.updateProjection();
  }

  lookAt(eye: vec3, at: vec3) {
    mat4.targetTo(this._view, eye, at, [0.0, 1.0, 0.0]);
    mat4.getTranslation(this._position, this._view);
    mat4.getRotation(this._rotation, this._view);
    this._dirty = true;
  }

  private updateProjection() {
    mat4.perspective(
      this._projection,
      glMatrix.toRadian(this._fov),
      this._aspect,
      this._near,
      this._far
    );
  }
}
