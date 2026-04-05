import { float2half, ASSERT, RectsPacker, Matrix4x4, Vector4, Vector3, parseColor, Observable } from '@zephyr3d/base';

const RED_SHIFT = 0;
const GREEN_SHIFT = 1;
const BLUE_SHIFT = 2;
const ALPHA_SHIFT = 3;
const DEPTH_SHIFT = 4;
const STENCIL_SHIFT = 5;
const FLOAT_SHIFT = 6;
const INTEGER_SHIFT = 7;
const SIGNED_SHIFT = 8;
const SRGB_SHIFT = 9;
const BGR_SHIFT = 10;
const BLOCK_SIZE_SHIFT = 11;
const BLOCK_SIZE_MASK = 0x1f << BLOCK_SIZE_SHIFT;
const BLOCK_WIDTH_SHIFT = 16;
const BLOCK_WIDTH_MASK = 0xf << BLOCK_WIDTH_SHIFT;
const BLOCK_HEIGHT_SHIFT = 20;
const BLOCK_HEIGHT_MASK = 0xf << BLOCK_HEIGHT_SHIFT;
const COMPRESSED_FORMAT_SHIFT = 24;
const COMPRESSION_FORMAT_BC1 = 1 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC2 = 2 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC3 = 3 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC4 = 4 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC5 = 5 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC6H = 6 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC7 = 7 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC = 8 << COMPRESSED_FORMAT_SHIFT;
/*
const COMPRESSION_FORMAT_ETC2_RGB8 = 8 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGB8_A1 = 9 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGBA8 = 10 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_4x4 = 11 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x4 = 12 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x5 = 13 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x5 = 14 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x6 = 15 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x5 = 16 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x6 = 17 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x8 = 18 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x5 = 19 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x6 = 20 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x8 = 21 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x10 = 22 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x10 = 23 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x12 = 24 << COMPRESSED_FORMAT_SHIFT;
*/ const COMPRESSION_FORMAT_BITMASK = 0x1f << COMPRESSED_FORMAT_SHIFT;
const RED_BITMASK = 1 << RED_SHIFT;
const GREEN_BITMASK = 1 << GREEN_SHIFT;
const BLUE_BITMASK = 1 << BLUE_SHIFT;
const ALPHA_BITMASK = 1 << ALPHA_SHIFT;
const DEPTH_BITMASK = 1 << DEPTH_SHIFT;
const STENCIL_BITMASK = 1 << STENCIL_SHIFT;
const FLOAT_BITMASK = 1 << FLOAT_SHIFT;
const INTEGER_BITMASK = 1 << INTEGER_SHIFT;
const SIGNED_BITMASK = 1 << SIGNED_SHIFT;
const SRGB_BITMASK = 1 << SRGB_SHIFT;
const BGR_BITMASK = 1 << BGR_SHIFT;
function makeTextureFormat(compression, r, g, b, a, depth, stencil, float, integer, signed, srgb, bgr, blockWidth, blockHeight, blockSize) {
    const compressionBits = compression;
    const colorBits = (r ? RED_BITMASK : 0) | (g ? GREEN_BITMASK : 0) | (b ? BLUE_BITMASK : 0) | (a ? ALPHA_BITMASK : 0);
    const depthStencilBits = (depth ? DEPTH_BITMASK : 0) | (stencil ? STENCIL_BITMASK : 0);
    const floatBits = float ? FLOAT_BITMASK : 0;
    const integerBits = integer ? INTEGER_BITMASK : 0;
    const signedBits = signed ? SIGNED_BITMASK : 0;
    const srgbBits = srgb ? SRGB_BITMASK : 0;
    const bgrBits = bgr ? BGR_BITMASK : 0;
    const blockBits = blockWidth << BLOCK_WIDTH_SHIFT | blockHeight << BLOCK_HEIGHT_SHIFT | blockSize << BLOCK_SIZE_SHIFT;
    return compressionBits | colorBits | depthStencilBits | floatBits | integerBits | signedBits | srgbBits | bgrBits | blockBits;
}
const textureFormatMap = {
    r8unorm: makeTextureFormat(0, true, false, false, false, false, false, false, false, false, false, false, 1, 1, 1),
    r8snorm: makeTextureFormat(0, true, false, false, false, false, false, false, false, true, false, false, 1, 1, 1),
    r16f: makeTextureFormat(0, true, false, false, false, false, false, true, false, true, false, false, 1, 1, 2),
    r32f: makeTextureFormat(0, true, false, false, false, false, false, true, false, true, false, false, 1, 1, 4),
    r8ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 1),
    r8i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 1),
    r16ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 2),
    r16i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 2),
    r32ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 4),
    r32i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 4),
    rg8unorm: makeTextureFormat(0, true, true, false, false, false, false, false, false, false, false, false, 1, 1, 2),
    rg8snorm: makeTextureFormat(0, true, true, false, false, false, false, false, false, true, false, false, 1, 1, 2),
    rg16f: makeTextureFormat(0, true, true, false, false, false, false, true, false, true, false, false, 1, 1, 4),
    rg32f: makeTextureFormat(0, true, true, false, false, false, false, true, false, true, false, false, 1, 1, 8),
    rg8ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 2),
    rg8i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 2),
    rg16ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 4),
    rg16i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 4),
    rg32ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 8),
    rg32i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 8),
    rgba8unorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, false, false, false, 1, 1, 4),
    'rgba8unorm-srgb': makeTextureFormat(0, true, true, true, true, false, false, false, false, false, true, false, 1, 1, 4),
    rgba8snorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, true, false, false, 1, 1, 4),
    bgra8unorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, false, false, true, 1, 1, 4),
    'bgra8unorm-srgb': makeTextureFormat(0, true, true, true, true, false, false, false, false, false, true, true, 1, 1, 4),
    rgba16f: makeTextureFormat(0, true, true, true, true, false, false, true, false, true, false, false, 1, 1, 8),
    rgba32f: makeTextureFormat(0, true, true, true, true, false, false, true, false, true, false, false, 1, 1, 16),
    rgba8ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 4),
    rgba8i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 4),
    rgba16ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 8),
    rgba16i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 8),
    rgba32ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 16),
    rgba32i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 16),
    rg11b10uf: makeTextureFormat(0, true, true, true, false, false, false, true, false, false, false, false, 1, 1, 4),
    d16: makeTextureFormat(0, false, false, false, false, true, false, false, false, false, false, false, 1, 1, 2),
    d24: makeTextureFormat(0, false, false, false, false, true, false, false, false, false, false, false, 0, 0, 0),
    d32f: makeTextureFormat(0, false, false, false, false, true, false, true, false, true, false, false, 1, 1, 4),
    d24s8: makeTextureFormat(0, false, false, false, false, true, true, false, false, false, false, false, 1, 1, 4),
    d32fs8: makeTextureFormat(0, false, false, false, false, true, true, true, false, true, false, false, 1, 1, 5),
    // compressed texture formats
    dxt1: makeTextureFormat(COMPRESSION_FORMAT_BC1, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 8),
    'dxt1-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC1, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 8),
    dxt3: makeTextureFormat(COMPRESSION_FORMAT_BC2, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'dxt3-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC2, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16),
    dxt5: makeTextureFormat(COMPRESSION_FORMAT_BC3, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'dxt5-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC3, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16),
    bc4: makeTextureFormat(COMPRESSION_FORMAT_BC4, true, false, false, false, false, false, false, false, false, false, false, 4, 4, 8),
    'bc4-signed': makeTextureFormat(COMPRESSION_FORMAT_BC4, true, false, false, false, false, false, false, false, true, false, false, 4, 4, 8),
    bc5: makeTextureFormat(COMPRESSION_FORMAT_BC5, true, true, false, false, false, false, false, false, false, false, false, 4, 4, 16),
    'bc5-signed': makeTextureFormat(COMPRESSION_FORMAT_BC5, true, true, false, false, false, false, false, false, true, false, false, 4, 4, 16),
    bc6h: makeTextureFormat(COMPRESSION_FORMAT_BC6H, true, true, true, false, false, false, true, false, false, false, false, 4, 4, 16),
    'bc6h-signed': makeTextureFormat(COMPRESSION_FORMAT_BC6H, true, true, true, false, false, false, true, false, true, false, false, 4, 4, 16),
    bc7: makeTextureFormat(COMPRESSION_FORMAT_BC7, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'bc7-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC7, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16),
    'astc-4x4': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'astc-4x4-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16),
    'astc-5x4': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 5, 4, 16),
    'astc-5x4-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 5, 4, 16),
    'astc-5x5': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 5, 5, 16),
    'astc-5x5-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 5, 5, 16),
    'astc-6x5': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 6, 5, 16),
    'astc-6x5-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 6, 5, 16),
    'astc-6x6': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 6, 6, 16),
    'astc-6x6-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 6, 6, 16),
    'astc-8x5': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 8, 5, 16),
    'astc-8x5-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 8, 5, 16),
    'astc-8x6': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 8, 6, 16),
    'astc-8x6-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 8, 6, 16),
    'astc-8x8': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 8, 8, 16),
    'astc-8x8-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 8, 8, 16),
    'astc-10x5': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 10, 5, 16),
    'astc-10x5-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 10, 5, 16),
    'astc-10x6': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 10, 6, 16),
    'astc-10x6-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 10, 6, 16),
    'astc-10x8': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 10, 8, 16),
    'astc-10x8-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 10, 8, 16),
    'astc-10x10': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 10, 10, 16),
    'astc-10x10-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 10, 10, 16),
    'astc-12x10': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 12, 10, 16),
    'astc-12x10-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 12, 10, 16),
    'astc-12x12': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, false, false, 12, 12, 16),
    'astc-12x12-srgb': makeTextureFormat(COMPRESSION_FORMAT_ASTC, true, true, true, true, false, false, false, false, false, true, false, 12, 12, 16)
};
/**
 * Converts a non-sRGB texture format to the corresponding sRGB texture format
 * @param format - The texture format to be converted
 * @returns The sRGB texture format
 * @public
 */ function linearTextureFormatToSRGB(format) {
    switch(format){
        case 'rgba8unorm':
            return 'rgba8unorm-srgb';
        case 'bgra8unorm':
            return 'bgra8unorm-srgb';
        case 'dxt1':
            return 'dxt1-srgb';
        case 'dxt3':
            return 'dxt3-srgb';
        case 'dxt5':
            return 'dxt5-srgb';
        case 'bc7':
            return 'bc7-srgb';
        case 'astc-4x4':
            return 'astc-4x4-srgb';
        case 'astc-5x4':
            return 'astc-5x4-srgb';
        case 'astc-5x5':
            return 'astc-5x5-srgb';
        case 'astc-6x5':
            return 'astc-6x5-srgb';
        case 'astc-6x6':
            return 'astc-6x6-srgb';
        case 'astc-8x5':
            return 'astc-8x5-srgb';
        case 'astc-8x6':
            return 'astc-8x6-srgb';
        case 'astc-8x8':
            return 'astc-8x8-srgb';
        case 'astc-10x5':
            return 'astc-10x5-srgb';
        case 'astc-10x6':
            return 'astc-10x6-srgb';
        case 'astc-10x8':
            return 'astc-10x8-srgb';
        case 'astc-10x10':
            return 'astc-10x10-srgb';
        case 'astc-12x10':
            return 'astc-12x10-srgb';
        case 'astc-12x12':
            return 'astc-12x12-srgb';
        default:
            return format;
    }
}
/**
 * Check if a given texture format contains an alpha channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains an alpha channel, otherwise false
 * @public
 */ function hasAlphaChannel(format) {
    return !!(textureFormatMap[format] & ALPHA_BITMASK);
}
/**
 * Check if a given texture format contains a red channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a red channel, otherwise false
 * @public
 */ function hasRedChannel(format) {
    return !!(textureFormatMap[format] & RED_BITMASK);
}
/**
 * Check if a given texture format contains a green channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a green channel, otherwise false
 * @public
 */ function hasGreenChannel(format) {
    return !!(textureFormatMap[format] & GREEN_BITMASK);
}
/**
 * Check if a given texture format contains a blue channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a blue channel, otherwise false
 * @public
 */ function hasBlueChannel(format) {
    return !!(textureFormatMap[format] & BLUE_BITMASK);
}
/**
 * Check if a given texture format contains a depth channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a depth channel, otherwise false
 * @public
 */ function hasDepthChannel(format) {
    return !!(textureFormatMap[format] & DEPTH_BITMASK);
}
/**
 * Check if a given texture format contains a stencil channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a stencil channel, otherwise false
 * @public
 */ function hasStencilChannel(format) {
    return !!(textureFormatMap[format] & STENCIL_BITMASK);
}
/**
 * Check whether a given texture format is floating-point.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is floating-point, otherwise false
 * @public
 */ function isFloatTextureFormat(format) {
    return !!(textureFormatMap[format] & FLOAT_BITMASK);
}
/**
 * Check whether a given texture format is integer.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is integer, otherwise false
 * @public
 */ function isIntegerTextureFormat(format) {
    return !!(textureFormatMap[format] & INTEGER_BITMASK);
}
/**
 * Check whether a given texture format is signed.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is signed, otherwise false
 * @public
 */ function isSignedTextureFormat(format) {
    return !!(textureFormatMap[format] & SIGNED_BITMASK);
}
/**
 * Check whether a given texture format is a compressed format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is a compressed format, otherwise false
 * @public
 */ function isCompressedTextureFormat(format) {
    return !!(textureFormatMap[format] & COMPRESSION_FORMAT_BITMASK);
}
/**
 * Check whether a given texture format is sRGB format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is sRGB format, otherwise false
 * @public
 */ function isSRGBTextureFormat(format) {
    return !!(textureFormatMap[format] & SRGB_BITMASK);
}
/**
 * Get block size of given texture format
 * @param format - The texture format
 * @returns The block size
 * @public
 */ function getTextureFormatBlockSize(format) {
    return (textureFormatMap[format] & BLOCK_SIZE_MASK) >> BLOCK_SIZE_SHIFT;
}
/**
 * Get block width of given texture format
 * @param format - The texture format
 * @returns The block width
 * @public
 */ function getTextureFormatBlockWidth(format) {
    return (textureFormatMap[format] & BLOCK_WIDTH_MASK) >> BLOCK_WIDTH_SHIFT;
}
/**
 * Get block height of given texture format
 * @param format - The texture format
 * @returns The block height
 * @public
 */ function getTextureFormatBlockHeight(format) {
    return (textureFormatMap[format] & BLOCK_HEIGHT_MASK) >> BLOCK_HEIGHT_SHIFT;
}
function normalizeColorComponent(val, maxval) {
    return Math.min(maxval, Math.max(Math.floor(val * maxval), 0));
}
function normalizeColorComponentSigned(val, maxval) {
    return normalizeColorComponent(val * 0.5 + 0.5, maxval) - (maxval + 1) / 2;
}
/** @internal */ function encodePixel(format, r, g, b, a) {
    switch(format){
        case 'r8unorm':
            return new Uint8Array([
                normalizeColorComponent(r, 255)
            ]);
        case 'r8snorm':
            return new Int8Array([
                normalizeColorComponentSigned(r, 255)
            ]);
        case 'r16f':
            return new Uint16Array([
                float2half(r)
            ]);
        case 'r32f':
            return new Float32Array([
                r
            ]);
        case 'r8ui':
            return new Uint8Array([
                r | 0
            ]);
        case 'r8i':
            return new Int8Array([
                r | 0
            ]);
        case 'r16ui':
            return new Uint16Array([
                r | 0
            ]);
        case 'r16i':
            return new Int16Array([
                r | 0
            ]);
        case 'r32ui':
            return new Uint32Array([
                r | 0
            ]);
        case 'r32i':
            return new Int32Array([
                r | 0
            ]);
        case 'rg8unorm':
            return new Uint8Array([
                normalizeColorComponent(r, 255),
                normalizeColorComponent(g, 255)
            ]);
        case 'rg8snorm':
            return new Int8Array([
                normalizeColorComponentSigned(r, 255),
                normalizeColorComponentSigned(g, 255)
            ]);
        case 'rg16f':
            return new Uint16Array([
                float2half(r),
                float2half(g)
            ]);
        case 'rg32f':
            return new Float32Array([
                r,
                g
            ]);
        case 'rg8ui':
            return new Uint8Array([
                r | 0,
                g | 0
            ]);
        case 'rg8i':
            return new Int8Array([
                r | 0,
                g | 0
            ]);
        case 'rg16ui':
            return new Uint16Array([
                r | 0,
                g | 0
            ]);
        case 'rg16i':
            return new Int16Array([
                r | 0,
                g | 0
            ]);
        case 'rg32ui':
            return new Uint32Array([
                r | 0,
                g | 0
            ]);
        case 'rg32i':
            return new Int32Array([
                r | 0,
                g | 0
            ]);
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
            return new Uint8Array([
                normalizeColorComponent(r, 255),
                normalizeColorComponent(g, 255),
                normalizeColorComponent(b, 255),
                normalizeColorComponent(a, 255)
            ]);
        case 'bgra8unorm':
        case 'bgra8unorm-srgb':
            return new Uint8Array([
                normalizeColorComponent(b, 255),
                normalizeColorComponent(g, 255),
                normalizeColorComponent(r, 255),
                normalizeColorComponent(a, 255)
            ]);
        case 'rgba8snorm':
            return new Int8Array([
                normalizeColorComponentSigned(r, 255),
                normalizeColorComponentSigned(g, 255),
                normalizeColorComponentSigned(b, 255),
                normalizeColorComponentSigned(a, 255)
            ]);
        case 'rgba16f':
            return new Uint16Array([
                float2half(r),
                float2half(g),
                float2half(b),
                float2half(a)
            ]);
        case 'rgba32f':
            return new Float32Array([
                r,
                g,
                b,
                a
            ]);
        case 'rgba8ui':
            return new Uint8Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        case 'rgba8i':
            return new Int8Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        case 'rgba16ui':
            return new Uint16Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        case 'rgba16i':
            return new Int16Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        case 'rgba32ui':
            return new Uint32Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        case 'rgba32i':
            return new Int32Array([
                r | 0,
                g | 0,
                b | 0,
                a | 0
            ]);
        default:
            throw new Error(`Invalid texture format: ${format}`);
    }
}
/** @internal */ function encodePixelToArray(format, r, g, b, a, arr) {
    switch(format){
        case 'r8unorm':
            arr.push(normalizeColorComponent(r, 255));
            break;
        case 'r8snorm':
            arr.push(normalizeColorComponentSigned(r, 255));
            break;
        case 'r16f':
            arr.push(float2half(r));
            break;
        case 'r32f':
            arr.push(r);
            break;
        case 'r8ui':
            arr.push(r | 0);
            break;
        case 'r8i':
            arr.push(r | 0);
            break;
        case 'r16ui':
            arr.push(r | 0);
            break;
        case 'r16i':
            arr.push(r | 0);
            break;
        case 'r32ui':
            arr.push(r | 0);
            break;
        case 'r32i':
            arr.push(r | 0);
            break;
        case 'rg8unorm':
            arr.push(normalizeColorComponent(r, 255), normalizeColorComponent(g, 255));
            break;
        case 'rg8snorm':
            arr.push(normalizeColorComponentSigned(r, 255), normalizeColorComponentSigned(g, 255));
            break;
        case 'rg16f':
            arr.push(float2half(r), float2half(g));
            break;
        case 'rg32f':
            arr.push(r, g);
            break;
        case 'rg8ui':
            arr.push(r | 0, g | 0);
            break;
        case 'rg8i':
            arr.push(r | 0, g | 0);
            break;
        case 'rg16ui':
            arr.push(r | 0, g | 0);
            break;
        case 'rg16i':
            arr.push(r | 0, g | 0);
            break;
        case 'rg32ui':
            arr.push(r | 0, g | 0);
            break;
        case 'rg32i':
            arr.push(r | 0, g | 0);
            break;
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
            arr.push(normalizeColorComponent(r, 255), normalizeColorComponent(g, 255), normalizeColorComponent(b, 255), normalizeColorComponent(a, 255));
            break;
        case 'bgra8unorm':
        case 'bgra8unorm-srgb':
            arr.push(normalizeColorComponent(b, 255), normalizeColorComponent(g, 255), normalizeColorComponent(r, 255), normalizeColorComponent(a, 255));
            break;
        case 'rgba8snorm':
            arr.push(normalizeColorComponentSigned(r, 255), normalizeColorComponentSigned(g, 255), normalizeColorComponentSigned(b, 255), normalizeColorComponentSigned(a, 255));
            break;
        case 'rgba16f':
            arr.push(float2half(r), float2half(g), float2half(b), float2half(a));
            break;
        case 'rgba32f':
            arr.push(r, g, b, a);
            break;
        case 'rgba8ui':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
        case 'rgba8i':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
        case 'rgba16ui':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
        case 'rgba16i':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
        case 'rgba32ui':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
        case 'rgba32i':
            arr.push(r | 0, g | 0, b | 0, a | 0);
            break;
    }
}
/**
 * Shader type
 * @public
 */ var ShaderType = /*#__PURE__*/ function(ShaderType) {
    ShaderType[ShaderType["Vertex"] = 1] = "Vertex";
    ShaderType[ShaderType["Fragment"] = 2] = "Fragment";
    ShaderType[ShaderType["Compute"] = 4] = "Compute";
    return ShaderType;
}({});

const F16_BITMASK = 1;
const F32_BITMASK = 2;
const BOOL_BITMASK = 3;
const I8_BITMASK = 4;
const I16_BITMASK = 5;
const I32_BITMASK = 6;
const U8_BITMASK = 7;
const U16_BITMASK = 8;
const U32_BITMASK = 9;
const SCALAR_TYPE_BITMASK = 15;
const ROWS_BITMASK = 7;
const ROWS_BITSHIFT = 4;
const COLS_BITMASK = 7;
const COLS_BITSHIFT = 7;
const NORM_BITMASK = 1;
const NORM_BITSHIFT = 10;
function align(n, alignment) {
    return n + alignment - 1 & ~(alignment - 1);
}
function getAlignment(type) {
    if (type.isPrimitiveType()) {
        return type.isScalarType() ? 4 : 1 << Math.min(4, type.cols + 1);
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 1 : getAlignment(type.elementType);
    } else {
        let alignment = 0;
        for (const member of type.structMembers){
            alignment = Math.max(alignment, getAlignment(member.type));
        }
        return Math.max(alignment, 16);
    }
}
function getAlignmentPacked(_type) {
    return 1;
}
function getSize(type) {
    if (type.isPrimitiveType()) {
        return type.isMatrixType() ? type.rows * getAlignment(PBPrimitiveTypeInfo.getCachedTypeInfo(type.resizeType(1, type.cols))) : 4 * type.cols;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 0 : type.dimension * align(getSize(type.elementType), getAlignment(type.elementType));
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else {
        let size = 0;
        let structAlignment = 0;
        for (const member of type.structMembers){
            const memberAlignment = getAlignment(member.type);
            size = align(size, memberAlignment);
            size += getSize(member.type);
            structAlignment = Math.max(structAlignment, memberAlignment);
        }
        return align(size, structAlignment);
    }
}
function getSizePacked(type) {
    if (type.isPrimitiveType()) {
        let scalarSize;
        switch(type.scalarType){
            case PBPrimitiveType.U8:
            case PBPrimitiveType.U8_NORM:
            case PBPrimitiveType.I8:
            case PBPrimitiveType.I8_NORM:
                scalarSize = 1;
                break;
            case PBPrimitiveType.F16:
            case PBPrimitiveType.I16:
            case PBPrimitiveType.I16_NORM:
            case PBPrimitiveType.U16:
            case PBPrimitiveType.U16_NORM:
                scalarSize = 2;
                break;
            default:
                scalarSize = 4;
                break;
        }
        return type.rows * type.cols * scalarSize;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 0 : type.dimension * getSizePacked(type.elementType);
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else {
        let size = 0;
        for (const member of type.structMembers){
            size += getSizePacked(member.type);
        }
        return size;
    }
}
function makePrimitiveType(scalarTypeMask, rows, cols, norm) {
    return scalarTypeMask | rows << ROWS_BITSHIFT | cols << COLS_BITSHIFT | norm << NORM_BITSHIFT;
}
function typeToTypedArray(type) {
    if (type.isPrimitiveType()) {
        return type.scalarType;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? null : typeToTypedArray(type.elementType);
    } else {
        return PBPrimitiveType.U8;
    }
}
/**
 * Primitive types
 * @public
 */ var PBPrimitiveType = /*#__PURE__*/ function(PBPrimitiveType) {
    PBPrimitiveType[PBPrimitiveType["NONE"] = 0] = "NONE";
    PBPrimitiveType[PBPrimitiveType["F16"] = makePrimitiveType(F16_BITMASK, 1, 1, 0)] = "F16";
    PBPrimitiveType[PBPrimitiveType["F16VEC2"] = makePrimitiveType(F16_BITMASK, 1, 2, 0)] = "F16VEC2";
    PBPrimitiveType[PBPrimitiveType["F16VEC3"] = makePrimitiveType(F16_BITMASK, 1, 3, 0)] = "F16VEC3";
    PBPrimitiveType[PBPrimitiveType["F16VEC4"] = makePrimitiveType(F16_BITMASK, 1, 4, 0)] = "F16VEC4";
    PBPrimitiveType[PBPrimitiveType["F32"] = makePrimitiveType(F32_BITMASK, 1, 1, 0)] = "F32";
    PBPrimitiveType[PBPrimitiveType["F32VEC2"] = makePrimitiveType(F32_BITMASK, 1, 2, 0)] = "F32VEC2";
    PBPrimitiveType[PBPrimitiveType["F32VEC3"] = makePrimitiveType(F32_BITMASK, 1, 3, 0)] = "F32VEC3";
    PBPrimitiveType[PBPrimitiveType["F32VEC4"] = makePrimitiveType(F32_BITMASK, 1, 4, 0)] = "F32VEC4";
    PBPrimitiveType[PBPrimitiveType["BOOL"] = makePrimitiveType(BOOL_BITMASK, 1, 1, 0)] = "BOOL";
    PBPrimitiveType[PBPrimitiveType["BVEC2"] = makePrimitiveType(BOOL_BITMASK, 1, 2, 0)] = "BVEC2";
    PBPrimitiveType[PBPrimitiveType["BVEC3"] = makePrimitiveType(BOOL_BITMASK, 1, 3, 0)] = "BVEC3";
    PBPrimitiveType[PBPrimitiveType["BVEC4"] = makePrimitiveType(BOOL_BITMASK, 1, 4, 0)] = "BVEC4";
    PBPrimitiveType[PBPrimitiveType["I8"] = makePrimitiveType(I8_BITMASK, 1, 1, 0)] = "I8";
    PBPrimitiveType[PBPrimitiveType["I8VEC2"] = makePrimitiveType(I8_BITMASK, 1, 2, 0)] = "I8VEC2";
    PBPrimitiveType[PBPrimitiveType["I8VEC3"] = makePrimitiveType(I8_BITMASK, 1, 3, 0)] = "I8VEC3";
    PBPrimitiveType[PBPrimitiveType["I8VEC4"] = makePrimitiveType(I8_BITMASK, 1, 4, 0)] = "I8VEC4";
    PBPrimitiveType[PBPrimitiveType["I8_NORM"] = makePrimitiveType(I8_BITMASK, 1, 1, 1)] = "I8_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC2_NORM"] = makePrimitiveType(I8_BITMASK, 1, 2, 1)] = "I8VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC3_NORM"] = makePrimitiveType(I8_BITMASK, 1, 3, 1)] = "I8VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC4_NORM"] = makePrimitiveType(I8_BITMASK, 1, 4, 1)] = "I8VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["I16"] = makePrimitiveType(I16_BITMASK, 1, 1, 0)] = "I16";
    PBPrimitiveType[PBPrimitiveType["I16VEC2"] = makePrimitiveType(I16_BITMASK, 1, 2, 0)] = "I16VEC2";
    PBPrimitiveType[PBPrimitiveType["I16VEC3"] = makePrimitiveType(I16_BITMASK, 1, 3, 0)] = "I16VEC3";
    PBPrimitiveType[PBPrimitiveType["I16VEC4"] = makePrimitiveType(I16_BITMASK, 1, 4, 0)] = "I16VEC4";
    PBPrimitiveType[PBPrimitiveType["I16_NORM"] = makePrimitiveType(I16_BITMASK, 1, 1, 1)] = "I16_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC2_NORM"] = makePrimitiveType(I16_BITMASK, 1, 2, 1)] = "I16VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC3_NORM"] = makePrimitiveType(I16_BITMASK, 1, 3, 1)] = "I16VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC4_NORM"] = makePrimitiveType(I16_BITMASK, 1, 4, 1)] = "I16VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["I32"] = makePrimitiveType(I32_BITMASK, 1, 1, 0)] = "I32";
    PBPrimitiveType[PBPrimitiveType["I32VEC2"] = makePrimitiveType(I32_BITMASK, 1, 2, 0)] = "I32VEC2";
    PBPrimitiveType[PBPrimitiveType["I32VEC3"] = makePrimitiveType(I32_BITMASK, 1, 3, 0)] = "I32VEC3";
    PBPrimitiveType[PBPrimitiveType["I32VEC4"] = makePrimitiveType(I32_BITMASK, 1, 4, 0)] = "I32VEC4";
    PBPrimitiveType[PBPrimitiveType["I32_NORM"] = makePrimitiveType(I32_BITMASK, 1, 1, 1)] = "I32_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC2_NORM"] = makePrimitiveType(I32_BITMASK, 1, 2, 1)] = "I32VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC3_NORM"] = makePrimitiveType(I32_BITMASK, 1, 3, 1)] = "I32VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC4_NORM"] = makePrimitiveType(I32_BITMASK, 1, 4, 1)] = "I32VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U8"] = makePrimitiveType(U8_BITMASK, 1, 1, 0)] = "U8";
    PBPrimitiveType[PBPrimitiveType["U8VEC2"] = makePrimitiveType(U8_BITMASK, 1, 2, 0)] = "U8VEC2";
    PBPrimitiveType[PBPrimitiveType["U8VEC3"] = makePrimitiveType(U8_BITMASK, 1, 3, 0)] = "U8VEC3";
    PBPrimitiveType[PBPrimitiveType["U8VEC4"] = makePrimitiveType(U8_BITMASK, 1, 4, 0)] = "U8VEC4";
    PBPrimitiveType[PBPrimitiveType["U8_NORM"] = makePrimitiveType(U8_BITMASK, 1, 1, 1)] = "U8_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC2_NORM"] = makePrimitiveType(U8_BITMASK, 1, 2, 1)] = "U8VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC3_NORM"] = makePrimitiveType(U8_BITMASK, 1, 3, 1)] = "U8VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC4_NORM"] = makePrimitiveType(U8_BITMASK, 1, 4, 1)] = "U8VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U16"] = makePrimitiveType(U16_BITMASK, 1, 1, 0)] = "U16";
    PBPrimitiveType[PBPrimitiveType["U16VEC2"] = makePrimitiveType(U16_BITMASK, 1, 2, 0)] = "U16VEC2";
    PBPrimitiveType[PBPrimitiveType["U16VEC3"] = makePrimitiveType(U16_BITMASK, 1, 3, 0)] = "U16VEC3";
    PBPrimitiveType[PBPrimitiveType["U16VEC4"] = makePrimitiveType(U16_BITMASK, 1, 4, 0)] = "U16VEC4";
    PBPrimitiveType[PBPrimitiveType["U16_NORM"] = makePrimitiveType(U16_BITMASK, 1, 1, 1)] = "U16_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC2_NORM"] = makePrimitiveType(U16_BITMASK, 1, 2, 1)] = "U16VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC3_NORM"] = makePrimitiveType(U16_BITMASK, 1, 3, 1)] = "U16VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC4_NORM"] = makePrimitiveType(U16_BITMASK, 1, 4, 1)] = "U16VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U32"] = makePrimitiveType(U32_BITMASK, 1, 1, 0)] = "U32";
    PBPrimitiveType[PBPrimitiveType["U32VEC2"] = makePrimitiveType(U32_BITMASK, 1, 2, 0)] = "U32VEC2";
    PBPrimitiveType[PBPrimitiveType["U32VEC3"] = makePrimitiveType(U32_BITMASK, 1, 3, 0)] = "U32VEC3";
    PBPrimitiveType[PBPrimitiveType["U32VEC4"] = makePrimitiveType(U32_BITMASK, 1, 4, 0)] = "U32VEC4";
    PBPrimitiveType[PBPrimitiveType["U32_NORM"] = makePrimitiveType(U32_BITMASK, 1, 1, 1)] = "U32_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC2_NORM"] = makePrimitiveType(U32_BITMASK, 1, 2, 1)] = "U32VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC3_NORM"] = makePrimitiveType(U32_BITMASK, 1, 3, 1)] = "U32VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC4_NORM"] = makePrimitiveType(U32_BITMASK, 1, 4, 1)] = "U32VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["MAT2"] = makePrimitiveType(F32_BITMASK, 2, 2, 0)] = "MAT2";
    PBPrimitiveType[PBPrimitiveType["MAT2x3"] = makePrimitiveType(F32_BITMASK, 2, 3, 0)] = "MAT2x3";
    PBPrimitiveType[PBPrimitiveType["MAT2x4"] = makePrimitiveType(F32_BITMASK, 2, 4, 0)] = "MAT2x4";
    PBPrimitiveType[PBPrimitiveType["MAT3x2"] = makePrimitiveType(F32_BITMASK, 3, 2, 0)] = "MAT3x2";
    PBPrimitiveType[PBPrimitiveType["MAT3"] = makePrimitiveType(F32_BITMASK, 3, 3, 0)] = "MAT3";
    PBPrimitiveType[PBPrimitiveType["MAT3x4"] = makePrimitiveType(F32_BITMASK, 3, 4, 0)] = "MAT3x4";
    PBPrimitiveType[PBPrimitiveType["MAT4x2"] = makePrimitiveType(F32_BITMASK, 4, 2, 0)] = "MAT4x2";
    PBPrimitiveType[PBPrimitiveType["MAT4x3"] = makePrimitiveType(F32_BITMASK, 4, 3, 0)] = "MAT4x3";
    PBPrimitiveType[PBPrimitiveType["MAT4"] = makePrimitiveType(F32_BITMASK, 4, 4, 0)] = "MAT4";
    return PBPrimitiveType;
}({});
const primitiveTypeMapWebGL = {
    [PBPrimitiveType.F32]: 'float',
    [PBPrimitiveType.F32VEC2]: 'vec2',
    [PBPrimitiveType.F32VEC3]: 'vec3',
    [PBPrimitiveType.F32VEC4]: 'vec4',
    [PBPrimitiveType.BOOL]: 'bool',
    [PBPrimitiveType.BVEC2]: 'bvec2',
    [PBPrimitiveType.BVEC3]: 'bvec3',
    [PBPrimitiveType.BVEC4]: 'bvec4',
    [PBPrimitiveType.I32]: 'int',
    [PBPrimitiveType.I32VEC2]: 'ivec2',
    [PBPrimitiveType.I32VEC3]: 'ivec3',
    [PBPrimitiveType.I32VEC4]: 'ivec4',
    [PBPrimitiveType.U32]: 'uint',
    [PBPrimitiveType.U32VEC2]: 'uvec2',
    [PBPrimitiveType.U32VEC3]: 'uvec3',
    [PBPrimitiveType.U32VEC4]: 'uvec4',
    [PBPrimitiveType.MAT2]: 'mat2',
    [PBPrimitiveType.MAT2x3]: 'mat2x3',
    [PBPrimitiveType.MAT2x4]: 'mat2x4',
    [PBPrimitiveType.MAT3x2]: 'mat3x2',
    [PBPrimitiveType.MAT3]: 'mat3',
    [PBPrimitiveType.MAT3x4]: 'mat3x4',
    [PBPrimitiveType.MAT4x2]: 'mat4x2',
    [PBPrimitiveType.MAT4x3]: 'mat4x3',
    [PBPrimitiveType.MAT4]: 'mat4'
};
const primitiveTypeMapWGSL = {
    [PBPrimitiveType.F32]: 'f32',
    [PBPrimitiveType.F32VEC2]: 'vec2<f32>',
    [PBPrimitiveType.F32VEC3]: 'vec3<f32>',
    [PBPrimitiveType.F32VEC4]: 'vec4<f32>',
    [PBPrimitiveType.BOOL]: 'bool',
    [PBPrimitiveType.BVEC2]: 'vec2<bool>',
    [PBPrimitiveType.BVEC3]: 'vec3<bool>',
    [PBPrimitiveType.BVEC4]: 'vec4<bool>',
    [PBPrimitiveType.I32]: 'i32',
    [PBPrimitiveType.I32VEC2]: 'vec2<i32>',
    [PBPrimitiveType.I32VEC3]: 'vec3<i32>',
    [PBPrimitiveType.I32VEC4]: 'vec4<i32>',
    [PBPrimitiveType.U32]: 'u32',
    [PBPrimitiveType.U32VEC2]: 'vec2<u32>',
    [PBPrimitiveType.U32VEC3]: 'vec3<u32>',
    [PBPrimitiveType.U32VEC4]: 'vec4<u32>',
    [PBPrimitiveType.MAT2]: 'mat2x2<f32>',
    [PBPrimitiveType.MAT2x3]: 'mat2x3<f32>',
    [PBPrimitiveType.MAT2x4]: 'mat2x4<f32>',
    [PBPrimitiveType.MAT3x2]: 'mat3x2<f32>',
    [PBPrimitiveType.MAT3]: 'mat3x3<f32>',
    [PBPrimitiveType.MAT3x4]: 'mat3x4<f32>',
    [PBPrimitiveType.MAT4x2]: 'mat4x2<f32>',
    [PBPrimitiveType.MAT4x3]: 'mat4x3<f32>',
    [PBPrimitiveType.MAT4]: 'mat4x4<f32>'
};
const BITFLAG_1D = 1 << 0;
const BITFLAG_2D = 1 << 1;
const BITFLAG_3D = 1 << 2;
const BITFLAG_CUBE = 1 << 3;
const BITFLAG_ARRAY = 1 << 4;
const BITFLAG_MULTISAMPLED = 1 << 5;
const BITFLAG_STORAGE = 1 << 6;
const BITFLAG_DEPTH = 1 << 7;
const BITFLAG_FLOAT = 1 << 8;
const BITFLAG_INT = 1 << 9;
const BITFLAG_UINT = 1 << 10;
const BITFLAG_EXTERNAL = 1 << 11;
/**
 * Texture types
 * @public
 */ var PBTextureType = /*#__PURE__*/ function(PBTextureType) {
    PBTextureType[PBTextureType["TEX_1D"] = BITFLAG_1D | BITFLAG_FLOAT] = "TEX_1D";
    PBTextureType[PBTextureType["ITEX_1D"] = BITFLAG_1D | BITFLAG_INT] = "ITEX_1D";
    PBTextureType[PBTextureType["UTEX_1D"] = BITFLAG_1D | BITFLAG_UINT] = "UTEX_1D";
    PBTextureType[PBTextureType["TEX_2D"] = BITFLAG_2D | BITFLAG_FLOAT] = "TEX_2D";
    PBTextureType[PBTextureType["ITEX_2D"] = BITFLAG_2D | BITFLAG_INT] = "ITEX_2D";
    PBTextureType[PBTextureType["UTEX_2D"] = BITFLAG_2D | BITFLAG_UINT] = "UTEX_2D";
    PBTextureType[PBTextureType["TEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_ARRAY] = "TEX_2D_ARRAY";
    PBTextureType[PBTextureType["ITEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_INT | BITFLAG_ARRAY] = "ITEX_2D_ARRAY";
    PBTextureType[PBTextureType["UTEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_UINT | BITFLAG_ARRAY] = "UTEX_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_3D"] = BITFLAG_3D | BITFLAG_FLOAT] = "TEX_3D";
    PBTextureType[PBTextureType["ITEX_3D"] = BITFLAG_3D | BITFLAG_INT] = "ITEX_3D";
    PBTextureType[PBTextureType["UTEX_3D"] = BITFLAG_3D | BITFLAG_UINT] = "UTEX_3D";
    PBTextureType[PBTextureType["TEX_CUBE"] = BITFLAG_CUBE | BITFLAG_FLOAT] = "TEX_CUBE";
    PBTextureType[PBTextureType["ITEX_CUBE"] = BITFLAG_CUBE | BITFLAG_INT] = "ITEX_CUBE";
    PBTextureType[PBTextureType["UTEX_CUBE"] = BITFLAG_CUBE | BITFLAG_UINT] = "UTEX_CUBE";
    PBTextureType[PBTextureType["TEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_FLOAT | BITFLAG_ARRAY] = "TEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["ITEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_INT | BITFLAG_ARRAY] = "ITEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["UTEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_UINT | BITFLAG_ARRAY] = "UTEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["TEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_MULTISAMPLED] = "TEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["ITEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_INT | BITFLAG_MULTISAMPLED] = "ITEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["UTEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_UINT | BITFLAG_MULTISAMPLED] = "UTEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["TEX_STORAGE_1D"] = BITFLAG_1D | BITFLAG_STORAGE] = "TEX_STORAGE_1D";
    PBTextureType[PBTextureType["TEX_STORAGE_2D"] = BITFLAG_2D | BITFLAG_STORAGE] = "TEX_STORAGE_2D";
    PBTextureType[PBTextureType["TEX_STORAGE_2D_ARRAY"] = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_STORAGE] = "TEX_STORAGE_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_STORAGE_3D"] = BITFLAG_3D | BITFLAG_STORAGE] = "TEX_STORAGE_3D";
    PBTextureType[PBTextureType["TEX_DEPTH_2D"] = BITFLAG_2D | BITFLAG_DEPTH] = "TEX_DEPTH_2D";
    PBTextureType[PBTextureType["TEX_DEPTH_2D_ARRAY"] = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_DEPTH] = "TEX_DEPTH_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_DEPTH_CUBE"] = BITFLAG_CUBE | BITFLAG_DEPTH] = "TEX_DEPTH_CUBE";
    PBTextureType[PBTextureType["TEX_DEPTH_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_ARRAY | BITFLAG_DEPTH] = "TEX_DEPTH_CUBE_ARRAY";
    PBTextureType[PBTextureType["TEX_DEPTH_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_MULTISAMPLED | BITFLAG_DEPTH] = "TEX_DEPTH_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["TEX_EXTERNAL"] = BITFLAG_EXTERNAL] = "TEX_EXTERNAL";
    return PBTextureType;
}({});
const textureTypeMapWebGL = {
    [PBTextureType.TEX_1D]: 'highp sampler2D',
    [PBTextureType.TEX_2D]: 'highp sampler2D',
    [PBTextureType.TEX_CUBE]: 'highp samplerCube',
    [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};
const textureTypeMapWebGL2 = {
    [PBTextureType.TEX_1D]: 'highp sampler2D',
    [PBTextureType.TEX_2D]: 'highp sampler2D',
    [PBTextureType.ITEX_1D]: 'highp isampler2D',
    [PBTextureType.ITEX_2D]: 'highp isampler2D',
    [PBTextureType.UTEX_1D]: 'highp usampler2D',
    [PBTextureType.UTEX_2D]: 'highp usampler2D',
    [PBTextureType.TEX_2D_ARRAY]: 'highp sampler2DArray',
    [PBTextureType.ITEX_2D_ARRAY]: 'highp isampler2DArray',
    [PBTextureType.UTEX_2D_ARRAY]: 'highp usampler2DArray',
    [PBTextureType.TEX_3D]: 'highp sampler3D',
    [PBTextureType.ITEX_3D]: 'highp isampler3D',
    [PBTextureType.UTEX_3D]: 'highp usampler3D',
    [PBTextureType.TEX_CUBE]: 'highp samplerCube',
    [PBTextureType.ITEX_CUBE]: 'highp isamplerCube',
    [PBTextureType.UTEX_CUBE]: 'highp usamplerCube',
    [PBTextureType.TEX_DEPTH_2D]: 'highp sampler2DShadow',
    [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'highp sampler2DArrayShadow',
    [PBTextureType.TEX_DEPTH_CUBE]: 'highp samplerCubeShadow',
    [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};
const textureTypeMapWGSL = {
    [PBTextureType.TEX_1D]: 'texture_1d<f32>',
    [PBTextureType.ITEX_1D]: 'texture_1d<i32>',
    [PBTextureType.UTEX_1D]: 'texture_1d<u32>',
    [PBTextureType.TEX_2D]: 'texture_2d<f32>',
    [PBTextureType.ITEX_2D]: 'texture_2d<i32>',
    [PBTextureType.UTEX_2D]: 'texture_2d<u32>',
    [PBTextureType.TEX_2D_ARRAY]: 'texture_2d_array<f32>',
    [PBTextureType.ITEX_2D_ARRAY]: 'texture_2d_array<i32>',
    [PBTextureType.UTEX_2D_ARRAY]: 'texture_2d_array<u32>',
    [PBTextureType.TEX_3D]: 'texture_3d<f32>',
    [PBTextureType.ITEX_3D]: 'texture_3d<i32>',
    [PBTextureType.UTEX_3D]: 'texture_3d<u32>',
    [PBTextureType.TEX_CUBE]: 'texture_cube<f32>',
    [PBTextureType.ITEX_CUBE]: 'texture_cube<i32>',
    [PBTextureType.UTEX_CUBE]: 'texture_cube<u32>',
    [PBTextureType.TEX_CUBE_ARRAY]: 'texture_cube_array<f32>',
    [PBTextureType.ITEX_CUBE_ARRAY]: 'texture_cube_array<i32>',
    [PBTextureType.UTEX_CUBE_ARRAY]: 'texture_cube_array<u32>',
    [PBTextureType.TEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<f32>',
    [PBTextureType.ITEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<i32>',
    [PBTextureType.UTEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<u32>',
    [PBTextureType.TEX_STORAGE_1D]: 'texture_storage_1d',
    [PBTextureType.TEX_STORAGE_2D]: 'texture_storage_2d',
    [PBTextureType.TEX_STORAGE_2D_ARRAY]: 'texture_storage_2d_array',
    [PBTextureType.TEX_STORAGE_3D]: 'texture_storage_3d',
    [PBTextureType.TEX_DEPTH_2D]: 'texture_depth_2d',
    [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'texture_depth_2d_array',
    [PBTextureType.TEX_DEPTH_CUBE]: 'texture_depth_cube',
    [PBTextureType.TEX_DEPTH_CUBE_ARRAY]: 'texture_depth_cube_array',
    [PBTextureType.TEX_DEPTH_MULTISAMPLED_2D]: 'texture_depth_multisampled_2d',
    [PBTextureType.TEX_EXTERNAL]: 'texture_external'
};
const storageTexelFormatMap = {
    rgba8unorm: 'rgba8unorm',
    rgba8snorm: 'rgba8snorm',
    bgra8unorm: 'bgra8unorm',
    rgba8ui: 'rgba8uint',
    rgba8i: 'rgba8sint',
    rgba16ui: 'rgba16uint',
    rgba16i: 'rgba16sint',
    rgba16f: 'rgba16float',
    r32f: 'r32float',
    r32ui: 'r32uint',
    r32i: 'r32sint',
    rg32f: 'rg32float',
    rg32ui: 'rg32uint',
    rg32i: 'rg32sint',
    rgba32f: 'rgba32float',
    rgba32ui: 'rgba32uint',
    rgba32i: 'rgba32sint'
};
/**
 * Sampler access mode
 * @public
 */ var PBSamplerAccessMode = /*#__PURE__*/ function(PBSamplerAccessMode) {
    PBSamplerAccessMode[PBSamplerAccessMode["UNKNOWN"] = 0] = "UNKNOWN";
    PBSamplerAccessMode[PBSamplerAccessMode["SAMPLE"] = 1] = "SAMPLE";
    PBSamplerAccessMode[PBSamplerAccessMode["COMPARISON"] = 2] = "COMPARISON";
    return PBSamplerAccessMode;
}({});
/**
 * Shader variable address space
 * @public
 */ var PBAddressSpace = /*#__PURE__*/ function(PBAddressSpace) {
    PBAddressSpace["UNKNOWN"] = "unknown";
    PBAddressSpace["FUNCTION"] = "function";
    PBAddressSpace["PRIVATE"] = "private";
    PBAddressSpace["WORKGROUP"] = "workgroup";
    PBAddressSpace["UNIFORM"] = "uniform";
    PBAddressSpace["STORAGE"] = "storage";
    return PBAddressSpace;
}({});
/**
 * Abstract base class for any type
 * @public
 */ class PBTypeInfo {
    /** @internal */ cls;
    /** @internal */ detail;
    /** @internal */ id;
    /** @internal */ constructor(cls, detail){
        this.cls = cls;
        this.detail = detail;
        this.id = null;
    }
    /** Get unique id for this type */ get typeId() {
        if (!this.id) {
            this.id = this.genTypeId();
        }
        return this.id;
    }
    /** returns true if this is a void type */ isVoidType() {
        return false;
    }
    /** returns true if this is an any type */ isAnyType() {
        return false;
    }
    /** returns true if this is a primitive type */ isPrimitiveType() {
        return false;
    }
    /** Wether this type have atomic members */ haveAtomicMembers() {
        return false;
    }
    /** returns true if this is a struct type */ isStructType() {
        return false;
    }
    /** returns true if this is an array type */ isArrayType() {
        return false;
    }
    /** returns true if this is a pointer type */ isPointerType() {
        return false;
    }
    /** returns true if this is an atomic int type */ isAtomicI32() {
        return false;
    }
    /** returns true if this is an atomic uint type */ isAtomicU32() {
        return false;
    }
    /** returns true if this is a sampler type */ isSamplerType() {
        return false;
    }
    /** returns true if this is a texture type */ isTextureType() {
        return false;
    }
    /** @internal */ isHostSharable() {
        return false;
    }
    /** @internal */ isConstructible() {
        return false;
    }
    /** @internal */ isStorable() {
        return false;
    }
    /** @internal */ getConstructorOverloads(_deviceType) {
        return [];
    }
    /**
   * Check whether a given type is compatible with this type
   * @param other - The type to be checked
   * @returns true if the given type is compatible with this type, othewise false
   */ isCompatibleType(other) {
        return other.typeId === this.typeId;
    }
}
/**
 * The void type info
 * @public
 */ class PBVoidTypeInfo extends PBTypeInfo {
    constructor(){
        super(9, null);
    }
    /** {@inheritDoc PBTypeInfo.isVoidType} */ isVoidType() {
        return true;
    }
    /** @internal */ toTypeName() {
        return 'void';
    }
    /** @internal */ genTypeId() {
        return 'void';
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
}
/**
 * The void type info
 * @public
 */ class PBAnyTypeInfo extends PBTypeInfo {
    constructor(){
        super(10, null);
    }
    /** {@inheritDoc PBTypeInfo.isAnyType} */ isAnyType() {
        return true;
    }
    /** @internal */ toTypeName() {
        return 'any';
    }
    /** @internal */ genTypeId() {
        return 'any';
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** {@inheritDoc PBTypeInfo.isCompatibleType} */ isCompatibleType(_other) {
        return true;
    }
}
/**
 * The primitive type info
 * @public
 */ class PBPrimitiveTypeInfo extends PBTypeInfo {
    /** @internal */ static cachedTypes = {};
    /** @internal */ static cachedCtorOverloads = {};
    constructor(type){
        super(1, {
            primitiveType: type
        });
    }
    /** Get or create a PBPrimitiveTypeInfo instance for a given prmitive type */ static getCachedTypeInfo(primitiveType) {
        let typeinfo = this.cachedTypes[primitiveType];
        if (!typeinfo) {
            typeinfo = new PBPrimitiveTypeInfo(primitiveType);
            this.cachedTypes[primitiveType] = typeinfo;
        }
        return typeinfo;
    }
    /** @internal */ static getCachedOverloads(deviceType, primitiveType) {
        let deviceOverloads = this.cachedCtorOverloads[deviceType];
        if (!deviceOverloads) {
            deviceOverloads = {};
            this.cachedCtorOverloads[deviceType] = deviceOverloads;
        }
        let result = deviceOverloads[primitiveType];
        if (!result) {
            const typeinfo = this.getCachedTypeInfo(primitiveType);
            const name = typeinfo.toTypeName(deviceType);
            result = [
                new PBFunctionTypeInfo(name, typeinfo, [])
            ];
            if (typeinfo.isScalarType()) {
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.F32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.I32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.U32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.BOOL)
                    }
                ]));
            } else if (typeinfo.isVectorType()) {
                const scalarTypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.scalarType)
                };
                const vec2TypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.resizeType(1, 2))
                };
                const vec3TypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.resizeType(1, 3))
                };
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    scalarTypeInfo
                ]));
                switch(typeinfo.cols){
                    case 2:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec2
                            }
                        ]));
                        break;
                    case 3:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec3
                            }
                        ]));
                        break;
                    case 4:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec2TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec3TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec3TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec4
                            }
                        ]));
                }
            } else if (typeinfo.isMatrixType()) {
                const colType = this.getCachedTypeInfo(typeinfo.resizeType(1, typeinfo.cols));
                result.push(new PBFunctionTypeInfo(name, typeinfo, Array.from({
                    length: typeinfo.rows
                }).map(()=>({
                        type: colType
                    }))));
                result.push(new PBFunctionTypeInfo(name, typeinfo, Array.from({
                    length: typeinfo.rows * typeinfo.cols
                }).map(()=>({
                        type: typeF32
                    }))));
            }
            deviceOverloads[primitiveType] = result;
        }
        return result;
    }
    /** Get the primitive type */ get primitiveType() {
        return this.detail.primitiveType;
    }
    /** Whether the type is signed or unsigned integer scalar or vector */ isInteger() {
        const st = this.primitiveType & SCALAR_TYPE_BITMASK;
        return st === I8_BITMASK || st === U8_BITMASK || st === I16_BITMASK || st === U16_BITMASK || st === I32_BITMASK || st === U32_BITMASK;
    }
    /** Get the scalar type */ get scalarType() {
        return this.resizeType(1, 1);
    }
    /** Get number of rows */ get rows() {
        return this.primitiveType >> ROWS_BITSHIFT & ROWS_BITMASK;
    }
    /** Get number of columns */ get cols() {
        return this.primitiveType >> COLS_BITSHIFT & COLS_BITMASK;
    }
    /** Get if this is a normalized primitive type */ get normalized() {
        return !!(this.primitiveType >> NORM_BITSHIFT & NORM_BITMASK);
    }
    /** @internal */ getLayoutAlignment(layout) {
        return layout === 'packed' ? 1 : this.isScalarType() ? 4 : 1 << Math.min(4, this.cols + 1);
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        let scalarSize;
        switch(this.scalarType){
            case PBPrimitiveType.BOOL:
            case PBPrimitiveType.I32:
            case PBPrimitiveType.I32_NORM:
            case PBPrimitiveType.U32:
            case PBPrimitiveType.U32_NORM:
            case PBPrimitiveType.F32:
                scalarSize = 4;
                break;
            case PBPrimitiveType.F16:
            case PBPrimitiveType.I16:
            case PBPrimitiveType.I16_NORM:
            case PBPrimitiveType.U16:
            case PBPrimitiveType.U16_NORM:
                scalarSize = 2;
                break;
            default:
                scalarSize = 1;
                break;
        }
        return scalarSize * this.cols * this.rows;
    }
    /**
   * Creates a new primitive type info by changing row and column of this type
   * @param rows - The new value of row
   * @param cols - The new value of column
   * @returns The new primitive type
   */ resizeType(rows, cols) {
        return makePrimitiveType(this.primitiveType & SCALAR_TYPE_BITMASK, rows, cols, this.normalized ? 1 : 0);
    }
    /** Returns true if this is a scalar type */ isScalarType() {
        return this.rows === 1 && this.cols === 1;
    }
    /** Returns true if this is a vector type */ isVectorType() {
        return this.rows === 1 && this.cols > 1;
    }
    /** Returns true if this is a matrix type */ isMatrixType() {
        return this.rows > 1 && this.cols > 1;
    }
    /** {@inheritDoc PBTypeInfo.isPrimitiveType} */ isPrimitiveType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.scalarType !== PBPrimitiveType.BOOL;
    }
    /** @internal */ isConstructible() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads(deviceType) {
        return PBPrimitiveTypeInfo.getCachedOverloads(deviceType, this.primitiveType);
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = primitiveTypeMapWGSL[this.primitiveType];
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            const typename = primitiveTypeMapWebGL[this.primitiveType];
            return varName ? `${typename} ${varName}` : typename;
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `PRIM:${this.primitiveType}`;
    }
}
/**
 * The struct type info
 * @public
 */ class PBStructTypeInfo extends PBTypeInfo {
    constructor(name, layout, members){
        super(1, {
            layout: layout || 'default',
            structName: name,
            structMembers: members.map((val)=>{
                const defaultAlignment = getAlignment(val.type);
                const defaultSize = getSize(val.type);
                return {
                    name: val.name,
                    type: val.type,
                    alignment: defaultAlignment,
                    size: defaultSize,
                    defaultAlignment: defaultAlignment,
                    defaultSize: defaultSize
                };
            })
        });
        if (this.layout === 'std140') {
            this.calcAlignmentAndSizeSTD140();
        } else if (this.layout === 'std430') {
            this.calcAlignmentAndSizePacked();
        }
    }
    /** Get the layout type */ get layout() {
        return this.detail.layout;
    }
    /** Get name of the struct type */ get structName() {
        return this.detail.structName;
    }
    set structName(val) {
        this.detail.structName = val;
    }
    /** Get member types of the struct type */ get structMembers() {
        return this.detail.structMembers;
    }
    /** Whether this struct has atomic members */ haveAtomicMembers() {
        for (const member of this.structMembers){
            if (member.type.isStructType() && member.type.haveAtomicMembers()) {
                return true;
            } else if (member.type.isArrayType() && member.type.haveAtomicMembers()) {
                return true;
            } else {
                return member.type.isAtomicI32() || member.type.isAtomicU32();
            }
        }
        return false;
    }
    /**
   * Creates a new struct type by extending this type
   * @param name - Name of the new struct type
   * @param members - additional struct members
   * @returns The new struct type
   */ extends(name, members) {
        const oldMembers = this.structMembers.map((member)=>({
                name: member.name,
                type: member.type
            }));
        return new PBStructTypeInfo(name, this.layout, [
            ...oldMembers,
            ...members
        ]);
    }
    /** {@inheritDoc PBTypeInfo.isStructType} */ isStructType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.detail.structMembers.every((val)=>val.type.isHostSharable());
    }
    /** @internal */ isConstructible() {
        return this.detail.structMembers.every((val)=>val.type.isConstructible());
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads() {
        const result = [
            new PBFunctionTypeInfo(this.structName, this, [])
        ];
        if (this.isConstructible()) {
            result.push(new PBFunctionTypeInfo(this.structName, this, this.structMembers.map((val)=>({
                    type: val.type
                }))));
        }
        return result;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            return varName ? `${varName}: ${this.structName}` : this.structName;
        } else {
            return varName ? `${this.structName} ${varName}` : this.structName;
        }
    }
    /** @internal */ getLayoutAlignment(layout) {
        if (layout === 'packed') {
            return 1;
        }
        let alignment = 0;
        for (const member of this.structMembers){
            alignment = Math.max(alignment, member.type.getLayoutAlignment(layout));
        }
        if (layout === 'std140') {
            alignment = align(alignment, 16);
        }
        return alignment;
    }
    /** @internal */ getLayoutSize(layout) {
        let size = 0;
        let structAlignment = 0;
        for (const member of this.structMembers){
            const memberAlignment = member.type.getLayoutAlignment(layout);
            size = align(size, memberAlignment);
            size += member.type.getLayoutSize(layout);
            structAlignment = Math.max(structAlignment, memberAlignment);
        }
        return align(size, structAlignment);
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset, layout) {
        const bufferLayout = {
            byteSize: 0,
            entries: []
        };
        const start = offset;
        for (const member of this.structMembers){
            offset = align(offset, member.type.getLayoutAlignment(layout));
            const size = member.type.getLayoutSize(layout);
            bufferLayout.entries.push({
                name: member.name,
                offset: offset,
                byteSize: size,
                type: typeToTypedArray(member.type),
                subLayout: member.type.isStructType() ? member.type.toBufferLayout(offset, layout) : null,
                arraySize: member.type.isArrayType() ? member.type.dimension : 0
            });
            offset += size;
        }
        bufferLayout.byteSize = layout === 'std140' ? align(offset - start, 16) : offset - start;
        return bufferLayout;
    }
    /** @internal */ clone(newName) {
        return new PBStructTypeInfo(newName || this.structName, this.layout, this.structMembers);
    }
    /** @internal */ reset(name, layout, members) {
        this.detail = {
            layout: layout || 'default',
            structName: name,
            structMembers: members.map((val)=>{
                const defaultAlignment = getAlignment(val.type);
                const defaultSize = getSize(val.type);
                return {
                    name: val.name,
                    type: val.type,
                    alignment: defaultAlignment,
                    size: defaultSize,
                    defaultAlignment: defaultAlignment,
                    defaultSize: defaultSize
                };
            })
        };
        if (this.layout === 'std140') {
            this.calcAlignmentAndSizeSTD140();
        } else if (this.layout === 'std430') {
            this.calcAlignmentAndSizePacked();
        }
        this.id = null;
    }
    /** @internal */ genTypeId() {
        return `STRUCT:${this.structName}:${this.layout}:${this.structMembers.map((val)=>`${val.name}(${val.type.typeId})`).join(':')}`;
    }
    /** @internal */ calcAlignmentAndSizeSTD140() {
        for (const member of this.structMembers){
            if (member.type.isPrimitiveType()) {
                if (member.type.isMatrixType() && member.type.cols === 2) {
                    throw new Error(`matrix${member.type.rows}x${member.type.cols} can not be used in std140 layout`);
                }
            } else if (member.type.isArrayType() && (member.type.elementType.isAnyType() || getAlignment(member.type.elementType) !== 16)) {
                throw new Error('array element must be 16 bytes aligned in std140 layout');
            } else if (member.type.isStructType()) {
                member.alignment = 16;
                member.size = align(member.defaultSize, 16);
            }
        }
    }
    /** @internal */ calcAlignmentAndSizePacked() {
        for (const member of this.structMembers){
            member.alignment = getAlignmentPacked();
            member.size = getSizePacked(member.type);
        }
    }
}
/**
 * The array type info
 * @public
 */ class PBArrayTypeInfo extends PBTypeInfo {
    constructor(elementType, dimension){
        super(2, {
            elementType: elementType,
            dimension: Number(dimension) || 0
        });
    }
    /** Get the element type */ get elementType() {
        return this.detail.elementType;
    }
    /** Get dimension of the array type */ get dimension() {
        return this.detail.dimension;
    }
    /** Wether array have atomic members */ haveAtomicMembers() {
        if (this.elementType.isStructType() || this.elementType.isArrayType()) {
            return this.elementType.haveAtomicMembers();
        } else {
            return this.elementType.isAtomicI32() || this.elementType.isAtomicU32();
        }
    }
    /** {@inheritDoc PBTypeInfo.isArrayType} */ isArrayType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.detail.elementType.isHostSharable();
    }
    /** @internal */ isConstructible() {
        return !!this.dimension && this.detail.elementType.isConstructible();
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads(deviceType) {
        const name = this.toTypeName(deviceType);
        const result = [
            new PBFunctionTypeInfo(name, this, [])
        ];
        if (deviceType !== 'webgl' && this.isConstructible()) {
            result.push(new PBFunctionTypeInfo(name, this, Array.from({
                length: this.dimension
            }).map(()=>({
                    type: this.elementType
                }))));
        }
        return result;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const elementTypeName = this.elementType.toTypeName(deviceType);
            const typename = `array<${elementTypeName}${this.dimension ? ', ' + this.dimension : ''}>`;
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            ASSERT(!!this.dimension, 'runtime-sized array not supported for webgl');
            ASSERT(!this.elementType.isArrayType(), 'multi-dimensional arrays not supported for webgl');
            const elementTypeName = this.elementType.toTypeName(deviceType, varName);
            return `${elementTypeName}[${this.dimension}]`;
        }
    }
    /** @internal */ getLayoutAlignment(layout) {
        return layout === 'packed' || this.elementType.isAnyType() ? 1 : layout === 'std430' ? this.elementType.getLayoutAlignment(layout) : align(this.elementType.getLayoutAlignment(layout), 16);
    }
    /** @internal */ getLayoutSize(layout) {
        const elementAlignment = this.elementType.isAnyType() ? 1 : this.elementType.getLayoutAlignment(layout);
        if (layout === 'std140' && !!(elementAlignment & 15)) {
            // array element stride of std140 layout must be multiple of 16
            throw new Error('Error: array element stride of std140 must be multiple of 16');
        }
        return this.elementType.isAnyType() ? 0 : this.dimension * align(this.elementType.getLayoutSize(layout), elementAlignment);
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    isCompatibleType(other) {
        if (!other.isArrayType()) {
            return false;
        }
        if (this.dimension !== 0 && other.dimension !== this.dimension) {
            return false;
        }
        return this.elementType.isCompatibleType(other.elementType);
    }
    /** @internal */ genTypeId() {
        return `ARRAY:(${this.elementType.typeId})[${this.dimension}]`;
    }
}
/**
 * The pointer type info
 * @public
 */ class PBPointerTypeInfo extends PBTypeInfo {
    /** @internal */ writable;
    constructor(pointerType, addressSpace){
        super(3, {
            pointerType,
            addressSpace
        });
        ASSERT(pointerType.isStorable(), 'the pointee type must be storable');
        this.writable = false;
    }
    /** Get type of the pointer */ get pointerType() {
        return this.detail.pointerType;
    }
    /** Get address space of the pointer */ get addressSpace() {
        return this.detail.addressSpace;
    }
    set addressSpace(val) {
        if (this.detail.addressSpace !== val) {
            this.detail.addressSpace = val;
            this.id = null;
        }
    }
    /** {@inheritDoc PBTypeInfo.haveAtomicMembers} */ haveAtomicMembers() {
        return this.pointerType.haveAtomicMembers();
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ isPointerType() {
        return true;
    }
    /** @internal */ toTypeName(device, varName) {
        if (device === 'webgpu') {
            const addressSpace = this.addressSpace === "unknown" ? "function" : this.addressSpace;
            /*
      const mode = addressSpace === PBAddressSpace.UNIFORM || (addressSpace === PBAddressSpace.STORAGE && !this.writable) ? 'read' : 'read_write'
      const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)}, ${mode}>`;
      */ /* WGSL spec:
        When writing a variable declaration or a pointer type in WGSL source:
        For the storage address space, the access mode is optional, and defaults to read.
        For other address spaces, the access mode must not be written.
      */ const mode = addressSpace === "storage" && this.writable ? ', read_write' : '';
            const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)} ${mode}>`;
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('pointer type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `PTR:(${this.pointerType.typeId})`;
    }
}
/**
 * The atomic int type info
 * @public
 */ class PBAtomicI32TypeInfo extends PBTypeInfo {
    constructor(){
        super(4, null);
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ haveAtomicMembers() {
        return true;
    }
    /** @internal */ isAtomicI32() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = 'atomic<i32>';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('atomic type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ getLayoutAlignment(_layout) {
        return 4;
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        return 4;
    }
    /** @internal */ genTypeId() {
        return `ATOMICI32`;
    }
}
/**
 * The atomic int type info
 * @public
 */ class PBAtomicU32TypeInfo extends PBTypeInfo {
    constructor(){
        super(5, null);
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ haveAtomicMembers() {
        return true;
    }
    /** @internal */ isAtomicU32() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = 'atomic<u32>';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('atomic type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ getLayoutAlignment(_layout) {
        return 4;
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        return 4;
    }
    /** @internal */ genTypeId() {
        return `ATOMICU32`;
    }
}
/**
 * The sampler type info
 * @public
 */ class PBSamplerTypeInfo extends PBTypeInfo {
    constructor(accessMode){
        super(7, {
            accessMode: accessMode
        });
    }
    /** Get the access mode */ get accessMode() {
        return this.detail.accessMode;
    }
    /** @internal */ isSamplerType() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = this.accessMode === 1 ? 'sampler' : 'sampler_comparison';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('sampler type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `SAMPLER:${this.accessMode}`;
    }
}
/**
 * The texture type info
 * @public
 */ class PBTextureTypeInfo extends PBTypeInfo {
    constructor(textureType, texelFormat, readable, writable){
        super(6, {
            textureType: textureType,
            readable: readable ?? false,
            writable: writable ?? false,
            storageTexelFormat: texelFormat ?? null
        });
        ASSERT(!!textureTypeMapWGSL[textureType], 'unsupported texture type');
        ASSERT(!(textureType & BITFLAG_STORAGE) || !!texelFormat && texelFormat in storageTexelFormatMap, `invalid texel format for storage texture: ${texelFormat}`);
    }
    /** Get the texture type */ get textureType() {
        return this.detail.textureType;
    }
    /** Get texture format if this is a storage texture */ get storageTexelFormat() {
        return this.detail.storageTexelFormat;
    }
    /** Returns true if this is a readable storage texture type */ get readable() {
        return this.detail.readable;
    }
    set readable(val) {
        this.detail.readable = !!val;
    }
    /** Returns true if this is a writable storage texture type */ get writable() {
        return this.detail.writable;
    }
    set writable(val) {
        this.detail.writable = !!val;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ is1DTexture() {
        return !!(this.detail.textureType & BITFLAG_1D);
    }
    /** Returns true if this is a 2D texture type */ is2DTexture() {
        return !!(this.detail.textureType & BITFLAG_2D);
    }
    /** Returns true if this is a 3D texture type */ is3DTexture() {
        return !!(this.detail.textureType & BITFLAG_3D);
    }
    /** Returns true if this is a cube texture type */ isCubeTexture() {
        return !!(this.detail.textureType & BITFLAG_CUBE);
    }
    /** Returns true if this is an array texture type */ isArrayTexture() {
        return !!(this.detail.textureType & BITFLAG_ARRAY);
    }
    /** Returns true if this is a storage texture type */ isStorageTexture() {
        return !!(this.detail.textureType & BITFLAG_STORAGE);
    }
    /** Return s true if this is a depth texture type */ isDepthTexture() {
        return !!(this.detail.textureType & BITFLAG_DEPTH);
    }
    /** Returns true if this is a multisampled texture type */ isMultisampledTexture() {
        return !!(this.detail.textureType & BITFLAG_MULTISAMPLED);
    }
    /** Returns true if this is an external texture type */ isExternalTexture() {
        return !!(this.detail.textureType & BITFLAG_EXTERNAL);
    }
    /** Returns true if the texture format is of type integer  */ isIntTexture() {
        return !!(this.detail.textureType & BITFLAG_INT);
    }
    /** Returns true if the texture format is of type unsigned integer  */ isUIntTexture() {
        return !!(this.detail.textureType & BITFLAG_UINT);
    }
    /** @internal */ isTextureType() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            let typename = textureTypeMapWGSL[this.textureType];
            if (this.isStorageTexture()) {
                const storageTexelFormat = storageTexelFormatMap[this.storageTexelFormat];
                // storage textures currently only support 'write' access control
                const accessMode = this.writable ? this.readable ? 'read_write' : 'write' : 'read'; // this.readable ? (this.writable ? 'read_write' : 'read') : 'write';
                typename = `${typename}<${storageTexelFormat}, ${accessMode}>`;
            }
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            const typename = deviceType === 'webgl' ? textureTypeMapWebGL[this.textureType] : textureTypeMapWebGL2[this.textureType];
            ASSERT(!!typename, 'unsupported texture type');
            return varName ? `${typename} ${varName}` : typename;
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `TEXTURE:${this.textureType}:${this.textureType & BITFLAG_STORAGE ? this.storageTexelFormat : ''}`;
    }
}
/**
 * The function type info
 * @public
 */ class PBFunctionTypeInfo extends PBTypeInfo {
    constructor(name, returnType, argTypes){
        super(8, {
            name,
            returnType,
            argTypes
        });
    }
    /** Get name of the function */ get name() {
        return this.detail.name;
    }
    /** Get return type of the function */ get returnType() {
        return this.detail.returnType;
    }
    /** Get all the argument types for this function */ get argTypes() {
        return this.detail.argTypes;
    }
    /** Get hash for parameter types */ get argHash() {
        return this.argTypes.map((val)=>val.type.typeId).join(',');
    }
    /** @internal */ genTypeId() {
        return `fn(${this.argHash}):${this.returnType.typeId}`;
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(_offset) {
        return null;
    }
    /** @internal */ toTypeName() {
        throw new Error('not supported');
    }
}
/** @internal */ const typeF16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16);
/** @internal */ const typeF16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC2);
/** @internal */ const typeF16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC3);
/** @internal */ const typeF16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC4);
/** @internal */ const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
/** @internal */ const typeF32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC2);
/** @internal */ const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
/** @internal */ const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
/** @internal */ const typeI8 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8);
/** @internal */ const typeI8Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2);
/** @internal */ const typeI8Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3);
/** @internal */ const typeI8Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4);
/** @internal */ const typeI8_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8_NORM);
/** @internal */ const typeI8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2_NORM);
/** @internal */ const typeI8Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3_NORM);
/** @internal */ const typeI8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4_NORM);
/** @internal */ const typeI16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16);
/** @internal */ const typeI16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2);
/** @internal */ const typeI16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3);
/** @internal */ const typeI16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4);
/** @internal */ const typeI16_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16_NORM);
/** @internal */ const typeI16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2_NORM);
/** @internal */ const typeI16Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3_NORM);
/** @internal */ const typeI16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4_NORM);
/** @internal */ const typeAtomicI32 = new PBAtomicI32TypeInfo();
/** @internal */ const typeAtomicU32 = new PBAtomicU32TypeInfo();
/** @internal */ const typeI32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */ const typeI32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2);
/** @internal */ const typeI32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3);
/** @internal */ const typeI32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4);
/** @internal */ const typeI32_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */ const typeI32Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2_NORM);
/** @internal */ const typeI32Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3_NORM);
/** @internal */ const typeI32Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4_NORM);
/** @internal */ const typeU8 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8);
/** @internal */ const typeU8Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2);
/** @internal */ const typeU8Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3);
/** @internal */ const typeU8Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4);
/** @internal */ const typeU8_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8_NORM);
/** @internal */ const typeU8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2_NORM);
/** @internal */ const typeU8Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3_NORM);
/** @internal */ const typeU8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4_NORM);
/** @internal */ const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
/** @internal */ const typeU16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2);
/** @internal */ const typeU16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3);
/** @internal */ const typeU16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4);
/** @internal */ const typeU16_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16_NORM);
/** @internal */ const typeU16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2_NORM);
/** @internal */ const typeU16Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3_NORM);
/** @internal */ const typeU16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4_NORM);
/** @internal */ const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
/** @internal */ const typeU32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2);
/** @internal */ const typeU32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3);
/** @internal */ const typeU32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4);
/** @internal */ const typeU32_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32_NORM);
/** @internal */ const typeU32Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2_NORM);
/** @internal */ const typeU32Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3_NORM);
/** @internal */ const typeU32Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4_NORM);
/** @internal */ const typeBool = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BOOL);
/** @internal */ const typeBVec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC2);
/** @internal */ const typeBVec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC3);
/** @internal */ const typeBVec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC4);
/** @internal */ const typeMat2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2);
/** @internal */ const typeMat2x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x3);
/** @internal */ const typeMat2x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x4);
/** @internal */ const typeMat3x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x2);
/** @internal */ const typeMat3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3);
/** @internal */ const typeMat3x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x4);
/** @internal */ const typeMat4x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x2);
/** @internal */ const typeMat4x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x3);
/** @internal */ const typeMat4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4);
/** @internal */ const typeTex1D = new PBTextureTypeInfo(PBTextureType.TEX_1D);
/** @internal */ const typeITex1D = new PBTextureTypeInfo(PBTextureType.ITEX_1D);
/** @internal */ const typeUTex1D = new PBTextureTypeInfo(PBTextureType.UTEX_1D);
/** @internal */ const typeTex2D = new PBTextureTypeInfo(PBTextureType.TEX_2D);
/** @internal */ const typeITex2D = new PBTextureTypeInfo(PBTextureType.ITEX_2D);
/** @internal */ const typeUTex2D = new PBTextureTypeInfo(PBTextureType.UTEX_2D);
/** @internal */ const typeTex2DArray = new PBTextureTypeInfo(PBTextureType.TEX_2D_ARRAY);
/** @internal */ const typeITex2DArray = new PBTextureTypeInfo(PBTextureType.ITEX_2D_ARRAY);
/** @internal */ const typeUTex2DArray = new PBTextureTypeInfo(PBTextureType.UTEX_2D_ARRAY);
/** @internal */ const typeTex3D = new PBTextureTypeInfo(PBTextureType.TEX_3D);
/** @internal */ const typeITex3D = new PBTextureTypeInfo(PBTextureType.ITEX_3D);
/** @internal */ const typeUTex3D = new PBTextureTypeInfo(PBTextureType.UTEX_3D);
/** @internal */ const typeTexCube = new PBTextureTypeInfo(PBTextureType.TEX_CUBE);
/** @internal */ const typeITexCube = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE);
/** @internal */ const typeUTexCube = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE);
/** @internal */ const typeTexExternal = new PBTextureTypeInfo(PBTextureType.TEX_EXTERNAL);
/** @internal */ const typeTexCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_CUBE_ARRAY);
/** @internal */ const typeITexCubeArray = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE_ARRAY);
/** @internal */ const typeUTexCubeArray = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE_ARRAY);
/** @internal */ const typeTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_MULTISAMPLED_2D);
/** @internal */ const typeITexMultisampled2D = new PBTextureTypeInfo(PBTextureType.ITEX_MULTISAMPLED_2D);
/** @internal */ const typeUTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.UTEX_MULTISAMPLED_2D);
/** @internal */ const typeTexStorage1D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */ const typeTexStorage1D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8snorm');
/** @internal */ const typeTexStorage1D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */ const typeTexStorage1D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8ui');
/** @internal */ const typeTexStorage1D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8i');
/** @internal */ const typeTexStorage1D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16ui');
/** @internal */ const typeTexStorage1D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16i');
/** @internal */ const typeTexStorage1D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16f');
/** @internal */ const typeTexStorage1D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32ui');
/** @internal */ const typeTexStorage1D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32i');
/** @internal */ const typeTexStorage1D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32f');
/** @internal */ const typeTexStorage1D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32ui');
/** @internal */ const typeTexStorage1D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32i');
/** @internal */ const typeTexStorage1D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32f');
/** @internal */ const typeTexStorage1D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32ui');
/** @internal */ const typeTexStorage1D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32i');
/** @internal */ const typeTexStorage1D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32f');
/** @internal */ const typeTexStorage2D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8unorm');
/** @internal */ const typeTexStorage2D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8snorm');
/** @internal */ const typeTexStorage2D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'bgra8unorm');
/** @internal */ const typeTexStorage2D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8ui');
/** @internal */ const typeTexStorage2D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8i');
/** @internal */ const typeTexStorage2D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16ui');
/** @internal */ const typeTexStorage2D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16i');
/** @internal */ const typeTexStorage2D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16f');
/** @internal */ const typeTexStorage2D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32ui');
/** @internal */ const typeTexStorage2D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32i');
/** @internal */ const typeTexStorage2D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32f');
/** @internal */ const typeTexStorage2D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32ui');
/** @internal */ const typeTexStorage2D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32i');
/** @internal */ const typeTexStorage2D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32f');
/** @internal */ const typeTexStorage2D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32ui');
/** @internal */ const typeTexStorage2D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32i');
/** @internal */ const typeTexStorage2D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32f');
/** @internal */ const typeTexStorage2DArray_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8unorm');
/** @internal */ const typeTexStorage2DArray_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8snorm');
/** @internal */ const typeTexStorage2DArray_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'bgra8unorm');
/** @internal */ const typeTexStorage2DArray_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8ui');
/** @internal */ const typeTexStorage2DArray_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8i');
/** @internal */ const typeTexStorage2DArray_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16ui');
/** @internal */ const typeTexStorage2DArray_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16i');
/** @internal */ const typeTexStorage2DArray_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16f');
/** @internal */ const typeTexStorage2DArray_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32ui');
/** @internal */ const typeTexStorage2DArray_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32i');
/** @internal */ const typeTexStorage2DArray_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32f');
/** @internal */ const typeTexStorage2DArray_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32ui');
/** @internal */ const typeTexStorage2DArray_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32i');
/** @internal */ const typeTexStorage2DArray_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32f');
/** @internal */ const typeTexStorage2DArray_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32ui');
/** @internal */ const typeTexStorage2DArray_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32i');
/** @internal */ const typeTexStorage2DArray_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32f');
/** @internal */ const typeTexStorage3D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8unorm');
/** @internal */ const typeTexStorage3D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8snorm');
/** @internal */ const typeTexStorage3D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'bgra8unorm');
/** @internal */ const typeTexStorage3D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8ui');
/** @internal */ const typeTexStorage3D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8i');
/** @internal */ const typeTexStorage3D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16ui');
/** @internal */ const typeTexStorage3D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16i');
/** @internal */ const typeTexStorage3D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16f');
/** @internal */ const typeTexStorage3D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32ui');
/** @internal */ const typeTexStorage3D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32i');
/** @internal */ const typeTexStorage3D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32f');
/** @internal */ const typeTexStorage3D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32ui');
/** @internal */ const typeTexStorage3D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32i');
/** @internal */ const typeTexStorage3D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32f');
/** @internal */ const typeTexStorage3D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32ui');
/** @internal */ const typeTexStorage3D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32i');
/** @internal */ const typeTexStorage3D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32f');
/** @internal */ const typeTexDepth2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D);
/** @internal */ const typeTexDepth2DArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D_ARRAY);
/** @internal */ const typeTexDepthCube = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE);
/** @internal */ const typeTexDepthCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE_ARRAY);
/** @internal */ const typeTexDepthMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_MULTISAMPLED_2D);
/** @internal */ const typeSampler = new PBSamplerTypeInfo(1);
/** @internal */ const typeSamplerComparison = new PBSamplerTypeInfo(2);
/** @internal */ const typeVoid = new PBVoidTypeInfo();
/** @internal */ const typeAny = new PBAnyTypeInfo();
/** @internal */ const typeFrexpResult = new PBStructTypeInfo('FrexpResult', 'default', [
    {
        name: 'sig',
        type: typeF32
    },
    {
        name: 'exp',
        type: typeI32
    }
]);
/** @internal */ const typeFrexpResultVec2 = new PBStructTypeInfo('FrexpResultVec2', 'default', [
    {
        name: 'sig',
        type: typeF32Vec2
    },
    {
        name: 'exp',
        type: typeI32Vec2
    }
]);
/** @internal */ const typeFrexpResultVec3 = new PBStructTypeInfo('FrexpResultVec3', 'default', [
    {
        name: 'sig',
        type: typeF32Vec3
    },
    {
        name: 'exp',
        type: typeI32Vec3
    }
]);
/** @internal */ const typeFrexpResultVec4 = new PBStructTypeInfo('FrexpResultVec4', 'default', [
    {
        name: 'sig',
        type: typeF32Vec4
    },
    {
        name: 'exp',
        type: typeI32Vec4
    }
]);

/** @public */ const MAX_VERTEX_ATTRIBUTES = 16;
/** @public */ const MAX_BINDING_GROUPS = 4;
/** @public */ const MAX_TEXCOORD_INDEX_COUNT = 8;
/** @public */ const VERTEX_ATTRIB_POSITION = 0;
/** @public */ const VERTEX_ATTRIB_NORMAL = 1;
/** @public */ const VERTEX_ATTRIB_DIFFUSE = 2;
/** @public */ const VERTEX_ATTRIB_TANGENT = 3;
/** @public */ const VERTEX_ATTRIB_TEXCOORD0 = 4;
/** @public */ const VERTEX_ATTRIB_TEXCOORD1 = 5;
/** @public */ const VERTEX_ATTRIB_TEXCOORD2 = 6;
/** @public */ const VERTEX_ATTRIB_TEXCOORD3 = 7;
/** @public */ const VERTEX_ATTRIB_TEXCOORD4 = 8;
/** @public */ const VERTEX_ATTRIB_TEXCOORD5 = 9;
/** @public */ const VERTEX_ATTRIB_TEXCOORD6 = 10;
/** @public */ const VERTEX_ATTRIB_TEXCOORD7 = 11;
/** @public */ const VERTEX_ATTRIB_BLEND_WEIGHT = 12;
/** @public */ const VERTEX_ATTRIB_BLEND_INDICES = 13;
const vertexAttribFormatMap = {
    position_u8normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    position_u8normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    position_i8normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    position_i8normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    position_u16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    position_u16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    position_i16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    position_i16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    position_u16normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    position_u16normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    position_i16normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    position_i16normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    position_f16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    position_f16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    position_f32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    position_f32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    position_f32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    position_f32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    position_i32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    position_i32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    position_i32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    position_i32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    position_u32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    position_u32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    position_u32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    position_u32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    normal_f16x4: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    normal_f32x3: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    normal_f32x4: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    diffuse_u8normx4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    diffuse_u16x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    diffuse_u16normx4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    diffuse_f16x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    diffuse_f32x3: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    diffuse_f32x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    diffuse_u32x3: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    diffuse_u32x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tangent_f16x4: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tangent_f32x3: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tangent_f32x4: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex0_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex0_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex0_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex0_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex0_u16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex0_u16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex0_i16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex0_i16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex0_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex0_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex0_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex0_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex0_f16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex0_f16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex0_f32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex0_f32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex0_f32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex0_f32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex0_i32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex0_i32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex0_i32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex0_i32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex0_u32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex0_u32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex0_u32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex0_u32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex1_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex1_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex1_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex1_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex1_u16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex1_u16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex1_i16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex1_i16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex1_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex1_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex1_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex1_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex1_f16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex1_f16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex1_f32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex1_f32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex1_f32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex1_f32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex1_i32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex1_i32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex1_i32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex1_i32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex1_u32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex1_u32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex1_u32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex1_u32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex2_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex2_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex2_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex2_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex2_u16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex2_u16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex2_i16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex2_i16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex2_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex2_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex2_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex2_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex2_f16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex2_f16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex2_f32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex2_f32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex2_f32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex2_f32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex2_i32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex2_i32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex2_i32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex2_i32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex2_u32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex2_u32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex2_u32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex2_u32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex3_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex3_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex3_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex3_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex3_u16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex3_u16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex3_i16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex3_i16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex3_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex3_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex3_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex3_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex3_f16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex3_f16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex3_f32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex3_f32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex3_f32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex3_f32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex3_i32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex3_i32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex3_i32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex3_i32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex3_u32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex3_u32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex3_u32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex3_u32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex4_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex4_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex4_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex4_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex4_u16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex4_u16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex4_i16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex4_i16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex4_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex4_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex4_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex4_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex4_f16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex4_f16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex4_f32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex4_f32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex4_f32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex4_f32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex4_i32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex4_i32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex4_i32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex4_i32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex4_u32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex4_u32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex4_u32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex4_u32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex5_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex5_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex5_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex5_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex5_u16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex5_u16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex5_i16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex5_i16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex5_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex5_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex5_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex5_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex5_f16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex5_f16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex5_f32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex5_f32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex5_f32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex5_f32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex5_i32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex5_i32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex5_i32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex5_i32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex5_u32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex5_u32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex5_u32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex5_u32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex6_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex6_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex6_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex6_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex6_u16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex6_u16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex6_i16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex6_i16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex6_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex6_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex6_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex6_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex6_f16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex6_f16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex6_f32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex6_f32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex6_f32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex6_f32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex6_i32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex6_i32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex6_i32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex6_i32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex6_u32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex6_u32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex6_u32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex6_u32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex7_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex7_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex7_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex7_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex7_u16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex7_u16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex7_i16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex7_i16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex7_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex7_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex7_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex7_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex7_f16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex7_f16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex7_f32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex7_f32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex7_f32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex7_f32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex7_i32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex7_i32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex7_i32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex7_i32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex7_u32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex7_u32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex7_u32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex7_u32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    blendweights_f16x1: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F16,
        2,
        'f16',
        1
    ],
    blendweights_f32x1: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    blendweights_f16x2: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    blendweights_f32x2: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    blendweights_f16x3: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F16VEC3,
        6,
        'f16',
        3
    ],
    blendweights_f32x3: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    blendweights_f16x4: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    blendweights_f32x4: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    blendindices_u16x1: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U16,
        2,
        'u16',
        1
    ],
    blendindices_f16x1: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F16,
        2,
        'f16',
        1
    ],
    blendindices_f32x1: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    blendindices_u32x1: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    blendindices_u16x2: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    blendindices_f16x2: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    blendindices_f32x2: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    blendindices_u32x2: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    blendindices_u16x3: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U16VEC3,
        6,
        'u16',
        3
    ],
    blendindices_f16x3: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F16VEC3,
        6,
        'f16',
        3
    ],
    blendindices_f32x3: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    blendindices_u32x3: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    blendindices_u16x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    blendindices_f16x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    blendindices_f32x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    blendindices_u32x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ]
};
const vertexAttribNameMap = {
    position: VERTEX_ATTRIB_POSITION,
    normal: VERTEX_ATTRIB_NORMAL,
    diffuse: VERTEX_ATTRIB_DIFFUSE,
    tangent: VERTEX_ATTRIB_TANGENT,
    blendIndices: VERTEX_ATTRIB_BLEND_INDICES,
    blendWeights: VERTEX_ATTRIB_BLEND_WEIGHT,
    texCoord0: VERTEX_ATTRIB_TEXCOORD0,
    texCoord1: VERTEX_ATTRIB_TEXCOORD1,
    texCoord2: VERTEX_ATTRIB_TEXCOORD2,
    texCoord3: VERTEX_ATTRIB_TEXCOORD3,
    texCoord4: VERTEX_ATTRIB_TEXCOORD4,
    texCoord5: VERTEX_ATTRIB_TEXCOORD5,
    texCoord6: VERTEX_ATTRIB_TEXCOORD6,
    texCoord7: VERTEX_ATTRIB_TEXCOORD7
};
const vertexAttribNameRevMap = {
    [VERTEX_ATTRIB_POSITION]: 'position',
    [VERTEX_ATTRIB_NORMAL]: 'normal',
    [VERTEX_ATTRIB_DIFFUSE]: 'diffuse',
    [VERTEX_ATTRIB_TANGENT]: 'tangent',
    [VERTEX_ATTRIB_BLEND_INDICES]: 'blendIndices',
    [VERTEX_ATTRIB_BLEND_WEIGHT]: 'blendWeights',
    [VERTEX_ATTRIB_TEXCOORD0]: 'texCoord0',
    [VERTEX_ATTRIB_TEXCOORD1]: 'texCoord1',
    [VERTEX_ATTRIB_TEXCOORD2]: 'texCoord2',
    [VERTEX_ATTRIB_TEXCOORD3]: 'texCoord3',
    [VERTEX_ATTRIB_TEXCOORD4]: 'texCoord4',
    [VERTEX_ATTRIB_TEXCOORD5]: 'texCoord5',
    [VERTEX_ATTRIB_TEXCOORD6]: 'texCoord6',
    [VERTEX_ATTRIB_TEXCOORD7]: 'texCoord7'
};
/**
 * The gpu resource usage flags
 * @public
 */ var GPUResourceUsageFlags = /*#__PURE__*/ function(GPUResourceUsageFlags) {
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_LINEAR_COLOR_SPACE"] = 2] = "TF_LINEAR_COLOR_SPACE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_NO_MIPMAP"] = 4] = "TF_NO_MIPMAP";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_WRITABLE"] = 8] = "TF_WRITABLE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_NO_GC"] = 16] = "TF_NO_GC";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_VERTEX"] = 32] = "BF_VERTEX";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_INDEX"] = 64] = "BF_INDEX";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_READ"] = 128] = "BF_READ";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_WRITE"] = 256] = "BF_WRITE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_UNIFORM"] = 512] = "BF_UNIFORM";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_STORAGE"] = 1024] = "BF_STORAGE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_PACK_PIXEL"] = 2048] = "BF_PACK_PIXEL";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_UNPACK_PIXEL"] = 4096] = "BF_UNPACK_PIXEL";
    GPUResourceUsageFlags[GPUResourceUsageFlags["DYNAMIC"] = 8192] = "DYNAMIC";
    GPUResourceUsageFlags[GPUResourceUsageFlags["MANAGED"] = 16384] = "MANAGED";
    return GPUResourceUsageFlags;
}({});
/**
 * Get vertex attribute index by semantic
 * @public
 */ function getVertexAttribByName(name) {
    return name ? vertexAttribNameMap[name] : undefined;
}
/**
 * Get vertex semantic by attribute index
 * @public
 */ function getVertexAttribName(attrib) {
    return vertexAttribNameRevMap[attrib];
}
/**
 * Test whether a vertex buffer matches given semantic
 * @param buffer - Vertex buffer
 * @param name - Semantic to test
 * @returns true if the vertex buffer matches given semantic, otherwise false
 *
 * @public
 */ function matchVertexBuffer(buffer, name) {
    if (!buffer) {
        return false;
    }
    const bufferType = buffer.structure.structMembers[0].type;
    if (!bufferType.isArrayType()) {
        return false;
    }
    const vertexType = bufferType.elementType;
    if (vertexType.isStructType()) {
        for (const attrib of vertexType.structMembers){
            if (attrib.name === name) {
                return true;
            }
        }
    } else {
        return buffer.structure.structMembers[0].name === name;
    }
    return false;
}
/**
 * Get vertex attribute type of specified vertex format
 * @param fmt - The vertex format
 * @returns Vertex attribute type, possible values are 'f32', 'f16', 'i32', 'u32', 'i16', 'u16', 'i8norm', 'u8norm', 'i16norm', 'u16norm'
 *
 * @public
 */ function getVertexAttributeFormat(fmt) {
    return vertexAttribFormatMap[fmt][3];
}
/**
 * Get vertex attribute index of specified vertex format
 * @param fmt - The vertex format
 * @returns Vertex attribute index
 *
 * @public
 */ function getVertexAttributeIndex(fmt) {
    return vertexAttribFormatMap[fmt][0];
}
/**
 * Get byte size of specified vertex format
 *
 * @public
 */ function getVertexFormatSize(fmt) {
    return vertexAttribFormatMap[fmt][2];
}
/**
 * Get number of components of specified vertex format
 *
 * @public
 */ function getVertexFormatComponentCount(fmt) {
    return vertexAttribFormatMap[fmt][4];
}
/**
 * Get vertex format by semantic and component type and component count
 * @param semantic - The vertex semantic
 * @param type - Data type of vertex component
 * @param count - The count of vertex components
 * @returns Vertex format
 *
 * @public
 */ function getVertexAttribFormat(semantic, type, count) {
    const loc = getVertexAttribByName(semantic);
    for(const k in vertexAttribFormatMap){
        const v = vertexAttribFormatMap[k];
        if (v[0] === loc && v[3] === type && v[4] === count) {
            return k;
        }
    }
    return null;
}
/**
 * Get the length of a vertex buffer by specified structure type of the vertex buffer
 * @param vertexBufferType - The structure type of the vertex buffer
 * @returns The length of the vertex buffer
 *
 * @public
 */ function getVertexBufferLength(vertexBufferType) {
    return vertexBufferType.structMembers[0].type.dimension;
}
/**
 * Get byte stride of a vertex buffer by specified structure type of the vertex buffer
 * @param vertexBufferType - The structure type of the vertex buffer
 * @returns The byte stride of the vertex buffer
 *
 * @public
 */ function getVertexBufferStride(vertexBufferType) {
    const vertexType = vertexBufferType.structMembers[0].type.elementType;
    if (vertexType.isStructType()) {
        let stride = 0;
        for (const member of vertexType.structMembers){
            stride += member.type.getSize();
        }
        return stride;
    } else {
        return vertexType.getSize();
    }
}
/**
 * Get primitive type of a vertex attribute by specified vertex semantic
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex semantic
 * @returns - The primitive type of the vertex attribute
 *
 * @public
 */ function getVertexBufferAttribTypeBySemantic(vertexBufferType, semantic) {
    const k = vertexBufferType.structMembers[0];
    const vertexType = k.type.elementType;
    if (vertexType.isStructType()) {
        for (const member of vertexType.structMembers){
            if (member.name === semantic) {
                return member.type;
            }
        }
        return null;
    } else {
        return k.name === semantic ? vertexType : null;
    }
}
/**
 * Get primitive type of a vertex attribute by specified vertex attribute index
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex attribute index
 * @returns - The primitive type of the vertex attribute
 *
 * @public
 */ function getVertexBufferAttribType(vertexBufferType, attrib) {
    const attribName = getVertexAttribName(attrib);
    if (!attribName) {
        return null;
    }
    return getVertexBufferAttribTypeBySemantic(vertexBufferType, attribName);
}
/**
 * Get the structure type of a vertex buffer by specified vertex attribute formats and the length of the vertex buffer
 * @param length - The length of the vertex buffer
 * @param attributes - The vertex attributes
 * @returns The structure type of the vertex buffer
 *
 * @public
 */ function makeVertexBufferType(length, ...attributes) {
    if (attributes.length === 0) {
        return null;
    }
    if (attributes.length === 1) {
        const format = vertexAttribFormatMap[attributes[0]];
        return new PBStructTypeInfo(null, 'packed', [
            {
                name: getVertexAttribName(format[0]),
                type: new PBArrayTypeInfo(PBPrimitiveTypeInfo.getCachedTypeInfo(format[1]), length)
            }
        ]);
    } else {
        const vertexType = new PBStructTypeInfo(null, 'packed', attributes.map((attrib)=>({
                name: getVertexAttribName(vertexAttribFormatMap[attrib][0]),
                type: PBPrimitiveTypeInfo.getCachedTypeInfo(vertexAttribFormatMap[attrib][1])
            })));
        return new PBStructTypeInfo(null, 'packed', [
            {
                name: 'value',
                type: new PBArrayTypeInfo(vertexType, length)
            }
        ]);
    }
}
/**
 * Vertex semantic list
 *
 * @public
 */ const semanticList = function() {
    const list = [];
    for(let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++){
        list.push(semanticToAttrib(i));
    }
    return list;
}();
/** @internal */ function semanticToAttrib(semantic) {
    switch(semantic){
        case VERTEX_ATTRIB_POSITION:
            return 'a_position';
        case VERTEX_ATTRIB_NORMAL:
            return 'a_normal';
        case VERTEX_ATTRIB_DIFFUSE:
            return 'a_diffuse';
        case VERTEX_ATTRIB_TANGENT:
            return 'a_tangent';
        case VERTEX_ATTRIB_TEXCOORD0:
            return 'a_texcoord0';
        case VERTEX_ATTRIB_TEXCOORD1:
            return 'a_texcoord1';
        case VERTEX_ATTRIB_TEXCOORD2:
            return 'a_texcoord2';
        case VERTEX_ATTRIB_TEXCOORD3:
            return 'a_texcoord3';
        case VERTEX_ATTRIB_TEXCOORD4:
            return 'a_texcoord4';
        case VERTEX_ATTRIB_TEXCOORD5:
            return 'a_texcoord5';
        case VERTEX_ATTRIB_TEXCOORD6:
            return 'a_texcoord6';
        case VERTEX_ATTRIB_TEXCOORD7:
            return 'a_texcoord7';
        case VERTEX_ATTRIB_BLEND_INDICES:
            return 'a_indices';
        case VERTEX_ATTRIB_BLEND_WEIGHT:
            return 'a_weight';
        default:
            return null;
    }
}
/**
 * Creates the default name for the type of given gpu object
 * @param obj - The gpu object
 * @returns The default name
 * @public
 */ function genDefaultName(obj) {
    if (obj.isTexture2D()) {
        return 'texture_2d';
    } else if (obj.isTexture2DArray()) {
        return 'texture_2darray';
    } else if (obj.isTexture3D()) {
        return 'texture_3d';
    } else if (obj.isTextureCube()) {
        return 'texture_cube';
    } else if (obj.isTextureVideo()) {
        return 'texture_video';
    } else if (obj.isBuffer()) {
        return 'buffer';
    } else if (obj.isFramebuffer()) {
        return 'framebuffer';
    } else if (obj.isProgram()) {
        return 'program';
    } else if (obj.isSampler()) {
        return 'sampler';
    } else if (obj.isVertexLayout()) {
        return 'vbo';
    } else {
        return 'unknown';
    }
}

/**
 * The vertex data class
 * @public
 */ class VertexData {
    /** @internal */ _vertexBuffers;
    /** @internal */ _indexBuffer;
    /** @internal */ _drawOffset;
    /** @internal */ _numVertices;
    constructor(){
        this._vertexBuffers = [];
        for(let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++){
            this._vertexBuffers.push(null);
        }
        this._indexBuffer = null;
        this._drawOffset = 0;
        this._numVertices = 0;
    }
    /**
   * Creates a new instance of VertexData by copying from this object
   * @returns New instance of VertexData
   */ clone() {
        const newVertexData = new VertexData();
        newVertexData._vertexBuffers = this._vertexBuffers.slice();
        newVertexData._indexBuffer = this._indexBuffer;
        newVertexData._drawOffset = this._drawOffset;
        newVertexData.calcNumVertices();
        return newVertexData;
    }
    /** Vertex buffer information list */ get vertexBuffers() {
        return this._vertexBuffers;
    }
    /** Index buffer */ get indexBuffer() {
        return this._indexBuffer;
    }
    /** Number of vertices */ get numVertices() {
        return this._numVertices;
    }
    /** Draw offset */ getDrawOffset() {
        return this._drawOffset;
    }
    setDrawOffset(offset) {
        if (offset !== this._drawOffset) {
            this._drawOffset = offset;
            this.calcNumVertices();
        }
    }
    /**
   * Gets the vertex buffer by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer of the given semantic
   */ getVertexBuffer(semantic) {
        return this._vertexBuffers[getVertexAttribByName(semantic)]?.buffer ?? null;
    }
    /**
   * Gets the vertex buffer information by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer information of the given semantic
   */ getVertexBufferInfo(semantic) {
        return this._vertexBuffers[getVertexAttribByName(semantic)] ?? null;
    }
    /**
   * Gets the index buffer
   * @returns The index buffer
   */ getIndexBuffer() {
        return this._indexBuffer;
    }
    /**
   * Sets a vertex buffer
   * @param buffer - The vertex buffer object
   * @param stepMode - Step mode of the buffer
   * @returns The buffer that was set
   */ setVertexBuffer(buffer, stepMode) {
        if (!buffer) {
            return null;
        }
        if (!(buffer.usage & GPUResourceUsageFlags.BF_VERTEX)) {
            throw new Error('setVertexBuffer() failed: buffer is null or buffer has not Vertex usage flag');
        }
        stepMode = stepMode || 'vertex';
        const vertexType = buffer.structure.structMembers[0].type.elementType;
        if (vertexType.isStructType()) {
            let offset = 0;
            for (const attrib of vertexType.structMembers){
                const loc = getVertexAttribByName(attrib.name);
                this.internalSetVertexBuffer(loc, buffer, offset, stepMode);
                offset += attrib.size;
            }
        } else {
            const loc = getVertexAttribByName(buffer.structure.structMembers[0].name);
            this.internalSetVertexBuffer(loc, buffer, 0, stepMode);
        }
        return buffer;
    }
    /**
   * Removes a vertex buffer
   * @param buffer - Vertex buffer to be removed
   * @returns true if the buffer was successfully removed, otherwise false
   */ removeVertexBuffer(buffer) {
        let removed = false;
        for(let loc = 0; loc < this._vertexBuffers.length; loc++){
            const info = this._vertexBuffers[loc];
            const remove = info?.buffer === buffer;
            if (remove) {
                this._vertexBuffers[loc] = null;
                removed = true;
            }
        }
        if (removed) {
            this.calcNumVertices();
        }
        return removed;
    }
    /**
   * Sets the index buffer
   * @param buffer - Index buffer to be set
   * @returns The index buffer that was set
   */ setIndexBuffer(buffer) {
        if (buffer !== this._indexBuffer) {
            this._indexBuffer = buffer;
        }
        return buffer;
    }
    /** @internal */ calcNumVertices() {
        this._numVertices = 0;
        for(let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++){
            const info = this._vertexBuffers[i];
            if (info && info.stepMode !== 'instance') {
                const n = Math.floor(info.buffer.byteLength / info.stride);
                if (n > this._numVertices) {
                    this._numVertices = n;
                }
            }
        }
    }
    /** @internal */ internalSetVertexBuffer(loc, buffer, offset, stepMode) {
        if (loc < 0 || loc >= MAX_VERTEX_ATTRIBUTES) {
            throw new Error(`setVertexBuffer() failed: location out of bounds: ${loc}`);
        }
        offset = Number(offset) || 0;
        stepMode = stepMode || 'vertex';
        const old = this._vertexBuffers[loc];
        if (!old || old.buffer !== buffer || old.offset !== offset || old.stepMode !== stepMode) {
            this._vertexBuffers[loc] = {
                buffer: buffer,
                offset: offset,
                type: getVertexBufferAttribType(buffer.structure, loc),
                stride: getVertexBufferStride(buffer.structure),
                drawOffset: 0,
                stepMode: stepMode
            };
            this.calcNumVertices();
            return buffer;
        }
        return null;
    }
}

/**
 * Abstract timer interface
 * @public
 */ /**
 * CPU timer class
 * @public
 */ class CPUTimer {
    /** @internal */ _cpuTimer;
    /** @internal */ _cpuStart;
    /** @internal */ _cpuTime;
    /** @internal */ _ended;
    constructor(){
        this._cpuTimer = window.performance || window.Date;
        this._cpuStart = 0;
        this._cpuTime = 0;
        this._ended = false;
    }
    now() {
        return this._cpuTimer.now();
    }
    begin() {
        this._cpuStart = this.now();
        this._cpuTime = 0;
        this._ended = false;
    }
    end() {
        this._cpuTime = this.now() - this._cpuStart;
        this._ended = true;
    }
    ended() {
        return this._ended;
    }
    elapsed() {
        return this._cpuTime;
    }
}

/**
 * ObjectPool class is responsible for managing and reusing textures and framebuffers.
 * @public
 */ class Pool {
    /** @internal */ _memCost;
    /** @internal */ _memCostThreshold;
    /** @internal */ _device;
    /** @internal */ _id;
    /** @internal */ _freeTextures = {};
    /** @internal */ _allocatedTextures = new WeakMap();
    /** @internal */ _autoReleaseTextures = new Set();
    /** @internal */ _freeFramebuffers = {};
    /** @internal */ _allocatedFramebuffers = new WeakMap();
    /** @internal */ _autoReleaseFramebuffers = new Set();
    /**
   * Creates an instance of Pool class
   * @param device - Rendering device
   */ constructor(device, id, memCostThreshold = 1024 * 1024 * 1024){
        this._device = device;
        this._id = id;
        this._memCost = 0;
        this._memCostThreshold = memCostThreshold;
        this._freeTextures = {};
        this._allocatedTextures = new WeakMap();
        this._autoReleaseTextures = new Set();
        this._freeFramebuffers = {};
        this._allocatedFramebuffers = new WeakMap();
        this._autoReleaseFramebuffers = new Set();
        this._memCost = 0;
    }
    /**
   * Id for this pool
   */ get id() {
        return this._id;
    }
    autoRelease() {
        // auto release objects
        for (const tex of this._autoReleaseTextures){
            this.releaseTexture(tex);
        }
        this._autoReleaseTextures.clear();
        for (const fb of this._autoReleaseFramebuffers){
            this.releaseFrameBuffer(fb);
        }
        this._autoReleaseFramebuffers.clear();
        // Free up video memory if memory usage is greater than specific value
        if (this._memCost >= this._memCostThreshold) {
            this.purge();
        }
    }
    /**
   * Fetch a temporal 2D texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - The format of the texture.
   * @param width - The width of the texture.
   * @param height - The height of the texture.
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched Texture2D object.
   */ fetchTemporalTexture2D(autoRelease, format, width, height, mipmapping = false) {
        const hash = `2d:${format}:${width}:${height}:${mipmapping ? 1 : 0}`;
        let texture = null;
        const list = this._freeTextures[hash];
        if (!list) {
            texture = this._device.createTexture2D(format, width, height, {
                mipmapping
            });
            if (!texture) {
                throw new Error(`Create 2D texture failed: ${format}-${width}x${height}`);
            }
            this._memCost += texture.memCost;
        } else {
            texture = list.pop();
            if (list.length === 0) {
                delete this._freeTextures[hash];
            }
        }
        this._allocatedTextures.set(texture, {
            hash,
            refcount: 1,
            dispose: false
        });
        if (autoRelease) {
            this._autoReleaseTextures.add(texture);
        }
        return texture;
    }
    /**
   * Fetch a temporal 2D array texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - Format of the texture.
   * @param width - Width of the texture.
   * @param height - Height of the texture.
   * @param numLayers - Layer count of the texture
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched Texture2DArray object.
   */ fetchTemporalTexture2DArray(autoRelease, format, width, height, numLayers, mipmapping = false) {
        const hash = `2darray:${format}:${width}:${height}:${numLayers}:${mipmapping ? 1 : 0}`;
        let texture = null;
        const list = this._freeTextures[hash];
        if (!list) {
            texture = this._device.createTexture2DArray(format, width, height, numLayers, {
                mipmapping
            });
            if (!texture) {
                throw new Error(`Create 2DArray texture failed: ${format}-${width}x${height}x${numLayers}`);
            }
            this._memCost += texture.memCost;
        } else {
            texture = list.pop();
            if (list.length === 0) {
                delete this._freeTextures[hash];
            }
        }
        this._allocatedTextures.set(texture, {
            hash,
            refcount: 1,
            dispose: false
        });
        if (autoRelease) {
            this._autoReleaseTextures.add(texture);
        }
        return texture;
    }
    /**
   * Fetch a temporal Cube texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - Format of the texture.
   * @param size - size of the texture.
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched TextureCube object.
   */ fetchTemporalTextureCube(autoRelease, format, size, mipmapping = false) {
        const hash = `cube:${format}:${size}:${mipmapping ? 1 : 0}`;
        let texture = null;
        const list = this._freeTextures[hash];
        if (!list) {
            texture = this._device.createCubeTexture(format, size, {
                mipmapping
            });
            if (!texture) {
                throw new Error(`Create Cube texture failed: ${format}-${size}`);
            }
            this._memCost += texture.memCost;
        } else {
            texture = list.pop();
            if (list.length === 0) {
                delete this._freeTextures[hash];
            }
        }
        this._allocatedTextures.set(texture, {
            hash,
            refcount: 1,
            dispose: false
        });
        if (autoRelease) {
            this._autoReleaseTextures.add(texture);
        }
        return texture;
    }
    /**
   * Creates a temporal framebuffer from the object pool.
   * @param autoRelease - Whether the framebuffer should be automatically released at the next frame.
   * @param width - Width of the framebuffer
   * @param height - Height of the framebuffer
   * @param colorAttachments - Array of color attachments or texture format of the framebuffer.
   * @param depthAttachment - Depth attachment or texture format of the framebuffer.
   * @param mipmapping - Whether mipmapping should be enabled when creating color attachment textures, default is false.
   * @param sampleCount - The sample count for the framebuffer, default is 1.
   * @param ignoreDepthStencil - Whether to ignore depth stencil when resolving msaa framebuffer, default is true.
   * @param attachmentMipLevel - The mipmap level to which the color attachment will render, default is 0
   * @param attachmentCubeface - The cubemap face to which the color attachment will render, default is 0
   * @param attachmentLayer - The texture layer to which the color attachment will render, default is 0
   * @returns The fetched FrameBuffer object.
   */ fetchTemporalFramebuffer(autoRelease, width, height, colorTexOrFormat, depthTexOrFormat = null, mipmapping = false, sampleCount = 1, ignoreDepthStencil = true, attachmentMipLevel = 0, attachmentCubeface = 0, attachmentLayer = 0) {
        const colors = Array.isArray(colorTexOrFormat) ? colorTexOrFormat : colorTexOrFormat ? [
            colorTexOrFormat
        ] : [];
        const colorAttachments = colors.map((val)=>{
            return typeof val === 'string' ? this.fetchTemporalTexture2D(false, val, width, height, mipmapping) : val;
        });
        const depthAttachment = typeof depthTexOrFormat === 'string' ? this.fetchTemporalTexture2D(false, depthTexOrFormat, width, height, false) : depthTexOrFormat;
        const fb = this.createTemporalFramebuffer(autoRelease, colorAttachments, depthAttachment, sampleCount, ignoreDepthStencil, attachmentMipLevel, attachmentCubeface, attachmentLayer);
        for(let i = 0; i < colors.length; i++){
            if (typeof colors[i] === 'string') {
                this.releaseTexture(colorAttachments[i]);
            }
        }
        if (!!depthAttachment && typeof depthTexOrFormat === 'string') {
            this.releaseTexture(depthAttachment);
        }
        return fb;
    }
    /**
   * Creates a temporal framebuffer from the object pool.
   * @param autoRelease - Whether the framebuffer should be automatically released at the next frame.
   * @param colorAttachments - Array of color attachments for the framebuffer.
   * @param depthAttachment - Depth attachment for the framebuffer.
   * @param sampleCount - The sample count for the framebuffer, default is 1.
   * @param ignoreDepthStencil - Whether to ignore depth stencil when resolving msaa framebuffer, default is true.
   * @param attachmentMipLevel - The mipmap level to which the color attachment will render, default is 0.
   * @param attachmentCubeface - The cubemap face to which the color attachment will render, default is 0.
   * @param attachmentLayer - The texture layer to which the color attachment will render, default is 0.
   * @returns The fetched FrameBuffer object.
   */ createTemporalFramebuffer(autoRelease, colorAttachments, depthAttachment = null, sampleCount = 1, ignoreDepthStencil = true, attachmentMipLevel = 0, attachmentCubeface = 0, attachmentLayer = 0) {
        colorAttachments = colorAttachments ?? [];
        let hash = `${depthAttachment?.uid ?? 0}:${sampleCount ?? 1}:${ignoreDepthStencil ? 1 : 0}`;
        if (colorAttachments.length > 0) {
            hash += `:${attachmentMipLevel}:${attachmentCubeface}:${attachmentLayer}`;
            for (const tex of colorAttachments){
                hash += `:${tex.uid}`;
            }
        }
        let fb = null;
        const list = this._freeFramebuffers[hash];
        if (!list) {
            fb = this._device.createFrameBuffer(colorAttachments, depthAttachment, {
                ignoreDepthStencil,
                sampleCount
            });
            for(let i = 0; i < fb.getColorAttachments().length; i++){
                fb.setColorAttachmentMipLevel(i, attachmentMipLevel);
                fb.setColorAttachmentCubeFace(i, attachmentCubeface);
                fb.setColorAttachmentLayer(i, attachmentLayer);
            }
        } else {
            fb = list.pop();
            if (list.length === 0) {
                delete this._freeFramebuffers[hash];
            }
        }
        // Mark referenced textures
        const info = depthAttachment ? this._allocatedTextures.get(depthAttachment) : null;
        if (info) {
            info.refcount++;
        }
        for (const tex of colorAttachments){
            const info = this._allocatedTextures.get(tex);
            if (info) {
                info.refcount++;
            }
        }
        this._allocatedFramebuffers.set(fb, {
            hash,
            refcount: 1
        });
        if (autoRelease) {
            this._autoReleaseFramebuffers.add(fb);
        }
        return fb;
    }
    /**
   * Dispose a texture that is allocated from the object pool.
   * @param texture - The texture to dispose.
   */ disposeTexture(texture) {
        this.safeReleaseTexture(texture, true);
    }
    /**
   * Release a texture back to the object pool.
   * @param texture - The texture to release.
   */ releaseTexture(texture) {
        const info = this._allocatedTextures.get(texture);
        if (!info) {
            console.error(`ObjectPool.releaseTexture(): texture is not allocated from pool`);
        } else {
            this.safeReleaseTexture(texture);
        }
    }
    /**
   * Increment reference counter for given texture
   * @param texture - The texture to retain
   */ retainTexture(texture) {
        const info = this._allocatedTextures.get(texture);
        if (!info) {
            console.error(`ObjectPool.retainTexture(): texture is not allocated from pool`);
        } else {
            info.refcount++;
        }
    }
    /**
   * Dispose a framebuffer that is allocated from the object pool.
   * @param fb - The framebuffer to dispose.
   */ disposeFrameBuffer(fb) {
        const hash = this._allocatedFramebuffers.get(fb);
        if (!hash) {
            console.error(`ObjectPool.disposeFrameBuffer(): framebuffer is not allocated from pool`);
        } else {
            this.internalDisposeFrameBuffer(fb);
            fb.dispose();
        }
    }
    /**
   * Release a framebuffer back to the object pool.
   * @param fb - The framebuffer to release.
   */ releaseFrameBuffer(fb) {
        const info = this._allocatedFramebuffers.get(fb);
        if (!info) {
            console.error(`ObjectPool.releaseFrameBuffer(): framebuffer is not allocated from pool`);
        } else {
            info.refcount--;
            if (info.refcount <= 0) {
                this.internalDisposeFrameBuffer(fb);
                const list = this._freeFramebuffers[info.hash];
                if (list) {
                    list.push(fb);
                } else {
                    this._freeFramebuffers[info.hash] = [
                        fb
                    ];
                }
            }
        }
    }
    /**
   * Increment reference counter for given framebuffer
   * @param fb - The framebuffer to retain
   */ retainFrameBuffer(fb) {
        const info = this._allocatedFramebuffers.get(fb);
        if (!info) {
            console.error(`ObjectPool.retainFrameBuffer(): framebuffer is not allocated from pool`);
        } else {
            info.refcount++;
        }
    }
    /**
   * Purge the object pool by disposing all free framebuffers and textures.
   */ purge() {
        for(const k in this._freeFramebuffers){
            const list = this._freeFramebuffers[k];
            if (list) {
                for (const fb of this._freeFramebuffers[k]){
                    this.internalDisposeFrameBuffer(fb);
                    fb.dispose();
                }
            }
        }
        this._freeFramebuffers = {};
        for(const k in this._freeTextures){
            const list = this._freeTextures[k];
            for (const tex of list){
                this._memCost -= tex.memCost;
                tex.dispose();
            }
        }
        this._freeTextures = {};
    }
    /** @internal */ internalDisposeFrameBuffer(fb) {
        if (fb) {
            // Release attachment textures
            const colorAttachments = fb.getColorAttachments();
            if (colorAttachments) {
                for (const tex of colorAttachments){
                    this.safeReleaseTexture(tex);
                }
            }
            const depthAttachment = fb.getDepthAttachment();
            if (depthAttachment) {
                this.safeReleaseTexture(depthAttachment);
            }
            this._allocatedFramebuffers.delete(fb);
            this._autoReleaseFramebuffers.delete(fb);
        }
    }
    /** @internal */ safeReleaseTexture(texture, purge = false) {
        const info = this._allocatedTextures.get(texture);
        if (info) {
            info.refcount--;
            if (info.refcount <= 0) {
                this._allocatedTextures.delete(texture);
                this._autoReleaseTextures.delete(texture);
                if (purge || info.dispose) {
                    this._memCost -= texture.memCost;
                    texture.dispose();
                } else {
                    const list = this._freeTextures[info.hash];
                    if (list) {
                        list.push(texture);
                    } else {
                        this._freeTextures[info.hash] = [
                            texture
                        ];
                    }
                }
            } else if (purge) {
                info.dispose = true;
            }
        }
    }
}

/**
 * Reflection interface for program builder
 * @public
 */ class PBReflection {
    /** @internal */ _builder;
    /** @internal */ _tagList;
    /** @internal */ _attribList;
    constructor(builder){
        this._builder = builder;
        this._tagList = {};
        this._attribList = {};
    }
    /** Gets all the vertex attributes that was used by the program */ get vertexAttributes() {
        return this._builder.getVertexAttributes();
    }
    /**
   * Check if specified vertex attribute was used by the program
   * @param attrib - The vertex attribute to check
   */ hasVertexAttribute(attrib) {
        return this.vertexAttributes.indexOf(attrib) >= 0;
    }
    /**
   * Clear all contents
   */ clear() {
        this._tagList = {};
        this._attribList = {};
    }
    tag(arg0, arg1) {
        if (typeof arg0 === 'string') {
            if (arg1 === undefined) {
                return this.getTag(arg0);
            } else {
                this.addTag(arg0, arg1);
            }
        } else {
            for (const k of Object.keys(arg0)){
                this.addTag(k, arg0[k]);
            }
        }
    }
    /**
   * Gets the variable which is the vertex attribute of specified semantic
   * @param attrib - The vertex semantic
   */ attribute(attrib) {
        return this._attribList[attrib] ?? null;
    }
    /** @internal */ setAttrib(attrib, exp) {
        this._attribList[attrib] = exp;
    }
    /** @internal */ addTag(name, exp) {
        this._tagList[name] = exp;
    }
    /** @internal */ getTag(name) {
        const getter = this._tagList[name];
        return getter ? getter(this._builder.getGlobalScope()) : null;
    }
}

/** @internal */ function expValueToString(deviceType, value) {
    if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
        return `${value}`;
    } else {
        return value.$ast?.toString(deviceType) ?? '';
    }
}
/** @internal */ function expValueTypeToString(deviceType, type) {
    return type?.toTypeName(deviceType) ?? '';
}
/** @internal */ class PBError extends Error {
}
/** @internal */ class PBValueOutOfRange extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(_deviceType) {
        return `value out of range: ${this.value}`;
    }
}
/** @internal */ class PBTypeCastError extends PBError {
    value;
    valueType;
    expectedType;
    constructor(value, valueType, expectedType){
        super();
        this.value = value;
        this.valueType = valueType;
        this.expectedType = expectedType;
    }
    getMessage(deviceType) {
        const valueStr = typeof this.value === 'string' ? this.value : expValueToString(deviceType, this.value);
        const valueTypeStr = typeof this.valueType === 'string' ? this.valueType : expValueTypeToString(deviceType, this.valueType);
        const expectedTypeStr = typeof this.expectedType === 'string' ? this.expectedType : expValueTypeToString(deviceType, this.expectedType);
        return `cannot convert '${valueStr}' of type '${valueTypeStr}' to type ${expectedTypeStr}`;
    }
}
/** @internal */ class PBParamLengthError extends PBError {
    func;
    constructor(func){
        super();
        this.func = func;
    }
    getMessage(_deviceType) {
        return `wrong argument count for function '${this.func}'`;
    }
}
/** @internal */ class PBParamTypeError extends PBError {
    func;
    param;
    constructor(func, param){
        super();
        this.func = func;
        this.param = param || null;
    }
    getMessage(_deviceType) {
        return `parameter type error for function '${this.func}': ${this.param}`;
    }
}
/** @internal */ class PBParamValueError extends PBError {
    func;
    param;
    reason;
    constructor(func, param, reason){
        super();
        this.func = func;
        this.param = param ?? null;
        this.reason = reason ?? null;
    }
    getMessage(_deviceType) {
        return `invalid parameter value for function '${this.func}'${this.param ? ': ' + this.param : ''}${this.reason ? ': ' + this.reason : ''}}`;
    }
}
/** @internal */ class PBOverloadingMatchError extends PBError {
    func;
    constructor(func){
        super();
        this.func = func;
    }
    getMessage(_deviceType) {
        return `No matched overloading found for function '${this.func}'`;
    }
}
/** @internal */ class PBReferenceValueRequired extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(deviceType) {
        return `'${expValueToString(deviceType, this.value)}' is not a reference type`;
    }
}
/** @internal */ class PBPointerValueRequired extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(deviceType) {
        return `'${expValueToString(deviceType, this.value)}' is not a pointer type`;
    }
}
/** @internal */ class PBDeviceNotSupport extends PBError {
    feature;
    constructor(feature){
        super();
        this.feature = feature;
    }
    getMessage(deviceType) {
        return `feature not support for ${deviceType} device: ${this.feature}`;
    }
}
/** @internal */ class PBNonScopedFunctionCall extends PBError {
    funcName;
    constructor(funcName){
        super();
        this.funcName = funcName;
    }
    getMessage(_deviceType) {
        return `function call must be made inside a function scope: ${this.funcName}()`;
    }
}
/** @internal */ class PBASTError extends PBError {
    ast;
    text;
    constructor(ast, text){
        super();
        this.ast = ast;
        this.text = text;
    }
    getMessage(deviceType) {
        return `${this.text}: ${this.ast.toString(deviceType)}`;
    }
}
/** @internal */ class PBInternalError extends PBError {
    constructor(desc){
        super(desc);
    }
    getMessage(_deviceType) {
        return `Internal error: ${this.message}`;
    }
}

let currentProgramBuilder;
/** @internal */ function setCurrentProgramBuilder(pb) {
    currentProgramBuilder = pb;
}
/** @internal */ function getCurrentProgramBuilder() {
    return currentProgramBuilder;
}

const BuiltinInputStructNameVS = 'zVSInput';
const BuiltinOutputStructNameVS = 'zVSOutput';
const BuiltinInputStructNameFS = 'zFSInput';
const BuiltinOutputStructNameFS = 'zFSOutput';
const BuiltinInputStructNameCS = 'zCSInput';
const BuiltinOutputStructNameCS = 'zCSOutput';
const BuiltinParamNameVS = 'zVertexInput';
const BuiltinParamNameFS = 'zVertexOutput';
const BuiltinParamNameCS = 'zComputeInput';
const BuiltinInputStructInstanceNameVS = 'zVSInputCpy';
const BuiltinOutputStructInstanceNameVS = 'zVSOutputCpy';
const BuiltinInputStructInstanceNameFS = 'zFSInputCpy';
const BuiltinOutputStructInstanceNameFS = 'zFSOutputCpy';
const BuiltinInputStructInstanceNameCS = 'zCSInputCpy';
const BuiltinOutputStructInstanceNameCS = 'zCSOutputCpy';
/** @internal */ var DeclareType = /*#__PURE__*/ function(DeclareType) {
    DeclareType[DeclareType["DECLARE_TYPE_NONE"] = 0] = "DECLARE_TYPE_NONE";
    DeclareType[DeclareType["DECLARE_TYPE_IN"] = 1] = "DECLARE_TYPE_IN";
    DeclareType[DeclareType["DECLARE_TYPE_OUT"] = 2] = "DECLARE_TYPE_OUT";
    DeclareType[DeclareType["DECLARE_TYPE_WORKGROUP"] = 3] = "DECLARE_TYPE_WORKGROUP";
    DeclareType[DeclareType["DECLARE_TYPE_UNIFORM"] = 4] = "DECLARE_TYPE_UNIFORM";
    DeclareType[DeclareType["DECLARE_TYPE_STORAGE"] = 5] = "DECLARE_TYPE_STORAGE";
    return DeclareType;
}({});
/** @internal */ var ShaderPrecisionType = /*#__PURE__*/ function(ShaderPrecisionType) {
    ShaderPrecisionType[ShaderPrecisionType["NONE"] = 0] = "NONE";
    ShaderPrecisionType[ShaderPrecisionType["HIGH"] = 1] = "HIGH";
    ShaderPrecisionType[ShaderPrecisionType["MEDIUM"] = 2] = "MEDIUM";
    ShaderPrecisionType[ShaderPrecisionType["LOW"] = 3] = "LOW";
    return ShaderPrecisionType;
}({});
/** @internal */ function getBuiltinParamName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinParamNameVS;
        case ShaderType.Fragment:
            return BuiltinParamNameFS;
        case ShaderType.Compute:
            return BuiltinParamNameCS;
        default:
            throw new Error(`Invalid shader type: ${shaderType}`);
    }
}
/** @internal */ function getBuiltinInputStructInstanceName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinInputStructInstanceNameVS;
        case ShaderType.Fragment:
            return BuiltinInputStructInstanceNameFS;
        case ShaderType.Compute:
            return BuiltinInputStructInstanceNameCS;
        default:
            throw new Error(`Invalid shader type: ${shaderType}`);
    }
}
/** @internal */ function getBuiltinOutputStructInstanceName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinOutputStructInstanceNameVS;
        case ShaderType.Fragment:
            return BuiltinOutputStructInstanceNameFS;
        case ShaderType.Compute:
            return BuiltinOutputStructInstanceNameCS;
        default:
            throw new Error(`Invalid shader type: ${shaderType}`);
    }
}
/** @internal */ function getBuiltinInputStructName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinInputStructNameVS;
        case ShaderType.Fragment:
            return BuiltinInputStructNameFS;
        case ShaderType.Compute:
            return BuiltinInputStructNameCS;
        default:
            throw new Error(`Invalid shader type: ${shaderType}`);
    }
}
/** @internal */ function getBuiltinOutputStructName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinOutputStructNameVS;
        case ShaderType.Fragment:
            return BuiltinOutputStructNameFS;
        case ShaderType.Compute:
            return BuiltinOutputStructNameCS;
        default:
            throw new Error(`Invalid shader type: ${shaderType}`);
    }
}
/** @internal */ function getTextureSampleType(type) {
    switch(type.textureType){
        case PBTextureType.TEX_1D:
        case PBTextureType.TEX_STORAGE_1D:
        case PBTextureType.TEX_2D:
        case PBTextureType.TEX_STORAGE_2D:
        case PBTextureType.TEX_2D_ARRAY:
        case PBTextureType.TEX_STORAGE_2D_ARRAY:
        case PBTextureType.TEX_3D:
        case PBTextureType.TEX_STORAGE_3D:
        case PBTextureType.TEX_CUBE:
        case PBTextureType.TEX_EXTERNAL:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4);
        case PBTextureType.TEX_DEPTH_2D_ARRAY:
        case PBTextureType.TEX_DEPTH_2D:
        case PBTextureType.TEX_DEPTH_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.F32);
        case PBTextureType.ITEX_2D_ARRAY:
        case PBTextureType.ITEX_1D:
        case PBTextureType.ITEX_2D:
        case PBTextureType.ITEX_3D:
        case PBTextureType.ITEX_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.I32);
        case PBTextureType.UTEX_2D_ARRAY:
        case PBTextureType.UTEX_1D:
        case PBTextureType.UTEX_2D:
        case PBTextureType.UTEX_3D:
        case PBTextureType.UTEX_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.U32);
        default:
            throw new Error(`Invalid texture type: ${type}`);
    }
}
/** @internal */ function genSamplerName(textureName, comparison) {
    return `ch_auto_sampler_${textureName}${comparison ? '_comparison' : ''}`;
}
/** @internal */ const builtinVariables = {
    webgl: {
        position: {
            name: 'gl_Position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'vertex'
        },
        pointSize: {
            name: 'gl_PointSize',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'vertex'
        },
        fragCoord: {
            name: 'gl_FragCoord',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'fragment'
        },
        frontFacing: {
            name: 'gl_FrontFacing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            stage: 'fragment'
        },
        fragDepth: {
            name: 'gl_FragDepthEXT',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            inOrOut: 'out',
            extension: 'GL_EXT_frag_depth',
            stage: 'fragment'
        }
    },
    webgl2: {
        vertexIndex: {
            name: 'gl_VertexID',
            semantic: 'vertex_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        instanceIndex: {
            name: 'gl_InstanceID',
            semantic: 'instance_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        position: {
            name: 'gl_Position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'vertex'
        },
        pointSize: {
            name: 'gl_PointSize',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'vertex'
        },
        fragCoord: {
            name: 'gl_FragCoord',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'fragment'
        },
        frontFacing: {
            name: 'gl_FrontFacing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            stage: 'fragment'
        },
        fragDepth: {
            name: 'gl_FragDepth',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'fragment'
        }
    },
    webgpu: {
        vertexIndex: {
            name: 'zVertexId',
            semantic: 'vertex_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        instanceIndex: {
            name: 'zInstanceId',
            semantic: 'instance_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        position: {
            name: 'zPosition',
            semantic: 'position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            inOrOut: 'out',
            stage: 'vertex'
        },
        fragCoord: {
            name: 'zFragCoord',
            semantic: 'position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            inOrOut: 'in',
            stage: 'fragment'
        },
        frontFacing: {
            name: 'zFrontFacing',
            semantic: 'front_facing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            inOrOut: 'in',
            stage: 'fragment'
        },
        fragDepth: {
            name: 'zFragDepth',
            semantic: 'frag_depth',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            inOrOut: 'out',
            stage: 'fragment'
        },
        localInvocationId: {
            name: 'zLocalInvocationId',
            semantic: 'local_invocation_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        globalInvocationId: {
            name: 'zGlobalInvocationId',
            semantic: 'global_invocation_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        workGroupId: {
            name: 'zWorkGroupId',
            semantic: 'workgroup_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        numWorkGroups: {
            name: 'zNumWorkGroups',
            semantic: 'num_workgroups',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        sampleMaskIn: {
            name: 'zSampleMaskIn',
            semantic: 'sample_mask_in',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'fragment'
        },
        sampleMaskOut: {
            name: 'zSampleMaskOut',
            semantic: 'sample_mask_out',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'out',
            stage: 'fragment'
        },
        sampleIndex: {
            name: 'zSampleIndex',
            semantic: 'sample_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'fragment'
        }
    }
};
function toFixed(n) {
    return n % 1 === 0 ? n.toFixed(1) : String(n);
}
function toInt(n) {
    return String(n | 0);
}
function toUint(n) {
    return String(n >>> 0);
}
function unbracket(e) {
    e = e.trim();
    if (e[0] === '(' && e[e.length - 1] === ')') {
        let match = 0;
        for(let i = 1; i < e.length - 1; i++){
            if (e[i] === '(') {
                match++;
            } else if (e[i] === ')') {
                match--;
                if (match < 0) {
                    break;
                }
            }
        }
        if (match > 0) {
            throw new PBInternalError(`Invalid expression: ${e}`);
        } else if (match === 0) {
            return e.substring(1, e.length - 1);
        }
    }
    return e;
}
/** @internal */ class ShaderAST {
    isReference() {
        return false;
    }
    isPointer() {
        return !!this.getType()?.isPointerType();
    }
    getType() {
        return null;
    }
    toWebGL(_indent, _ctx) {
        return '';
    }
    toWebGL2(_indent, _ctx) {
        return '';
    }
    toWGSL(_indent, _ctx) {
        return '';
    }
    toString(_deviceType) {
        return this.constructor.name;
    }
}
/** @internal */ class ASTExpression extends ShaderAST {
}
/** @internal */ class ASTFunctionParameter extends ASTExpression {
    /** @internal */ paramAST;
    /** @internal */ writable;
    constructor(init){
        super();
        this.paramAST = init;
        this.writable = false;
    }
    getType() {
        return this.paramAST.getType();
    }
    markWritable() {
        if (this.paramAST instanceof ASTPrimitive) {
            console.warn(`Write to non-output parameter ${this.paramAST.value.$str}`);
        }
        this.writable = true;
    }
    isWritable() {
        return this.writable;
    }
    getAddressSpace() {
        return this.paramAST.getAddressSpace();
    }
    isConstExp() {
        return this.paramAST.isConstExp();
    }
    isReference() {
        return this.paramAST.isReference();
    }
    toWebGL(indent, ctx) {
        return this.paramAST.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.paramAST.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.paramAST.toWGSL(indent, ctx);
    }
}
/** @internal */ class ASTScope extends ShaderAST {
    statements;
    constructor(){
        super();
        this.statements = [];
    }
    toWebGL(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>stmt.toWebGL(indent, ctx)).join('');
    }
    toWebGL2(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>stmt.toWebGL2(indent, ctx)).join('');
    }
    toWGSL(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>{
            if (stmt instanceof ASTCallFunction) {
                if (!stmt.getType().isVoidType()) {
                    return `${indent}_ = ${stmt.toWGSL('', ctx)}`;
                }
            }
            return stmt.toWGSL(indent, ctx);
        }).join('');
    }
}
/** @internal */ class ASTNakedScope extends ASTScope {
    toWebGL(indent, ctx) {
        return `${indent}{\n${super.toWebGL(indent + ' ', ctx)}${indent}}\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}{\n${super.toWebGL2(indent + ' ', ctx)}${indent}}\n`;
    }
    toWGSL(indent, ctx) {
        return `${indent}{\n${super.toWGSL(indent + ' ', ctx)}${indent}}\n`;
    }
}
/** @internal */ class ASTGlobalScope extends ASTScope {
    /** @internal */ uniforms;
    constructor(){
        super();
        this.uniforms = [];
    }
    findFunctions(name) {
        const result = [];
        for (const stmt of this.statements){
            if (stmt instanceof ASTFunction && stmt.name === name) {
                result.push(stmt);
            }
        }
        return result;
    }
    toWebGL(indent, ctx) {
        // TODO: precision
        const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
        const version = `${indent}#version 100\n`;
        const body = ctx.types.map((val)=>val.toWebGL(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWebGL(indent, ctx)).join('') + ctx.inputs.map((input)=>input.toWebGL(indent, ctx)).join('') + ctx.outputs.map((output)=>output.toWebGL(indent, ctx)).join('') + super.toWebGL(indent, ctx);
        for (const k of ctx.builtins){
            const info = builtinVariables.webgl[k];
            if ('extension' in info) {
                ctx.extensions.add(info.extension);
            }
        }
        const extensions = [
            ...ctx.extensions
        ].map((s)=>`${indent}#extension ${s}: enable\n`).join('');
        const defines = ctx.defines.join('');
        return version + extensions + precisions + defines + body;
    }
    toWebGL2(indent, ctx) {
        const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
        const version = `${indent}#version 300 es\n`;
        const body = ctx.types.map((val)=>val.toWebGL2(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWebGL2(indent, ctx)).join('') + ctx.inputs.map((input)=>input.toWebGL2(indent, ctx)).join('') + ctx.outputs.map((output)=>output.toWebGL2(indent, ctx)).join('') + super.toWebGL2(indent, ctx);
        for (const k of ctx.builtins){
            const info = builtinVariables.webgl2[k];
            if ('extension' in info) {
                ctx.extensions.add(info.extension);
            }
        }
        const extensions = [
            ...ctx.extensions
        ].map((s)=>`${indent}#extension ${s}: enable\n`).join('');
        const defines = ctx.defines.join('');
        return version + extensions + precisions + defines + body;
    }
    toWGSL(indent, ctx) {
        const structNames = ctx.type === ShaderType.Vertex ? [
            BuiltinInputStructNameVS,
            BuiltinOutputStructNameVS
        ] : ctx.type === ShaderType.Fragment ? [
            BuiltinInputStructNameFS,
            BuiltinOutputStructNameFS
        ] : [
            BuiltinInputStructNameCS
        ];
        const usedBuiltins = [];
        for (const k of ctx.builtins){
            usedBuiltins.push(builtinVariables.webgpu[k].name);
        }
        const allBuiltins = Object.keys(builtinVariables.webgpu).map((val)=>builtinVariables.webgpu[val].name);
        for (const type of ctx.types){
            if (type instanceof ASTStructDefine && structNames.indexOf(type.type.structName) >= 0) {
                for(let i = type.type.structMembers.length - 1; i >= 0; i--){
                    const member = type.type.structMembers[i];
                    if ('name' in member && allBuiltins.indexOf(member.name) >= 0 && usedBuiltins.indexOf(member.name) < 0) {
                        type.type.structMembers.splice(i, 1);
                        type.prefix.splice(i, 1);
                    }
                }
            }
        }
        ctx.types = ctx.types.filter((val)=>!(val instanceof ASTStructDefine) || val.type.structMembers.length > 0);
        return ctx.types.map((val)=>val.toWGSL(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWGSL(indent, ctx)).join('') + super.toWGSL(indent, ctx);
    }
}
/** @internal */ class ASTPrimitive extends ASTExpression {
    /** @internal */ value;
    /** @internal */ ref;
    /** @internal */ writable;
    /** @internal */ constExp;
    constructor(value){
        super();
        this.value = value;
        this.ref = null;
        this.writable = false;
        this.constExp = false;
    }
    get name() {
        return this.value.$str;
    }
    isReference() {
        return true;
    }
    isConstExp() {
        return this.constExp;
    }
    markWritable() {
        this.writable = true;
        this.constExp = false;
        if (this.ref) {
            this.ref.markWritable();
        }
    }
    isWritable() {
        const type = this.getType();
        return this.writable || type.isAtomicI32() || type.isAtomicU32() || type.isStructType() && type.haveAtomicMembers();
    }
    getAddressSpace() {
        switch(this.value.$declareType){
            case 4:
                return PBAddressSpace.UNIFORM;
            case 5:
                return PBAddressSpace.STORAGE;
            case 1:
            case 2:
                return null;
            default:
                return this.value.$global ? PBAddressSpace.PRIVATE : PBAddressSpace.FUNCTION;
        }
    }
    getType() {
        return this.value.$typeinfo;
    }
    toWebGL(_indent, _ctx) {
        return this.name;
    }
    toWebGL2(_indent, _ctx) {
        return this.name;
    }
    toWGSL(indent, ctx) {
        if (this.value.$declareType === 1) {
            const structName = getBuiltinInputStructInstanceName(ctx.type);
            return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
        } else if (this.value.$declareType === 2) {
            const structName = getBuiltinOutputStructInstanceName(ctx.type);
            return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
        } else {
            return this.name;
        }
    }
    toString(_deviceType) {
        return this.name;
    }
}
/** @internal */ class ASTLValue extends ShaderAST {
}
/** @internal */ class ASTLValueScalar extends ASTLValue {
    /** @internal */ value;
    constructor(value){
        super();
        if (value.getAddressSpace() === PBAddressSpace.UNIFORM) {
            throw new PBASTError(value, 'cannot assign to uniform variable');
        }
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        return this.value.getType();
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isReference() {
        return this.value.isReference();
    }
    toWebGL(indent, ctx) {
        return this.value.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.value.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.value.toWGSL(indent, ctx);
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTLValueHash extends ASTLValue {
    /** @internal */ scope;
    /** @internal */ field;
    /** @internal */ type;
    constructor(scope, field, type){
        super();
        this.scope = scope;
        this.field = field;
        this.type = type;
    }
    getType() {
        return this.type;
    }
    markWritable() {
        this.scope.markWritable();
    }
    isWritable() {
        return this.scope.isWritable();
    }
    isReference() {
        return this.scope.isReference();
    }
    toWebGL(indent, ctx) {
        return `${this.scope.toWebGL(indent, ctx)}.${this.field}`;
    }
    toWebGL2(indent, ctx) {
        return `${this.scope.toWebGL2(indent, ctx)}.${this.field}`;
    }
    toWGSL(indent, ctx) {
        const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
        return `${scope.toWGSL(indent, ctx)}.${this.field}`;
    }
    toString(deviceType) {
        const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
        return `${scope.toString(deviceType)}.${this.field}`;
    }
}
/** @internal */ class ASTLValueArray extends ASTLValue {
    /** @internal */ value;
    /** @internal */ index;
    /** @internal */ type;
    constructor(value, index, type){
        super();
        this.value = value;
        this.index = index;
        this.type = type;
        if (this.index instanceof ASTCallFunction) {
            this.index.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isReference() {
        return this.value.isReference();
    }
    toWebGL(indent, ctx) {
        return `${this.value.toWebGL(indent, ctx)}[${this.index.toWebGL(indent, ctx)}]`;
    }
    toWebGL2(indent, ctx) {
        return `${this.value.toWebGL2(indent, ctx)}[${this.index.toWebGL2(indent, ctx)}]`;
    }
    toWGSL(indent, ctx) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${value.toWGSL(indent, ctx)}[${this.index.toWGSL(indent, ctx)}]`;
    }
    toString(deviceType) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${value.toString(deviceType)}[${this.index.toString(deviceType)}]`;
    }
}
/** @internal */ class ASTLValueDeclare extends ASTLValue {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        this.value.constExp = true;
    }
    getType() {
        return this.value.getType();
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isReference() {
        return true;
    }
    toWebGL(_indent, _ctx) {
        let prefix = '';
        switch(this.value.value.$declareType){
            case 1:
            case 2:
            case 4:
            case 5:
                throw new Error('invalid declare type');
            default:
                prefix = this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
                break;
        }
        return `${prefix}${this.getType().toTypeName('webgl', this.value.name)}`;
    }
    toWebGL2(_indent, _ctx) {
        let prefix = '';
        switch(this.value.value.$declareType){
            case 1:
            case 2:
            case 4:
            case 5:
                throw new Error('invalid declare type');
            default:
                prefix = this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
                break;
        }
        return `${prefix}${this.getType().toTypeName('webgl2', this.value.name)}`;
    }
    toWGSL(_indent, _ctx) {
        let prefix;
        switch(this.value.value.$declareType){
            case 1:
            case 2:
            case 4:
            case 5:
                throw new Error('invalid declare type');
            default:
                {
                    const addressSpace = this.value.getAddressSpace();
                    const readonly = this.getType().isPointerType() || !this.value.isWritable() && (addressSpace === PBAddressSpace.PRIVATE || addressSpace === PBAddressSpace.FUNCTION);
                    const moduleScope = addressSpace === PBAddressSpace.PRIVATE;
                    const storageAccessMode = addressSpace === PBAddressSpace.STORAGE && this.value.isWritable() ? ', read_write' : '';
                    const decorator = addressSpace !== PBAddressSpace.FUNCTION ? `<${addressSpace}${storageAccessMode}>` : '';
                    prefix = readonly ? moduleScope ? 'const ' : 'let ' : `var${decorator} `;
                    break;
                }
        }
        // const decl = this.value.value.$global ? this.getType().toTypeName('webgpu', this.value.name) : this.value.name;
        const type = this.getType();
        if (type.isPointerType() && (this.value.isWritable() || this.value.ref.isWritable())) {
            type.writable = true;
        }
        const decl = type.toTypeName('webgpu', this.value.name);
        return `${prefix}${decl}`;
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTShaderExpConstructor extends ASTExpression {
    /** @internal */ type;
    /** @internal */ args;
    /** @internal */ constExp;
    /** @internal */ convertedArgs;
    constructor(type, args){
        super();
        this.type = type;
        this.args = args;
        this.constExp = true;
        for (const arg of args){
            if (arg === null || arg === undefined) {
                throw new Error('invalid constructor argument');
            }
            if (arg instanceof ASTCallFunction) {
                arg.isStatement = false;
            }
            this.constExp &&= !(arg instanceof ASTExpression) || arg.isConstExp();
        }
        const deviceType = getCurrentProgramBuilder().getDevice().type;
        const overloads = this.type.getConstructorOverloads(deviceType);
        for (const overload of overloads){
            const convertedArgs = convertArgs(this.args, overload);
            if (convertedArgs) {
                this.convertedArgs = convertedArgs;
                break;
            }
        }
        if (!this.convertedArgs) {
            throw new Error(`no matching overload function found for type ${this.type.toTypeName(deviceType)}`);
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.constExp;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        const c = this.convertedArgs.args.map((arg)=>unbracket(arg.toWebGL(indent, ctx))).join(',');
        return `${this.convertedArgs.name}(${c})`;
    }
    toWebGL2(indent, ctx) {
        const c = this.convertedArgs.args.map((arg)=>unbracket(arg.toWebGL2(indent, ctx))).join(',');
        return `${this.convertedArgs.name}(${c})`;
    }
    toWGSL(indent, ctx) {
        const c = this.convertedArgs.args.map((arg)=>unbracket(arg.toWGSL(indent, ctx))).join(',');
        return `${this.convertedArgs.name}(${c})`;
    }
    toString(_deviceType) {
        return 'constructor';
    }
}
/** @internal */ class ASTScalar extends ASTExpression {
    /** @internal */ value;
    /** @internal */ type;
    constructor(value, type){
        super();
        this.value = value;
        this.type = type;
        if (typeof value === 'number') {
            if (type.primitiveType === PBPrimitiveType.BOOL) {
                throw new PBTypeCastError(value, typeof value, type);
            }
            if (type.primitiveType === PBPrimitiveType.I32 && (!Number.isInteger(value) || value < 0x80000000 >> 0 || value > 0xffffffff)) {
                throw new PBTypeCastError(value, typeof value, type);
            }
            if (value < 0 && type.primitiveType === PBPrimitiveType.U32 && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
                throw new PBTypeCastError(value, typeof value, type);
            }
        } else if (type.primitiveType !== PBPrimitiveType.BOOL) {
            throw new PBTypeCastError(value, typeof value, type);
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return true;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(_indent, _ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return `${toUint(this.value)}u`;
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toWebGL2(_indent, _ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return `${toUint(this.value)}u`;
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toWGSL(_indent, _ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return `${toUint(this.value)}u`;
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toString(_deviceType) {
        return `${this.value}`;
    }
}
/** @internal */ class ASTHash extends ASTExpression {
    /** @internal */ source;
    /** @internal */ field;
    /** @internal */ type;
    constructor(source, field, type){
        super();
        this.source = source;
        this.field = field;
        this.type = type;
        if (this.source instanceof ASTCallFunction) {
            this.source.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    isReference() {
        return this.source.isReference();
    }
    isConstExp() {
        return this.source.isConstExp();
    }
    markWritable() {
        this.source.markWritable();
    }
    isWritable() {
        return this.source.isWritable();
    }
    getAddressSpace() {
        return this.source.getAddressSpace();
    }
    toWebGL(indent, ctx) {
        return this.source instanceof ASTScalar ? `(${this.source.toWebGL(indent, ctx)}).${this.field}` : `${this.source.toWebGL(indent, ctx)}.${this.field}`;
    }
    toWebGL2(indent, ctx) {
        return this.source instanceof ASTScalar ? `(${this.source.toWebGL(indent, ctx)}).${this.field}` : `${this.source.toWebGL(indent, ctx)}.${this.field}`;
    }
    toWGSL(indent, ctx) {
        const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
        return source instanceof ASTScalar ? `(${source.toWGSL(indent, ctx)}).${this.field}` : `${source.toWGSL(indent, ctx)}.${this.field}`;
    }
    toString(deviceType) {
        const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
        return `${source.toString(deviceType)}.${this.field}`;
    }
}
/** @internal */ class ASTCast extends ASTExpression {
    /** @internal */ sourceValue;
    /** @internal */ castType;
    constructor(source, type){
        super();
        this.sourceValue = source;
        this.castType = type;
        if (this.sourceValue instanceof ASTCallFunction) {
            this.sourceValue.isStatement = false;
        }
    }
    getType() {
        return this.castType;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.sourceValue.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgl')}(${unbracket(this.sourceValue.toWebGL(indent, ctx))})`;
        } else {
            return this.sourceValue.toWebGL(indent, ctx);
        }
    }
    toWebGL2(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgl2')}(${unbracket(this.sourceValue.toWebGL2(indent, ctx))})`;
        } else {
            return this.sourceValue.toWebGL2(indent, ctx);
        }
    }
    toWGSL(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgpu')}(${unbracket(this.sourceValue.toWGSL(indent, ctx))})`;
        } else {
            return this.sourceValue.toWGSL(indent, ctx);
        }
    }
    toString(deviceType) {
        return `${this.castType.toTypeName(deviceType)}(${unbracket(this.sourceValue.toString(deviceType))})`;
    }
}
/** @internal */ class ASTAddressOf extends ASTExpression {
    /** @internal */ value;
    /** @internal */ type;
    constructor(value){
        super();
        ASSERT(value.isReference(), 'no pointer type for non-reference values');
        this.value = value;
        this.type = new PBPointerTypeInfo(value.getType(), value.getAddressSpace());
    }
    getType() {
        return this.type;
    }
    isConstExp() {
        return false;
    }
    markWritable() {
        const addressSpace = this.value.getAddressSpace();
        if (addressSpace === PBAddressSpace.UNIFORM) {
            throw new PBASTError(this.value, 'uniforms are not writable');
        }
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    getAddressSpace() {
        return this.value.getAddressSpace();
    }
    toWebGL(_indent, _ctx) {
        throw new Error('GLSL does not support pointer type');
    }
    toWebGL2(_indent, _ctx) {
        throw new Error('GLSL does not support pointer type');
    }
    toWGSL(indent, ctx) {
        const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
        return ast instanceof ASTReferenceOf ? ast.value.toWGSL(indent, ctx) : `(&${ast.toWGSL(indent, ctx)})`;
    }
    toString(deviceType) {
        const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
        return ast instanceof ASTReferenceOf ? ast.value.toString(deviceType) : `(&${ast.toString(deviceType)})`;
    }
}
/** @internal */ class ASTReferenceOf extends ASTExpression {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        const type = this.value.getType();
        return type.isPointerType() ? type.pointerType : type;
    }
    isReference() {
        return true;
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isConstExp() {
        return false;
    }
    getAddressSpace() {
        return this.value instanceof ASTExpression ? this.value.getAddressSpace() : null;
    }
    toWebGL(indent, ctx) {
        return this.value.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.value.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.value.getType().isPointerType() ? `(*${this.value.toWGSL(indent, ctx)})` : this.value.toWGSL(indent, ctx);
    }
    toString(deviceType) {
        return `*${this.value.toString(deviceType)}`;
    }
}
/** @internal */ class ASTUnaryFunc extends ASTExpression {
    /** @internal */ value;
    /** @internal */ op;
    /** @internal */ type;
    constructor(value, op, type){
        super();
        this.value = value;
        this.op = op;
        this.type = type;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.value.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `${this.op}${this.value.toWebGL(indent, ctx)}`;
    }
    toWebGL2(indent, ctx) {
        return `${this.op}${this.value.toWebGL2(indent, ctx)}`;
    }
    toWGSL(indent, ctx) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${this.op}${value.toWGSL(indent, ctx)}`;
    }
    toString(deviceType) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${this.op}${value.toString(deviceType)}`;
    }
}
/** @internal */ class ASTBinaryFunc extends ASTExpression {
    /** @internal */ left;
    /** @internal */ right;
    /** @internal */ type;
    /** @internal */ op;
    constructor(left, right, op, type){
        super();
        this.left = left;
        this.right = right;
        this.op = op;
        this.type = type;
        if (this.left instanceof ASTCallFunction) {
            this.left.isStatement = false;
        }
        if (this.right instanceof ASTCallFunction) {
            this.right.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.left.isConstExp() && this.right.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `(${this.left.toWebGL(indent, ctx)} ${this.op} ${this.right.toWebGL(indent, ctx)})`;
    }
    toWebGL2(indent, ctx) {
        return `(${this.left.toWebGL2(indent, ctx)} ${this.op} ${this.right.toWebGL2(indent, ctx)})`;
    }
    toWGSL(indent, ctx) {
        const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
        const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
        return `(${left.toWGSL(indent, ctx)} ${this.op} ${right.toWGSL(indent, ctx)})`;
    }
    toString(deviceType) {
        const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
        const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
        return `(${left.toString(deviceType)} ${this.op} ${right.toString(deviceType)})`;
    }
}
/** @internal */ class ASTArrayIndex extends ASTExpression {
    /** @internal */ source;
    /** @internal */ index;
    /** @internal */ type;
    constructor(source, index, type){
        super();
        this.source = source;
        this.index = index;
        this.type = type;
        if (this.source instanceof ASTCallFunction) {
            this.source.isStatement = false;
        }
        if (this.index instanceof ASTCallFunction) {
            this.index.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    isReference() {
        return this.source.isReference();
    }
    markWritable() {
        this.source.markWritable();
    }
    isWritable() {
        return this.source.isWritable();
    }
    isConstExp() {
        return this.source.isConstExp() && this.index.isConstExp();
    }
    getAddressSpace() {
        return this.source.getAddressSpace();
    }
    toWebGL(indent, ctx) {
        return `${this.source.toWebGL(indent, ctx)}[${unbracket(this.index.toWebGL(indent, ctx))}]`;
    }
    toWebGL2(indent, ctx) {
        return `${this.source.toWebGL2(indent, ctx)}[${unbracket(this.index.toWebGL2(indent, ctx))}]`;
    }
    toWGSL(indent, ctx) {
        return `${this.source.toWGSL(indent, ctx)}[${unbracket(this.index.toWGSL(indent, ctx))}]`;
    }
    toString(deviceType) {
        return `${this.source.toString(deviceType)}[${unbracket(this.index.toString(deviceType))}]`;
    }
}
/** @internal */ class ASTTouch extends ShaderAST {
    /** @internal */ value;
    constructor(value){
        super();
        if (value.getType().isVoidType()) {
            throw new Error('can not touch void type');
        }
        if (value instanceof ASTCallFunction) {
            value.isStatement = false;
        }
        this.value = value;
    }
    toWebGL(indent, ctx) {
        return `${indent}${this.value.toWebGL('', ctx)};\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}${this.value.toWebGL2('', ctx)};\n`;
    }
    toWGSL(indent, ctx) {
        if (!this.value.getType().isVoidType()) {
            return `${indent}_ = ${this.value.toWGSL('', ctx)};\n`;
        } else {
            return `${indent}${this.value.toWGSL('', ctx)};\n`;
        }
    }
}
/** @internal */ class ASTSelect extends ASTExpression {
    /** @internal */ condition;
    /** @internal */ first;
    /** @internal */ second;
    /** @internal */ type;
    constructor(condition, first, second){
        super();
        if (condition instanceof ASTCallFunction) {
            condition.isStatement = false;
        }
        if (first instanceof ASTCallFunction) {
            first.isStatement = false;
        }
        if (second instanceof ASTCallFunction) {
            second.isStatement = false;
        }
        this.condition = condition instanceof ASTExpression ? condition : new ASTScalar(condition, typeBool);
        let firstType = null;
        let secondType = null;
        if (first instanceof ASTExpression) {
            firstType = first.getType();
            this.first = first;
            if (first instanceof ASTCallFunction) {
                first.isStatement = false;
            }
        } else if (typeof first === 'number') {
            if (!Number.isInteger(first)) {
                this.first = new ASTScalar(first, typeF32);
                firstType = typeF32;
            }
        } else if (typeof first === 'boolean') {
            this.first = new ASTScalar(first, typeBool);
            firstType = typeBool;
        } else {
            throw new Error('select: invalid first value');
        }
        if (second instanceof ASTExpression) {
            secondType = second.getType();
            this.second = second;
            if (second instanceof ASTCallFunction) {
                second.isStatement = false;
            }
        } else if (typeof second === 'number') {
            if (!Number.isInteger(second)) {
                this.second = new ASTScalar(second, typeF32);
                secondType = typeF32;
            }
        } else if (typeof second === 'boolean') {
            this.second = new ASTScalar(second, typeBool);
            secondType = typeBool;
        } else {
            throw new Error('select: invalid second value');
        }
        if (!firstType && !secondType) {
            throw new Error('select: cannot determine the value types');
        }
        if (firstType && secondType) {
            if (!firstType.isCompatibleType(secondType)) {
                throw new Error('select: first value and second value must be the same type');
            } else {
                this.type = firstType;
            }
        } else if (!firstType) {
            if (secondType.typeId === typeF32.typeId) {
                this.first = new ASTScalar(first, typeF32);
            } else if (secondType.typeId === typeI32.typeId) {
                this.first = new ASTScalar(first, typeI32);
            } else if (secondType.typeId === typeU32.typeId) {
                this.first = new ASTScalar(first, typeU32);
            } else {
                throw new Error('select: invalid type of the first value');
            }
            this.type = secondType;
        } else {
            if (firstType.typeId === typeF32.typeId) {
                this.second = new ASTScalar(second, typeF32);
            } else if (firstType.typeId === typeI32.typeId) {
                this.second = new ASTScalar(second, typeI32);
            } else if (firstType.typeId === typeU32.typeId) {
                this.second = new ASTScalar(second, typeU32);
            } else {
                throw new Error('select: invalid type of the second value');
            }
            this.type = firstType;
        }
    }
    getType() {
        return this.type;
    }
    isConstExp() {
        return false;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `${indent}(${this.condition.toWebGL('', ctx)} ? ${this.first.toWebGL('', ctx)} : ${this.second.toWebGL('', ctx)})`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}(${this.condition.toWebGL2('', ctx)} ? ${this.first.toWebGL2('', ctx)} : ${this.second.toWebGL2('', ctx)})`;
    }
    toWGSL(indent, ctx) {
        return `${indent}select(${this.second.toWGSL('', ctx)}, ${this.first.toWGSL('', ctx)}, ${this.condition.toWGSL('', ctx)})`;
    //return `${indent}${this.condition.toWGSL('', ctx)} ? ${this.first.toWGSL('', ctx)} : ${this.second.toWGSL('', ctx)}`;
    }
}
/** @internal */ class ASTAssignment extends ShaderAST {
    /** @internal */ lvalue;
    /** @internal */ rvalue;
    constructor(lvalue, rvalue){
        super();
        if (!lvalue.isReference()) {
            throw new Error('assignment: l-value required');
        }
        this.lvalue = lvalue;
        this.rvalue = rvalue;
        if (!(this.lvalue instanceof ASTLValueDeclare)) {
            if (this.lvalue.getType().isPointerType()) {
                throw new PBASTError(this.lvalue, 'cannot assign to read-only variable');
            }
            this.lvalue.markWritable();
        } else if (this.lvalue.getType().isPointerType()) {
            if (this.rvalue instanceof ASTPrimitive) {
                this.lvalue.value.ref = this.rvalue.ref;
            } else if (this.rvalue instanceof ASTAddressOf) {
                this.lvalue.value.ref = this.rvalue.value;
            } else {
                throw new PBASTError(this.lvalue, 'invalid pointer assignment');
            }
        } else if (this.rvalue instanceof ASTExpression) {
            this.lvalue.value.constExp = this.rvalue.isConstExp();
        }
        if (this.rvalue instanceof ASTCallFunction) {
            this.rvalue.isStatement = false;
        }
        const ltype = this.lvalue.getType();
        const valueTypeLeft = ltype.isPointerType() ? ltype.pointerType : ltype;
        const rtype = this.checkScalarType(this.rvalue, valueTypeLeft);
        const rvalueIsPtr = rtype && rtype.isPointerType();
        const valueTypeRight = rvalueIsPtr ? rtype.pointerType : rtype;
        if (!valueTypeLeft.isCompatibleType(valueTypeRight)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString(rtype.isPointerType() ? 'webgpu' : 'webgl') : `${this.rvalue}`, rtype, ltype);
        }
    }
    getType() {
        return null;
    }
    toWebGL(indent, ctx) {
        let rhs;
        const ltype = this.lvalue.getType();
        const rtype = this.checkScalarType(this.rvalue, ltype);
        if (!ltype.isCompatibleType(rtype)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl') : `${this.rvalue}`, rtype, ltype);
        }
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWebGL(indent, ctx));
        }
        if (this.lvalue instanceof ASTLValueDeclare) {
            this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
        }
        return `${indent}${this.lvalue.toWebGL(indent, ctx)} = ${rhs};\n`;
    }
    toWebGL2(indent, ctx) {
        let rhs;
        const ltype = this.lvalue.getType();
        const rtype = this.checkScalarType(this.rvalue, ltype);
        if (!ltype.isCompatibleType(rtype)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl2') : `${this.rvalue}`, rtype, ltype);
        }
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWebGL2(indent, ctx));
        }
        if (this.lvalue instanceof ASTLValueDeclare) {
            this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
        }
        return `${indent}${this.lvalue.toWebGL2(indent, ctx)} = ${rhs};\n`;
    }
    toWGSL(indent, ctx) {
        const ltype = this.lvalue.getType();
        const [valueTypeLeft, lvalueIsPtr] = ltype.isPointerType() ? [
            ltype.pointerType,
            true
        ] : [
            ltype,
            false
        ];
        const rtype = this.checkScalarType(this.rvalue, valueTypeLeft);
        const rvalueIsPtr = rtype && rtype.isPointerType();
        const valueTypeRight = rvalueIsPtr ? rtype.pointerType : rtype;
        if (!valueTypeLeft.isCompatibleType(valueTypeRight)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgpu') : `${this.rvalue}`, rtype, ltype);
        }
        if (this.lvalue instanceof ASTLValueScalar || this.lvalue instanceof ASTLValueDeclare) {
            const structName = valueTypeLeft.isStructType() ? valueTypeLeft.structName : null;
            if (structName && ctx.types.findIndex((val)=>val instanceof ASTStructDefine && val.type.structName === structName) < 0) {
                return '';
            }
        }
        let rhs;
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWGSL(indent, ctx));
        }
        const name = this.lvalue.toWGSL(indent, ctx);
        if (lvalueIsPtr && !rvalueIsPtr) {
            if (this.lvalue instanceof ASTLValueDeclare) {
                throw new Error(`rvalue must be pointer type: ${rhs}`);
            } else {
                return `${indent}*(${name}) = ${rhs};\n`;
            }
        } else if (rvalueIsPtr && !lvalueIsPtr) {
            return `${indent}${name} = *(${rhs});\n`;
        } else {
            return `${indent}${name} = ${rhs};\n`;
        }
    }
    checkScalarType(value, targetType) {
        if (value instanceof ASTExpression) {
            return value.getType();
        }
        const isBool = typeof value === 'boolean';
        const isInt = typeof value === 'number' && Number.isInteger(value) && value >= 0x80000000 >> 0 && value <= 0x7fffffff;
        const isUint = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
        const isFloat = typeof value === 'number';
        if (targetType.isPrimitiveType()) {
            switch(targetType.primitiveType){
                case PBPrimitiveType.BOOL:
                    return isBool ? targetType : isInt ? typeI32 : isUint ? typeU32 : typeF32;
                case PBPrimitiveType.F32:
                    return isFloat ? targetType : typeBool;
                case PBPrimitiveType.I32:
                    return isInt ? targetType : isBool ? typeBool : isUint ? typeU32 : typeF32;
                case PBPrimitiveType.U32:
                    return isUint ? targetType : isBool ? typeBool : isInt ? typeI32 : typeF32;
                default:
                    return null;
            }
        } else {
            return isBool ? typeBool : isInt ? typeI32 : isUint ? typeU32 : typeF32;
        }
    }
}
/** @internal */ class ASTDiscard extends ShaderAST {
    toWebGL(indent, _ctx) {
        return `${indent}discard;\n`;
    }
    toWebGL2(indent, _ctx) {
        return `${indent}discard;\n`;
    }
    toWGSL(indent, _ctx) {
        return `${indent}discard;\n`;
    }
}
/** @internal */ class ASTBreak extends ShaderAST {
    toWebGL(indent, _ctx) {
        return `${indent}break;\n`;
    }
    toWebGL2(indent, _ctx) {
        return `${indent}break;\n`;
    }
    toWGSL(indent, _ctx) {
        return `${indent}break;\n`;
    }
}
/** @internal */ class ASTContinue extends ShaderAST {
    toWebGL(indent, _ctx) {
        return `${indent}continue;\n`;
    }
    toWebGL2(indent, _ctx) {
        return `${indent}continue;\n`;
    }
    toWGSL(indent, _ctx) {
        return `${indent}continue;\n`;
    }
}
/** @internal */ class ASTReturn extends ShaderAST {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWebGL(indent, ctx))};\n` : `${indent}return;\n`;
    }
    toWebGL2(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWebGL2(indent, ctx))};\n` : `${indent}return;\n`;
    }
    toWGSL(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWGSL(indent, ctx))};\n` : `${indent}return;\n`;
    }
}
/** @internal */ class ASTCallFunction extends ASTExpression {
    /** @internal */ name;
    /** @internal */ args;
    /** @internal */ retType;
    /** @internal */ func;
    /** @internal */ isStatement;
    constructor(name, args, func, deviceType, retType){
        super();
        this.name = name;
        this.args = args;
        this.retType = func?.returnType ?? retType ?? typeVoid;
        this.func = func;
        this.isStatement = true;
        if (func) {
            if (func.funcType.argTypes.length !== this.args.length) {
                throw new PBInternalError(`ASTCallFunction(): number of parameters mismatch`);
            }
            for(let i = 0; i < this.args.length; i++){
                const funcArg = func.funcType.argTypes[i];
                if (funcArg.byRef) {
                    if (deviceType === 'webgpu') {
                        const argAddressSpace = args[i].getAddressSpace();
                        if (argAddressSpace !== PBAddressSpace.FUNCTION && argAddressSpace !== PBAddressSpace.PRIVATE) {
                            throw new PBParamTypeError(name, 'pointer type of function parameter must be function or private');
                        }
                        const argType = funcArg.type;
                        if (!argType.isPointerType()) {
                            throw new PBInternalError(`ASTCallFunction(): invalid reference type`);
                        }
                        if (argType.addressSpace === PBAddressSpace.UNKNOWN) {
                            argType.addressSpace = argAddressSpace;
                        } else if (argType.addressSpace !== argAddressSpace) {
                            throw new PBParamTypeError(name, `invalid pointer parameter address space '${argAddressSpace}', should be '${argType.addressSpace}`);
                        }
                    }
                    this.args[i].markWritable();
                }
            }
        }
        for (const arg of this.args){
            if (arg instanceof ASTCallFunction) {
                arg.isStatement = false;
            }
        }
    }
    getType() {
        return this.retType;
    }
    isConstExp() {
        return false;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        if (this.name === 'dFdx' || this.name === 'dFdy' || this.name === 'fwidth') {
            ctx.extensions.add('GL_OES_standard_derivatives');
        } else if (this.name === 'texture2DLodEXT' || this.name === 'texture2DProjLodEXT' || this.name === 'textureCubeLodEXT' || this.name === 'texture2DGradEXT' || this.name === 'texture2DProjGradEXT' || this.name === 'textureCubeGradEXT') {
            ctx.extensions.add('GL_EXT_shader_texture_lod');
        }
        const args = this.args.map((arg)=>unbracket(arg.toWebGL(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toWebGL2(indent, ctx) {
        const args = this.args.map((arg)=>unbracket(arg.toWebGL2(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toWGSL(indent, ctx) {
        let thisArgs = this.args;
        if (this.func) {
            let argsNew = null;
            const convertedArgs = convertArgs(thisArgs, this.func.funcType);
            if (convertedArgs) {
                argsNew = convertedArgs.args;
            }
            if (!argsNew) {
                throw new Error(`no matching overloading found for function '${this.name}'`);
            }
            thisArgs = argsNew.filter((val)=>{
                const type = val.getType();
                if (type.isStructType() && ctx.types.findIndex((t)=>t instanceof ASTStructDefine && t.type.structName === type.structName) < 0) {
                    return false;
                }
                return true;
            });
        }
        const args = thisArgs.map((arg)=>unbracket(arg.toWGSL(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toString(_deviceType) {
        return `${this.name}(...)`;
    }
}
/** @internal */ class ASTDeclareVar extends ShaderAST {
    /** @internal */ value;
    /** @internal */ group;
    /** @internal */ binding;
    /** @internal */ blockName;
    constructor(exp){
        super();
        this.value = exp;
        this.group = 0;
        this.binding = 0;
        this.blockName = '';
    }
    isReference() {
        return true;
    }
    isPointer() {
        return this.value.getType().isPointerType();
    }
    toWebGL(indent, ctx) {
        let prefix = '';
        let builtin = false;
        let valueType = this.value.getType();
        switch(this.value.value.$declareType){
            case 1:
                if (ctx.type === ShaderType.Vertex) {
                    prefix = 'attribute ';
                    ctx.defines.push(`#define ${this.value.name} ${semanticToAttrib(ctx.vertexAttributes[this.value.value.$location])}\n`);
                } else {
                    prefix = 'varying ';
                // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
                }
                break;
            case 2:
                if (ctx.type === ShaderType.Vertex) {
                    prefix = 'varying ';
                // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
                } else {
                    builtin = true;
                    if (ctx.mrt) {
                        ctx.defines.push(`#define ${this.value.name} gl_FragData[${this.value.value.$location}]\n`);
                        ctx.extensions.add('GL_EXT_draw_buffers');
                    } else {
                        ctx.defines.push(`#define ${this.value.name} gl_FragColor\n`);
                    }
                }
                break;
            case 4:
                prefix = 'uniform ';
                valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
                break;
            case 5:
                throw new Error(`invalid variable declare type: ${this.value.name}`);
        }
        if (!builtin) {
            return `${indent}${prefix}${valueType.toTypeName('webgl', this.value.name)};\n`;
        }
        return '';
    }
    toWebGL2(indent, ctx) {
        let prefix = '';
        let valueType = this.value.getType();
        switch(this.value.value.$declareType){
            case 1:
                if (ctx.type === ShaderType.Fragment && valueType.isPrimitiveType() && valueType.isInteger()) {
                    prefix = 'flat in ';
                } else {
                    prefix = 'in ';
                }
                if (ctx.type === ShaderType.Vertex) {
                    ctx.defines.push(`#define ${this.value.name} ${semanticToAttrib(ctx.vertexAttributes[this.value.value.$location])}\n`);
                }
                break;
            case 2:
                if (ctx.type === ShaderType.Vertex) {
                    if (valueType.isPrimitiveType() && valueType.isInteger()) {
                        prefix = 'flat out ';
                    } else {
                        prefix = 'out ';
                    }
                } else {
                    prefix = `layout(location = ${this.value.value.$location}) out `;
                }
                break;
            case 4:
                if (valueType.isStructType()) {
                    /*
          if (valueType.layout !== 'std140') {
            throw new errors.PBASTError(this, 'uniform buffer layout must be std140');
          }
          */ return `${indent}layout(std140) uniform ${this.blockName} { ${valueType.structName} ${this.value.name}; };\n`;
                } else {
                    valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
                    return `${indent}uniform ${valueType.toTypeName('webgl2', this.value.name)};\n`;
                }
            case 5:
                throw new Error(`invalid variable declare type: ${this.value.name}`);
        }
        return `${indent}${prefix}${this.value.getType().toTypeName('webgl2', this.value.name)};\n`;
    }
    toWGSL(indent, ctx) {
        let prefix;
        const isBlock = this.value.getType().isPrimitiveType() || this.value.getType().isStructType() || this.value.getType().isArrayType();
        switch(this.value.value.$declareType){
            case 1:
            case 2:
                // prefix = `@location(${this.value.value.$location}) var<out> `;
                throw new Error(`Internal error`);
            case 4:
                prefix = `@group(${this.group}) @binding(${this.binding}) var${isBlock ? '<uniform>' : ''} `;
                break;
            case 5:
                prefix = `@group(${this.group}) @binding(${this.binding}) var<storage, ${this.value.value.$readonly ? 'read' : 'read_write' //this.value.isWritable() || this.value.getType().haveAtomicMembers() ? 'read_write' : 'read'
                }> `;
                break;
            case 3:
                prefix = `var<workgroup> `;
                break;
            default:
                prefix = `${this.value.getType().isPointerType() ? 'let' : 'var'}${this.value.value.$global && !this.value.getType().isPointerType() ? '<private>' : ''} `;
        }
        const type = this.value.getType();
        const structName = type.isStructType() ? type.structName : null;
        if (structName && ctx.types.findIndex((val)=>val instanceof ASTStructDefine && val.type.structName === structName) < 0) {
            return '';
        } else {
            return `${indent}${prefix}${type.toTypeName('webgpu', this.value.name)};\n`;
        }
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTFunction extends ASTScope {
    /** @internal */ name;
    /** @internal */ args;
    /** @internal */ isBuiltin;
    /** @internal */ isMainFunc;
    /** @internal */ funcType;
    /** @internal */ builtins;
    /** @internal */ returnType;
    constructor(name, args, isMainFunc, type, isBuiltin = false){
        super();
        this.name = name;
        this.args = args;
        this.funcType = type;
        this.builtins = [];
        this.isBuiltin = isBuiltin;
        this.isMainFunc = isMainFunc;
        this.returnType = type ? type.returnType : null;
    }
    toWebGL(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [];
            for (const param of this.args){
                let exp;
                let name;
                let qualifier;
                if (param.paramAST instanceof ASTPrimitive) {
                    exp = param.paramAST.value;
                    name = param.paramAST.name;
                    qualifier = '';
                } else {
                    exp = param.paramAST.value.value;
                    name = param.paramAST.value.name;
                    qualifier = `${exp.$inout} `;
                }
                p.push(`${qualifier}${param.getType().toTypeName('webgl', name)}`);
            }
            str += `${indent}${this.returnType.toTypeName('webgl')} ${this.name}(${p.join(',')}) {\n`;
            str += super.toWebGL(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
    toWebGL2(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [];
            for (const param of this.args){
                let exp;
                let name;
                let qualifier;
                if (param.paramAST instanceof ASTPrimitive) {
                    exp = param.paramAST.value;
                    name = param.paramAST.name;
                    qualifier = '';
                } else {
                    exp = param.paramAST.value.value;
                    name = param.paramAST.value.name;
                    qualifier = `${exp.$inout} `;
                }
                p.push(`${qualifier}${param.getType().toTypeName('webgl2', name)}`);
            }
            str += `${indent}${this.returnType.toTypeName('webgl2')} ${this.name}(${p.join(',')}) {\n`;
            str += super.toWebGL2(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
    toWGSL(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [
                ...this.builtins
            ];
            for (const param of this.args){
                const name = param.paramAST instanceof ASTPrimitive ? param.paramAST.name : param.paramAST.value.name;
                const paramType = param.paramAST instanceof ASTPrimitive ? param.paramAST.getType() : param.paramAST.value.getType();
                const dataType = paramType.isPointerType() ? paramType.pointerType : paramType;
                if (dataType.isStructType() && ctx.types.findIndex((t)=>t instanceof ASTStructDefine && t.type.structName === dataType.structName) < 0) {
                    continue;
                }
                p.push(`${paramType.toTypeName('webgpu', name)}`);
            }
            let t = '';
            if (this.isMainFunc) {
                switch(ctx.type){
                    case ShaderType.Vertex:
                        t = '@vertex ';
                        break;
                    case ShaderType.Fragment:
                        t = '@fragment ';
                        break;
                    case ShaderType.Compute:
                        t = `@compute @workgroup_size(${ctx.workgroupSize[0]}, ${ctx.workgroupSize[1]}, ${ctx.workgroupSize[2]}) `;
                        break;
                }
            }
            const retName = this.returnType.isVoidType() ? null : this.returnType.toTypeName('webgpu');
            const retStr = retName ? ` -> ${retName}` : '';
            str += `${indent}${t}fn ${this.name}(${p.join(',')})${retStr} {\n`;
            str += super.toWGSL(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
}
/** @internal */ class ASTIf extends ASTScope {
    /** @internal */ keyword;
    /** @internal */ condition;
    /** @internal */ nextElse;
    constructor(keyword, condition){
        super();
        this.keyword = keyword;
        this.condition = condition;
        this.nextElse = null;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWebGL(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWebGL(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWebGL(indent, ctx);
        }
        return str;
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWebGL2(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWebGL2(indent, ctx);
        }
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWGSL(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWGSL(indent, ctx);
        }
        return str;
    }
}
/** @internal */ class ASTRange extends ASTScope {
    /** @internal */ init;
    /** @internal */ start;
    /** @internal */ end;
    /** @internal */ open;
    /** @internal */ reverse;
    constructor(init, start, end, open, reverse){
        super();
        this.init = init;
        this.start = start;
        this.end = end;
        this.open = open;
        this.reverse = reverse;
        this.statements = [];
        if (this.start instanceof ASTCallFunction) {
            this.start.isStatement = false;
        }
        if (this.end instanceof ASTCallFunction) {
            this.end.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        const init = this.init.getType().toTypeName('webgl', this.init.name);
        const start = unbracket(this.start.toWebGL(indent, ctx));
        const end = unbracket(this.end.toWebGL(indent, ctx));
        const comp = this.open ? this.reverse ? '>' : '<' : this.reverse ? '>=' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}${this.reverse ? '--' : '++'}) {\n`;
        str += super.toWebGL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWebGL2(indent, ctx) {
        const init = this.init.getType().toTypeName('webgl2', this.init.name);
        const start = unbracket(this.start.toWebGL2(indent, ctx));
        const end = unbracket(this.end.toWebGL2(indent, ctx));
        const comp = this.open ? this.reverse ? '>' : '<' : this.reverse ? '>=' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}${this.reverse ? '--' : '++'}) {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        const init = `var ${this.init.getType().toTypeName('webgpu', this.init.name)}`;
        const start = unbracket(this.start.toWGSL(indent, ctx));
        const end = unbracket(this.end.toWGSL(indent, ctx));
        const incr = new ASTScalar(1, this.init.getType()).toWGSL(indent, ctx);
        const comp = this.open ? this.reverse ? '> ' : '<' : this.reverse ? '>=' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name} = ${this.init.name} ${this.reverse ? '-' : '+'} ${incr}) {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
}
/** @internal */ class ASTDoWhile extends ASTScope {
    /** @internal */ condition;
    constructor(condition){
        super();
        this.condition = condition;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(_indent, _ctx) {
        throw new Error(`No do-while() loop support for WebGL1.0 device`);
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}do {\n`;
        str += super.toWebGL2(indent + ' ', ctx);
        str += `${indent}} while(${unbracket(this.condition.toWebGL2(indent, ctx))});\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}loop {\n`;
        str += super.toWGSL(indent + ' ', ctx);
        str += `${indent}  if (!(${unbracket(this.condition.toWGSL(indent, ctx))})) { break; }\n`;
        str += `${indent}}\n`;
        return str;
    }
}
/** @internal */ class ASTWhile extends ASTScope {
    /** @internal */ condition;
    constructor(condition){
        super();
        this.condition = condition;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        let str = `${indent}for(int z_tmp_counter = 0; z_tmp_counter == 0; z_tmp_counter += 0) {\n`;
        const indent2 = indent + '  ';
        str += `${indent2}if(!(${unbracket(this.condition.toWebGL(indent, ctx))})){ break; }\n`;
        str += super.toWebGL(indent2, ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}while(${unbracket(this.condition.toWebGL2(indent, ctx))}) {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}for(;${unbracket(this.condition.toWGSL(indent, ctx))};) {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
}
/** @internal */ class ASTStructDefine extends ShaderAST {
    /** @internal */ type;
    /** @internal */ prefix;
    /** @internal */ builtin;
    constructor(type, builtin){
        super();
        this.prefix = null;
        this.builtin = builtin;
        this.type = type;
    }
    getType() {
        return this.type;
    }
    toWebGL(indent, _ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            for (const arg of this.type.structMembers){
                str += `${indent}  ${arg.type.toTypeName('webgl', arg.name)};\n`;
            }
            str += `${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
    toWebGL2(indent, _ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            for (const arg of this.type.structMembers){
                str += `${indent}  ${arg.type.toTypeName('webgl2', arg.name)};\n`;
            }
            str += `${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
    toWGSL(indent, _ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            str += this.type.structMembers.map((arg, i)=>{
                const prefix = this.prefix ? this.prefix[i] : '';
                const sizePrefix = arg.type.getLayoutSize(this.type.layout) !== arg.type.getLayoutSize('default') ? `@size(${arg.type.getLayoutSize(this.type.layout)}) ` : '';
                const alignPrefix = i > 0 && arg.type.getLayoutAlignment(this.type.layout) !== arg.type.getLayoutAlignment('default') ? `@align(${arg.type.getLayoutAlignment(this.type.layout)}) ` : '';
                return `${indent}  ${prefix}${alignPrefix}${sizePrefix}${arg.type.toTypeName('webgpu', arg.name)}`;
            }).join(',\n');
            str += `\n${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
}
function convertArgs(args, overload) {
    if (args.length !== overload.argTypes.length) {
        return null;
    }
    const result = [];
    for(let i = 0; i < args.length; i++){
        const isRef = !!overload.argTypes[i].byRef;
        const argType = isRef ? overload.argTypes[i].type.pointerType : overload.argTypes[i].type;
        const arg = args[i];
        if (typeof arg === 'number') {
            if (!isRef && argType.isPrimitiveType() && argType.isScalarType() && argType.primitiveType !== PBPrimitiveType.BOOL) {
                result.push(new ASTScalar(arg, argType));
            } else {
                return null;
            }
        } else if (typeof arg === 'boolean') {
            if (!isRef && argType.isPrimitiveType() && argType.primitiveType === PBPrimitiveType.BOOL) {
                result.push(new ASTScalar(arg, argType));
            } else {
                return null;
            }
        } else if (argType.isCompatibleType(arg.getType())) {
            if (isRef) {
                arg.markWritable();
                result.push(new ASTAddressOf(arg));
            } else {
                result.push(arg);
            }
        } else {
            return null;
        }
    }
    return {
        name: overload.name,
        args: result
    };
}

const constructorCache = new Map();
/** @internal */ function makeConstructor(typeFunc, elementType) {
    const wrappedTypeFunc = new Proxy(typeFunc, {
        get: function(target, prop) {
            if (typeof prop === 'symbol' || prop in target) {
                // @ts-ignore 7015 */
                return target[prop];
            }
            let entries = constructorCache.get(typeFunc);
            if (!entries) {
                entries = {};
                constructorCache.set(typeFunc, entries);
            }
            let ctor = entries[prop];
            if (!ctor) {
                if (elementType.isPrimitiveType() || elementType.isStructType() || elementType.isArrayType() || elementType.isAtomicI32() || elementType.isAtomicU32()) {
                    if (prop === 'ptr') {
                        const pointerType = new PBPointerTypeInfo(elementType, PBAddressSpace.FUNCTION);
                        ctor = function pointerCtor(...args) {
                            if (args.length === 1 && typeof args[0] === 'string') {
                                return new PBShaderExp(args[0], pointerType);
                            } else {
                                throw new Error(`Invalid pointer type constructor`);
                            }
                        };
                    } else {
                        const dim = Number(prop);
                        if (Number.isInteger(dim) && dim >= 0) {
                            const arrayType = new PBArrayTypeInfo(elementType, dim);
                            const arrayTypeFunc = function arrayCtor(...args) {
                                if (args.length === 1 && typeof args[0] === 'string') {
                                    return new PBShaderExp(args[0], arrayType);
                                } else {
                                    const exp = new PBShaderExp('', arrayType);
                                    exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, args.map((arg)=>arg instanceof PBShaderExp ? arg.$ast : arg));
                                    return exp;
                                }
                            };
                            ctor = makeConstructor(arrayTypeFunc, arrayType);
                        }
                    }
                }
            }
            if (ctor) {
                entries[prop] = ctor;
            }
            return ctor;
        }
    });
    return wrappedTypeFunc;
}
/**
 * Base class for proxiable object
 * @public
 */ class Proxiable {
    /** @internal */ proxy;
    constructor(){
        this.proxy = new Proxy(this, {
            get: function(target, prop) {
                return typeof prop === 'string' ? target.$get(prop) : undefined;
            },
            set: function(target, prop, value) {
                return typeof prop === 'string' ? target.$set(prop, value) : false;
            }
        });
        return this.proxy;
    }
    get $thisProxy() {
        return this.proxy;
    }
}
let uidExp = 0;
/**
 * Base class for a expression in the shader
 * @public
 */ class PBShaderExp extends Proxiable {
    /** @internal */ $uid;
    /** @internal */ $str;
    /** @internal */ $location;
    /** @internal */ $typeinfo;
    /** @internal */ $global;
    /** @internal */ $sampleType;
    /** @internal */ $precision;
    /** @internal */ $ast;
    /** @internal */ $inout;
    /** @internal */ $memberCache;
    /** @internal */ $attrib;
    /** @internal */ $tags;
    /** @internal */ $_group;
    /** @internal */ $declareType;
    /** @internal */ $isBuffer;
    /** @internal */ $readonly;
    /** @internal */ $bindingSize;
    /** @internal */ constructor(str, typeInfo){
        super();
        if (!str && typeInfo.isPointerType()) {
            throw new Error('no default constructor for pointer type');
        }
        this.$uid = uidExp++;
        this.$str = str || '';
        this.$location = 0;
        this.$global = false;
        this.$typeinfo = typeInfo;
        this.$qualifier = null;
        this.$precision = ShaderPrecisionType.NONE;
        this.$sampleType = 'float';
        this.$ast = new ASTPrimitive(this);
        this.$inout = null;
        this.$memberCache = {};
        this.$attrib = null;
        this.$tags = [];
        this.$_group = null;
        this.$declareType = DeclareType.DECLARE_TYPE_NONE;
        this.$isBuffer = false;
        this.$bindingSize = 0;
        this.$readonly = false;
        if (typeInfo.isTextureType()) {
            if (typeInfo.isDepthTexture()) {
                this.$sampleType = 'depth';
            } else {
                const t = getTextureSampleType(typeInfo);
                if (t.primitiveType === PBPrimitiveType.I32) {
                    this.$sampleType = 'sint';
                } else if (t.primitiveType === PBPrimitiveType.U32) {
                    this.$sampleType = 'uint';
                } else {
                    this.$sampleType = 'float';
                }
            }
        }
    }
    get $group() {
        return this.$_group;
    }
    set $group(val) {
        this.$_group = val;
    }
    /**
   * Point out that the variable should be in uniform address space
   * @param group - The bind group index
   * @returns self
   */ uniform(group) {
        this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
        this.$group = group;
        this.$isBuffer = false;
        return this;
    }
    /**
   * Point out that the variable should be an uniform buffer
   * @param group - The bind group index
   * @returns self
   */ uniformBuffer(group, bindingSize = 0) {
        if (!this.$typeinfo.isPrimitiveType() && !this.$typeinfo.isArrayType() && !this.$typeinfo.isStructType()) {
            throw new PBASTError(this.$ast, 'only primitive type, array type or structure type can be set as uniform buffer');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
        this.$group = group;
        this.$isBuffer = true;
        this.$bindingSize = bindingSize;
        return this;
    }
    /**
   * Point out that the variable should be in workgroup address space
   *
   * @remarks
   * WebGPU device only
   *
   * @returns self
   */ workgroup() {
        this.$declareType = DeclareType.DECLARE_TYPE_WORKGROUP;
        return this;
    }
    /**
   * Point out that the variable should be in storage address space
   * @param group - The bind group index
   * @returns self
   */ storage(group) {
        if (!this.$typeinfo.isHostSharable()) {
            if (this.$typeinfo.isTextureType()) {
                if (!this.$typeinfo.isStorageTexture()) {
                    throw new PBASTError(this.$ast, 'type cannot be declared as storage texture');
                }
                return this.uniform(group);
            }
            throw new PBASTError(this.$ast, 'type cannot be declared in storage address space');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
        this.$group = group;
        this.$isBuffer = false;
        this.$readonly = false;
        return this;
    }
    /**
   * Point out that the variable is read-only and should be in storage address space
   * @param group - The bind group index
   * @returns self
   */ storageReadonly(group) {
        this.storage(group);
        this.$readonly = true;
        return this;
    }
    /**
   * Point out that the variable should be a storage buffer
   * @param group - The bind group index
   * @returns self
   */ storageBuffer(group, bindingSize = 0) {
        if (!this.$typeinfo.isPrimitiveType() && !this.$typeinfo.isArrayType() && !this.$typeinfo.isStructType() && !this.$typeinfo.isAtomicI32() && !this.$typeinfo.isAtomicU32()) {
            throw new PBASTError(this.$ast, 'only primitive type, array type or structure type can be set as storage buffer');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
        this.$group = group;
        this.$isBuffer = true;
        this.$bindingSize = bindingSize;
        this.$readonly = false;
        return this;
    }
    /**
   * Point out that the variable is read-only and should be a storage buffer
   * @param group - The bind group index
   * @returns self
   */ storageBufferReadonly(group, bindingSize = 0) {
        this.storageBuffer(group, bindingSize);
        this.$readonly = true;
        return this;
    }
    inout() {
        this.$inout = 'inout';
        return this;
    }
    out() {
        this.$inout = 'out';
        return this;
    }
    /**
   * Point out that the variable is a input vertex attribute
   * @param attr - The vertex semantic
   * @returns self
   */ attrib(attr) {
        this.$declareType = DeclareType.DECLARE_TYPE_IN;
        this.$attrib = attr;
        return this;
    }
    /**
   * Create tags for the variable
   * @param args - tags
   * @returns self
   */ tag(...args) {
        args.forEach((val)=>{
            if (this.$tags.indexOf(val) < 0) {
                this.$tags.push(val);
            }
        });
        return this;
    }
    /**
   * Set sample type for the variable if the variable is of type texture
   * @param type - sample type
   * @returns self
   */ sampleType(type) {
        if (type) {
            this.$sampleType = type;
        }
        return this;
    }
    /**
   * Get element in the array by index
   * @param index - index of the element
   * @returns the element variable
   */ at(index) {
        const varType = this.$ast.getType();
        if (!varType.isArrayType() && (!varType.isPrimitiveType() || !varType.isVectorType() && !varType.isMatrixType())) {
            throw new Error('at() function must be used with array types');
        }
        let elementType;
        let dimension;
        if (varType.isArrayType()) {
            elementType = varType.elementType;
            dimension = varType.dimension;
        } else if (varType.isVectorType()) {
            elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, 1));
            dimension = varType.cols;
        } else if (varType.isMatrixType()) {
            elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
            dimension = varType.rows;
        } else {
            throw new Error('at() source type is not indexable');
        }
        const result = new PBShaderExp('', elementType);
        if (typeof index === 'number') {
            if (!Number.isInteger(index)) {
                throw new Error('at() array index must be integer type');
            }
            if (index < 0 || dimension > 0 && index >= dimension) {
                throw new Error('at() array index out of bounds');
            }
            result.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(index, typeI32), elementType);
        } else {
            const type = index.$ast.getType();
            if (!type.isPrimitiveType() || !type.isScalarType()) {
                throw new Error('at() array index must be scalar type');
            }
            let ast = index.$ast;
            if (type.scalarType !== PBPrimitiveType.I32 && type.scalarType !== PBPrimitiveType.U32) {
                ast = new ASTCast(ast, typeI32);
            }
            result.$ast = new ASTArrayIndex(this.$ast, ast, elementType);
        }
        return result;
    }
    /**
   * Set element in the array by index
   * @param index - index of the element
   * @param val - value to set
   */ setAt(index, val) {
        const varType = this.$ast.getType();
        if (!varType.isArrayType() && !(varType.isPrimitiveType() && varType.isVectorType())) {
            throw new Error('setAt() function must be used with array types');
        }
        if (typeof index === 'number') {
            if (!Number.isInteger(index)) {
                throw new Error('setAt() array index must be integer type');
            }
            const dimension = varType.isArrayType() ? varType.dimension : varType.cols;
            if (index < 0 || dimension > 0 && index >= dimension) {
                throw new Error('setAt() array index out of bounds');
            }
        }
        getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueArray(new ASTLValueScalar(this.$ast), typeof index === 'number' ? new ASTScalar(index, typeI32) : index.$ast, varType.isArrayType() ? varType.elementType : new PBPrimitiveTypeInfo(varType.scalarType)), val instanceof PBShaderExp ? val.$ast : val));
    }
    /**
   * Point out that the variable should be in high precision
   * @returns self
   */ highp() {
        this.$precision = ShaderPrecisionType.HIGH;
        return this;
    }
    /**
   * Points out that the variable should be in medium precision
   * @returns self
   */ mediump() {
        this.$precision = ShaderPrecisionType.MEDIUM;
        return this;
    }
    /**
   * Points out that the variable should be in low precision
   * @returns self
   */ lowp() {
        this.$precision = ShaderPrecisionType.LOW;
        return this;
    }
    /**
   * Whether this is a constructor
   * @returns true if this is a constructor
   */ isConstructor() {
        return this.$ast instanceof ASTShaderExpConstructor && this.$ast.args.length === 0;
    }
    /**
   * Determine if this variable is of vector type
   * @returns true if the variable is of vector type, otherwise false
   */ isVector() {
        const varType = this.$ast.getType();
        return varType.isPrimitiveType() && varType.isVectorType();
    }
    /**
   * Get vector component count of the variable if this variable is of vector type
   * @returns the vector component count
   */ numComponents() {
        const varType = this.$ast.getType();
        return varType.isPrimitiveType() ? varType.cols : 0;
    }
    /**
   * Get type name of this variable
   * @returns The type name of this variable
   */ getTypeName() {
        return this.$ast.getType().toTypeName(getCurrentProgramBuilder().getDevice().type);
    }
    /** @internal */ $get(prop) {
        if (typeof prop === 'string') {
            if (prop[0] === '$' || prop in this) {
                return this[prop];
            } else {
                let exp = this.$memberCache[prop];
                if (!exp) {
                    const varType = this.$ast?.getType() || this.$typeinfo;
                    const num = Number(prop);
                    if (Number.isNaN(num)) {
                        if (varType.isStructType()) {
                            const elementIndex = varType.structMembers.findIndex((val)=>val.name === prop);
                            if (elementIndex < 0) {
                                return undefined;
                            }
                            const element = varType.structMembers[elementIndex];
                            if (element.type.isStructType()) {
                                const ctor = getCurrentProgramBuilder().structInfo.structs[element.type.structName];
                                exp = ctor.call(getCurrentProgramBuilder(), `${this.$str}.${prop}`);
                            } else {
                                exp = new PBShaderExp(`${this.$str}.${prop}`, element.type);
                            }
                            exp.$ast = new ASTHash(this.$ast, prop, element.type);
                        } else {
                            if (!varType.isPrimitiveType() || !varType.isVectorType() && !varType.isScalarType()) {
                                throw new Error(`invalid index operation: ${this.$ast.toString(getCurrentProgramBuilder().getDevice().type)}[${prop}]`);
                            }
                            if (prop.length === 0 || prop.length > 4 || [
                                ...prop
                            ].some((val)=>'xyzw'.slice(0, varType.cols).indexOf(val) < 0) && [
                                ...prop
                            ].some((val)=>'rgba'.slice(0, varType.cols).indexOf(val) < 0)) {
                                throw new Error(`unknown swizzle target: ${this.$ast.toString(getCurrentProgramBuilder().getDevice().type)}[${prop}]`);
                            }
                            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, prop.length));
                            exp = new PBShaderExp('', type);
                            if (varType.cols === 1) {
                                exp.$ast = new ASTShaderExpConstructor(type, [
                                    this.$ast
                                ]);
                            } else {
                                exp.$ast = new ASTHash(this.$ast, prop, type);
                            }
                        }
                    } else {
                        if (varType.isArrayType()) {
                            exp = this.at(num);
                        } else if (varType.isPrimitiveType() && varType.isVectorType()) {
                            if (num >= varType.cols) {
                                throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
                            }
                            exp = this.$get('xyzw'[num]);
                        } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
                            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
                            exp = new PBShaderExp('', type);
                            exp.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(num, typeI32), type);
                        } else {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                    }
                    this.$memberCache[prop] = exp;
                }
                return exp;
            }
        } else {
            return undefined;
        }
    }
    /** @internal */ $set(prop, value) {
        if (typeof prop === 'string') {
            if (prop[0] === '$' || prop in this) {
                this[prop] = value;
            } else {
                if (typeof value !== 'number' && typeof value !== 'boolean' && !(value instanceof PBShaderExp)) {
                    throw new Error(`Invalid output value assignment`);
                }
                const varType = this.$ast?.getType() || this.$typeinfo;
                const num = Number(prop);
                if (Number.isNaN(num)) {
                    if (varType.isStructType()) {
                        const elementIndex = varType.structMembers.findIndex((val)=>val.name === prop);
                        if (elementIndex < 0) {
                            throw new Error(`unknown struct member '${prop}`);
                        }
                        const element = varType.structMembers[elementIndex];
                        let dstAST = null;
                        if (typeof value === 'number' || typeof value === 'boolean') {
                            if (!element.type.isPrimitiveType() || !element.type.isScalarType()) {
                                throw new Error(`can not set struct member '${prop}: invalid value type`);
                            }
                            dstAST = new ASTScalar(value, element.type);
                        } else if (value instanceof PBShaderExp) {
                            dstAST = value.$ast;
                        }
                        if (!dstAST) {
                            throw new Error(`can not set struct member '${prop}: invalid value type`);
                        }
                        getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, element.type), dstAST));
                    } else {
                        // FIXME: WGSL does not support l-value swizzling
                        if (prop.length > 1 || 'xyzw'.indexOf(prop) < 0 && 'rgba'.indexOf(prop) < 0) {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                        if (!varType.isPrimitiveType() || !varType.isVectorType()) {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                        const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.scalarType);
                        getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, type), value instanceof PBShaderExp ? value.$ast : value));
                    }
                } else {
                    if (varType.isArrayType()) {
                        this.setAt(num, value);
                    } else if (varType.isPrimitiveType() && varType.isVectorType()) {
                        if (num >= varType.cols) {
                            throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
                        }
                        this.$set('xyzw'[num], value);
                    } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
                        if (!(value instanceof PBShaderExp)) {
                            throw new Error(`invalid matrix column vector assignment: ${this.$str}[${num}]`);
                        }
                        const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
                        getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueArray(new ASTLValueScalar(this.$ast), new ASTScalar(num, typeI32), type), value.$ast));
                    } else {
                        throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                    }
                }
            }
            return true;
        }
        return false;
    }
}

const genTypeList = [
    [
        typeF32,
        typeF32Vec2,
        typeF32Vec3,
        typeF32Vec4
    ],
    [
        typeI32,
        typeI32Vec2,
        typeI32Vec3,
        typeI32Vec4
    ],
    [
        typeU32,
        typeU32Vec2,
        typeU32Vec3,
        typeU32Vec4
    ],
    [
        typeBool,
        typeBVec2,
        typeBVec3,
        typeBVec4
    ]
];
const genMatrixTypeList = [
    typeMat2,
    typeMat2x3,
    typeMat2x4,
    typeMat3x2,
    typeMat3,
    typeMat3x4,
    typeMat4x2,
    typeMat4x3,
    typeMat4
];
function matchFunctionOverloadings(pb, name, ...args) {
    const bit = pb.getDevice().type === 'webgl' ? MASK_WEBGL1 : pb.getDevice().type === 'webgl2' ? MASK_WEBGL2 : MASK_WEBGPU;
    // @ts-ignore 7053
    const overloadings = builtinFunctionsAll[name].overloads// @ts-ignore 7006
    .filter((val)=>!!(val[1] & bit))// @ts-ignore 7006
    .map((val)=>val[0]);
    if (!overloadings || overloadings.length === 0) {
        throw new PBDeviceNotSupport(`builtin shader function '${name}'`);
    }
    const argsNonArray = args.map((val)=>pb.normalizeExpValue(val));
    const matchResult = pb._matchFunctionOverloading(overloadings, argsNonArray);
    if (!matchResult) {
        throw new PBOverloadingMatchError(name);
    }
    return matchResult;
}
function callBuiltinChecked(pb, matchResult) {
    return pb.$callFunction(matchResult[0].name, matchResult[1], matchResult[0]);
}
function callBuiltin(pb, name, ...args) {
    return callBuiltinChecked(pb, matchFunctionOverloadings(pb, name, ...args));
}
function genMatrixType(name, shaderTypeMask, r, args) {
    const result = [];
    for(let i = 0; i < genMatrixTypeList.length; i++){
        const returnType = genMatrixTypeList[i];
        const argTypes = args.map((arg)=>{
            return {
                type: arg || genMatrixTypeList[i]
            };
        });
        result.push([
            new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, returnType, argTypes), true),
            shaderTypeMask
        ]);
    }
    return result;
}
function genType(name, shaderTypeMask, r, args, vecOnly) {
    if (args.findIndex((val)=>typeof val === 'number') < 0) {
        return [
            [
                new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, r, args.map((arg)=>({
                        type: arg
                    }))), true),
                shaderTypeMask
            ]
        ];
    } else {
        const result = [];
        let i = vecOnly ? 1 : 0;
        for(; i < 4; i++){
            const returnType = typeof r === 'number' ? genTypeList[r][i] : r;
            const argTypes = args.map((arg)=>{
                if (typeof arg === 'number') {
                    return {
                        type: genTypeList[arg][i]
                    };
                } else {
                    return {
                        type: arg
                    };
                }
            });
            result.push([
                new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, returnType, argTypes), true),
                shaderTypeMask
            ]);
        }
        return result;
    }
}
function unaryFunc(a, op, type) {
    const exp = new PBShaderExp('', type);
    exp.$ast = new ASTUnaryFunc(a, op, type);
    return exp;
}
function binaryFunc(a, b, op, type) {
    const exp = new PBShaderExp('', type);
    exp.$ast = new ASTBinaryFunc(a, b, op, type);
    return exp;
}
const MASK_WEBGL1 = 1 << 0;
const MASK_WEBGL2 = 1 << 1;
const MASK_WEBGPU = 1 << 2;
const MASK_WEBGL = MASK_WEBGL1 | MASK_WEBGL2;
const MASK_ALL = MASK_WEBGL | MASK_WEBGPU;
const builtinFunctionsAll = {
    add_2: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                null
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
                return args[0] + args[1];
            }
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '+', matchResult[0].returnType);
        }
    },
    add: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('add');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.add_2(result, args[i]);
            }
            return result;
        }
    },
    sub: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                null
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '-', matchResult[0].returnType);
        }
    },
    div: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '/', matchResult[0].returnType);
        }
    },
    mul_2: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                typeF32,
                null
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat2,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat2,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat2,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat2,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat2x3,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat2x3,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat2x3,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat2x3,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec3,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat2x4,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat2x4,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat2x4,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat2x4,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec4,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat3x2,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat3x2,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat3x2,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat3x2,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec2,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat3,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat3,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat3,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat3,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat3x4,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat3x4,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat3x4,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat3x4,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec4,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat4x2,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat4x2,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat4x2,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat4x2,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec2,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat4x3,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat4x3,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat4x3,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat4x3,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec3,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat4,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat4,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat4,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat4,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeMat4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '*', matchResult[0].returnType);
        }
    },
    mul: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('mul');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.mul_2(result, args[i]);
            }
            return result;
        }
    },
    mod: {
        overloads: [
            ...genType('mod', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('mod', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('mod', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('mod', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            const isIntegerType = argType.isPrimitiveType() && (argType.scalarType === PBPrimitiveType.I32 || argType.scalarType === PBPrimitiveType.U32);
            if (pb.getDevice().type === 'webgl' && isIntegerType) {
                throw new PBDeviceNotSupport('integer modulus');
            }
            if (pb.getDevice().type === 'webgpu' || isIntegerType) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '%', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    radians: {
        overloads: genType('radians', MASK_ALL, 0, [
            0
        ])
    },
    degrees: {
        overloads: genType('degrees', MASK_ALL, 0, [
            0
        ])
    },
    sin: {
        overloads: genType('sin', MASK_ALL, 0, [
            0
        ])
    },
    cos: {
        overloads: genType('cos', MASK_ALL, 0, [
            0
        ])
    },
    tan: {
        overloads: genType('tan', MASK_ALL, 0, [
            0
        ])
    },
    asin: {
        overloads: genType('asin', MASK_ALL, 0, [
            0
        ])
    },
    acos: {
        overloads: genType('acos', MASK_ALL, 0, [
            0
        ])
    },
    atan: {
        overloads: genType('atan', MASK_ALL, 0, [
            0
        ])
    },
    atan2: {
        overloads: [
            ...genType('atan', MASK_WEBGL, 0, [
                0,
                0
            ]),
            ...genType('atan2', MASK_WEBGPU, 0, [
                0,
                0
            ])
        ]
    },
    sinh: {
        overloads: genType('sinh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    cosh: {
        overloads: genType('cosh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    tanh: {
        overloads: genType('tanh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    asinh: {
        overloads: genType('asinh', MASK_WEBGL2, 0, [
            0
        ])
    },
    acosh: {
        overloads: genType('acosh', MASK_WEBGL2, 0, [
            0
        ])
    },
    atanh: {
        overloads: genType('atanh', MASK_WEBGL2, 0, [
            0
        ])
    },
    pow: {
        overloads: genType('pow', MASK_ALL, 0, [
            0,
            0
        ])
    },
    exp: {
        overloads: genType('exp', MASK_ALL, 0, [
            0
        ])
    },
    exp2: {
        overloads: genType('exp2', MASK_ALL, 0, [
            0
        ])
    },
    log: {
        overloads: genType('log', MASK_ALL, 0, [
            0
        ])
    },
    log2: {
        overloads: genType('log2', MASK_ALL, 0, [
            0
        ])
    },
    sqrt: {
        overloads: genType('sqrt', MASK_ALL, 0, [
            0
        ])
    },
    inverseSqrt: {
        overloads: [
            ...genType('inversesqrt', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('inverseSqrt', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    abs: {
        overloads: [
            ...genType('abs', MASK_ALL, 0, [
                0
            ]),
            ...genType('abs', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1
            ]),
            ...genType('abs', MASK_WEBGPU, 2, [
                2
            ])
        ]
    },
    sign: {
        overloads: [
            ...genType('sign', MASK_ALL, 0, [
                0
            ]),
            ...genType('sign', MASK_WEBGL2, 1, [
                1
            ])
        ]
    },
    floor: {
        overloads: genType('floor', MASK_ALL, 0, [
            0
        ])
    },
    ceil: {
        overloads: genType('ceil', MASK_ALL, 0, [
            0
        ])
    },
    fract: {
        overloads: genType('fract', MASK_ALL, 0, [
            0
        ])
    },
    fma: {
        overloads: genType('fma', MASK_ALL, 0, [
            0,
            0,
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            if (pb.getDevice().type === 'webgpu') {
                return callBuiltinChecked(pb, matchResult);
            } else {
                return pb.add(pb.mul(args[0], args[1]), args[2]);
            }
        }
    },
    round: {
        overloads: genType('round', MASK_WEBGPU, 0, [
            0
        ])
    },
    trunc: {
        overloads: genType('trunc', MASK_WEBGPU, 0, [
            0
        ])
    },
    // TODO: modf
    min: {
        overloads: [
            ...genType('min', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ]
    },
    max: {
        overloads: [
            ...genType('max', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ]
    },
    clamp: {
        overloads: [
            ...genType('clamp', MASK_ALL, 0, [
                0,
                0,
                0
            ]),
            ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1,
                1
            ]),
            ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2,
                2
            ])
        ]
    },
    saturate: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('saturate');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('saturate', 'x');
            }
            const argType = args[0].$ast.getType();
            if (!argType.isPrimitiveType() || !argType.isScalarType() && !argType.isVectorType()) {
                throw new PBParamTypeError('saturate', 'x');
            }
            // @ts-ignore 7053
            const a = argType.isScalarType() ? 0 : pb[`vec${argType.cols}`](0);
            // @ts-ignore 7053
            const b = argType.isScalarType() ? 1 : pb[`vec${argType.cols}`](1);
            return pb.clamp(args[0], a, b);
        }
    },
    mix: {
        overloads: [
            ...genType('mix', MASK_ALL, 0, [
                0,
                0,
                0
            ]),
            ...genType('mix', MASK_ALL, 0, [
                0,
                0,
                typeF32
            ])
        ]
    },
    step: {
        overloads: genType('step', MASK_ALL, 0, [
            0,
            0
        ])
    },
    smoothStep: {
        overloads: genType('smoothstep', MASK_ALL, 0, [
            0,
            0,
            0
        ])
    },
    isnan: {
        overloads: genType('isnan', MASK_WEBGL2, 3, [
            0
        ])
    },
    isinf: {
        overloads: genType('isinf', MASK_WEBGL2, 3, [
            0
        ])
    },
    length: {
        overloads: genType('length', MASK_ALL, typeF32, [
            0
        ])
    },
    distance: {
        overloads: genType('distance', MASK_ALL, typeF32, [
            0,
            0
        ])
    },
    dot: {
        overloads: [
            ...genType('dot', MASK_ALL, typeF32, [
                0,
                0
            ], true),
            ...genType('dot', MASK_WEBGPU, typeI32, [
                1,
                1
            ], true),
            ...genType('dot', MASK_WEBGPU, typeU32, [
                2,
                2
            ], true)
        ]
    },
    cross: {
        overloads: genType('cross', MASK_ALL, typeF32Vec3, [
            typeF32Vec3,
            typeF32Vec3
        ])
    },
    normalize: {
        overloads: genType('normalize', MASK_ALL, 0, [
            0
        ], true)
    },
    faceForward: {
        overloads: [
            ...genType('faceforward', MASK_WEBGL, 0, [
                0,
                0,
                0
            ], true),
            ...genType('faceForward', MASK_WEBGPU, 0, [
                0,
                0,
                0
            ], true)
        ]
    },
    reflect: {
        overloads: genType('reflect', MASK_ALL, 0, [
            0,
            0
        ], true)
    },
    refract: {
        overloads: genType('refract', MASK_ALL, 0, [
            0,
            0,
            typeF32
        ], true)
    },
    frexp: {
        overloads: [
            ...genType('frexp', MASK_WEBGPU, typeFrexpResult, [
                typeF32
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec2, [
                typeF32Vec2
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec3, [
                typeF32Vec3
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec4, [
                typeF32Vec4
            ])
        ]
    },
    outerProduct: {
        overloads: [
            ...genType('outerProduct', MASK_WEBGL2, typeMat2, [
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3, [
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4, [
                typeF32Vec4,
                typeF32Vec4
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat2x3, [
                typeF32Vec3,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3x2, [
                typeF32Vec2,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat2x4, [
                typeF32Vec4,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4x2, [
                typeF32Vec2,
                typeF32Vec4
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3x4, [
                typeF32Vec4,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4x3, [
                typeF32Vec3,
                typeF32Vec4
            ])
        ]
    },
    transpose: {
        overloads: [
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2, [
                typeMat2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3, [
                typeMat3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4, [
                typeMat4
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2x3, [
                typeMat3x2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3x2, [
                typeMat2x3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2x4, [
                typeMat4x2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4x2, [
                typeMat2x4
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3x4, [
                typeMat4x3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4x3, [
                typeMat3x4
            ])
        ]
    },
    determinant: {
        overloads: [
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat2
            ]),
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat3
            ]),
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat4
            ])
        ]
    },
    inverse: {
        overloads: [
            ...genType('inverse', MASK_WEBGL2, typeMat2, [
                typeMat2
            ]),
            ...genType('inverse', MASK_WEBGL2, typeMat3, [
                typeMat3
            ]),
            ...genType('inverse', MASK_WEBGL2, typeMat4, [
                typeMat4
            ])
        ]
    },
    lessThan: {
        overloads: [
            ...genType('lessThan', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('lessThan', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('lessThan', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '<', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    lessThanEqual: {
        overloads: [
            ...genType('lessThanEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('lessThanEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('lessThanEqual', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '<=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    greaterThan: {
        overloads: [
            ...genType('greaterThan', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('greaterThan', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('greaterThan', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '>', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    greaterThanEqual: {
        overloads: [
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '>=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    compEqual: {
        overloads: [
            ...genType('equal', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('equal', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('equal', MASK_ALL, 3, [
                2,
                2
            ]),
            ...genType('equal', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    compNotEqual: {
        overloads: [
            ...genType('notEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                2,
                2
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    equal: {
        overloads: [
            ...genType('equal', MASK_ALL, typeBool, [
                0,
                0
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                1,
                1
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                2,
                2
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
                return pb.all(pb.compEqual(args[0], args[1]));
            } else {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
            }
        }
    },
    notEqual: {
        overloads: [
            ...genType('notEqual', MASK_ALL, typeBool, [
                0,
                0
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                1,
                1
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                2,
                2
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
                return pb.any(pb.compNotEqual(args[0], args[1]));
            } else {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
            }
        }
    },
    any: {
        overloads: genType('any', MASK_ALL, typeBool, [
            3
        ], true)
    },
    all: {
        overloads: genType('all', MASK_ALL, typeBool, [
            3
        ], true)
    },
    not: {
        overloads: genType('not', MASK_ALL, 3, [
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return unaryFunc(matchResult[1][0], '!', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    neg: {
        overloads: [
            ...genType('neg', MASK_ALL, 0, [
                0
            ]),
            ...genType('neg', MASK_ALL, 1, [
                1
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return unaryFunc(matchResult[1][0], '-', matchResult[0].returnType);
        }
    },
    or_2: {
        overloads: genType('or', MASK_ALL, typeBool, [
            3,
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '||', matchResult[0].returnType);
        }
    },
    or: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('or');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.or_2(result, args[i]);
            }
            return result;
        }
    },
    compOr: {
        overloads: [
            ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '|', matchResult[0].returnType);
        }
    },
    and_2: {
        overloads: genType('and', MASK_ALL, typeBool, [
            3,
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '&&', matchResult[0].returnType);
        }
    },
    and: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('and');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.and_2(result, args[i]);
            }
            return result;
        }
    },
    compAnd: {
        overloads: [
            ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '&', matchResult[0].returnType);
        }
    },
    compXor: {
        overloads: [
            ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '^', matchResult[0].returnType);
        }
    },
    sal: {
        overloads: [
            ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                2
            ]),
            ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '<<', matchResult[0].returnType);
        }
    },
    sar: {
        overloads: [
            ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                2
            ]),
            ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '>>', matchResult[0].returnType);
        }
    },
    arrayLength: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('arrayLength');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('arrayLength', 'array');
            }
            const type = args[0].$ast.getType();
            const arrayType = type.isPointerType() ? type.pointerType : type;
            if (!arrayType.isArrayType() || arrayType.dimension !== 0) {
                throw new PBParamTypeError('arrayLength', 'array');
            }
            const arg = type.isArrayType() ? pb.addressOf(args[0]).$ast : args[0].$ast;
            return pb.$callFunctionNoCheck(name, [
                arg
            ], typeU32);
        }
    },
    select: {
        overloads: [
            ...genType('select', MASK_WEBGPU, 0, [
                0,
                0,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 1, [
                1,
                1,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 2, [
                2,
                2,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 3, [
                3,
                3,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 0, [
                0,
                0,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 1, [
                1,
                1,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 2, [
                2,
                2,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 3, [
                3,
                3,
                3
            ], true),
            ...genType('mix', MASK_WEBGL, 0, [
                0,
                0,
                3
            ]),
            ...genType('mix', MASK_WEBGL, 1, [
                1,
                1,
                3
            ]),
            ...genType('mix', MASK_WEBGL, 2, [
                2,
                2,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (pb.getDevice().type === 'webgl') {
                const cond = args[2];
                let newCond = null;
                if (typeof cond === 'boolean') {
                    newCond = cond ? 1 : 0;
                } else if (typeof cond === 'number') {
                    newCond = cond;
                } else if (cond instanceof PBShaderExp) {
                    const type = cond.$ast.getType();
                    if (type.typeId === typeBool.typeId) {
                        newCond = pb.float(cond);
                    } else if (type.typeId === typeBVec2.typeId) {
                        newCond = pb.vec2(cond);
                    } else if (type.typeId === typeBVec3.typeId) {
                        newCond = pb.vec3(cond);
                    } else if (type.typeId === typeBVec4.typeId) {
                        newCond = pb.vec4(cond);
                    }
                }
                if (newCond === null) {
                    throw new PBParamValueError('select', 'cond');
                }
                return callBuiltin(pb, 'mix', args[0], args[1], newCond);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    floatBitsToInt: {
        overloads: genType('floatBitsToInt', MASK_WEBGL2, 1, [
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('floatBitsToInt');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('floatBitsToInt', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeF32.typeId) {
                    throw new PBParamTypeError('floatBitsToInt', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<i32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeF32)
                ], typeI32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    floatBitsToUint: {
        overloads: genType('floatBitsToUint', MASK_WEBGL2, 2, [
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('floatBitsToUint');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('floatBitsToUint', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeF32.typeId) {
                    throw new PBParamTypeError('floatBitsToUint', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<u32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeF32)
                ], typeU32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    intBitsToFloat: {
        overloads: genType('intBitsToFloat', MASK_WEBGL2, 0, [
            1
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('intBitsToFloat');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('intBitsToFloat', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeI32.typeId) {
                    throw new PBParamTypeError('intBitsToFloat', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<f32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeI32)
                ], typeF32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    uintBitsToFloat: {
        overloads: genType('uintBitsToFloat', MASK_WEBGL2, 0, [
            2
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('uintBitsToFloat');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('uintBitsToFloat', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeU32.typeId) {
                    throw new PBParamTypeError('uintBitsToFloat', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<f32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeU32)
                ], typeF32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    pack4x8snorm: {
        overloads: genType('pack4x8snorm', MASK_WEBGPU, typeU32, [
            typeF32Vec4
        ])
    },
    unpack4x8snorm: {
        overloads: genType('unpack4x8snorm', MASK_WEBGPU, typeF32Vec4, [
            typeU32
        ])
    },
    pack4x8unorm: {
        overloads: genType('pack4x8unorm', MASK_WEBGPU, typeU32, [
            typeF32Vec4
        ])
    },
    unpack4x8unorm: {
        overloads: genType('unpack4x8unorm', MASK_WEBGPU, typeF32Vec4, [
            typeU32
        ])
    },
    pack2x16snorm: {
        overloads: [
            ...genType('pack2x16snorm', MASK_WEBGPU, typeU32, [
                typeF32Vec2
            ]),
            ...genType('packSnorm2x16', MASK_WEBGL2, typeU32, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16snorm: {
        overloads: [
            ...genType('unpack2x16snorm', MASK_WEBGPU, typeF32Vec2, [
                typeU32
            ]),
            ...genType('unpackSnorm2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32
            ])
        ]
    },
    pack2x16unorm: {
        overloads: [
            ...genType('pack2x16unorm', MASK_WEBGPU, typeU32, [
                typeF32Vec2
            ]),
            ...genType('packUnorm2x16', MASK_WEBGL2, typeU32, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16unorm: {
        overloads: [
            ...genType('unpack2x16unorm', MASK_WEBGPU, typeF32Vec2, [
                typeU32
            ]),
            ...genType('unpackUnorm2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32
            ])
        ]
    },
    pack2x16float: {
        overloads: [
            ...genType('pack2x16float', MASK_WEBGPU, typeU32, [
                typeF32Vec2
            ]),
            ...genType('packHalf2x16', MASK_WEBGL2, typeU32, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16float: {
        overloads: [
            ...genType('unpack2x16float', MASK_WEBGPU, typeF32Vec2, [
                typeU32
            ]),
            ...genType('unpackHalf2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32
            ])
        ]
    },
    matrixCompMult: {
        overloads: genMatrixType('matrixCompMult', MASK_WEBGL, null, [
            null,
            null
        ])
    },
    dpdx: {
        overloads: [
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('dpdx', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    dpdy: {
        overloads: [
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('dpdy', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    fwidth: {
        overloads: genType('fwidth', MASK_ALL, 0, [
            0
        ])
    },
    dpdxCoarse: {
        overloads: [
            ...genType('dpdxCoarse', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdxFine: {
        overloads: [
            ...genType('dpdxFine', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdyCoarse: {
        overloads: [
            ...genType('dpdyCoarse', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdyFine: {
        overloads: [
            ...genType('dpdyFine', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    // textureDimensions(tex: PBShaderExp, level?: number|PBShaderExp);
    textureDimensions: {
        overloads: [
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeITex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeUTex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeITex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeUTex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepth2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepth2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32, [
                typeTexStorage1D_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32float
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeTex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeITex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeUTex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepth2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepthCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepth2DArray,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 1 || args.length > 2) {
                throw new PBParamLengthError('textureDimensions');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('textureDimensions', 'tex');
            }
            const texType = args[0].$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureDimensions', 'tex');
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isMultisampledTexture() || texType.isStorageTexture()) {
                    if (args[1] !== undefined) {
                        throw new PBParamValueError('textureDimensions', 'level');
                    }
                }
                return callBuiltin(pb, name, ...args);
            } else if (pb.getDevice().type === 'webgl2') {
                const tex = args[0];
                const level = args[1] || 0;
                return texType.is1DTexture() ? callBuiltin(pb, name, tex, level).x : callBuiltin(pb, name, tex, level);
            }
        }
    },
    // textureGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
    // textureGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
    textureGather: {
        overloads: [
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3
            ])
        ]
    },
    // textureArrayGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
    // textureArrayGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
    textureArrayGather: {
        overloads: [
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ])
        ]
    },
    // textureGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp);
    textureGatherCompare: {
        overloads: [
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ])
        ]
    },
    // textureArrayGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp);
    textureArrayGatherCompare: {
        overloads: [
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ])
        ]
    },
    // textureLoad(tex: PBShaderExp, coords: number|PBShaderExp, levelOrSampleIndex: number|PBShaderExp);
    textureLoad: {
        overloads: [
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_bgra8unorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_r32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_r32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_r32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rg32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rg32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rg32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba16float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba16sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba16uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba8sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba8uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba8snorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba8unorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_bgra8unorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_r32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_r32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_r32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rg32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rg32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rg32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba16float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba16sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba16uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba8sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba8uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba8snorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba8unorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_bgra8unorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_r32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_r32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_r32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rg32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rg32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rg32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba16float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba16sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba16uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba8sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba8uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba8snorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba8unorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepthMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeTexExternal,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeITex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeUTex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex3D,
                typeI32Vec3,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length === 0) {
                throw new PBParamLengthError('textureLoad');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('textureLoad', 'tex');
            }
            const texType = args[0].$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureLoad', 'tex');
            }
            if (pb.getDevice().type === 'webgl2') {
                if (args.length !== 3) {
                    throw new PBParamLengthError('textureLoad');
                }
                if (texType.is1DTexture()) {
                    if (typeof args[1] === 'number') {
                        if (!Number.isInteger(args[1])) {
                            throw new PBParamTypeError('textureLoad', 'coord');
                        }
                    } else if (args[1] instanceof PBShaderExp) {
                        const coordType = args[1].$ast.getType();
                        if (!coordType.isPrimitiveType() || !coordType.isScalarType() || coordType.scalarType !== PBPrimitiveType.I32) {
                            throw new PBParamTypeError('textureLoad', 'coord');
                        }
                    } else {
                        throw new PBParamTypeError('textureLoad', 'coord');
                    }
                    args[1] = pb.ivec2(args[1], 0);
                }
            } else if (pb.getDevice().type === 'webgpu') {
                if (texType.isExternalTexture()) {
                    args = args.slice(0, 2);
                }
                if (texType.isStorageTexture()) {
                    texType.readable = true;
                }
            }
            return callBuiltin(pb, name, ...args);
        }
    },
    // textureArrayLoad(tex: PBShaderExp, coords: number|PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp);
    textureArrayLoad: {
        overloads: [
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex2DArray,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex2DArray,
                typeI32Vec3,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length === 0) {
                throw new PBParamLengthError('textureArrayLoad');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamValueError('textureArrayLoad', 'tex');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArrayLoad', 'tex');
            }
            if (pb.getDevice().type === 'webgl2') {
                if (args.length !== 4) {
                    throw new PBParamLengthError('textureArrayLoad');
                }
                const coords = pb.ivec3(args[1], args[2]);
                const level = args[3];
                return callBuiltin(pb, name, tex, coords, level);
            } else {
                if (texType.isStorageTexture()) {
                    texType.readable = true;
                }
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureStore(tex: PBShaderExp, coords: number|PBShaderExp, value: PBShaderExp);
    textureStore: {
        overloads: [
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8unorm,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8snorm,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8uint,
                typeU32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8sint,
                typeU32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16uint,
                typeU32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16sint,
                typeU32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16float,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32uint,
                typeU32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32sint,
                typeU32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32float,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32uint,
                typeU32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32sint,
                typeU32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32float,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32uint,
                typeU32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32sint,
                typeU32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32float,
                typeU32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8unorm,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8snorm,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32uint,
                typeI32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8unorm,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8snorm,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32float,
                typeU32Vec3,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (pb.getDevice().type === 'webgpu') {
                const tex = args[0];
                if (tex instanceof PBShaderExp) {
                    const texType = tex.$ast.getType();
                    if (texType?.isTextureType() && texType.isStorageTexture()) {
                        texType.writable = true;
                    }
                }
            }
            return callBuiltin(pb, name, ...args);
        }
    },
    // textureArrayStore(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, value: PBShaderExp);
    textureArrayStore: {
        overloads: [
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8unorm,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8snorm,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8uint,
                typeU32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8sint,
                typeU32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16uint,
                typeU32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16sint,
                typeU32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16float,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32uint,
                typeU32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32sint,
                typeU32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32float,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32uint,
                typeU32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32sint,
                typeU32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32float,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32uint,
                typeU32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32sint,
                typeU32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32float,
                typeU32Vec2,
                typeI32,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (pb.getDevice().type === 'webgpu') {
                const tex = args[0];
                if (tex instanceof PBShaderExp) {
                    const texType = tex.$ast.getType();
                    if (texType?.isTextureType() && texType.isStorageTexture()) {
                        texType.writable = true;
                    }
                }
            }
            return callBuiltin(pb, name, ...args);
        }
    },
    // textureNumLayers(tex: PBShaderExp);
    textureNumLayers: {
        overloads: [
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeITex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeUTex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeITexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeUTexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexDepth2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexDepthCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8snorm
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8unorm
            ])
        ]
    },
    // textureNumLevels(tex: PBShaderExp);
    textureNumLevels: {
        overloads: [
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepth2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepth2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepthCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepthCubeArray
            ])
        ]
    },
    // textureNumSamples(tex: PBShaderExp);
    textureNumSamples: {
        overloads: [
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeTexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeITexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeUTexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeTexDepthMultisampled2D
            ])
        ]
    },
    // textureSample(tex: texture, coords: number|PBShaderExp);
    textureSample: {
        overloads: [
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex1D,
                typeSampler,
                typeF32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSampleBaseClampToEdge', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex1D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex1D,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError('textureSample');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSample', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSample', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isStorageTexture()) {
                    throw new PBParamTypeError('textureSample', 'texture');
                }
                const sampler = pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const ret = callBuiltin(pb, name, tex, sampler, coords);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                if (texType.is1DTexture()) {
                    if (args[1] instanceof PBShaderExp) {
                        const coordType = args[1].$ast.getType();
                        if (!coordType.isPrimitiveType() || !coordType.isScalarType() || coordType.scalarType !== PBPrimitiveType.F32) {
                            throw new PBParamTypeError('textureSample', 'coord');
                        }
                    } else if (typeof args[1] !== 'number') {
                        throw new PBParamTypeError('textureSample', 'coord');
                    }
                    args[1] = pb.vec2(args[1], 0);
                }
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySample(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp)
    textureArraySample: {
        overloads: [
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2DArray,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureArraySample');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySample', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySample', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const ret = callBuiltin(pb, name, tex, sampler, coords, arrayIndex);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const coordsComposit = pb.vec3(coords, pb.float(arrayIndex));
                return callBuiltin(pb, name, tex, coordsComposit);
            }
        }
    },
    // textureSampleBias(tex: PBShaderExp, coords: PBShaderExp, bias: number|PBShaderExp)
    textureSampleBias: {
        overloads: [
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleBias');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleBias', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleBias', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySampleBias(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, bias: number|PBShaderExp)
    textureArraySampleBias: {
        overloads: [
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleBias');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleBias', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySampleBias', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else if (pb.getDevice().type === 'webgl2') {
                pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const coordsComposit = pb.vec3(coords, pb.float(arrayIndex));
                return callBuiltin(pb, name, tex, coordsComposit, args[3]);
            }
        }
    },
    // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
    textureSampleCompare: {
        overloads: [
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2D,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepthCube,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleCompare');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleCompare', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureSampleCompare', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(args[0], true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(args[0], true);
                let coordsComposite;
                if (texType.isCubeTexture() || texType.isArrayTexture()) {
                    coordsComposite = pb.vec4(args[1], args[2]);
                } else {
                    coordsComposite = pb.vec3(args[1], args[2]);
                }
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureArraySampleCompare(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
    textureArraySampleCompare: {
        overloads: [
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2DArray,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleCompare');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleCompare', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureArraySampleCompare', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(args[0], true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(args[0], true);
                const coordsComposite = pb.vec4(args[1], pb.float(args[2]), args[3]);
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureSampleLevel(tex: PBShaderExp, coords: PBShaderExp, level: number|PBShaderExp)
    textureSampleLevel: {
        overloads: [
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureCubeLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureCubeLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgl' && pb.shaderKind === 'vertex') {
                // WebGL1 does not support vertex texture lod
                return pb.textureSample(tex, args[1]);
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isExternalTexture()) {
                    return pb.textureLoad(tex, pb.ivec2(args[1]), 0);
                } else {
                    const sampler = pb.getDefaultSampler(tex, false);
                    const level = texType.isDepthTexture() && (typeof args[2] === 'number' || args[2] instanceof PBShaderExp && args[2].$ast.getType().isCompatibleType(typeF32)) ? pb.int(args[2]) : args[2];
                    const ret = texType.isExternalTexture() ? callBuiltin(pb, name, tex, sampler, args[1]) : callBuiltin(pb, name, tex, sampler, args[1], level);
                    if (ret.$ast.getType().isCompatibleType(typeF32)) {
                        return pb.vec4(ret);
                    } else {
                        return ret;
                    }
                }
            } else {
                pb.getDefaultSampler(tex, false);
                return texType.isExternalTexture() ? callBuiltin(pb, name, args[0], args[1], 0) : callBuiltin(pb, name, args[0], args[1], args[2]);
            }
        }
    },
    // textureArraySampleLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp)
    textureArraySampleLevel: {
        overloads: [
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeI32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySampleLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                const level = texType.isDepthTexture() && (typeof args[3] === 'number' || args[3] instanceof PBShaderExp && args[3].$ast.getType().isCompatibleType(typeF32)) ? pb.int(args[3]) : args[3];
                const ret = callBuiltin(pb, name, tex, sampler, args[1], args[2], level);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                const coordsComposite = pb.vec3(args[1], pb.float(args[2]));
                return callBuiltin(pb, name, tex, coordsComposite, args[3]);
            }
        }
    },
    // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
    textureSampleCompareLevel: {
        overloads: [
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32, [
                typeTexDepth2D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepthCube,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleCompareLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(args[0], true);
                let coordsComposite;
                if (texType.isCubeTexture() || texType.isArrayTexture()) {
                    coordsComposite = pb.vec4(args[1], args[2]);
                } else {
                    coordsComposite = pb.vec3(args[1], args[2]);
                }
                return texType.isCubeTexture() ? callBuiltin(pb, name, tex, coordsComposite) : callBuiltin(pb, name, tex, coordsComposite, 0);
            }
        }
    },
    // textureArraySampleCompareLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
    textureArraySampleCompareLevel: {
        overloads: [
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2DArray,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleCompareLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(args[0], true);
                const coordsComposite = pb.vec4(args[1], pb.float(args[2]), args[3]);
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureSampleGrad(tex: PBShaderExp, coords: PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
    textureSampleGrad: {
        overloads: [
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('texture2DGradEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureCubeGradEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureSampleGrad');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleGrad', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleGrad', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySampleGrad(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
    textureArraySampleGrad: {
        overloads: [
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32Vec2,
                typeF32Vec2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 5) {
                throw new PBParamLengthError('textureArraySampleGrad');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleGrad', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isArrayTexture()) {
                throw new PBParamTypeError('textureArraySampleGrad', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3], args[4]);
            } else {
                pb.getDefaultSampler(tex, false);
                const coordsComposite = pb.vec3(args[1], pb.float(args[2]));
                return callBuiltin(pb, name, tex, coordsComposite, args[3], args[4]);
            }
        }
    },
    storageBarrier: {
        overloads: genType('storageBarrier', MASK_WEBGPU, typeVoid, [])
    },
    workgroupBarrier: {
        overloads: genType('workgroupBarrier', MASK_WEBGPU, typeVoid, [])
    },
    atomicLoad: {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError(name);
            }
            const arg = args[0];
            if (!(arg instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg.$ast.getType().typeId === typeAtomicI32.typeId) {
                return pb.$callFunctionNoCheck(name, [
                    new ASTAddressOf(arg.$ast)
                ], typeI32);
            } else if (arg.$ast.getType().typeId === typeAtomicU32.typeId) {
                return pb.$callFunctionNoCheck(name, [
                    new ASTAddressOf(arg.$ast)
                ], typeU32);
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    },
    atomicStore: {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError(name);
            }
            const arg1 = args[0];
            const arg2 = args[1];
            if (!(arg1 instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg1.$ast.getType().typeId === typeAtomicI32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeI32)
                    ], typeVoid);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeI32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeVoid);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else if (arg1.$ast.getType().typeId === typeAtomicU32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeU32)
                    ], typeVoid);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeU32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeVoid);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    }
};
for (const name of [
    'atomicAdd',
    'atomicSub',
    'atomicMax',
    'atomicMin',
    'atomicAnd',
    'atomicOr',
    'atomicXor',
    'atomicExchange'
]){
    // @ts-ignore 7053
    builtinFunctionsAll[name] = {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError(name);
            }
            const arg1 = args[0];
            const arg2 = args[1];
            if (!(arg1 instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg1.$ast.getType().typeId === typeAtomicI32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeI32)
                    ], typeI32);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeI32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeI32);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else if (arg1.$ast.getType().typeId === typeAtomicU32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeU32)
                    ], typeU32);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeU32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeU32);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    };
}
/** @internal */ function setBuiltinFuncs(cls) {
    for (const k of Object.keys(builtinFunctionsAll)){
        // @ts-ignore 7053
        cls.prototype[k] = function(...args) {
            // @ts-ignore 7053
            const normalizeFunc = builtinFunctionsAll?.[k]?.normalizeFunc || callBuiltin;
            return normalizeFunc(this, k, ...args);
        };
    }
}

const StorageTextureFormatMap = {
    rgba8unorm: 'rgba8unorm',
    rgba8snorm: 'rgba8snorm',
    rgba8uint: 'rgba8ui',
    rgba8sint: 'rgba8i',
    rgba16uint: 'rgba16ui',
    rgba16sint: 'rgba16i',
    rgba16float: 'rgba16f',
    r32float: 'r32f',
    r32uint: 'r32ui',
    r32sint: 'r32i',
    rg32float: 'rg32f',
    rg32uint: 'rg32ui',
    rg32sint: 'rg32i',
    rgba32float: 'rgba32f',
    rgba32uint: 'rgba32ui',
    rgba32sint: 'rgba32i'
};
function vec_n(vecType, ...args) {
    if (this.getDevice().type === 'webgl') {
        if (vecType.scalarType === PBPrimitiveType.U32) {
            throw new PBDeviceNotSupport('unsigned integer type');
        }
        if (vecType.isMatrixType() && vecType.cols !== vecType.rows) {
            throw new PBDeviceNotSupport('non-square matrix type');
        }
    }
    if (args.length === 1 && typeof args[0] === 'string') {
        return new PBShaderExp(args[0], vecType);
    } else {
        const exp = new PBShaderExp('', vecType);
        if (vecType.isScalarType() && args.length === 1 && (typeof args[0] === 'number' || typeof args[0] === 'boolean')) {
            exp.$ast = new ASTScalar(args[0], vecType);
        } else {
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, args.map((arg)=>{
                if (typeof arg === 'string') {
                    throw new PBParamTypeError('vec_n');
                }
                return arg instanceof PBShaderExp ? arg.$ast : arg;
            }));
        }
        return exp;
    }
}
const primitiveCtors = {
    float: typeF32,
    int: typeI32,
    uint: typeU32,
    bool: typeBool,
    vec2: typeF32Vec2,
    ivec2: typeI32Vec2,
    uvec2: typeU32Vec2,
    bvec2: typeBVec2,
    vec3: typeF32Vec3,
    ivec3: typeI32Vec3,
    uvec3: typeU32Vec3,
    bvec3: typeBVec3,
    vec4: typeF32Vec4,
    ivec4: typeI32Vec4,
    uvec4: typeU32Vec4,
    bvec4: typeBVec4,
    mat2: typeMat2,
    mat2x3: typeMat2x3,
    mat2x4: typeMat2x4,
    mat3x2: typeMat3x2,
    mat3: typeMat3,
    mat3x4: typeMat3x4,
    mat4x2: typeMat4x2,
    mat4x3: typeMat4x3,
    mat4: typeMat4
};
const simpleCtors = {
    tex1D: typeTex1D,
    tex2D: typeTex2D,
    tex3D: typeTex3D,
    texCube: typeTexCube,
    tex2DShadow: typeTexDepth2D,
    texCubeShadow: typeTexDepthCube,
    tex2DArray: typeTex2DArray,
    tex2DArrayShadow: typeTexDepth2DArray,
    texExternal: typeTexExternal,
    itex1D: typeITex1D,
    itex2D: typeITex2D,
    itex3D: typeITex3D,
    itexCube: typeITexCube,
    itex2DArray: typeITex2DArray,
    utex1D: typeUTex1D,
    utex2D: typeUTex2D,
    utex3D: typeUTex3D,
    utexCube: typeUTexCube,
    utex2DArray: typeUTex2DArray,
    sampler: typeSampler,
    samplerComparison: typeSamplerComparison
};
function makeStorageTextureCtor(type) {
    const ctor = {};
    for (const k of Object.keys(StorageTextureFormatMap)){
        // @ts-ignore 7053
        ctor[k] = function(rhs) {
            // @ts-ignore 7053
            return new PBShaderExp(rhs, new PBTextureTypeInfo(type, StorageTextureFormatMap[k]));
        };
    }
    return ctor;
}
const texStorageCtors = {
    texStorage1D: PBTextureType.TEX_STORAGE_1D,
    texStorage2D: PBTextureType.TEX_STORAGE_2D,
    texStorage2DArray: PBTextureType.TEX_STORAGE_2D_ARRAY,
    texStorage3D: PBTextureType.TEX_STORAGE_3D
};
/** @internal */ function setConstructors(cls) {
    Object.keys(primitiveCtors).forEach((k)=>{
        cls.prototype[k] = makeConstructor(function(...args) {
            return vec_n.call(this, primitiveCtors[k], ...args);
        }, primitiveCtors[k]);
    });
    Object.keys(simpleCtors).forEach((k)=>{
        cls.prototype[k] = function(rhs) {
            return new PBShaderExp(rhs, simpleCtors[k]);
        };
    });
    Object.keys(texStorageCtors).forEach((k)=>{
        cls.prototype[k] = makeStorageTextureCtor(texStorageCtors[k]);
    });
    cls.prototype['atomic_int'] = makeConstructor(function(...args) {
        if (args.length > 1) {
            throw new PBParamLengthError('atomic_int');
        }
        if (args.length === 1) {
            if (typeof args[0] !== 'string') {
                throw new PBParamTypeError('atomic_int', 'name');
            }
            return new PBShaderExp(args[0], typeAtomicI32);
        } else {
            const exp = new PBShaderExp('', typeAtomicI32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, []);
            return exp;
        }
    }, typeAtomicI32);
    cls.prototype['atomic_uint'] = makeConstructor(function(...args) {
        if (args.length > 1) {
            throw new PBParamLengthError('atomic_uint');
        }
        if (args.length === 1 && typeof args[0] === 'string') {
            return new PBShaderExp(args[0], typeAtomicU32);
        } else if (args.length === 0) {
            const exp = new PBShaderExp('', typeAtomicU32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, []);
            return exp;
        }
        const arg = args[0];
        if (typeof arg === 'number' && Number.isInteger(arg) || arg instanceof PBShaderExp && arg.$ast.getType().typeId === typeU32.typeId) {
            const exp = new PBShaderExp('', typeAtomicU32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, [
                arg instanceof PBShaderExp ? arg.$ast : arg
            ]);
            return exp;
        }
        return null;
    }, typeAtomicU32);
} /*
ProgramBuilder.prototype.texStorage1D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_1D);
ProgramBuilder.prototype.texStorage2D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_2D);
ProgramBuilder.prototype.texStorage2DArray = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_2D_ARRAY);
ProgramBuilder.prototype.texStorage3D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_3D);
*/

const COMPUTE_UNIFORM_NAME = 'zUBC';
const COMPUTE_STORAGE_NAME = 'zSBC';
const VERTEX_UNIFORM_NAME = 'zUBV';
const FRAGMENT_UNIFORM_NAME = 'zUBF';
const SHARED_UNIFORM_NAME = 'zUBA';
const VERTEX_STORAGE_NAME = 'zSBV';
const FRAGMENT_STORAGE_NAME = 'zSBF';
const SHARED_STORAGE_NAME = 'zSBA';
const input_prefix = 'zVSInput_';
const output_prefix_vs = 'zVSOutput_';
const output_prefix_fs = 'zFSOutput_';
/**
 * The program builder class
 * @public
 */ class ProgramBuilder {
    /** @internal */ _device;
    /** @internal */ _workgroupSize;
    /** @internal */ _scopeStack = [];
    /** @internal */ _shaderType = ShaderType.Vertex | ShaderType.Fragment | ShaderType.Compute;
    /** @internal */ _structInfo;
    /** @internal */ _uniforms;
    /** @internal */ _globalScope;
    /** @internal */ _builtinScope;
    /** @internal */ _inputScope;
    /** @internal */ _outputScope;
    /** @internal */ _inputs;
    /** @internal */ _outputs;
    /** @internal */ _vertexAttributes;
    /** @internal */ _depthRangeCorrection;
    /** @internal */ _emulateDepthClamp;
    /** @internal */ _lastError;
    /** @internal */ _reflection;
    /** @internal */ _autoStructureTypeIndex;
    /** @internal */ _nameMap;
    /**
   * Creates a program builder for given device
   * @param device - The device
   */ constructor(device){
        this._device = device;
        this._workgroupSize = null;
        this._structInfo = {};
        this._uniforms = [];
        this._scopeStack = [];
        this._globalScope = null;
        this._builtinScope = null;
        this._inputScope = null;
        this._outputScope = null;
        this._inputs = [];
        this._outputs = [];
        this._vertexAttributes = [];
        this._depthRangeCorrection = device.type === 'webgpu';
        this._emulateDepthClamp = false;
        this._lastError = null;
        this._reflection = new PBReflection(this);
        this._autoStructureTypeIndex = 0;
        this._nameMap = [];
    }
    /** Get last error */ get lastError() {
        return this._lastError;
    }
    /** @internal */ get shaderType() {
        return this._shaderType;
    }
    /** Current shader kind */ get shaderKind() {
        return this._shaderType === ShaderType.Vertex ? 'vertex' : this._shaderType === ShaderType.Fragment ? 'fragment' : this._shaderType === ShaderType.Compute ? 'compute' : null;
    }
    /** Gets the global scope */ getGlobalScope() {
        return this._globalScope;
    }
    /** @internal */ get builtinScope() {
        return this._builtinScope;
    }
    /** @internal */ get inputScope() {
        return this._inputScope;
    }
    /** @internal */ get outputScope() {
        return this._outputScope;
    }
    /** @internal */ get depthRangeCorrection() {
        return this._depthRangeCorrection;
    }
    get emulateDepthClamp() {
        return this._emulateDepthClamp;
    }
    set emulateDepthClamp(val) {
        this._emulateDepthClamp = val;
    }
    /** Get the shader code reflection interface */ getReflection() {
        return this._reflection;
    }
    /** Get the device */ getDevice() {
        return this._device;
    }
    /** @internal */ reset() {
        this._workgroupSize = null;
        this._structInfo = {};
        this._uniforms = [];
        this._scopeStack = [];
        this._globalScope = null;
        this._builtinScope = null;
        this._inputScope = null;
        this._outputScope = null;
        this._inputs = [];
        this._outputs = [];
        this._vertexAttributes = [];
        this._depthRangeCorrection = this._device.type === 'webgpu';
        this._reflection = new PBReflection(this);
        this._autoStructureTypeIndex = 0;
        this._nameMap = [];
    }
    /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */ queryGlobal(name) {
        return this.getReflection().tag(name);
    }
    /** @internal */ pushScope(scope) {
        this._scopeStack.unshift(scope);
    }
    /** @internal */ popScope() {
        return this._scopeStack.shift();
    }
    /** Gets the current scope */ getCurrentScope() {
        return this._scopeStack[0];
    }
    /** Gets the current function scope */ getCurrentFunctionScope() {
        let funcScope = this.getCurrentScope();
        while(funcScope && !(funcScope instanceof PBFunctionScope)){
            funcScope = funcScope.$parent;
        }
        return funcScope;
    }
    /**
   * Generates shader codes for a render program
   * @param options - The build options
   * @returns a tuple made by vertex shader source, fragment shader source, bind group layouts and vertex attributes used, or null if build faild
   */ buildRender(options) {
        setCurrentProgramBuilder(this);
        this._lastError = null;
        this.defineInternalStructs();
        const ret = this.buildRenderSource(options);
        setCurrentProgramBuilder(null);
        this.reset();
        return ret;
    }
    /**
   * Generates shader code for a compute program
   * @param options - The build programs
   * @returns a tuple made by compute shader source and bind group layouts, or null if build failed
   */ buildCompute(options) {
        setCurrentProgramBuilder(this);
        this._lastError = null;
        this._workgroupSize = options.workgroupSize;
        this.defineInternalStructs();
        const ret = this.buildComputeSource(options);
        setCurrentProgramBuilder(null);
        this.reset();
        return ret;
    }
    /**
   * Creates a shader program for render
   * @param options - The build options
   * @returns The created program or null if build failed
   */ buildRenderProgram(options) {
        const ret = this.buildRender(options);
        return ret ? this._device.createGPUProgram({
            type: 'render',
            label: options.label,
            params: {
                vs: ret[0],
                fs: ret[1],
                bindGroupLayouts: ret[2],
                vertexAttributes: ret[3]
            }
        }) : null;
    }
    /**
   * Creates a shader program for compute
   * @param options - The build options
   * @returns The created program or null if build failed
   */ buildComputeProgram(options) {
        const ret = this.buildCompute(options);
        return ret ? this._device.createGPUProgram({
            type: 'compute',
            params: {
                source: ret[0],
                bindGroupLayouts: ret[1]
            }
        }) : null;
    }
    /**
   * Creates a function
   * @param name - Name of the function
   * @param params - Parameters of the function
   * @param body - The generator function
   */ func(name, params, body) {
        this.getGlobalScope().$createFunctionIfNotExists(name, params, body);
    }
    /**
   * Create the main entry function of the shader
   * @param body - The shader generator function
   */ main(body) {
        this.getGlobalScope().$mainFunc(body);
    }
    /**
   * Create an 'AddressOf' expression for WGSL
   * @param ref - The reference variable
   * @returns the 'AddressOf' expression
   */ addressOf(ref) {
        if (this._device.type !== 'webgpu') {
            throw new PBDeviceNotSupport('pointer shader type');
        }
        if (!ref.$ast.isReference()) {
            throw new PBReferenceValueRequired(ref);
        }
        const exp = new PBShaderExp('', ref.$ast.getType());
        exp.$ast = new ASTAddressOf(ref.$ast);
        return exp;
    }
    /**
   * Creates a 'referenceOf' expression for WGSL
   * @param ptr - The pointer variable
   * @returns the 'referenceOf' expression
   */ referenceOf(ptr) {
        if (this._device.type !== 'webgpu') {
            throw new PBDeviceNotSupport('pointer shader type');
        }
        if (!ptr.$ast.getType().isPointerType()) {
            throw new PBPointerValueRequired(ptr);
        }
        const ast = new ASTReferenceOf(ptr.$ast);
        const exp = new PBShaderExp('', ast.getType());
        exp.$ast = ast;
        return exp;
    }
    /**
   * Creates a structure type variable
   * @param structName - Name of the structure type
   * @param instanceName - Name of the variable
   * @returns the created variable
   */ struct(structName, instanceName) {
        let ctor = null;
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & this._shaderType) {
                const structInfo = this._structInfo[st];
                ctor = structInfo?.structs[structName];
                if (!!ctor) {
                    break;
                }
            }
        }
        if (!ctor) {
            throw new PBParamValueError('struct', 'structName', `Struct type ${structName} not exists`);
        }
        return ctor.call(this, instanceName);
    }
    /** @internal */ isIdenticalStruct(a, b, checkName) {
        if (checkName && a.structName && b.structName && a.structName !== b.structName) {
            return false;
        }
        if (a.structMembers.length !== b.structMembers.length) {
            return false;
        }
        for(let index = 0; index < a.structMembers.length; index++){
            const val = a.structMembers[index];
            const other = b.structMembers[index];
            if (val.name !== other.name) {
                return false;
            }
            if (val.type.isStructType()) {
                if (!other.type.isStructType()) {
                    return false;
                }
                if (!this.isIdenticalStruct(val.type, other.type, true)) {
                    return false;
                }
            } else if (!val.type.isCompatibleType(other.type)) {
                return false;
            }
        }
        return true;
    }
    /** @internal */ generateStructureName() {
        return `zStruct${this._autoStructureTypeIndex++}`;
    }
    /** @internal */ getVertexAttributes() {
        return this._vertexAttributes;
    }
    /** @internal */ defineHiddenStruct(type) {
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structInfo = this._structInfo[shaderType];
            if (!structInfo) {
                structInfo = {
                    structs: {},
                    types: []
                };
                this._structInfo[shaderType] = structInfo;
            }
            if (structInfo.structs[type.structName]) {
                throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${type.structName}'`);
            }
            structInfo.types.push(new ASTStructDefine(type, true));
        }
    }
    // /**
    //  * Defines an uniform buffer
    //  * @param name - Name of the uniform buffer
    //  * @param args - Members of the buffer structure
    //  * @returns The structure type constructor
    //  */
    // defineUniformBuffer(name: string, ...args: PBShaderExp[]): ShaderTypeFunc {
    //   return this.defineStructOrUniformBuffer(name, 'std140', ...args);
    // }
    // /**
    //  * Defines a structure type
    //  * @param structName - Name of the type
    //  * @param layout - The structure layout
    //  * @param args - Members of the structure
    //  * @returns The structure type constructor
    //  */
    // defineStruct(structName: string, ...args: PBShaderExp[]): ShaderTypeFunc {
    //   return this.defineStructOrUniformBuffer(structName, 'default', ...args);
    // }
    /**
   * Defines a structure type
   * @param members - Members of the structure
   * @param structName - Name of the type
   * @returns The structure type constructor
   */ defineStruct(members, structName) {
        const layout = 'default';
        const structType = new PBStructTypeInfo(structName ?? '', layout, members.map((arg)=>{
            if (!arg.$typeinfo.isPrimitiveType() && !arg.$typeinfo.isArrayType() && !arg.$typeinfo.isStructType() && !arg.$typeinfo.isAtomicI32() && !arg.$typeinfo.isAtomicU32()) {
                throw new Error(`invalid struct member type: '${arg.$str}'`);
            }
            return {
                name: arg.$str,
                type: arg.$typeinfo
            };
        }));
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structDef = null;
            let ctor = null;
            const structInfo = this._structInfo[shaderType];
            if (structInfo) {
                if (getCurrentProgramBuilder().shaderType === shaderType && structInfo.structs[structType.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${structType.structName}'`);
                }
                for (const type of structInfo.types){
                    if (!type.builtin && this.isIdenticalStruct(type.getType(), structType, false)) {
                        structDef = type;
                        ctor = structInfo.structs[type.getType().structName];
                        break;
                    }
                }
            }
            if (structDef) {
                if (structDef.type.layout !== layout) {
                    throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
                }
                if (shaderType !== getCurrentProgramBuilder().shaderType) {
                    if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
                        this._structInfo[getCurrentProgramBuilder().shaderType] = {
                            structs: {},
                            types: []
                        };
                    }
                    if (this._structInfo[getCurrentProgramBuilder().shaderType].types.indexOf(structDef) < 0) {
                        this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
                        this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] = ctor;
                    }
                }
                return ctor;
            }
        }
        return this.internalDefineStruct(structName ?? this.generateStructureName(), layout, this._shaderType, false, ...members);
    }
    /**
   * Defines a structure type
   * @param structType - The structure type info
   * @returns The structure type constructor
   */ defineStructByType(structType) {
        const typeCopy = structType.extends(structType.structName || this.generateStructureName(), []);
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structDef = null;
            let ctor = null;
            const structInfo = this._structInfo[shaderType];
            if (structInfo) {
                if (getCurrentProgramBuilder().shaderType === shaderType && structInfo.structs[typeCopy.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${typeCopy.structName}'`);
                }
                for (const type of structInfo.types){
                    if (!type.builtin && this.isIdenticalStruct(type.getType(), typeCopy, false)) {
                        structDef = type;
                        ctor = structInfo.structs[type.getType().structName];
                        break;
                    }
                }
            }
            if (structDef) {
                if (structDef.type.layout !== typeCopy.layout) {
                    throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
                }
                if (shaderType !== getCurrentProgramBuilder().shaderType) {
                    if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
                        this._structInfo[getCurrentProgramBuilder().shaderType] = {
                            structs: {},
                            types: []
                        };
                    }
                    this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
                    this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] = ctor;
                }
                return ctor;
            }
        }
        return this.internalDefineStructByType(this._shaderType, false, typeCopy);
    }
    /** @internal */ internalDefineStruct(structName, layout, shaderTypeMask, builtin, ...args) {
        const structType = new PBStructTypeInfo(structName, layout, args.map((arg)=>{
            if (!arg.$typeinfo.isPrimitiveType() && !arg.$typeinfo.isArrayType() && !arg.$typeinfo.isStructType() && !arg.$typeinfo.isAtomicI32() && !arg.$typeinfo.isAtomicU32()) {
                throw new Error(`invalid struct member type: '${arg.$str}'`);
            }
            return {
                name: arg.$str,
                type: arg.$typeinfo
            };
        }));
        return this.internalDefineStructByType(shaderTypeMask, builtin, structType);
    }
    /** @internal */ internalDefineStructByType(shaderTypeMask, builtin, structType) {
        const struct = makeConstructor(function structConstructor(...blockArgs) {
            let e;
            if (blockArgs.length === 1 && typeof blockArgs[0] === 'string') {
                e = new PBShaderExp(blockArgs[0], structType);
            } else {
                e = new PBShaderExp('', structType);
                e.$ast = new ASTShaderExpConstructor(e.$typeinfo, blockArgs.map((arg)=>arg instanceof PBShaderExp ? arg.$ast : arg));
            }
            return e;
        }, structType);
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (shaderTypeMask & shaderType) {
                let structInfo = this._structInfo[shaderType];
                if (!structInfo) {
                    structInfo = {
                        structs: {},
                        types: []
                    };
                    this._structInfo[shaderType] = structInfo;
                }
                if (structInfo.structs[structType.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${structType.structName}'`);
                }
                structInfo.types.push(new ASTStructDefine(structType, builtin));
                structInfo.structs[structType.structName] = struct;
            }
        }
        // this.changeStructLayout(structType, layout);
        return struct;
    }
    /** @internal */ getFunction(name) {
        return this._globalScope ? this._globalScope.$getFunctions(name) : null;
    }
    /** @internal */ get structInfo() {
        return this._structInfo[this._shaderType];
    }
    /** @internal */ getBlockName(instanceName) {
        return `ch_block_name_${instanceName}`;
    }
    /** @internal */ defineBuiltinStruct(shaderType, inOrOut) {
        const structName = inOrOut === 'in' ? getBuiltinInputStructName(shaderType) : getBuiltinOutputStructName(shaderType);
        const instanceName = inOrOut === 'in' ? getBuiltinInputStructInstanceName(shaderType) : getBuiltinOutputStructInstanceName(shaderType);
        const stage = shaderType === ShaderType.Vertex ? 'vertex' : shaderType === ShaderType.Fragment ? 'fragment' : 'compute';
        const builtinVars = builtinVariables['webgpu'];
        const args = [];
        const prefix = [];
        for(const k in builtinVars){
            const v = builtinVars[k];
            if (v.stage === stage && v.inOrOut === inOrOut) {
                args.push({
                    name: v.name,
                    type: v.type
                });
                prefix.push(`@builtin(${v.semantic}) `);
            }
        }
        const inoutList = inOrOut === 'in' ? this._inputs : this._outputs;
        for (const k of inoutList){
            // for debug only
            if (!(k[1] instanceof ASTDeclareVar)) {
                throw new PBInternalError('defineBuiltinStruct() failed: input/output is not declare var ast node');
            }
            const type = k[1].value.getType();
            if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
                throw new Error(`invalid in/out variable type: '${k[1].value.name}'`);
            }
            args.push({
                name: k[1].value.name,
                type: type
            });
            prefix.push(`@location(${k[1].value.value.$location}) ${type.isPrimitiveType() && type.isInteger() ? '@interpolate(flat) ' : ''}`);
        }
        if (args.length > 0) {
            const st = this.findStructType(structName, shaderType);
            if (st) {
                st.getType().reset(structName, 'default', args);
                st.prefix = prefix;
                return null;
            } else {
                const structType = this.internalDefineStructByType(this._shaderType, false, new PBStructTypeInfo(structName, 'default', args));
                this.findStructType(structName, shaderType).prefix = prefix;
                const structInstance = this.struct(structName, instanceName);
                const structInstanceIN = inOrOut === 'in' ? this.struct(structName, getBuiltinParamName(shaderType)) : structInstance;
                return [
                    structType,
                    structInstance,
                    structName,
                    structInstanceIN
                ];
            }
        } else {
            return null;
        }
    }
    /** @internal */ defineInternalStructs() {
        this.defineHiddenStruct(typeFrexpResult);
        this.defineHiddenStruct(typeFrexpResultVec2);
        this.defineHiddenStruct(typeFrexpResultVec3);
        this.defineHiddenStruct(typeFrexpResultVec4);
    }
    /** @internal */ array(...args) {
        if (args.length === 0) {
            throw new PBParamLengthError('array');
        }
        args = args.map((arg)=>this.normalizeExpValue(arg));
        let typeok = true;
        let type = null;
        let isBool = true;
        let isFloat = true;
        let isInt = true;
        let isUint = true;
        let isComposite = false;
        for (const arg of args){
            if (arg instanceof PBShaderExp) {
                const argType = arg.$ast.getType();
                if (!argType.isConstructible()) {
                    typeok = false;
                    break;
                }
                if (!type) {
                    type = argType;
                } else if (!argType.isCompatibleType(type)) {
                    typeok = false;
                }
            }
        }
        if (typeok) {
            if (type && type.isPrimitiveType() && type.isScalarType()) {
                isBool = type.primitiveType === PBPrimitiveType.BOOL;
                isFloat = type.primitiveType === PBPrimitiveType.F32;
                isUint = type.primitiveType === PBPrimitiveType.U32;
                isInt = type.primitiveType === PBPrimitiveType.I32;
            } else if (type) {
                isBool = false;
                isFloat = false;
                isUint = false;
                isInt = false;
                isComposite = true;
            }
            for (const arg of args){
                if (!(arg instanceof PBShaderExp) && isComposite) {
                    typeok = false;
                    break;
                }
                if (typeof arg === 'number') {
                    isBool = false;
                    if ((arg | 0) === arg) {
                        if (arg < 0) {
                            isUint = false;
                            isInt = isInt && arg >= 0x80000000 >> 0;
                        } else {
                            isUint = isUint && arg <= 0xffffffff;
                            isInt = isInt && arg <= 0x7fffffff;
                        }
                    }
                } else if (typeof arg === 'boolean') {
                    isFloat = false;
                    isInt = false;
                    isUint = false;
                }
            }
        }
        if (typeok && !isComposite) {
            if (isBool) {
                type = typeBool;
            } else if (isInt) {
                type = typeI32;
            } else if (isUint) {
                type = typeU32;
            } else if (isFloat) {
                type = typeF32;
            }
            typeok = !!type;
        }
        if (!typeok) {
            throw new PBParamTypeError('array');
        }
        if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
            throw new PBParamTypeError('array');
        }
        const arrayType = new PBArrayTypeInfo(type, args.length);
        const exp = new PBShaderExp('', arrayType);
        exp.$ast = new ASTShaderExpConstructor(arrayType, args.map((arg)=>{
            if (arg instanceof PBShaderExp) {
                return arg.$ast;
            }
            if (!type.isPrimitiveType() || !type.isScalarType()) {
                throw new PBTypeCastError(arg, typeof arg, type);
            }
            return new ASTScalar(arg, type);
        }));
        return exp;
    }
    /**
   * Creates a 'discard' statement
   */ discard() {
        this.getCurrentScope().$ast.statements.push(new ASTDiscard());
    }
    /** @internal */ tagShaderExp(getter, tagValue) {
        if (typeof tagValue === 'string') {
            this._reflection.tag(tagValue, getter);
        } else if (Array.isArray(tagValue)) {
            tagValue.forEach((tag)=>this.tagShaderExp(getter, tag));
        } else {
            for (const k of Object.keys(tagValue)){
                this.tagShaderExp((scope)=>{
                    const value = getter(scope);
                    return value[k];
                }, tagValue[k]);
            }
        }
    }
    /** @internal */ in(location, name, variable) {
        if (this._inputs[location]) {
            // input already exists, create an alias
            if (!this._inputScope[name]) {
                Object.defineProperty(this._inputScope, name, {
                    get: function() {
                        return variable;
                    },
                    set: function() {
                        throw new Error(`cannot assign to readonly variable: ${name}`);
                    }
                });
            }
        //throw new Error(`input location ${location} already declared`);
        } else {
            variable.$location = location;
            variable.$declareType = DeclareType.DECLARE_TYPE_IN;
            this._inputs[location] = [
                name,
                new ASTDeclareVar(new ASTPrimitive(variable))
            ];
            Object.defineProperty(this._inputScope, name, {
                get: function() {
                    return variable;
                },
                set: function() {
                    throw new Error(`cannot assign to readonly variable: ${name}`);
                }
            });
            variable.$tags.forEach((val)=>this.tagShaderExp(()=>variable, val));
        }
    }
    /** @internal */ out(location, name, variable) {
        if (this._outputs[location]) {
            throw new Error(`output location ${location} has already been used`);
        }
        variable.$location = location;
        variable.$declareType = DeclareType.DECLARE_TYPE_OUT;
        this._outputs[location] = [
            name,
            new ASTDeclareVar(new ASTPrimitive(variable))
        ];
        for (const prop of [
            name,
            String(location)
        ]){
            Object.defineProperty(this._outputScope, prop, {
                get: function() {
                    return variable;
                },
                set: function(v) {
                    getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(variable.$ast), v instanceof PBShaderExp ? v.$ast : v));
                }
            });
        }
    }
    /** @internal */ getDefaultSampler(t, comparison) {
        const u = this._uniforms.findIndex((val)=>val.texture?.exp === t);
        if (u < 0) {
            return null;
        //throw new Error('invalid texture uniform object');
        }
        const samplerType = comparison ? 'comparison' : 'sample';
        if (this._uniforms[u].texture.autoBindSampler && this._uniforms[u].texture.autoBindSampler !== samplerType) {
            throw new Error('multiple sampler not supported');
        }
        this._uniforms[u].texture.autoBindSampler = samplerType;
        if (this._device.type === 'webgpu') {
            const samplerName = genSamplerName(t.$str, comparison);
            if (!this.getGlobalScope()[samplerName]) {
                throw new Error(`failed to find sampler name ${samplerName}`);
            }
            return this.getGlobalScope()[samplerName];
        } else {
            return null;
        }
    }
    /** @internal */ normalizeExpValue(value) {
        if (Array.isArray(value)) {
            const converted = value.map((val)=>Array.isArray(val) ? this.normalizeExpValue(val) : val);
            return this.array(...converted);
        } else {
            return value;
        }
    }
    /** @internal */ guessExpValueType(value) {
        const val = this.normalizeExpValue(value);
        if (typeof val === 'boolean') {
            return typeBool;
        } else if (typeof val === 'number') {
            if (!Number.isInteger(val)) {
                return typeF32;
            } else if (val >= 0x80000000 >> 1 && val <= 0x7fffffff) {
                return typeI32;
            } else if (val >= 0 && val <= 0xffffffff) {
                return typeU32;
            } else {
                throw new PBValueOutOfRange(val);
            }
        } else {
            return val.$ast?.getType() || val.$typeinfo;
        }
    }
    /** @internal */ findStructType(name, shaderType) {
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & shaderType) {
                const structInfo = this._structInfo[st];
                if (structInfo) {
                    for (const t of structInfo.types){
                        if (t.type.structName === name) {
                            return t;
                        }
                    }
                }
            }
        }
        return null;
    }
    /** @internal */ findStructConstructor(name, shaderType) {
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & shaderType) {
                const structInfo = this._structInfo[st];
                if (structInfo && structInfo.structs?.[name]) {
                    return structInfo.structs[name];
                }
            }
        }
        return null;
    }
    /** @internal */ buildComputeSource(options) {
        try {
            this._lastError = null;
            this._shaderType = ShaderType.Compute;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            this.generate(options.compute);
            // this.removeUnusedSamplerBindings(this._globalScope);
            this.mergeUniformsCompute(this._globalScope);
            this.updateUniformBindings([
                this._globalScope
            ], [
                ShaderType.Compute
            ]);
            return [
                this.generateComputeSource(this._globalScope, this._builtinScope),
                this.createBindGroupLayouts(options.label)
            ];
        } catch (err) {
            if (err instanceof PBError) {
                this._lastError = err.getMessage(this._device.type);
                console.error(this._lastError);
                return null;
            } else if (err instanceof Error) {
                this._lastError = err.toString();
                console.error(this._lastError);
                return null;
            } else {
                this._lastError = Object.prototype.toString.call(err);
                console.error(`Error: ${this._lastError}`);
                return null;
            }
        }
    }
    /** @internal */ buildRenderSource(options) {
        try {
            this._lastError = null;
            this._shaderType = ShaderType.Vertex;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            this.generate(options.vertex);
            const vertexScope = this._globalScope;
            const vertexBuiltinScope = this._builtinScope;
            const vertexInputs = this._inputs;
            const vertexOutputs = this._outputs;
            this._shaderType = ShaderType.Fragment;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            vertexOutputs.forEach((val, index)=>{
                this.in(index, val[0], new PBShaderExp(val[1].value.name, val[1].value.getType()).tag(...val[1].value.value.$tags));
            });
            this.generate(options.fragment);
            const fragScope = this._globalScope;
            const fragBuiltinScope = this._builtinScope;
            const fragInputs = this._inputs;
            const fragOutputs = this._outputs;
            this.mergeUniforms(vertexScope, fragScope);
            this.updateUniformBindings([
                vertexScope,
                fragScope
            ], [
                ShaderType.Vertex,
                ShaderType.Fragment
            ]);
            return [
                this.generateRenderSource(ShaderType.Vertex, vertexScope, vertexBuiltinScope, vertexInputs.map((val)=>val[1]), vertexOutputs.map((val)=>val[1])),
                this.generateRenderSource(ShaderType.Fragment, fragScope, fragBuiltinScope, fragInputs.map((val)=>val[1]), fragOutputs.map((val)=>val[1])),
                this.createBindGroupLayouts(options.label),
                this._vertexAttributes
            ];
        } catch (err) {
            if (err instanceof PBError) {
                this._lastError = err.getMessage(this._device.type);
                console.error(this._lastError);
                return null;
            } else if (err instanceof Error) {
                this._lastError = err.toString();
                console.error(this._lastError);
                return null;
            } else {
                this._lastError = Object.prototype.toString.call(err);
                console.error(`Error: ${this._lastError}`);
                return null;
            }
        }
    }
    /** @internal */ generate(body) {
        this.pushScope(this._globalScope);
        if (this._emulateDepthClamp && this._shaderType === ShaderType.Vertex) {
            this._globalScope.$outputs.clamppedDepth = this.float().tag('CLAMPPED_DEPTH');
        }
        body?.call(this._globalScope, this);
        this.popScope();
        // Global delcarations should be at the first
        this._globalScope.$ast.statements = [
            ...this._globalScope.$ast.statements.filter((val)=>val instanceof ASTDeclareVar || val instanceof ASTAssignment),
            ...this._globalScope.$ast.statements.filter((val)=>!(val instanceof ASTDeclareVar) && !(val instanceof ASTAssignment))
        ];
    }
    /** @internal */ generateRenderSource(shaderType, scope, builtinScope, inputs, outputs) {
        const context = {
            type: shaderType,
            mrt: shaderType === ShaderType.Fragment && outputs.length > 1,
            defines: [],
            extensions: new Set(),
            builtins: [
                ...builtinScope.$_usedBuiltins
            ],
            types: this._structInfo[shaderType]?.types || [],
            typeReplacement: new Map(),
            inputs: inputs,
            outputs: outputs,
            global: scope,
            vertexAttributes: this._vertexAttributes,
            workgroupSize: null
        };
        switch(this._device.type){
            case 'webgl':
                for (const u of this._uniforms){
                    if (u.texture) {
                        const type = u.texture.exp.$ast.getType();
                        if (type.isTextureType() && type.isDepthTexture()) {
                            if (u.texture.autoBindSampler === 'comparison') {
                                throw new PBDeviceNotSupport('depth texture comparison');
                            }
                            if (u.texture.autoBindSampler === 'sample') {
                                if (type.is2DTexture()) {
                                    context.typeReplacement.set(u.texture.exp, typeTex2D);
                                } else if (type.isCubeTexture()) {
                                    context.typeReplacement.set(u.texture.exp, typeTexCube);
                                }
                            }
                        }
                    }
                }
                return scope.$ast.toWebGL('', context);
            case 'webgl2':
                for (const u of this._uniforms){
                    if (u.texture) {
                        const type = u.texture.exp.$ast.getType();
                        if (type.isTextureType() && type.isDepthTexture() && u.texture.autoBindSampler === 'sample') {
                            if (type.is2DTexture()) {
                                context.typeReplacement.set(u.texture.exp, type.isArrayTexture() ? typeTex2DArray : typeTex2D);
                            } else if (type.isCubeTexture()) {
                                context.typeReplacement.set(u.texture.exp, typeTexCube);
                            }
                        }
                    }
                }
                return scope.$ast.toWebGL2('', context);
            case 'webgpu':
                return scope.$ast.toWGSL('', context);
            default:
                return null;
        }
    }
    /** @internal */ generateComputeSource(scope, builtinScope) {
        const context = {
            type: ShaderType.Compute,
            mrt: false,
            defines: [],
            extensions: new Set(),
            builtins: [
                ...builtinScope.$_usedBuiltins
            ],
            types: this._structInfo[ShaderType.Compute]?.types || [],
            typeReplacement: null,
            inputs: [],
            outputs: [],
            global: scope,
            vertexAttributes: [],
            workgroupSize: this._workgroupSize
        };
        return scope.$ast.toWGSL('', context);
    }
    /** @internal */ mergeUniformsCompute(globalScope) {
        const uniformList = [];
        for(let i = 0; i < this._uniforms.length; i++){
            const u = this._uniforms[i];
            if (u.block && (u.block.exp.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || u.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
                if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
                    continue;
                }
                if (!uniformList[u.group]) {
                    uniformList[u.group] = [];
                }
                const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                exp.$declareType = u.block.exp.$declareType;
                exp.$isBuffer = u.block.exp.$isBuffer;
                exp.$bindingSize = u.block.exp.$bindingSize;
                exp.$readonly = u.block.exp.$readonly;
                uniformList[u.group].push({
                    member: exp,
                    uniform: i
                });
            }
        }
        for(const k in uniformList){
            if (uniformList[k].length > 0) {
                const types = [
                    'std140',
                    'std430'
                ];
                const nameList = [
                    COMPUTE_UNIFORM_NAME,
                    COMPUTE_STORAGE_NAME
                ];
                const ulist = [
                    uniformList[k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_UNIFORM),
                    uniformList[k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_STORAGE)
                ];
                for(let i = 0; i < 2; i++){
                    if (ulist[i].length === 0) {
                        continue;
                    }
                    const nonBufferList = ulist[i].filter((val)=>!val.member.$isBuffer);
                    const bufferList = ulist[i].filter((val)=>val.member.$isBuffer);
                    const allLists = [
                        nonBufferList,
                        ...bufferList.map((val)=>[
                                val
                            ])
                    ];
                    for(let p = 0; p < allLists.length; p++){
                        if (allLists[p].length === 0) {
                            continue;
                        }
                        const uname = `${nameList[i]}_${k}_${p}`;
                        const structName = this.generateStructureName();
                        const t = getCurrentProgramBuilder().internalDefineStruct(structName, types[i], ShaderType.Compute, false, ...allLists[p].map((val)=>val.member));
                        const readonly = i > 0 ? allLists[p].findIndex((val)=>!val.member.$readonly) < 0 : true;
                        const exp = t();
                        if (i === 0) {
                            exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                        } else {
                            exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                            exp.$readonly = readonly;
                        }
                        globalScope[uname] = exp;
                        const index = this._uniforms.findIndex((val)=>val.block?.name === uname);
                        this._uniforms[index].mask = ShaderType.Compute;
                        let nameMap = this._nameMap[Number(k)];
                        if (!nameMap) {
                            nameMap = {};
                            this._nameMap[Number(k)] = nameMap;
                        }
                        let writable = false;
                        for(let n = allLists[p].length - 1; n >= 0; n--){
                            const u = allLists[p][n];
                            const exp = this._uniforms[u.uniform].block.exp;
                            nameMap[exp.$str] = uname;
                            exp.$str = `${uname}.${exp.$str}`;
                            writable ||= exp.$ast.isWritable();
                        }
                        if (writable) {
                            globalScope[uname].$ast.markWritable();
                        }
                    }
                }
            }
        }
        this._uniforms = this._uniforms.filter((val)=>{
            return !val.block || val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer;
        //return !val.block || val.block.exp.$isBuffer;
        /*
      if (!val.block || (val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_UNIFORM && val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_STORAGE)) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */ });
    }
    /** @internal */ mergeUniforms(globalScopeVertex, globalScopeFragmet) {
        const vertexUniformList = [];
        const fragUniformList = [];
        const sharedUniformList = [];
        //const vertexUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        //const fragUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        //const sharedUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        for(let i = 0; i < this._uniforms.length; i++){
            const u = this._uniforms[i];
            if (u.block && (u.block.exp.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || u.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
                if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
                    continue;
                }
                const v = !!(u.mask & ShaderType.Vertex);
                const f = !!(u.mask & ShaderType.Fragment);
                if (v && f) {
                    if (!sharedUniformList[u.group]) {
                        sharedUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    sharedUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    });
                //sharedUniformList[u.group].uniforms.push(i);
                } else if (v) {
                    if (!vertexUniformList[u.group]) {
                        vertexUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    vertexUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    });
                //vertexUniformList[u.group].uniforms.push(i);
                } else if (f) {
                    if (!fragUniformList[u.group]) {
                        fragUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    fragUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    }); //members.push(exp);
                //fragUniformList[u.group].uniforms.push(i);
                }
            }
        }
        const uniformLists = [
            vertexUniformList,
            fragUniformList,
            sharedUniformList
        ];
        const nameListUniform = [
            VERTEX_UNIFORM_NAME,
            FRAGMENT_UNIFORM_NAME,
            SHARED_UNIFORM_NAME
        ];
        const nameListStorage = [
            VERTEX_STORAGE_NAME,
            FRAGMENT_STORAGE_NAME,
            SHARED_STORAGE_NAME
        ];
        const maskList = [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Vertex | ShaderType.Fragment
        ];
        for(let i = 0; i < 3; i++){
            for(const k in uniformLists[i]){
                if (uniformLists[i][k]?.length > 0) {
                    const ulist = [
                        uniformLists[i][k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_UNIFORM),
                        uniformLists[i][k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_STORAGE)
                    ];
                    const nameList = [
                        nameListUniform,
                        nameListStorage
                    ];
                    const layoutList = [
                        'std140',
                        'std430'
                    ];
                    for(let j = 0; j < 2; j++){
                        if (ulist[j].length === 0) {
                            continue;
                        }
                        const nonBufferList = ulist[j].filter((val)=>!val.member.$isBuffer);
                        const bufferList = ulist[j].filter((val)=>val.member.$isBuffer);
                        const allLists = [
                            nonBufferList,
                            ...bufferList.map((val)=>[
                                    val
                                ])
                        ];
                        for(let p = 0; p < allLists.length; p++){
                            if (allLists[p].length === 0) {
                                continue;
                            }
                            const uname = `${nameList[j][i]}_${k}_${p}`;
                            const structName = this.generateStructureName();
                            const t = getCurrentProgramBuilder().internalDefineStruct(structName, layoutList[j], maskList[i], false, ...allLists[p].map((val)=>val.member));
                            const readonly = j > 0 ? allLists[p].findIndex((val)=>!val.member.$readonly) < 0 : true;
                            if (maskList[i] & ShaderType.Vertex) {
                                const exp = t();
                                if (j > 0 && !readonly) {
                                    throw new Error(`Storage buffer in vertex shader must be read-only`);
                                }
                                if (j === 0) {
                                    exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                } else {
                                    exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                    exp.$readonly = readonly;
                                }
                                globalScopeVertex[uname] = exp;
                            }
                            if (maskList[i] & ShaderType.Fragment) {
                                const exp = t();
                                if (j === 0) {
                                    exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                } else {
                                    exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                    exp.$readonly = readonly;
                                }
                                globalScopeFragmet[uname] = exp;
                            }
                            const index = this._uniforms.findIndex((val)=>val.block?.name === uname);
                            this._uniforms[index].mask = maskList[i];
                            let nameMap = this._nameMap[Number(k)];
                            if (!nameMap) {
                                nameMap = {};
                                this._nameMap[Number(k)] = nameMap;
                            }
                            let writable = false;
                            for(let n = allLists[p].length - 1; n >= 0; n--){
                                const u = allLists[p][n];
                                const exp = this._uniforms[u.uniform].block.exp;
                                nameMap[exp.$str] = uname;
                                exp.$str = `${uname}.${exp.$str}`;
                                writable ||= exp.$ast.isWritable();
                            }
                            if (writable) {
                                if (maskList[i] & ShaderType.Vertex) {
                                    globalScopeVertex[uname].$ast.markWritable();
                                } else {
                                    globalScopeFragmet[uname].$ast.markWritable();
                                }
                            }
                        }
                    }
                }
            }
        }
        this._uniforms = this._uniforms.filter((val)=>{
            return !val.block || val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer;
        /*
      if (!val.block) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */ });
    }
    /** @internal */ updateUniformBindings(scopes, shaderTypes) {
        this._uniforms = this._uniforms.filter((val)=>!!val.mask);
        const bindings = Array.from({
            length: MAX_BINDING_GROUPS
        }).fill(0);
        for (const u of this._uniforms){
            u.binding = bindings[u.group]++;
        }
        for(let i = 0; i < scopes.length; i++){
            const scope = scopes[i];
            const type = shaderTypes[i];
            for (const u of this._uniforms){
                if (u.mask & type) {
                    const uniforms = scope.$ast.uniforms;
                    const name = u.block ? u.block.name : u.texture ? u.texture.exp.$str : u.sampler.$str;
                    const index = uniforms.findIndex((val)=>val.value.name === name);
                    if (index < 0) {
                        throw new Error(`updateUniformBindings() failed: unable to find uniform ${name}`);
                    }
                    uniforms[index].binding = u.binding;
                }
            }
        }
    }
    /** @internal */ createBindGroupLayouts(label) {
        const layouts = [];
        const dynamicOffsetIndex = [
            0,
            0,
            0,
            0
        ];
        for (const uniformInfo of this._uniforms){
            let layout = layouts[uniformInfo.group];
            if (!layout) {
                layout = {
                    label: `${label || 'unknown'}[${uniformInfo.group}]`,
                    entries: []
                };
                if (this._nameMap[uniformInfo.group]) {
                    layout.nameMap = this._nameMap[uniformInfo.group];
                }
                layouts[uniformInfo.group] = layout;
            }
            const entry = {
                binding: uniformInfo.binding,
                visibility: uniformInfo.mask,
                name: ''
            };
            if (uniformInfo.block) {
                entry.type = uniformInfo.block.exp.$typeinfo.clone(this.getBlockName(uniformInfo.block.name));
                const isStorage = uniformInfo.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE;
                entry.buffer = {
                    type: isStorage ? uniformInfo.block.exp.$readonly ? 'read-only-storage' : 'storage' : 'uniform',
                    minBindingSize: uniformInfo.block.bindingSize,
                    hasDynamicOffset: !!uniformInfo.block.bindingSize,
                    uniformLayout: entry.type.toBufferLayout(0, entry.type.layout),
                    dynamicOffsetIndex: uniformInfo.block.bindingSize ? dynamicOffsetIndex[uniformInfo.group]++ : -1
                };
                entry.name = uniformInfo.block.name;
            } else if (uniformInfo.texture) {
                entry.type = uniformInfo.texture.exp.$typeinfo;
                if (!entry.type.isTextureType()) {
                    throw new Error('internal error');
                }
                if (entry.type.isStorageTexture()) {
                    let viewDimension;
                    if (entry.type.isArrayTexture()) {
                        viewDimension = entry.type.isCubeTexture() ? 'cube-array' : '2d-array';
                    } else if (entry.type.is3DTexture()) {
                        viewDimension = '3d';
                    } else if (entry.type.isCubeTexture()) {
                        viewDimension = 'cube';
                    } else if (entry.type.is1DTexture()) {
                        viewDimension = '1d';
                    } else {
                        viewDimension = '2d';
                    }
                    entry.storageTexture = {
                        access: 'write-only',
                        viewDimension: viewDimension,
                        format: entry.type.storageTexelFormat
                    };
                } else if (entry.type.isExternalTexture()) {
                    entry.externalTexture = {
                        autoBindSampler: uniformInfo.texture.autoBindSampler ? genSamplerName(uniformInfo.texture.exp.$str, false) : null
                    };
                } else {
                    const sampleType = this._device.type === 'webgpu' ? uniformInfo.texture.exp.$sampleType : uniformInfo.texture.autoBindSampler && entry.type.isDepthTexture() ? 'float' : uniformInfo.texture.exp.$sampleType;
                    let viewDimension;
                    if (entry.type.isArrayTexture()) {
                        viewDimension = entry.type.isCubeTexture() ? 'cube-array' : '2d-array';
                    } else if (entry.type.is3DTexture()) {
                        viewDimension = '3d';
                    } else if (entry.type.isCubeTexture()) {
                        viewDimension = 'cube';
                    } else if (entry.type.is1DTexture()) {
                        viewDimension = '1d';
                    } else {
                        viewDimension = '2d';
                    }
                    entry.texture = {
                        sampleType: sampleType,
                        viewDimension: viewDimension,
                        multisampled: false,
                        autoBindSampler: null,
                        autoBindSamplerComparison: null
                    };
                    if (this._device.type === 'webgpu' || uniformInfo.texture.autoBindSampler === 'sample') {
                        entry.texture.autoBindSampler = genSamplerName(uniformInfo.texture.exp.$str, false);
                    }
                    if (this._device.type === 'webgpu' && entry.type.isDepthTexture() || uniformInfo.texture.autoBindSampler === 'comparison') {
                        entry.texture.autoBindSamplerComparison = genSamplerName(uniformInfo.texture.exp.$str, true);
                    }
                }
                entry.name = uniformInfo.texture.exp.$str;
            } else if (uniformInfo.sampler) {
                entry.type = uniformInfo.sampler.$typeinfo;
                if (!entry.type.isSamplerType()) {
                    throw new Error('internal error');
                }
                entry.sampler = {
                    type: entry.type.accessMode === PBSamplerAccessMode.SAMPLE ? uniformInfo.sampler.$sampleType === 'float' ? 'filtering' : 'non-filtering' : 'comparison'
                };
                entry.name = uniformInfo.sampler.$str;
            } else {
                throw new PBInternalError('invalid uniform entry type');
            }
            layout.entries.push(entry);
        }
        for(let i = 0; i < layouts.length; i++){
            if (!layouts[i]) {
                layouts[i] = {
                    label: `${label || 'unknown'}[${i}]`,
                    entries: []
                };
            }
        }
        return layouts;
    }
    /** @internal */ _getFunctionOverload(funcName, args) {
        const thisArgs = args.filter((val)=>{
            if (val instanceof PBShaderExp) {
                const type = val.$ast.getType();
                if (type.isStructType() && this._structInfo[this._shaderType]?.types.findIndex((t)=>t.type.structName === type.structName) < 0) {
                    return false;
                }
            }
            return true;
        });
        const fn = this.getGlobalScope().$getFunctions(funcName);
        return fn ? this._matchFunctionOverloading(fn, thisArgs) : null;
    }
    /** @internal */ _matchFunctionOverloading(overloadings, args) {
        for (const overload of overloadings){
            if (args.length !== overload.funcType.argTypes.length) {
                continue;
            }
            const result = [];
            let matches = true;
            for(let i = 0; i < args.length; i++){
                const argInfo = overload.funcType.argTypes[i];
                const argType = argInfo.byRef && argInfo.type instanceof PBPointerTypeInfo ? argInfo.type.pointerType : argInfo.type;
                const arg = args[i];
                if (typeof arg === 'boolean') {
                    if (!argType.isPrimitiveType() || argType.primitiveType !== PBPrimitiveType.BOOL) {
                        matches = false;
                        break;
                    }
                    result.push(new ASTScalar(arg, typeBool));
                } else if (typeof arg === 'number') {
                    if (!argType.isPrimitiveType() || !argType.isScalarType() || argType.scalarType === PBPrimitiveType.BOOL) {
                        matches = false;
                        break;
                    }
                    if (argType.scalarType === PBPrimitiveType.I32) {
                        if (!Number.isInteger(arg) || arg < 0x80000000 >> 0 || arg > 0x7fffffff) {
                            matches = false;
                            break;
                        }
                        result.push(new ASTScalar(arg, typeI32));
                    } else if (argType.scalarType === PBPrimitiveType.U32) {
                        if (!Number.isInteger(arg) || arg < 0 || arg > 0xffffffff) {
                            matches = false;
                            break;
                        }
                        result.push(new ASTScalar(arg, typeU32));
                    } else {
                        result.push(new ASTScalar(arg, argType));
                    }
                } else {
                    if (!argType.isCompatibleType(arg.$ast.getType())) {
                        matches = false;
                        break;
                    }
                    result.push(arg.$ast);
                }
            }
            if (matches) {
                return [
                    overload,
                    result
                ];
            }
        }
        return null;
    }
    /** @internal */ $callFunction(funcName, args, func) {
        if (this.getCurrentScope() === this.getGlobalScope()) {
            throw new PBNonScopedFunctionCall(funcName);
        }
        const exp = new PBShaderExp('', func.returnType);
        exp.$ast = new ASTCallFunction(funcName, args, func, getCurrentProgramBuilder().getDevice().type);
        this.getCurrentScope().$ast.statements.push(exp.$ast);
        return exp;
    }
    /** @internal */ $callFunctionNoCheck(funcName, args, retType) {
        if (this.getCurrentScope() === this.getGlobalScope()) {
            throw new PBNonScopedFunctionCall(funcName);
        }
        const exp = new PBShaderExp('', retType);
        exp.$ast = new ASTCallFunction(funcName, args, null, getCurrentProgramBuilder().getDevice().type, retType);
        this.getCurrentScope().$ast.statements.push(exp.$ast);
        return exp;
    }
}
/**
 * Base class for scope of the shader program
 * @public
 */ class PBScope extends Proxiable {
    /** @internal */ $_variables;
    /** @internal */ $_parentScope;
    /** @internal */ $_AST;
    /** @internal */ $_localScope;
    /** @internal */ constructor(astScope, parent){
        super();
        this.$_parentScope = parent || null;
        this.$_variables = {};
        this.$_AST = astScope;
        this.$_localScope = null;
    }
    /** Get the program builder */ get $builder() {
        return getCurrentProgramBuilder();
    }
    /** Returns the scope of the builtin variables */ get $builtins() {
        return getCurrentProgramBuilder().builtinScope;
    }
    /** Returns the scope of the input variables */ get $inputs() {
        return getCurrentProgramBuilder().inputScope;
    }
    /** Returns the scope of the output variables */ get $outputs() {
        return getCurrentProgramBuilder().outputScope;
    }
    /** @internal */ get $parent() {
        return this.$_parentScope;
    }
    /** @internal */ get $ast() {
        return this.$_AST;
    }
    /** @internal */ set $ast(ast) {
        this.$_AST = ast;
    }
    /**
   * Get the input vertex attribute by specified semantic
   *
   * @remarks
   * Can only be called only in vertex shader
   *
   * @param semantic - The vertex semantic
   * @returns The input vertex attribute or null if not exists
   */ $getVertexAttrib(semantic) {
        return this.$inputs.$getVertexAttrib(semantic); // getCurrentProgramBuilder().getReflection().attribute(semantic);
    }
    /** Get the current local scope */ get $l() {
        return this.$_getLocalScope();
    }
    /** Get the global scope */ get $g() {
        return this.$_getGlobalScope();
    }
    /** @internal */ $local(variable, init) {
        const initNonArray = getCurrentProgramBuilder().normalizeExpValue(init);
        variable.$global = this instanceof PBGlobalScope;
        this.$_declare(variable, initNonArray);
    }
    /** @internal */ $touch(exp) {
        this.$ast.statements.push(new ASTTouch(exp.$ast));
    }
    /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */ $query(name) {
        return this.$builder.getReflection().tag(name);
    }
    /** @internal */ $_declareInternal(variable, init) {
        const key = variable.$str;
        if (this.$_variables[key]) {
            throw new Error(`cannot re-declare variable '${key}'`);
        }
        if (!(variable.$ast instanceof ASTPrimitive)) {
            throw new Error(`invalid variable declaration: '${variable.$ast.toString(getCurrentProgramBuilder().getDevice().type)}'`);
        }
        const varType = variable.$typeinfo;
        if (varType.isPointerType()) {
            if (!init) {
                throw new Error(`cannot declare pointer type variable without initialization: '${variable.$str}'`);
            }
            if (!(init instanceof PBShaderExp)) {
                throw new Error(`invalid initialization for pointer type declaration: '${variable.$str}`);
            }
            const initType = init.$ast.getType();
            if (!initType.isPointerType() || !varType.pointerType.isCompatibleType(initType.pointerType)) {
                throw new Error(`incompatible pointer type assignment: '${variable.$str}'`);
            }
            variable.$typeinfo = initType;
        }
        this.$_registerVar(variable, key);
        if (init === undefined || init === null) {
            return new ASTDeclareVar(variable.$ast);
        } else {
            if (init instanceof PBShaderExp && init.$ast instanceof ASTShaderExpConstructor && init.$ast.args.length === 0) {
                if (!init.$ast.getType().isCompatibleType(variable.$ast.getType())) {
                    throw new PBTypeCastError(init, init.$ast.getType(), variable.$ast.getType());
                }
                return new ASTDeclareVar(variable.$ast);
            } else {
                return new ASTAssignment(new ASTLValueDeclare(variable.$ast), init instanceof PBShaderExp ? init.$ast : init);
            }
        }
    }
    /** @internal */ $_findOrSetUniform(variable) {
        const name = variable.$str;
        const uniformInfo = {
            group: variable.$group,
            binding: 0,
            mask: 0
        };
        if (variable.$typeinfo.isTextureType()) {
            uniformInfo.texture = {
                autoBindSampler: null,
                exp: variable
            };
        } else if (variable.$typeinfo.isSamplerType()) {
            uniformInfo.sampler = variable;
        } else {
            uniformInfo.block = {
                name: name,
                bindingSize: variable.$bindingSize,
                exp: variable
            };
        // throw new Error(`unsupported uniform type: ${name}`);
        }
        let found = false;
        for (const u of getCurrentProgramBuilder()._uniforms){
            if (u.group !== uniformInfo.group) {
                continue;
            }
            if (uniformInfo.block && u.block && u.block.name === uniformInfo.block.name && u.block.exp.$typeinfo.isCompatibleType(uniformInfo.block.exp.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.block.exp;
                // u.block.exp = variable;
                found = true;
                break;
            }
            if (uniformInfo.texture && u.texture && uniformInfo.texture.exp.$str === u.texture.exp.$str && uniformInfo.texture.exp.$typeinfo.isCompatibleType(u.texture.exp.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.texture.exp;
                // u.texture.exp = variable;
                found = true;
                break;
            }
            if (uniformInfo.sampler && u.sampler && uniformInfo.sampler.$str === u.sampler.$str && uniformInfo.sampler.$typeinfo.isCompatibleType(u.sampler.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.sampler;
                // u.sampler = variable;
                found = true;
                break;
            }
        }
        if (!found) {
            uniformInfo.mask = getCurrentProgramBuilder().shaderType;
            getCurrentProgramBuilder()._uniforms.push(uniformInfo);
        }
        if (uniformInfo.texture && !uniformInfo.texture.exp.$typeinfo.isStorageTexture() && getCurrentProgramBuilder().getDevice().type === 'webgpu') {
            // webgpu requires explicit sampler bindings
            const isDepth = variable.$typeinfo.isTextureType() && variable.$typeinfo.isDepthTexture();
            const samplerName = genSamplerName(variable.$str, false);
            const samplerExp = getCurrentProgramBuilder().sampler(samplerName).uniform(uniformInfo.group).sampleType(variable.$sampleType);
            samplerExp.$sampleType = variable.$sampleType;
            this.$local(samplerExp);
            if (isDepth) {
                const samplerNameComp = genSamplerName(variable.$str, true);
                const samplerExpComp = getCurrentProgramBuilder().samplerComparison(samplerNameComp).uniform(uniformInfo.group).sampleType(variable.$sampleType);
                this.$local(samplerExpComp);
            }
        }
        return variable;
    }
    /** @internal */ $_declare(variable, init) {
        if (this.$_variables[variable.$str]) {
            throw new PBASTError(variable.$ast, 'cannot re-declare variable');
        }
        if (variable.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || variable.$declareType === DeclareType.DECLARE_TYPE_STORAGE) {
            const name = variable.$ast.name;
            if (!(this instanceof PBGlobalScope)) {
                throw new Error(`uniform or storage variables can only be declared within global scope: ${name}`);
            }
            if (variable.$declareType === DeclareType.DECLARE_TYPE_UNIFORM && !variable.$typeinfo.isTextureType() && !variable.$typeinfo.isSamplerType() && (!variable.$typeinfo.isConstructible() || !variable.$typeinfo.isHostSharable())) {
                throw new PBASTError(variable.$ast, `type '${variable.$typeinfo.toTypeName(getCurrentProgramBuilder().getDevice().type)}' cannot be declared in uniform address space`);
            }
            if (variable.$declareType === DeclareType.DECLARE_TYPE_STORAGE) {
                if (getCurrentProgramBuilder().getDevice().type !== 'webgpu') {
                    throw new PBDeviceNotSupport('storage buffer binding');
                } else if (!variable.$typeinfo.isHostSharable()) {
                    throw new PBASTError(variable.$ast, `type '${variable.$typeinfo.toTypeName(getCurrentProgramBuilder().getDevice().type)}' cannot be declared in storage address space`);
                }
            }
            variable = this.$_findOrSetUniform(variable);
            const ast = this.$_declareInternal(variable);
            ast.group = variable.$group;
            ast.binding = 0;
            ast.blockName = getCurrentProgramBuilder().getBlockName(name);
            const type = variable.$typeinfo;
            if (type.isStructType() && variable.$isBuffer || type.isTextureType() || type.isSamplerType() || type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430')) {
                this.$ast.uniforms.push(ast);
            }
            variable.$tags.forEach((val)=>{
                getCurrentProgramBuilder().tagShaderExp(()=>variable, val);
            });
        } else {
            const ast = this.$_declareInternal(variable, init);
            this.$ast.statements.push(ast);
        }
    }
    /** @internal */ $_registerVar(variable, name) {
        const key = name || variable.$str;
        const options = {
            configurable: true,
            get: function() {
                return variable;
            },
            set: function(val) {
                getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(variable.$ast), val instanceof PBShaderExp ? val.$ast : val));
            }
        };
        Object.defineProperty(this, key, options);
        this.$_variables[key] = variable;
    }
    /** @internal */ $localGet(prop) {
        if (typeof prop === 'string' && (prop[0] === '$' || prop in this)) {
            return this[prop];
        }
        return undefined;
    }
    /** @internal */ $localSet(prop, value) {
        if (prop[0] === '$' || prop in this) {
            this[prop] = value;
            return true;
        }
        return false;
    }
    /** @internal */ $get(prop) {
        const ret = this.$localGet(prop);
        return ret === undefined && this.$_parentScope ? this.$_parentScope.$thisProxy.$get(prop) : ret;
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
            return true;
        } else {
            let scope = this;
            while(scope && !(prop in scope)){
                scope = scope.$_parentScope;
            }
            if (scope) {
                scope[prop] = value;
                return true;
            } else {
                if (this.$l) {
                    this.$l[prop] = value;
                    return true;
                }
            }
        }
        return false;
    }
    /** @internal */ $_getLocalScope() {
        if (!this.$_localScope) {
            this.$_localScope = new PBLocalScope(this);
        }
        return this.$_localScope;
    }
    /** @internal */ $_getGlobalScope() {
        return this.$builder.getGlobalScope();
    }
}
/**
 * The local scope of a shader
 * @public
 */ class PBLocalScope extends PBScope {
    /** @internal */ $_scope;
    constructor(scope){
        super(null, null);
        this.$_scope = scope;
    }
    /** @internal */ $get(prop) {
        return prop[0] === '$' ? this[prop] : this.$_scope.$localGet(prop);
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
            return true;
        }
        if (!(this.$_scope instanceof PBGlobalScope) && value instanceof PBShaderExp && (value.isConstructor() || value.$typeinfo.isTextureType() && value.$ast instanceof ASTPrimitive && !value.$ast.name) && (value.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || value.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
            // We are setting uniform a uniform, should invoke in the global scope
            this.$g[prop] = value;
            return true;
        }
        const val = this.$_scope.$localGet(prop);
        if (val === undefined) {
            const type = getCurrentProgramBuilder().guessExpValueType(value);
            if (type.isCompatibleType(typeVoid)) {
                throw new Error(`Cannot assign void type to '${prop}'`);
            }
            const exp = new PBShaderExp(prop, type);
            if (value instanceof PBShaderExp && !this.$_scope.$parent) {
                exp.$declareType = value.$declareType;
                exp.$isBuffer = value.$isBuffer;
                exp.$bindingSize = value.$bindingSize;
                exp.$readonly = value.$readonly;
                exp.$group = value.$group;
                exp.$attrib = value.$attrib;
                exp.$sampleType = value.$sampleType;
                exp.$precision = value.$precision;
                exp.tag(...value.$tags);
            }
            this.$_scope.$local(exp, value);
            return true;
        } else {
            return this.$_scope.$localSet(prop, value);
        }
    }
    /** @internal */ $_getLocalScope() {
        return this;
    }
}
/**
 * The builtin scope of a shader
 * @public
 */ class PBBuiltinScope extends PBScope {
    /** @internal */ $_usedBuiltins;
    /** @internal */ $_builtinVars;
    constructor(){
        super(null);
        this.$_usedBuiltins = new Set();
        const isWebGPU = getCurrentProgramBuilder().getDevice().type === 'webgpu';
        if (!isWebGPU) {
            this.$_builtinVars = {};
            const v = builtinVariables[getCurrentProgramBuilder().getDevice().type];
            for(const k in v){
                const info = v[k];
                this.$_builtinVars[k] = new PBShaderExp(info.name, info.type);
            }
        }
        const v = builtinVariables[getCurrentProgramBuilder().getDevice().type];
        const that = this;
        for (const k of Object.keys(v)){
            Object.defineProperty(this, k, {
                get: function() {
                    return that.$getBuiltinVar(k);
                },
                set: function(v) {
                    if (typeof v !== 'number' && !(v instanceof PBShaderExp)) {
                        throw new Error(`Invalid output value assignment`);
                    }
                    const exp = that.$getBuiltinVar(k);
                    getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(exp.$ast), v instanceof PBShaderExp ? v.$ast : v));
                }
            });
        }
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $getBuiltinVar(name) {
        const pb = getCurrentProgramBuilder();
        this.$_usedBuiltins.add(name);
        const isWebGPU = pb.getDevice().type === 'webgpu';
        if (isWebGPU) {
            const v = builtinVariables[pb.getDevice().type];
            const info = v[name];
            const inout = 'inOrOut' in info ? info.inOrOut : undefined;
            if (inout === 'in') {
                return pb.getCurrentFunctionScope()[getBuiltinParamName(pb.shaderType)][info.name];
            }
            const structName = getBuiltinOutputStructInstanceName(pb.shaderType);
            const scope = pb.getCurrentScope();
            if (!scope[structName] || !scope[structName][info.name]) {
                throw new Error(`invalid use of builtin variable ${name}`);
            }
            return scope[structName][info.name];
        } else {
            if (pb.getDevice().type === 'webgl2' && (name === 'vertexIndex' || name === 'instanceIndex')) {
                return pb.uint(this.$_builtinVars[name]);
            } else {
                return this.$_builtinVars[name];
            }
        }
    }
}
/**
 * The input scope of a shader
 * @public
 */ class PBInputScope extends PBScope {
    /** @internal */ $_names;
    $_aliases;
    /** @internal */ constructor(){
        super(null);
        this.$_names = {};
        this.$_aliases = {};
    }
    /** @internal */ $getVertexAttrib(attrib) {
        const name = this.$_names[attrib];
        return name ? this[name] : null;
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $get(prop) {
        if (prop[0] === '$') {
            return this[prop];
        }
        if (this.$_aliases[prop]) {
            prop = this.$_aliases[prop];
        }
        const pb = this.$builder;
        if (pb.getDevice().type === 'webgpu') {
            const param = pb.getCurrentFunctionScope()[getBuiltinParamName(pb.shaderType)];
            const prefix = pb.shaderKind === 'vertex' ? input_prefix : output_prefix_vs;
            const name = `${prefix}${prop}`;
            if (param.$typeinfo.structMembers.findIndex((val)=>val.name === name) < 0) {
                return undefined;
            }
            return param[`${prefix}${prop}`];
        }
        return super.$get(prop);
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
        } else {
            if (!(value instanceof PBShaderExp)) {
                throw new Error(`invalid vertex input value`);
            }
            const st = getCurrentProgramBuilder().shaderType;
            if (st !== ShaderType.Vertex) {
                throw new Error(`shader input variables can only be declared in vertex shader: "${prop}"`);
            }
            const attrib = getVertexAttribByName(value.$attrib);
            if (attrib === undefined) {
                throw new Error(`can not declare shader input variable: invalid vertex attribute: "${prop}"`);
            }
            if (getCurrentProgramBuilder()._vertexAttributes.indexOf(attrib) >= 0) {
                const lastName = this.$_names[value.$attrib];
                if (prop !== lastName) {
                    const p = this[lastName];
                    if (p.$typeinfo.typeId !== value.$typeinfo.typeId) {
                        throw new Error(`can not declare shader input variable: attribute already declared with different type: "${prop}"`);
                    }
                    this.$_aliases[prop] = lastName;
                }
                return true;
            }
            if (!(value instanceof PBShaderExp) || !(value.$ast instanceof ASTShaderExpConstructor)) {
                throw new Error(`invalid shader input variable declaration: "${prop}"`);
            }
            const type = value.$ast.getType();
            if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
                throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
            }
            this.$_names[value.$attrib] = prop;
            const location = getCurrentProgramBuilder()._inputs.length;
            const exp = new PBShaderExp(`${input_prefix}${prop}`, type).tag(...value.$tags);
            getCurrentProgramBuilder().in(location, prop, exp);
            getCurrentProgramBuilder()._vertexAttributes.push(attrib);
            //getCurrentProgramBuilder().getReflection().setAttrib(value.$attrib, exp);
            // modify input struct for webgpu
            if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
                if (getCurrentProgramBuilder().findStructType(getBuiltinInputStructName(st), st)) {
                    getCurrentProgramBuilder().defineBuiltinStruct(st, 'in');
                }
            }
        }
        return true;
    }
}
/**
 * The output scope of a shader
 * @public
 */ class PBOutputScope extends PBScope {
    constructor(){
        super(null);
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$' /* || prop in this*/ ) {
            this[prop] = value;
        } else {
            const pb = getCurrentProgramBuilder();
            if (!(prop in this)) {
                if (pb.getCurrentScope() === pb.getGlobalScope() && (!(value instanceof PBShaderExp) || !(value.$ast instanceof ASTShaderExpConstructor))) {
                    throw new Error(`invalid shader output variable declaration: ${prop}`);
                }
                const type = value.$ast.getType();
                if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
                    throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
                }
                const location = pb._outputs.length;
                pb.out(location, prop, new PBShaderExp(`${pb.shaderKind === 'vertex' ? output_prefix_vs : output_prefix_fs}${prop}`, type).tag(...value.$tags));
                // modify output struct for webgpu
                if (pb.getDevice().type === 'webgpu') {
                    const st = pb.shaderType;
                    if (pb.findStructType(getBuiltinInputStructName(st), st)) {
                        pb.defineBuiltinStruct(st, 'out');
                    }
                }
            }
            if (pb.getCurrentScope() !== pb.getGlobalScope()) {
                const ast = value.$ast;
                if (!(ast instanceof ASTShaderExpConstructor) || ast.args.length > 0) {
                    this[prop] = value;
                }
            }
        }
        return true;
    }
}
/**
 * The global scope of a shader
 * @public
 */ class PBGlobalScope extends PBScope {
    /** @internal */ $_inputStructInfo;
    /** @internal */ constructor(){
        super(new ASTGlobalScope());
        this.$_inputStructInfo = null;
    }
    /** @internal */ get $inputStructInfo() {
        if (!this.$_inputStructInfo) {
            this.$_inputStructInfo = this.$builder.defineBuiltinStruct(this.$builder.shaderType, 'in');
        }
        return this.$_inputStructInfo;
    }
    /** @internal */ get $inputStruct() {
        return this.$inputStructInfo[0];
    }
    /** @internal */ $mainFunc(body) {
        const pb = getCurrentProgramBuilder();
        if (pb.getDevice().type === 'webgpu') {
            const inputStruct = this.$inputStructInfo;
            //this.$local(inputStruct[1]);
            const isCompute = pb.shaderType === ShaderType.Compute;
            const outputStruct = isCompute ? null : pb.defineBuiltinStruct(pb.shaderType, 'out');
            if (outputStruct) {
                this.$local(outputStruct[1]);
            }
            // this.$internalCreateFunction('chMainStub', [], false, body);
            this.$internalCreateFunction('main', inputStruct ? [
                inputStruct[3]
            ] : [], true, function() {
                /*
          if (inputStruct) {
            this[inputStruct[1].$str] = this[inputStruct[3].$str];
          }
          */ if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
                    this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
                }
                body?.call(this);
                //this.chMainStub();
                if (pb.shaderType === ShaderType.Vertex) {
                    if (pb.depthRangeCorrection) {
                        this.$builtins.position.z = pb.mul(pb.add(this.$builtins.position.z, this.$builtins.position.w), 0.5);
                    }
                    if (pb.emulateDepthClamp) {
                        //z = gl_Position.z / gl_Position.w;
                        //z = (gl_DepthRange.diff * z + gl_DepthRange.near + gl_DepthRange.far) * 0.5;
                        this.$outputs.clamppedDepth = pb.div(this.$builtins.position.z, this.$builtins.position.w);
                        this.$builtins.position.z = 0;
                    }
                }
                if (!isCompute) {
                    this.$return(outputStruct[1]);
                }
            });
        } else {
            this.$internalCreateFunction('main', [], true, function() {
                if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
                    this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
                }
                body?.call(this);
                if (pb.shaderType === ShaderType.Vertex && pb.emulateDepthClamp) {
                    this.$outputs.clamppedDepth = pb.div(pb.add(pb.div(this.$builtins.position.z, this.$builtins.position.w), 1), 2);
                    this.$builtins.position.z = 0;
                }
            });
        }
    }
    /** @internal */ $createFunctionIfNotExists(name, params, body) {
        this.$internalCreateFunction(name, params, false, body);
    }
    /** @internal */ $getFunctions(name) {
        return this.$ast.findFunctions(name);
    }
    /** @internal */ $getCurrentFunctionScope() {
        let scope = getCurrentProgramBuilder().getCurrentScope();
        while(scope && !(scope instanceof PBFunctionScope)){
            scope = scope.$parent;
        }
        return scope;
    }
    /** @internal */ $internalCreateFunction(name, params, isMain, body) {
        const pb = getCurrentProgramBuilder();
        if (pb.getDevice().type === 'webgpu' && !isMain) {
            params.push(this.$inputStruct(getBuiltinParamName(pb.shaderType)));
        }
        params.forEach((param)=>{
            if (!(param.$ast instanceof ASTPrimitive)) {
                throw new Error(`${name}(): invalid function definition`);
            }
            let ast = param.$ast;
            if (param.$inout) {
                if (pb.getDevice().type === 'webgpu') {
                    param.$typeinfo = new PBPointerTypeInfo(param.$typeinfo, PBAddressSpace.UNKNOWN);
                }
                ast = new ASTReferenceOf(param.$ast);
            }
            param.$ast = new ASTFunctionParameter(ast);
        });
        const overloads = this.$getFunctions(name);
        const currentFunctionScope = this.$getCurrentFunctionScope();
        const astFunc = new ASTFunction(name, params.map((val)=>val.$ast), isMain, null, false);
        if (currentFunctionScope) {
            const curIndex = this.$ast.statements.indexOf(currentFunctionScope.$ast);
            if (curIndex < 0) {
                throw new Error('Internal error');
            }
            this.$ast.statements.splice(curIndex, 0, astFunc);
        } else {
            this.$ast.statements.push(astFunc);
        }
        new PBFunctionScope(this, params, astFunc, body);
        if (!astFunc.returnType) {
            astFunc.returnType = typeVoid;
        }
        astFunc.funcType = new PBFunctionTypeInfo(astFunc.name, astFunc.returnType, params.map((param)=>{
            const ast = param.$ast;
            return ast.paramAST instanceof ASTReferenceOf ? {
                type: ast.paramAST.value.getType(),
                byRef: ast.paramAST instanceof ASTReferenceOf
            } : {
                type: ast.paramAST.getType(),
                byRef: false
            };
        }));
        for (const overload of overloads){
            if (overload.funcType.argHash === astFunc.funcType.argHash) {
                if (overload.returnType.isCompatibleType(astFunc.returnType)) {
                    // Function signature already exists
                    // console.warn(`Function '${name}' already exists`);
                    this.$ast.statements.splice(this.$ast.statements.indexOf(astFunc), 1);
                    return;
                } else {
                    throw new Error(`Invalid function overloading: ${name}`);
                }
            }
        }
        if (overloads.length === 0) {
            Object.defineProperty(this, name, {
                get: function() {
                    const func = this.$getFunctions(name);
                    if (func.length === 0) {
                        throw new Error(`function ${name} not found`);
                    }
                    return (...args)=>{
                        let inputArg = null;
                        if (pb.getDevice().type === 'webgpu') {
                            let funcScope = pb.getCurrentScope();
                            while(funcScope && !(funcScope instanceof PBFunctionScope)){
                                funcScope = funcScope.$parent;
                            }
                            const funcArgs = funcScope.$ast.args;
                            const arg = funcArgs[funcArgs.length - 1].paramAST;
                            const name = arg.name;
                            inputArg = funcScope[name];
                        }
                        const argsNonArray = (inputArg ? [
                            ...args,
                            inputArg
                        ] : args).map((val)=>pb.normalizeExpValue(val));
                        const funcType = pb._getFunctionOverload(name, argsNonArray);
                        if (!funcType) {
                            throw new Error(`ERROR: no matching overloads for function ${name}(${argsNonArray.map((val)=>{
                                if (val instanceof PBShaderExp) {
                                    return val.$ast?.getType()?.toTypeName() ?? '?';
                                } else {
                                    return typeof val;
                                }
                            }).join(', ')})`);
                        }
                        return getCurrentProgramBuilder().$callFunction(name, funcType[1], funcType[0]);
                    };
                }
            });
        }
    }
}
/**
 * Scope that is inside a function
 * @public
 */ class PBInsideFunctionScope extends PBScope {
    /** @internal */ constructor(parent){
        super(new ASTScope(), parent);
    }
    /**
   * Creates a 'return' statement
   * @param retval - The return value
   */ $return(retval) {
        const functionScope = this.findOwnerFunction();
        const astFunc = functionScope.$ast;
        let returnType = null;
        const retValNonArray = getCurrentProgramBuilder().normalizeExpValue(retval);
        if (retValNonArray !== undefined && retValNonArray !== null) {
            if (typeof retValNonArray === 'number') {
                if (astFunc.returnType) {
                    if (astFunc.returnType.isPrimitiveType() && astFunc.returnType.isScalarType() && !astFunc.returnType.isCompatibleType(typeBool)) {
                        returnType = astFunc.returnType;
                    }
                }
                if (!returnType) {
                    if (Number.isInteger(retValNonArray)) {
                        if (retValNonArray < 0) {
                            if (retValNonArray < 0x80000000 >> 0) {
                                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
                            }
                            returnType = typeI32;
                        } else {
                            if (retValNonArray > 0xffffffff) {
                                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
                            }
                            returnType = retValNonArray <= 0x7fffffff ? typeI32 : typeU32;
                        }
                    } else {
                        returnType = typeF32;
                    }
                }
            } else if (typeof retValNonArray === 'boolean') {
                returnType = typeBool;
            } else {
                returnType = retValNonArray.$ast.getType();
            }
        } else {
            returnType = typeVoid;
        }
        if (returnType.isPointerType()) {
            throw new Error('function can not return pointer type');
        }
        if (!astFunc.returnType) {
            astFunc.returnType = returnType;
        } else if (!astFunc.returnType.isCompatibleType(returnType)) {
            throw new Error(`function ${astFunc.name}: return type must be ${astFunc.returnType?.toTypeName(getCurrentProgramBuilder().getDevice().type) || 'void'}`);
        }
        let returnValue = null;
        if (retValNonArray !== undefined && retValNonArray !== null) {
            if (retValNonArray instanceof PBShaderExp) {
                returnValue = retValNonArray.$ast;
            } else {
                if (!returnType.isPrimitiveType() || !returnType.isScalarType()) {
                    throw new PBTypeCastError(retValNonArray, typeof retValNonArray, returnType);
                }
                returnValue = new ASTScalar(retValNonArray, returnType);
            }
        }
        this.$ast.statements.push(new ASTReturn(returnValue));
    }
    /**
   * Creates a new scope
   * @param body - Generator function for the scope
   * @returns The created scope
   */ $scope(body) {
        const astScope = new ASTNakedScope();
        this.$ast.statements.push(astScope);
        return new PBNakedScope(this, astScope, body);
    }
    /**
   * Creates an 'if' statement
   * @param condition - Condition expression for the if statement
   * @param body - Generator function for the scope inside the if statement
   * @returns The scope inside the if statement
   */ $if(condition, body) {
        const astIf = new ASTIf('if', condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.statements.push(astIf);
        return new PBIfScope(this, astIf, body);
    }
    /**
   * Creates a select statement: condition ? first : second
   * @param condition - Condition expression
   * @param first - The first value
   * @param second - The second value
   * @returns The first value if condition evaluates to true, otherwise returns the second value
   */ $choice(condition, first, second) {
        const ast = new ASTSelect(condition instanceof PBShaderExp ? condition.$ast : condition, first instanceof PBShaderExp ? first.$ast : first, second instanceof PBShaderExp ? second.$ast : second);
        const exp = new PBShaderExp('', ast.getType());
        exp.$ast = ast;
        return exp;
    }
    /** Creates a 'break' statement */ $break() {
        this.$ast.statements.push(new ASTBreak());
    }
    /** Creates a 'continue' statement */ $continue() {
        this.$ast.statements.push(new ASTContinue());
    }
    /**
   * Creates a 'for' statement
   * @param counter - The repeat counter variable declaration
   * @param init - initial value of the repeat counter variable
   * @param end - end value of the counter exclusive
   * @param body - Generator function for the scope that inside the for statement
   */ $for(counter, init, end, open, reverse, body) {
        const initializerType = counter.$ast.getType();
        if (!initializerType.isPrimitiveType() || !initializerType.isScalarType()) {
            throw new PBASTError(counter.$ast, 'invalid for range initializer type');
        }
        const initval = init instanceof PBShaderExp ? init.$ast : new ASTScalar(init, initializerType);
        if (typeof open === 'function') {
            body = open;
            open = true;
            reverse = false;
        } else if (typeof reverse === 'function') {
            body = reverse;
            open = !!open;
            reverse = false;
        } else {
            open = !!open;
            reverse = !!reverse;
        }
        const astFor = new ASTRange(counter.$ast, initval, end instanceof PBShaderExp ? end.$ast : new ASTScalar(end, initializerType), open, reverse);
        this.$ast.statements.push(astFor);
        new PBForScope(this, counter, end, astFor, body);
    }
    /**
   * Creates a 'do..while' statement
   * @param body - Generator function for the scope that inside the do..while statment
   * @returns The scope that inside the do..while statement
   */ $do(body) {
        if (this.$builder.getDevice().type === 'webgl') {
            throw new Error(`No do-while() loop support for WebGL1.0 device`);
        }
        const astDoWhile = new ASTDoWhile(null);
        this.$ast.statements.push(astDoWhile);
        return new PBDoWhileScope(this, astDoWhile, body);
    }
    /**
   * Creates a 'while' statement
   * @param condition - Condition expression for the while statement
   * @param body - Generator function for the scope that inside the while statement
   */ $while(condition, body) {
        const astWhile = new ASTWhile(condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.statements.push(astWhile);
        new PBWhileScope(this, astWhile, body);
    }
    /** @internal */ findOwnerFunction() {
        for(let scope = this; scope; scope = scope.$parent){
            if (scope instanceof PBFunctionScope) {
                return scope;
            }
        }
        return null;
    }
    /** Gets main function scope */ $getMainScope() {
        for(let scope = this; scope; scope = scope.$parent){
            if (scope instanceof PBFunctionScope && scope.$isMain()) {
                return scope;
            }
        }
        return null;
    }
}
/**
 * Scope that insides a function
 * @public
 */ class PBFunctionScope extends PBInsideFunctionScope {
    /** @internal */ $typeinfo;
    /** @internal */ constructor(parent, params, ast, body){
        super(parent);
        this.$ast = ast;
        for (const param of params){
            if (this.$_variables[param.$str]) {
                throw new Error('Duplicate function parameter name is not allowed');
            }
            this.$_registerVar(param);
        }
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
    $isMain() {
        return this.$ast.isMainFunc;
    }
}
/**
 * Scope that insides a while statement
 * @public
 */ class PBWhileScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * Scope that insides a do..while statement
 * @public
 */ class PBDoWhileScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
    $while(condition) {
        this.$ast.condition = condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool);
    }
}
/**
 * Scope that insides a for statement
 * @public
 */ class PBForScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, counter, count, ast, body){
        super(parent);
        this.$ast = ast;
        this.$_registerVar(counter);
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * A naked scope
 * @public
 */ class PBNakedScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * Scope that insides an if statement
 * @public
 */ class PBIfScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body?.call(this);
        getCurrentProgramBuilder().popScope();
    }
    /**
   * Creates an 'else if' branch
   * @param condition - Condition expression for the else if branch
   * @param body - Generator function for the scope that insides the else if statement
   * @returns The scope that insides the else if statement
   */ $elseif(condition, body) {
        const astElseIf = new ASTIf('else if', condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.nextElse = astElseIf;
        return new PBIfScope(this.$_parentScope, astElseIf, body);
    }
    /**
   * Creates an 'else' branch
   * @param body - Generator function for the scope that insides the else statement
   */ $else(body) {
        const astElse = new ASTIf('else', null);
        this.$ast.nextElse = astElse;
        new PBIfScope(this.$_parentScope, astElse, body);
    }
}
setBuiltinFuncs(ProgramBuilder);
setConstructors(ProgramBuilder);

/** @internal */ class FontCanvas {
    static _canvas = null;
    static _context = null;
    static get canvas() {
        this._realize();
        return this._canvas;
    }
    static get context() {
        this._realize();
        return this._context;
    }
    static get font() {
        return this.context.font;
    }
    static set font(font) {
        this.context.font = font;
    }
    static _realize() {
        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
            this._canvas.width = 512;
            this._canvas.height = 512;
            this._canvas.style.left = '-10000px';
            this._canvas.style.position = 'absolute';
            //document.body.appendChild(this._canvas);
            this._context = this._canvas.getContext('2d', {
                willReadFrequently: true
            });
            this._context.textBaseline = 'top';
            this._context.textAlign = 'left';
            this._context.fillStyle = 'transparent';
            this._context.fillRect(0, 0, this._canvas.width, this._canvas.height);
            this._context.fillStyle = '#ffffff';
            this._context.imageSmoothingEnabled = true;
            this._context.imageSmoothingQuality = 'high';
        }
    }
}
/**
 * The font class
 * @public
 */ class Font {
    /** @internal */ static fontCache = {};
    /** @internal */ _name;
    /** @internal */ _nameScaled;
    /** @internal */ _scale;
    /** @internal */ _size;
    /** @internal */ _family;
    /** @internal */ _top;
    /** @internal */ _bottom;
    /** @internal */ _topScaled;
    /** @internal */ _bottomScaled;
    /** @internal */ _div;
    /**
   * Creates a instance of font class from font name and the scale value
   * @param name - The font name
   * @param scale - The scale value
   */ constructor(name, scale){
        this._top = 0;
        this._bottom = 0;
        this._size = 0;
        this._topScaled = 0;
        this._bottomScaled = 0;
        this._family = '';
        this._scale = scale;
        this._name = name;
        this._nameScaled = null;
        this._div = document.createElement('div');
        if (this._name) {
            this._normalizeFont();
        }
    }
    /**
   * Fetch a font from cache
   * @param name - The font name
   * @param scale - The scale value
   * @returns The font object
   */ static fetchFont(name, scale) {
        let fontlist = this.fontCache[name];
        if (!fontlist) {
            fontlist = {};
            this.fontCache[name] = fontlist;
        }
        let font = fontlist[scale];
        if (!font) {
            font = new Font(name, scale);
            fontlist[scale] = font;
        }
        return font;
    }
    /** Gets the font name */ get fontName() {
        return this._name;
    }
    set fontName(name) {
        this._name = name;
        this._normalizeFont();
    }
    /** Gets the scaled font name */ get fontNameScaled() {
        return this._nameScaled;
    }
    /** Gets the font size */ get size() {
        return this._size;
    }
    /** Gets the font family */ get family() {
        return this._family;
    }
    /** Gets top position of the font */ get top() {
        return this._top;
    }
    /** Gets the bottom position of the font */ get bottom() {
        return this._bottom;
    }
    /** Gets the scaled top position of the font */ get topScaled() {
        return this._topScaled;
    }
    /** Gets the scaled bottom position of the font */ get bottomScaled() {
        return this._bottomScaled;
    }
    /** Gets the maximum height of the font */ get maxHeight() {
        return this._bottom - this._top + 1;
    }
    /** Gets the scaled maximum height of the font */ get maxHeightScaled() {
        return this._bottomScaled - this._topScaled + 1;
    }
    /** Tests if two fonts are the same */ equalTo(other) {
        return this._size === other._size && this._family === other._family;
    }
    /** @internal */ _measureFontHeight(fontName) {
        const oldFont = FontCanvas.context.font;
        const oldTextBaseline = FontCanvas.context.textBaseline;
        const oldFillStyle = FontCanvas.context.fillStyle;
        FontCanvas.context.font = fontName;
        this._div.style.font = FontCanvas.context.font;
        const fontSize = this._div.style.fontSize;
        const size = parseInt(fontSize.substring(0, fontSize.length - 2));
        const family = this._div.style.fontFamily;
        const testString = 'bdfghijklpq国美|_~';
        const metric = FontCanvas.context.measureText(testString);
        let top, bottom;
        top = 0;
        bottom = size - 1;
        const extra = 10;
        const halfExtra = extra >> 1;
        const maxWidth = Math.ceil(metric.width) + extra;
        const maxHeight = size + extra;
        FontCanvas.context.clearRect(0, 0, maxWidth, maxHeight);
        FontCanvas.context.textBaseline = 'top';
        FontCanvas.context.fillStyle = '#ffffff';
        FontCanvas.context.fillText(testString, halfExtra, halfExtra);
        const bitmap = FontCanvas.context.getImageData(0, 0, maxWidth, maxHeight);
        const pixels = bitmap.data;
        for(let i = 0; i < maxWidth * maxHeight; i++){
            if (pixels[i * 4 + 3] > 0) {
                top = Math.floor(i / maxWidth);
                break;
            }
        }
        for(let i = maxWidth * maxHeight - 1; i >= 0; i--){
            if (pixels[i * 4 + 3] > 0) {
                bottom = Math.floor(i / maxWidth);
                break;
            }
        }
        top -= halfExtra;
        bottom -= halfExtra;
        FontCanvas.context.font = oldFont;
        FontCanvas.context.textBaseline = oldTextBaseline;
        FontCanvas.context.fillStyle = oldFillStyle;
        return {
            size,
            family,
            top,
            bottom
        };
    }
    /** @internal */ _normalizeFont() {
        const info = this._measureFontHeight(this._name);
        this._nameScaled = `${Math.round(info.size * this._scale)}px ${info.family}`;
        const infoScaled = this._measureFontHeight(this._nameScaled);
        this._size = info.size;
        this._family = info.family;
        this._top = info.top;
        this._bottom = info.bottom;
        this._topScaled = infoScaled.top;
        this._bottomScaled = infoScaled.bottom;
    }
}

/**
 * Texture atlas manager
 * @public
 */ class TextureAtlasManager {
    /** @internal */ static ATLAS_WIDTH = 1024;
    /** @internal */ static ATLAS_HEIGHT = 1024;
    /** @internal */ _packer;
    /** @internal */ _device;
    /** @internal */ _binWidth;
    /** @internal */ _binHeight;
    /** @internal */ _rectBorderWidth;
    /** @internal */ _linearSpace;
    /** @internal */ _atlasList;
    /** @internal */ _atlasInfoMap;
    /** @internal */ _atlasRestoreHandler;
    /**
   * Creates a new texture atlas manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param rectBorderWidth - Border width of an atlas
   * @param linearSpace - true if the texture space is linear
   */ constructor(device, binWidth, binHeight, rectBorderWidth, linearSpace){
        this._device = device;
        this._binWidth = binWidth;
        this._binHeight = binHeight;
        this._rectBorderWidth = rectBorderWidth;
        this._linearSpace = !!linearSpace;
        this._packer = new RectsPacker(this._binWidth, this._binHeight);
        this._atlasList = [];
        this._atlasInfoMap = {};
        this._atlasRestoreHandler = null;
    }
    /**
   * The texture restore handler callback function
   * This callback function will be called whenever the device has been restored
   */ get atlasTextureRestoreHandler() {
        return this._atlasRestoreHandler;
    }
    set atlasTextureRestoreHandler(f) {
        this._atlasRestoreHandler = f;
    }
    /**
   * Gets the atlas texture of a given index
   * @param index - Index of the atlas bin
   * @returns Atlas texture for given index
   */ getAtlasTexture(index) {
        return this._atlasList[index];
    }
    /**
   * Gets the information about specified atlas
   * @param key - Key of the atlas
   * @returns Information of the atlas
   */ getAtlasInfo(key) {
        return this._atlasInfoMap[key] || null;
    }
    /**
   * Check if no atlas has been created
   * @returns true if no atlas has been created
   */ isEmpty() {
        return this._atlasList.length === 0;
    }
    /**
   * Removes all created atlases
   */ clear() {
        this._packer.clear();
        for (const tex of this._atlasList){
            tex.dispose();
        }
        this._atlasList = [];
        this._atlasInfoMap = {};
    }
    /**
   * Inserts a rectangle of a canvas to the atlas texture
   * @param key - Key of the atlas
   * @param ctx - The canvas context
   * @param x - x offset of the rectangle
   * @param y - y offset of the rectangle
   * @param w - width of the rectangle
   * @param h - height of the rectangle
   * @returns The atals info or null if insert failed
   */ pushCanvas(key, ctx, x, y, w, h) {
        const rc = this._packer.insert(w + 2 * this._rectBorderWidth, h + 2 * this._rectBorderWidth);
        if (rc) {
            const atlasX = rc.x + this._rectBorderWidth;
            const atlasY = rc.y + this._rectBorderWidth;
            this._updateAtlasTextureCanvas(rc.binIndex, ctx, atlasX, atlasY, w, h, x, y);
            const info = {
                atlasIndex: rc.binIndex,
                uMin: atlasX / this._binWidth,
                vMin: atlasY / this._binHeight,
                uMax: (atlasX + w) / this._binWidth,
                vMax: (atlasY + h) / this._binHeight,
                width: w,
                height: h
            };
            this._atlasInfoMap[key] = info;
            return info;
        }
        return null;
    }
    /**
   * Inserts a bitmap to the atlas texture
   * @param key - Key of the atlas
   * @param bitmap - The bitmap object
   * @returns The atals info or null if insert failed
   */ pushBitmap(key, bitmap) {
        const rc = this._packer.insert(bitmap.width + 2 * this._rectBorderWidth, bitmap.height + 2 * this._rectBorderWidth);
        if (rc) {
            const atlasX = rc.x + this._rectBorderWidth;
            const atlasY = rc.y + this._rectBorderWidth;
            this._updateAtlasTexture(rc.binIndex, bitmap, atlasX, atlasY);
            const info = {
                atlasIndex: rc.binIndex,
                uMin: atlasX / this._binWidth,
                vMin: atlasY / this._binHeight,
                uMax: (atlasX + bitmap.width) / this._binWidth,
                vMax: (atlasY + bitmap.height) / this._binHeight,
                width: bitmap.width,
                height: bitmap.height
            };
            this._atlasInfoMap[key] = info;
            return info;
        }
        return null;
    }
    /** @internal */ _createAtlasTexture() {
        const format = 'rgba8unorm';
        const tex = this._device.createTexture2D(format, this._binWidth, this._binHeight, {
            mipmapping: false
        });
        if (!tex) {
            throw new Error(`Create 2D texture failed: ${format}-${this._binWidth}x${this._binHeight}`);
        }
        tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
        tex.restoreHandler = ()=>{
            tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
            this._atlasRestoreHandler?.(tex);
        };
        return tex;
    }
    /** @internal */ _updateAtlasTextureCanvas(atlasIndex, ctx, x, y, w, h, xOffset, yOffset) {
        let textureAtlas;
        if (atlasIndex === this._atlasList.length) {
            textureAtlas = this._createAtlasTexture();
            this._atlasList.push(textureAtlas);
        } else {
            textureAtlas = this._atlasList[atlasIndex];
        }
        textureAtlas.updateFromElement(ctx.canvas, x, y, xOffset, yOffset, w, h);
    }
    /** @internal */ _updateAtlasTexture(atlasIndex, bitmap, x, y) {
        let textureAtlas;
        if (atlasIndex === this._atlasList.length) {
            textureAtlas = this._createAtlasTexture();
            this._atlasList.push(textureAtlas);
        } else {
            textureAtlas = this._atlasList[atlasIndex];
        }
        if (bitmap instanceof ImageBitmap) {
            textureAtlas.updateFromElement(bitmap, x, y, 0, 0, bitmap.width, bitmap.height);
        } else {
            const originValues = new Uint8Array(bitmap.data.buffer);
            textureAtlas.update(originValues, x, y, bitmap.width, bitmap.height);
        }
    }
}

/**
 * Manager of texture glyphs
 * @public
 */ class GlyphManager extends TextureAtlasManager {
    /**
   * Creates a new glyph manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param border - Border width of an atlas
   */ constructor(device, binWidth, binHeight, border){
        super(device, binWidth, binHeight, border, true);
        this.atlasTextureRestoreHandler = async ()=>{
            if (!this.isEmpty()) {
                this.clear();
            }
        };
    }
    /**
   * Gets the size for given character
   * @param char - The character
   * @param font - Font of the character
   * @returns [width, height]
   */ getGlyphSize(char, font) {
        return this._getGlyphSize(char, font);
    }
    getGlyphInfo(char, font) {
        let glyphInfo = this.getAtlasInfo(this._hash(char, font));
        if (!glyphInfo) {
            glyphInfo = this._cacheGlyph(char, font);
            if (glyphInfo) {
                glyphInfo.width = Math.round(glyphInfo.width * (font.maxHeight / font.maxHeightScaled));
                glyphInfo.height = font.maxHeight;
            }
        }
        return glyphInfo;
    }
    /**
   * Measuring the width of a string
   * @param str - The string to be measured
   * @param charMargin - margin size between characters
   * @param font - Font of the string
   * @returns Width of the string
   */ measureStringWidth(str, charMargin, font) {
        let w = 0;
        for (const ch of str){
            w += charMargin + this.getCharWidth(ch, font);
        }
        return w;
    }
    /**
   * Clips a string so that it's width is not larger than the given value
   * @param str - The string to be clipped
   * @param width - The desired maximum width
   * @param charMargin - Margin size between characters
   * @param start - Start index of the string to be clipped
   * @param font - Font of the string
   * @returns
   */ clipStringToWidth(str, width, charMargin, start, font) {
        let sum = 0;
        let i = start;
        for(; i < str.length; i++){
            sum += charMargin + this.getCharWidth(str[i], font);
            if (sum > width) {
                break;
            }
        }
        return i - start;
    }
    /**
   * Measuring width of a character
   * @param char - The character to be measured
   * @param font - Font of the character
   * @returns Width of the character
   */ getCharWidth(char, font) {
        if (!font) {
            return 0;
        }
        FontCanvas.font = font.fontNameScaled;
        const metric = FontCanvas.context.measureText(char);
        let w = metric.width;
        if (w === 0) {
            return 0;
        }
        if (typeof metric.actualBoundingBoxRight === 'number') {
            w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
        }
        w = Math.round(w * (font.maxHeight / font.maxHeightScaled));
        return w;
    }
    /** @internal */ _getGlyphSize(char, font) {
        FontCanvas.font = font.fontNameScaled;
        const metric = FontCanvas.context.measureText(char);
        let w = metric.width;
        if (w === 0) {
            return null;
        }
        if (typeof metric.actualBoundingBoxRight === 'number') {
            w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
        }
        const h = font.maxHeightScaled;
        return [
            w,
            h
        ];
    }
    /** @internal */ _getGlyphBitmap(char, font) {
        if (!font) {
            return null;
        }
        FontCanvas.font = font.fontNameScaled;
        const metric = FontCanvas.context.measureText(char);
        let w = metric.width;
        if (w === 0) {
            return null;
        }
        if (typeof metric.actualBoundingBoxRight === 'number') {
            w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
        }
        const h = font.maxHeightScaled;
        FontCanvas.context.fillStyle = '#fff';
        FontCanvas.context.clearRect(0, 0, w + 2, h);
        FontCanvas.context.fillText(char, 0, -font.topScaled);
        return FontCanvas.context.getImageData(0, 0, w, h);
    }
    /** @internal */ _hash(char, font) {
        return `${font.family}@${font.size}&${char}`;
    }
    /** @internal */ _cacheGlyph(char, font) {
        const bitmap = this._getGlyphBitmap(char, font);
        return this.pushBitmap(this._hash(char, font), bitmap);
    }
}

const MAX_GLYPH_COUNT = 1024;
/**
 * Helper class to draw some text onto the screen
 * @public
 */ class DrawText {
    /** @internal */ static GLYPH_COUNT = MAX_GLYPH_COUNT;
    /** @internal */ static glyphManager = null;
    /** @internal */ static prepared = false;
    /** @internal */ static textVertexBuffer = null;
    /** @internal */ static textVertexLayout = null;
    /** @internal */ static textProgram = null;
    /** @internal */ static textBindGroup = null;
    /** @internal */ static textRenderStates = null;
    /** @internal */ static textOffset = 0;
    /** @internal */ static textMatrix = new Matrix4x4();
    /** @internal */ static font = null;
    /** @internal */ static vertexCache = null;
    /** @internal */ static colorValue = new Vector4();
    /** @internal */ static calculateTextMatrix(device, matrix, viewport) {
        const viewportWidth = viewport ? viewport[2] : device.getViewport().width;
        const viewportHeight = viewport ? viewport[3] : device.getViewport().height;
        matrix.identity();
        const projectionMatrix = Matrix4x4.ortho(0, viewportWidth, 0, viewportHeight, 1, 100);
        const flipMatrix = Matrix4x4.translation(new Vector3(0, viewportHeight, 0)).scaleRight(new Vector3(1, -1, 1));
        Matrix4x4.multiply(projectionMatrix, flipMatrix, matrix);
    }
    /**
   * Set the font that will be used to draw strings
   * @param device - The render device
   * @param name - The font name
   */ static setFont(device, name) {
        const scale = device.getScaleY();
        this.font = Font.fetchFont(name, scale) || Font.fetchFont('12px arial', scale);
    }
    /**
   * Draw text onto the screen
   * @param device - The render device
   * @param text - The text to be drawn
   * @param color - The text color
   * @param x - X coordinate of the text
   * @param y - Y coordinate of the text
   */ static drawText(device, text, color, x, y, viewport) {
        if (text.length > 0) {
            device.pushDeviceStates();
            this.prepareDrawText(device);
            this.calculateTextMatrix(device, this.textMatrix, viewport);
            const colorValue = parseColor(color);
            this.colorValue.x = colorValue.r;
            this.colorValue.y = colorValue.g;
            this.colorValue.z = colorValue.b;
            this.colorValue.w = colorValue.a;
            this.textBindGroup.setValue('flip', device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0);
            this.textBindGroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
            this.textBindGroup.setValue('textMatrix', this.textMatrix);
            this.textBindGroup.setValue('textColor', this.colorValue);
            device.setProgram(this.textProgram);
            device.setVertexLayout(this.textVertexLayout);
            device.setRenderStates(this.textRenderStates);
            device.setBindGroup(0, this.textBindGroup);
            let drawn = 0;
            const total = text.length;
            while(drawn < total){
                const count = Math.min(total - drawn, this.GLYPH_COUNT - this.textOffset);
                if (count > 0) {
                    x = this.drawTextNoOverflow(device, text, drawn, count, x, y);
                    drawn += count;
                    this.textOffset += count;
                }
                if (this.GLYPH_COUNT === this.textOffset) {
                    this.textOffset = 0;
                    device.flush();
                }
            }
            device.popDeviceStates();
        }
    }
    /** @internal */ static drawTextNoOverflow(device, text, start, count, x, y) {
        let drawn = 0;
        let atlasIndex = -1;
        let i = 0;
        const vertexCache = this.vertexCache;
        for(; i < count; i++){
            const glyph = this.glyphManager.getGlyphInfo(text[i + start], this.font) || this.glyphManager.getGlyphInfo('?', this.font);
            if (atlasIndex >= 0 && glyph.atlasIndex !== atlasIndex) {
                this.textVertexBuffer.bufferSubData((this.textOffset + drawn) * 16 * 4, this.vertexCache, (this.textOffset + drawn) * 16, (i - drawn) * 16);
                this.textBindGroup.setTexture('tex', this.glyphManager.getAtlasTexture(atlasIndex));
                device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
                drawn = i;
            }
            atlasIndex = glyph.atlasIndex;
            const base = (this.textOffset + i) * 16;
            vertexCache[base + 0] = x;
            vertexCache[base + 1] = y;
            vertexCache[base + 2] = glyph.uMin;
            vertexCache[base + 3] = glyph.vMin;
            vertexCache[base + 4] = x + glyph.width;
            vertexCache[base + 5] = y;
            vertexCache[base + 6] = glyph.uMax;
            vertexCache[base + 7] = glyph.vMin;
            vertexCache[base + 8] = x + glyph.width;
            vertexCache[base + 9] = y + glyph.height;
            vertexCache[base + 10] = glyph.uMax;
            vertexCache[base + 11] = glyph.vMax;
            vertexCache[base + 12] = x;
            vertexCache[base + 13] = y + glyph.height;
            vertexCache[base + 14] = glyph.uMin;
            vertexCache[base + 15] = glyph.vMax;
            x += glyph.width;
        }
        this.textVertexBuffer.bufferSubData((this.textOffset + drawn) * 16 * 4, vertexCache, (this.textOffset + drawn) * 16, (i - drawn) * 16);
        this.textBindGroup.setTexture('tex', this.glyphManager.getAtlasTexture(atlasIndex));
        device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
        return x;
    }
    /** @internal */ static prepareDrawText(device) {
        if (!this.prepared) {
            this.prepared = true;
            this.font = this.font || Font.fetchFont('12px arial', device.getScaleY());
            this.glyphManager = new GlyphManager(device, 1024, 1024, 1);
            this.vertexCache = new Float32Array(this.GLYPH_COUNT * 16);
            this.textVertexBuffer = device.createInterleavedVertexBuffer([
                'position_f32x2',
                'tex0_f32x2'
            ], this.vertexCache, {
                dynamic: true
            });
            const indices = new Uint16Array(this.GLYPH_COUNT * 6);
            for(let i = 0; i < this.GLYPH_COUNT; i++){
                const base = i * 4;
                indices[i * 6 + 0] = base + 0;
                indices[i * 6 + 1] = base + 1;
                indices[i * 6 + 2] = base + 2;
                indices[i * 6 + 3] = base + 0;
                indices[i * 6 + 4] = base + 2;
                indices[i * 6 + 5] = base + 3;
            }
            const textIndexBuffer = device.createIndexBuffer(indices);
            this.textVertexLayout = device.createVertexLayout({
                vertexBuffers: [
                    {
                        buffer: this.textVertexBuffer
                    }
                ],
                indexBuffer: textIndexBuffer
            });
            this.textOffset = 0;
            this.textProgram = device.buildRenderProgram({
                vertex (pb) {
                    this.$inputs.pos = pb.vec2().attrib('position');
                    this.$inputs.uv = pb.vec2().attrib('texCoord0');
                    this.$outputs.uv = pb.vec2();
                    this.flip = pb.int(0).uniform(0);
                    this.textMatrix = pb.mat4().uniform(0);
                    pb.main(function() {
                        this.$builtins.position = pb.mul(this.textMatrix, pb.vec4(this.$inputs.pos, -50, 1));
                        this.$if(pb.notEqual(this.flip, 0), function() {
                            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
                        });
                        this.$outputs.uv = this.$inputs.uv;
                    });
                },
                fragment (pb) {
                    this.$outputs.color = pb.vec4();
                    this.textColor = pb.vec4().uniform(0);
                    this.tex = pb.tex2D().uniform(0);
                    this.srgbOut = pb.int().uniform(0);
                    pb.main(function() {
                        this.alpha = pb.mul(pb.textureSample(this.tex, this.$inputs.uv).a, this.textColor.a);
                        this.$if(pb.notEqual(this.srgbOut, 0), function() {
                            this.$outputs.color = pb.vec4(pb.mul(pb.pow(this.textColor.rgb, pb.vec3(1 / 2.2)), this.alpha), this.alpha);
                        }).$else(function() {
                            this.$outputs.color = pb.vec4(pb.mul(this.textColor.rgb, this.alpha), this.alpha);
                        });
                    });
                }
            });
            this.textProgram.name = '@DrawText';
            this.textBindGroup = device.createBindGroup(this.textProgram.bindGroupLayouts[0]);
            this.textRenderStates = device.createRenderStateSet();
            this.textRenderStates.useBlendingState().enable(true).setBlendFuncRGB('one', 'inv-src-alpha').setBlendFuncAlpha('zero', 'one');
            this.textRenderStates.useDepthState().enableTest(false).enableWrite(false);
            this.textRenderStates.useRasterizerState().setCullMode('none');
        }
    }
}

class ResizeHandler {
    _canvas;
    _dpr;
    _cssWidth;
    _cssHeight;
    _deviceWidth;
    _deviceHeight;
    _resizeObserver;
    _mutationObserver;
    _onResizeCallback;
    constructor(canvas, onResize, dpr){
        this._canvas = canvas;
        this._dpr = dpr;
        this._cssWidth = 0;
        this._cssHeight = 0;
        this._deviceWidth = 0;
        this._deviceHeight = 0;
        this._onResizeCallback = onResize;
    }
    init() {
        const canvas = this._canvas;
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver((entries)=>{
                const entry = entries[0];
                this._handleResizeEntry(entry);
            });
            try {
                this._resizeObserver.observe(canvas, {
                    box: 'device-pixel-content-box'
                });
            } catch  {
                this._resizeObserver.observe(canvas);
            }
        } else {
            if (window.MutationObserver) {
                this._mutationObserver = new MutationObserver((mutations)=>{
                    if (mutations.length > 0) {
                        this._handleLegacyResize();
                    }
                });
                this._mutationObserver.observe(canvas, {
                    attributes: true,
                    attributeFilter: [
                        'style'
                    ]
                });
            }
            window.addEventListener('resize', this._handleLegacyResize);
            this._handleLegacyResize();
        }
    }
    _handleResizeEntry(_entry) {
        // CSS pixel
        const boxSize = Array.isArray(_entry.contentBoxSize) ? _entry.contentBoxSize[0] : _entry.contentBoxSize;
        const cssWidth = boxSize?.inlineSize ?? this._canvas.clientWidth;
        const cssHeight = boxSize?.blockSize ?? this._canvas.clientHeight;
        // Device pixel
        /*
    let deviceWidth: number;
    let deviceHeight: number;

    const dpBox = (entry as any).devicePixelContentBoxSize?.[0];
    if (dpBox) {
      deviceWidth = dpBox.inlineSize;
      deviceHeight = dpBox.blockSize;
    } else {
      deviceWidth = Math.round(cssWidth * this._dpr);
      deviceHeight = Math.round(cssHeight * this._dpr);
    }
    */ const deviceWidth = cssWidth * this._dpr;
        const deviceHeight = cssHeight * this._dpr;
        if (cssWidth === this._cssWidth && cssHeight === this._cssHeight && deviceWidth === this._deviceWidth && deviceHeight === this._deviceHeight) {
            return;
        }
        this._cssWidth = cssWidth;
        this._cssHeight = cssHeight;
        this._deviceWidth = deviceWidth;
        this._deviceHeight = deviceHeight;
        this._onResizeCallback(cssWidth, cssHeight, deviceWidth, deviceHeight);
    }
    _handleLegacyResize = ()=>{
        const cssWidth = this._canvas.clientWidth;
        const cssHeight = this._canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        const deviceWidth = Math.round(cssWidth * dpr);
        const deviceHeight = Math.round(cssHeight * dpr);
        if (cssWidth === this._cssWidth && cssHeight === this._cssHeight && deviceWidth === this._deviceWidth && deviceHeight === this._deviceHeight) {
            return;
        }
        this._cssWidth = cssWidth;
        this._cssHeight = cssHeight;
        this._deviceWidth = deviceWidth;
        this._deviceHeight = deviceHeight;
        this._onResizeCallback(cssWidth, cssHeight, deviceWidth, deviceHeight);
    };
    dispose() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this._mutationObserver) {
            this._mutationObserver.disconnect();
        }
        window.removeEventListener('resize', this._handleLegacyResize);
    }
}
/**
 * Base class for rendering device
 * @public
 */ class BaseDevice extends Observable {
    _dpr;
    _canvas;
    _canvasClientWidth;
    _canvasClientHeight;
    _gpuObjectList;
    _gpuMemCost;
    _disposeObjectList;
    _beginFrameTime;
    _endFrameTime;
    _frameInfo;
    _cpuTimer;
    _gpuTimer;
    _runningLoop;
    _fpsCounter;
    _runLoopFunc;
    _backend;
    _beginFrameCounter;
    _programBuilder;
    _poolMap;
    _defaultPoolKey;
    _temporalFramebuffer;
    _vSync;
    _resizer;
    _stateStack;
    constructor(cvs, backend, dpr){
        super();
        this._dpr = dpr ?? window.devicePixelRatio ?? 1;
        this._backend = backend;
        this._gpuObjectList = {
            textures: [],
            samplers: [],
            buffers: [],
            programs: [],
            framebuffers: [],
            vertexArrayObjects: [],
            bindGroups: []
        };
        this._canvas = cvs;
        this._canvas.setAttribute('tabindex', '1');
        this._canvasClientWidth = cvs.clientWidth;
        this._canvasClientHeight = cvs.clientHeight;
        this._gpuMemCost = 0;
        this._disposeObjectList = [];
        this._beginFrameTime = 0;
        this._endFrameTime = 0;
        this._runLoopFunc = null;
        this._frameInfo = {
            frameCounter: 0,
            frameTimestamp: 0,
            elapsedTimeCPU: 0,
            elapsedTimeGPU: 0,
            elapsedFrame: 0,
            elapsedOverall: 0,
            FPS: 0,
            drawCalls: 0,
            computeCalls: 0,
            nextFrameCall: [],
            nextFrameCallNext: []
        };
        this._programBuilder = new ProgramBuilder(this);
        this._cpuTimer = new CPUTimer();
        this._gpuTimer = null;
        this._runningLoop = null;
        this._fpsCounter = {
            time: 0,
            frame: 0
        };
        this._stateStack = [];
        this._beginFrameCounter = 0;
        this._poolMap = new Map();
        this._defaultPoolKey = Symbol('defaultPool');
        this._poolMap.set(this._defaultPoolKey, new Pool(this, this._defaultPoolKey));
        this._temporalFramebuffer = false;
        this._temporalFramebuffer = false;
        this._vSync = true;
        //this._registerEventHandlers();
        this._resizer = new ResizeHandler(this._canvas, (cssWidth, cssHeight, deviceWidth, deviceHeight)=>{
            this.dispatchEvent('resize', cssWidth, cssHeight, deviceWidth, deviceHeight);
        }, this._dpr);
    }
    getScaleX() {
        return this._canvas.width / this._canvas.clientWidth;
    }
    getScaleY() {
        return this._canvas.height / this._canvas.clientHeight;
    }
    get backend() {
        return this._backend;
    }
    get videoMemoryUsage() {
        return this._gpuMemCost;
    }
    get frameInfo() {
        return this._frameInfo;
    }
    get isRendering() {
        return this._runningLoop !== null;
    }
    get canvas() {
        return this._canvas;
    }
    get type() {
        return this._backend.typeName();
    }
    get vSync() {
        return this._vSync;
    }
    set vSync(val) {
        this._vSync = !!val;
    }
    get pool() {
        return this._poolMap.get(this._defaultPoolKey);
    }
    get runLoopFunction() {
        return this._runLoopFunc;
    }
    get programBuilder() {
        return this._programBuilder;
    }
    poolExists(key) {
        return this._poolMap.has(key);
    }
    getPool(key) {
        let pool = this._poolMap.get(key);
        if (!pool) {
            pool = new Pool(this, key);
            this._poolMap.set(key, pool);
        }
        return pool;
    }
    setFont(fontName) {
        DrawText.setFont(this, fontName);
    }
    drawText(text, x, y, color, viewport) {
        DrawText.drawText(this, text, color, x, y, viewport);
    }
    setFramebuffer(colorOrRT, depth, sampleCount) {
        let newRT = null;
        let temporal = false;
        if (!Array.isArray(colorOrRT)) {
            newRT = colorOrRT ?? null;
        } else {
            newRT = this.pool.fetchTemporalFramebuffer(false, 0, 0, colorOrRT, depth, true, sampleCount);
            temporal = true;
        }
        const currentRT = this.getFramebuffer();
        if (currentRT !== newRT) {
            if (this._temporalFramebuffer && currentRT) {
                this.pool.releaseFrameBuffer(currentRT);
            }
            this._temporalFramebuffer = temporal;
            this._setFramebuffer(newRT);
        }
    }
    disposeObject(obj, remove = true) {
        if (obj) {
            if (remove) {
                this.removeGPUObject(obj);
            }
            if (this.isContextLost()) {
                obj.destroy();
            } else {
                this._disposeObjectList.push(obj);
            }
        }
    }
    restoreObject(obj) {
        if (obj && obj.disposed && !this.isContextLost()) {
            obj.restore();
            obj.restoreHandler?.(obj);
        }
    }
    enableGPUTimeRecording(enable) {
        if (enable && !this._gpuTimer) {
            this._gpuTimer = this.createGPUTimer();
        } else if (!enable) {
            this._gpuTimer?.end();
            this._gpuTimer = null;
        }
    }
    beginFrame() {
        if (this._beginFrameCounter === 0) {
            for (const obj of this._disposeObjectList){
                obj.destroy();
            }
            this._disposeObjectList = [];
        }
        this._beginFrameCounter++;
        this._beginFrameTime = this._cpuTimer.now();
        this.updateFrameInfo();
        this._poolMap.forEach((pool)=>pool.autoRelease());
        return this.onBeginFrame();
    }
    endFrame() {
        if (this._beginFrameCounter > 0) {
            this._beginFrameCounter--;
            if (this._beginFrameCounter === 0) {
                this._endFrameTime = this._cpuTimer.now();
                this._frameInfo.frameCounter++;
                this.onEndFrame();
            }
        }
    }
    getVertexAttribFormat(semantic, dataType, componentCount) {
        return getVertexAttribFormat(semantic, dataType, componentCount);
    }
    createInterleavedVertexBuffer(attribFormats, data, options) {
        if (options && options.usage && options.usage !== 'vertex') {
            console.error(`createInterleavedVertexBuffer() failed: options.usage must be 'vertex' or not set`);
            return null;
        }
        let size = 0;
        for (const format of attribFormats){
            size += getVertexFormatSize(format);
        }
        const vertexBufferType = makeVertexBufferType(data.byteLength / size >> 0, ...attribFormats);
        if (!vertexBufferType) {
            console.error('createInterleavedVertexBuffer() failed: Cannot determine vertex buffer type');
            return null;
        }
        const opt = Object.assign({
            usage: 'vertex',
            dynamic: false,
            managed: true,
            storage: false
        }, options || {});
        if (opt.storage) {
            opt.dynamic = false;
            opt.managed = false;
        }
        if (opt.dynamic) {
            opt.managed = false;
        }
        return this.createStructuredBuffer(vertexBufferType, opt, data);
    }
    createVertexBuffer(attribFormat, data, options) {
        if (options && options.usage && options.usage !== 'vertex') {
            console.error(`createVertexBuffer() failed: options.usage must be 'vertex' or not set`);
            return null;
        }
        const count = getVertexFormatSize(attribFormat);
        const vertexBufferType = makeVertexBufferType(data.byteLength / count >> 0, attribFormat);
        if (!vertexBufferType) {
            console.error('createInterleavedVertexBuffer() failed: Cannot determine vertex buffer type');
            return null;
        }
        const opt = Object.assign({
            usage: 'vertex',
            dynamic: false,
            managed: true,
            storage: false
        }, options || {});
        if (opt.storage) {
            opt.dynamic = false;
            opt.managed = false;
        }
        if (opt.dynamic) {
            opt.managed = false;
        }
        return this.createStructuredBuffer(vertexBufferType, opt, data);
    }
    draw(primitiveType, first, count) {
        this._frameInfo.drawCalls++;
        this._draw(primitiveType, first, count);
    }
    drawInstanced(primitiveType, first, count, numInstances) {
        this._frameInfo.drawCalls++;
        this._drawInstanced(primitiveType, first, count, numInstances);
    }
    executeRenderBundle(renderBundle) {
        this._frameInfo.drawCalls += this._executeRenderBundle(renderBundle);
    }
    compute(workgroupCountX, workgroupCountY, workgroupCountZ) {
        this._frameInfo.computeCalls++;
        this._compute(workgroupCountX, workgroupCountY, workgroupCountZ);
    }
    runNextFrame(f) {
        if (f) {
            this._frameInfo.nextFrameCall.push(f);
        }
    }
    async runNextFrameAsync(f) {
        return new Promise((resolve)=>{
            if (f) {
                this._frameInfo.nextFrameCall.push(()=>{
                    const p = f();
                    if (p instanceof Promise) {
                        p.then(()=>resolve());
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
    exitLoop() {
        if (this._runningLoop !== null) {
            if (this._runningLoop !== 0) {
                cancelAnimationFrame(this._runningLoop);
            } else {
                this.cancelNextFrame(this._runningLoop);
            }
            this._runningLoop = null;
        }
    }
    runLoop(func) {
        if (this._runningLoop !== null) {
            console.error('Device.runLoop() can not be nested');
            return;
        }
        if (!func) {
            console.error('Device.runLoop() argment error');
            return;
        }
        const that = this;
        that._runLoopFunc = func;
        (function entry() {
            if (that._vSync) {
                that._runningLoop = requestAnimationFrame(entry);
            } else {
                that._runningLoop = that.nextFrame(()=>{
                    if (that._runningLoop !== null) {
                        entry();
                    }
                });
            }
            if (that.beginFrame()) {
                that._runLoopFunc(that);
                that.endFrame();
            }
        })();
    }
    pushDeviceStates() {
        this._stateStack.push({
            windowOrderReversed: this.isWindingOrderReversed(),
            framebuffer: this.getFramebuffer(),
            viewport: this.getViewport(),
            scissor: this.getScissor(),
            program: this.getProgram(),
            renderStateSet: this.getRenderStates(),
            vertexLayout: this.getVertexLayout(),
            bindGroups: [
                this.getBindGroup(0),
                this.getBindGroup(1),
                this.getBindGroup(2),
                this.getBindGroup(3)
            ]
        });
    }
    popDeviceStates() {
        if (this._stateStack.length === 0) {
            console.error('Device.popDeviceStates(): stack is empty');
        } else {
            const top = this._stateStack.pop();
            this.setFramebuffer(top.framebuffer);
            this.setViewport(top.viewport);
            this.setScissor(top.scissor);
            this.setProgram(top.program);
            this.setRenderStates(top.renderStateSet);
            this.setVertexLayout(top.vertexLayout);
            this.setBindGroup(0, ...top.bindGroups[0]);
            this.setBindGroup(1, ...top.bindGroups[1]);
            this.setBindGroup(2, ...top.bindGroups[2]);
            this.setBindGroup(3, ...top.bindGroups[3]);
            this.reverseVertexWindingOrder(top.windowOrderReversed);
        }
    }
    getGPUObjects() {
        return this._gpuObjectList;
    }
    getGPUObjectById(uid) {
        for (const list of [
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.buffers,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.programs,
            this._gpuObjectList.vertexArrayObjects
        ]){
            for (const obj of list){
                if (obj.uid === uid) {
                    return obj;
                }
            }
        }
        return null;
    }
    screenXToDevice(val) {
        return this.getFramebuffer() ? val : Math.round(val * this.getScaleX());
    }
    deviceXToScreen(val) {
        return this.getFramebuffer() ? val : Math.round(val / this.getScaleX());
    }
    screenYToDevice(val) {
        return this.getFramebuffer() ? val : Math.round(val * this.getScaleY());
    }
    deviceYToScreen(val) {
        return this.getFramebuffer() ? val : Math.round(val / this.getScaleY());
    }
    buildRenderProgram(options) {
        return this._programBuilder.buildRenderProgram(options);
    }
    buildComputeProgram(options) {
        return this._programBuilder.buildComputeProgram(options);
    }
    addGPUObject(obj) {
        const list = this.getGPUObjectList(obj);
        if (list && list.indexOf(obj) < 0) {
            list.push(obj);
            this.dispatchEvent('gpuobject_added', obj);
        }
    }
    removeGPUObject(obj) {
        const list = this.getGPUObjectList(obj);
        if (list) {
            const index = list.indexOf(obj);
            if (index >= 0) {
                list.splice(index, 1);
                this.dispatchEvent('gpuobject_removed', obj);
            }
        }
    }
    updateVideoMemoryCost(delta) {
        this._gpuMemCost += delta;
    }
    async initResizer() {
        return new Promise((resolve)=>{
            this.once('resize', (cssWidth, cssHeight, deviceWidth, deviceHeight)=>{
                this._handleResize(cssWidth, cssHeight, deviceWidth, deviceHeight);
                this.on('resize', (cssWidth, cssHeight, deviceWidth, deviceHeight)=>{
                    this._handleResize(cssWidth, cssHeight, deviceWidth, deviceHeight);
                });
                resolve();
            });
            this._resizer.init();
        });
    }
    updateFrameInfo() {
        this._frameInfo.drawCalls = 0;
        this._frameInfo.computeCalls = 0;
        const now = this._beginFrameTime;
        if (this._frameInfo.frameTimestamp === 0) {
            this._frameInfo.frameTimestamp = now;
            this._frameInfo.elapsedTimeCPU = 0;
            this._frameInfo.elapsedTimeGPU = 0;
            this._frameInfo.elapsedFrame = 0;
            this._frameInfo.elapsedOverall = 0;
            this._frameInfo.FPS = 0;
            this._fpsCounter.time = now;
            this._fpsCounter.frame = this._frameInfo.frameCounter;
            if (this._gpuTimer) {
                this._gpuTimer.begin();
            }
        } else {
            this._frameInfo.elapsedFrame = now - this._frameInfo.frameTimestamp;
            this._frameInfo.elapsedOverall += this._frameInfo.elapsedFrame;
            let gpuTime = 0;
            let cpuTime = 0;
            if (this._endFrameTime !== 0) {
                gpuTime = now - this._endFrameTime;
                cpuTime = this._endFrameTime - this._frameInfo.frameTimestamp;
            }
            this._frameInfo.frameTimestamp = now;
            if (now >= this._fpsCounter.time + 1000) {
                this._frameInfo.FPS = (this._frameInfo.frameCounter - this._fpsCounter.frame) * 1000 / (now - this._fpsCounter.time);
                this._fpsCounter.time = now;
                this._fpsCounter.frame = this._frameInfo.frameCounter;
                this._frameInfo.elapsedTimeGPU = gpuTime;
                this._frameInfo.elapsedTimeCPU = cpuTime;
            }
        }
        const tmp = this._frameInfo.nextFrameCall;
        this._frameInfo.nextFrameCall = this._frameInfo.nextFrameCallNext;
        this._frameInfo.nextFrameCallNext = tmp;
        for (const f of this._frameInfo.nextFrameCallNext){
            f();
        }
        this._frameInfo.nextFrameCallNext.length = 0;
    }
    getGPUObjectList(obj) {
        let list = null;
        if (obj.isTexture()) {
            list = this._gpuObjectList.textures;
        } else if (obj.isSampler()) {
            list = this._gpuObjectList.samplers;
        } else if (obj.isBuffer()) {
            list = this._gpuObjectList.buffers;
        } else if (obj.isFramebuffer()) {
            list = this._gpuObjectList.framebuffers;
        } else if (obj.isProgram()) {
            list = this._gpuObjectList.programs;
        } else if (obj.isVertexLayout()) {
            list = this._gpuObjectList.vertexArrayObjects;
        } else if (obj.isBindGroup()) {
            list = this._gpuObjectList.bindGroups;
        }
        return list;
    }
    invalidateAll() {
        for (const list of [
            this._gpuObjectList.buffers,
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.programs,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.vertexArrayObjects,
            this._gpuObjectList.bindGroups
        ]){
            for (const obj of list){
                this.disposeObject(obj, false);
            }
        }
        if (this.isContextLost()) {
            for (const obj of this._disposeObjectList){
                obj.destroy();
            }
            this._disposeObjectList = [];
        }
    }
    reloadAll() {
        for (const list of [
            this._gpuObjectList.buffers,
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.programs,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.vertexArrayObjects,
            this._gpuObjectList.bindGroups
        ]){
            // obj.reload() may change the list, so make a copy first
            for (const obj of list.slice()){
                obj.reload();
            }
        }
        return;
    }
    parseTextureOptions(options) {
        const noMipmapFlag = options?.mipmapping === false ? GPUResourceUsageFlags.TF_NO_MIPMAP : 0;
        const writableFlag = options?.writable ? GPUResourceUsageFlags.TF_WRITABLE : 0;
        const dynamicFlag = options?.dynamic ? GPUResourceUsageFlags.DYNAMIC : 0;
        if (noMipmapFlag && options?.samplerOptions) {
            options.samplerOptions.mipFilter = 'none';
        }
        return noMipmapFlag | writableFlag | dynamicFlag;
    }
    parseBufferOptions(options, defaultUsage) {
        options = options ?? {};
        const usage = options.usage ?? defaultUsage;
        let usageFlag;
        switch(usage){
            case 'uniform':
                usageFlag = GPUResourceUsageFlags.BF_UNIFORM;
                options.managed = false;
                options.dynamic = options.dynamic ?? true;
                break;
            case 'vertex':
                usageFlag = GPUResourceUsageFlags.BF_VERTEX;
                break;
            case 'index':
                usageFlag = GPUResourceUsageFlags.BF_INDEX;
                break;
            case 'read':
                usageFlag = GPUResourceUsageFlags.BF_READ;
                options.managed = false;
                break;
            case 'write':
                usageFlag = GPUResourceUsageFlags.BF_WRITE;
                options.managed = false;
                break;
            case 'pack-pixel':
                usageFlag = GPUResourceUsageFlags.BF_PACK_PIXEL;
                options.managed = false;
                break;
            case 'unpack-pixel':
                usageFlag = GPUResourceUsageFlags.BF_UNPACK_PIXEL;
                options.managed = false;
                break;
            default:
                usageFlag = 0;
                break;
        }
        const storageFlag = options?.storage ?? false ? GPUResourceUsageFlags.BF_STORAGE : 0;
        const dynamicFlag = options?.dynamic ?? false ? GPUResourceUsageFlags.DYNAMIC : 0;
        const managedFlag = dynamicFlag === 0 && (options?.managed ?? true) ? GPUResourceUsageFlags.MANAGED : 0;
        return usageFlag | storageFlag | dynamicFlag | managedFlag;
    }
}

/**
 * Structured buffer data
 * @public
 */ class StructuredBufferData {
    /** @internal */ _cache;
    /** @internal */ _buffer;
    /** @internal */ _size;
    /** @internal */ _uniformMap;
    /** @internal */ _uniformPositions;
    /**
   * Creates a new structured buffer data
   * @param layout - Layout of the structure
   * @param buffer - Buffer that holds the data
   */ constructor(layout, buffer){
        this._size = layout.byteSize + 15 & -16;
        if (this._size <= 0) {
            throw new Error(`UniformBuffer(): invalid uniform buffer byte size: ${this._size}`);
        }
        // this._cache = new ArrayBuffer(size);
        this._uniformMap = {};
        this._uniformPositions = {};
        this._cache = buffer instanceof ArrayBuffer ? buffer : null;
        this._buffer = buffer instanceof ArrayBuffer || !buffer ? null : buffer;
        this.init(layout, 0, '');
    }
    /** The buffer size in bytes */ get byteLength() {
        return this._size;
    }
    /** Get the data cache buffer */ get buffer() {
        return this._cache;
    }
    /** Get all the uniform datas */ get uniforms() {
        return this._uniformMap;
    }
    /**
   * Sets the value of a structure member
   * @param name - Name of the member
   * @param value - Value to set
   */ set(name, value) {
        if (value !== undefined) {
            const view = this._uniformMap[name];
            if (view) {
                if (this._cache) {
                    if (typeof value === 'number') {
                        view[0] = value;
                    } else if (value?._v) {
                        view.set(value._v);
                    } else if (typeof value?.length === 'number') {
                        view.set(value.length > view.length ? value.subarray(0, view.length) : value);
                    } else {
                        throw new Error('invalid uniform value');
                    }
                } else {
                    const size = this._uniformPositions[name][1];
                    if (typeof value === 'number') {
                        view[0] = value;
                        this._buffer.bufferSubData(this._uniformPositions[name][0], view);
                    } else if (value['BYTES_PER_ELEMENT'] && size <= value['byteLength']) {
                        const arr = value;
                        this._buffer.bufferSubData(this._uniformPositions[name][0], arr, 0, size / arr.BYTES_PER_ELEMENT >> 0);
                    } else {
                        throw new Error('invalid uniform value');
                    }
                }
            } else {
                const proto = Object.getPrototypeOf(value);
                if (proto === Object.getPrototypeOf({})) {
                    this.setStruct(name, value);
                } else {
                    throw new Error('invalid uniform value');
                }
            }
        }
    }
    /** @internal */ setStruct(name, value) {
        for(const k in value){
            this.set(`${name}.${k}`, value[k]);
        }
    }
    /** @internal */ init(layout, offset, prefix) {
        for (const entry of layout.entries){
            if (entry.subLayout) {
                offset = this.init(entry.subLayout, offset, `${prefix}${entry.name}.`);
            } else {
                const name = `${prefix}${entry.name}`;
                if (this._uniformPositions[name]) {
                    throw new Error(`UniformBuffer(): duplicate uniform name: ${name}`);
                }
                if (entry.offset < offset || entry.byteSize < 0) {
                    throw new Error('UniformBuffer(): invalid layout');
                }
                this._uniformPositions[name] = [
                    entry.offset,
                    entry.byteSize
                ];
                let viewCtor = null;
                switch(entry.type){
                    case PBPrimitiveType.F32:
                        viewCtor = Float32Array;
                        break;
                    case PBPrimitiveType.U32:
                    case PBPrimitiveType.BOOL:
                        viewCtor = Uint32Array;
                        break;
                    case PBPrimitiveType.I32:
                        viewCtor = Int32Array;
                        break;
                    case PBPrimitiveType.U16:
                    case PBPrimitiveType.U16_NORM:
                    case PBPrimitiveType.F16:
                        viewCtor = Uint16Array;
                        break;
                    case PBPrimitiveType.I16:
                    case PBPrimitiveType.I16_NORM:
                        viewCtor = Int16Array;
                        break;
                    case PBPrimitiveType.U8:
                    case PBPrimitiveType.U8_NORM:
                        viewCtor = Uint8Array;
                        break;
                    case PBPrimitiveType.I8:
                    case PBPrimitiveType.I8_NORM:
                        viewCtor = Int8Array;
                        break;
                }
                if (!viewCtor) {
                    throw new Error(`UniformBuffer(): invalid data type for uniform: ${name}`);
                }
                if (entry.byteSize % viewCtor.BYTES_PER_ELEMENT) {
                    throw new Error(`UniformBuffer(): invalid byte size for uniform: ${name}`);
                }
                if (this._cache) {
                    this._uniformMap[name] = new viewCtor(this._cache, entry.offset, entry.byteSize / viewCtor.BYTES_PER_ELEMENT);
                } else {
                    this._uniformMap[name] = new viewCtor(1);
                }
                offset = entry.offset + entry.byteSize;
            }
        }
        return offset;
    }
}

export { ASTAddressOf, ASTArrayIndex, ASTAssignment, ASTBinaryFunc, ASTBreak, ASTCallFunction, ASTCast, ASTContinue, ASTDeclareVar, ASTDiscard, ASTDoWhile, ASTExpression, ASTFunction, ASTFunctionParameter, ASTGlobalScope, ASTHash, ASTIf, ASTLValue, ASTLValueArray, ASTLValueDeclare, ASTLValueHash, ASTLValueScalar, ASTNakedScope, ASTPrimitive, ASTRange, ASTReferenceOf, ASTReturn, ASTScalar, ASTScope, ASTSelect, ASTShaderExpConstructor, ASTStructDefine, ASTTouch, ASTUnaryFunc, ASTWhile, BaseDevice, CPUTimer, DeclareType, DrawText, Font, FontCanvas, GPUResourceUsageFlags, GlyphManager, MAX_BINDING_GROUPS, MAX_TEXCOORD_INDEX_COUNT, MAX_VERTEX_ATTRIBUTES, PBAddressSpace, PBAnyTypeInfo, PBArrayTypeInfo, PBAtomicI32TypeInfo, PBAtomicU32TypeInfo, PBBuiltinScope, PBDoWhileScope, PBForScope, PBFunctionScope, PBFunctionTypeInfo, PBGlobalScope, PBIfScope, PBInputScope, PBInsideFunctionScope, PBLocalScope, PBNakedScope, PBOutputScope, PBPointerTypeInfo, PBPrimitiveType, PBPrimitiveTypeInfo, PBReflection, PBSamplerAccessMode, PBSamplerTypeInfo, PBScope, PBShaderExp, PBStructTypeInfo, PBTextureType, PBTextureTypeInfo, PBTypeInfo, PBVoidTypeInfo, PBWhileScope, Pool, ProgramBuilder, Proxiable, ShaderAST, ShaderPrecisionType, ShaderType, StructuredBufferData, TextureAtlasManager, VERTEX_ATTRIB_BLEND_INDICES, VERTEX_ATTRIB_BLEND_WEIGHT, VERTEX_ATTRIB_DIFFUSE, VERTEX_ATTRIB_NORMAL, VERTEX_ATTRIB_POSITION, VERTEX_ATTRIB_TANGENT, VERTEX_ATTRIB_TEXCOORD0, VERTEX_ATTRIB_TEXCOORD1, VERTEX_ATTRIB_TEXCOORD2, VERTEX_ATTRIB_TEXCOORD3, VERTEX_ATTRIB_TEXCOORD4, VERTEX_ATTRIB_TEXCOORD5, VERTEX_ATTRIB_TEXCOORD6, VERTEX_ATTRIB_TEXCOORD7, VertexData, builtinVariables, encodePixel, encodePixelToArray, genDefaultName, genSamplerName, getBuiltinInputStructInstanceName, getBuiltinInputStructName, getBuiltinOutputStructInstanceName, getBuiltinOutputStructName, getBuiltinParamName, getTextureFormatBlockHeight, getTextureFormatBlockSize, getTextureFormatBlockWidth, getTextureSampleType, getVertexAttribByName, getVertexAttribFormat, getVertexAttribName, getVertexAttributeFormat, getVertexAttributeIndex, getVertexBufferAttribType, getVertexBufferAttribTypeBySemantic, getVertexBufferLength, getVertexBufferStride, getVertexFormatComponentCount, getVertexFormatSize, hasAlphaChannel, hasBlueChannel, hasDepthChannel, hasGreenChannel, hasRedChannel, hasStencilChannel, isCompressedTextureFormat, isFloatTextureFormat, isIntegerTextureFormat, isSRGBTextureFormat, isSignedTextureFormat, linearTextureFormatToSRGB, makeConstructor, makeVertexBufferType, matchVertexBuffer, semanticList, semanticToAttrib, typeAny, typeAtomicI32, typeAtomicU32, typeBVec2, typeBVec3, typeBVec4, typeBool, typeF16, typeF16Vec2, typeF16Vec3, typeF16Vec4, typeF32, typeF32Vec2, typeF32Vec3, typeF32Vec4, typeFrexpResult, typeFrexpResultVec2, typeFrexpResultVec3, typeFrexpResultVec4, typeI16, typeI16Vec2, typeI16Vec2_Norm, typeI16Vec3, typeI16Vec3_Norm, typeI16Vec4, typeI16Vec4_Norm, typeI16_Norm, typeI32, typeI32Vec2, typeI32Vec2_Norm, typeI32Vec3, typeI32Vec3_Norm, typeI32Vec4, typeI32Vec4_Norm, typeI32_Norm, typeI8, typeI8Vec2, typeI8Vec2_Norm, typeI8Vec3, typeI8Vec3_Norm, typeI8Vec4, typeI8Vec4_Norm, typeI8_Norm, typeITex1D, typeITex2D, typeITex2DArray, typeITex3D, typeITexCube, typeITexCubeArray, typeITexMultisampled2D, typeMat2, typeMat2x3, typeMat2x4, typeMat3, typeMat3x2, typeMat3x4, typeMat4, typeMat4x2, typeMat4x3, typeSampler, typeSamplerComparison, typeTex1D, typeTex2D, typeTex2DArray, typeTex3D, typeTexCube, typeTexCubeArray, typeTexDepth2D, typeTexDepth2DArray, typeTexDepthCube, typeTexDepthCubeArray, typeTexDepthMultisampled2D, typeTexExternal, typeTexMultisampled2D, typeTexStorage1D_bgra8unorm, typeTexStorage1D_r32float, typeTexStorage1D_r32sint, typeTexStorage1D_r32uint, typeTexStorage1D_rg32float, typeTexStorage1D_rg32sint, typeTexStorage1D_rg32uint, typeTexStorage1D_rgba16float, typeTexStorage1D_rgba16sint, typeTexStorage1D_rgba16uint, typeTexStorage1D_rgba32float, typeTexStorage1D_rgba32sint, typeTexStorage1D_rgba32uint, typeTexStorage1D_rgba8sint, typeTexStorage1D_rgba8snorm, typeTexStorage1D_rgba8uint, typeTexStorage1D_rgba8unorm, typeTexStorage2DArray_bgra8unorm, typeTexStorage2DArray_r32float, typeTexStorage2DArray_r32sint, typeTexStorage2DArray_r32uint, typeTexStorage2DArray_rg32float, typeTexStorage2DArray_rg32sint, typeTexStorage2DArray_rg32uint, typeTexStorage2DArray_rgba16float, typeTexStorage2DArray_rgba16sint, typeTexStorage2DArray_rgba16uint, typeTexStorage2DArray_rgba32float, typeTexStorage2DArray_rgba32sint, typeTexStorage2DArray_rgba32uint, typeTexStorage2DArray_rgba8sint, typeTexStorage2DArray_rgba8snorm, typeTexStorage2DArray_rgba8uint, typeTexStorage2DArray_rgba8unorm, typeTexStorage2D_bgra8unorm, typeTexStorage2D_r32float, typeTexStorage2D_r32sint, typeTexStorage2D_r32uint, typeTexStorage2D_rg32float, typeTexStorage2D_rg32sint, typeTexStorage2D_rg32uint, typeTexStorage2D_rgba16float, typeTexStorage2D_rgba16sint, typeTexStorage2D_rgba16uint, typeTexStorage2D_rgba32float, typeTexStorage2D_rgba32sint, typeTexStorage2D_rgba32uint, typeTexStorage2D_rgba8sint, typeTexStorage2D_rgba8snorm, typeTexStorage2D_rgba8uint, typeTexStorage2D_rgba8unorm, typeTexStorage3D_bgra8unorm, typeTexStorage3D_r32float, typeTexStorage3D_r32sint, typeTexStorage3D_r32uint, typeTexStorage3D_rg32float, typeTexStorage3D_rg32sint, typeTexStorage3D_rg32uint, typeTexStorage3D_rgba16float, typeTexStorage3D_rgba16sint, typeTexStorage3D_rgba16uint, typeTexStorage3D_rgba32float, typeTexStorage3D_rgba32sint, typeTexStorage3D_rgba32uint, typeTexStorage3D_rgba8sint, typeTexStorage3D_rgba8snorm, typeTexStorage3D_rgba8uint, typeTexStorage3D_rgba8unorm, typeU16, typeU16Vec2, typeU16Vec2_Norm, typeU16Vec3, typeU16Vec3_Norm, typeU16Vec4, typeU16Vec4_Norm, typeU16_Norm, typeU32, typeU32Vec2, typeU32Vec2_Norm, typeU32Vec3, typeU32Vec3_Norm, typeU32Vec4, typeU32Vec4_Norm, typeU32_Norm, typeU8, typeU8Vec2, typeU8Vec2_Norm, typeU8Vec3, typeU8Vec3_Norm, typeU8Vec4, typeU8Vec4_Norm, typeU8_Norm, typeUTex1D, typeUTex2D, typeUTex2DArray, typeUTex3D, typeUTexCube, typeUTexCubeArray, typeUTexMultisampled2D, typeVoid };
//# sourceMappingURL=zephyr3d_device.js.map
