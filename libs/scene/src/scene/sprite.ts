import type { Scene } from './scene';
import type { SpriteMaterial } from '../material/sprite';
import { StandardSpriteMaterial } from '../material/sprite_std';
import { BaseSprite } from './basesprite';

/**
 * 3D Sprite node
 * @public
 */
export class Sprite extends BaseSprite<SpriteMaterial> {
  constructor(scene: Scene, material?: SpriteMaterial) {
    super(scene);
    this.material = material ?? new StandardSpriteMaterial();
  }
  isSprite(): this is Sprite {
    return true;
  }
}
