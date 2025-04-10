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
    const assets = (await Database.listAssets()).filter((val) => !val.scene);
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
          this._assetRegistry.registerAsset(asset.uuid, asset.type, asset.path, asset.name);
        }
      }
    }
  }
  async uploadFiles(
    type: AssetType,
    zip: Blob,
    mimeType: string,
    folderName: string,
    paths: string[],
    names?: string[]
  ) {
    const blob = await Database.putBlob({
      data: zip,
      mimeType
    });
    const pkg = await Database.putPackage({
      blob,
      name: folderName,
      size: zip.size
    });
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const name = names?.[i] ?? path;
      await Database.putAsset({
        name,
        path,
        thumbnail: '',
        type,
        pkg,
        scene: ''
      });
    }
  }
  async uploadRampTexture() {
    const tex = await Dialog.createRampTexture('Create ramp texture', 400, 200);
    if (tex) {
      const file = await this.rgbaToPng(`${crypto.randomUUID()}.png`, tex.data.byteLength >> 2, 1, tex.data);
      await this.doUploadAssetFile('texture', [file], tex.name);
      this._selectedAsset = null;
      await this.listAssets();
    }
  }
  async uploadAssetFile(type: AssetType) {
    const files = await FilePicker.chooseFiles(true, '');
    await this.doUploadAssetFile(type, files);
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
    await this.uploadFiles(type, zip, null, folderName, assetFiles);
    this._selectedAsset = null;
    await this.listAssets();
  }
  async zipFiles(files: { path: string; file: File }[]) {
    return Database.compressFiles(
      files,
      () => {
        this._zipProgress?.close();
        this._zipProgress = null;
      },
      () => {
        this._zipProgress?.close();
        this._zipProgress = null;
      },
      (current, total) => {
        if (!this._zipProgress) {
          this._zipProgress = new DlgProgress('Uploading files', true);
        }
        this._zipProgress.progress = `${current}/${total}`;
      }
    );
  }
  async doUploadAssetFile(type: AssetType, files: File[], name?: string) {
    for (const file of files) {
      const extensions =
        type === 'model'
          ? AssetStore.modelExtensions
          : type === 'texture'
          ? AssetStore.textureExtensions
          : [];
      if (extensions.findIndex((ext) => file.name.toLowerCase().endsWith(ext)) < 0) {
        Dialog.messageBox('Error', `Invalid file type. Only ${extensions.join(', ')} files are supported.`);
        return;
      }
      const zip = await this.zipFiles([{ path: file.name, file }]);
      await this.uploadFiles(type, zip, null, file.name, [file.name], name ? [name] : null);
    }
    this._selectedAsset = null;
    await this.listAssets();
  }
  private async rgbaToPng(
    name: string,
    width: number,
    height: number,
    rgbaData: Uint8ClampedArray
  ): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(rgbaData), width, height);
    ctx.putImageData(imageData, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const file = new File([blob], name, {
          type: 'image/png',
          lastModified: Date.now()
        });
        resolve(file);
      }, 'image/png');
    });
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
      if (ImGui.MenuItem('Import files...')) {
        this.uploadAssetFile(type);
      }
      if (type === 'model' && ImGui.MenuItem('Import directory...')) {
        this.uploadAssetDirectory(type);
      }
      if (type === 'texture') {
        if (ImGui.MenuItem('New ramp texture...')) {
          this.uploadRampTexture();
        }
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
          const opened = ImGui.TreeNodeEx(asset.pkg.name, AssetHierarchy.baseFlags);
          if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
            ImGui.OpenPopup(`context_${asset.pkg.uuid}`);
          }
          if (ImGui.BeginPopup(`context_${asset.pkg.uuid}`)) {
            if (ImGui.MenuItem('Rename')) {
              Dialog.rename('Rename Package', asset.pkg.name, 300).then((name) => {
                name = name ? name.trim() : name;
                if (name) {
                  if (this._assets.findIndex((val) => val.pkg.name === name) >= 0) {
                    Dialog.messageBox('Zephyr3d', `Package '${name}' already exists`);
                  } else {
                    asset.pkg.name = name;
                    Database.putPackage(asset.pkg);
                  }
                }
              });
            }
            ImGui.EndPopup();
          }
          if (opened) {
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
      if (asset.type === 'model' && ImGui.MenuItem('Add to scene')) {
        eventBus.dispatchEvent('scene_add_asset', asset);
      }
      if (ImGui.MenuItem('Rename')) {
        Dialog.rename('Rename Asset', asset.name, 300).then((name) => {
          if (name) {
            asset.name = name;
            this._assetRegistry.renameAsset(asset.uuid, name);
            Database.putAsset(asset);
          }
        });
      }
      if (ImGui.MenuItem('Export')) {
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
