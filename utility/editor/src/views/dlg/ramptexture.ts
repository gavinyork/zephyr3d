import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import type { Texture2D } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';
import { Interpolator } from '@zephyr3d/base';
import { CurveEditor } from '../../components/curveeditor';

export class DlgRampTextureCreator extends ModalDialog {
  private _textureWidth: number;
  private _texture: Texture2D;
  private _interpolator: Interpolator;
  private _textureData: Uint8ClampedArray;
  private _resolve: (data: Uint8ClampedArray) => void;
  private _keyframes: Array<{ time: number; color: Float32Array }>;
  private _selectedKeyframe: number;
  private _isDragging: boolean;
  private _hoverKeyframe: number;
  private _markerWidth: number;
  private _alphaEditor: CurveEditor;
  private _dragStartPos: { x: number; time: number };
  constructor(
    id: string,
    open: boolean,
    width: number,
    height: number,
    resolve: (data: Uint8ClampedArray) => void
  ) {
    super(id, open, width, height);
    this._textureWidth = 256;
    this._textureData = new Uint8ClampedArray(this._textureWidth * 4);
    this._texture = null;
    this._keyframes = [
      { time: 0, color: new Float32Array([0, 0, 0]) },
      { time: 1, color: new Float32Array([1, 1, 1]) }
    ];
    this._selectedKeyframe = 0;
    this._isDragging = false;
    this._hoverKeyframe = -1;
    this._markerWidth = 4;
    this._dragStartPos = null;
    this._alphaEditor = new CurveEditor({
      timeRange: [0, 1],
      valueRange: [0, 1],
      interpolationType: 'linear'
    });

    this.updateInterpolator();
    this._resolve = resolve;
  }
  private updateInterpolator() {
    this._keyframes.sort((a, b) => a.time - b.time);
    const times = new Float32Array(this._keyframes.length);
    const colors = new Float32Array(this._keyframes.length * 3);

    this._keyframes.forEach((kf, index) => {
      times[index] = kf.time;
      colors[index * 3] = kf.color[0];
      colors[index * 3 + 1] = kf.color[1];
      colors[index * 3 + 2] = kf.color[2];
    });

    this._interpolator = new Interpolator('linear', 'vec3', times, colors);
    this.updateTexture();
  }

