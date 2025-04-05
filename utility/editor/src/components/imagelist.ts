import { makeEventTarget } from '@zephyr3d/base';
import { Texture2D } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import { AssetRegistry, DRef } from '@zephyr3d/scene';
import type { DBAssetInfo } from '../storage/db';

type ImageInfo = {
  texture: DRef<Texture2D>;
  selected: boolean;
};
export class ImageList extends makeEventTarget(Object)<{
  add_image: [asset: string];
}>() {
  private _images: ImageInfo[];
  private _isDragging: boolean;
  private _lastMouseX: number;
  private _selectedIndex: number;
  private _spacing: number;
  private _acceptDragDrop: boolean;
  private _assetRegistry: AssetRegistry;
  constructor(assetRegistry: AssetRegistry) {
    super();
    this._images = [];
    this._isDragging = false;
    this._lastMouseX = 0;
    this._selectedIndex = -1;
    this._spacing = 5;
    this._acceptDragDrop = true;
    this._assetRegistry = assetRegistry;
  }
  get acceptDragDrop() {
    return this._acceptDragDrop;
  }
  set acceptDragDrop(val: boolean) {
    this._acceptDragDrop = val;
  }
  private calcTotalWidth(height: number): number {
    let totalWidth = 0;
    for (const img of this._images) {
      totalWidth += (height * img.texture.get().width) / img.texture.get().height + this._spacing;
    }
    return totalWidth;
  }
  addImage(img: Texture2D) {
    this._images.push({
      texture: new DRef(img),
      selected: false
    });
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
        const tex = this._images[i].texture.get();
        offsetX += availableHeight * (tex.width / tex.height) + this._spacing;
      }
      const currentTex = this._images[this._selectedIndex].texture.get();
      const windowWidth = ImGui.GetWindowWidth();
      const imgWidth = availableHeight * (currentTex.width / currentTex.height);
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
  render(size: ImGui.ImVec2) {
    ImGui.PushID(`${ImGui.GetCurrentWindow().ID}`);
    let selectionChanged = false;
    const availableWidth = size.x;
    const availableHeight = size.y;
    const totalHeight = availableHeight - ImGui.GetStyle().ScrollbarSize - 2 * this._spacing;
    const totalWidth = this.calcTotalWidth(totalHeight);
    const allowDragging = totalWidth > availableWidth;
    let flags = ImGui.WindowFlags.AlwaysHorizontalScrollbar;
    if (!allowDragging) {
      flags |= ImGui.WindowFlags.NoScrollWithMouse;
    }
    ImGui.BeginChild('ImageList', size, true, flags);
    if (allowDragging) {
      ImGui.Dummy(new ImGui.ImVec2(totalWidth - this._spacing, 1));
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
    let cursorX = this._spacing;
    for (let i = 0; i < this._images.length; i++) {
      ImGui.PushID(i);
      const img = this._images[i];
      const tex = img.texture.get();
      const imgWidth = totalHeight * (tex.width / tex.height);
      ImGui.SetCursorPosX(cursorX);
      ImGui.SetCursorPosY(this._spacing);
      cursorX += imgWidth + this._spacing;
      let b = false;
      if (cursorX - this._spacing >= visibleStartX && cursorX - imgWidth - this._spacing <= visibleEndX) {
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
          )
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
        if (b) {
          ImGui.PopStyleColor(3);
          ImGui.PopStyleVar(2);
        }
      } else {
        ImGui.Dummy(new ImGui.ImVec2(imgWidth, totalHeight));
      }
      ImGui.PopID();
    }
    ImGui.EndChild();
    if (this._acceptDragDrop) {
      ImGui.SetCursorPos(new ImGui.ImVec2(0, 0)); // 重置光标到 Child 窗口的左上角
      ImGui.InvisibleButton('##droptarget', size, ImGui.ButtonFlags.MouseButtonLeft);
      if (ImGui.BeginDragDropTarget()) {
        const payload = ImGui.AcceptDragDropPayload('ASSET:texture');
        if (payload) {
          const assetId = (payload.Data as DBAssetInfo).uuid;
          const assetInfo = this._assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            this._assetRegistry
              .fetchTexture<Texture2D>(assetId, assetInfo.textureOptions)
              .then((tex) => {
                if (tex?.isTexture2D()) {
                  this.addImage(tex);
                } else {
                  console.error('Invalid texture');
                }
              })
              .catch((err) => {
                console.error(`Load asset failed: ${assetId}: ${err}`);
              });
          }
        }
        ImGui.EndDragDropTarget();
      }
    }
    ImGui.PopID();
    return selectionChanged;
  }
}
