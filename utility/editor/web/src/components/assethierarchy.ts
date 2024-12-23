import { ImGui } from '@zephyr3d/imgui';
import { AssetInfo, AssetType, Database } from '../storage/db';
import { FilePicker } from './filepicker';
import { DlgProgress } from '../views/dlg/progressdlg';
import { ModelAsset } from '../helpers/model';
import { Dialog } from '../views/dlg/dlg';
import { enableWorkspaceDragging } from './dragdrop';

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
  async uploadFiles(type: AssetType, zip: Blob, folderName: string, paths: string[]) {
    const blob = await Database.addBlob({
      data: zip
    });
    const pkg = await Database.addPackage({
      blob,
      name: folderName,
      size: zip.size
    });
    for (const path of paths) {
      await Database.addAsset({
        name: path.split('/').pop(),
        path: path,
        type,
        pkg
      });
    }
  }
  async uploadAssetFile(type: AssetType) {
    const files = await FilePicker.chooseFiles(false, '');
    const file = files[0];
    if (ModelAsset.extensions.findIndex((ext) => file.name.toLowerCase().endsWith(ext)) < 0) {
      Dialog.messageBox('Error', 'Invalid file type. Only glb, gltf files are supported.');
      return;
    }
    const zip = await this.zipFiles([{ path: file.name, file }]);
    await this.uploadFiles(type, zip, file.name, [file.name]);
    this._assets = await Database.listAssets();
    this._selectedAsset = null;
  }
  async uploadAssetDirectory(type: AssetType) {
    const files = await FilePicker.chooseDirectory();
    if (files.length === 0) {
      return;
    }
    const folderName = files[0].webkitRelativePath.split('/')[0];
    const assetFiles: string[] = [];
    const fileList = files.map((file) => {
      const path = file.webkitRelativePath.split('/').slice(1).join('/');
      const filename = file.name.toLowerCase();
      if (ModelAsset.extensions.findIndex((ext) => filename.endsWith(ext)) >= 0) {
        assetFiles.push(path);
      }
      return {
        path: file.webkitRelativePath.split('/').slice(1).join('/'),
        file
      };
    });
    if (assetFiles.length === 0) {
      Dialog.messageBox('Error', 'No glb or gltf files found in the selected directory.');
      return;
    }
    const zip = await this.zipFiles(fileList);
    await this.uploadFiles(type, zip, folderName, assetFiles);
    this._assets = await Database.listAssets();
    this._selectedAsset = null;
  }
  async zipFiles(files: { path: string; file: File }[]) {
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
        Database.getPackage(asset.pkg)
          .then((pkg) => {
            Database.downloadBlob(pkg.blob, `${pkg.name}.zip`);
          })
          .catch((error) => {
            Dialog.messageBox('Error', `Failed to download package: ${error}`);
          });
      }
      ImGui.EndPopup();
    }
    enableWorkspaceDragging('ASSET', asset);
    if (isOpen) {
      ImGui.TreePop();
    }
  }
}
