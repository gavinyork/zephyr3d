import { ImGui } from '@zephyr3d/imgui';
import { AssetInfo, AssetType, Database } from '../storage/db';
import { FilePicker } from './filepicker';
import { DlgProgress } from '../views/dlg/progressdlg';

export class AssetHierarchy {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _assets: AssetInfo[];
  private _selectedAsset: AssetInfo;
  private _zipProgress: DlgProgress;
  constructor() {
    this._assets = [];
    this._selectedAsset = null;
    this._zipProgress = null;
    Database.listAssets().then((assets) => {
      this._assets = assets;
      this._selectedAsset = null;
    });
  }
  get assets() {
    return this._assets;
  }
  get uploadProgress() {
    return this._zipProgress;
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
        }).then((blob) => {
          Database.addAsset({
            name: file.name,
            type,
            blob,
            metadata: { zip: false }
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
      if (files.length === 0) {
        return;
      }
      const folderName = files[0].webkitRelativePath.split('/')[0];
      const fileList = files.map((file) => ({
        path: file.webkitRelativePath.split('/').slice(1).join('/'),
        file
      }));
      this.zipFolder(fileList)
        .then((zip) => {
          console.log(`Zip folder succeeded: ${zip}`);
          Database.addBlob({
            name: folderName,
            data: zip,
            metadata: {}
          }).then((blob) => {
            Database.addAsset({
              name: folderName,
              type,
              blob,
              metadata: { zip: true }
            }).then(() => {
              Database.listAssets().then((assets) => {
                this._assets = assets;
                this._selectedAsset = null;
              });
            });
          });
        })
        .catch((err) => {
          console.error(`Zip folder failed: ${err}`);
        });
    });
  }
  async zipFolder(files: { path: string; file: File }[]) {
    return new Promise<Blob>((resolve, reject) => {
      let worker = new Worker(new URL('./zip.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'success':
            worker?.terminate();
            worker = null;
            this._zipProgress?.close();
            this._zipProgress = null;
            resolve(e.data.data as Blob);
            break;
          case 'error':
            worker?.terminate();
            worker = null;
            this._zipProgress?.close();
            this._zipProgress = null;
            reject(e.data.error);
            break;
          case 'progress':
            if (!this._zipProgress) {
              this._zipProgress = new DlgProgress('Uploading files', true);
            }
            this._zipProgress.progress = `${e.data.current}/${e.data.total}`;
            break;
        }
      };
      worker.onerror = (error) => {
        worker?.terminate();
        worker = null;
        this._zipProgress?.close();
        this._zipProgress = null;
        reject(error);
      };
      worker.postMessage({
        type: 'compress',
        files
      });
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
      if (ImGui.MenuItem('Download')) {
        Database.downloadBlob(asset.blob, asset.metadata.zip);
      }
      ImGui.EndPopup();
    }
    if (isOpen) {
      ImGui.TreePop();
    }
  }
}
