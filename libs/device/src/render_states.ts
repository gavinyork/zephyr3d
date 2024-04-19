import type { CompareFunc } from './base_types';

/**
 * The render states related to the fragment output
 * @public
 */
export interface ColorState {
  /** Creates a new ColorState by copying this one */
  clone(): ColorState;
  /** true if it is enabled to write to the red channel */
  redMask: boolean;
  /** true if it is enabled to write to the green channel */
  greenMask: boolean;
  /** true if it is enabled to write to the blue channel */
  blueMask: boolean;
  /** true if it is enabled to write to the alpha channel */
  alphaMask: boolean;
  /**
   * Set fragment write mask
   * @param r - true if writing to the red channel is allowed
   * @param g - true if writing to the green channel is allowed
   * @param b - true if writing to the blue channel is allowed
   * @param a - true if writing to the alpha channel is allowed
   */
  setColorMask(r: boolean, g: boolean, b: boolean, a: boolean): this;
}

/**
 * Type of the alpha blending equations
 * @public
 */
export type BlendEquation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';

/**
 * Type of the blending functions
 * @public
 */
export type BlendFunc =
  | 'zero'
  | 'one'
  | 'src-alpha'
  | 'inv-src-alpha'
  | 'src-alpha-saturate'
  | 'dst-alpha'
  | 'inv-dst-alpha'
  | 'src-color'
  | 'inv-src-color'
  | 'dst-color'
  | 'inv-dst-color'
  | 'const-color'
  | 'inv-const-color'
  | 'const-alpha'
  | 'inv-const-alpha';

/**
 * The render states related to alpha blending
 * @public
 */
export interface BlendingState {
  /** Creates a new BlendingState by copying this one */
  clone(): BlendingState;
  /** true if alpha blending is enabled */
  enabled: boolean;
  /** true if alpha to coverage is enabled */
  alphaToCoverageEnabled: boolean;
  /** The source blending factor for RGB channels */
  srcBlendRGB: BlendFunc;
  /** The destination blending factor for RGB channels */
  dstBlendRGB: BlendFunc;
  /** The source blending factor for alpha channel */
  srcBlendAlpha: BlendFunc;
  /** The destination blending factor for alpha channel */
  dstBlendAlpha: BlendFunc;
  /** The blending equation for RGB channels */
  rgbEquation: BlendEquation;
  /** The blending equation for alpha channel */
  alphaEquation: BlendEquation;
  /**
   * Enable or disable alpha blending
   * @param b - true if enable
   * @returns self
   */
  enable(b: boolean): this;
  /**
   * Enable or disable alpha to coverage
   * @param b - true if enable
   * @returns self
   */
  enableAlphaToCoverage(b: boolean): this;
  /**
   * Sets the blending function for both RGB channels and the alpha channel
   * @param src - The source blending function
   * @param dest - The destination blending function
   * @returns self
   */
  setBlendFunc(src: BlendFunc, dest: BlendFunc): this;
  /**
   * Sets the blending function for RGB channels
   * @param src - The source blending function
   * @param dest - The destination blending function
   * @returns self
   */
  setBlendFuncRGB(src: BlendFunc, dest: BlendFunc): this;
  /**
   * Sets the blending function for the alpha channel
   * @param src - The source blending function
   * @param dest - The destination blending function
   * @returns self
   */
  setBlendFuncAlpha(src: BlendFunc, dest: BlendFunc): this;
  /**
   * Sets the blending equations for RGB channels and the alpha channel
   * @param rgb - The blending equation for RGB channels
   * @param alpha - The blending equation for the alpha channel
   * @returns self
   */
  setBlendEquation(rgb: BlendEquation, alpha: BlendEquation): this;
}

/**
 * The face mode
 * @public
 */
export type FaceMode = 'none' | 'front' | 'back';

/**
 * The type of face winding
 * @public
 */
export type FaceWinding = 'cw' | 'ccw';

/**
 * The render states related to primitive rasterization
 * @public
 */
export interface RasterizerState {
  /** Creates a new RasterizerState by copying this one */
  clone(): RasterizerState;
  /** Triangle cull mode */
  cullMode: FaceMode;
  /** Depth clamp enabled */
  depthClampEnabled: boolean;
  /**
   * Sets the cull mode
   * @param mode - The cull mode to set
   * @returns self
   */
  setCullMode(mode: FaceMode): this;
  /**
   * Enable or disable depth clamp if supported
   * @param enable - Enables depth clamp if true, otherwise disable
   */
  enableDepthClamp(enable: boolean): this;
}

/**
 * The render states related to depth buffer
 * @public
 */
export interface DepthState {
  /** Creates a new DepthState by copying this one */
  clone(): DepthState;
  /** true if depth testing should be enabled */
  testEnabled: boolean;
  /** true if depth writing should be enabled */
  writeEnabled: boolean;
  /** The comparison function for depth testing */
  compareFunc: CompareFunc;
  /**
   * Enable or disable depth testing
   * @param b - true if enable
   * @returns self
   */
  enableTest(b: boolean): this;
  /**
   * Enable or disable depth writing
   * @param b - true if enable
   * @returns self
   */
  enableWrite(b: boolean): this;
  /**
   * Sets the comparison function for depth testing
   * @param func - The comparison function
   * @returns self
   */
  setCompareFunc(func: CompareFunc): this;
}

/**
 * Stencil operations
 * @public
 */
