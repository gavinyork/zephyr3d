import type { Quaternion, Vector3 } from '@zephyr3d/base';

export type TRS = {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
};
