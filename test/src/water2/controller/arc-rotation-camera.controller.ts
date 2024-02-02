import { vec2, vec3 } from 'gl-matrix';
import { fromEvent, Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import { Camera } from '../graphics';
import { CameraControllerInterface } from './camera-controller-interface';
import { MouseButton } from './mouse-button';

export class ArcRotationCameraController implements CameraControllerInterface {
  private distance: number;
  private lastPhi = 0.0;
  private lastTetta = 0.0;
  private phi = 0.0;
  private tetta = 0.0;
  private lastLookAt: vec3 = [0.0, 0.0, 0.0];
  private r = vec3.create();
  private click: vec2 = vec2.create();
  private target: HTMLElement;
  private aux0: vec3 = vec3.create();
  private aux1: vec3 = vec3.create();

  private up$ = new Subject<void>();
  private release$ = new Subject<void>();

  constructor(
    private canvas: HTMLCanvasElement,
    public readonly camera: Camera,
    private lookAt: vec3 = [0.0, 0.0, 0.0],
    public rotSpeed = 1.0e-2,
    public moveSpeed = 0.25
  ) {
    this.canvas = canvas;
    this.camera.lookAt(this.camera.position, this.lookAt);
    this.sync();
    this.updateTransform();

    fromEvent(this.canvas, 'mousedown')
      .pipe(
        takeUntil(this.release$),
        filter((e: MouseEvent) => e.button === MouseButton.Middle)
      )
      .subscribe((e: MouseEvent) => this.mouseDown(e));

    fromEvent(this.canvas, 'wheel')
      .pipe(takeUntil(this.release$))
      .subscribe((e: WheelEvent) => this.scroll(e));
  }

  update() {
    this.camera.lookAt(this.r, this.lookAt);
  }

  release() {
    this.release$.next();
  }

  sync() {
    vec3.sub(this.r, this.camera.position, this.lookAt);
    this.distance = vec3.length(this.r);
    vec3.normalize(this.r, this.r);
    [this.phi, this.tetta] = cartesianToSpherical(this.r);
    this.updateTransform();
  }

  private mouseDown(e: MouseEvent) {
    this.target = e.target as HTMLElement;
    this.target.style.cursor = 'grabbing';

    fromEvent(document, 'mousemove')
      .pipe(takeUntil(this.up$))
      .subscribe((e: MouseEvent) => this.mouseMove(e));

    fromEvent(document, 'mouseup')
      .pipe(takeUntil(this.up$))
      .subscribe(() => this.mouseUp());

    this.click[0] = e.pageX;
    this.click[1] = e.pageY;
    this.lastTetta = this.tetta;
    this.lastPhi = this.phi;
    this.lastLookAt = vec3.clone(this.lookAt);
    e.preventDefault();
  }

  private mouseMove(e: MouseEvent) {
    const dx = (this.click[0] - e.pageX) * this.rotSpeed;
    const dy = (this.click[1] - e.pageY) * this.rotSpeed;
    if (e.altKey) {
      this.phi = this.lastPhi + dx;
      this.tetta = this.lastTetta + dy;
      this.tetta = clamp(this.tetta, 1.0e-3, Math.PI * (1.0 - 1.0e-3));
    } else {
      vec3.scale(this.aux0, this.camera.right, dx * this.moveSpeed);
      vec3.scale(this.aux1, this.camera.up, dy * -this.moveSpeed);
      vec3.add(this.aux0, this.aux0, this.aux1);
      vec3.add(this.lookAt, this.lastLookAt, this.aux0);
    }
    this.updateTransform();
  }

  private mouseUp() {
    this.up$.next();
    this.target.style.cursor = 'default';
  }

  private scroll(e: WheelEvent) {
    this.distance += this.moveSpeed * e.deltaY * 1.0e-2;
    this.updateTransform();
  }

  private updateTransform() {
    vec3.normalize(this.r, sphericalToCartesian(this.phi, this.tetta));
    vec3.scale(this.r, this.r, this.distance);
    vec3.add(this.r, this.r, this.lookAt);
  }
}

const sphericalToCartesian = (phi: number, tetta: number): vec3 => {
  const sinTetta = Math.sin(tetta);
  return [sinTetta * Math.sin(phi), Math.cos(tetta), sinTetta * Math.cos(phi)];
};

const cartesianToSpherical = (p: vec3): vec2 => [
  Math.atan2(p[0], p[2]),
  Math.acos(p[1]),
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(v, b));
