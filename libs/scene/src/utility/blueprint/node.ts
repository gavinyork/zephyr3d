import { IEventTarget } from '@zephyr3d/base';

export type GraphNodeInput = { id: number; name: string; type: string; value?: any };
export type GraphNodeOutput = { id: number; name: string; type: string; value?: any };

export interface IGraphNode extends IEventTarget<{ changed: [] }> {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  toString(): string;
}
