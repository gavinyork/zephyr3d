import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';

export class PBRMaterialEditor extends GraphEditor {
  getNodeCategory(): NodeCategory[] {
    return [...getConstantNodeCategories(), ...getTextureNodeCategories(), ...getMathNodeCategories()];
  }
}
