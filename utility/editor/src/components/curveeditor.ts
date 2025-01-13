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
  interpolationType: 'linear' | 'step' | 'cubicspline-natural';
}

export class CurveEditor {
  private points: Point[] = [];
  private interpolators: Interpolator[] = [];

  // Settings
  private settings: CurveSettings;
  private timeRangeStartInput: [number];
  private timeRangeEndInput: [number];
  private valueRangeStartInput: [number];
  private valueRangeEndInput: [number];

  // Status
  private canvasSize: ImGui.ImVec2 = new ImGui.ImVec2(0, 0);
  private isDragging: boolean = false;
  private selectedPointIndex: number = -1;
  private cachedCurvePoints: Array<{ x: number; y: number }> = [];
  private curveDirty: boolean = true;

  constructor() {
    // Default settings
    this.settings = {
      timeRange: [0, 10],
      valueRange: [-1, 1],
      gridColor: ImGui.GetColorU32(new ImGui.ImVec4(0.5, 0.5, 0.5, 0.25)),
      curveColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1)),
      pointColor: ImGui.GetColorU32(new ImGui.ImVec4(0.7, 0.7, 0.7, 1)),
      selectedPointColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 0.5, 0, 1)),
      backgroundColor: ImGui.GetColorU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1)),
      interpolationType: 'cubicspline-natural'
    };

    this.timeRangeStartInput = [this.settings.timeRange[0]];
    this.timeRangeEndInput = [this.settings.timeRange[1]];
    this.valueRangeStartInput = [this.settings.valueRange[0]];
    this.valueRangeEndInput = [this.settings.valueRange[1]];

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

    this.renderSettings();

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

      ImGui.Text('Time Range');
      changed = ImGui.InputFloat('Start Time', this.timeRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('End Time', this.timeRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      ImGui.Text('Value Range');
      changed = ImGui.InputFloat('Min Value', this.valueRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('Max Value', this.valueRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      ImGui.Text('Interpolation');
      const interpolationTypes = ['linear', 'step', 'cubicspline-natural'];
      const currentType = interpolationTypes.indexOf(this.settings.interpolationType);
      const interpolationLabels = ['Linear', 'Step', 'Cubic Spline'];

      let interpolationChanged = false;
      if (ImGui.BeginCombo('Type', interpolationLabels[currentType])) {
        interpolationTypes.forEach((type, index) => {
          const isSelected = type === this.settings.interpolationType;
          if (ImGui.Selectable(interpolationLabels[index], isSelected)) {
            this.settings.interpolationType = type as CurveSettings['interpolationType'];
            interpolationChanged = true;
            changed = true;
          }
          if (isSelected) {
            ImGui.SetItemDefaultFocus();
          }
        });
        ImGui.EndCombo();
      }

      if (changed) {
        this.updateSettings();
      }

      if (interpolationChanged) {
        this.updateInterpolators();
        this.curveDirty = true;
        this.cachedCurvePoints = [];
      }
    }
  }

  private updateSettings(): void {
    // Make sure the range is valid
    if (this.timeRangeStartInput[0] >= this.timeRangeEndInput[0]) {
      this.timeRangeEndInput[0] = this.timeRangeStartInput[0] + 0.1;
    }
    if (this.valueRangeStartInput[0] >= this.valueRangeEndInput[0]) {
      this.valueRangeEndInput[0] = this.valueRangeStartInput[0] + 0.1;
    }

    // Update settings
    this.settings.timeRange = [this.timeRangeStartInput[0], this.timeRangeEndInput[0]];
    this.settings.valueRange = [this.valueRangeStartInput[0], this.valueRangeEndInput[0]];

    // Initialize all points
    this.normalizePoints();

    this.updateInterpolators();

    this.curveDirty = true;
  }

  private normalizePoints(): void {
    this.points[0].x = this.settings.timeRange[0];
    this.points[this.points.length - 1].x = this.settings.timeRange[1];

    this.points.forEach((point) => {
      point.values[0] = Math.max(
        this.settings.valueRange[0],
        Math.min(this.settings.valueRange[1], point.values[0])
      );
    });

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

    ImGui.InvisibleButton('curve_canvas', this.canvasSize);
    const isCanvasHovered = ImGui.IsItemHovered();
    const isCanvasActive = ImGui.IsItemActive();

    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      cursorPos,
      new ImGui.ImVec2(cursorPos.x + this.canvasSize.x, cursorPos.y + this.canvasSize.y),
      this.settings.backgroundColor
    );

    if (this.points.length >= 2) {
      this.drawCurve(drawList, cursorPos);
    }
    this.drawPoints(drawList, cursorPos);

    this.drawRangeLabels(drawList, cursorPos);

    if (isCanvasHovered || isCanvasActive) {
      this.handleInteraction(cursorPos);
      this.drawHoverHint(drawList, cursorPos);
    }
  }
  private drawRangeLabels(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.8));
    const padding = 5;
    const fontSize = ImGui.GetFontSize();

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

    const startTimeText = this.settings.timeRange[0].toFixed(2);
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + padding,
        cursorPos.y + (this.canvasSize.y - fontSize) / 2 // 垂直居中
      ),
      textColor,
      startTimeText
    );

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

    if (!this.isPointInCanvas(relativeMousePos)) {
      return;
    }

    const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
    const curveValue = this.findNearestCurveValue(worldPos.x);

    if (curveValue === null) {
      return;
    }

    // 计算曲线上对应点的屏幕坐标
    const curvePointScreen = this.worldToScreen(worldPos.x, curveValue);
    const distance = Math.abs(curvePointScreen.y - relativeMousePos.y);

    if (distance > 10) {
      return;
    }

    // 绘制垂直参考线
    const lineColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.3));
    drawList.AddLine(
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y),
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + this.canvasSize.y),
      lineColor,
      1.0
    );

    // 在曲线上标记当前点
    const pointColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 0, 1)); // 黄色标记点
    drawList.AddCircleFilled(
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + curvePointScreen.y),
      4,
      pointColor
    );
    // 绘制点的外圈
    drawList.AddCircle(
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + curvePointScreen.y),
      5,
      ImGui.GetColorU32(new ImGui.ImVec4(0, 0, 0, 1)),
      0,
      1.5
    );

    const hintText = `Time: ${worldPos.x.toFixed(2)}\nValue: ${curveValue.toFixed(2)}`;
    const textSize = ImGui.CalcTextSize(hintText);
    const padding = 5;
    const backgroundColor = ImGui.GetColorU32(new ImGui.ImVec4(0, 0, 0, 0.8));
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1));

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

    if (time < this.points[0].x || time > this.points[this.points.length - 1].x) {
      return null;
    }

    const result = new Float32Array(1);
    this.interpolators[0].interpolate(time, result);
    return result[0];
  }
  private drawCurve(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    if (this.points.length < 2) return;

    // 保存原始标志位
    const originalFlags = drawList.Flags;
    // 启用抗锯齿
    drawList.Flags |= ImGui.ImDrawListFlags.AntiAliasedLines;

    if (this.settings.interpolationType === 'step') {
      // Step类型绘制阶跃波形
      for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i + 1];

        const screen1 = this.worldToScreen(p1.x, p1.values[0]);
        const screen2 = this.worldToScreen(p2.x, p2.values[0]);

        // 绘制水平线段
        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen1.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen1.y),
          this.settings.curveColor,
          2.0
        );

        // 绘制垂直线段
        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen2.y),
          this.settings.curveColor,
          2.0
        );
      }
    } else if (this.settings.interpolationType === 'linear') {
      // Linear类型直接连接控制点
      for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i + 1];

        const screen1 = this.worldToScreen(p1.x, p1.values[0]);
        const screen2 = this.worldToScreen(p2.x, p2.values[0]);

        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen1.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen2.y),
          this.settings.curveColor,
          2.0
        );
      }
    } else {
      // 只有cubicspline需要使用缓存的曲线点
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

    // 恢复原始标志位
    drawList.Flags = originalFlags;
  }

  private updateCurvePoints(): void {
    if (!this.curveDirty && this.cachedCurvePoints.length > 0) {
      return;
    }

    if (this.points.length < 2 || this.interpolators.length === 0) {
      this.cachedCurvePoints = [];
      return;
    }

    // 只有cubicspline需要缓存点
    if (this.settings.interpolationType !== 'cubicspline-natural') {
      this.cachedCurvePoints = [];
      return;
    }

    const interpolator = this.interpolators[0];
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

    if (ImGui.IsMouseClicked(0)) {
      const clickedPoint = this.findPointNear(relativeMousePos);
      if (clickedPoint !== -1) {
        this.selectedPointIndex = clickedPoint;
        this.isDragging = true;
      } else {
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        this.addPoint(worldPos.x, worldPos.y);
      }
    }

    if (ImGui.IsMouseClicked(1)) {
      const clickedPoint = this.findPointNear(relativeMousePos);
      if (clickedPoint !== -1 && clickedPoint !== 0 && clickedPoint !== this.points.length - 1) {
        this.removePoint(clickedPoint);
      }
    }

    if (this.isDragging && this.selectedPointIndex !== -1) {
      if (ImGui.IsMouseDown(0)) {
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        if (this.selectedPointIndex === 0 || this.selectedPointIndex === this.points.length - 1) {
          this.updatePointValue(this.selectedPointIndex, worldPos.y);
        } else {
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

  private addPoint(time: number, value: number): void {
    const minTime = this.points[0].x;
    const maxTime = this.points[this.points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));

    value = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], value));

    const newPoint: Point = {
      x: time,
      values: [value]
    };

    this.points.push(newPoint);
    this.sortPoints();

    this.updateInterpolators();

    this.selectedPointIndex = this.points.findIndex((p) => p === newPoint);

    this.curveDirty = true;
  }

  private removePoint(index: number): void {
    if (index < 0 || index >= this.points.length) return;

    if (this.points.length <= 2) {
      ImGui.OpenPopup('Cannot Remove Point');
      return;
    }

    this.points.splice(index, 1);

    if (this.selectedPointIndex === index) {
      this.selectedPointIndex = -1;
    } else if (this.selectedPointIndex > index) {
      this.selectedPointIndex--;
    }

    this.updateInterpolators();

    this.curveDirty = true;
  }

  private updatePointValue(index: number, newValue: number): void {
    if (index < 0 || index >= this.points.length) return;

    newValue = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], newValue));

    this.points[index].values[0] = newValue;

    this.updateInterpolators();

    this.curveDirty = true;
  }

  private updatePointPosition(index: number, time: number, value: number): void {
    if (index <= 0 || index >= this.points.length - 1) return; // 保护首尾点的位置

    const minTime = this.points[0].x;
    const maxTime = this.points[this.points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));

    value = Math.max(this.settings.valueRange[0], Math.min(this.settings.valueRange[1], value));

    this.points[index].x = time;
    this.points[index].values[0] = value;
    this.sortPoints();

    if (this.selectedPointIndex === index) {
      this.selectedPointIndex = this.points.findIndex((p) => p.x === time);
    }

    this.updateInterpolators();

    this.curveDirty = true;
  }

  private updateInterpolators(): void {
    if (this.points.length < 2) {
      this.interpolators = [];
      return;
    }
    const inputs = new Float32Array(this.points.length);
    const outputs = new Float32Array(this.points.length);
    for (let i = 0; i < this.points.length; i++) {
      inputs[i] = this.points[i].x;
      outputs[i] = this.points[i].values[0];
    }
    this.interpolators = [new Interpolator(this.settings.interpolationType, 'number', inputs, outputs)];
    this.curveDirty = true;
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
