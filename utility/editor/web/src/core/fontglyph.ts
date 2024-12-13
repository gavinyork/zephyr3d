import { Font } from '@zephyr3d/device';
import type { ApiClient } from '../api/client/apiclient';
import { Application } from '@zephyr3d/scene';
import { imGuiSetFontGlyph } from '@zephyr3d/imgui';

type FontConfig = {
  name: string;
  glyphs: { uid: string; css: string; code: number; src: string }[];
};

export class FontGlyph {
  static glyphs: { [name: string]: string } = {};
  static allGlyphs: string = '';
  static async loadFontGlyphs(apiClient: ApiClient, name: string) {
    try {
      const config = (await apiClient.asset(`/fonts/${name}.json`, 'json')) as FontConfig;
      const fontData = await apiClient.asset(`/fonts/${name}.woff2`, 'arraybuffer');
      const font = new FontFace(config.name, fontData);
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
      const deviceFont = new Font(`12px ${config.name}`, Application.instance.device.getScale());
      for (const glyph of config.glyphs) {
        imGuiSetFontGlyph(glyph.code, deviceFont);
        console.log(`==> ${glyph.css}`);
        this.glyphs[glyph.css] = String.fromCharCode(glyph.code);
        this.allGlyphs += this.glyphs[glyph.css];
      }
    } catch (err) {
      console.error(`Failed to load icon font: ${err}`);
    }
  }
}
