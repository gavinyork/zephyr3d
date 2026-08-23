import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';

/**
 * What to do with the curve archives in a drop.
 *
 * @public
 */
export type HairImportDialogResult = {
  /** `convert` writes `.zhair`, `keep` copies the archives untouched. */
  action: 'convert' | 'keep' | 'cancel';
  /** Scale recorded in the file, converting its units to metres. */
  unitScale: number;
  /** Up axis of `.hair` points. Ignored for Alembic, which carries its own. */
  upAxis: 'y' | 'z';
  /** Whether the source archive is copied in alongside the converted file. */
  keepSource: boolean;
};

/**
 * Import options for Alembic and HAIR curve archives.
 *
 * @remarks
 * Only the two facts the converter cannot work out for itself are asked here.
 * Everything about how much of the groom to draw - strand stride, maximum strand
 * count - is a property of the node, not of the file, so it is deliberately
 * absent: the file keeps the groom at authored density and a scene can change
 * its mind about density later without a reimport.
 */
export class DlgHairImport extends DialogRenderer<HairImportDialogResult> {
  private static _lastUnitScale = 0.01;
  private static _lastUpAxis = 1;
  private static _lastKeepSource = false;

  private readonly _unitScale: [number];
  /** Radio selection: 0 for Y-up, 1 for Z-up. */
  private readonly _upAxis: [number];
  private readonly _keepSource: [boolean];
  private readonly _fileCount: number;
  private readonly _hasHairFiles: boolean;

  /**
   * Prompts for curve import options.
   *
   * @param fileCount - How many archives were dropped.
   * @param hasHairFiles - Whether any of them is a `.hair` file, which is what
   *   makes the up axis question relevant.
   */
  public static async prompt(fileCount: number, hasHairFiles: boolean, width = 460) {
    return new DlgHairImport('Hair Import Options##Dialog', fileCount, hasHairFiles, width).showModal();
  }

  constructor(id: string, fileCount: number, hasHairFiles: boolean, width = 460) {
    super(id, width, 0, true, true);
    this._unitScale = [DlgHairImport._lastUnitScale];
    this._upAxis = [DlgHairImport._lastUpAxis];
    this._keepSource = [DlgHairImport._lastKeepSource];
    this._fileCount = fileCount;
    this._hasHairFiles = hasHairFiles;
  }

  private sanitizeValues() {
    if (!Number.isFinite(this._unitScale[0]) || this._unitScale[0] <= 0) {
      this._unitScale[0] = 1;
    }
  }

  private buildResult(action: 'convert' | 'keep' | 'cancel'): HairImportDialogResult {
    this.sanitizeValues();
    if (action === 'convert') {
      DlgHairImport._lastUnitScale = this._unitScale[0];
      DlgHairImport._lastUpAxis = this._upAxis[0];
      DlgHairImport._lastKeepSource = this._keepSource[0];
    }
    return {
      action,
      unitScale: this._unitScale[0],
      upAxis: this._upAxis[0] === 0 ? 'y' : 'z',
      keepSource: this._keepSource[0]
    };
  }

  doRender(): void {
    ImGui.TextWrapped(
      `Detected ${this._fileCount} curve archive(s). Converting to .zhair parses them once, so scenes load without re-reading the source.`
    );
    ImGui.Separator();

    ImGui.Text('Unit Scale');
    ImGui.SetNextItemWidth(120);
    ImGui.InputFloat('##hairUnitScale', this._unitScale, 0.001, 0.01, '%.4f');
    this.sanitizeValues();
    // Alembic from Maya is authored in centimetres, which is where 0.01 comes
    // from. A `.hair` file records no unit at all, so there is nothing to
    // default to and the number has to be looked at.
    ImGui.TextWrapped(
      'Metres per source unit. Alembic from Maya is usually 0.01; HAIR files record no unit.'
    );

    if (this._hasHairFiles) {
      ImGui.Separator();
      ImGui.Text('HAIR Up Axis');
      ImGui.RadioButton('Y up', this._upAxis, 0);
      ImGui.SameLine();
      ImGui.RadioButton('Z up', this._upAxis, 1);
      ImGui.TextWrapped('cyHairFile models are conventionally Z up. Alembic archives are unaffected.');
    }

    ImGui.Separator();
    ImGui.Checkbox('Also copy the source archive', this._keepSource);
    ImGui.TextWrapped('Keeps the original for reimport, at the cost of its full size on disk.');

    ImGui.Separator();
    if (ImGui.Button('Convert')) {
      this.close(this.buildResult('convert'));
    }
    ImGui.SameLine();
    if (ImGui.Button('Copy Raw')) {
      this.close(this.buildResult('keep'));
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(this.buildResult('cancel'));
    }
  }
}
