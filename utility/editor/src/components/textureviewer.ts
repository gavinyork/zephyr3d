import type { BaseTexture, FrameBuffer, Texture2D } from '@zephyr3d/device';
import {
  hasAlphaChannel,
  hasBlueChannel,
  hasDepthChannel,
  hasGreenChannel,
  hasRedChannel,
  isIntegerTextureFormat,
  isSRGBTextureFormat
} from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import { getDevice } from '@zephyr3d/scene';
import { TextureDrawer } from './texturedrawer';
import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';

let frameBuffer: FrameBuffer = null;
let probeFrameBuffer: FrameBuffer = null;
let probeUnsupported = false;
const probeBuffer = new Float32Array(4);
let currentTexture: BaseTexture = null;
let currentTextureUid = -1;
let currentTextureMipLevel = 0;
let currentTextureLayer = 0;
let textureDrawer: TextureDrawer = null;
let textureFlip = false;
let textureLinear = false;
let textureRepeat = 1;
let textureGammaCorrect = false;
let textureDrawMode = 0;
let reading = false;
let readColor = '';
const textureModes = [
  TextureDrawer.RGBA,
  TextureDrawer.RGB,
  TextureDrawer.R,
  TextureDrawer.G,
  TextureDrawer.B,
  TextureDrawer.A,
  TextureDrawer.RG
];
const textureModeNames = ['RGBA', 'RGB', 'R', 'G', 'B', 'A', 'RG'];
const textureEncodes = [TextureDrawer.ENCODE_NORMAL, TextureDrawer.ENCODE_NORMALIZED_FLOAT];
const textureEncodeNames = ['Normal', 'RGBA encoded float'];
let textureDrawEncode = 0;

function textureToListName(tex: BaseTexture) {
  return `${tex.name}#${tex.uid}(${tex.format} ${tex.width}x${tex.height}x${tex.depth})##${tex.uid}`;
}

/** The texel currently under the mouse cursor */
type HoveredTexel = {
  /** Horizontal texel index within the mipmap level being displayed */
  x: number;
  /** Vertical texel index within the mipmap level being displayed */
  y: number;
  /** Texture coordinate of the center of the texel */
  u: number;
  /** Texture coordinate of the center of the texel */
  v: number;
  /** Cube face or array layer the texel belongs to */
  faceOrLayer: number;
};

function getProbeFrameBuffer() {
  if (!probeFrameBuffer && !probeUnsupported) {
    if (!getDevice().getDeviceCaps().textureCaps.supportFloatColorBuffer) {
      probeUnsupported = true;
      return null;
    }
    const renderTarget = getDevice().createTexture2D('rgba32f', 1, 1, {
      mipmapping: false
    });
    renderTarget.name = '!!textureviewerprobe';
    probeFrameBuffer = getDevice().createFrameBuffer([renderTarget], null);
    probeFrameBuffer.setColorAttachmentGenerateMipmaps(0, false);
  }
  return probeFrameBuffer;
}

function getHoveredTexel(tex: BaseTexture, posX: number, posY: number, width: number, height: number) {
  if (!tex || tex.disposed || width <= 0 || height <= 0 || !ImGui.IsWindowHovered()) {
    return null;
  }
  const mouse = ImGui.GetMousePos();
  const sx = (mouse.x - posX) / width;
  const sy = (mouse.y - posY) / height;
  if (!(sx >= 0 && sx < 1 && sy >= 0 && sy < 1)) {
    return null;
  }
  let u: number;
  let v: number;
  if (tex.isTextureCube()) {
    // The cube shader derives the sample direction from the vertex position and compensates
    // the webgpu y direction by itself, so both backends share the same vertical direction here
    u = sx;
    v = textureFlip ? 1 - sy : sy;
  } else {
    // NDC y of 1 ends up in the last texel row of the render target on webgl but in the
    // first one on webgpu, so the vertical direction of the preview differs by backend
    const flipV = getDevice().type === 'webgpu' ? textureFlip : !textureFlip;
    u = sx * textureRepeat;
    v = (flipV ? 1 - sy : sy) * textureRepeat;
    if (textureRepeat !== 1) {
      u -= Math.floor(u);
      v -= Math.floor(v);
    }
  }
  const mipWidth = Math.max(1, tex.width >> currentTextureMipLevel);
  const mipHeight = Math.max(1, tex.height >> currentTextureMipLevel);
  const x = Math.min(mipWidth - 1, Math.max(0, Math.floor(u * mipWidth)));
  const y = Math.min(mipHeight - 1, Math.max(0, Math.floor(v * mipHeight)));
  return {
    x,
    y,
    // Sampling the center of the texel keeps the probe independent of filtering and precision
    u: (x + 0.5) / mipWidth,
    v: (y + 0.5) / mipHeight,
    faceOrLayer: tex.isTextureCube() || tex.isTexture2DArray() ? currentTextureLayer : 0
  } as HoveredTexel;
}

