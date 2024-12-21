import { ImGui } from '@zephyr3d/imgui';
import { AssetInfo, AssetType, Database } from '../storage/db';
import { FilePicker } from './filepicker';

export class AssetHierarchy {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _assets: AssetInfo[];
  private _selectedAsset: AssetInfo;
  constructor() {
    this._assets = [];
    this._selectedAsset = null;
    Database.listAssets().then((assets) => {
      this._assets = assets;
      this._selectedAsset = null;
    });
  }
  get assets() {
    return this._assets;
  }
  render() {
    this.renderAssetGroup('model');
  }
  selectAsset(asset: AssetInfo) {
    this._selectedAsset = asset;
  }
  uploadAssetFile(type: AssetType) {
    FilePicker.chooseFiles(false, '').then((files) => {
      if (files.length > 0) {
        const file = files[0];
        Database.addBlob({
          name: file.name,
          data: file,
          metadata: {}
        }).then((blobUUID) => {
          Database.addAsset({
            name: file.name,
            type: type,
            blobs: { '/': blobUUID },
            metadata: {}
          }).then(() => {
            Database.listAssets().then((assets) => {
              this._assets = assets;
              this._selectedAsset = null;
            });
          });
        });
      }
    });
  }
  uploadAssetDirectory(type: AssetType) {
    FilePicker.chooseDirectory().then((files) => {
      alert(`${files.length} file(s) chosen`);
    });
  }
  deleteAsset(asset: AssetInfo) {
    if (this._selectedAsset === asset) {
      this._selectedAsset = null;
    }
    Database.deleteAsset(asset.uuid);
  }
  private renderAssetGroup(type: AssetType) {
    const isOpen = ImGui.TreeNodeEx(`${type}##__AssetHierarchy__${type}`, AssetHierarchy.baseFlags);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`context_upload`);
    }
    if (ImGui.BeginPopup(`context_upload`)) {
      if (ImGui.MenuItem('Import file...')) {
        this.uploadAssetFile(type);
      }
      if (ImGui.MenuItem('Import directory...')) {
        this.uploadAssetDirectory(type);
      }
      ImGui.EndPopup();
    }
    if (isOpen) {
      for (const asset of this._assets) {
        if (asset.type === type) {
          this.renderAsset(asset);
        }
      }
      ImGui.TreePop();
    }
  }
  private renderAsset(asset: AssetInfo) {
    const label = `${asset.name}##${asset.uuid}`;
    let flags = AssetHierarchy.baseFlags;
    if (this._selectedAsset === asset) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    const isOpen = ImGui.TreeNodeEx(label, flags | ImGui.TreeNodeFlags.Leaf);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectAsset(asset);
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`context_${asset.uuid}`);
    }
    if (ImGui.BeginPopup(`context_${asset.uuid}`)) {
      if (ImGui.MenuItem('Delete')) {
        this.deleteAsset(asset);
      }
      ImGui.EndPopup();
    }
    if (isOpen) {
      ImGui.TreePop();
    }
  }
}
