# Text Rendering

Zephyr3D provides three scene nodes for text rendering:

- `TextSprite`: renders text into a texture first, then displays it as a camera-facing sprite.
- `MSDFText`: builds mesh geometry from a font asset and renders it with a runtime MSDF glyph atlas.
- `MSDFTextSprite`: uses the same MSDF font pipeline as `MSDFText`, but always faces the camera like a billboard.

Use `TextSprite` for small labels that change infrequently or need browser canvas font behavior. Use the MSDF nodes when the text must stay sharp under scaling, perspective, or large on-screen size.

## TextSprite

`TextSprite` uses `device.drawText()` internally. When `text`, `font`, `resolutionX`, `resolutionY`, or `textColor` changes, the node redraws its offscreen texture.

<<< @/../src/tut-54/main.js{88-98 js}

Important properties:

- `text`: displayed text. Newline characters are supported.
- `font`: browser canvas font string, for example `'32px Arial'`.
- `resolutionX` / `resolutionY`: pixel size of the generated texture. Increase these when the sprite is large on screen.
- `textColor`: text color as linear RGB.
- `anchorX` / `anchorY`: normalized sprite pivot. The default is `(0.5, 0.5)`.

When using a remote font with `TextSprite`, load it through CSS `@font-face` or the browser
`FontFace` API before assigning the `font` string — `font` goes through the browser's Canvas font
resolution, which silently falls back to a default face if the font is not ready yet:

<<< @/../src/tut-54/main.js{60-74 js}

Because the text is baked into a texture, avoid changing `text` every frame unless the label count is small.

## MSDF Font Assets

`MSDFText` and `MSDFTextSprite` require a `FontAsset`. Load it with `ResourceManager.fetchFontAsset()`:

<<< @/../src/tut-54/main.js{76-86 js}

`pageSize` controls each atlas texture size. `glyphSize` controls the base MSDF glyph resolution. Larger values improve quality for large text but use more memory and generation time. The options are applied the first time a URL is loaded; cached loads of the same URL reuse the existing `FontAsset`.

Make sure the font contains all characters used by the text. Missing glyphs are skipped during layout.

## MSDFText

`MSDFText` creates regular scene geometry. It follows the node's position, rotation, and scale, so it is useful for text placed on panels, signs, or other 3D surfaces.

<<< @/../src/tut-54/main.js{100-113 js}

Main layout properties:

- `fontAsset`: loaded `FontAsset`; no geometry is generated until this and `text` are both set.
- `fontSize`: text size in local-space units before node scaling.
- `maxWidth`: layout width in local-space units. `0` disables wrapping.
- `textAlign`: `'left'`, `'center'`, or `'right'`.
- `anchor`: normalized pivot inside the layout box.
- `textColor`, `outlineColor`, `outlineWidth`: material styling.
- `castShadow`: allow the generated geometry to render into shadow maps.

## MSDFTextSprite

`MSDFTextSprite` exposes the same text layout and styling properties as `MSDFText`, but its generated geometry is rendered as a billboard. Use it for floating labels, nameplates, and markers that should remain readable while the camera moves.

<<< @/../src/tut-54/main.js{115-128 js}

`MSDFTextSprite` is not rendered into shadow maps. Its Z rotation is treated as an in-plane billboard rotation.

## Demo

The following demo uses the supplied Inter font and shows all three text node types.

<div class="showcase" case="tut-54"></div>
