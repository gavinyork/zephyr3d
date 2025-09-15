import type { GraphEditorApi, NodeCategory } from '../api';

export class PBRMaterialEditor implements GraphEditorApi {
  getNodeCategory(): NodeCategory {
    return null;
  }
  getCompatibleNodeTypes(_srcType: string): string[] {
    return [];
  }
}
