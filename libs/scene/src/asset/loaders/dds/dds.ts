import type { TextureFormat, TextureMipmapLevelData, TextureMipmapData } from '@zephyr3d/device';
import type { Nullable, TypedArray } from '@zephyr3d/base';

const DDSHeaderSize = 31; // in DWORD
const DDSHeaderSizeExtended = 31 + 5; // in DWORD

const DDS_MAGIC = 0x20534444; // magic

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA = 0x2;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_CUBEMAP_POSITIVEX = 0x400;
const DDSCAPS2_CUBEMAP_NEGATIVEX = 0x800;
const DDSCAPS2_CUBEMAP_POSITIVEY = 0x1000;
const DDSCAPS2_CUBEMAP_NEGATIVEY = 0x2000;
const DDSCAPS2_CUBEMAP_POSITIVEZ = 0x4000;
const DDSCAPS2_CUBEMAP_NEGATIVEZ = 0x8000;
const DDS_CUBEMAP_ALLFACES =
  DDSCAPS2_CUBEMAP |
  DDSCAPS2_CUBEMAP_POSITIVEX |
  DDSCAPS2_CUBEMAP_NEGATIVEX |
  DDSCAPS2_CUBEMAP_POSITIVEY |
  DDSCAPS2_CUBEMAP_NEGATIVEY |
  DDSCAPS2_CUBEMAP_POSITIVEZ |
  DDSCAPS2_CUBEMAP_NEGATIVEZ;

const DDSCAPS2_VOLUME = 0x200000;

enum DX10ResourceDimension {
  DDS_DIMENSION_TEXTURE1D = 2,
  DDS_DIMENSION_TEXTURE2D = 3,
  DDS_DIMENSION_TEXTURE3D = 4
}

enum DXGIFormat {
  DXGI_FORMAT_RGBA32F = 2,
  DXGI_FORMAT_RGBA32UI = 3,
  DXGI_FORMAT_RGBA32I = 4,
  DXGI_FORMAT_RGB32F = 6,
  DXGI_FORMAT_RGB32UI = 7,
  DXGI_FORMAT_RGB32I = 8,
  DXGI_FORMAT_RGBA16F = 10,
  DXGI_FORMAT_RGBA16UI = 12,
  DXGI_FORMAT_RGBA16I = 14,
  DXGI_FORMAT_RG32F = 16,
  DXGI_FORMAT_RG32UI = 17,
  DXGI_FORMAT_RG32I = 18,
  DXGI_FORMAT_RGBA8 = 28,
  DXGI_FORMAT_RGBA8_SRGB = 29,
  DXGI_FORMAT_RGBA8UI = 30,
  DXGI_FORMAT_RGBA8I = 32,
  DXGI_FORMAT_RG16F = 34,
  DXGI_FORMAT_RG16UI = 36,
  DXGI_FORMAT_RG16I = 38,
  DXGI_FORMAT_R32F = 41,
  DXGI_FORMAT_R32UI = 42,
  DXGI_FORMAT_R32I = 43,
  DXGI_FORMAT_R16F = 54,
  DXGI_FORMAT_R16UI = 57,
  DXGI_FORMAT_R16I = 59,
  DXGI_FORMAT_BGR565 = 85,
  DXGI_FORMAT_BGRA5551 = 86,
  DXGI_FORMAT_BGRA8 = 87,
  DXGI_FORMAT_BGRX8 = 88,
  DXGI_FORMAT_BGRA8_SRGB = 91,
  DXGI_FORMAT_BGRX8_SRGB = 93
}

function FourCCToInt32(value: string) {
  return (
    value.codePointAt(0)! +
    (value.codePointAt(1)! << 8) +
    (value.codePointAt(2)! << 16) +
    (value.codePointAt(3)! << 24)
  );
}

