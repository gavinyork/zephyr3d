import type { Nullable } from '@zephyr3d/base';
import type {
  TextureFormat,
  CompareFunc,
  TextureAddressMode,
  TextureFilterMode,
  PrimitiveType,
  BlendEquation,
  BlendFunc,
  FaceMode,
  FaceWinding,
  StencilOp
} from '@zephyr3d/device';

export const textureWrappingMap: Record<TextureAddressMode, GPUAddressMode> = {
  repeat: 'repeat',
  'mirrored-repeat': 'mirror-repeat',
  clamp: 'clamp-to-edge'
};

export const textureFilterMap: Record<TextureFilterMode, GPUFilterMode | undefined> = {
  nearest: 'nearest',
  linear: 'linear',
  none: undefined
};

export const compareFuncMap: Record<CompareFunc, GPUCompareFunction> = {
  always: 'always',
  le: 'less-equal',
  ge: 'greater-equal',
  lt: 'less',
  gt: 'greater',
  eq: 'equal',
  ne: 'not-equal',
  never: 'never'
};

export const stencilOpMap: Record<StencilOp, GPUStencilOperation> = {
  keep: 'keep',
  replace: 'replace',
  zero: 'zero',
  invert: 'invert',
  incr: 'increment-clamp',
  decr: 'decrement-clamp',
  'incr-wrap': 'increment-wrap',
  'decr-wrap': 'decrement-wrap'
};

export const primitiveTypeMap: Record<PrimitiveType, Nullable<GPUPrimitiveTopology>> = {
  'triangle-list': 'triangle-list',
  'triangle-strip': 'triangle-strip',
  'triangle-fan': null,
  'line-list': 'line-list',
  'line-strip': 'line-strip',
  'point-list': 'point-list'
};

export const faceWindingMap: Record<FaceWinding, GPUFrontFace> = {
  ccw: 'ccw',
  cw: 'cw'
};

export const faceModeMap: Record<FaceMode, GPUCullMode> = {
  back: 'back',
  front: 'front',
  none: 'none'
};

export const blendEquationMap: Record<BlendEquation, GPUBlendOperation> = {
  add: 'add',
  subtract: 'subtract',
  'reverse-subtract': 'reverse-subtract',
  min: 'min',
  max: 'max'
};

export const blendFuncMap: Record<BlendFunc, GPUBlendFactor> = {
  'const-color': 'constant',
  'const-alpha': 'constant',
  'dst-color': 'dst',
  'dst-alpha': 'dst-alpha',
  'inv-const-color': 'one-minus-constant',
  'inv-const-alpha': 'one-minus-constant',
  'inv-dst-color': 'one-minus-dst',
  'inv-dst-alpha': 'one-minus-dst-alpha',
  'src-color': 'src',
  'src-alpha': 'src-alpha',
  'inv-src-color': 'one-minus-src',
  'inv-src-alpha': 'one-minus-src-alpha',
  'src-alpha-saturate': 'src-alpha-saturated',
  one: 'one',
  zero: 'zero'
};

export const vertexFormatToHash: Record<string, string> = {
  float32: '0',
  float32x2: '1',
  float32x3: '2',
  float32x4: '3',
  uint32: '4',
  uint32x2: '5',
  uint32x3: '6',
  uint32x4: '7',
  sint32: '8',
  sint32x2: '9',
  sint32x3: 'a',
  sint32x4: 'b',
  uint16x2: 'c',
  uint16x4: 'd',
  unorm16x2: 'e',
  unorm16x4: 'f',
  sint16x2: 'g',
  sint16x4: 'h',
  snorm16x2: 'i',
  snorm16x4: 'j',
  uint8x2: 'k',
  uint8x4: 'l',
  unorm8x2: 'm',
  unorm8x4: 'n',
  sint8x2: 'o',
  sint8x4: 'p',
  snorm8x2: 'q',
  snorm8x4: 'r'
};

