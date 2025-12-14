import type { PBGlobalScope, ProgramBuilder } from './programbuilder';
import type { PBShaderExp } from './base';
import type { VertexSemantic } from '../gpuobject';
import type { Nullable } from '@zephyr3d/base';

/**
 * Shader variable getter function type
 * @public
 */
export type PBReflectionTagGetter = (scope: PBGlobalScope) => PBShaderExp;

/**
 * Reflection interface for program builder
 * @public
 */
export class PBReflection {
  /** @internal */
  private readonly _builder: ProgramBuilder;
  /** @internal */
  private _tagList: Record<string, PBReflectionTagGetter>;
  /** @internal */
  private _attribList: Record<string, PBShaderExp>;
  constructor(builder: ProgramBuilder) {
    this._builder = builder;
    this._tagList = {};
    this._attribList = {};
  }
  /** Gets all the vertex attributes that was used by the program */
  get vertexAttributes(): number[] {
    return this._builder.getVertexAttributes();
  }
  /**
   * Check if specified vertex attribute was used by the program
   * @param attrib - The vertex attribute to check
   */
  hasVertexAttribute(attrib: number): boolean {
    return this.vertexAttributes.indexOf(attrib) >= 0;
  }
  /**
   * Clear all contents
   */
  clear(): void {
    this._tagList = {};
    this._attribList = {};
  }
  /**
   * Gets the variable that has tagged with given string
   * @param name - The tag string
   */
  tag(name: string): PBShaderExp;
  /**
   * Creates a new tag by specifying a function to get the tagged variable
   * @param name - The tag name
   * @param getter - The getter function
   */
  tag(name: string, getter: PBReflectionTagGetter): void;
  /**
   * Creates multiple tags from an object that contains the tag names and the getter functions
   * @param values - The object that contains the tag names and the getter functions
   */
  tag(values: Record<string, PBReflectionTagGetter>): void;
  tag(
    arg0: string | Record<string, PBReflectionTagGetter>,
    arg1?: PBReflectionTagGetter
  ): Nullable<PBShaderExp> | void {
    if (typeof arg0 === 'string') {
      if (arg1 === undefined) {
        return this.getTag(arg0);
      } else {
        this.addTag(arg0, arg1);
      }
    } else {
      for (const k of Object.keys(arg0)) {
        this.addTag(k, arg0[k]);
      }
    }
  }
  /**
   * Gets the variable which is the vertex attribute of specified semantic
   * @param attrib - The vertex semantic
   */
  attribute(attrib: VertexSemantic): PBShaderExp {
    return this._attribList[attrib] || null;
  }
  /** @internal */
  setAttrib(attrib: VertexSemantic, exp: PBShaderExp) {
    this._attribList[attrib] = exp;
  }
  /** @internal */
  private addTag(name: string, exp: PBReflectionTagGetter): void {
    this._tagList[name] = exp;
  }
  /** @internal */
  private getTag(name: string): Nullable<PBShaderExp> {
    const getter = this._tagList[name];
    return getter ? getter(this._builder.getGlobalScope()) : null;
  }
}
