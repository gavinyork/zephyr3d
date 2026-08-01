import { DEPTH_COMPARE_DEFAULT } from '@zephyr3d/base';
import type {
  CompareFunc,
  ColorState,
  BlendingState,
  RasterizerState,
  DepthState,
  StencilState,
  RenderStateSet,
  BlendEquation,
  BlendFunc,
  FaceMode,
  StencilOp
} from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { Nullable } from '@zephyr3d/base';
import {
  blendEquationMap,
  blendFuncMap,
  compareFuncMap,
  faceModeMap,
  stencilOpMap
} from './constants_webgpu';

const stateList: InternalState[] = [];
const stateMap: Record<string, InternalState> = {};

export type InternalState<InternalGPUState = any> = {
  index: number;
  internal: InternalGPUState;
};

export abstract class WebGPURenderState<U> {
  protected static _defaultState: WebGPURenderState<any>;
  protected _internalState: Nullable<InternalState<U>>;
  static get defaultState() {
    return this._defaultState;
  }
  constructor() {
    this._internalState = null;
  }
  get hash(): string {
    return String(this.internalState.index);
  }
  get internalState(): InternalState<U> {
    if (!this._internalState) {
      const hash = `${this.constructor.name}:${this.computeHash()}`;
      this._internalState = stateMap[hash];
      if (!this._internalState) {
        this._internalState = {
          index: stateList.length,
          internal: this.createInternalState()
        };
        stateList.push(this._internalState);
        stateMap[hash] = this._internalState;
      }
    }
    return this._internalState;
  }
  invalidateHash() {
    this._internalState = null;
  }
  protected abstract createInternalState(): U;
  protected abstract computeHash(): string;
}

export class WebGPUColorState extends WebGPURenderState<number> implements ColorState {
  protected static _defaultState: WebGPUColorState = new WebGPUColorState();
  private _redMask: boolean;
  private _greenMask: boolean;
  private _blueMask: boolean;
  private _alphaMask: boolean;
  constructor() {
    super();
    this._redMask = this._greenMask = this._blueMask = this._alphaMask = true;
  }
  clone() {
    return new WebGPUColorState().setColorMask(
      this._redMask,
      this._greenMask,
      this._blueMask,
      this._alphaMask
    );
  }
  get redMask() {
    return this._redMask;
  }
  set redMask(val) {
    if (this._redMask !== !!val) {
      this._redMask = !!val;
      this.invalidateHash();
    }
  }
  get greenMask() {
    return this._greenMask;
  }
  set greenMask(val) {
    if (this._greenMask !== !!val) {
      this._greenMask = !!val;
      this.invalidateHash();
    }
  }
  get blueMask() {
    return this._blueMask;
  }
  set blueMask(val) {
    if (this._blueMask !== !!val) {
      this._blueMask = !!val;
      this.invalidateHash();
    }
  }
  get alphaMask() {
    return this._alphaMask;
  }
  set alphaMask(val) {
    if (this._alphaMask !== !!val) {
      this._alphaMask = !!val;
      this.invalidateHash();
    }
  }
  setColorMask(r: boolean, g: boolean, b: boolean, a: boolean) {
    this.redMask = r;
    this.greenMask = g;
    this.blueMask = b;
    this.alphaMask = a;
    return this;
  }
  protected createInternalState(): number {
    const r = this._redMask ? GPUColorWrite.RED : 0;
    const g = this._greenMask ? GPUColorWrite.GREEN : 0;
    const b = this._blueMask ? GPUColorWrite.BLUE : 0;
    const a = this._alphaMask ? GPUColorWrite.ALPHA : 0;
    return r | g | b | a;
  }
  protected computeHash() {
    let val = 0;
    if (this.redMask) {
      val += 1 << 0;
    }
    if (this.greenMask) {
      val += 1 << 1;
    }
    if (this.blueMask) {
      val += 1 << 2;
    }
    if (this.alphaMask) {
      val += 1 << 3;
    }
    return String(val);
  }
}

