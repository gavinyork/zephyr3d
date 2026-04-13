import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { SkeletonView } from '../../components/skeletonview';
import type { AssetSkeleton } from '../../loaders/model';

export class DlgSkeletonEditor extends DialogRenderer<void> {
  private readonly view: SkeletonView;
  private skeletons: AssetSkeleton[];
  private names: string[];
  private index: number;
  constructor(id: string, skeletons: AssetSkeleton[], width?: number, height?: number) {
    super(id, width, height, false, false, false, false);
    this.skeletons = skeletons;
    this.names = skeletons.map((sk) => sk.root!.name ?? '[noname]');
    this.view = new SkeletonView();
    this.index = 0;
    this.view.skeleton = this.skeletons[this.index];
  }
  public static async editSkeleton(
    id: string,
    skeletons: AssetSkeleton[],
    width?: number,
    height?: number
  ): Promise<void> {
    return new DlgSkeletonEditor(id, skeletons, width, height).showModal();
  }
  public doRender(): void {
    const selected = [this.index] as [number];
    if (ImGui.Combo('Select skeleton', selected, this.names)) {
      this.index = selected[0];
      this.view.skeleton = this.skeletons[this.index];
    }
    const size = ImGui.GetContentRegionAvail();
    size.y -= ImGui.GetFrameHeightWithSpacing() + ImGui.GetStyle().ItemSpacing.y;
    ImGui.BeginChild('###SkeletonView', size, false);
    this.view.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    ImGui.Separator();
    if (ImGui.Button('OK')) {
      this.close(null);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
