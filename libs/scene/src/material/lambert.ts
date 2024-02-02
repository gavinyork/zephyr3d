import { StandardMaterial } from './standard';
import { LambertLightModel } from './lightmodel';

/**
 * Lambert material
 * @public
 */
export class LambertMaterial extends StandardMaterial<LambertLightModel> {
  /**
   * Creates an instance of LambertMaterial
   */
  constructor() {
    super();
    this.lightModel = new LambertLightModel();
  }
}
