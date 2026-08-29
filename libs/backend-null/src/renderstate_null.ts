import type { Nullable } from '@zephyr3d/base';
import { DEPTH_COMPARE_DEFAULT } from '@zephyr3d/base';
import type {
  BlendEquation,
  BlendFunc,
  BlendingState,
  ColorState,
  CompareFunc,
  DepthState,
  FaceMode,
  RasterizerState,
  RenderStateSet,
  StencilOp,
  StencilState
} from '@zephyr3d/device';

/**
 * Color state of a null device
 * @public
 */
export class NullColorState implements ColorState {
  redMask: boolean;
  greenMask: boolean;
  blueMask: boolean;
  alphaMask: boolean;
  constructor() {
    this.redMask = this.greenMask = this.blueMask = this.alphaMask = true;
  }
  clone() {
    return new NullColorState().setColorMask(this.redMask, this.greenMask, this.blueMask, this.alphaMask);
  }
  setColorMask(r: boolean, g: boolean, b: boolean, a: boolean) {
    this.redMask = r;
    this.greenMask = g;
    this.blueMask = b;
    this.alphaMask = a;
    return this;
  }
}

/**
 * Blending state of a null device
 * @public
 */
export class NullBlendingState implements BlendingState {
  enabled: boolean;
  alphaToCoverageEnabled: boolean;
  srcBlendRGB: BlendFunc;
  dstBlendRGB: BlendFunc;
  srcBlendAlpha: BlendFunc;
  dstBlendAlpha: BlendFunc;
  rgbEquation: BlendEquation;
  alphaEquation: BlendEquation;
  constructor() {
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
    const other = new NullBlendingState();
    other.enable(this.enabled);
    other.enableAlphaToCoverage(this.alphaToCoverageEnabled);
    other.setBlendFuncRGB(this.srcBlendRGB, this.dstBlendRGB);
    other.setBlendFuncAlpha(this.srcBlendAlpha, this.dstBlendAlpha);
    other.setBlendEquation(this.rgbEquation, this.alphaEquation);
    return other;
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
}

/**
 * Rasterizer state of a null device
 * @public
 */
export class NullRasterizerState implements RasterizerState {
  cullMode: FaceMode;
  depthClampEnabled: boolean;
  constructor() {
    this.cullMode = 'back';
    this.depthClampEnabled = false;
  }
  clone() {
    const other = new NullRasterizerState().setCullMode(this.cullMode);
    other.depthClampEnabled = this.depthClampEnabled;
    return other;
  }
  setCullMode(mode: FaceMode) {
    this.cullMode = mode;
    return this;
  }
  enableDepthClamp(enable: boolean) {
    this.depthClampEnabled = !!enable;
    return this;
  }
}

/**
 * Depth state of a null device
 * @public
 */
export class NullDepthState implements DepthState {
  testEnabled: boolean;
  writeEnabled: boolean;
  compareFunc: CompareFunc;
  depthBias: number;
  depthBiasSlopeScale: number;
  constructor() {
    this.testEnabled = true;
    this.writeEnabled = true;
    this.compareFunc = DEPTH_COMPARE_DEFAULT;
    this.depthBias = 0;
    this.depthBiasSlopeScale = 0;
  }
  clone() {
    const other = new NullDepthState();
    other.enableTest(this.testEnabled);
    other.enableWrite(this.writeEnabled);
    other.setCompareFunc(this.compareFunc);
    other.setDepthBias(this.depthBias);
    other.setDepthBiasSlopeScale(this.depthBiasSlopeScale);
    return other;
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
}

/**
 * Stencil state of a null device
 * @public
 */
export class NullStencilState implements StencilState {
  enabled: boolean;
  failOp: StencilOp;
  failOpBack: StencilOp;
  zFailOp: StencilOp;
  zFailOpBack: StencilOp;
  passOp: StencilOp;
  passOpBack: StencilOp;
  func: CompareFunc;
  funcBack: CompareFunc;
  ref: number;
  writeMask: number;
  readMask: number;
  constructor() {
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
    const other = new NullStencilState();
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
  enable(b: boolean) {
    this.enabled = b;
    return this;
  }
  setFrontOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp) {
    this.failOp = fail;
    this.zFailOp = zfail;
    this.passOp = pass;
    return this;
  }
  setBackOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp) {
    this.failOpBack = fail;
    this.zFailOpBack = zfail;
    this.passOpBack = pass;
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
  setWriteMask(mask: number) {
    this.writeMask = mask;
    return this;
  }
  setReadMask(mask: number) {
    this.readMask = mask;
    return this;
  }
}

/**
 * Render state set of a null device
 *
 * @remarks
 * {@link NullRenderStateSet.apply} only counts the number of times it was
 * applied, which lets tests assert that a render state set reached the device.
 *
 * @public
 */
export class NullRenderStateSet implements RenderStateSet {
  colorState: Nullable<NullColorState>;
  blendingState: Nullable<NullBlendingState>;
  rasterizerState: Nullable<NullRasterizerState>;
  depthState: Nullable<NullDepthState>;
  stencilState: Nullable<NullStencilState>;
  /** @internal */
  private _targetColorStates: Nullable<NullColorState>[];
  /** @internal */
  private _targetBlendingStates: Nullable<NullBlendingState>[];
  /** @internal */
  private _applyCount: number;
  constructor() {
    this.colorState = null;
    this.blendingState = null;
    this.rasterizerState = null;
    this.depthState = null;
    this.stencilState = null;
    this._targetColorStates = [];
    this._targetBlendingStates = [];
    this._applyCount = 0;
  }
  /** How many times this state set was applied */
  get applyCount() {
    return this._applyCount;
  }
  clone() {
    const other = new NullRenderStateSet();
    other.colorState = this.colorState?.clone() ?? null;
    other.blendingState = this.blendingState?.clone() ?? null;
    other.rasterizerState = this.rasterizerState?.clone() ?? null;
    other.depthState = this.depthState?.clone() ?? null;
    other.stencilState = this.stencilState?.clone() ?? null;
    other._targetColorStates = this._targetColorStates.map((state) => state?.clone() ?? null);
    other._targetBlendingStates = this._targetBlendingStates.map((state) => state?.clone() ?? null);
    return other;
  }
  copyFrom(stateSet: RenderStateSet) {
    this.colorState = stateSet.colorState as NullColorState;
    this.blendingState = stateSet.blendingState as NullBlendingState;
    this.rasterizerState = stateSet.rasterizerState as NullRasterizerState;
    this.depthState = stateSet.depthState as NullDepthState;
    this.stencilState = stateSet.stencilState as NullStencilState;
    if (stateSet instanceof NullRenderStateSet) {
      this._targetColorStates = [...stateSet._targetColorStates];
      this._targetBlendingStates = [...stateSet._targetBlendingStates];
    } else {
      this._targetColorStates = [];
      this._targetBlendingStates = [];
    }
  }
  useColorState(state?: ColorState) {
    return (this.colorState = (state as NullColorState) ?? this.colorState ?? new NullColorState());
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
      (state as NullColorState) ?? this._targetColorStates[index] ?? new NullColorState());
  }
  defaultTargetColorState(index: number) {
    this.checkTargetIndex(index);
    this._targetColorStates[index] = null;
    this.trimTargetStates(this._targetColorStates);
  }
  useBlendingState(state?: BlendingState) {
    return (this.blendingState =
      (state as NullBlendingState) ?? this.blendingState ?? new NullBlendingState());
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
      (state as NullBlendingState) ?? this._targetBlendingStates[index] ?? new NullBlendingState());
  }
  defaultTargetBlendingState(index: number) {
    this.checkTargetIndex(index);
    this._targetBlendingStates[index] = null;
    this.trimTargetStates(this._targetBlendingStates);
  }
  useRasterizerState(state?: RasterizerState) {
    return (this.rasterizerState =
      (state as NullRasterizerState) ?? this.rasterizerState ?? new NullRasterizerState());
  }
  defaultRasterizerState() {
    this.rasterizerState = null;
  }
  useDepthState(state?: DepthState) {
    return (this.depthState = (state as NullDepthState) ?? this.depthState ?? new NullDepthState());
  }
  defaultDepthState() {
    this.depthState = null;
  }
  useStencilState(state?: StencilState) {
    return (this.stencilState = (state as NullStencilState) ?? this.stencilState ?? new NullStencilState());
  }
  defaultStencilState() {
    this.stencilState = null;
  }
  apply(_force?: boolean) {
    this._applyCount++;
  }
  /** @internal */
  private trimTargetStates(states: Nullable<unknown>[]) {
    while (states.length > 0 && !states[states.length - 1]) {
      states.length--;
    }
  }
  /** @internal */
  private checkTargetIndex(index: number) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`RenderStateSet target index must be a non-negative integer, got ${index}`);
    }
  }
}
