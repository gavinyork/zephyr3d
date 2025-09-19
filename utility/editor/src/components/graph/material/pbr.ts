import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from './nodes/constants';
import { getMathNodeCategories } from './nodes/math';

export class PBRMaterialEditor extends GraphEditor {
  getNodeCategory(): NodeCategory[] {
    return [...getConstantNodeCategories(), ...getMathNodeCategories()];
  }
}
