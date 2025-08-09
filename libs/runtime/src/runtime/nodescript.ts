import type { SceneNode } from '@zephyr3d/scene';
import type { ParamSchema } from './types';

export interface NodeScriptContext {
  node: SceneNode;
}

export abstract class NodeScript {
  readonly node: NodeScriptContext['node'];

  // Static metadata (read by editor)
  static displayName?: string;
  static classId?: string;
  static params?: Record<string, ParamSchema>;
  static batchable?: boolean;
  static batchStep?(instances: NodeScript[], dt: number): void;

  constructor(ctx: NodeScriptContext) {
    this.node = ctx.node;
  }

  // Lifecycle hooks (all optional)
  onInit?(): void;
  onStart?(): void;
  onUpdate?(dt: number): void;
  onLateUpdate?(dt: number): void;
  onEvent?(evt: { type: string; payload?: any; scope?: string }): void;
  onDestroy?(): void;
}
