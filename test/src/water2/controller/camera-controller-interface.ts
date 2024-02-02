import { Camera } from '../graphics';

export interface CameraControllerInterface {
  readonly camera: Camera;
  update(dt: number): void;
  release(): void;
}
