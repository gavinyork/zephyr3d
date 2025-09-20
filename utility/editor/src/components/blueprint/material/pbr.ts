import type { IGraphNode } from '@zephyr3d/scene';
import { PBRBlockNode } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
//import { BaseGraphNode } from '../node';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { GNode } from '../node';
import type { BlueprintDAG } from '../dag';

export class PBRMaterialEditor extends GraphEditor {
  private _outputNodeId: number;
  constructor() {
    super();
    const block = this.nodeEditor.addNode(new GNode(this.nodeEditor, null, new PBRBlockNode()));
    block.locked = true;
    this._outputNodeId = block.id;
    this.nodeEditor.on('changed', this.graphChanged, this);
  }
  getNodeCategory(): NodeCategory[] {
    return [...getConstantNodeCategories(), ...getTextureNodeCategories(), ...getMathNodeCategories()];
  }

  createDAG(): BlueprintDAG {
    const nodeMap: Record<number, IGraphNode> = {};
    for (const [k, v] of this.nodeEditor.nodes) {
      nodeMap[k] = v.impl;
    }
    return {
      graph: this.nodeEditor.graph,
      nodeMap,
      roots: [this._outputNodeId],
      order: this.nodeEditor.getReverseTopologicalOrderFromRoots([this._outputNodeId]).order
    };
  }
  private graphChanged() {
    const dag = this.createDAG();
    console.log(dag.order);
  }
}
