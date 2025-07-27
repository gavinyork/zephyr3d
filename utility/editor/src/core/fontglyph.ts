import { Font } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';
import { imGuiSetFontGlyph } from '@zephyr3d/imgui';

type FontConfig = {
  name: string;
  glyphs: { uid: string; css: string; code: number; src: string }[];
};

export class FontGlyph {
  static glyphs: { [name: string]: string } = {};
  static allGlyphs: string = '';
  static async loadFontGlyphs(name: string) {
    try {
      const config = (await (await fetch(`assets/fonts/${name}.json`)).json()) as FontConfig;
      const fontData = await (await fetch(`assets/fonts/${name}.woff2`)).arrayBuffer();
      const font = new FontFace(config.name, fontData);
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
      const deviceFont = new Font(`12px ${config.name}`, Application.instance.device.getScale());
      for (const glyph of config.glyphs) {
        imGuiSetFontGlyph(glyph.code, deviceFont);
        //console.log(`==> ${glyph.css}`);
        this.glyphs[glyph.css] = String.fromCodePoint(glyph.code);
        this.allGlyphs += this.glyphs[glyph.css];
      }
    } catch (err) {
      console.error(`Failed to load icon font: ${err}`);
    }
  }
}
