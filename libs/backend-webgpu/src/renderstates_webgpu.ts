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

export abstract class WebGPURenderState {
  protected static _defaultState: WebGPURenderState;
  protected _hash: string;
  static get defaultState() {
    return this._defaultState;
  }
  constructor() {
    this._hash = null;
  }
  get hash(): string {
    return this._getHash(this.constructor);
  }
  invalidateHash() {
    this._hash = null;
  }
  protected _getHash(ctor: any) {
    if (this === ctor.defaultState) {
      return '';
    } else {
      if (this._hash === null) {
        this._hash = this.computeHash();
      }
      return this._hash;
    }
  }
  protected abstract computeHash(): string;
}

export class WebGPUColorState extends WebGPURenderState implements ColorState {
  protected static _defaultState: WebGPURenderState = new WebGPUColorState();
  private _redMask: boolean;
  private _greenMask: boolean;
  private _blueMask: boolean;
  private _alphaMask: boolean;
  constructor() {
    super();
    this._redMask = this._greenMask = this._blueMask = this._alphaMask = true;
  }
  clone(): ColorState {
    return new WebGPUColorState().setColorMask(
      this._redMask,
      this._greenMask,
      this._blueMask,
      this._alphaMask
    );
  }
  get redMask(): boolean {
    return this._redMask;
  }
  set redMask(val: boolean) {
    if (this._redMask !== !!val) {
      this._redMask = !!val;
      this.invalidateHash();
    }
  }
  get greenMask(): boolean {
    return this._greenMask;
  }
  set greenMask(val: boolean) {
    if (this._greenMask !== !!val) {
      this._greenMask = !!val;
      this.invalidateHash();
    }
  }
  get blueMask(): boolean {
    return this._blueMask;
  }
  set blueMask(val: boolean) {
    if (this._blueMask !== !!val) {
      this._blueMask = !!val;
      this.invalidateHash();
    }
  }
  get alphaMask(): boolean {
    return this._alphaMask;
  }
  set alphaMask(val: boolean) {
    if (this._alphaMask !== !!val) {
      this._alphaMask = !!val;
      this.invalidateHash();
    }
  }
  setColorMask(r: boolean, g: boolean, b: boolean, a: boolean): this {
    this.redMask = r;
    this.greenMask = g;
    this.blueMask = b;
    this.alphaMask = a;
    return this;
  }
  protected computeHash(): string {
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

export class WebGPUBlendingState extends WebGPURenderState implements BlendingState {
  protected static _defaultState: WebGPURenderState = new WebGPUBlendingState();
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
  clone(): BlendingState {
    const other = new WebGPUBlendingState();
    other.enable(this._enabled);
    other.enableAlphaToCoverage(this._alphaToCoverageEnabled);
    other.setBlendFuncRGB(this._srcBlendRGB, this._dstBlendRGB);
    other.setBlendFuncAlpha(this._srcBlendAlpha, this._dstBlendAlpha);
    other.setBlendEquation(this._rgbEquation, this._alphaEquation);
    return other;
  }
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(val: boolean) {
    if (this._enabled !== !!val) {
      this._enabled = !!val;
      this.invalidateHash();
    }
  }
  get alphaToCoverageEnabled() {
    return this._alphaToCoverageEnabled;
  }
  set alphaToCoverageEnabled(val: boolean) {
    if (this._alphaToCoverageEnabled !== !!val) {
      this._alphaToCoverageEnabled = !!val;
      this.invalidateHash();
    }
  }
  get srcBlendRGB(): BlendFunc {
    return this._srcBlendRGB;
  }
  set srcBlendRGB(val: BlendFunc) {
    if (this._srcBlendRGB !== val) {
      this._srcBlendRGB = val;
      this.invalidateHash();
    }
  }
  get srcBlendAlpha(): BlendFunc {
    return this._srcBlendAlpha;
  }
  set srcBlendAlpha(val: BlendFunc) {
    if (this._srcBlendAlpha !== val) {
      this._srcBlendAlpha = val;
      this.invalidateHash();
    }
  }
  get dstBlendRGB(): BlendFunc {
    return this._dstBlendRGB;
  }
  set dstBlendRGB(val: BlendFunc) {
    if (this._dstBlendRGB !== val) {
      this._dstBlendRGB = val;
      this.invalidateHash();
    }
  }
  get dstBlendAlpha(): BlendFunc {
    return this._dstBlendAlpha;
  }
  set dstBlendAlpha(val: BlendFunc) {
    if (this._dstBlendAlpha !== val) {
      this._dstBlendAlpha = val;
      this.invalidateHash();
    }
  }
  get rgbEquation(): BlendEquation {
    return this._rgbEquation;
  }
  set rgbEquation(val: BlendEquation) {
    if (this._rgbEquation !== val) {
      this._rgbEquation = val;
      this.invalidateHash();
    }
  }
  get alphaEquation(): BlendEquation {
    return this._alphaEquation;
  }
  set alphaEquation(val: BlendEquation) {
    if (this._alphaEquation !== val) {
      this._alphaEquation = val;
      this.invalidateHash();
    }
  }
  enable(b: boolean): this {
    this.enabled = b;
    return this;
  }
  enableAlphaToCoverage(b: boolean): this {
    this.alphaToCoverageEnabled = b;
    return this;
  }
  setBlendFunc(src: BlendFunc, dest: BlendFunc): this {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }
  setBlendFuncRGB(src: BlendFunc, dest: BlendFunc): this {
    this.srcBlendRGB = src;
    this.dstBlendRGB = dest;
    return this;
  }
  setBlendFuncAlpha(src: BlendFunc, dest: BlendFunc): this {
    this.srcBlendAlpha = src;
    this.dstBlendAlpha = dest;
    return this;
  }
  setBlendEquation(rgb: BlendEquation, alpha: BlendEquation): this {
    this.rgbEquation = rgb;
    this.alphaEquation = alpha;
    return this;
  }
  protected computeHash(): string {
    return this._enabled
      ? `${this._srcBlendRGB}-${this._srcBlendAlpha}-${this._dstBlendRGB}-${this._dstBlendAlpha}-${
          this._rgbEquation
        }-${this._alphaEquation}-${Number(!!this._alphaToCoverageEnabled)}`
      : `${Number(!!this._alphaToCoverageEnabled)}`;
  }
}

export class WebGPURasterizerState extends WebGPURenderState implements RasterizerState {
  protected static _defaultState: WebGPURenderState = new WebGPURasterizerState();
  private _cullMode: FaceMode;
  private _depthClampEnabled: boolean;
  constructor() {
    super();
    this._cullMode = 'back';
    this._depthClampEnabled = false;
  }
  clone(): RasterizerState {
    return new WebGPURasterizerState().setCullMode(this._cullMode).enableDepthClamp(this._depthClampEnabled);
  }
  get cullMode(): FaceMode {
    return this._cullMode;
  }
  set cullMode(val: FaceMode) {
    if (this._cullMode !== val) {
      this._cullMode = val;
      this.invalidateHash();
    }
  }
  setCullMode(mode: FaceMode): this {
    this.cullMode = mode;
    return this;
  }
  get depthClampEnabled(): boolean {
    return this._depthClampEnabled;
  }
  set depthClampEnabled(val: boolean) {
    this.enableDepthClamp(val);
  }
  enableDepthClamp(enable: boolean): this {
    if (this._depthClampEnabled !== !!enable) {
      this._depthClampEnabled = !!enable;
      this.invalidateHash();
    }
    return this;
  }
  protected computeHash(): string {
    return `${this._cullMode}-${this._depthClampEnabled ? 1 : 0}`;
  }
}

export class WebGPUDepthState extends WebGPURenderState implements DepthState {
  protected static _defaultState: WebGPURenderState = new WebGPUDepthState();
  private _testEnabled: boolean;
  private _writeEnabled: boolean;
  private _compareFunc: CompareFunc;
  private _depthBias: number;
  private _depthBiasSlopeScale: number;
  constructor() {
    super();
    this._testEnabled = true;
    this._writeEnabled = true;
    this._compareFunc = 'le';
    this._depthBias = 0;
    this._depthBiasSlopeScale = 0;
  }
  clone(): DepthState {
    const other = new WebGPUDepthState();
    other.enableTest(this._testEnabled);
    other.enableWrite(this._writeEnabled);
    other.setCompareFunc(this._compareFunc);
    other.setDepthBias(this._depthBias);
    other.setDepthBiasSlopeScale(this._depthBiasSlopeScale);
    return other;
  }
  get testEnabled(): boolean {
    return this._testEnabled;
  }
  set testEnabled(val: boolean) {
    if (this._testEnabled !== !!val) {
      this._testEnabled = val;
      this.invalidateHash();
    }
  }
  get writeEnabled(): boolean {
    return this._writeEnabled;
  }
  set writeEnabled(val: boolean) {
    if (this._writeEnabled !== !!val) {
      this._writeEnabled = val;
      this.invalidateHash();
    }
  }
  get compareFunc(): CompareFunc {
    return this._compareFunc;
  }
  set compareFunc(val: CompareFunc) {
    if (this._compareFunc !== val) {
      this._compareFunc = val;
      this.invalidateHash();
    }
  }
  get depthBias(): number {
    return this._depthBias;
  }
  set depthBias(value: number) {
    this.setDepthBias(value);
  }
  setDepthBias(value: number): this {
    if (this._depthBias !== value) {
      this._depthBias = value;
      this.invalidateHash();
    }
    return this;
  }
  get depthBiasSlopeScale(): number {
    return this._depthBiasSlopeScale;
  }
  set depthBiasSlopeScale(value: number) {
    this.setDepthBiasSlopeScale(value);
  }
  setDepthBiasSlopeScale(value: number): this {
    if (this._depthBiasSlopeScale !== value) {
      this._depthBiasSlopeScale = value;
      this.invalidateHash();
    }
    return this;
  }
  enableTest(b: boolean): this {
    this.testEnabled = b;
    return this;
  }
  enableWrite(b: boolean): this {
    this.writeEnabled = b;
    return this;
  }
  setCompareFunc(func: CompareFunc): this {
    this.compareFunc = func;
    return this;
  }
  protected computeHash(): string {
    return `${Number(this._testEnabled)}-${Number(this._writeEnabled)}-${this._compareFunc}-${
      this._depthBias
    }-${this._depthBiasSlopeScale}`;
  }
}

export class WebGPUStencilState extends WebGPURenderState implements StencilState {
  protected static _defaultState: WebGPURenderState = new WebGPUStencilState();
  private _enabled: boolean;
  private _writeMask: number;
  private _failOp: StencilOp;
  private _failOpBack: StencilOp;
  private _zFailOp: StencilOp;
  private _zFailOpBack: StencilOp;
  private _passOp: StencilOp;
  private _passOpBack: StencilOp;
  private _func: CompareFunc;
  private _funcBack: CompareFunc;
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
  clone(): StencilState {
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
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(val: boolean) {
    if (this._enabled !== !!val) {
      this._enabled = !!val;
      this.invalidateHash();
    }
  }
  get writeMask(): number {
    return this._writeMask;
  }
  set writeMask(val: number) {
    if (this._writeMask !== val) {
      this._writeMask = val;
      this.invalidateHash();
    }
  }
  get failOp(): StencilOp {
    return this._failOp;
  }
  set failOp(val: StencilOp) {
    if (this._failOp !== val) {
      this._failOp = val;
      this.invalidateHash();
    }
  }
  get failOpBack(): StencilOp {
    return this._failOpBack;
  }
  set failOpBack(val: StencilOp) {
    if (this._failOpBack !== val) {
      this._failOpBack = val;
      this.invalidateHash();
    }
  }
  get zFailOp(): StencilOp {
    return this._zFailOp;
  }
  set zFailOp(val: StencilOp) {
    if (this._zFailOp !== val) {
      this._zFailOp = val;
      this.invalidateHash();
    }
  }
  get zFailOpBack(): StencilOp {
    return this._zFailOpBack;
  }
  set zFailOpBack(val: StencilOp) {
    if (this._zFailOpBack !== val) {
      this._zFailOpBack = val;
      this.invalidateHash();
    }
  }
  get passOp(): StencilOp {
    return this._passOp;
  }
  set passOp(val: StencilOp) {
    if (this._passOp !== val) {
      this._passOp = val;
      this.invalidateHash();
    }
  }
  get passOpBack(): StencilOp {
    return this._passOpBack;
  }
  set passOpBack(val: StencilOp) {
    if (this._passOpBack !== val) {
      this._passOpBack = val;
      this.invalidateHash();
    }
  }
  get func(): CompareFunc {
    return this._func;
  }
  set func(val: CompareFunc) {
    if (this._func !== val) {
      this._func = val;
      this.invalidateHash();
    }
  }
  get funcBack(): CompareFunc {
    return this._funcBack;
  }
  set funcBack(val: CompareFunc) {
    if (this._funcBack !== val) {
      this._funcBack = val;
      this.invalidateHash();
    }
  }
  get ref(): number {
    return this._ref;
  }
  set ref(val: number) {
    if (this._ref !== val) {
      this._ref = val;
      this.invalidateHash();
    }
  }
  get readMask(): number {
    return this._readMask;
  }
  set readMask(val: number) {
    if (this._readMask !== val) {
      this._readMask = val;
      this.invalidateHash();
    }
  }
  enable(b: boolean): this {
    this.enabled = b;
    return this;
  }
  setWriteMask(mask: number): this {
    this.writeMask = mask;
    return this;
  }
  setFrontOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp): this {
    this.failOp = fail;
    this.zFailOp = zfail;
    this.passOp = pass;
    return this;
  }
  setBackOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp): this {
    this.failOpBack = fail;
    this.zFailOpBack = zfail;
    this.passOpBack = pass;
    return this;
  }
  setFrontCompareFunc(func: CompareFunc): this {
    this.func = func;
    return this;
  }
  setBackCompareFunc(func: CompareFunc): this {
    this.funcBack = func;
    return this;
  }
  setReference(ref: number): this {
    this.ref = ref;
    return this;
  }
  setReadMask(mask: number): this {
    this.readMask = mask;
    return this;
  }
  protected computeHash(): string {
    return this._enabled
      ? `${this.sideHash(false)}-${this.sideHash(true)}-${this.readMask.toString(
          16
        )}-${this.writeMask.toString(16)}-${this.ref.toString(16)}`
      : '';
  }
  private sideHash(back: boolean): string {
    return back
      ? `${this._failOpBack}-${this._zFailOpBack}-${this._passOpBack}-${this._funcBack}`
      : `${this._failOp}-${this._zFailOp}-${this._passOp}-${this._func}`;
  }
}

export class WebGPURenderStateSet implements RenderStateSet {
  private _device: WebGPUDevice;
  colorState: WebGPUColorState;
  blendingState: WebGPUBlendingState;
  rasterizerState: WebGPURasterizerState;
  depthState: WebGPUDepthState;
  stencilState: WebGPUStencilState;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this.colorState = null;
    this.blendingState = null;
    this.rasterizerState = null;
    this.depthState = null;
    this.stencilState = null;
  }
  clone(): RenderStateSet {
    const newStateSet = new WebGPURenderStateSet(this._device);
    newStateSet.colorState = (this.colorState?.clone() as WebGPUColorState) ?? null;
    newStateSet.blendingState = (this.blendingState?.clone() as WebGPUBlendingState) ?? null;
    newStateSet.rasterizerState = (this.rasterizerState?.clone() as WebGPURasterizerState) ?? null;
    newStateSet.depthState = (this.depthState?.clone() as WebGPUDepthState) ?? null;
    newStateSet.stencilState = (this.stencilState?.clone() as WebGPUStencilState) ?? null;
    return newStateSet;
  }
  copyFrom(stateSet: RenderStateSet): void {
    this.colorState = stateSet.colorState as WebGPUColorState;
    this.blendingState = stateSet.blendingState as WebGPUBlendingState;
    this.rasterizerState = stateSet.rasterizerState as WebGPURasterizerState;
    this.depthState = stateSet.depthState as WebGPUDepthState;
    this.stencilState = stateSet.stencilState as WebGPUStencilState;
  }
  get hash(): string {
    return `${this.colorState?.hash || ''}:${this.blendingState?.hash || ''}:${
      this.rasterizerState?.hash || ''
    }:${this.depthState?.hash || ''}:${this.stencilState?.hash || ''}`;
  }
  useColorState(state?: ColorState): ColorState {
    return (this.colorState = (state as WebGPUColorState) ?? this.colorState ?? new WebGPUColorState());
  }
  defaultColorState() {
    this.colorState = null;
  }
  useBlendingState(state?: BlendingState): BlendingState {
    return (this.blendingState =
      (state as WebGPUBlendingState) ?? this.blendingState ?? new WebGPUBlendingState());
  }
  defaultBlendingState() {
    this.blendingState = null;
  }
  useRasterizerState(state?: RasterizerState): RasterizerState {
    return (this.rasterizerState =
      (state as WebGPURasterizerState) ?? this.rasterizerState ?? new WebGPURasterizerState());
  }
  defaultRasterizerState() {
    this.rasterizerState = null;
  }
  useDepthState(state?: DepthState): DepthState {
    return (this.depthState = (state as WebGPUDepthState) ?? this.depthState ?? new WebGPUDepthState());
  }
  defaultDepthState() {
    this.depthState = null;
  }
  useStencilState(state?: StencilState): StencilState {
    return (this.stencilState =
      (state as WebGPUStencilState) ?? this.stencilState ?? new WebGPUStencilState());
  }
  defaultStencilState() {
    this.stencilState = null;
  }
  apply(_force?: boolean): void {
    this._device.setRenderStates(this);
  }
}
