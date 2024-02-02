import { quat, vec2, vec3 } from 'gl-matrix';
import { fromEvent, Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import { Camera } from '../graphics';
import { CameraControllerInterface } from './camera-controller-interface';
import { MouseButton } from './mouse-button';

export enum Key {
  Backspace = 8,
  Tab = 9,
  Enter = 13,
  Shift = 16,
  Ctrl = 17,
  Alt = 18,
  PauseBreak = 19,
  CapsLock = 20,
  Escape = 27,
  Space = 32,
  PageUp = 33,
  PageDown = 34,
  End = 35,
  Home = 36,
  LeftArrow = 37,
  UpArrow = 38,
  RightArrow = 39,
  DownArrow = 40,
  Insert = 45,
  Delete = 46,
  Zero = 48,
  ClosedParen = 48,
  One = 49,
  ExclamationMark = 49,
  Two = 50,
  AtSign = 50,
  Three = 51,
  PoundSign = 51,
  Hash = 51,
  Four = 52,
  DollarSign = 52,
  Five = 53,
  PercentSign = 53,
  Six = 54,
  Caret = 54,
  Hat = 54,
  Seven = 55,
  Ampersand = 55,
  Eight = 56,
  Star = 56,
  Asterik = 56,
  Nine = 57,
  OpenParen = 57,
  A = 65,
  B = 66,
  C = 67,
  D = 68,
  E = 69,
  F = 70,
  G = 71,
  H = 72,
  I = 73,
  J = 74,
  K = 75,
  L = 76,
  M = 77,
  N = 78,
  O = 79,
  P = 80,
  Q = 81,
  R = 82,
  S = 83,
  T = 84,
  U = 85,
  V = 86,
  W = 87,
  X = 88,
  Y = 89,
  Z = 90,
  LeftWindowKey = 91,
  RightWindowKey = 92,
  SelectKey = 93,
  Numpad0 = 96,
  Numpad1 = 97,
  Numpad2 = 98,
  Numpad3 = 99,
  Numpad4 = 100,
  Numpad5 = 101,
  Numpad6 = 102,
  Numpad7 = 103,
  Numpad8 = 104,
  Numpad9 = 105,
  Multiply = 106,
  Add = 107,
  Subtract = 109,
  DecimalPoint = 110,
  Divide = 111,
  F1 = 112,
  F2 = 113,
  F3 = 114,
  F4 = 115,
  F5 = 116,
  F6 = 117,
  F7 = 118,
  F8 = 119,
  F9 = 120,
  F10 = 121,
  F11 = 122,
  F12 = 123,
  NumLock = 144,
  ScrollLock = 145,
  SemiColon = 186,
  Equals = 187,
  Comma = 188,
  Dash = 189,
  Period = 190,
  UnderScore = 189,
  PlusSign = 187,
  ForwardSlash = 191,
  Tilde = 192,
  GraveAccent = 192,
  OpenBracket = 219,
  ClosedBracket = 221,
  Quote = 222
}

export class FpsCameraController implements CameraControllerInterface {
  private click: vec2 = vec2.create();
  private target: HTMLElement;
  private up$ = new Subject<void>();
  private release$ = new Subject<void>();
  private readonly keys = new Map<Key, boolean>();

  private velocity = vec3.create();
  private yaw = 0.0;
  private pitch = 0.0;
  private q = quat.create();
  private active = false;

  constructor(
    private canvas: HTMLCanvasElement,
    public readonly camera: Camera,
    private speed = 1.0e1,
    public sensibility = 1.0e-2
  ) {
    this.canvas = canvas;

    fromEvent(this.canvas, 'contextmenu')
      .pipe(takeUntil(this.release$))
      .subscribe((e: MouseEvent) => (e.preventDefault(), false));

    fromEvent(this.canvas, 'mousedown')
      .pipe(
        takeUntil(this.release$),
        filter((e: MouseEvent) => e.button === MouseButton.Right)
      )
      .subscribe((e: MouseEvent) => this.mouseDown(e));

    fromEvent(this.canvas, 'wheel')
      .pipe(
        takeUntil(this.release$),
        filter(() => this.active)
      )
      .subscribe((e: WheelEvent) => this.scroll(e));

    fromEvent(document, 'keydown')
      .pipe(
        takeUntil(this.release$),
        filter((e: KeyboardEvent) => !this.keys.has(e.keyCode))
      )
      .subscribe((e: KeyboardEvent) => {
        this.keys.set(e.keyCode, true);
      });

    fromEvent(document, 'keyup')
      .pipe(
        takeUntil(this.release$),
        filter((e: KeyboardEvent) => this.keys.has(e.keyCode))
      )
      .subscribe((e: KeyboardEvent) => {
        this.keys.delete(e.keyCode);
      });
  }

  update(dt: number) {
    this.move(dt);
  }

  release() {
    this.release$.next();
  }

  private mouseDown(e: MouseEvent) {
    this.target = e.target as HTMLElement;
    this.target.style.cursor = 'crosshair';

    this.yaw = signedAngle(x, this.camera.right, y);
    this.pitch = signedAngle(y, this.camera.up, this.camera.right);
    this.click = vec2.fromValues(e.pageX, e.pageY);
    this.active = true;

    fromEvent(document, 'mousemove')
      .pipe(takeUntil(this.up$))
      .subscribe((e: MouseEvent) => this.mouseMove(e));

    fromEvent(document, 'mouseup')
      .pipe(takeUntil(this.up$))
      .subscribe(() => this.mouseUp());

    e.preventDefault();
  }

  private mouseMove(e: MouseEvent) {
    const dx = (this.click[0] - e.pageX) * this.sensibility;
    const dy = (this.click[1] - e.pageY) * this.sensibility;

    quat.identity(this.q);
    quat.rotateY(this.q, this.q, this.yaw + dx);
    quat.rotateX(this.q, this.q, this.pitch + dy);
    this.camera.rotation = this.q;
  }

  private mouseUp() {
    this.up$.next();
    this.target.style.cursor = 'default';
    this.active = false;
  }

  private scroll(e: WheelEvent) {
    if (e.deltaY < 0) {
      this.speed = this.speed * 1.2;
    } else {
      this.speed = this.speed * 0.8;
    }
  }

  private move(dt: number) {
    vec3.set(this.velocity, 0, 0, 0);
    if (this.keys.has(Key.W)) {
      vec3.add(this.velocity, this.velocity, this.camera.forward);
    }
    if (this.keys.has(Key.S)) {
      vec3.sub(this.velocity, this.velocity, this.camera.forward);
    }
    if (this.keys.has(Key.A)) {
      vec3.sub(this.velocity, this.velocity, this.camera.right);
    }
    if (this.keys.has(Key.D)) {
      vec3.add(this.velocity, this.velocity, this.camera.right);
    }
    if (this.keys.has(Key.Q)) {
      vec3.sub(this.velocity, this.velocity, y);
    }
    if (this.keys.has(Key.E)) {
      vec3.add(this.velocity, this.velocity, y);
    }
    const length = vec3.len(this.velocity);
    if (length > 0) {
      vec3.scale(this.velocity, this.velocity, length * this.speed);
    }

    this.camera.position = vec3.scaleAndAdd(
      this.camera.position,
      this.camera.position,
      this.velocity,
      dt
    );
  }
}

const signedAngle = (
  (cross: vec3) =>
  (a: vec3, b: vec3, look: vec3): number => {
    vec3.cross(cross, a, b);
    const angle = vec3.angle(a, b);
    return vec3.dot(cross, look) > 0 ? angle : 2 * Math.PI - angle;
  }
)(vec3.create());

const x = vec3.fromValues(1.0, 0.0, 0.0);
const y = vec3.fromValues(0.0, 1.0, 0.0);