  private handleEditorInteraction() {
    const mousePos = ImGui.GetMousePos();
    const canvasPos = ImGui.GetCursorScreenPos();
    const canvasSize = ImGui.GetContentRegionAvail();
    const markerSize = 10;

    const timeStart = this._keyframes[0].time;
    const timeEnd = this._keyframes[this._keyframes.length - 1].time;
    const timeDelta = timeEnd - timeStart;

    const relX = (mousePos.x - canvasPos.x) / canvasSize.x;
    const currentTime = timeStart + relX * timeDelta;

    this._hoverKeyframe = -1;
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + ((kf.time - timeStart) / timeDelta) * canvasSize.x;
      if (
        Math.abs(mousePos.x - markerX) < markerSize &&
        mousePos.y >= canvasPos.y &&
        mousePos.y <= canvasPos.y + canvasSize.y
      ) {
        this._hoverKeyframe = index;
      }
    });

    if (ImGui.IsMouseClicked(0)) {
      if (this._hoverKeyframe !== -1) {
        this._selectedKeyframe = this._hoverKeyframe;
        const kf = this._keyframes[this._selectedKeyframe];
        this._dragStartPos = {
          x: mousePos.x,
          time: kf.time
        };
      } else {
        const inCanvas =
          mousePos.x >= canvasPos.x &&
          mousePos.x <= canvasPos.x + canvasSize.x &&
          mousePos.y >= canvasPos.y &&
          mousePos.y <= canvasPos.y + canvasSize.y;

        if (inCanvas) {
          const newColor = new Float32Array(3);
          this._interpolator.interpolate(currentTime, newColor);
          const newKeyframe = {
            time: currentTime,
            color: newColor
          };
          this._keyframes.push(newKeyframe);
          this._dragStartPos = {
            x: mousePos.x,
            time: currentTime
          };
          this.updateInterpolator();
          this._selectedKeyframe = this._keyframes.findIndex(
            (kf) =>
              kf.time === currentTime &&
              kf.color[0] === newColor[0] &&
              kf.color[1] === newColor[1] &&
              kf.color[2] === newColor[2]
          );
        }
      }
    } else if (ImGui.IsMouseClicked(1)) {
      if (
        this._hoverKeyframe !== -1 &&
        this._hoverKeyframe !== 0 &&
        this._hoverKeyframe !== this._keyframes.length - 1
      ) {
        this._keyframes.splice(this._hoverKeyframe, 1);
        if (this._selectedKeyframe === this._hoverKeyframe) {
          this._selectedKeyframe = -1;
          this._dragStartPos = null;
        } else if (this._selectedKeyframe > this._hoverKeyframe) {
          this._selectedKeyframe--;
        }
        this.updateInterpolator();
      }
    }
    // 处理拖动
    if (this._selectedKeyframe !== -1 && this._dragStartPos) {
      if (ImGui.IsMouseDown(0)) {
        const dragDelta = mousePos.x - this._dragStartPos.x;
        if (Math.abs(dragDelta) > 2 || this._isDragging) {
          this._isDragging = true;
          const draggedKeyframe = this._keyframes[this._selectedKeyframe];
          if (this._selectedKeyframe > 0 && this._selectedKeyframe < this._keyframes.length - 1) {
            const timeDelta = (dragDelta / canvasSize.x) * (timeEnd - timeStart);
            draggedKeyframe.time = Math.max(
              timeStart,
              Math.min(timeEnd, this._dragStartPos.time + timeDelta)
            );
            this.updateInterpolator();
            this._selectedKeyframe = this._keyframes.findIndex((kf) => kf === draggedKeyframe);
          }
        }
      } else {
        this._isDragging = false;
        this._dragStartPos = null;
      }
    }
    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1))
    );
    for (let i = 0; i < canvasSize.x; i++) {
      const t = i / canvasSize.x;
      const color = new Float32Array(3);
      this._interpolator.interpolate(t, color);
      drawList.AddRectFilled(
        new ImGui.ImVec2(canvasPos.x + i, canvasPos.y),
        new ImGui.ImVec2(canvasPos.x + i + 1, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(color[0], color[1], color[2], 1))
      );
    }
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + ((kf.time - timeStart) / timeDelta) * canvasSize.x;
      const isSelected = index === this._selectedKeyframe;
      const isHovered = index === this._hoverKeyframe;
      drawList.AddRectFilled(
        new ImGui.ImVec2(markerX - this._markerWidth / 2, canvasPos.y),
        new ImGui.ImVec2(markerX + this._markerWidth / 2, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(kf.color[0], kf.color[1], kf.color[2], 1))
      );
      drawList.AddRect(
        new ImGui.ImVec2(markerX - this._markerWidth / 2 - 1, canvasPos.y - 1),
        new ImGui.ImVec2(markerX + this._markerWidth / 2 + 1, canvasPos.y + canvasSize.y + 1),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0, 0, 0, 0.5)),
        0,
        0,
        1
      );
      drawList.AddRect(
        new ImGui.ImVec2(markerX - this._markerWidth / 2, canvasPos.y),
        new ImGui.ImVec2(markerX + this._markerWidth / 2, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, isSelected ? 1 : isHovered ? 0.8 : 0.5)),
        0,
        0,
        1
      );
    });
    this._hoverKeyframe = -1;
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + kf.time * canvasSize.x;
      if (
        mousePos.x >= markerX - this._markerWidth / 2 &&
        mousePos.x <= markerX + this._markerWidth / 2 &&
        mousePos.y >= canvasPos.y &&
        mousePos.y <= canvasPos.y + canvasSize.y
      ) {
        this._hoverKeyframe = index;
      }
    });
  }

  doRender(): void {
    if (!this._texture) {
      this.updateTexture();
    }
    if (ImGui.BeginChild('##Editor', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), true)) {
      this.handleEditorInteraction();
      ImGui.InvisibleButton('##canvas', ImGui.GetContentRegionAvail());
    }
    ImGui.EndChild();
    if (this._selectedKeyframe !== -1) {
      const kf = this._keyframes[this._selectedKeyframe];
      const color = [kf.color[0], kf.color[1], kf.color[2]] as [number, number, number];
      ImGui.SetNextItemWidth(200);
      if (ImGui.ColorEdit3('##Color', color)) {
        kf.color[0] = color[0];
        kf.color[1] = color[1];
        kf.color[2] = color[2];
        this.updateInterpolator();
      }
    }
    if (ImGui.Button('Ok')) {
      this._resolve(this._textureData);
      this._texture.dispose();
      this.close();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve(null);
      this._texture.dispose();
      this.close();
    }
  }
  private updateTexture() {
    const p = new Float32Array(3);
    for (let i = 0; i < this._textureWidth; i++) {
      const t = i / (this._textureWidth - 1);
      this._interpolator.interpolate(t, p);
      this._textureData[i * 4 + 0] = (p[0] * 255) >> 0;
      this._textureData[i * 4 + 1] = (p[1] * 255) >> 0;
      this._textureData[i * 4 + 2] = (p[2] * 255) >> 0;
      this._textureData[i * 4 + 3] = 255;
    }

    if (!this._texture) {
      this._texture = Application.instance.device.createTexture2D('rgba8unorm', this._textureWidth, 1, {
        samplerOptions: {
          mipFilter: 'none'
        }
      });
    }
    this._texture.update(this._textureData, 0, 0, this._textureWidth, 1);
  }
}