function formatFloat(val: number) {
  if (!Number.isFinite(val)) {
    return String(val);
  }
  if (val === 0) {
    return '0';
  }
  const a = Math.abs(val);
  return a >= 1e-4 && a < 1e7 ? String(Number(val.toFixed(6))) : val.toExponential(4);
}

function formatChannel(tex: BaseTexture, name: string, val: number) {
  const format = tex.format;
  if (isIntegerTextureFormat(format)) {
    return `${name}: ${Math.round(val)}`;
  }
  // The sampler decodes sRGB textures, so the stored bytes cannot be recovered for them
  if (!isSRGBTextureFormat(format)) {
    if (/8unorm$/.test(format)) {
      return `${name}: ${formatFloat(val)} (${Math.round(val * 255)})`;
    }
    if (/8snorm$/.test(format)) {
      return `${name}: ${formatFloat(val)} (${Math.round(val * 127)})`;
    }
  }
  return `${name}: ${formatFloat(val)}`;
}

function formatTexelValue(tex: BaseTexture, texel: HoveredTexel, values: Float32Array) {
  const format = tex.format;
  const lines = [`${format} texel(${texel.x}, ${texel.y}) mip ${currentTextureMipLevel}`];
  if (tex.isTextureCube()) {
    lines.push(`face ${texel.faceOrLayer}`);
  } else if (tex.isTexture2DArray()) {
    lines.push(`layer ${texel.faceOrLayer}`);
  }
  if (isSRGBTextureFormat(format)) {
    lines.push('sRGB decoded to linear');
  }
  if (hasDepthChannel(format)) {
    lines.push(formatChannel(tex, 'D', values[0]));
  } else {
    const names = ['R', 'G', 'B', 'A'];
    const present = [
      hasRedChannel(format),
      hasGreenChannel(format),
      hasBlueChannel(format),
      hasAlphaChannel(format)
    ];
    for (let i = 0; i < 4; i++) {
      if (present[i]) {
        lines.push(formatChannel(tex, names[i], values[i]));
      }
    }
  }
  return lines.join('\n');
}

