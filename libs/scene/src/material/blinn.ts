import { StandardMaterial } from './standard';
import { BlinnLightModel } from './lightmodel';

/**
 * Blinn-phong material
 * @public
 */
export class BlinnMaterial extends StandardMaterial<BlinnLightModel> {
  /**
   * Creates an instance of BlinnMaterial
   */
  constructor() {
    super();
    this.lightModel = new BlinnLightModel();
  }
}