export const textureFormatMap: Record<TextureFormat, GPUTextureFormat> = {
  ['rgba8unorm']: 'rgba8unorm',
  ['rgba8snorm']: 'rgba8snorm',
  ['bgra8unorm']: 'bgra8unorm',
  ['dxt1']: 'bc1-rgba-unorm',
  ['dxt3']: 'bc2-rgba-unorm',
  ['dxt5']: 'bc3-rgba-unorm',
  ['dxt1-srgb']: 'bc1-rgba-unorm-srgb',
  ['dxt3-srgb']: 'bc2-rgba-unorm-srgb',
  ['dxt5-srgb']: 'bc3-rgba-unorm-srgb',
  ['bc4']: 'bc4-r-unorm',
  ['bc4-signed']: 'bc4-r-snorm',
  ['bc5']: 'bc5-rg-unorm',
  ['bc5-signed']: 'bc5-rg-snorm',
  ['bc6h']: 'bc6h-rgb-ufloat',
  ['bc6h-signed']: 'bc6h-rgb-float',
  ['bc7']: 'bc7-rgba-unorm',
  ['bc7-srgb']: 'bc7-rgba-unorm-srgb',
  ['astc-4x4']: 'astc-4x4-unorm',
  ['astc-4x4-srgb']: 'astc-4x4-unorm-srgb',
  ['astc-5x4']: 'astc-5x4-unorm',
  ['astc-5x4-srgb']: 'astc-5x4-unorm-srgb',
  ['astc-5x5']: 'astc-5x5-unorm',
  ['astc-5x5-srgb']: 'astc-5x5-unorm-srgb',
  ['astc-6x5']: 'astc-6x5-unorm',
  ['astc-6x5-srgb']: 'astc-6x5-unorm-srgb',
  ['astc-6x6']: 'astc-6x6-unorm',
  ['astc-6x6-srgb']: 'astc-6x6-unorm-srgb',
  ['astc-8x5']: 'astc-8x5-unorm',
  ['astc-8x5-srgb']: 'astc-8x5-unorm-srgb',
  ['astc-8x6']: 'astc-8x6-unorm',
  ['astc-8x6-srgb']: 'astc-8x6-unorm-srgb',
  ['astc-8x8']: 'astc-8x8-unorm',
  ['astc-8x8-srgb']: 'astc-8x8-unorm-srgb',
  ['astc-10x5']: 'astc-10x5-unorm',
  ['astc-10x5-srgb']: 'astc-10x5-unorm-srgb',
  ['astc-10x6']: 'astc-10x6-unorm',
  ['astc-10x6-srgb']: 'astc-10x6-unorm-srgb',
  ['astc-10x8']: 'astc-10x8-unorm',
  ['astc-10x8-srgb']: 'astc-10x8-unorm-srgb',
  ['astc-10x10']: 'astc-10x10-unorm',
  ['astc-10x10-srgb']: 'astc-10x10-unorm-srgb',
  ['astc-12x10']: 'astc-12x10-unorm',
  ['astc-12x10-srgb']: 'astc-12x10-unorm-srgb',
  ['astc-12x12']: 'astc-12x12-unorm',
  ['astc-12x12-srgb']: 'astc-12x12-unorm-srgb',
  ['r8unorm']: 'r8unorm',
  ['r8snorm']: 'r8snorm',
  ['r16f']: 'r16float',
  ['r32f']: 'r32float',
  ['r8ui']: 'r8uint',
  ['r8i']: 'r8sint',
  ['r16ui']: 'r16uint',
  ['r16i']: 'r16sint',
  ['r32ui']: 'r32uint',
  ['r32i']: 'r32sint',
  ['rg8unorm']: 'rg8unorm',
  ['rg8snorm']: 'rg8snorm',
  ['rg16f']: 'rg16float',
  ['rg32f']: 'rg32float',
  ['rg8ui']: 'rg8uint',
  ['rg8i']: 'rg8sint',
  ['rg16ui']: 'rg16uint',
  ['rg16i']: 'rg16sint',
  ['rg32ui']: 'rg32uint',
  ['rg32i']: 'rg32sint',
  ['rgba8unorm-srgb']: 'rgba8unorm-srgb',
  ['bgra8unorm-srgb']: 'bgra8unorm-srgb',
  ['rgba16f']: 'rgba16float',
  ['rgba32f']: 'rgba32float',
  ['rgba8ui']: 'rgba8uint',
  ['rgba8i']: 'rgba8sint',
  ['rgba16ui']: 'rgba16uint',
  ['rgba16i']: 'rgba16sint',
  ['rgba32ui']: 'rgba32uint',
  ['rgba32i']: 'rgba32sint',
  ['rg11b10uf']: 'rg11b10ufloat',
  ['d16']: 'depth16unorm',
  ['d24']: 'depth24plus',
  ['d32f']: 'depth32float',
  ['d32fs8']: 'depth32float-stencil8',
  ['d24s8']: 'depth24plus-stencil8'
};

function zip<K = string>(keys: string[], values: K[]): Record<string, K> {
  const ret: Record<string, K> = {};
  const len = keys.length;
  for (let i = 0; i < len; i++) {
    ret[keys[i]] = values[i];
  }
  return ret;
}

export const textureFormatInvMap = zip<TextureFormat>(
  Object.values(textureFormatMap),
  Object.keys(textureFormatMap) as TextureFormat[]
);

export const hashToVertexFormat: Record<string, string> = zip(
  Object.values(vertexFormatToHash),
  Object.keys(vertexFormatToHash)
);
