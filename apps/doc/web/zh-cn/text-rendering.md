# 文本渲染

Zephyr3D 提供了三种用于文本渲染的场景节点：

- `TextSprite`：先把文字绘制到一张纹理，再用始终面向摄像机的 sprite 显示。
- `MSDFText`：从字体资产生成文字网格，并使用运行时 MSDF 字形图集渲染。
- `MSDFTextSprite`：使用和 `MSDFText` 相同的 MSDF 字体流程，但像 billboard 一样始终面向摄像机。

如果只是少量、不频繁变化的标签，或者需要浏览器 Canvas 字体行为，可以使用 `TextSprite`。如果文字需要在缩放、透视或大尺寸显示时保持清晰，优先使用 MSDF 节点。

## TextSprite

`TextSprite` 内部通过 `device.drawText()` 绘制文字。当 `text`、`font`、`resolutionX`、`resolutionY` 或 `textColor` 变化时，节点会重新绘制离屏纹理。

<<< @/../src/tut-54/main.js{88-98 js}

常用属性：

- `text`：显示内容，支持换行符。
- `font`：浏览器 Canvas 字体字符串，例如 `'32px Arial'`。
- `resolutionX` / `resolutionY`：生成纹理的像素尺寸。sprite 在屏幕上较大时应提高分辨率。
- `textColor`：线性 RGB 文本颜色。
- `anchorX` / `anchorY`：归一化 sprite 轴心，默认是 `(0.5, 0.5)`。

如果 `TextSprite` 使用远程字体，需要先通过 CSS `@font-face` 或浏览器 `FontFace` API 加载字体，
再设置 `font` 字符串——`font` 走的是浏览器 Canvas 的字体解析，字体没就绪会静默回退到默认字体：

<<< @/../src/tut-54/main.js{60-74 js}

由于文字会被烘焙到纹理中，除非标签数量很少，否则不建议每帧修改 `text`。

## MSDF 字体资产

`MSDFText` 和 `MSDFTextSprite` 都需要 `FontAsset`。可以通过 `ResourceManager.fetchFontAsset()` 加载：

<<< @/../src/tut-54/main.js{76-86 js}

`pageSize` 控制每张图集纹理的尺寸。`glyphSize` 控制 MSDF 字形的基础分辨率。值越大，大字号显示质量越好，但会增加内存占用和生成开销。同一个 URL 首次加载时会应用这些选项，之后命中缓存时会复用已有 `FontAsset`。

请确保字体包含需要显示的字符。缺失字形会在排版时被跳过。

## MSDFText

`MSDFText` 会创建普通场景几何体。它完整遵循节点的位置、旋转和缩放，适合放在 3D 面板、标牌或其它场景表面上。

<<< @/../src/tut-54/main.js{100-113 js}

主要排版属性：

- `fontAsset`：已加载的 `FontAsset`；只有它和 `text` 都设置后才会生成几何体。
- `fontSize`：本地空间中的文本尺寸，节点缩放会在此基础上继续生效。
- `maxWidth`：本地空间中的排版宽度，`0` 表示不换行。
- `textAlign`：`'left'`、`'center'` 或 `'right'`。
- `anchor`：布局框内的归一化轴心。
- `textColor`、`outlineColor`、`outlineWidth`：材质样式。
- `castShadow`：允许生成的几何体参与阴影图渲染。

## MSDFTextSprite

`MSDFTextSprite` 暴露的文本排版和样式属性与 `MSDFText` 相同，但生成的几何体会以 billboard 方式渲染。它适合浮动标签、名称牌和需要在摄像机移动时保持可读的标记。

<<< @/../src/tut-54/main.js{115-128 js}

`MSDFTextSprite` 不参与阴影图渲染。它的 Z 轴旋转会作为 billboard 平面内旋转处理。

## 示例

下面的示例使用提供的 Inter 字体，并同时展示三种文本节点。

<div class="showcase" case="tut-54"></div>
