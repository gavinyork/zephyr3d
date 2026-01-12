import type { Scene } from './scene';
import type { Sprite3DMaterial } from '../material/sprite3d';
import { StandardSprite3DMaterial } from '../material/sprite3d_std';
import { Sprite } from './sprite';

/**
 * 3D Sprite node
 * @public
 */
export class Sprite3D extends Sprite<Sprite3DMaterial> {
  constructor(scene: Scene, material?: Sprite3DMaterial) {
    super(scene);
    this.material = material ?? new StandardSprite3DMaterial();
  }
  isSprite3D(): this is Sprite3D {
    return true;
  }
}