function Int32ToFourCC(value: number) {
  return String.fromCodePoint(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

interface DDSPixelFormat {
  dwFlags: number;
  dwFourCC?: number;
  dwRGBBitCount?: number;
  dwRBitMask?: number;
  dwGBitMask?: number;
  dwBBitMask?: number;
  dwABitMask?: number;
}

interface DDSHeader {
  dwSize: number; // must be DDSHeaderSize * 4 = 124
  dwFlags: number;
  dwHeight: number;
  dwWidth: number;
  dwPitchOrLinearSize: number;
  dwDepth: number;
  dwMipmapCount: number;
  ddsPixelFormat: DDSPixelFormat;
  dwCaps: number;
  dwCaps2: number;
  dwCaps3: number;
  dwCaps4: number;
  ddsHeaderDX10: DDSHeaderDX10;
  dataOffset: number;
}

interface DDSHeaderDX10 {
  dxgiFormat: DXGIFormat;
  dimension: DX10ResourceDimension;
  miscFlag: number;
  arraySize: number;
}

function loadDDSHeader(dds: ArrayBuffer, offset: number): Nullable<DDSHeader> {
  const ddsHeader = {} as DDSHeader;
  const header = new Uint32Array(dds, offset, DDSHeaderSize + 1);
  const magic = header[0];
  if (magic !== DDS_MAGIC) {
    console.error('Invalid DDS magic');
    return null;
  }
  ddsHeader.dwSize = header[1];
  if (ddsHeader.dwSize !== 124) {
    console.error('Invalid DDS header size');
    return null;
  }
  ddsHeader.dataOffset = ddsHeader.dwSize + 4;
  ddsHeader.dwFlags = header[2];
  ddsHeader.dwHeight = header[3];
  ddsHeader.dwWidth = header[4];
  ddsHeader.dwPitchOrLinearSize = header[5];
  ddsHeader.dwDepth = header[6];
  ddsHeader.dwMipmapCount = header[7];
  ddsHeader.ddsPixelFormat = {} as DDSPixelFormat;
  ddsHeader.ddsPixelFormat.dwFlags = header[20];
  ddsHeader.ddsPixelFormat.dwFourCC = header[21];
  ddsHeader.ddsPixelFormat.dwRGBBitCount = header[22];
  ddsHeader.ddsPixelFormat.dwRBitMask = header[23];
  ddsHeader.ddsPixelFormat.dwGBitMask = header[24];
  ddsHeader.ddsPixelFormat.dwBBitMask = header[25];
  ddsHeader.ddsPixelFormat.dwABitMask = header[26];
  ddsHeader.dwCaps = header[27];
  ddsHeader.dwCaps2 = header[28];
  ddsHeader.dwCaps3 = header[29];
  ddsHeader.dwCaps4 = header[30];
  if (Int32ToFourCC(ddsHeader.ddsPixelFormat.dwFourCC) === 'DX10') {
    const headerEx = new Uint32Array(dds, offset, DDSHeaderSizeExtended + 1);
    ddsHeader.ddsHeaderDX10 = {} as DDSHeaderDX10;
    ddsHeader.ddsHeaderDX10.dxgiFormat = headerEx[32];
    ddsHeader.ddsPixelFormat.dwFourCC = ddsHeader.ddsHeaderDX10.dxgiFormat;
    ddsHeader.ddsHeaderDX10.dimension = headerEx[33];
    ddsHeader.ddsHeaderDX10.miscFlag = headerEx[34];
    ddsHeader.ddsHeaderDX10.arraySize = headerEx[35];
    ddsHeader.dataOffset += 5 * 4;
  }
  return ddsHeader;
}

interface DDSMetaData extends TextureMipmapData {
  dataOffset: number;
}

const enum DDSConvert {
  RGB_SWIZZLE = 1 << 0,
  ALPHA_ONE = 11 << 1
}

const dxgiFormatMap: Record<number, TextureFormat> = {
  [2]: 'rgba32f',
  [3]: 'rgba32ui',
  [4]: 'rgba32i',
  [10]: 'rgba16f',
  [12]: 'rgba16ui',
  [14]: 'rgba16i',
  [16]: 'rg32f',
  [17]: 'rg32ui',
  [18]: 'rg32i',
  [28]: 'rgba8unorm',
  [29]: 'rgba8unorm-srgb',
  [30]: 'rgba8ui',
  [31]: 'rgba8snorm',
  [32]: 'rgba8i',
  [34]: 'rg16f',
  [36]: 'rg16ui',
  [38]: 'rg16i',
  [41]: 'r32f',
  [42]: 'r32ui',
  [43]: 'r32i',
  [49]: 'rg8unorm',
  [50]: 'rg8ui',
  [51]: 'rg8snorm',
  [52]: 'rg8i',
  [54]: 'r16f',
  [57]: 'r16ui',
  [59]: 'r16i',
  [61]: 'r8unorm',
  [62]: 'r8ui',
  [63]: 'r8snorm',
  [64]: 'r8i',
  [71]: 'dxt1',
  [72]: 'dxt1-srgb',
  [74]: 'dxt3',
  [75]: 'dxt3-srgb',
  [77]: 'dxt5',
  [78]: 'dxt5-srgb',
  [80]: 'bc4',
  [81]: 'bc4-signed',
  [83]: 'bc5',
  [84]: 'bc5-signed',
  [95]: 'bc6h',
  [96]: 'bc6h-signed',
  [98]: 'bc7',
  [99]: 'bc7-srgb'
};

const legacyDDSMap: {
  format: TextureFormat;
  convertFlags: number;
  pf: DDSPixelFormat;
}[] = [
  {
    format: 'dxt1',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('DXT1')
    }
  },
  {
    format: 'dxt3',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('DXT3')
    }
  },
  {
    format: 'dxt5',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('DXT5')
    }
  },
  {
    format: 'bc4',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('ATI1')
    }
  },
  {
    format: 'bc4',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('BC4U')
    }
  },
  {
    format: 'bc4-signed',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('BC4S')
    }
  },
  {
    format: 'bc5',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('ATI2')
    }
  },
  {
    format: 'bc5',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('ATI2')
    }
  },
  {
    format: 'bc5',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('BC5U')
    }
  },
  {
    format: 'bc5-signed',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: FourCCToInt32('BC5S')
    }
  },
  {
    format: 'bgra8unorm',
    convertFlags: DDSConvert.RGB_SWIZZLE,
    pf: {
      dwFlags: DDPF_RGB | DDPF_ALPHAPIXELS,
      dwRGBBitCount: 32,
      dwRBitMask: 0x00ff0000,
      dwGBitMask: 0x0000ff00,
      dwBBitMask: 0x000000ff,
      dwABitMask: 0xff000000
    }
  },
  {
    format: 'bgra8unorm',
    convertFlags: DDSConvert.RGB_SWIZZLE | DDSConvert.ALPHA_ONE,
    pf: {
      dwFlags: DDPF_RGB,
      dwRGBBitCount: 32,
      dwRBitMask: 0x00ff0000,
      dwGBitMask: 0x0000ff00,
      dwBBitMask: 0x000000ff
    }
  },
  {
    format: 'rgba8unorm',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_RGB | DDPF_ALPHAPIXELS,
      dwRGBBitCount: 32,
      dwRBitMask: 0x000000ff,
      dwGBitMask: 0x0000ff00,
      dwBBitMask: 0x00ff0000,
      dwABitMask: 0xff000000
    }
  },
  {
    format: 'rgba8unorm',
    convertFlags: DDSConvert.ALPHA_ONE,
    pf: {
      dwFlags: DDPF_RGB,
      dwRGBBitCount: 32,
      dwRBitMask: 0x000000ff,
      dwGBitMask: 0x0000ff00,
      dwBBitMask: 0x00ff0000
    }
  },
  {
    format: 'r16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 111
    }
  },
  {
    format: 'r16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_R16F
    }
  },
  {
    format: 'rg16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 112
    }
  },
  {
    format: 'rg16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_RG16F
    }
  },
  {
    format: 'rgba16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 113
    }
  },
  {
    format: 'rgba16f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_RGBA16F
    }
  },
  {
    format: 'r32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 114
    }
  },
  {
    format: 'r32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_R32F
    }
  },
  {
    format: 'rg32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 115
    }
  },
  {
    format: 'rg32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_RG32F
    }
  },
  {
    format: 'rgba32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: 116
    }
  },
  {
    format: 'rgba32f',
    convertFlags: 0,
    pf: {
      dwFlags: DDPF_FOURCC,
      dwFourCC: DXGIFormat.DXGI_FORMAT_RGBA32F
    }
  }
];

