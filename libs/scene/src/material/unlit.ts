import { StandardMaterial } from './standard';
import { UnlitLightModel } from './lightmodel';

/**
 * Unlit material
 * @public
 */
export class UnlitMaterial extends StandardMaterial<UnlitLightModel> {
  /**
   * Creates an instance of UnlitMaterial
   */
  constructor() {
    super();
    this.lightModel = new UnlitLightModel();
  }
}
