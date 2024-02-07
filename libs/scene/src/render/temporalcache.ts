import type { BaseTexture, FrameBuffer, TextureCreationOptions, TextureFormat, TextureType } from "@zephyr3d/device";
import { Application } from "../app";

/**
 * Temporal framebuffer cache
 *
 * @internal
 */
export class TemporalCache {
  static _ownDepthTextures: Set<BaseTexture> = new Set();
  static _variantWidth = 0;
  static _variantHeight = 0;
  static _releaseFuncs: Map<FrameBuffer, (fb: FrameBuffer) => void> = new Map();
  static _cachedFrameBuffers: Record<string, Map<BaseTexture, Record<string, FrameBuffer[]> > > = {};
  static getFramebufferFixedSize(width: number, height: number, numLayers: number, colorFmt: TextureFormat, depthFmt: TextureFormat, colorType: TextureType, depthType: TextureType, mipmapping: boolean, sampleCount = 1) {
    return this.getFramebuffer(width, height, numLayers, colorFmt, depthFmt, colorType, depthType, mipmapping, false, sampleCount);
  }
  static getFramebufferVariantSize(width: number, height: number, numLayers: number, colorFmt: TextureFormat, depthFmt: TextureFormat, colorType: TextureType, depthType: TextureType, mipmapping: boolean, sampleCount = 1) {
    return this.getFramebuffer(width, height, numLayers, colorFmt, depthFmt, colorType, depthType, mipmapping, true, sampleCount);
  }
  static getFramebufferFixedSizeWithDepth(depthTex: BaseTexture, numLayers: number, colorFmt: TextureFormat, colorType: TextureType, mipmapping: boolean, sampleCount = 1) {
    return this.getFramebufferWithDepth(depthTex, numLayers, colorFmt, colorType, mipmapping, false, sampleCount);
  }
  static getFramebufferVariantSizeWithDepth(depthTex: BaseTexture, numLayers: number, colorFmt: TextureFormat, colorType: TextureType, mipmapping: boolean, sampleCount = 1) {
    return this.getFramebufferWithDepth(depthTex, numLayers, colorFmt, colorType, mipmapping, true, sampleCount);
  }
  static getFramebuffer(width: number, height: number, numLayers: number, colorFmt: TextureFormat, depthFmt: TextureFormat, colorType: TextureType, depthType: TextureType, mipmapping: boolean, variant: boolean, sampleCount: number): FrameBuffer {
    if (variant && (width !== this._variantWidth || height !== this._variantHeight)) {
      this.purgeVariantFramebuffers();
      this._variantWidth = width;
      this._variantHeight = height;
    }
    if (colorType !== '2darray' && depthType !== '2darray') {
      numLayers = 1;
    }
    const device = Application.instance.device;
    if (device.type === 'webgl') {
      sampleCount = 1
    }
    const sizeHash = variant ? '' : `${width}x${height}`;
    const fmtHash = `${colorFmt ?? ''}:${depthFmt ?? ''}:${colorFmt ? colorType : ''}:${numLayers}:${depthFmt ? depthType : ''}:${colorFmt && mipmapping ? 1 : 0}:${sampleCount}`;
    const sizedFrameBuffers = this._cachedFrameBuffers[sizeHash];
    const fbList = sizedFrameBuffers?.get(null)?.[fmtHash];
    let fb: FrameBuffer = null;
    if (!fbList || fbList.length === 0) {
      let colorTex: BaseTexture = null;
      const opt: TextureCreationOptions = mipmapping ? {} : { samplerOptions: { mipFilter: 'none' } };
      if (colorFmt) {
        switch(colorType) {
          case '2d':
            colorTex = device.createTexture2D(colorFmt, width, height, opt);
            break;
          case '2darray':
            colorTex = device.createTexture2DArray(colorFmt, width, height, numLayers, opt);
            break;
          case 'cube':
            colorTex = device.createCubeTexture(colorFmt, width, opt);
            break;
        }
      }
      let depthTex: BaseTexture = null;
      if (depthFmt) {
        switch(depthType) {
          case '2d':
            depthTex = device.createTexture2D(depthFmt, width, height);
            break;
          case '2darray':
            depthTex = device.createTexture2DArray(depthFmt, width, height, numLayers);
            break;
          case 'cube':
            depthTex = device.createCubeTexture(depthFmt, width);
            break;
        }
      }
      fb = device.createFrameBuffer(colorTex ? [colorTex] : [], depthTex, {
        sampleCount,
        ignoreDepthStencil: false
      });
      this._ownDepthTextures.add(depthTex);
    } else {
      fb = fbList.pop();
    }
    this._releaseFuncs.set(fb, variant ? this.releaseWithoutDepthTexVariantSize : this.releaseWithoutDepthTexFixedSize);
    return fb;
  }
  static getFramebufferWithDepth(depth: BaseTexture, numLayers: number, colorFmt: TextureFormat, colorType: TextureType, mipmapping: boolean, variant: boolean, sampleCount: number): FrameBuffer {
    if (variant && (depth.width !== this._variantWidth || depth.height !== this._variantHeight)) {
      this.purgeVariantFramebuffers();
      this._variantWidth = depth.width;
      this._variantHeight = depth.height;
    }
    if (!colorFmt || colorType !== '2darray') {
      numLayers = 1;
    }
    const device = Application.instance.device;
    if (device.type === 'webgl') {
      sampleCount = 1;
    }
    const sizeHash = variant ? '' : `${depth.width}x${depth.height}`;
    const fmtHash = `${colorFmt ?? ''}:${depth.format}:${colorFmt ? colorType : ''}:${numLayers}:${depth.target}:${colorFmt && mipmapping ? 1 : 0}:${sampleCount}`;
    const sizedFrameBuffers = this._cachedFrameBuffers[sizeHash];
    const fbList = sizedFrameBuffers?.get(depth)?.[fmtHash];
    let fb: FrameBuffer = null;
    if (!fbList || fbList.length === 0) {
      let colorTex: BaseTexture = null;
      const opt: TextureCreationOptions = mipmapping ? {} : { samplerOptions: { mipFilter: 'none' } };
      if (colorFmt) {
        switch(colorType) {
          case '2d':
            colorTex = device.createTexture2D(colorFmt, depth.width, depth.height, opt);
            break;
          case '2darray':
            colorTex = device.createTexture2DArray(colorFmt, depth.width, depth.height, numLayers, opt);
            break;
          case 'cube':
            colorTex = device.createCubeTexture(colorFmt, depth.width, opt);
            break;
        }
      }
      fb = device.createFrameBuffer([colorTex], depth, {
        sampleCount,
        ignoreDepthStencil: false
      });
      depth.on('disposed', () => {
        const sizedFrameBuffers = this._cachedFrameBuffers[sizeHash];
        const entry = sizedFrameBuffers?.get(depth);
        if (entry) {
          for (const k in entry) {
            const index = entry[k].indexOf(fb);
            if (index >= 0) {
              entry[k].splice(index, 1);
              if (entry[k].length === 0) {
                delete entry[k];
              }
            }
          }
          if (Object.getOwnPropertyNames(entry).length === 0) {
            sizedFrameBuffers.delete(depth);
          }
        }
        fb.getColorAttachments()[0]?.dispose();
        fb.dispose();
      });
    } else {
      fb = fbList.pop();
    }
    this._releaseFuncs.set(fb, variant ? this.releaseWithDepthTexVariantSize : this.releaseWithDepthTexFixedSize);
    return fb;
  }
  static releaseFramebuffer(fb: FrameBuffer) {
    const releaseFunc = this._releaseFuncs.get(fb);
    if (releaseFunc) {
      releaseFunc.call(this, fb);
      this._releaseFuncs.delete(fb);
    }
  }
  private static releaseWithDepthTexFixedSize(fb: FrameBuffer) {
    this.releaseFrameBufferInternal(fb, fb.getDepthAttachment(), true);
  }
  private static releaseWithDepthTexVariantSize(fb: FrameBuffer) {
    this.releaseFrameBufferInternal(fb, fb.getDepthAttachment(), false);
  }
  private static releaseWithoutDepthTexFixedSize(fb: FrameBuffer) {
    this.releaseFrameBufferInternal(fb, null, true);
  }
  private static releaseWithoutDepthTexVariantSize(fb: FrameBuffer) {
    this.releaseFrameBufferInternal(fb, null, false);
  }
  private static releaseFrameBufferInternal(fb: FrameBuffer, withDepthTex: BaseTexture, withSize: boolean) {
    const tex = fb.getDepthAttachment() ?? fb.getColorAttachments()[0];
    const sizeHash = withSize ? `${tex.width}x${tex.height}` : '';
    let variantSizeFrameBuffers = this._cachedFrameBuffers[sizeHash];
    if (!variantSizeFrameBuffers) {
      variantSizeFrameBuffers = new Map();
      this._cachedFrameBuffers[sizeHash] = variantSizeFrameBuffers;
    }
    const colorTex = fb.getColorAttachments()[0];
    const depthTex = fb.getDepthAttachment();
    const numLayers = colorTex?.isTexture2DArray() ? colorTex.depth : depthTex?.isTexture2DArray() ? depthTex.depth : 1;
    const hash = `${colorTex?.format ?? ''}:${depthTex?.format ?? ''}:${colorTex ? colorTex.target : ''}:${numLayers}:${depthTex ? depthTex.target : ''}:${colorTex?.mipLevelCount > 1 ? 1 : 0}:${fb.getSampleCount()}`;
    let entry = variantSizeFrameBuffers.get(withDepthTex);
    if (!entry) {
      entry = {};
      variantSizeFrameBuffers.set(withDepthTex, entry);
    }
    let fblist = entry[hash];
    if (!fblist) {
      fblist = [];
      entry[hash] = fblist;
    }
    fblist.push(fb);
  }
  private static purgeVariantFramebuffers() {
    const variantSizeFrameBuffers = this._cachedFrameBuffers[''];
    variantSizeFrameBuffers?.forEach((val, key) => {
      for (const k in val) {
        val[k].forEach(fb => {
          fb.getColorAttachments()[0].dispose();
          fb.dispose();
        });
      }
      if (this._ownDepthTextures.has(key)) {
        this._ownDepthTextures.delete(key);
        key?.dispose();
      }
    });
    variantSizeFrameBuffers?.clear();
  }
}