export class WebGPUBlendingState
  extends WebGPURenderState<GPUBlendState | undefined>
  implements BlendingState
{
  protected static _defaultState: WebGPUBlendingState = new WebGPUBlendingState();
  private _enabled: boolean;
  private _alphaToCoverageEnabled: boolean;
  private _srcBlendRGB: BlendFunc;
  private _dstBlendRGB: BlendFunc;
  private _srcBlendAlpha: BlendFunc;
  private _dstBlendAlpha: BlendFunc;
  private _rgbEquation: BlendEquation;
  private _alphaEquation: BlendEquation;
  constructor() {
    super();
    this._enabled = false;
    this._alphaToCoverageEnabled = false;
    this._srcBlendRGB = 'one';
    this._dstBlendRGB = 'zero';
    this._srcBlendAlpha = 'one';
    this._dstBlendAlpha = 'zero';
    this._rgbEquation = 'add';
    this._alphaEquation = 'add';
  }
  clone() {
    const other = new WebGPUBlendingState();
    other.enable(this._enabled);
    other.enableAlphaToCoverage(this._alphaToCoverageEnabled);
    other.setBlendFuncRGB(this._srcBlendRGB, this._dstBlendRGB);
    other.setBlendFuncAlpha(this._srcBlendAlpha, this._dstBlendAlpha);
    other.setBlendEquation(this._rgbEquation, this._alphaEquation);
    return other;
  }
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    if (this._enabled !== !!val) {
      this._enabled = !!val;
      this.invalidateHash();
    }
  }
  get alphaToCoverageEnabled() {
    return this._alphaToCoverageEnabled;
  }
  set alphaToCoverageEnabled(val) {
    if (this._alphaToCoverageEnabled !== !!val) {
      this._alphaToCoverageEnabled = !!val;
      this.invalidateHash();
    }
  }
  get srcBlendRGB() {
    return this._srcBlendRGB;
  }
  set srcBlendRGB(val) {
    if (this._srcBlendRGB !== val) {
      this._srcBlendRGB = val;
      this.invalidateHash();
    }
  }
  get srcBlendAlpha() {
    return this._srcBlendAlpha;
  }
  set srcBlendAlpha(val) {
    if (this._srcBlendAlpha !== val) {
      this._srcBlendAlpha = val;
      this.invalidateHash();
    }
  }
  get dstBlendRGB() {
    return this._dstBlendRGB;
  }
  set dstBlendRGB(val) {
    if (this._dstBlendRGB !== val) {
      this._dstBlendRGB = val;
      this.invalidateHash();
    }
  }
  get dstBlendAlpha() {
    return this._dstBlendAlpha;
  }
  set dstBlendAlpha(val) {
    if (this._dstBlendAlpha !== val) {
      this._dstBlendAlpha = val;
      this.invalidateHash();
    }
  }
  get rgbEquation() {
    return this._rgbEquation;
  }
  set rgbEquation(val) {
    if (this._rgbEquation !== val) {
      this._rgbEquation = val;
      this.invalidateHash();
    }
  }
  get alphaEquation() {
    return this._alphaEquation;
  }
  set alphaEquation(val) {
    if (this._alphaEquation !== val) {
      this._alphaEquation = val;
      this.invalidateHash();
    }
  }
  enable(b: boolean) {
    this.enabled = b;
    return this;
  }
  enableAlphaToCoverage(b: boolean) {
    this.alphaToCoverageEnabled = b;
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
  protected createInternalState(): GPUBlendState | undefined {
    if (!this._enabled) {
      return undefined;
    }
    return {
      color: this.createBlendComponent(this._rgbEquation, this._srcBlendRGB, this._dstBlendRGB),
      alpha: this.createBlendComponent(this._alphaEquation, this._srcBlendAlpha, this._dstBlendAlpha)
    };
  }
  protected computeHash() {
    return this._enabled
      ? `${this._srcBlendRGB}-${this._srcBlendAlpha}-${this._dstBlendRGB}-${this._dstBlendAlpha}-${
          this._rgbEquation
        }-${this._alphaEquation}-${Number(!!this._alphaToCoverageEnabled)}`
      : `${Number(!!this._alphaToCoverageEnabled)}`;
  }
  private createBlendComponent(op: BlendEquation, srcFunc: BlendFunc, dstFunc: BlendFunc) {
    const operation = blendEquationMap[op];
    if (!operation) {
      throw new Error(`createBlendComponent() failed: invalid blend op: ${op}`);
    }
    const srcFactor = blendFuncMap[srcFunc];
    if (!srcFactor) {
      throw new Error(`createBlendComponent() failed: invalid source blend func ${srcFunc}`);
    }
    const dstFactor = blendFuncMap[dstFunc];
    if (!dstFactor) {
      throw new Error(`createBlendComponent() failed: invalid dest blend func ${dstFunc}`);
    }
    return {
      operation,
      srcFactor,
      dstFactor
    };
  }
}

