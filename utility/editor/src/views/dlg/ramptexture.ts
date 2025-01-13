import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { Texture2D } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';
import { Interpolator } from '@zephyr3d/base';

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
    const markerSize = 10; // 关键帧标记的大小

    // 计算鼠标在编辑器中的相对位置
    const relX = (mousePos.x - canvasPos.x) / canvasSize.x;

    // 检查鼠标悬停的关键帧
    this._hoverKeyframe = -1;
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + kf.time * canvasSize.x;
      const markerY = canvasPos.y + canvasSize.y / 2;

      if (Math.abs(mousePos.x - markerX) < markerSize && Math.abs(mousePos.y - markerY) < markerSize) {
        this._hoverKeyframe = index;
      }
    });

    // 处理鼠标事件
    if (ImGui.IsMouseClicked(0)) {
      if (this._hoverKeyframe !== -1) {
        this._selectedKeyframe = this._hoverKeyframe;
        this._isDragging = true;
      } else {
        const inCanvas =
          mousePos.x >= canvasPos.x &&
          mousePos.x <= canvasPos.x + canvasSize.x &&
          mousePos.y >= canvasPos.y &&
          mousePos.y <= canvasPos.y + canvasSize.y;

        if (inCanvas) {
          const t = Math.max(0, Math.min(1, relX));
          const newColor = new Float32Array(3);
          this._interpolator.interpolate(t, newColor);

          // 创建新关键帧并记住它的时间值
          const newKeyframe = {
            time: t,
            color: newColor
          };
          this._keyframes.push(newKeyframe);

          // 更新插值器（这会触发排序）
          this.updateInterpolator();

          // 排序后，找到新创建的关键帧的新索引
          this._selectedKeyframe = this._keyframes.findIndex((kf) => kf === newKeyframe);
          this._hoverKeyframe = this._selectedKeyframe;
          this._isDragging = true;
        }
      }
    } else if (ImGui.IsMouseClicked(1)) {
      // 右键点击
      if (
        this._hoverKeyframe !== -1 &&
        this._hoverKeyframe !== 0 &&
        this._hoverKeyframe !== this._keyframes.length - 1
      ) {
        // 删除关键帧（除了首尾）
        this._keyframes.splice(this._hoverKeyframe, 1);
        this._selectedKeyframe = -1;
        this.updateInterpolator();
      }
    }

    // 处理拖拽
    if (this._isDragging && this._selectedKeyframe !== -1) {
      if (ImGui.IsMouseDown(0)) {
        const kf = this._keyframes[this._selectedKeyframe];
        // 限制首尾关键帧只能垂直移动
        if (this._selectedKeyframe > 0 && this._selectedKeyframe < this._keyframes.length - 1) {
          kf.time = Math.max(0, Math.min(1, relX));
        }
        this.updateInterpolator();
      } else {
        this._isDragging = false;
      }
    }

    // 绘制编辑器界面
    const drawList = ImGui.GetWindowDrawList();

    // 绘制渐变预览背景
    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1))
    );

    // 绘制渐变预览
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

    // 绘制关键帧标记
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + kf.time * canvasSize.x;
      const markerWidth = 4;
      const isSelected = index === this._selectedKeyframe;
      const isHovered = index === this._hoverKeyframe;

      // 绘制长条
      drawList.AddRectFilled(
        new ImGui.ImVec2(markerX - markerWidth / 2, canvasPos.y),
        new ImGui.ImVec2(markerX + markerWidth / 2, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(kf.color[0], kf.color[1], kf.color[2], 1))
      );

      // 先绘制黑色外边框
      drawList.AddRect(
        new ImGui.ImVec2(markerX - markerWidth / 2 - 1, canvasPos.y - 1),
        new ImGui.ImVec2(markerX + markerWidth / 2 + 1, canvasPos.y + canvasSize.y + 1),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0, 0, 0, 0.5)),
        0,
        0,
        1
      );

      // 再绘制白色内边框
      drawList.AddRect(
        new ImGui.ImVec2(markerX - markerWidth / 2, canvasPos.y),
        new ImGui.ImVec2(markerX + markerWidth / 2, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, isSelected ? 1 : isHovered ? 0.8 : 0.5)),
        0,
        0,
        isSelected ? 2 : 1
      );
    });
    // 同时需要调整碰撞检测的逻辑，将 markerSize 改为使用 markerWidth：
    const markerWidth = 4;
    this._hoverKeyframe = -1;
    this._keyframes.forEach((kf, index) => {
      const markerX = canvasPos.x + kf.time * canvasSize.x;
      if (
        mousePos.x >= markerX - markerWidth / 2 &&
        mousePos.x <= markerX + markerWidth / 2 &&
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

    // 渐变编辑器
    if (ImGui.BeginChild('##Editor', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), true)) {
      this.handleEditorInteraction();

      // 确保在每帧都能接收鼠标输入
      ImGui.InvisibleButton('##canvas', ImGui.GetContentRegionAvail());
    }
    ImGui.EndChild();

    // 选中关键帧的颜色编辑器
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

    // 按钮
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
