// Encodes source images to Basis Universal KTX2 for the derived texture cache.
//
// The setter sequence follows applyEncodeDTO() in basis_universal's own web tool
// (webgl/ktx2_studio/encode_dto_apply.js, tag v2_50): container options, colour
// and transfer, source image, format, mipmaps, then the unified quality/effort
// call last because it overrides codec-specific settings.

interface BasisEncoderInstance {
  setCreateKTX2File(v: boolean): void;
  setKTX2UASTCSupercompression(v: boolean): void;
  setPerceptual(v: boolean): void;
  setKTX2AndBasisSRGBTransferFunc(v: boolean): void;
  setMipSRGB(v: boolean): void;
  setSliceSourceImage(
    slice: number,
    data: Uint8Array,
    width: number,
    height: number,
    imgType: number
  ): boolean;
  setFormatMode(format: number): void;
  setMipGen(v: boolean): void;
  setMipRenormalize(v: boolean): void;
  setFormatModeAndQualityEffort(format: number, quality: number, effort: number, setDefaults: boolean): void;
  encode(dst: Uint8Array): number;
  delete(): void;
}

interface BasisModule {
  initializeBasis(): void;
  BasisEncoder: new () => BasisEncoderInstance;
}

export interface EncodeRequest {
  type: 'encode';
  id: number;
  source: ArrayBuffer;
  mimeType: string;
  encoding: 'etc1s' | 'uastc';
  quality: 'low' | 'normal' | 'high';
  srgb: boolean;
  normalMap: boolean;
  mipmaps: boolean;
  maxSize: number;
}

export interface EncodeResponse {
  type: 'result' | 'error';
  id: number;
  data?: ArrayBuffer;
  width?: number;
  height?: number;
  message?: string;
}

// basis_tex_format in transcoder/basisu_file_headers.h
const FORMAT_ETC1S = 0;
const FORMAT_UASTC_LDR_4X4 = 1;
// ldr_image_type in webgl/transcoder/basis_wrappers.cpp
const IMAGE_RGBA32 = 0;
const IMAGE_PNG = 1;
const IMAGE_JPG = 2;
// Unified quality [1,100], see basis_compressor_params::set_format_mode_and_quality_effort()
// in encoder/basisu_comp.cpp. -1 is only safe for UASTC, where it means "no RDO";
// for ETC1S it leaves the quality level at -1 with no codebook sizes set, and
// basisu_frontend::init() fails. The basisu tool fills in 50 there, its documented
// ETC1S default, so the normal setting passes that explicitly.
const QUALITY: Record<EncodeRequest['encoding'], Record<EncodeRequest['quality'], number>> = {
  etc1s: { low: 25, normal: 50, high: 80 },
  uastc: { low: 25, normal: -1, high: -1 }
};

let ready: Promise<BasisModule> | null = null;
// The encoder reports progress and errors on stdout; keep the tail so a failure
// can say why instead of flooding the console on every success
const encoderOutput: string[] = [];
function captureOutput(text: string) {
  encoderOutput.push(text);
  if (encoderOutput.length > 200) {
    encoderOutput.shift();
  }
}

function initialize(scriptUrl: string, wasmUrl: string) {
  ready = (async () => {
    const [jsResponse, wasmResponse] = await Promise.all([fetch(scriptUrl), fetch(wasmUrl)]);
    if (!jsResponse.ok || !wasmResponse.ok) {
      throw new Error(`Failed to load the Basis encoder (HTTP ${jsResponse.status}/${wasmResponse.status})`);
    }
    const [source, wasmBinary] = await Promise.all([jsResponse.text(), wasmResponse.arrayBuffer()]);
    // A classic script declaring the BASIS factory; a module worker cannot importScripts() it
    const factory = new Function(`${source}\nreturn BASIS;`)() as (
      args: Record<string, unknown>
    ) => Promise<BasisModule>;
    const module = await factory({ wasmBinary, print: captureOutput, printErr: captureOutput });
    module.initializeBasis();
    return module;
  })();
  // Reported per request by encode(); keep the worker from logging it as unhandled
  ready.catch(() => {});
}