export class WebGPURasterizerState
  extends WebGPURenderState<{
    cullMode: GPUCullMode;
    unclippedDepth: boolean;
  }>
  implements RasterizerState
{
  protected static _defaultState: WebGPURasterizerState = new WebGPURasterizerState();
  private _cullMode: FaceMode;
  private _depthClampEnabled: boolean;
  constructor() {
    super();
    this._cullMode = 'back';
    this._depthClampEnabled = false;
  }
  clone() {
    return new WebGPURasterizerState().setCullMode(this._cullMode).enableDepthClamp(this._depthClampEnabled);
  }
  get cullMode() {
    return this._cullMode;
  }
  set cullMode(val) {
    if (this._cullMode !== val) {
      this._cullMode = val;
      this.invalidateHash();
    }
  }
  setCullMode(mode: FaceMode) {
    this.cullMode = mode;
    return this;
  }
  get depthClampEnabled() {
    return this._depthClampEnabled;
  }
  set depthClampEnabled(val) {
    this.enableDepthClamp(val);
  }
  enableDepthClamp(enable: boolean) {
    if (this._depthClampEnabled !== !!enable) {
      this._depthClampEnabled = !!enable;
      this.invalidateHash();
    }
    return this;
  }
  protected createInternalState(): {
    cullMode: GPUCullMode;
    unclippedDepth: boolean;
  } {
    return {
      cullMode: faceModeMap[this._cullMode],
      unclippedDepth: this._depthClampEnabled
    };
  }
  protected computeHash() {
    return `${this._cullMode}-${this._depthClampEnabled ? 1 : 0}`;
  }
}