export function renderTextureViewer() {
  const textureList = getDevice().getGPUObjects().textures;
  const textureNameList = textureList
    .filter((tex) => !tex.isTexture3D() && !tex.name.startsWith('!!'))
    .sort((a, b) => a.uid - b.uid)
    .map((tex) => textureToListName(tex));
  if (textureNameList.length > 0) {
    if (!frameBuffer) {
      const renderTarget = getDevice().createTexture2D('rgba8unorm', 512, 512, {
        mipmapping: false
      });
      renderTarget.name = '!!textureviewer';
      frameBuffer = getDevice().createFrameBuffer([renderTarget], null);
      frameBuffer.setColorAttachmentGenerateMipmaps(0, false);
    }
    if (!textureDrawer) {
      textureDrawer = new TextureDrawer();
    }
    ImGui.Begin('Texture viewer');
    let tindex =
      currentTextureUid < 0
        ? -1
        : textureNameList.findIndex((val) => {
            const k = val.split('##');
            const uid = Number(k[k.length - 1]);
            return uid === currentTextureUid;
          });
    if (tindex < 0) {
      tindex = 0;
      currentTextureMipLevel = 0;
      currentTextureLayer = 0;
    }
    const t = [tindex] as [number];
    if (ImGui.Combo('Textures', t, textureNameList)) {
      tindex = t[0];
      currentTextureMipLevel = 0;
      currentTextureLayer = 0;
    }
    const k = textureNameList[tindex].split('##');
    currentTextureUid = Number(k[k.length - 1]);
    currentTexture = getDevice().getGPUObjectById(currentTextureUid) as BaseTexture;
    if (currentTexture) {
      const mipLevelCount = currentTexture.mipLevelCount;
      const miplevel = [currentTextureMipLevel] as [number];
      if (
        ImGui.Combo(
          'MipLevel',
          miplevel,
          Array.from({ length: mipLevelCount }).map((val, index) => String(index))
        )
      ) {
        currentTextureMipLevel = miplevel[0];
      }
      if (currentTexture.isTextureCube()) {
        const cubeFace = [currentTextureLayer] as [number];
        if (ImGui.Combo('CubeFace', cubeFace, ['Pos X', 'Neg X', 'Pos Y', 'Neg Y', 'Pos Z', 'Neg Z'])) {
          currentTextureLayer = cubeFace[0];
        }
      }
      if (currentTexture.isTexture2DArray()) {
        const layer = [currentTextureLayer] as [number];
        if (ImGui.DragInt('ArrayIndex', layer, 1, 0, currentTexture.depth - 1)) {
          currentTextureLayer = layer[0];
        }
      }
      const renderMode = [textureDrawMode] as [number];
      if (ImGui.Combo('Mode', renderMode, textureModeNames)) {
        textureDrawMode = renderMode[0];
      }
      const renderEncode = [textureDrawEncode] as [number];
      if (ImGui.Combo('Encode', renderEncode, textureEncodeNames)) {
        textureDrawEncode = renderEncode[0];
      }
      const repeat = [textureRepeat] as [number];
      if (ImGui.SliderInt('Repeat', repeat, 0, 8)) {
        textureRepeat = repeat[0];
      }
      const colorScale = [textureDrawer.colorScale] as [number];
      if (ImGui.DragFloat('ColorScale', colorScale, 0.1, 0, 800)) {
        textureDrawer.colorScale = colorScale[0];
      }
      ImGui.Checkbox('Vertical flip', (val?: boolean) => {
        if (val === undefined) {
          val = textureFlip;
        } else {
          textureFlip = val;
        }
        return val;
      });
      ImGui.Checkbox('Linear', (val?: boolean) => {
        if (val === undefined) {
          val = textureLinear;
        } else {
          textureLinear = val;
        }
        return val;
      });
      ImGui.Checkbox('sRGB', (val?: boolean) => {
        if (val === undefined) {
          val = textureGammaCorrect;
        } else {
          textureGammaCorrect = val;
        }
        return val;
      });
    }
    const width = ImGui.GetContentRegionAvail().x;
    const height = currentTexture
      ? Math.floor((width / currentTexture.width) * currentTexture.height)
      : width;
    // Queried before the image is submitted, because the texel has to be sampled
    // while the device states are still pushed
    const imagePos = ImGui.GetCursorScreenPos();
    const texel = getHoveredTexel(currentTexture, imagePos.x, imagePos.y, width, height);
    const probeFB = texel ? getProbeFrameBuffer() : null;
    let probed = false;
    getDevice().pushDeviceStates();
    getDevice().setFramebuffer(frameBuffer);
    getDevice().clearFrameBuffer(new Vector4(1, 0, 1, 1), DEPTH_CLEAR_VALUE, 0);
    textureDrawer.draw(
      currentTexture,
      textureRepeat,
      textureGammaCorrect,
      textureLinear,
      textureFlip,
      textureEncodes[textureDrawEncode],
      textureModes[textureDrawMode],
      currentTextureMipLevel,
      currentTextureLayer
    );
    if (probeFB) {
      getDevice().setFramebuffer(probeFB);
      probed = textureDrawer.drawPixel(
        currentTexture,
        texel.u,
        texel.v,
        currentTextureMipLevel,
        texel.faceOrLayer
      );
    }
    getDevice().popDeviceStates();
    ImGui.Image(frameBuffer.getColorAttachments()[0] as Texture2D, new ImGui.ImVec2(width, height));
    if (texel) {
      if (probeUnsupported) {
        ImGui.SetTooltip('Reading texel values requires float color buffer support');
      } else if (!probed) {
        ImGui.SetTooltip(`Texel values of ${currentTexture.format} textures cannot be read`);
      } else {
        // The readback is asynchronous, so the last completed one is displayed while
        // the next one is in flight. The texture being viewed may be rendered to every
        // frame, so a new readback is issued as soon as the previous one completes.
        if (!reading) {
          reading = true;
          const probeTexture = probeFB.getColorAttachments()[0] as Texture2D;
          const probedTexture = currentTexture;
          const probedTexel = texel;
          probeTexture
            .readPixels(0, 0, 1, 1, 0, 0, probeBuffer)
            .then(() => {
              readColor = formatTexelValue(probedTexture, probedTexel, probeBuffer);
            })
            .catch((err) => {
              readColor = String(err);
            })
            .finally(() => {
              reading = false;
            });
        }
        ImGui.SetTooltip(readColor || 'Reading...');
      }
    }
    ImGui.End();
  }
}
