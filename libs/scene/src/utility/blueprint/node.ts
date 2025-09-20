import { Observable, type IEventTarget } from '@zephyr3d/base';

export type GraphNodeInput = { id: number; name: string; type: string[] | string; value?: any };
export type GraphNodeOutput = { id: number; name: string; type: string; value?: any };

export interface IGraphNode extends IEventTarget<{ changed: [] }> {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  props: Record<string, unknown>;
  toString(): string;
}

export class BaseGraphNode extends Observable<{ changed: [] }> implements IGraphNode {
  protected _inputs: GraphNodeInput[];
  protected _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._inputs = [];
    this._outputs = [];
  }
  get props() {
    return this.getProps();
  }
  set props(props: Record<string, unknown>) {
    this.setProps(props);
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  toString() {
    return '';
  }
  protected getProps(): Record<string, unknown> {
    return null;
  }
  protected setProps(_props: Record<string, unknown>) {}
}
