import type { BaseTexture, DeviceViewport, FrameBuffer } from "@zephyr3d/device";
import type { PunctualLight } from "../scene";

export class RenderLogger {
  private _frameLog: any[];
  private _scopeStack: any[][];
  constructor() {
    this._frameLog = null;
    this._scopeStack = null;
  }
  start() {
    this._frameLog = [];
    this._scopeStack = [this._frameLog];
  }
  stop() {
  }
  begin(name: string) {
    const scope = [];
    const top = this._scopeStack[this._scopeStack.length - 1];
    top[name] = scope;
    this._scopeStack.push(scope);
  }
  end() {
    this._scopeStack.pop();
  }
  text(str: string) {
    this._scopeStack[this._scopeStack.length - 1].push(str);
  }
  framebuffer(fb: FrameBuffer) {
    return fb ? `FrameBuffer<${fb.uid}> [${fb.getColorAttachments().map(tex => this.texture(tex)).join(',')}] ${this.texture(fb.getDepthAttachment())}` : 'null';
  }
  texture(tex: BaseTexture) {
    if (!tex) {
      return null;
    }
    const type = tex.isTexture2D()
      ? 'Texture2D'
      : tex.isTexture3D()
        ? 'Texture3D'
        : tex.isTexture2DArray()
          ? 'Texture2DArray'
          : tex.isTextureCube()
            ? 'TextureCube'
            : 'UnknownTexture'
    return `${type}<${tex.uid}>{${tex.format}}`;
  }
  viewport(vp: DeviceViewport|number[]) {
    if (!vp) {
      return 'null';
    } else if (Array.isArray(vp)) {
      return `(${vp[0]} ${vp[1]} ${vp[2]} ${vp[3]})`;
    } else {
      return `(${vp.x} ${vp.y} ${vp.width} ${vp.height} ${vp.default})`;
    }
  }
  light(l: PunctualLight) {
    if (!l) {
      return 'null';
    } else {
      return l.constructor.name;
    }
  }
}
