import { GenericConstructor } from '@zephyr3d/base';
import { BaseGraphNode } from './node';

export type NodeInfo = {
  name: string;
  ctor: GenericConstructor<BaseGraphNode>;
};

export type NodeCategory = {
  name: string;
  children: (NodeCategory | NodeInfo)[];
};

export interface GraphEditorApi {
  getNodeCategory(): NodeCategory;
  getCompatibleNodeTypes(srcType: string): string[];
}
