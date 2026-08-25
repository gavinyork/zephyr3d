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
  /**
   * Point of the groom's bounding box to move onto the origin, or null to leave
   * the control points where the archive put them.
   */
  originAnchor: [number, number, number] | null;
  /** Whether the source archive is copied in alongside the converted file. */
  keepSource: boolean;
};

/**
 * Import options for Alembic and HAIR curve archives.
 *
 * @remarks
 * Only the facts the converter cannot work out for itself are asked here.
 * Everything about how much of the groom to draw - strand stride, maximum strand
 * count - is a property of the node, not of the file, so it is deliberately
 * absent: the file keeps the groom at authored density and a scene can change
 * its mind about density later without a reimport.
 */
export class DlgHairImport extends DialogRenderer<HairImportDialogResult> {
  private static _lastUnitScale = 0.01;
  private static _lastUpAxis = 1;
  private static _lastRecenter = false;
  private static _lastAnchor: [number, number, number] = [0.5, 0.5, 0.5];
  private static _lastKeepSource = false;

  private readonly _unitScale: [number];
  /** Radio selection: 0 for Y-up, 1 for Z-up. */
  private readonly _upAxis: [number];
  private readonly _recenter: [boolean];
  private readonly _anchor: [number, number, number];
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
    this._recenter = [DlgHairImport._lastRecenter];
    this._anchor = [...DlgHairImport._lastAnchor];
    this._keepSource = [DlgHairImport._lastKeepSource];
    this._fileCount = fileCount;
    this._hasHairFiles = hasHairFiles;
  }

  private sanitizeValues() {
    if (!Number.isFinite(this._unitScale[0]) || this._unitScale[0] <= 0) {
      this._unitScale[0] = 1;
    }
    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(this._anchor[i])) {
        this._anchor[i] = 0;
      }
    }
  }

  private buildResult(action: 'convert' | 'keep' | 'cancel'): HairImportDialogResult {
    this.sanitizeValues();
    if (action === 'convert') {
      DlgHairImport._lastUnitScale = this._unitScale[0];
      DlgHairImport._lastUpAxis = this._upAxis[0];
      DlgHairImport._lastRecenter = this._recenter[0];
      DlgHairImport._lastAnchor = [...this._anchor];
      DlgHairImport._lastKeepSource = this._keepSource[0];
    }
    return {
      action,
      unitScale: this._unitScale[0],
      upAxis: this._upAxis[0] === 0 ? 'y' : 'z',
      originAnchor: this._recenter[0] ? [...this._anchor] : null,
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
    ImGui.Checkbox('Correct origin', this._recenter);
    // A groom is combed in place on a character, so its points carry the offset
    // that character had in the authoring scene. Off by default: an archive that
    // was authored around its own origin is already right, and moving it would
    // break a rig that expects the authored placement.
    ImGui.TextWrapped(
      'Moves a point of the bounding box onto the origin. Leave off to keep the positions the archive authored.'
    );
    if (this._recenter[0]) {
      ImGui.Text('Anchor');
      ImGui.SetNextItemWidth(220);
      ImGui.InputFloat3('##hairOriginAnchor', this._anchor, '%.3f');
      this.sanitizeValues();
      if (ImGui.SmallButton('Center##hairAnchorCenter')) {
        this._anchor[0] = 0.5;
        this._anchor[1] = 0.5;
        this._anchor[2] = 0.5;
      }
      ImGui.SameLine();
      if (ImGui.SmallButton('Base##hairAnchorBase')) {
        this._anchor[0] = 0.5;
        this._anchor[1] = 0;
        this._anchor[2] = 0.5;
      }
      ImGui.SameLine();
      if (ImGui.SmallButton('Min##hairAnchorMin')) {
        this._anchor[0] = 0;
        this._anchor[1] = 0;
        this._anchor[2] = 0;
      }
      ImGui.TextWrapped(
        'Per axis, 0 is the bounding box minimum and 1 its maximum, so 0.5/0.5/0.5 is the centre and 0.5/0/0.5 the middle of its base. Values outside 0 to 1 are allowed.'
      );
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
