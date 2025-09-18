import type { NodeCategory } from '../api';
import { getConstantNodeCategories } from '../common/constants';
import { GraphEditor } from '../grapheditor';

export class PBRMaterialEditor extends GraphEditor {
  getNodeCategory(): NodeCategory[] {
    return getConstantNodeCategories();
  }
  isCompatiblePin(inType: string, outType: string): boolean {
    return inType === outType;
  }
}