export type StencilOp = 'keep' | 'zero' | 'replace' | 'incr' | 'incr-wrap' | 'decr' | 'decr-wrap' | 'invert';

/**
 * The render states related to the stencil buffer
 * @public
 */
export interface StencilState {
  /** Creates a new StencilState by copying this one */
  clone(): StencilState;
  /** true if stencil testing should be enabled */
  enabled: boolean;
  /** The function to use for front stencil state when the stencil test fails */
  failOp: StencilOp;
  /** The function to use for back stencil state when the stencil test fails of the back stencil state */
  failOpBack: StencilOp;
  /** The function to use for front stencil state when the stencil test passes but depth test fails */
  zFailOp: StencilOp;
  /** The function to use for back stencil state when the stencil test passes but depth test fails */
  zFailOpBack: StencilOp;
  /** The function to use for front stencil state when both the stencil test and the depth test pass */
  passOp: StencilOp;
  /** The function to use for back stencil state when both the stencil test and the depth test pass */
  passOpBack: StencilOp;
  /** The test function for front stencil state */
  func: CompareFunc;
  /** The test function for back stencil state */
  funcBack: CompareFunc;
  /** The reference value for the stencil test */
  ref: number;
  /** A bit mask to control which bits can be written while writing to the stencil buffer */
  writeMask: number;
  /** A bit mask that is used to AND the reference value and the stored stencil value */
  readMask: number;
  /**
   * Enables or disables the stencil test
   * @param b - true if stencil test should be enabled
   * @returns self
   */
  enable(b: boolean): this;
  /**
   * Sets the stencil operations for front stencil state
   * @param fail - The function to use when the stencil test fails
   * @param zfail - The function to use when the stencil test passes bug depth test fails
   * @param pass - The function to use when both the stencil test and the depth test pass
   * @returns self
   */
  setFrontOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp): this;
  /**
   * Sets the stencil operations for back stencil state
   * @param fail - The function to use when the stencil test fails
   * @param zfail - The function to use when the stencil test passes bug depth test fails
   * @param pass - The function to use when both the stencil test and the depth test pass
   * @returns self
   */
  setBackOp(fail: StencilOp, zfail: StencilOp, pass: StencilOp): this;
  /**
   * Sets the compare function for front stencil state
   * @param func - The compare function
   * @returns self
   */
  setFrontCompareFunc(func: CompareFunc): this;
  /**
   * Sets the compare function for back stencil state
   * @param func - The compare function
   * @returns self
   */
  setBackCompareFunc(func: CompareFunc): this;
  /**
   * Sets the reference value for the stencil test
   * @param ref - The reference value
   * @returns self
   */
  setReference(ref: number): this;
  /**
   * Sets the bit mask for writing to the stencil buffer
   * @param mask - The write mask
   * @returns self
   */
  setWriteMask(mask: number): this;
  /**
   * Sets the bit mask for reading from the stencil buffer and reference value
   * @param mask - The read mask
   * @returns self
   */
  setReadMask(mask: number): this;
}

/**
 * Set of the render statements
 * @public
 */
export interface RenderStateSet {
  /** Creates a new RenderStateSet object by deep copy from this object */
  clone(): RenderStateSet;
  /** Shallow copy existing RenderStateSet object to this */
  copyFrom(stateSet: RenderStateSet): void;
  /** Fragment output related render statements or null if the default values should be used */
  readonly colorState: ColorState;
  /** Alpha blending related render statements or null if the default values should be used */
  readonly blendingState: BlendingState;
  /** Rasterization related render statements or null if the default values should be used */
  readonly rasterizerState: RasterizerState;
  /** Depth buffer related render statements or null if the default values should be used */
  readonly depthState: DepthState;
  /** Stencil buffer related render statements or null if the default values should be used */
  readonly stencilState: StencilState;
  /**
   * Allocates a ColorState
   * @returns The created ColorState
   */
  useColorState(state?: ColorState): ColorState;
  /**
   * Deletes the ColorState that was allocated by {@link RenderStateSet.useColorState}, so that the default value will be used
   */
  defaultColorState(): void;
  /**
   * Allocates a BlendingState
   * @returns The created BlendingState
   */
  useBlendingState(state?: BlendingState): BlendingState;
  /**
   * Deletes the BlendingState that was allocated by {@link RenderStateSet.useBlendingState}, so that the default value will be used
   */
  defaultBlendingState(): void;
  /**
   * Allocates a RasterizerState
   * @returns The created RasterizerState
   */
  useRasterizerState(state?: RasterizerState): RasterizerState;
  /**
   * Deletes the RasterizerState that was allocated by {@link RenderStateSet.useRasterizerState}, so that the default value will be used
   */
  defaultRasterizerState(): void;
  /**
   * Allocates a DepthState
   * @returns The created DepthState
   */
  useDepthState(state?: DepthState): DepthState;
  /**
   * Deletes the DepthState that was allocated by {@link RenderStateSet.useDepthState}, so that the default value will be used
   */
  defaultDepthState(): void;
  /**
   * Allocates a StencilState
   * @returns The created StencilState
   */
  useStencilState(state?: StencilState): StencilState;
  /**
   * Deletes the StencilState that was allocated by {@link RenderStateSet.useStencilState}, so that the default value will be used
   */
  defaultStencilState(): void;
  /**
   * Applis the render statements to current device
   * @param force - Force applying all render statements
   */
  apply(force?: boolean): void;
}
