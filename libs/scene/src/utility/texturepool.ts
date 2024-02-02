import { BaseTexture, FrameBuffer, TextureFormat } from "@zephyr3d/device";
import { Application } from "../app";

export class TexturePool {
  private static _textures: Record<string, BaseTexture[]> = {};
  private static _framebuffers: Record<string, FrameBuffer[]> = {};
  static fetchFrameBuffer(format: TextureFormat, depthFormat: TextureFormat, width: number, height: number, noMipmap: boolean) {
    const hash = `${format}:${depthFormat??''}:${width}:${height}:${noMipmap?1:0}`;
    let fblist = this._framebuffers[hash];
    if (fblist?.length > 0) {
      const fb = fblist.shift();
      if (fblist.length === 0) {
        delete this._textures[hash];
      }
      return fb;
    }
    const device = Application.instance.device;
    const tex = device.createTexture2D(format, width, height, {
      noMipmap: !!noMipmap
    });
    const depth = depthFormat ? device.createTexture2D(depthFormat, width, height) : null;
    return device.createFrameBuffer([tex], depth);
  }
  static releaseFrameBuffer(fb: FrameBuffer) {
    const colorAttachment = fb.getColorAttachments()[0];
    const depthAttachement = fb.getDepthAttachment();
    const format = colorAttachment.format;
    const depthFormat = depthAttachement?.format ?? null;
    const hash = `${format}:${depthFormat??''}:${colorAttachment.width}:${colorAttachment.height}:${colorAttachment.mipLevelCount===1?1:0}`;
    let fblist = this._framebuffers[hash];
    if (!fblist) {
      fblist = [];
      this._framebuffers[hash] = fblist;
    }
    if (fblist.indexOf(fb) < 0) {
      fblist.push(fb);
    }
  }
  static fetchTexture2D(format: TextureFormat, width: number, height: number, noMipmap: boolean) {
    return this.fetchTexture('2d', format, width, height, 1, noMipmap);
  }
  static fetchTextureCube(format: TextureFormat, width: number, noMipmap: boolean) {
    return this.fetchTexture('cube', format, width, width, 1, noMipmap);
  }
  static fetchTexture2DArray(format: TextureFormat, width: number, height: number, numLayers: number, noMipmap: boolean) {
    return this.fetchTexture('2darray', format, width, height, numLayers, noMipmap);
  }
  static fetchTexture3D(format: TextureFormat, width: number, height: number, depth: number) {
    return this.fetchTexture('3d', format, width, height, depth, true);
  }
  static fetchTexture(type: '2d'|'3d'|'cube'|'2darray', format: TextureFormat, width: number, height: number, depth:number, noMipmap: boolean) {
    const hash = `${type}:${format}:${width}:${height}:${depth}:${noMipmap?1:0}`;
    let texlist = this._textures[hash];
    if (texlist?.length > 0) {
      const tex = texlist.shift();
      if (texlist.length === 0) {
        delete this._textures[hash];
      }
      return tex;
    }
    return Application.instance.device.createTexture2D(format, width, height, {
      noMipmap: !!noMipmap
    });
  }
  static releaseTexture(texture: BaseTexture) {
    const type = texture.isTexture2D() ? '2d' : texture.isTextureCube() ? 'cube' : texture.isTexture2DArray() ? '2darray' : texture.isTexture3D() ? '3d' : null;
    const hash = `${type}:${texture.format}:${texture.width}:${texture.height}:${texture.depth}:${texture.isSRGBFormat()?1:0}:${texture.mipLevelCount===1?1:0}`;
    let texlist = this._textures[hash];
    if (!texlist) {
      texlist = [];
      this._textures[hash] = texlist;
    }
    if (texlist.indexOf(texture) < 0) {
      texlist.push(texture);
    }
  }
}
