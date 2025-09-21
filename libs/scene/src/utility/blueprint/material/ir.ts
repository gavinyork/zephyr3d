import type { PBScope, ProgramBuilder } from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';

abstract class IRExpression {
  protected ref: number;
  constructor() {
    this.ref = 0;
  }
  abstract create(pb: ProgramBuilder): number[] | number | PBShaderExp;
  addRef() {
    this.ref++;
  }
  getTmpName(scope: PBScope) {
    let tmp = 0;
    while (true) {
      const name = `tmp${tmp++}`;
      if (!scope[name]) {
        return name;
      }
    }
  }
}

class IRConstantExpressionf extends IRExpression {
  readonly value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
  create(): number {
    return this.value;
  }
}

class IRConstantExpressionfv extends IRExpression {
  readonly value: number[];
  constructor(value: number[]) {
    super();
    this.value = value;
  }
  create(): number[] {
    return this.value;
  }
}

class IRUniformf extends IRExpression {
  readonly value: number;
  readonly name: string;
  constructor(name: string, value: number) {
    super();
    this.name = name;
    this.value = value;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (!pb.getGlobalScope()[this.name]) {
      pb.getGlobalScope()[this.name] = pb.float().uniform(2);
    }
    return pb.getGlobalScope()[this.name];
  }
}

class IRUniformfv extends IRExpression {
  readonly value: number[];
  readonly name: string;
  constructor(name: string, value: number[]) {
    super();
    this.name = name;
    this.value = value;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (!pb.getGlobalScope()[this.name]) {
      pb.getGlobalScope()[this.name] = pb[`vec${this.value.length}`]().uniform(2);
    }
    return pb.getGlobalScope()[this.name];
  }
}

class IRUniformTex2D extends IRExpression {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (!pb.getGlobalScope()[this.name]) {
      pb.getGlobalScope()[this.name] = pb.tex2D().uniform(2);
    }
    return pb.getGlobalScope()[this.name];
  }
}

class IRHash extends IRExpression {
  readonly src: IRExpression;
  readonly hash: string;
  exp: PBShaderExp | number | number[];
  constructor(src: IRExpression, hash: string) {
    super();
    this.src = src;
    this.src.addRef();
    this.hash = hash;
    this.exp = null;
  }
  create(pb: ProgramBuilder): number[] | number | PBShaderExp {
    if (this.exp === null) {
      const src = this.src.create(pb);
      if (src instanceof PBShaderExp) {
        this.exp = src[this.hash];
      } else if (typeof src === 'number') {
        if (this.hash.length === 1) {
          this.exp = src;
        } else {
          this.exp = new Array(this.hash.length).fill(src);
        }
      } else {
        this.exp = [];
        for (const ch of this.hash) {
          const index = ch === 'x' ? 0 : ch === 'y' ? 1 : ch === 'z' ? 2 : ch === 'w' ? 3 : -1;
          if (index < 0) {
            throw new Error(`Invalid hash: ${this.hash}`);
          }
          if (index >= src.length) {
            this.exp.push(0);
          } else {
            this.exp.push(src[index]);
          }
        }
      }
    }
    return this.exp;
  }
}

export class BlueprintMaterialIR {
  private _id: number;
  private _expressions: IRExpression[];
  private _outputs: Record<string, number>;
  constructor() {
    this._id = 0;
    this._expressions = [];
    this._outputs = {};
  }
  constantf(value: number): number {
    this._expressions[this._id] = new IRConstantExpressionf(value);
    return this._id++;
  }
  constantfv(value: number[]): number {
    this._expressions[this._id] = new IRConstantExpressionfv(value);
    return this._id++;
  }
  uniformf(name: string, value: number): number {
    this._expressions[this._id] = new IRUniformf(name, value);
    return this._id++;
  }
  uniformfv(name: string, value: number[]) {
    this._expressions[this._id] = new IRUniformfv(name, value);
    return this._id++;
  }
  uniformTexture2D(name: string) {
    this._expressions[this._id] = new IRUniformTex2D(name);
    return this._id++;
  }
  hash(src: number, hash: string): number {
    this._expressions[this._id] = new IRHash(this._expressions[src], hash);
    return this._id++;
  }
  addOutput(src: number, name: string): void {
    this._outputs[name] = src;
  }
}
