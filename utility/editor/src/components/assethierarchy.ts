import { ImGui } from '@zephyr3d/imgui';
import type { DBAssetInfo, DBAssetPackage } from '../storage/db';
import { Database } from '../storage/db';
import { FilePicker } from './filepicker';
import { DlgProgress } from '../views/dlg/progressdlg';
import { AssetStore } from '../helpers/assetstore';
import { Dialog } from '../views/dlg/dlg';
import { enableWorkspaceDragging } from './dragdrop';
import { eventBus } from '../core/eventbus';
import type { AssetType } from '@zephyr3d/scene';
import type { AssetRegistry } from '@zephyr3d/scene';

export class AssetHierarchy {
  private static baseFlags = ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.SpanAvailWidth;
  private _assets: { pkg: DBAssetPackage; assets: DBAssetInfo[] }[];
  private _selectedAsset: DBAssetInfo;
  private _zipProgress: DlgProgress;
  private _assetRegistry: AssetRegistry;
  constructor(assetRegistry: AssetRegistry) {
    this._assets = [];
    this._selectedAsset = null;
    this._zipProgress = null;
    this._assetRegistry = assetRegistry;
    this.listAssets();
  }
  get assets() {
    return this._assets;
  }
  get uploadProgress() {
    return this._zipProgress;
  }
  get assetRegistry() {
    return this._assetRegistry;
  }
  render() {
    this.renderAssetGroup('model');
    this.renderAssetGroup('texture');
  }
  selectAsset(asset: DBAssetInfo) {
    this._selectedAsset = asset;
  }
  async listAssets() {
    const packages = await Database.listPackages();
    const assets = await Database.listAssets();
    this._assets = packages.map((pkg) => {
      const assetsInPkg = assets.filter((asset) => asset.pkg === pkg.uuid);
      return {
        pkg,
        assets: assetsInPkg
      };
    });
    for (const assets of this._assets) {
      for (const asset of assets.assets) {
        if (!this._assetRegistry.getAssetInfo(asset.uuid)) {
          this._assetRegistry.registerAsset(asset.uuid, asset.type, asset.uuid);
        }
      }
    }
  }
  async uploadFiles(type: AssetType, zip: Blob, folderName: string, paths: string[]) {
    const blob = await Database.putBlob({
      data: zip
    });
    const pkg = await Database.putPackage({
      blob,
      name: folderName,
      size: zip.size
    });
    for (const path of paths) {
      await Database.pubAsset({
        name: path.split('/').pop(),
        path: path,
        thumbnail: '',
        type,
        pkg
      });
    }
  }
  async uploadAssetFile(type: AssetType) {
    const files = await FilePicker.chooseFiles(false, '');
    const file = files[0];
    const extensions =
      type === 'model' ? AssetStore.modelExtensions : type === 'texture' ? AssetStore.textureExtensions : [];
    if (extensions.findIndex((ext) => file.name.toLowerCase().endsWith(ext)) < 0) {
      Dialog.messageBox('Error', `Invalid file type. Only ${extensions.join(', ')} files are supported.`);
      return;
    }
    const zip = await this.zipFiles([{ path: file.name, file }]);
    await this.uploadFiles(type, zip, file.name, [file.name]);
    this._selectedAsset = null;
    await this.listAssets();
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
      if (AssetStore.modelExtensions.findIndex((ext) => filename.endsWith(ext)) >= 0) {
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
    this._selectedAsset = null;
    await this.listAssets();
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
  deleteAsset(asset: DBAssetInfo) {
    if (this._selectedAsset === asset) {
      this._selectedAsset = null;
    }
    Database.deleteAsset(asset.uuid);
  }
  private renderAssetGroup(type: AssetType) {
    ImGui.PushID(type);
    const isOpen = ImGui.TreeNodeEx(
      `${type}##__AssetHierarchy__${type}`,
      AssetHierarchy.baseFlags | ImGui.TreeNodeFlags.DefaultOpen
    );
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`context_upload`);
    }
    if (ImGui.BeginPopup(`context_upload`)) {
      if (ImGui.MenuItem('Import file...')) {
        this.uploadAssetFile(type);
      }
      if (type === 'model' && ImGui.MenuItem('Import directory...')) {
        this.uploadAssetDirectory(type);
      }
      ImGui.EndPopup();
    }
    if (isOpen) {
      for (let i = 0; i < this._assets.length; i++) {
        const asset = this._assets[i];
        const grouped = asset.assets.length > 1;
        const assetsInPkg = asset.assets.filter((a) => a.type === type);
        if (assetsInPkg.length === 0) {
          continue;
        }
        if (grouped) {
          ImGui.PushID(i);
          if (ImGui.TreeNodeEx(asset.pkg.name, AssetHierarchy.baseFlags)) {
            for (let j = 0; j < assetsInPkg.length; j++) {
              this.renderAsset(assetsInPkg[j]);
            }
            ImGui.TreePop();
          }
          ImGui.PopID();
        } else {
          this.renderAsset(assetsInPkg[0]);
        }
      }
      ImGui.TreePop();
    }
    ImGui.PopID();
  }
  private renderAsset(asset: DBAssetInfo) {
    const label = `${asset.path}##${asset.uuid}`;
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
      if (ImGui.MenuItem('Add to scene')) {
        eventBus.dispatchEvent('scene_add_asset', asset);
      }
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
    enableWorkspaceDragging(asset, `ASSET:${asset.type}`, asset);
    if (isOpen) {
      ImGui.TreePop();
    }
  }
}
