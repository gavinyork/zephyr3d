import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from './nodes/constants';

export class PBRMaterialEditor extends GraphEditor {
  getNodeCategory(): NodeCategory[] {
    return getConstantNodeCategories();
  }
  isCompatiblePin(inType: string, outType: string): boolean {
    return inType === outType;
  }
}
