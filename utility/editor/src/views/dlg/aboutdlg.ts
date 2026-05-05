import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { getDesktopAPI, isDesktopApp } from '../../core/services/desktop';
import { EDITOR_VERSION } from '../../core/version';
import { FontGlyph } from '../../core/fontglyph';
import { Editor } from '../../core/editor';

export class DlgAbout extends DialogRenderer<void> {
  private static readonly LABEL_COLUMN_WIDTH = 110;

  public static about(title: string) {
    return new DlgAbout(`${title}##Dialog`).showModal();
  }
  constructor(id?: string) {
    super(id ?? 'About zephyr3d editor', 520, 0, true, true);
  }
  doRender(): void {
    const desktop = getDesktopAPI();
    const details: [string, string][] = [
      ['Version', EDITOR_VERSION],
      ['Runtime', isDesktopApp() ? 'Electron' : 'Web']
    ];
    if (desktop) {
      if (desktop.versions.electron) {
        details.push(['Electron', desktop.versions.electron]);
      }
      if (desktop.versions.chrome) {
        details.push(['Chrome', desktop.versions.chrome]);
      }
      if (desktop.versions.node) {
        details.push(['Node.js', desktop.versions.node]);
      }
    }
    const summary = isDesktopApp() ? 'Desktop editor runtime' : 'Browser editor runtime';
    const copyText = ['Zephyr3D Editor', ...details.map(([label, value]) => `${label}: ${value}`)].join('\n');

    this.renderHeader(summary);
    ImGui.Separator();
    this.renderDetails(details);
    ImGui.Separator();
    this.renderActions(copyText);
  }

  private renderHeader(summary: string) {
    const baseX = ImGui.GetCursorPosX();
    const baseY = ImGui.GetCursorPosY();
    const icon = FontGlyph.glyphs['info'] ?? 'i';
    const logo = Editor.current?.getAppImage('icon');

    ImGui.SetCursorPosX(baseX + 8);
    ImGui.SetCursorPosY(baseY + 4);
    if (logo) {
      const width = 42;
      const height = Math.max(28, Math.floor((width / logo.width) * logo.height));
      ImGui.Image(logo, new ImGui.ImVec2(width, height));
    } else {
      ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.ImVec4(0.17, 0.42, 0.92, 1));
      ImGui.SetWindowFontScale(2.2);
      ImGui.Text(icon);
      ImGui.SetWindowFontScale(1);
      ImGui.PopStyleColor();
    }

    ImGui.SetCursorPosX(baseX + 56);
    ImGui.SetCursorPosY(baseY + 2);
    ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.ImVec4(0.09, 0.34, 0.82, 1));
    ImGui.SetWindowFontScale(1.18);
    ImGui.Text('Zephyr3D Editor');
    ImGui.SetWindowFontScale(1);
    ImGui.PopStyleColor();

    ImGui.SetCursorPosX(baseX + 56);
    ImGui.TextDisabled(`Version ${EDITOR_VERSION}`);
    ImGui.SetCursorPosX(baseX + 56);
    ImGui.TextDisabled(summary);

    ImGui.Dummy(new ImGui.ImVec2(0, 10));
  }

  private renderDetails(details: [string, string][]) {
    for (const [label, value] of details) {
      const lineX = ImGui.GetCursorPosX();
      const lineY = ImGui.GetCursorPosY();
      ImGui.TextDisabled(label);
      ImGui.SameLine(lineX + DlgAbout.LABEL_COLUMN_WIDTH);
      ImGui.SetCursorPosY(lineY);
      ImGui.TextWrapped(value);
    }
  }

  private renderActions(copyText: string) {
    const style = ImGui.GetStyle();
    const rightAlignedWidth = 70 + style.ItemSpacing.x + 64;
    ImGui.SetCursorPosX(
      ImGui.GetCursorPosX() + Math.max(0, ImGui.GetContentRegionAvail().x - rightAlignedWidth)
    );
    if (ImGui.Button('Copy', new ImGui.ImVec2(70, 0))) {
      ImGui.SetClipboardText(copyText);
    }
    ImGui.SameLine();
    if (ImGui.Button('OK', new ImGui.ImVec2(64, 0))) {
      this.close();
    }
  }
}
