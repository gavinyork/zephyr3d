import { DRef, Disposable, makeObservable } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import { getDevice } from '@zephyr3d/scene';
import { ProjectService } from '../core/services/project';

type ImageInfo = {
  texture: DRef<Texture2D>;
  selected: boolean;
};
export class ImageList extends makeObservable(Disposable)<{
  update_image: [asset: string, index: number];
  add_image: [asset: string, index: number];
  remove_image: [index: number];
}>() {
  private _images: ImageInfo[];
  private _linearColorSpace: boolean;
  private _isDragging: boolean;
  private _lastMouseX: number;
  private _selectedIndex: number;
  private readonly _spacingX: number;
  private readonly _spacingY: number;
  private _acceptDragDrop: boolean;
  private readonly _defaultImage: DRef<Texture2D>;
  private _selectable: boolean;
  private _maxImageCount: number;
  private readonly _mimeTypes: string[];
  constructor(mimeTypes?: string[]) {
    super();
    this._images = [];
    this._isDragging = false;
    this._linearColorSpace = false;
    this._lastMouseX = 0;
    this._selectedIndex = -1;
    this._spacingX = 16;
    this._spacingY = 5;
    this._selectable = true;
    this._acceptDragDrop = true;
    this._defaultImage = new DRef(getDevice().createTexture2D('rgba8unorm', 1, 1));
    this._defaultImage.get().update(new Uint8Array([0, 0, 0, 255]), 0, 0, 1, 1);
    this._maxImageCount = -1;
    this._mimeTypes = mimeTypes?.slice() ?? [
      'image/jpeg',
      'image/png',
      'image/tga',
      'image/vnd.radiance',
      'image/x-dds',
      'image/webp'
    ];
  }
  get defaultImage() {
    return this._defaultImage.get();
  }
  set defaultImage(tex: Texture2D) {
    this._defaultImage.set(tex);
  }
  get selectable() {
    return this._selectable;
  }
  set selectable(val: boolean) {
    this._selectable = val;
  }
  get linearColorSpace() {
    return this._linearColorSpace;
  }
  set linearColorSpace(val: boolean) {
    this._linearColorSpace = !!val;
  }
  get acceptDragDrop() {
    return this._acceptDragDrop;
  }
  set acceptDragDrop(val: boolean) {
    this._acceptDragDrop = val;
  }
  get maxImageCount() {
    return this._maxImageCount;
  }
  set maxImageCount(val: number) {
    this._maxImageCount = val;
  }
  private calcTotalWidth(height: number): number {
    return (height + this._spacingX) * this._images.length + this._spacingX;
  }
  insertImage(img: Texture2D, index: number) {
    if (
      index >= 0 &&
      index <= this._images.length &&
      (this._maxImageCount < 0 || this._images.length < this._maxImageCount)
    ) {
      this._images.splice(index, 0, {
        texture: new DRef(img),
        selected: false
      });
    }
  }
  replaceImage(img: Texture2D, index: number) {
    if (index >= 0 && index < this._images.length) {
      this._images[index].texture.set(img);
    }
  }
  addImage(img: Texture2D) {
    if (this._maxImageCount < 0 || this._images.length < this._maxImageCount) {
      this._images.push({
        texture: new DRef(img),
        selected: false
      });
    }
  }
  getImage(index: number): Texture2D {
    return this._images[index]?.texture?.get() ?? null;
  }
  clear() {
    for (const img of this._images) {
      img.texture.dispose();
    }
    this._images = [];
  }
  scrollToSelected(height: number) {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._images.length) {
      let offsetX = 0;
      const availableHeight = height;
      for (let i = 0; i < this._selectedIndex; i++) {
        offsetX += availableHeight + this._spacingX;
      }
      const windowWidth = ImGui.GetWindowWidth();
      const imgWidth = availableHeight;
      const centeredOffset = offsetX - (windowWidth - imgWidth) * 0.5;
      ImGui.SetScrollX(Math.max(centeredOffset, 0));
    }
  }
  get selected() {
    return this._selectedIndex;
  }
  set selected(index: number) {
    if (index >= 0 && index < this._images.length) {
      this._selectedIndex = index;
      for (let i = 0; i < this._images.length; i++) {
        this._images[i].selected = i === index;
      }
    }
  }
  acceptTarget(index: number, replace: boolean) {
    if (this._acceptDragDrop && ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('ASSET');
      if (payload) {
        const data = payload.Data as { isDir: boolean; path: string }[];
        if (data.length !== 1 || data[0].isDir) {
          return;
        }
        const assetId = data[0].path;
        const mimeType = ProjectService.VFS.guessMIMEType(assetId);
        if (this._mimeTypes.includes(mimeType)) {
          const path = assetId;
          ProjectService.serializationManager
            .fetchTexture<Texture2D>(path, {
              linearColorSpace: this._linearColorSpace
            })
            .then((tex) => {
              if (tex?.isTexture2D()) {
                if (replace) {
                  this.replaceImage(tex, index);
                  this.dispatchEvent('update_image', path, index);
                } else {
                  this.insertImage(tex, index);
                  this.dispatchEvent('add_image', path, index);
                }
              } else {
                console.error('Invalid texture');
              }
            })
            .catch((err) => {
              console.error(`Load asset failed: ${path}: ${err}`);
            });
        }
      }
      ImGui.EndDragDropTarget();
    }
  }
  drawSpacing(x: number, y: number, size: ImGui.ImVec2, index: number) {
    ImGui.SetCursorPosX(x + 4);
    ImGui.SetCursorPosY(y + 3);
    ImGui.InvisibleButton(`##spacing${index}`, new ImGui.ImVec2(size.x - 8, size.y - 6));
    this.acceptTarget(index, false);
  }
  render(size: ImGui.ImVec2) {
    ImGui.PushID(`${ImGui.GetCurrentWindow().ID}`);
    let selectionChanged = false;
    const availableWidth = size.x;
    const availableHeight = size.y;
    const totalHeight = availableHeight - ImGui.GetStyle().ScrollbarSize - 2 * this._spacingY;
    const totalWidth = this.calcTotalWidth(totalHeight);
    const allowDragging = totalWidth > availableWidth;
    let flags = ImGui.WindowFlags.AlwaysHorizontalScrollbar;
    if (!allowDragging) {
      flags |= ImGui.WindowFlags.NoScrollWithMouse;
    }
    ImGui.BeginChild('ImageList', size, true, flags);
    if (allowDragging) {
      ImGui.Dummy(new ImGui.ImVec2(totalWidth, 1));
      ImGui.SetCursorPos(new ImGui.ImVec2(0, 0));
    }
    if (allowDragging && ImGui.IsWindowHovered() && ImGui.IsMouseDown(ImGui.MouseButton.Left)) {
      if (!this._isDragging) {
        this._isDragging = true;
        this._lastMouseX = ImGui.GetIO().MousePos.x;
      } else {
        const deltaX = ImGui.GetIO().MousePos.x - this._lastMouseX;
        ImGui.SetScrollX(ImGui.GetScrollX() - deltaX);
        this._lastMouseX = ImGui.GetIO().MousePos.x;
      }
    } else {
      this._isDragging = false;
    }
    const scrollX = ImGui.GetScrollX();
    const visibleStartX = scrollX;
    const visibleEndX = scrollX + availableWidth;
    const spacingSize = new ImGui.ImVec2(this._spacingX, totalHeight);
    this.drawSpacing(0, this._spacingY, spacingSize, 0);
    let cursorX = this._spacingX;
    for (let i = 0; i < this._images.length; i++) {
      ImGui.PushID(i);
      const img = this._images[i];
      const tex = img.texture.get() ?? this.defaultImage;
      const imgWidth = totalHeight;
      ImGui.SetCursorPosX(cursorX);
      ImGui.SetCursorPosY(this._spacingY);
      cursorX += imgWidth + this._spacingX;
      let b = false;
      if (cursorX - this._spacingX >= visibleStartX && cursorX - imgWidth - this._spacingX <= visibleEndX) {
        if (img.selected) {
          b = true;
          ImGui.PushStyleColor(ImGui.Col.Border, new ImGui.ImVec4(1.0, 0.5, 0.0, 1.0));
          ImGui.PushStyleVar(ImGui.StyleVar.FrameBorderSize, 3);
          ImGui.PushStyleVar(ImGui.StyleVar.FramePadding, new ImGui.ImVec2(3, 3));
          ImGui.PushStyleColor(ImGui.Col.ButtonActive, new ImGui.ImVec4(0.8, 0.8, 0.8, 0.5));
          ImGui.PushStyleColor(ImGui.Col.ButtonHovered, new ImGui.ImVec4(0.7, 0.7, 0.7, 0.5));
        }
        if (
          ImGui.ImageButton(
            tex,
            new ImGui.ImVec2(imgWidth, totalHeight),
            new ImGui.ImVec2(0, 0),
            new ImGui.ImVec2(1, 1),
            0
          ) &&
          this._selectable
        ) {
          if (this._selectedIndex !== i) {
            this._selectedIndex = i;
            for (const img of this._images) {
              img.selected = false;
            }
            this._images[i].selected = true;
            selectionChanged = true;
          }
        }
        this.acceptTarget(i, true);
        if (b) {
          ImGui.PopStyleColor(3);
          ImGui.PopStyleVar(2);
        }
        this.drawSpacing(cursorX - this._spacingX, this._spacingY, spacingSize, i + 1);
      } else {
        ImGui.Dummy(new ImGui.ImVec2(imgWidth, totalHeight));
      }
      ImGui.PopID();
    }
    ImGui.EndChild();
    ImGui.PopID();
    return selectionChanged;
  }
  protected onDispose() {
    super.onDispose();
    this.clear();
    this._defaultImage.dispose();
  }
}
