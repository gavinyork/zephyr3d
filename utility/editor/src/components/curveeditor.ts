import { Interpolator } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

interface Point {
  x: number; // time
  values: number[]; // values array for multi-dimensional support
}

interface CurveSettings {
  timeRange: [number, number];
  valueRange: [number, number];
  gridColor: number;
  curveColor: number;
  pointColor: number;
  selectedPointColor: number;
  backgroundColor: number;
}

export class CurveEditor {
  private points: Point[] = [];
  private interpolators: Interpolator[] = []; // 你现有的插值器类型

  // 编辑器设置
  private settings: CurveSettings;
  private timeRangeStartInput: [number];
  private timeRangeEndInput: [number];
  private valueRangeStartInput: [number];
  private valueRangeEndInput: [number];

  // 画布状态
  private canvasSize: ImGui.ImVec2 = new ImGui.ImVec2(0, 0);
  private isDragging: boolean = false;
  private selectedPointIndex: number = -1;
  private cachedCurvePoints: Array<{ x: number; y: number }> = [];
  private curveDirty: boolean = true;

  constructor() {
    // 初始化默认设置
    this.settings = {
      timeRange: [0, 10],
      valueRange: [-1, 1],
      gridColor: ImGui.GetColorU32(new ImGui.ImVec4(0.5, 0.5, 0.5, 0.25)),
      curveColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1)),
      pointColor: ImGui.GetColorU32(new ImGui.ImVec4(0.7, 0.7, 0.7, 1)),
      selectedPointColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 0.5, 0, 1)),
      backgroundColor: ImGui.GetColorU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1))
    };

    // 初始化ImGui输入数组
    this.timeRangeStartInput = [this.settings.timeRange[0]];
    this.timeRangeEndInput = [this.settings.timeRange[1]];
    this.valueRangeStartInput = [this.settings.valueRange[0]];
    this.valueRangeEndInput = [this.settings.valueRange[1]];

    // 初始化首尾关键帧
    this.points = [
      { x: this.settings.timeRange[0], values: [0] },
      { x: this.settings.timeRange[1], values: [0] }
    ];

    this.cachedCurvePoints = [];
    this.curveDirty = true;
    this.updateInterpolators();
  }

  public render(): void {
    if (
      !ImGui.Begin('Curve Editor', null, ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse)
    ) {
      ImGui.End();
      return;
    }

    // 渲染设置面板
    if (ImGui.CollapsingHeader('Curve Settings')) {
      this.renderSettings();
    }

    // 使用 BeginChild 创建一个子窗口来容纳画布
    // 这样可以让画布填充剩余空间
    if (
      ImGui.BeginChild(
        'CurveCanvas',
        ImGui.GetContentRegionAvail(),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      const canvasSize = ImGui.GetContentRegionAvail();
      this.canvasSize = new ImGui.ImVec2(Math.max(100, canvasSize.x), Math.max(200, canvasSize.y));

      this.renderCurveView();
    }
    ImGui.EndChild();

    ImGui.End();
  }
  private renderSettings(): void {
    if (ImGui.CollapsingHeader('Curve Settings')) {
      let changed = false;

      // 时间范围设置
      ImGui.Text('Time Range');
      changed = ImGui.InputFloat('Start Time', this.timeRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('End Time', this.timeRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      // 值范围设置
      ImGui.Text('Value Range');
      changed = ImGui.InputFloat('Min Value', this.valueRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('Max Value', this.valueRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      if (changed) {
        this.updateSettings();
      }
    }
  }

  private updateSettings(): void {
    // 确保范围有效
    if (this.timeRangeStartInput[0] >= this.timeRangeEndInput[0]) {
      this.timeRangeEndInput[0] = this.timeRangeStartInput[0] + 0.1;
    }
    if (this.valueRangeStartInput[0] >= this.valueRangeEndInput[0]) {
      this.valueRangeEndInput[0] = this.valueRangeStartInput[0] + 0.1;
    }

    // 更新设置
    this.settings.timeRange = [this.timeRangeStartInput[0], this.timeRangeEndInput[0]];
    this.settings.valueRange = [this.valueRangeStartInput[0], this.valueRangeEndInput[0]];

    // 规范化所有点
    this.normalizePoints();

    this.curveDirty = true;
  }

  private normalizePoints(): void {
    // 确保首尾点的时间位置固定
    this.points[0].x = this.settings.timeRange[0];
    this.points[this.points.length - 1].x = this.settings.timeRange[1];

    // 处理所有点的值范围
    this.points.forEach((point) => {
      point.values[0] = Math.max(
        this.settings.valueRange[0],
        Math.min(this.settings.valueRange[1], point.values[0])
      );
    });

    // 确保中间点的时间在合理范围内
    for (let i = 1; i < this.points.length - 1; i++) {
      this.points[i].x = Math.max(
        this.points[0].x + 0.001,
        Math.min(this.points[this.points.length - 1].x - 0.001, this.points[i].x)
      );
    }

    this.sortPoints();
  }

  private sortPoints(): void {
    this.points.sort((a, b) => a.x - b.x);
  }

  private renderCurveView(): void {
    const cursorPos = ImGui.GetCursorScreenPos();

    // 创建交互区域
    ImGui.InvisibleButton('curve_canvas', this.canvasSize);
    const isCanvasHovered = ImGui.IsItemHovered();
    const isCanvasActive = ImGui.IsItemActive();

    // 绘制内容
    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      cursorPos,
      new ImGui.ImVec2(cursorPos.x + this.canvasSize.x, cursorPos.y + this.canvasSize.y),
      this.settings.backgroundColor
    );

    // 绘制曲线
    if (this.points.length >= 2) {
      this.drawCurve(drawList, cursorPos);
    }
    this.drawPoints(drawList, cursorPos);

    // 绘制范围标签
    this.drawRangeLabels(drawList, cursorPos);

    // 处理鼠标悬停提示
    if (isCanvasHovered || isCanvasActive) {
      this.handleInteraction(cursorPos);
      this.drawHoverHint(drawList, cursorPos);
    }
  }
  private drawRangeLabels(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.8));
    const padding = 5;
    const fontSize = ImGui.GetFontSize();

    // 绘制value范围
    // 最大值 - 上方中央
    const maxValueText = this.settings.valueRange[1].toFixed(2);
    const maxValueWidth = ImGui.CalcTextSize(maxValueText).x;
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + (this.canvasSize.x - maxValueWidth) / 2, // 水平居中
        cursorPos.y + padding
      ),
      textColor,
      maxValueText
    );

    // 最小值 - 下方中央
    const minValueText = this.settings.valueRange[0].toFixed(2);
    const minValueWidth = ImGui.CalcTextSize(minValueText).x;
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + (this.canvasSize.x - minValueWidth) / 2, // 水平居中
        cursorPos.y + this.canvasSize.y - fontSize - padding
      ),
      textColor,
      minValueText
    );

    // 绘制time范围
    // 最小值 - 左侧中央
    const startTimeText = this.settings.timeRange[0].toFixed(2);
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + padding,
        cursorPos.y + (this.canvasSize.y - fontSize) / 2 // 垂直居中
      ),
      textColor,
      startTimeText
    );

    // 最大值 - 右侧中央
    const endTimeText = this.settings.timeRange[1].toFixed(2);
    const endTimeWidth = ImGui.CalcTextSize(endTimeText).x;
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + this.canvasSize.x - endTimeWidth - padding,
        cursorPos.y + (this.canvasSize.y - fontSize) / 2 // 垂直居中
      ),
      textColor,
      endTimeText
    );
  }
  private drawHoverHint(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    const mousePos = ImGui.GetMousePos();
    const relativeMousePos = new ImGui.ImVec2(mousePos.x - cursorPos.x, mousePos.y - cursorPos.y);

    // 只在鼠标在画布内时显示提示
    if (!this.isPointInCanvas(relativeMousePos)) {
      return;
    }

    // 获取鼠标位置对应的世界坐标
    const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);

    // 找到最近的曲线点
    const curveValue = this.findNearestCurveValue(worldPos.x);
    if (curveValue === null) {
      return;
    }

    // 计算屏幕坐标
    const screenPos = this.worldToScreen(worldPos.x, curveValue);
    const distance = Math.abs(screenPos.y - relativeMousePos.y);

    // 只在鼠标靠近曲线时显示提示（比如距离小于10像素）
    if (distance > 10) {
      return;
    }

    // 绘制提示文本
    const hintText = `Time: ${worldPos.x.toFixed(2)}\nValue: ${curveValue.toFixed(2)}`;
    const textSize = ImGui.CalcTextSize(hintText);
    const padding = 5;
    const backgroundColor = ImGui.GetColorU32(new ImGui.ImVec4(0, 0, 0, 0.8));
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1));

    // 计算提示框位置，确保不会超出画布边界
    let hintX = cursorPos.x + relativeMousePos.x + 10;
    let hintY = cursorPos.y + relativeMousePos.y - textSize.y - padding * 2;

    if (hintX + textSize.x + padding * 2 > cursorPos.x + this.canvasSize.x) {
      hintX = cursorPos.x + relativeMousePos.x - textSize.x - padding * 2 - 10;
    }
    if (hintY < cursorPos.y) {
      hintY = cursorPos.y + relativeMousePos.y + padding;
    }

    // 绘制提示框背景
    drawList.AddRectFilled(
      new ImGui.ImVec2(hintX, hintY),
      new ImGui.ImVec2(hintX + textSize.x + padding * 2, hintY + textSize.y + padding * 2),
      backgroundColor,
      4
    );

    // 绘制提示文本
    drawList.AddText(new ImGui.ImVec2(hintX + padding, hintY + padding), textColor, hintText);
  }

  private findNearestCurveValue(time: number): number | null {
    if (this.cachedCurvePoints.length < 2) {
      return null;
    }

    // 确保时间在曲线范围内
    if (time < this.points[0].x || time > this.points[this.points.length - 1].x) {
      return null;
    }

    // 使用插值器获取精确值
    const result = new Float32Array(1);
    this.interpolators[0].interpolate(time, result);
    return result[0];
  }
  private drawCurve(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    this.updateCurvePoints();

    if (this.cachedCurvePoints.length < 2) return;

    for (let i = 0; i < this.cachedCurvePoints.length - 1; i++) {
      const p1 = this.cachedCurvePoints[i];
      const p2 = this.cachedCurvePoints[i + 1];

      const screenP1 = this.worldToScreen(p1.x, p1.y);
      const screenP2 = this.worldToScreen(p2.x, p2.y);

      drawList.AddLine(
        new ImGui.ImVec2(cursorPos.x + screenP1.x, cursorPos.y + screenP1.y),
        new ImGui.ImVec2(cursorPos.x + screenP2.x, cursorPos.y + screenP2.y),
        this.settings.curveColor,
        2.0
      );
    }
  }

  private drawPoints(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    this.points.forEach((point, index) => {
      const screenPos = this.worldToScreen(point.x, point.values[0]);
      const color =
        index === this.selectedPointIndex ? this.settings.selectedPointColor : this.settings.pointColor;

      drawList.AddCircleFilled(
        new ImGui.ImVec2(cursorPos.x + screenPos.x, cursorPos.y + screenPos.y),
        5,
        color
      );
    });
  }

  private handleInteraction(cursorPos: ImGui.ImVec2): void {
    const mousePos = ImGui.GetMousePos();
    const relativeMousePos = new ImGui.ImVec2(mousePos.x - cursorPos.x, mousePos.y - cursorPos.y);

    // 左键点击处理
    if (ImGui.IsMouseClicked(0)) {
      const clickedPoint = this.findPointNear(relativeMousePos);
      if (clickedPoint !== -1) {
        // 选中现有点
        this.selectedPointIndex = clickedPoint;
        this.isDragging = true;
      } else {
        // 在空白处添加新点
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        this.addPoint(worldPos.x, worldPos.y);
      }
    }

    // 右键点击处理（删除点）
    if (ImGui.IsMouseClicked(1)) {
      const clickedPoint = this.findPointNear(relativeMousePos);
      if (clickedPoint !== -1 && clickedPoint !== 0 && clickedPoint !== this.points.length - 1) {
        this.removePoint(clickedPoint);
      }
    }

    // 拖动处理
    if (this.isDragging && this.selectedPointIndex !== -1) {
      if (ImGui.IsMouseDown(0)) {
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        if (this.selectedPointIndex === 0 || this.selectedPointIndex === this.points.length - 1) {
          // 首尾点只能改变value
          this.updatePointValue(this.selectedPointIndex, worldPos.y);
        } else {
          // 中间点可以自由移动
          const minTime = this.points[0].x;
          const maxTime = this.points[this.points.length - 1].x;
          const clampedTime = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, worldPos.x));
          this.updatePointPosition(this.selectedPointIndex, clampedTime, worldPos.y);
        }
      } else {
        this.isDragging = false;
      }
    }
  }

  private updateCurvePoints(): void {
    if (!this.curveDirty && this.cachedCurvePoints.length > 0) {
      return;
    }

    if (this.points.length < 2 || this.interpolators.length === 0) {
      this.cachedCurvePoints = [];
      return;
    }

    const interpolator = this.interpolators[0];
    // 根据画布宽度计算采样点数，但设置上限
    const numSegments = Math.min(Math.ceil(this.canvasSize.x / 2), 100);
    const result = new Float32Array(1);

    this.cachedCurvePoints = [];
    const timeRange = this.points[this.points.length - 1].x - this.points[0].x;
    const step = timeRange / numSegments;

    for (let i = 0; i <= numSegments; i++) {
      const x = this.points[0].x + i * step;
      interpolator.interpolate(x, result);
      this.cachedCurvePoints.push({ x, y: result[0] });
    }

    this.curveDirty = false;
  }

  // 坐标转换方法
  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: this.timeToScreen(x),
      y: this.valueToScreen(y)
    };
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: this.screenToTime(x),
      y: this.screenToValue(y)
    };
  }

  private timeToScreen(time: number): number {
    return (
      ((time - this.settings.timeRange[0]) / (this.settings.timeRange[1] - this.settings.timeRange[0])) *
      this.canvasSize.x
    );
  }

  private valueToScreen(value: number): number {
    return (
      (1 -
        (value - this.settings.valueRange[0]) / (this.settings.valueRange[1] - this.settings.valueRange[0])) *
      this.canvasSize.y
    );
  }

  private screenToTime(x: number): number {
    return (
      this.settings.timeRange[0] +
      (x / this.canvasSize.x) * (this.settings.timeRange[1] - this.settings.timeRange[0])
    );
  }

  private screenToValue(y: number): number {
    return (
      this.settings.valueRange[0] +
      (1 - y / this.canvasSize.y) * (this.settings.valueRange[1] - this.settings.valueRange[0])
    );
  }

  // 辅助方法
  private isPointInCanvas(point: ImGui.ImVec2): boolean {
    return point.x >= 0 && point.x <= this.canvasSize.x && point.y >= 0 && point.y <= this.canvasSize.y;
  }

  private findPointNear(screenPos: ImGui.ImVec2, threshold: number = 10): number {
    for (let i = 0; i < this.points.length; i++) {
      const pointScreen = this.worldToScreen(this.points[i].x, this.points[i].values[0]);
      const dx = pointScreen.x - screenPos.x;
      const dy = pointScreen.y - screenPos.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        return i;
      }
    }
    return -1;
  }

  // 点管理方法
  private addPoint(time: number, value: number): void {
    // 确保时间在首尾点之间
    const minTime = this.points[0].x;
    const maxTime = this.points[this.points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));

    // 确保值在有效范围内
    value = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], value));

    // 创建新点
    const newPoint: Point = {
      x: time,
      values: [value]
    };

    // 添加点并排序
    this.points.push(newPoint);
    this.sortPoints();

    // 更新插值器
    this.updateInterpolators();

    // 选中新添加的点
    this.selectedPointIndex = this.points.findIndex((p) => p === newPoint);

    this.curveDirty = true;
  }

  private removePoint(index: number): void {
    if (index < 0 || index >= this.points.length) return;

    // 至少保留两个点
    if (this.points.length <= 2) {
      ImGui.OpenPopup('Cannot Remove Point');
      return;
    }

    this.points.splice(index, 1);

    // 更新选中点
    if (this.selectedPointIndex === index) {
      this.selectedPointIndex = -1;
    } else if (this.selectedPointIndex > index) {
      this.selectedPointIndex--;
    }

    // 更新插值器
    this.updateInterpolators();

    this.curveDirty = true;
  }

  private updatePointValue(index: number, newValue: number): void {
    if (index < 0 || index >= this.points.length) return;

    // 确保值在有效范围内
    newValue = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], newValue));

    this.points[index].values[0] = newValue;

    // 更新插值器
    this.updateInterpolators();

    this.curveDirty = true;
  }

  private updatePointPosition(index: number, time: number, value: number): void {
    if (index <= 0 || index >= this.points.length - 1) return; // 保护首尾点的位置

    // 确保时间在首尾点之间
    const minTime = this.points[0].x;
    const maxTime = this.points[this.points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));

    // 确保值在有效范围内
    value = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], value));

    this.points[index].x = time;
    this.points[index].values[0] = value;
    this.sortPoints();

    // 更新选中点的索引（因为排序可能改变了位置）
    if (this.selectedPointIndex === index) {
      this.selectedPointIndex = this.points.findIndex((p) => p.x === time);
    }

    // 更新插值器
    this.updateInterpolators();

    this.curveDirty = true;
  }

  // 插值器更新方法
  private updateInterpolators(): void {
    if (this.points.length < 2) {
      this.interpolators = [];
      return;
    }

    // 准备输入数组（时间）和输出数组（值）
    const inputs = new Float32Array(this.points.length);
    const outputs = new Float32Array(this.points.length);

    for (let i = 0; i < this.points.length; i++) {
      inputs[i] = this.points[i].x;
      outputs[i] = this.points[i].values[0];
    }

    this.interpolators = [new Interpolator('cubicspline-natural', 'number', inputs, outputs)];
    this.curveDirty = true; // 标记需要更新曲线缓存
  }

  public getValue(time: number): number {
    if (this.interpolators.length === 0 || this.points.length < 2) {
      return 0;
    }

    const result = new Float32Array(1);
    this.interpolators[0].interpolate(time, result);
    return result[0];
  }
}
