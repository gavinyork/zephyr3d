import { DEPTH_COMPARE_DEFAULT } from '@zephyr3d/base';
import type {
  ColorState,
  BlendingState,
  RasterizerState,
  DepthState,
  StencilState,
  RenderStateSet,
  CompareFunc,
  WebGLContext,
  BlendEquation,
  BlendFunc,
  FaceMode,
  StencilOp
} from '@zephyr3d/device';
import {
  blendEquationMap,
  blendEquationInvMap,
  blendFuncMap,
  blendFuncInvMap,
  faceModeMap,
  faceModeInvMap,
  stencilOpMap,
  stencilOpInvMap,
  compareFuncMap,
  compareFuncInvMap
} from './constants_webgl';
import { WebGLEnum } from './webgl_enum';
import type { Nullable } from '@zephyr3d/base';

export interface DrawBuffersIndexedEXT {
  enablei(target: number, index: number): void;
  disablei(target: number, index: number): void;
  blendEquationSeparatei(index: number, modeRGB: number, modeAlpha: number): void;
  blendFuncSeparatei(index: number, srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void;
  colorMaski(index: number, r: boolean, g: boolean, b: boolean, a: boolean): void;
}

export abstract class WebGLRenderState {
  protected static _defaultState: WebGLRenderState;
  protected static _currentState: Nullable<WebGLRenderState>;
  apply(gl: WebGLContext, force?: boolean) {
    const c: any = this.constructor;
    if (force || c._currentState !== this) {
      this._apply(gl);
    }
    c._currentState = this;
  }
  static get defaultState() {
    return this._defaultState;
  }
  static applyDefaults(gl: WebGLContext, force?: boolean) {
    if (force || this._currentState !== this._defaultState) {
      this._defaultState.apply(gl, force);
    }
  }
  static invalidateCurrentState() {
    this._currentState = null;
  }
  protected abstract _apply(gl: WebGLContext): void;
}

export class WebGLColorState extends WebGLRenderState implements ColorState {
  protected static _defaultState: WebGLColorState = new WebGLColorState();
  protected static _currentState: Nullable<WebGLColorState> = null;
  redMask: boolean;
  greenMask: boolean;
  blueMask: boolean;
  alphaMask: boolean;
  constructor() {
    super();
    this.redMask = this.greenMask = this.blueMask = this.alphaMask = true;
  }
  clone() {
    return new WebGLColorState().setColorMask(this.redMask, this.greenMask, this.blueMask, this.alphaMask);
  }
  setColorMask(r: boolean, g: boolean, b: boolean, a: boolean) {
    this.redMask = r;
    this.greenMask = g;
    this.blueMask = b;
    this.alphaMask = a;
    return this;
  }
  protected _apply(gl: WebGLContext) {
    gl.colorMask(this.redMask, this.greenMask, this.blueMask, this.alphaMask);
  }
  applyTarget(ext: DrawBuffersIndexedEXT, targetIndex: number) {
    ext.colorMaski(targetIndex, this.redMask, this.greenMask, this.blueMask, this.alphaMask);
  }
}

export class WebGLBlendingState extends WebGLRenderState implements BlendingState {
  protected static _defaultState: WebGLBlendingState = new WebGLBlendingState();
  protected static _currentState: Nullable<WebGLBlendingState> = null;
  private _srcBlendRGB!: number;
  private _dstBlendRGB!: number;
  private _srcBlendAlpha!: number;
  private _dstBlendAlpha!: number;
  private _rgbEquation!: number;
  private _alphaEquation!: number;
  enabled: boolean;
  alphaToCoverageEnabled: boolean;
  constructor() {
    super();
    this.enabled = false;
    this.alphaToCoverageEnabled = false;
    this.srcBlendRGB = 'one';
    this.dstBlendRGB = 'zero';
    this.srcBlendAlpha = 'one';
    this.dstBlendAlpha = 'zero';
    this.rgbEquation = 'add';
    this.alphaEquation = 'add';
  }
  clone() {
    const other = new WebGLBlendingState();
    other.enable(this.enabled);
    other.enableAlphaToCoverage(this.alphaToCoverageEnabled);
    other.setBlendFuncRGB(this.srcBlendRGB, this.dstBlendRGB);
    other.setBlendFuncAlpha(this.srcBlendAlpha, this.dstBlendAlpha);
    other.setBlendEquation(this.rgbEquation, this.alphaEquation);
    return other;
  }
  get srcBlendRGB() {
    return blendFuncInvMap[this._srcBlendRGB];
  }
  set srcBlendRGB(val: BlendFunc) {
    this._srcBlendRGB = blendFuncMap[val];
  }
  get dstBlendRGB() {
    return blendFuncInvMap[this._dstBlendRGB];
  }
  set dstBlendRGB(val: BlendFunc) {
    this._dstBlendRGB = blendFuncMap[val];
  }
  get srcBlendAlpha() {
    return blendFuncInvMap[this._srcBlendAlpha];
  }
  set srcBlendAlpha(val: BlendFunc) {
    this._srcBlendAlpha = blendFuncMap[val];
  }
  get dstBlendAlpha() {
    return blendFuncInvMap[this._dstBlendAlpha];
  }
  set dstBlendAlpha(val: BlendFunc) {
    this._dstBlendAlpha = blendFuncMap[val];
  }
  get rgbEquation() {
    return blendEquationInvMap[this._rgbEquation];
  }
  set rgbEquation(val: BlendEquation) {
    this._rgbEquation = blendEquationMap[val];
  }
  get alphaEquation() {
    return blendEquationInvMap[this._alphaEquation];
  }
  set alphaEquation(val: BlendEquation) {
    this._alphaEquation = blendEquationMap[val];
  }
  enable(b: boolean) {
    this.enabled = !!b;
    return this;
  }
  enableAlphaToCoverage(b: boolean) {
    this.alphaToCoverageEnabled = !!b;
    return this;
  }
  setBlendFunc(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }
  setBlendFuncRGB(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    return this;
  }
  setBlendFuncAlpha(src: BlendFunc, dest: BlendFunc) {
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }
  setBlendEquation(rgb: BlendEquation, alpha: BlendEquation) {
    this.rgbEquation = rgb;
    this.alphaEquation = alpha;
    return this;
  }
  protected _apply(gl: WebGLContext) {
    if (this.enabled) {
      gl.enable(WebGLEnum.BLEND);
      gl.blendEquationSeparate(this._rgbEquation, this._alphaEquation);
      if (this._srcBlendRGB === this._srcBlendAlpha && this._dstBlendRGB === this._dstBlendAlpha) {
        gl.blendFunc(this._srcBlendRGB, this._dstBlendRGB);
      } else {
        gl.blendFuncSeparate(this._srcBlendRGB, this._dstBlendRGB, this._srcBlendAlpha, this._dstBlendAlpha);
      }
    } else {
      gl.disable(WebGLEnum.BLEND);
    }
    if (this.alphaToCoverageEnabled) {
      gl.enable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
    } else {
      gl.disable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
    }
  }
  applyTarget(ext: DrawBuffersIndexedEXT, targetIndex: number) {
    if (this.enabled) {
      ext.enablei(WebGLEnum.BLEND, targetIndex);
      ext.blendEquationSeparatei(targetIndex, this._rgbEquation, this._alphaEquation);
      ext.blendFuncSeparatei(
        targetIndex,
        this._srcBlendRGB,
        this._dstBlendRGB,
        this._srcBlendAlpha,
        this._dstBlendAlpha
      );
    } else {
      ext.disablei(WebGLEnum.BLEND, targetIndex);
    }
  }
  static applyAlphaToCoverage(gl: WebGLContext, enabled: boolean) {
    if (enabled) {
      gl.enable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
    } else {
      gl.disable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
    }
  }
}

export class WebGLRasterizerState extends WebGLRenderState implements RasterizerState {
  protected static _defaultState: WebGLRasterizerState = new WebGLRasterizerState();
  protected static _currentState: Nullable<WebGLRasterizerState> = null;
  private _cullMode!: number;
  constructor() {
    super();
    this.cullMode = 'back';
  }
  clone() {
    return new WebGLRasterizerState().setCullMode(this.cullMode);
  }
  get cullMode() {
    return faceModeInvMap[this._cullMode];
  }
  set cullMode(val: FaceMode) {
    this._cullMode = faceModeMap[val];
  }
  setCullMode(mode: FaceMode) {
    this.cullMode = mode;
    return this;
  }
  get depthClampEnabled() {
    return false;
  }
  set depthClampEnabled(val: boolean) {
    this.enableDepthClamp(val);
  }
  enableDepthClamp(enable: boolean) {
    if (enable) {
      console.error('Depth clamp not supported');
    }
    return this;
  }
  protected _apply(gl: WebGLContext) {
    if (this.cullMode == 'none') {
      gl.disable(WebGLEnum.CULL_FACE);
    } else {
      gl.enable(WebGLEnum.CULL_FACE);
      gl.cullFace(this._cullMode);
    }
  }
}

export class WebGLDepthState extends WebGLRenderState implements DepthState {
  protected static _defaultState: WebGLDepthState = new WebGLDepthState();
  protected static _currentState: Nullable<WebGLDepthState> = null;
  testEnabled: boolean;
  writeEnabled: boolean;
  depthBias: number;
  depthBiasSlopeScale: number;
  private _compareFunc!: number;
  constructor() {
    super();
    this.testEnabled = true;
    this.writeEnabled = true;
    this.compareFunc = DEPTH_COMPARE_DEFAULT;
    this.depthBias = 0;
    this.depthBiasSlopeScale = 0;
  }
  clone() {
    const other = new WebGLDepthState();
    other.enableTest(this.testEnabled);
    other.enableWrite(this.writeEnabled);
    other.setCompareFunc(this.compareFunc);
    other.setDepthBias(this.depthBias);
    other.setDepthBiasSlopeScale(this.depthBiasSlopeScale);
    return other;
  }
  get compareFunc() {
    return compareFuncInvMap[this._compareFunc]!;
  }
  set compareFunc(val: CompareFunc) {
    this._compareFunc = compareFuncMap[val];
  }
  enableTest(b: boolean) {
    this.testEnabled = b;
    return this;
  }
  enableWrite(b: boolean) {
    this.writeEnabled = b;
    return this;
  }
  setCompareFunc(func: CompareFunc) {
    this.compareFunc = func;
    return this;
  }
  setDepthBias(value: number) {
    this.depthBias = value;
    return this;
  }
  setDepthBiasSlopeScale(value: number) {
    this.depthBiasSlopeScale = value;
    return this;
  }
  protected _apply(gl: WebGLContext) {
    if (this.testEnabled) {
      gl.enable(WebGLEnum.DEPTH_TEST);
      gl.depthFunc(this._compareFunc);
    } else {
      gl.disable(WebGLEnum.DEPTH_TEST);
    }
    gl.depthMask(this.writeEnabled);
    if (this.depthBias !== 0 || this.depthBiasSlopeScale !== 0) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(this.depthBiasSlopeScale, this.depthBias);
    } else {
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }
}

export class WebGLStencilState extends WebGLRenderState implements StencilState {
  protected static _defaultState: WebGLStencilState = new WebGLStencilState();
  protected static _currentState: Nullable<WebGLStencilState> = null;
  enabled: boolean;
  writeMask: number;
  ref: number;
  readMask: number;
  private _failOp!: number;
  private _failOpBack!: number;
  private _zFailOp!: number;
  private _zFailOpBack!: number;
  private _passOp!: number;
  private _passOpBack!: number;
  private _func!: number;
  private _funcBack!: number;
  constructor() {
    super();
    this.enabled = false;
    this.failOp = this.failOpBack = 'keep';
    this.zFailOp = this.zFailOpBack = 'keep';
    this.passOp = this.passOpBack = 'keep';
    this.func = this.funcBack = 'always';
    this.ref = 0;
    this.writeMask = 0xffffffff;
    this.readMask = 0xffffffff;
  }
  clone() {
    const other = new WebGLStencilState();
    other.enable(this.enabled);
    other.setWriteMask(this.writeMask);
    other.setFrontOp(this.failOp, this.zFailOp, this.passOp);
    other.setBackOp(this.failOpBack, this.zFailOpBack, this.passOpBack);
    other.setFrontCompareFunc(this.func);
    other.setBackCompareFunc(this.funcBack);
    other.setReference(this.ref);
    other.setReadMask(this.readMask);
    return other;
  }
  get failOp() {
    return stencilOpInvMap[this._failOp];
  }
  set failOp(val: StencilOp) {
    this._failOp = stencilOpMap[val];
  }
  get failOpBack() {
    return stencilOpInvMap[this._failOpBack];
  }
  set failOpBack(val: StencilOp) {
    this._failOpBack = stencilOpMap[val];
  }
  get zFailOp() {
    return stencilOpInvMap[this._zFailOp];
  }
  set zFailOp(val: StencilOp) {
    this._zFailOp = stencilOpMap[val];
  }
  get zFailOpBack() {
    return stencilOpInvMap[this._zFailOpBack];
  }
  set zFailOpBack(val: StencilOp) {
    this._zFailOpBack = stencilOpMap[val];
  }
  get passOp() {
    return stencilOpInvMap[this._passOp];
  }
  set passOp(val: StencilOp) {
    this._passOp = stencilOpMap[val];
  }
  get passOpBack() {
    return stencilOpInvMap[this._passOpBack];
  }
  set passOpBack(val: StencilOp) {
    this._passOpBack = stencilOpMap[val];
  }
  get func() {
    return compareFuncInvMap[this._func]!;
  }
  set func(val: CompareFunc) {
    this._func = compareFuncMap[val];
  }
  get funcBack() {
    return compareFuncInvMap[this._funcBack]!;
  }
  set funcBack(val: CompareFunc) {
    this._funcBack = compareFuncMap[val];
  }
  enable(b: boolean) {
    this.enabled = b;
    return this;
  }
  setWriteMask(mask: number) {
    this.writeMask = mask;
    return this;
  }
  setFrontOp(fail: StencilOp, zfail: StencilOp, zpass: StencilOp) {
    this.failOp = fail;
    this.zFailOp = zfail;
    this.passOp = zpass;
    return this;
  }
  setBackOp(fail: StencilOp, zfail: StencilOp, zpass: StencilOp) {
    this.failOpBack = fail;
    this.zFailOpBack = zfail;
    this.passOpBack = zpass;
    return this;
  }
  setFrontCompareFunc(func: CompareFunc) {
    this.func = func;
    return this;
  }
  setBackCompareFunc(func: CompareFunc) {
    this.funcBack = func;
    return this;
  }
  setReference(ref: number) {
    this.ref = ref;
    return this;
  }
  setReadMask(mask: number) {
    this.readMask = mask;
    return this;
  }
  protected _apply(gl: WebGLContext) {
    if (this.enabled) {
      gl.enable(WebGLEnum.STENCIL_TEST);
      gl.stencilMaskSeparate(WebGLEnum.FRONT, this.writeMask);
      gl.stencilMaskSeparate(WebGLEnum.BACK, this.writeMask);
      gl.stencilFuncSeparate(WebGLEnum.FRONT, this._func, this.ref, this.readMask);
      gl.stencilFuncSeparate(WebGLEnum.BACK, this._funcBack, this.ref, this.readMask);
      gl.stencilOpSeparate(WebGLEnum.FRONT, this._failOp, this._zFailOp, this._passOp);
      gl.stencilOpSeparate(WebGLEnum.BACK, this._failOpBack, this._zFailOpBack, this._passOpBack);
    } else {
      gl.disable(WebGLEnum.STENCIL_TEST);
    }
  }
}

export class WebGLRenderStateSet implements RenderStateSet {
  private readonly _gl: WebGLContext;
  private _targetColorStates: Nullable<WebGLColorState>[];
  private _targetBlendingStates: Nullable<WebGLBlendingState>[];
  colorState: Nullable<WebGLColorState>;
  blendingState: Nullable<WebGLBlendingState>;
  rasterizerState: Nullable<WebGLRasterizerState>;
  depthState: Nullable<WebGLDepthState>;
  stencilState: Nullable<WebGLStencilState>;
  constructor(gl: WebGLContext) {
    this._gl = gl;
    this._targetColorStates = [];
    this._targetBlendingStates = [];
    this.colorState = null;
    this.blendingState = null;
    this.rasterizerState = null;
    this.depthState = null;
    this.stencilState = null;
  }
  clone() {
    const newStateSet = new WebGLRenderStateSet(this._gl);
    newStateSet.colorState = (this.colorState?.clone() as WebGLColorState) ?? null;
    newStateSet.blendingState = (this.blendingState?.clone() as WebGLBlendingState) ?? null;
    newStateSet._targetColorStates = this._targetColorStates.map(
      (state) => (state?.clone() as WebGLColorState) ?? null
    );
    newStateSet._targetBlendingStates = this._targetBlendingStates.map(
      (state) => (state?.clone() as WebGLBlendingState) ?? null
    );
    newStateSet.rasterizerState = (this.rasterizerState?.clone() as WebGLRasterizerState) ?? null;
    newStateSet.depthState = (this.depthState?.clone() as WebGLDepthState) ?? null;
    newStateSet.stencilState = (this.stencilState?.clone() as WebGLStencilState) ?? null;
    return newStateSet;
  }
  copyFrom(stateSet: RenderStateSet) {
    this.colorState = stateSet.colorState as WebGLColorState;
    this.blendingState = stateSet.blendingState as WebGLBlendingState;
    if (stateSet instanceof WebGLRenderStateSet) {
      this._targetColorStates = [...stateSet._targetColorStates];
      this._targetBlendingStates = [...stateSet._targetBlendingStates];
    } else {
      this._targetColorStates = [];
      this._targetBlendingStates = [];
    }
    this.rasterizerState = stateSet.rasterizerState as WebGLRasterizerState;
    this.depthState = stateSet.depthState as WebGLDepthState;
    this.stencilState = stateSet.stencilState as WebGLStencilState;
  }
  apply(force?: boolean) {
    const gl = this._gl;
    this.applyColorStates(gl, force);
    this.applyBlendingStates(gl, force);
    if (this.rasterizerState) {
      this.rasterizerState.apply(gl, force);
    } else {
      WebGLRasterizerState.applyDefaults(gl, force);
    }
    if (this.depthState) {
      this.depthState.apply(gl, force);
    } else {
      WebGLDepthState.applyDefaults(gl, force);
    }
    if (this.stencilState) {
      this.stencilState.apply(gl, force);
    } else {
      WebGLStencilState.applyDefaults(gl, force);
    }
  }
  useColorState(state?: ColorState) {
    return (this.colorState = (state as WebGLColorState) ?? this.colorState ?? new WebGLColorState());
  }
  defaultColorState() {
    this.colorState = null;
  }
  getTargetColorState(index: number) {
    this.checkTargetIndex(index);
    return this._targetColorStates[index] ?? null;
  }
  useTargetColorState(index: number, state?: ColorState) {
    this.checkTargetIndex(index);
    return (this._targetColorStates[index] =
      (state as WebGLColorState) ?? this._targetColorStates[index] ?? new WebGLColorState());
  }
  defaultTargetColorState(index: number) {
    this.checkTargetIndex(index);
    this._targetColorStates[index] = null;
    this.trimTargetStates(this._targetColorStates);
  }
  useBlendingState(state?: BlendingState) {
    return (this.blendingState =
      (state as WebGLBlendingState) ?? this.blendingState ?? new WebGLBlendingState());
  }
  defaultBlendingState() {
    this.blendingState = null;
  }
  getTargetBlendingState(index: number) {
    this.checkTargetIndex(index);
    return this._targetBlendingStates[index] ?? null;
  }
  useTargetBlendingState(index: number, state?: BlendingState) {
    this.checkTargetIndex(index);
    return (this._targetBlendingStates[index] =
      (state as WebGLBlendingState) ?? this._targetBlendingStates[index] ?? new WebGLBlendingState());
  }
  defaultTargetBlendingState(index: number) {
    this.checkTargetIndex(index);
    this._targetBlendingStates[index] = null;
    this.trimTargetStates(this._targetBlendingStates);
  }
  useRasterizerState(state?: RasterizerState) {
    return (this.rasterizerState =
      (state as WebGLRasterizerState) ?? this.rasterizerState ?? new WebGLRasterizerState());
  }
  defaultRasterizerState() {
    this.rasterizerState = null;
  }
  useDepthState(state?: DepthState) {
    return (this.depthState = (state as WebGLDepthState) ?? this.depthState ?? new WebGLDepthState());
  }
  defaultDepthState() {
    this.depthState = null;
  }
  useStencilState(state?: StencilState) {
    return (this.stencilState = (state as WebGLStencilState) ?? this.stencilState ?? new WebGLStencilState());
  }
  defaultStencilState() {
    this.stencilState = null;
  }
  static applyDefaults(gl: WebGLContext, force?: boolean) {
    const targetCount = gl._currentFramebuffer?.getColorAttachments().length || 1;
    const ext = (gl as WebGLContext & { _drawBuffersIndexedExt?: Nullable<DrawBuffersIndexedEXT> })
      ._drawBuffersIndexedExt;
    if (ext && targetCount > 1) {
      const colorState = WebGLColorState.defaultState as WebGLColorState;
      const blendingState = WebGLBlendingState.defaultState as WebGLBlendingState;
      for (let i = 0; i < targetCount; i++) {
        colorState.applyTarget(ext, i);
        blendingState.applyTarget(ext, i);
      }
      WebGLColorState.invalidateCurrentState();
      WebGLBlendingState.invalidateCurrentState();
      WebGLBlendingState.applyAlphaToCoverage(gl, false);
    } else {
      WebGLColorState.applyDefaults(gl, force);
      WebGLBlendingState.applyDefaults(gl, force);
    }
    WebGLRasterizerState.applyDefaults(gl, force);
    WebGLDepthState.applyDefaults(gl, force);
    WebGLStencilState.applyDefaults(gl, force);
  }
  private applyColorStates(gl: WebGLContext, force?: boolean) {
    const targetCount = this.getColorTargetCount(gl);
    const ext = (gl as WebGLContext & { _drawBuffersIndexedExt?: Nullable<DrawBuffersIndexedEXT> })
      ._drawBuffersIndexedExt;
    const hasTargetStates = this.hasTargetStates(this._targetColorStates);
    if (!hasTargetStates && targetCount === 1) {
      if (this.colorState) {
        this.colorState.apply(gl, force);
      } else {
        WebGLColorState.applyDefaults(gl, force);
      }
      return;
    }
    const firstState = this.getColorStateForTarget(0);
    if (!ext) {
      if (!this.canUseSingleColorState(firstState, targetCount)) {
        this.reportMissingPerTargetBlending('color mask');
      }
      firstState.apply(gl, force);
      return;
    }
    for (let i = 0; i < targetCount; i++) {
      this.getColorStateForTarget(i).applyTarget(ext, i);
    }
    WebGLColorState.invalidateCurrentState();
  }
  private applyBlendingStates(gl: WebGLContext, force?: boolean) {
    const targetCount = this.getColorTargetCount(gl);
    const ext = (gl as WebGLContext & { _drawBuffersIndexedExt?: Nullable<DrawBuffersIndexedEXT> })
      ._drawBuffersIndexedExt;
    const hasTargetStates = this.hasTargetStates(this._targetBlendingStates);
    if (!hasTargetStates && targetCount === 1) {
      if (this.blendingState) {
        this.blendingState.apply(gl, force);
      } else {
        WebGLBlendingState.applyDefaults(gl, force);
      }
      return;
    }
    const firstState = this.getBlendingStateForTarget(0);
    if (!ext) {
      if (!this.canUseSingleBlendingState(firstState, targetCount)) {
        this.reportMissingPerTargetBlending('blending');
      }
      firstState.apply(gl, force);
      return;
    }
    for (let i = 0; i < targetCount; i++) {
      this.getBlendingStateForTarget(i).applyTarget(ext, i);
    }
    WebGLBlendingState.invalidateCurrentState();
    WebGLBlendingState.applyAlphaToCoverage(gl, this.alphaToCoverageEnabled);
  }
  private getColorStateForTarget(index: number) {
    return (
      this._targetColorStates[index] ?? this.colorState ?? (WebGLColorState.defaultState as WebGLColorState)
    );
  }
  private getBlendingStateForTarget(index: number) {
    return (
      this._targetBlendingStates[index] ??
      this.blendingState ??
      (WebGLBlendingState.defaultState as WebGLBlendingState)
    );
  }
  private get alphaToCoverageEnabled() {
    return (
      !!this.blendingState?.alphaToCoverageEnabled ||
      this._targetBlendingStates.some((state) => !!state?.alphaToCoverageEnabled)
    );
  }
  private getColorTargetCount(gl: WebGLContext) {
    return gl._currentFramebuffer?.getColorAttachments().length || 1;
  }
  private hasTargetStates<T>(states: Nullable<T>[]) {
    return states.some((state) => !!state);
  }
  private canUseSingleColorState(firstState: WebGLColorState, targetCount: number) {
    for (let i = 1; i < targetCount; i++) {
      if (!this.sameColorState(firstState, this.getColorStateForTarget(i))) {
        return false;
      }
    }
    return true;
  }
  private canUseSingleBlendingState(firstState: WebGLBlendingState, targetCount: number) {
    for (let i = 1; i < targetCount; i++) {
      if (!this.sameBlendingState(firstState, this.getBlendingStateForTarget(i))) {
        return false;
      }
    }
    return true;
  }
  private sameColorState(a: WebGLColorState, b: WebGLColorState) {
    return (
      a.redMask === b.redMask &&
      a.greenMask === b.greenMask &&
      a.blueMask === b.blueMask &&
      a.alphaMask === b.alphaMask
    );
  }
  private sameBlendingState(a: WebGLBlendingState, b: WebGLBlendingState) {
    return (
      a.enabled === b.enabled &&
      a.srcBlendRGB === b.srcBlendRGB &&
      a.dstBlendRGB === b.dstBlendRGB &&
      a.srcBlendAlpha === b.srcBlendAlpha &&
      a.dstBlendAlpha === b.dstBlendAlpha &&
      a.rgbEquation === b.rgbEquation &&
      a.alphaEquation === b.alphaEquation
    );
  }
  private reportMissingPerTargetBlending(stateName: string) {
    console.error(`RenderStateSet.apply() failed: per-target ${stateName} requires OES_draw_buffers_indexed`);
  }
  private trimTargetStates(states: Nullable<unknown>[]) {
    while (states.length > 0 && !states[states.length - 1]) {
      states.length--;
    }
  }
  private checkTargetIndex(index: number) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`RenderStateSet target index must be a non-negative integer, got ${index}`);
    }
  }
}
