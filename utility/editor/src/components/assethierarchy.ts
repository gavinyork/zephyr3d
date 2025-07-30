import type { DlgProgress } from '../views/dlg/progressdlg';

export class AssetHierarchy {
  private _zipProgress: DlgProgress;
  constructor() {
    this._zipProgress = null;
  }
  get uploadProgress() {
    return this._zipProgress;
  }
  render() {}
  async rgbaToPng(name: string, width: number, height: number, rgbaData: Uint8ClampedArray): Promise<File> {
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
}