function getTextureFormat(header: DDSHeader) {
  if (header.ddsHeaderDX10) {
    const format = header.ddsHeaderDX10 ? dxgiFormatMap[header.ddsHeaderDX10.dxgiFormat] : null;
    if (format) {
      return format;
    }
  }
  const pf = header.ddsPixelFormat;
  const flags = pf.dwFlags;
  let index;
  for (index = 0; index < legacyDDSMap.length; index++) {
    const entry = legacyDDSMap[index];
    if (flags & DDPF_FOURCC && entry.pf.dwFlags & DDPF_FOURCC) {
      if (pf.dwFourCC === entry.pf.dwFourCC) {
        break;
      }
    } else if (flags === entry.pf.dwFlags) {
      if (flags & DDPF_ALPHA) {
        if (pf.dwRGBBitCount === entry.pf.dwRGBBitCount && pf.dwABitMask === entry.pf.dwABitMask) {
          break;
        }
      } else if (flags & DDPF_LUMINANCE) {
        if (pf.dwRGBBitCount === entry.pf.dwRGBBitCount && pf.dwRBitMask === entry.pf.dwRBitMask) {
          if (pf.dwABitMask === entry.pf.dwABitMask || !(flags & DDPF_ALPHAPIXELS)) {
            break;
          }
        }
      } else if (pf.dwRGBBitCount === entry.pf.dwRGBBitCount) {
        if (
          pf.dwRBitMask === entry.pf.dwRBitMask &&
          pf.dwGBitMask === entry.pf.dwGBitMask &&
          pf.dwBBitMask === entry.pf.dwBBitMask
        ) {
          if (pf.dwABitMask === entry.pf.dwABitMask || !(flags & DDPF_ALPHAPIXELS)) {
            break;
          }
        }
      }
    }
  }
  if (index === legacyDDSMap.length) {
    return null;
  }
  return legacyDDSMap[index].format;
}

