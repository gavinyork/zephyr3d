import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

export type ZABCPreviewStats = {
  animationCount: number;
  trackCount: number;
  frameCount: number;
  sourcePayloadBytes: number;
  convertedPayloadBytes: number;
  maxPositionError: number;
  rmsPositionError: number;
};

export type ZABCCompressDialogResult = {
  action: 'compress' | 'keep' | 'cancel';
  components: number;
  compressNormals: boolean;
};

export class DlgZABCCompress extends DialogRenderer<ZABCCompressDialogResult> {
  private static _lastComponents = 16;
  private static _lastCompressNormals = false;

  private readonly _components: [number];
  private readonly _compressNormals: [boolean];
  private readonly _fileCount: number;
  private readonly _previewProvider: ((components: number, compressNormals: boolean) => Promise<ZABCPreviewStats>) | null;
  private _previewLoading: boolean;
  private _previewStats: ZABCPreviewStats | null;
  private _previewError: string;

  public static async prompt(
    fileCount: number,
    previewProvider?: (components: number, compressNormals: boolean) => Promise<ZABCPreviewStats>,
    width = 460
  ): Promise<ZABCCompressDialogResult> {
    return new DlgZABCCompress('ZABC Import Options##Dialog', fileCount, previewProvider ?? null, width).showModal();
  }

  constructor(
    id: string,
    fileCount: number,
    previewProvider: ((components: number, compressNormals: boolean) => Promise<ZABCPreviewStats>) | null,
    width = 460
  ) {
    super(id, width, 0, true, true);
    this._components = [DlgZABCCompress._lastComponents];
    this._compressNormals = [DlgZABCCompress._lastCompressNormals];
    this._fileCount = fileCount;
    this._previewProvider = previewProvider;
    this._previewLoading = false;
    this._previewStats = null;
    this._previewError = '';
  }

  private sanitizeValues() {
    if (!Number.isFinite(this._components[0]) || this._components[0] < 1) {
      this._components[0] = 1;
    }
    if (this._components[0] > 512) {
      this._components[0] = 512;
    }
  }

  private buildResult(action: 'compress' | 'keep' | 'cancel'): ZABCCompressDialogResult {
    this.sanitizeValues();
    if (action === 'compress') {
      DlgZABCCompress._lastComponents = this._components[0];
      DlgZABCCompress._lastCompressNormals = this._compressNormals[0];
    }
    return {
      action,
      components: this._components[0],
      compressNormals: this._compressNormals[0]
    };
  }

  private formatMB(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private async requestPreview() {
    if (!this._previewProvider || this._previewLoading) {
      return;
    }
    this.sanitizeValues();
    this._previewLoading = true;
    this._previewError = '';
    try {
      this._previewStats = await this._previewProvider(this._components[0], this._compressNormals[0]);
    } catch (err) {
      this._previewError = err instanceof Error ? err.message : `${err}`;
    } finally {
      this._previewLoading = false;
    }
  }

  private renderPreviewSummary() {
    ImGui.Separator();
    ImGui.Text('Preview Summary');
    if (this._previewLoading) {
      ImGui.Text('Computing preview...');
      return;
    }
    if (this._previewError) {
      ImGui.TextWrapped(`Preview failed: ${this._previewError}`);
      return;
    }
    if (!this._previewStats) {
      ImGui.Text('Files: -');
      ImGui.Text('Payload: -');
      ImGui.Text('Disk: pending output file');
      ImGui.Text('Error: -');
      return;
    }
    const source = this._previewStats.sourcePayloadBytes;
    const converted = this._previewStats.convertedPayloadBytes;
    const ratio = source > 0 ? (converted / source) * 100 : 0;
    ImGui.Text(
      `Files: ${this._previewStats.animationCount} animation(s), ${this._previewStats.trackCount} track(s), ${this._previewStats.frameCount} frame(s)`
    );
    ImGui.Text(`Payload: ${this.formatMB(source)} -> ${this.formatMB(converted)} (${ratio.toFixed(2)}%)`);
    ImGui.Text('Disk: pending output file');
    ImGui.Text(
      `Error: max ${this._previewStats.maxPositionError.toFixed(6)}, rms ${this._previewStats.rmsPositionError.toFixed(6)}`
    );
  }

  doRender(): void {
    ImGui.TextWrapped(
      `Detected ${this._fileCount} raw .zabc file(s). You can compress them to PCA while importing, or keep original files.`
    );
    ImGui.Separator();

    ImGui.Text('PCA Components');
    ImGui.SetNextItemWidth(120);
    ImGui.InputInt('##zabcPcaComponents', this._components, 1, 8);
    this.sanitizeValues();

    ImGui.Checkbox('Compress normals', this._compressNormals);

    this.renderPreviewSummary();
    if (ImGui.Button(this._previewLoading ? 'Previewing...' : 'Preview Stats')) {
      this.requestPreview();
    }

    ImGui.Separator();
    if (ImGui.Button('Compress')) {
      this.close(this.buildResult('compress'));
    }
    ImGui.SameLine();
    if (ImGui.Button('Keep Raw')) {
      this.close(this.buildResult('keep'));
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(this.buildResult('cancel'));
    }
  }
}
