import { ImGui } from '@zephyr3d/imgui';
import type { SharedModel } from '@zephyr3d/scene';
import { defaultMeshImportSettings } from '@zephyr3d/scene';
import { DialogRenderer } from '../../components/modal';
import type { VFS } from '@zephyr3d/base';
import { DlgSkeletonEditor } from './skeletoneditor';
import type { SaveOptions } from '../../core/services/resource';
import { ResourceService } from '../../core/services/resource';
import { FilePicker } from '../../components/filepicker';

export class DlgImportOptions extends DialogRenderer<SaveOptions[]> {
  protected _vfs: VFS;
  protected _models: SharedModel[];
  protected _current: number;
  protected _modelNames: string[];
  protected _options: SaveOptions[];
  protected _retargetPoseModes: number[];
  protected _retargetPoseStatus: string[];
  protected _retargetPoseLoading: boolean[];
  public static promptImportOptions(
    title: string,
    vfs: VFS,
    models: SharedModel[],
    names: string[],
    width?: number,
    height?: number
  ) {
    return new DlgImportOptions(`${title}##Dialog`, vfs, models, names, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, models: SharedModel[], names: string[], width?: number, height?: number) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._vfs = vfs;
    this._models = models;
    this._current = 0;
    this._modelNames = names;
    this._options = models.map((model) => ({
      importMeshes: model.primitives.length > 0,
      importSkeletons: model.skeletons.length > 0,
      importAnimations: model.animations.length > 0,
      importJointDynamics: model.jointDynamicsSpringBones.length > 0,
      // Opt-in, so importing never changes how a project ships unless asked to
      compressTextures: false,
      compressVertices: false,
      generateLods: false,
      lodMinTriangles: defaultMeshImportSettings().lodMinTriangles,
      lodReduction: defaultMeshImportSettings().lodReduction,
      lodPixelError: defaultMeshImportSettings().lodPixelError
    }));
    this._retargetPoseModes = models.map((model) =>
      model.skeletons.some((skeleton) => !!skeleton.retargetPose) ? 1 : 0
    );
    this._retargetPoseStatus = models.map(() => '');
    this._retargetPoseLoading = models.map(() => false);
  }
  doRender(): void {
    const selected = [this._current] as [number];
    if (ImGui.Combo('Select Model', selected, this._modelNames)) {
      this._current = selected[0];
    }
    ImGui.Separator();

    // Mesh option
    const hasMeshes = this._models[this._current].primitives.length > 0;
    if (!hasMeshes) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importMeshes = [this._options[this._current].importMeshes] as [boolean];
    if (ImGui.Checkbox('Import Meshes', importMeshes)) {
      if (hasMeshes) {
        this._options[this._current].importMeshes = importMeshes[0];
      }
    }
    if (!hasMeshes) {
      ImGui.PopStyleVar();
    }

    // Skeleton option
    const hasSkeletons = this._models[this._current].skeletons.length > 0;
    if (!hasSkeletons) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importSkeletons = [hasSkeletons && this._options[this._current].importSkeletons] as [boolean];
    if (ImGui.Checkbox('Import Skeletons', importSkeletons)) {
      if (hasSkeletons) {
        this._options[this._current].importSkeletons = importSkeletons[0];
      }
    }
    if (!hasSkeletons) {
      ImGui.PopStyleVar();
    }
    if (this._options[this._current].importSkeletons) {
      ImGui.SameLine();
      if (ImGui.Button('Settings...')) {
        DlgSkeletonEditor.editSkeleton('SkeletonEditor', this._models[this._current].skeletons, 500, 500);
      }
      const retargetPoseMode = [this._retargetPoseModes[this._current]] as [number];
      if (ImGui.Combo('Retarget Pose', retargetPoseMode, ['Use Model Bind Pose', 'External GLB'])) {
        this._retargetPoseModes[this._current] = retargetPoseMode[0];
        this._retargetPoseStatus[this._current] = '';
        if (retargetPoseMode[0] === 0) {
          ResourceService.clearRetargetPose(this._models[this._current]);
        }
      }
      if (this._retargetPoseModes[this._current] === 1) {
        if (this._retargetPoseLoading[this._current]) {
          ImGui.TextDisabled('Loading external pose...');
        } else if (ImGui.Button('Choose Pose GLB...')) {
          const modelIndex = this._current;
          FilePicker.chooseFiles(false, '.glb,.vrm,.vrma').then(async (files) => {
            if (files.length === 0) {
              if (!this._models[modelIndex].skeletons.some((skeleton) => !!skeleton.retargetPose)) {
                this._retargetPoseModes[modelIndex] = 0;
              }
              return;
            }
            this._retargetPoseLoading[modelIndex] = true;
            this._retargetPoseStatus[modelIndex] = '';
            try {
              const referenceModel = await ResourceService.importRetargetPoseModel(files[0]);
              try {
                const result = ResourceService.applyRetargetPoseModel(
                  this._models[modelIndex],
                  referenceModel
                );
                this._retargetPoseStatus[modelIndex] =
                  `${files[0].name}: ${result.skeletonCount} skeleton(s), ${result.jointCount} joint(s)`;
              } finally {
                referenceModel.dispose();
              }
            } catch (err) {
              console.error(`Load retarget pose ${files[0].name} failed: ${err}`);
              this._retargetPoseStatus[modelIndex] = `Failed: ${files[0].name}`;
              if (!this._models[modelIndex].skeletons.some((skeleton) => !!skeleton.retargetPose)) {
                this._retargetPoseModes[modelIndex] = 0;
              }
            } finally {
              this._retargetPoseLoading[modelIndex] = false;
            }
          });
        }
        if (this._retargetPoseStatus[this._current]) {
          ImGui.TextWrapped(this._retargetPoseStatus[this._current]);
        }
      }
    }

    // Animation option
    const hasAnimations = hasSkeletons && this._models[this._current].animations.length > 0;
    if (!hasAnimations) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importAnimations = [hasAnimations && this._options[this._current].importAnimations] as [boolean];
    if (ImGui.Checkbox('Import Animations', importAnimations)) {
      if (hasAnimations) {
        this._options[this._current].importAnimations = importAnimations[0];
      }
    }
    if (!hasAnimations) {
      ImGui.PopStyleVar();
    }

    // Joint dynamics option
    const hasJointDynamics = hasSkeletons && this._models[this._current].jointDynamicsSpringBones.length > 0;
    if (!hasJointDynamics) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importJointDynamics = [hasJointDynamics && this._options[this._current].importJointDynamics] as [
      boolean
    ];
    if (ImGui.Checkbox('Import Joint Dynamics', importJointDynamics)) {
      if (hasJointDynamics) {
        this._options[this._current].importJointDynamics = importJointDynamics[0];
      }
    }
    if (!hasJointDynamics) {
      ImGui.PopStyleVar();
    }

    ImGui.Separator();
    const model = this._models[this._current];
    const hasImages = model.imageCount > 0;
    if (!hasImages) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const compressTextures = [hasImages && !!this._options[this._current].compressTextures] as [boolean];
    if (ImGui.Checkbox('Compress Textures', compressTextures)) {
      if (hasImages) {
        this._options[this._current].compressTextures = compressTextures[0];
      }
    }
    if (!hasImages) {
      ImGui.PopStyleVar();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(
        'Ship newly imported textures as KTX2. Textures that already have settings keep them.'
      );
    }
    if (!hasMeshes) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const compressVertices = [hasMeshes && !!this._options[this._current].compressVertices] as [boolean];
    if (ImGui.Checkbox('Compress Vertices', compressVertices)) {
      if (hasMeshes) {
        this._options[this._current].compressVertices = compressVertices[0];
      }
    }
    if (!hasMeshes) {
      ImGui.PopStyleVar();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(
        'Ship newly imported meshes with compressed, quantized vertex data. Meshes that already have settings keep them.'
      );
    }
    if (!hasMeshes) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const generateLods = [hasMeshes && !!this._options[this._current].generateLods] as [boolean];
    if (ImGui.Checkbox('Generate LODs', generateLods)) {
      if (hasMeshes) {
        this._options[this._current].generateLods = generateLods[0];
      }
    }
    if (!hasMeshes) {
      ImGui.PopStyleVar();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(
        'Give newly imported meshes simplified levels of detail. Meshes that already have settings keep them.'
      );
    }
    if (hasMeshes && this._options[this._current].generateLods) {
      const minTriangles = [this._options[this._current].lodMinTriangles ?? 1] as [number];
      if (ImGui.InputInt('Min Triangles', minTriangles, 10, 100)) {
        this._options[this._current].lodMinTriangles = Math.max(minTriangles[0], 1);
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip('Fewest triangles a simplified level may have; meshes with fewer get no levels.');
      }
      const reduction = [this._options[this._current].lodReduction ?? 0.5] as [number];
      if (ImGui.SliderFloat('Triangles Per Level', reduction, 0.1, 0.9, '%.2f')) {
        this._options[this._current].lodReduction = reduction[0];
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip("Fraction of the previous level's triangles each level keeps.");
      }
      const pixelError = [this._options[this._current].lodPixelError ?? 8] as [number];
      if (ImGui.SliderFloat('Pixel Error', pixelError, 1, 32, '%.1f')) {
        this._options[this._current].lodPixelError = pixelError[0];
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip(
          'A level shows once its error looks smaller than this many pixels on screen; higher values switch to simpler levels closer to the camera.'
        );
      }
    }

    ImGui.Separator();
    if (ImGui.Button('OK')) {
      const incompletePoseIndex = this._models.findIndex(
        (model, index) =>
          this._retargetPoseModes[index] === 1 && !model.skeletons.some((skeleton) => !!skeleton.retargetPose)
      );
      if (incompletePoseIndex >= 0) {
        this._current = incompletePoseIndex;
        this._retargetPoseStatus[incompletePoseIndex] = 'Choose a compatible pose GLB before importing';
      } else {
        this.close(this._options);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