function roundToBlock(x: number) {
  return Math.max(4, Math.round(x / 4) * 4);
}

/**
 * Prepares the slice handed to the encoder. PNG and JPEG go in as files so the
 * encoder's own decoders read them byte-exactly; everything else, and anything
 * that must be resized, is decoded by the browser into RGBA.
 *
 * Resizing also snaps both sides to a multiple of four: block-compressed textures
 * need block-aligned base dimensions on every backend, and the runtime loader
 * falls back to uncompressed RGBA for files that are not.
 */
async function prepareSource(req: EncodeRequest) {
  const blob = new Blob([req.source], { type: req.mimeType });
  // No colour management or premultiplication: the data is encoded, not displayed
  const decodeOptions: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const probe = await createImageBitmap(blob, decodeOptions);
  const { width, height } = probe;
  const scale = req.maxSize > 0 ? Math.min(1, req.maxSize / Math.max(width, height)) : 1;
  const targetWidth = scale < 1 || width % 4 !== 0 ? roundToBlock(width * scale) : width;
  const targetHeight = scale < 1 || height % 4 !== 0 ? roundToBlock(height * scale) : height;
  const resize = targetWidth !== width || targetHeight !== height;
  const imgType = req.mimeType === 'image/png' ? IMAGE_PNG : req.mimeType === 'image/jpeg' ? IMAGE_JPG : -1;
  if (!resize && imgType >= 0) {
    probe.close();
    return {
      data: new Uint8Array(req.source),
      width: 0,
      height: 0,
      imgType,
      outWidth: width,
      outHeight: height
    };
  }
  probe.close();
  const bitmap = await createImageBitmap(blob, {
    ...decodeOptions,
    resizeWidth: targetWidth,
    resizeHeight: targetHeight,
    resizeQuality: 'high'
  });
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  return {
    data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    width: targetWidth,
    height: targetHeight,
    imgType: IMAGE_RGBA32,
    outWidth: targetWidth,
    outHeight: targetHeight
  };
}

async function encode(req: EncodeRequest): Promise<EncodeResponse> {
  if (!ready) {
    throw new Error('Basis encoder worker was not initialized');
  }
  const module = await ready;
  const src = await prepareSource(req);
  const format = req.encoding === 'uastc' ? FORMAT_UASTC_LDR_4X4 : FORMAT_ETC1S;
  const enc = new module.BasisEncoder();
  encoderOutput.length = 0;
  try {
    enc.setCreateKTX2File(true);
    enc.setKTX2UASTCSupercompression(req.encoding === 'uastc');
    enc.setPerceptual(req.srgb);
    enc.setKTX2AndBasisSRGBTransferFunc(req.srgb);
    enc.setMipSRGB(req.srgb);
    if (!enc.setSliceSourceImage(0, src.data, src.width, src.height, src.imgType)) {
      throw new Error('The encoder could not read the source image');
    }
    enc.setFormatMode(format);
    enc.setMipGen(req.mipmaps);
    enc.setMipRenormalize(req.normalMap);
    enc.setFormatModeAndQualityEffort(format, QUALITY[req.encoding][req.quality], -1, true);
    // No size query exists; a full mip chain of uncompressed RGBA is a safe upper bound
    const out = new Uint8Array(Math.max(1 << 20, src.outWidth * src.outHeight * 8));
    const length = enc.encode(out);
    if (!length) {
      const errors = encoderOutput.filter((line) => /error|fail/i.test(line));
      throw new Error(`Basis encoding failed${errors.length ? `: ${errors.join('; ')}` : ''}`);
    }
    return {
      type: 'result',
      id: req.id,
      data: out.slice(0, length).buffer,
      width: src.outWidth,
      height: src.outHeight
    };
  } finally {
    enc.delete();
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    initialize(msg.scriptUrl, msg.wasmUrl);
  } else if (msg.type === 'encode') {
    encode(msg as EncodeRequest).then(
      (res) => (self as unknown as Worker).postMessage(res, res.data ? [res.data] : []),
      (err) =>
        (self as unknown as Worker).postMessage({
          type: 'error',
          id: msg.id,
          message: String(err?.message ?? err)
        } as EncodeResponse)
    );
  }
};
