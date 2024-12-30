import { BaseTexture, FrameBuffer, Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import { Application } from '@zephyr3d/scene';
import { TextureDrawer } from './texturedrawer';
import { Vector4 } from '@zephyr3d/base';

let frameBuffer: FrameBuffer = null;
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
let textureModes = [
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
  return `${tex.name}(${tex.format} ${tex.width}x${tex.height}x${tex.depth})##${tex.uid}`;
}

export function renderTextureViewer() {
  const textureList = Application.instance.device.getGPUObjects().textures;
  const textureNameList = textureList
    .filter((tex) => !tex.isTexture3D())
    .sort((a, b) => a.uid - b.uid)
    .map((tex) => textureToListName(tex));
  if (textureNameList.length > 0) {
    if (!frameBuffer) {
      const renderTarget = Application.instance.device.createTexture2D('rgba8unorm', 512, 512, {
        samplerOptions: { mipFilter: 'none' }
      });
      renderTarget.name = '!!textureviewer';
      frameBuffer = Application.instance.device.createFrameBuffer([renderTarget], null);
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
    currentTexture = Application.instance.device.getGPUObjectById(currentTextureUid) as BaseTexture;
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
      if (ImGui.SliderFloat('ColorScale', colorScale, 1, 800)) {
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
    Application.instance.device.pushDeviceStates();
    Application.instance.device.setFramebuffer(frameBuffer);
    Application.instance.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
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
    Application.instance.device.popDeviceStates();
    const width = ImGui.GetContentRegionAvail().x;
    const height = currentTexture
      ? Math.floor((width / currentTexture.width) * currentTexture.height)
      : width;
    ImGui.Image(frameBuffer.getColorAttachments()[0] as Texture2D, new ImGui.ImVec2(width, height));
    ImGui.End();
  }
}