function getMetaDataFromHeader(header: DDSHeader, metaData?: DDSMetaData): Nullable<DDSMetaData> {
  metaData = metaData || ({} as DDSMetaData);
  const fmt = getTextureFormat(header);
  if (!fmt) {
    return null;
  }
  metaData.format = fmt;
  metaData.isCompressed =
    metaData.format === 'dxt1' ||
    metaData.format === 'dxt3' ||
    metaData.format === 'dxt5' ||
    metaData.format === 'bc4' ||
    metaData.format === 'bc4-signed' ||
    metaData.format === 'bc5' ||
    metaData.format === 'bc5-signed' ||
    metaData.format === 'bc6h' ||
    metaData.format === 'bc6h-signed' ||
    metaData.format === 'bc7' ||
    metaData.format === 'bc7-srgb';
  metaData.dataOffset = header.ddsHeaderDX10 ? 37 * 4 : 32 * 4;
  metaData.width = header.dwWidth;
  metaData.height = header.dwHeight;
  metaData.depth = 1;
  metaData.mipLevels = header.dwMipmapCount || 1;
  metaData.arraySize = header.ddsHeaderDX10 ? header.ddsHeaderDX10.arraySize : 1;
  metaData.isCubemap = metaData.isVolume = false;
  if (header.dwCaps2 & DDS_CUBEMAP_ALLFACES) {
    metaData.isCubemap = true;
    metaData.arraySize *= 6;
  } else if (header.dwCaps2 & DDSCAPS2_VOLUME) {
    metaData.isVolume = true;
    metaData.depth = header.dwDepth;
  } else if (header.ddsHeaderDX10 && header.ddsHeaderDX10.arraySize > 1) {
    metaData.isArray = true;
    metaData.depth = header.ddsHeaderDX10.arraySize;
  }
  return metaData;
}

function getMipmapData(
  dds: ArrayBuffer,
  width: number,
  height: number,
  format: TextureFormat,
  dataOffset: number
): Nullable<TypedArray> {
  switch (format) {
    case 'r16f':
      return new Uint16Array(dds, dataOffset, width * height);
    case 'rg16f':
      return new Uint16Array(dds, dataOffset, width * height * 2);
    case 'r32f':
      return new Float32Array(dds, dataOffset, width * height);
    case 'rgba8unorm':
    case 'bgra8unorm':
      return new Uint8Array(dds, dataOffset, width * height * 4);
    case 'rgba16f':
      return new Uint16Array(dds, dataOffset, width * height * 4);
    case 'rg32f':
      return new Float32Array(dds, dataOffset, width * height * 2);
    case 'rgba32f':
      return new Float32Array(dds, dataOffset, width * height * 4);
    case 'dxt1':
    case 'bc4':
    case 'bc4-signed':
      return new Uint8Array(dds, dataOffset, (((Math.max(4, width) / 4) * Math.max(4, height)) / 4) * 8);
    case 'dxt3':
    case 'dxt5':
    case 'bc5':
    case 'bc5-signed':
    case 'bc6h':
    case 'bc6h-signed':
    case 'bc7':
    case 'bc7-srgb':
      return new Uint8Array(dds, dataOffset, (((Math.max(4, width) / 4) * Math.max(4, height)) / 4) * 16);
    default:
      return null;
  }
}

/** @internal */
export function getDDSMipLevelsInfo(dds: ArrayBuffer, offset: number): Nullable<DDSMetaData> {
  const ddsHeader = loadDDSHeader(dds, offset);
  if (!ddsHeader) {
    return null;
  }
  const ddsLevelsInfo = {} as DDSMetaData;
  getMetaDataFromHeader(ddsHeader, ddsLevelsInfo);
  ddsLevelsInfo.mipDatas = [];
  let dataOffset = ddsLevelsInfo.dataOffset;
  for (let i = 0; i < ddsLevelsInfo.arraySize; i++) {
    const mipDatas: TextureMipmapLevelData[] = [];
    let width = ddsLevelsInfo.width;
    let height = ddsLevelsInfo.height;
    for (let mip = 0; mip < ddsLevelsInfo.mipLevels; mip++) {
      const mipData = getMipmapData(dds, width, height, ddsLevelsInfo.format, dataOffset + offset);
      if (!mipData) {
        return null;
      }
      mipDatas.push({ data: mipData, width: width, height: height });
      dataOffset += mipData.byteLength;
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
    ddsLevelsInfo.mipDatas.push(mipDatas);
  }
  return ddsLevelsInfo;
}
