import { ImGui } from '@zephyr3d/imgui';
import type { Texture2D } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';
import { Interpolator, Observable } from '@zephyr3d/base';
import { CurveEditor } from './curveeditor';

export class RampTextureCreator extends Observable<{
  preview_position: [{ key: number; value: number[] }];
}> {
  private readonly _textureWidth: number;
  private _texture: Texture2D;
  private _interpolator: Interpolator;
  private readonly _textureData: Uint8ClampedArray<ArrayBuffer>;
  private readonly _keyframes: Array<{ time: number; color: Float32Array }>;
  private _selectedKeyframe: number;
  private _isDragging: boolean;
  private _hoverKeyframe: number;
  private readonly _markerWidth: number;
  private readonly _alphaEditor: CurveEditor;
  private _showAlpha: boolean;
  private _dragStartPos: { x: number; time: number };
  private readonly _hasAlpha: boolean;
  private _changed: boolean;
  private _positionIndicator: number;
  private _isDraggingIndicator: boolean;
  private readonly _indicatorWidth: number;

  constructor(hasAlpha: boolean, rgbInterpolator?: Interpolator, alphaInterpolator?: Interpolator) {
    super();
    this._hasAlpha = !!hasAlpha;
    this._textureWidth = 256;
    this._textureData = new Uint8ClampedArray(this._textureWidth * 4);
    this._texture = null;
    this._keyframes = rgbInterpolator
      ? [...rgbInterpolator.inputs].map((t) => ({
          time: t,
          color: rgbInterpolator.interpolate(t, new Float32Array(3))
        }))
      : [
          { time: 0, color: new Float32Array([0, 0, 0]) },
          { time: 1, color: new Float32Array([1, 1, 1]) }
        ];
    this._interpolator = rgbInterpolator ?? null;
    this._selectedKeyframe = 0;
    this._isDragging = false;
    this._hoverKeyframe = -1;
    this._markerWidth = 4;
    this._showAlpha = this._hasAlpha;
    this._dragStartPos = null;

    // 初始化位置指示器
    this._positionIndicator = 0;
    this._isDraggingIndicator = false;
    this._indicatorWidth = 2;

    this._alphaEditor = this._hasAlpha
      ? alphaInterpolator
        ? new CurveEditor(alphaInterpolator, {
            timeRange: [0, 1],
            valueRange: [0, 1],
            interpolationType: 'linear',
            drawLabels: false,
            drawHints: false
          })
        : new CurveEditor(
            [
              {
                x: 0,
                value: [1]
              },
              {
                x: 1,
                value: [1]
              }
            ],
            {
              timeRange: [0, 1],
              valueRange: [0, 1],
              interpolationType: 'linear',
              drawLabels: false,
              drawHints: false
            }
          )
      : null;
    if (this._alphaEditor) {
      this._alphaEditor.on('curve_changed', this.onAlphaChanged, this);
      this._alphaEditor.on('preview_position', this.preview, this);
    }
    this.updateInterpolator(!rgbInterpolator);
  }
  get changed() {
    return this._changed;
  }
  private onAlphaChanged() {
    this.updateTexture();
  }
  private preview(data?: { key: number; value: number[] }) {
    if (data && !this._isDraggingIndicator) {
      this._positionIndicator = data.key;
    }
    const currentColor = [0, 0, 0];
    this._interpolator.interpolate(this._positionIndicator, currentColor);
    if (this._alphaEditor) {
      currentColor.push(this._alphaEditor.getValue(this._positionIndicator)[0]);
    }
    this.dispatchEvent('preview_position', { key: this._positionIndicator, value: currentColor });
  }
  private updateInterpolator(changed = true) {
    this._keyframes.sort((a, b) => a.time - b.time);
    const times = new Float32Array(this._keyframes.length);
    const colors = new Float32Array(this._keyframes.length * 3);

    this._keyframes.forEach((kf, index) => {
      times[index] = kf.time;
      colors[index * 3] = kf.color[0];
      colors[index * 3 + 1] = kf.color[1];
      colors[index * 3 + 2] = kf.color[2];
    });
    if (!this._interpolator) {
      this._interpolator = new Interpolator('linear', 'vec3', times, colors);
    } else {
      this._interpolator.inputs = times;
      this._interpolator.outputs = colors;
    }
    this.updateTexture();
    this._changed = changed;
  }

  // 新增：检查鼠标是否在指示器上
  private isMouseOnIndicator(
    mousePos: ImGui.ImVec2,
    canvasPos: ImGui.ImVec2,
    canvasSize: ImGui.ImVec2
  ): boolean {
    const indicatorX = canvasPos.x + this._positionIndicator * canvasSize.x;
    const indicatorHitWidth = Math.max(this._indicatorWidth * 2, 6); // 最小6像素的点击区域

    return (
      Math.abs(mousePos.x - indicatorX) <= indicatorHitWidth / 2 &&
      mousePos.y >= canvasPos.y &&
      mousePos.y <= canvasPos.y + canvasSize.y
    );
  }

  // 新增：绘制位置指示器
  private drawPositionIndicator(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2, canvasSize: ImGui.ImVec2) {
    const triangleSize = 10;
    const indicatorX = canvasPos.x + this._positionIndicator * canvasSize.x;
    const indicatorTop = canvasPos.y;
    const indicatorBottom = canvasPos.y + canvasSize.y;

    // 绘制指示器线条
    drawList.AddLine(
      new ImGui.ImVec2(indicatorX, indicatorTop),
      new ImGui.ImVec2(indicatorX, indicatorBottom),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 0.9)), // 白色半透明
      this._indicatorWidth
    );

    // 绘制指示器顶部三角形
    drawList.AddTriangleFilled(
      new ImGui.ImVec2(indicatorX + triangleSize * 0.5, canvasPos.y),
      new ImGui.ImVec2(indicatorX - triangleSize * 0.5, canvasPos.y),
      new ImGui.ImVec2(indicatorX + 1, canvasPos.y + triangleSize),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 0.9))
    );

    // 绘制指示器底部三角形
    drawList.AddTriangleFilled(
      new ImGui.ImVec2(indicatorX + triangleSize * 0.5, canvasPos.y + canvasSize.y),
      new ImGui.ImVec2(indicatorX - triangleSize * 0.5, canvasPos.y + canvasSize.y),
      new ImGui.ImVec2(indicatorX + 1, canvasPos.y + canvasSize.y - triangleSize),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 0.9))
    );

    // 如果正在拖拽，绘制高亮边框
    if (this._isDraggingIndicator) {
      drawList.AddLine(
        new ImGui.ImVec2(indicatorX, indicatorTop),
        new ImGui.ImVec2(indicatorX, indicatorBottom),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 0, 1)), // 黄色高亮
        this._indicatorWidth + 2
      );
    }
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

    // 检查鼠标是否在位置指示器上
    const isOnIndicator = this.isMouseOnIndicator(mousePos, canvasPos, canvasSize);

    // 设置鼠标光标
    if (isOnIndicator || this._isDraggingIndicator) {
      ImGui.SetMouseCursor(ImGui.MouseCursor.ResizeEW);
    }

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
      if (isOnIndicator) {
        // 开始拖拽位置指示器
        this._isDraggingIndicator = true;
      } else if (this._hoverKeyframe !== -1) {
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
          this._selectedKeyframe = Math.min(this._selectedKeyframe, this._keyframes.length - 1);
          this._dragStartPos = null;
        } else if (this._selectedKeyframe > this._hoverKeyframe) {
          this._selectedKeyframe--;
        }
        this.updateInterpolator();
      }
    }

    // 处理位置指示器拖拽
    if (this._isDraggingIndicator) {
      if (ImGui.IsMouseDown(0)) {
        // 更新指示器位置
        const newPosition = Math.max(0, Math.min(1, relX));
        if (Math.abs(newPosition - this._positionIndicator) > 0.001) {
          this._positionIndicator = newPosition;
          if (this._alphaEditor) {
            this._alphaEditor.positionIndicatorTime = newPosition;
          }
        }
        this.preview();
      } else {
        // 停止拖拽
        this._isDraggingIndicator = false;
      }
    }

    // 处理关键帧拖拽
    if (this._selectedKeyframe !== -1 && this._dragStartPos && !this._isDraggingIndicator) {
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

    // 绘制画布
    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1))
    );
    this.drawCheckerboard(drawList, canvasPos, canvasSize, 10, 10);
    drawList.AddImage(
      this._texture,
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y)
    );

    // 绘制关键帧标记
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

    // 绘制位置指示器
    this.drawPositionIndicator(drawList, canvasPos, canvasSize);

    // 更新hover状态
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

  render(): void {
    if (!this._texture) {
      this.updateTexture();
    }
    let height = ImGui.GetContentRegionAvail().y - ImGui.GetStyle().ItemSpacing.y;
    if (this._alphaEditor) {
      height >>= 1;
    }
    if (ImGui.BeginChild('RGBEditor', new ImGui.ImVec2(0, height), true, ImGui.WindowFlags.NoScrollbar)) {
      ImGui.SetNextWindowBgAlpha(1);
      if (
        (ImGui.BeginChild(`CanvasContainer`, new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing())),
        true,
        ImGui.WindowFlags.NoScrollbar)
      ) {
        this.handleEditorInteraction();
        ImGui.InvisibleButton('Canvas', ImGui.GetContentRegionAvail());
      }
      ImGui.EndChild();
      if (this._selectedKeyframe !== -1) {
        const kf = this._keyframes[this._selectedKeyframe];
        const color = [kf.color[0], kf.color[1], kf.color[2]] as [number, number, number];
        ImGui.Text('RGB');
        ImGui.SameLine(ImGui.GetWindowWidth() - 200 - ImGui.GetStyle().WindowPadding.x);
        ImGui.SetNextItemWidth(200);
        if (ImGui.ColorEdit3('KeyframeColor', color)) {
          kf.color[0] = color[0];
          kf.color[1] = color[1];
          kf.color[2] = color[2];
          this.updateInterpolator();
        }
      }
    }
    ImGui.EndChild();
    if (this._alphaEditor) {
      if (ImGui.BeginChild('AlphaEditor', new ImGui.ImVec2(0, height), true, ImGui.WindowFlags.NoScrollbar)) {
        if (
          (ImGui.BeginChild('CurveEditor', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2)),
          true,
          ImGui.WindowFlags.NoScrollbar)
        ) {
          ImGui.PushID('CurveEditor');
          this._alphaEditor.renderCurveView(ImGui.GetContentRegionAvail());
          ImGui.PopID();
        }
        ImGui.EndChild();
        ImGui.Text('Alpha');
        const showAlpha = [this._showAlpha] as [boolean];
        if (ImGui.Checkbox('Show Alpha', showAlpha)) {
          this._showAlpha = showAlpha[0];
          this.updateTexture();
        }
      }
      ImGui.EndChild();
    }
  }

  private drawCheckerboard(
    drawList: ImGui.DrawList,
    pos: ImGui.ImVec2,
    size: ImGui.ImVec2,
    squaresSizeX: number,
    squaresSizeY: number
  ) {
    const col1 = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 1));
    const col2 = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.5, 0.5, 0.5, 1));
    const dimX = Math.ceil(size.x / squaresSizeX);
    const dimY = Math.ceil(size.y / squaresSizeY);
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        const squarePosStart = new ImGui.ImVec2(pos.x + x * squaresSizeX, pos.y + y * squaresSizeY);
        const squarePosEnd = new ImGui.ImVec2(
          Math.min(pos.x + size.x, squarePosStart.x + squaresSizeX),
          Math.min(pos.y + size.y, squarePosStart.y + squaresSizeY)
        );
        const col = (x + y) % 2 == 0 ? col1 : col2;
        drawList.AddRectFilled(squarePosStart, squarePosEnd, col);
      }
    }
  }

  setKeyframeValue(value: number[]) {
    if (this._selectedKeyframe >= 0) {
      this._keyframes[this._selectedKeyframe].color[0] = value[0];
      this._keyframes[this._selectedKeyframe].color[1] = value[1];
      this._keyframes[this._selectedKeyframe].color[2] = value[2];
      this.updateInterpolator();
    }
    if (value.length > 3 && this._alphaEditor) {
      this._alphaEditor.setKeyframeValue([value[3]]);
    }
  }
  fillTextureData(showAlpha: boolean, data: Uint8ClampedArray) {
    const p = new Float32Array(3);
    for (let i = 0; i < this._textureWidth; i++) {
      const t = i / (this._textureWidth - 1);
      this._interpolator.interpolate(t, p);
      data[i * 4 + 0] = (p[0] * 255) >> 0;
      data[i * 4 + 1] = (p[1] * 255) >> 0;
      data[i * 4 + 2] = (p[2] * 255) >> 0;
      if (showAlpha) {
        this._alphaEditor.interpolator.interpolate(t, p);
        data[i * 4 + 3] = (p[0] * 255) >> 0;
      } else {
        data[i * 4 + 3] = 255;
      }
    }
  }

  private updateTexture(changTexture = true) {
    this.fillTextureData(this._showAlpha, this._textureData);
    if (!this._texture) {
      this._texture = Application.instance.device.createTexture2D('rgba8unorm-srgb', this._textureWidth, 1, {
        samplerOptions: {
          mipFilter: 'none'
        }
      });
      changTexture = true;
    }
    if (changTexture) {
      this._texture.update(this._textureData, 0, 0, this._textureWidth, 1);
    }
  }

  dispose() {
    this._texture?.dispose();
    this._texture = null;
  }
}