export class WebGPUDepthState extends WebGPURenderState<Partial<GPUDepthStencilState>> implements DepthState {
  protected static _defaultState: WebGPUDepthState = new WebGPUDepthState();
  private _testEnabled: boolean;
  private _writeEnabled: boolean;
  private _compareFunc: CompareFunc;
  private _depthBias: number;
  private _depthBiasSlopeScale: number;
  constructor() {
    super();
    this._testEnabled = true;
    this._writeEnabled = true;
    this._compareFunc = DEPTH_COMPARE_DEFAULT;
    this._depthBias = 0;
    this._depthBiasSlopeScale = 0;
  }
  clone() {
    const other = new WebGPUDepthState();
    other.enableTest(this._testEnabled);
    other.enableWrite(this._writeEnabled);
    other.setCompareFunc(this._compareFunc);
    other.setDepthBias(this._depthBias);
    other.setDepthBiasSlopeScale(this._depthBiasSlopeScale);
    return other;
  }
  get testEnabled() {
    return this._testEnabled;
  }
  set testEnabled(val) {
    if (this._testEnabled !== !!val) {
      this._testEnabled = val;
      this.invalidateHash();
    }
  }
  get writeEnabled() {
    return this._writeEnabled;
  }
  set writeEnabled(val) {
    if (this._writeEnabled !== !!val) {
      this._writeEnabled = val;
      this.invalidateHash();
    }
  }
  get compareFunc() {
    return this._compareFunc;
  }
  set compareFunc(val) {
    if (this._compareFunc !== val) {
      this._compareFunc = val;
      this.invalidateHash();
    }
  }
  get depthBias() {
    return this._depthBias;
  }
  set depthBias(value) {
    this.setDepthBias(value);
  }
  setDepthBias(value: number) {
    if (this._depthBias !== value) {
      this._depthBias = value;
      this.invalidateHash();
    }
    return this;
  }
  get depthBiasSlopeScale() {
    return this._depthBiasSlopeScale;
  }
  set depthBiasSlopeScale(value) {
    this.setDepthBiasSlopeScale(value);
  }
  setDepthBiasSlopeScale(value: number) {
    if (this._depthBiasSlopeScale !== value) {
      this._depthBiasSlopeScale = value;
      this.invalidateHash();
    }
    return this;
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
  protected createInternalState(): Partial<GPUDepthStencilState> {
    return {
      depthWriteEnabled: this._writeEnabled,
      depthCompare: this._testEnabled ? compareFuncMap[this._compareFunc] : 'always',
      depthBias: this._depthBias !== 0 ? this._depthBias : undefined,
      depthBiasSlopeScale: this._depthBiasSlopeScale !== 0 ? this._depthBiasSlopeScale : undefined
    };
  }
  protected computeHash() {
    return `${Number(this._testEnabled)}-${Number(this._writeEnabled)}-${this._compareFunc}-${
      this._depthBias
    }-${this._depthBiasSlopeScale}`;
  }
}

export class WebGPUStencilState
  extends WebGPURenderState<Partial<GPUDepthStencilState>>
  implements StencilState
{
  protected static _defaultState: WebGPUStencilState = new WebGPUStencilState();
  private _enabled: boolean;
  private _writeMask: number;
  private _failOp: StencilOp;
  private _failOpBack!: StencilOp;
  private _zFailOp: StencilOp;
  private _zFailOpBack!: StencilOp;
  private _passOp: StencilOp;
  private _passOpBack!: StencilOp;
  private _func: CompareFunc;
  private _funcBack!: CompareFunc;
  private _ref: number;
  private _readMask: number;
  constructor() {
    super();
    this._enabled = false;
    this._failOp = this.failOpBack = 'keep';
    this._zFailOp = this.zFailOpBack = 'keep';
    this._passOp = this.passOpBack = 'keep';
    this._func = this.funcBack = 'always';
    this._ref = 0;
    this._writeMask = 0xffffffff;
    this._readMask = 0xffffffff;
  }
  clone() {
    const other = new WebGPUStencilState();
    other.enable(this._enabled);
    other.setWriteMask(this._writeMask);
    other.setFrontOp(this._failOp, this._zFailOp, this._passOp);
    other.setBackOp(this._failOpBack, this._zFailOpBack, this._passOpBack);
    other.setFrontCompareFunc(this._func);
    other.setBackCompareFunc(this._funcBack);
    other.setReference(this._ref);
    other.setReadMask(this._readMask);
    return other;
  }
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    if (this._enabled !== !!val) {
      this._enabled = !!val;
      this.invalidateHash();
    }
  }
  get writeMask() {
    return this._writeMask;
  }
  set writeMask(val) {
    if (this._writeMask !== val) {
      this._writeMask = val;
      this.invalidateHash();
    }
  }
  get failOp() {
    return this._failOp;
  }
  set failOp(val) {
    if (this._failOp !== val) {
      this._failOp = val;
      this.invalidateHash();
    }
  }
  get failOpBack() {
    return this._failOpBack;
  }
  set failOpBack(val) {
    if (this._failOpBack !== val) {
      this._failOpBack = val;
      this.invalidateHash();
    }
  }
  get zFailOp() {
    return this._zFailOp;
  }
  set zFailOp(val) {
    if (this._zFailOp !== val) {
      this._zFailOp = val;
      this.invalidateHash();
    }
  }
  get zFailOpBack() {
    return this._zFailOpBack;
  }
  set zFailOpBack(val) {
    if (this._zFailOpBack !== val) {
      this._zFailOpBack = val;
      this.invalidateHash();
    }
  }
  get passOp() {
    return this._passOp;
  }
  set passOp(val) {
    if (this._passOp !== val) {
      this._passOp = val;
      this.invalidateHash();
    }
  }
  get passOpBack() {
    return this._passOpBack;
  }
  set passOpBack(val) {
    if (this._passOpBack !== val) {
      this._passOpBack = val;
      this.invalidateHash();
    }
  }
  get func() {
    return this._func;
  }
  set func(val) {
    if (this._func !== val) {
      this._func = val;
      this.invalidateHash();
    }
  }
  get funcBack() {
    return this._funcBack;
  }
  set funcBack(val) {
    if (this._funcBack !== val) {
      this._funcBack = val;
      this.invalidateHash();
    }
  }
  get ref() {
    return this._ref;
  }
  set ref(val) {
    if (this._ref !== val) {
      this._ref = val;
      this.invalidateHash();
    }
  }
  get readMask() {
    return this._readMask;
  }
  set readMask(val) {
    if (this._readMask !== val) {
      this._readMask = val;
      this.invalidateHash();
    }
  }
  enable(b: boolean) {
    this.enabled = b;
    return this;
  }
  setWriteMask(mask: number) {
    this.writeMask = mask;
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
  setReadMask(mask: number) {
    this.readMask = mask;
    return this;
  }
  protected createInternalState(): Partial<GPUDepthStencilState> {
    return this._enabled
      ? {
          stencilFront: this.createStencilFaceState(this._func, this._failOp, this._zFailOp, this._passOp),
          stencilBack: this.createStencilFaceState(
            this._funcBack,
            this._failOpBack,
            this._zFailOpBack,
            this._passOpBack
          ),
          stencilReadMask: this._readMask,
          stencilWriteMask: this._writeMask
        }
      : {};
  }
  protected computeHash() {
    return this._enabled
      ? `${this.sideHash(false)}-${this.sideHash(true)}-${this.readMask.toString(
          16
        )}-${this.writeMask.toString(16)}-${this.ref.toString(16)}`
      : '';
  }
  private createStencilFaceState(
    func: CompareFunc,
    failOp: StencilOp,
    zFailOp: StencilOp,
    passOp: StencilOp
  ) {
    return {
      compare: compareFuncMap[func],
      failOp: stencilOpMap[failOp],
      depthFailOp: stencilOpMap[zFailOp],
      passOp: stencilOpMap[passOp]
    };
  }
  private sideHash(back: boolean): string {
    return back
      ? `${this._failOpBack}-${this._zFailOpBack}-${this._passOpBack}-${this._funcBack}`
      : `${this._failOp}-${this._zFailOp}-${this._passOp}-${this._func}`;
  }
}

export class WebGPURenderStateSet implements RenderStateSet {
  private readonly _device: WebGPUDevice;
  private _targetColorStates: Nullable<WebGPUColorState>[];
  private _targetBlendingStates: Nullable<WebGPUBlendingState>[];
  colorState: Nullable<WebGPUColorState>;
  blendingState: Nullable<WebGPUBlendingState>;
  rasterizerState: Nullable<WebGPURasterizerState>;
  depthState: Nullable<WebGPUDepthState>;
  stencilState: Nullable<WebGPUStencilState>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._targetColorStates = [];
    this._targetBlendingStates = [];
    this.colorState = null;
    this.blendingState = null;
    this.rasterizerState = null;
    this.depthState = null;
    this.stencilState = null;
  }
  clone() {
    const newStateSet = new WebGPURenderStateSet(this._device);
    newStateSet.colorState = (this.colorState?.clone() as WebGPUColorState) ?? null;
    newStateSet.blendingState = (this.blendingState?.clone() as WebGPUBlendingState) ?? null;
    newStateSet._targetColorStates = this._targetColorStates.map(
      (state) => (state?.clone() as WebGPUColorState) ?? null
    );
    newStateSet._targetBlendingStates = this._targetBlendingStates.map(
      (state) => (state?.clone() as WebGPUBlendingState) ?? null
    );
    newStateSet.rasterizerState = (this.rasterizerState?.clone() as WebGPURasterizerState) ?? null;
    newStateSet.depthState = (this.depthState?.clone() as WebGPUDepthState) ?? null;
    newStateSet.stencilState = (this.stencilState?.clone() as WebGPUStencilState) ?? null;
    return newStateSet;
  }
  copyFrom(stateSet: RenderStateSet) {
    this.colorState = stateSet.colorState as WebGPUColorState;
    this.blendingState = stateSet.blendingState as WebGPUBlendingState;
    if (stateSet instanceof WebGPURenderStateSet) {
      this._targetColorStates = [...stateSet._targetColorStates];
      this._targetBlendingStates = [...stateSet._targetBlendingStates];
    } else {
      this._targetColorStates = [];
      this._targetBlendingStates = [];
    }
    this.rasterizerState = stateSet.rasterizerState as WebGPURasterizerState;
    this.depthState = stateSet.depthState as WebGPUDepthState;
    this.stencilState = stateSet.stencilState as WebGPUStencilState;
  }
  get hash() {
    return `${this.colorState?.hash || ''}:${this.blendingState?.hash || ''}:${this.targetStateHash(
      this._targetColorStates
    )}:${this.targetStateHash(this._targetBlendingStates)}:${
      this.rasterizerState?.hash || ''
    }:${this.depthState?.hash || ''}:${this.stencilState?.hash || ''}`;
  }
  useColorState(state?: ColorState) {
    return (this.colorState = (state as WebGPUColorState) ?? this.colorState ?? new WebGPUColorState());
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
      (state as WebGPUColorState) ?? this._targetColorStates[index] ?? new WebGPUColorState());
  }
  defaultTargetColorState(index: number) {
    this.checkTargetIndex(index);
    this._targetColorStates[index] = null;
    this.trimTargetStates(this._targetColorStates);
  }
  useBlendingState(state?: BlendingState) {
    return (this.blendingState =
      (state as WebGPUBlendingState) ?? this.blendingState ?? new WebGPUBlendingState());
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
      (state as WebGPUBlendingState) ?? this._targetBlendingStates[index] ?? new WebGPUBlendingState());
  }
  defaultTargetBlendingState(index: number) {
    this.checkTargetIndex(index);
    this._targetBlendingStates[index] = null;
    this.trimTargetStates(this._targetBlendingStates);
  }
  getColorStateForTarget(index: number) {
    return (
      this._targetColorStates[index] ?? this.colorState ?? (WebGPUColorState.defaultState as WebGPUColorState)
    );
  }
  getBlendingStateForTarget(index: number) {
    return (
      this._targetBlendingStates[index] ??
      this.blendingState ??
      (WebGPUBlendingState.defaultState as WebGPUBlendingState)
    );
  }
  get alphaToCoverageEnabled() {
    return (
      !!this.blendingState?.alphaToCoverageEnabled ||
      this._targetBlendingStates.some((state) => !!state?.alphaToCoverageEnabled)
    );
  }
  useRasterizerState(state?: RasterizerState) {
    return (this.rasterizerState =
      (state as WebGPURasterizerState) ?? this.rasterizerState ?? new WebGPURasterizerState());
  }
  defaultRasterizerState() {
    this.rasterizerState = null;
  }
  useDepthState(state?: DepthState) {
    return (this.depthState = (state as WebGPUDepthState) ?? this.depthState ?? new WebGPUDepthState());
  }
  defaultDepthState() {
    this.depthState = null;
  }
  useStencilState(state?: StencilState) {
    return (this.stencilState =
      (state as WebGPUStencilState) ?? this.stencilState ?? new WebGPUStencilState());
  }
  defaultStencilState() {
    this.stencilState = null;
  }
  apply(_force?: boolean) {
    this._device.setRenderStates(this);
  }
  private targetStateHash(states: Nullable<{ hash: string }>[]) {
    return states
      .map((state, index) => (state ? `${index}:${state.hash}` : ''))
      .filter((value) => !!value)
      .join(',');
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
