import { GenericConstructor } from '@zephyr3d/base';
import { BaseGraphNode } from './node';

export type NodeInfo = {
  name: string;
  ctor: GenericConstructor<BaseGraphNode>;
};

export type NodeCategoryList = (NodeCategory | NodeInfo)[];

export type NodeCategory =
  | NodeCategoryList
  | {
      name: string;
      children: NodeCategoryList;
    };

export interface GraphEditorApi {
  getNodeCategory(): NodeCategoryList;
  getCompatibleNodeTypes(srcType: string): string[];
}
