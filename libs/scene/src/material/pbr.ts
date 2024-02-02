import { StandardMaterial } from './standard';
import { PBRLightModelMR, PBRLightModelSG } from './lightmodel';

/**
 * PBR material for metallic-roughenss work flow
 * @public
 */
export class PBRMetallicRoughnessMaterial extends StandardMaterial<PBRLightModelMR> {
  constructor() {
    super();
    this.lightModel = new PBRLightModelMR();
  }
  get GGXLUT() {
    return PBRLightModelMR.getGGXLUT();
  }
}

/**
 * PBR material for specular-glossness workflow
 * @public
 */
export class PBRSpecularGlossinessMaterial extends StandardMaterial<PBRLightModelSG> {
  constructor() {
    super();
    this.lightModel = new PBRLightModelSG();
  }
}
