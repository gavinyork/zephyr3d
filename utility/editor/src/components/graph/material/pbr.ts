import { PBRBlockNode } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
//import { BaseGraphNode } from '../node';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { GNode } from '../node';

export class PBRMaterialEditor extends GraphEditor {
  constructor() {
    super();
    const block = this.nodeEditor.addNode(new GNode(this.nodeEditor, null, new PBRBlockNode()));
    block.locked = true;
  }
  getNodeCategory(): NodeCategory[] {
    return [...getConstantNodeCategories(), ...getTextureNodeCategories(), ...getMathNodeCategories()];
  }
}
