import { Interpolator } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export type CurveInterpolation = 'linear' | 'step' | 'cubicspline-natural';

interface Point {
  x: number;
  value: number;
}

interface CurveSettings {
  timeRange: [number, number];
  valueRange: [number, number];
  curveColor: number;
  curveColorActive: number;
  pointColor: number;
  selectedPointColor: number;
  backgroundColor: number;
  drawLabels: boolean;
  drawHints: boolean;
  interpolationType: CurveInterpolation;
}

export class CurveEditor {
  private _points: Point[] = [];
  private _interpolator: Interpolator = null;

  // Settings
  private _settings: CurveSettings;
  private _timeRangeStartInput: [number];
  private _timeRangeEndInput: [number];
  private _valueRangeStartInput: [number];
  private _valueRangeEndInput: [number];

  // Status
  private _canvasSize: ImGui.ImVec2;
  private _isDragging: boolean;
  private _curveActive: boolean;
  private _selectedPointIndex: number;
  private _cachedCurvePoints: Array<{ x: number; y: number }>;
  private _curveDirty: boolean;

  constructor(points?: Point[], settings?: Partial<CurveSettings>) {
    // Default settings
    this._settings = {
      timeRange: [0, 1],
      valueRange: [-1, 1],
      curveColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1)),
      curveColorActive: ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 0, 1)),
      pointColor: ImGui.GetColorU32(new ImGui.ImVec4(0.7, 0.7, 0.7, 1)),
      selectedPointColor: ImGui.GetColorU32(new ImGui.ImVec4(1, 0.5, 0, 1)),
      backgroundColor: ImGui.GetColorU32(new ImGui.ImVec4(0.2, 0.2, 0.2, 1)),
      drawLabels: true,
      drawHints: true,
      interpolationType: 'cubicspline-natural',
      ...settings
    };
    this._timeRangeStartInput = [this._settings.timeRange[0]];
    this._timeRangeEndInput = [this._settings.timeRange[1]];
    this._valueRangeStartInput = [this._settings.valueRange[0]];
    this._valueRangeEndInput = [this._settings.valueRange[1]];
    this._points = points ?? [
      { x: this._settings.timeRange[0], value: 0 },
      { x: this._settings.timeRange[1], value: 0 }
    ];
    this._isDragging = false;
    this._curveActive = false;
    this._selectedPointIndex = -1;
    this._cachedCurvePoints = [];
    this.updateInterpolator();
  }
  get interpolator() {
    return this._interpolator;
  }
  get timeMin(): number {
    return this._settings.timeRange[0];
  }
  get timeMax(): number {
    return this._settings.timeRange[1];
  }
  get valueMin(): number {
    return this._settings.valueRange[0];
  }
  get valueMax(): number {
    return this._settings.valueRange[1];
  }
  get interpolateMode(): CurveInterpolation {
    return this._settings.interpolationType;
  }
  set interpolateMode(value: CurveInterpolation) {
    if (this._settings.interpolationType != value) {
      this._settings.interpolationType = value;
      this.interpolationChanged();
    }
  }
  setTimeRange(min: number, max: number): void {
    if (min >= max) {
      throw new Error('Invalid time range');
    }
    this._settings.timeRange[0] = min;
    this._settings.timeRange[1] = max;
    this.settingsChanged();
  }
  setValueRange(min: number, max: number): void {
    if (min >= max) {
      throw new Error('Invalid value range');
    }
    this._settings.valueRange[0] = min;
    this._settings.valueRange[1] = max;
    this.settingsChanged();
  }
  renderSettings(): void {
    ImGui.PushID(`${ImGui.GetCurrentWindow().ID}`);
    if (ImGui.CollapsingHeader('Curve Settings')) {
      let changed = false;

      ImGui.Text('Time Range');
      changed = ImGui.InputFloat('Start Time', this._timeRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('End Time', this._timeRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      ImGui.Text('Value Range');
      changed = ImGui.InputFloat('Min Value', this._valueRangeStartInput, 0.1, 1.0, '%.2f') || changed;
      changed = ImGui.InputFloat('Max Value', this._valueRangeEndInput, 0.1, 1.0, '%.2f') || changed;

      ImGui.Text('Interpolation');
      const interpolationTypes = ['linear', 'step', 'cubicspline-natural'];
      const currentType = interpolationTypes.indexOf(this._settings.interpolationType);
      const interpolationLabels = ['Linear', 'Step', 'Cubic Spline'];

      let interpolationChanged = false;
      if (ImGui.BeginCombo('Type', interpolationLabels[currentType])) {
        interpolationTypes.forEach((type, index) => {
          const isSelected = type === this._settings.interpolationType;
          if (ImGui.Selectable(interpolationLabels[index], isSelected)) {
            this._settings.interpolationType = type as CurveInterpolation;
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
        this.interpolationChanged();
      }
    }
    ImGui.PopID();
  }
  private updateSettings(): void {
    if (this._timeRangeStartInput[0] >= this._timeRangeEndInput[0]) {
      this._timeRangeEndInput[0] = this._timeRangeStartInput[0] + 0.1;
    }
    if (this._valueRangeStartInput[0] >= this._valueRangeEndInput[0]) {
      this._valueRangeEndInput[0] = this._valueRangeStartInput[0] + 0.1;
    }
    this._settings.timeRange = [this._timeRangeStartInput[0], this._timeRangeEndInput[0]];
    this._settings.valueRange = [this._valueRangeStartInput[0], this._valueRangeEndInput[0]];
    this.settingsChanged();
  }
  private settingsChanged() {
    this.normalizePoints();
    this.updateInterpolator();
  }
  private interpolationChanged() {
    this.updateInterpolator();
    this._cachedCurvePoints = [];
  }
  private normalizePoints(): void {
    this._points[0].x = this._settings.timeRange[0];
    this._points[this._points.length - 1].x = this._settings.timeRange[1];
    this._points.forEach((point) => {
      point.value = Math.max(
        this._settings.valueRange[0],
        Math.min(this._settings.valueRange[1], point.value)
      );
    });
    for (let i = 1; i < this._points.length - 1; i++) {
      this._points[i].x = Math.max(
        this._points[0].x + 0.001,
        Math.min(this._points[this._points.length - 1].x - 0.001, this._points[i].x)
      );
    }
    this.sortPoints();
  }
  private sortPoints(): void {
    this._points.sort((a, b) => a.x - b.x);
  }
  renderCurveView(canvasSize: ImGui.ImVec2): void {
    ImGui.PushID(`${ImGui.GetCurrentWindow().ID}`);
    this._canvasSize = new ImGui.ImVec2(Math.max(1, canvasSize.x), Math.max(1, canvasSize.y));
    const cursorPos = ImGui.GetCursorScreenPos();

    ImGui.InvisibleButton('curve_canvas', this._canvasSize);
    const isCanvasHovered = ImGui.IsItemHovered();

    const drawList = ImGui.GetWindowDrawList();
    drawList.AddRectFilled(
      cursorPos,
      new ImGui.ImVec2(cursorPos.x + this._canvasSize.x, cursorPos.y + this._canvasSize.y),
      this._settings.backgroundColor
    );

    if (this._points.length >= 2) {
      this.drawCurve(drawList, cursorPos);
    }
    this.drawPoints(drawList, cursorPos);

    if (this._settings.drawLabels) {
      this.drawRangeLabels(drawList, cursorPos);
    }
    if (isCanvasHovered) {
      this.handleInteraction(cursorPos);
      this.drawHoverHint(drawList, cursorPos);
    }
    ImGui.PopID();
  }
  private drawRangeLabels(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.8));
    const padding = 5;
    const fontSize = ImGui.GetFontSize();
    const maxValueText = this._settings.valueRange[1].toFixed(2);
    const maxValueWidth = ImGui.CalcTextSize(maxValueText).x;
    drawList.AddText(
      new ImGui.ImVec2(cursorPos.x + (this._canvasSize.x - maxValueWidth) / 2, cursorPos.y + padding),
      textColor,
      maxValueText
    );
    const minValueText = this._settings.valueRange[0].toFixed(2);
    const minValueWidth = ImGui.CalcTextSize(minValueText).x;
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + (this._canvasSize.x - minValueWidth) / 2,
        cursorPos.y + this._canvasSize.y - fontSize - padding
      ),
      textColor,
      minValueText
    );
    const startTimeText = this._settings.timeRange[0].toFixed(2);
    drawList.AddText(
      new ImGui.ImVec2(cursorPos.x + padding, cursorPos.y + (this._canvasSize.y - fontSize) / 2),
      textColor,
      startTimeText
    );
    const endTimeText = this._settings.timeRange[1].toFixed(2);
    const endTimeWidth = ImGui.CalcTextSize(endTimeText).x;
    drawList.AddText(
      new ImGui.ImVec2(
        cursorPos.x + this._canvasSize.x - endTimeWidth - padding,
        cursorPos.y + (this._canvasSize.y - fontSize) / 2
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
    const curvePointScreen = this.worldToScreen(worldPos.x, curveValue);
    const distance = Math.abs(curvePointScreen.y - relativeMousePos.y);
    this._curveActive = distance < 10;
    const pointIndex = this.findPointNear(relativeMousePos);
    if (pointIndex >= 0) {
      const point = this._points[pointIndex];
      this.drawHint(point.x, point.value, cursorPos, relativeMousePos, drawList);
    }
    const lineColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.3));
    drawList.AddLine(
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y),
      new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + this._canvasSize.y),
      lineColor,
      1.0
    );
    if (!this._curveActive) {
      const pointColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 0, 1)); // 黄色标记点
      drawList.AddCircleFilled(
        new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + curvePointScreen.y),
        4,
        pointColor
      );
      drawList.AddCircle(
        new ImGui.ImVec2(cursorPos.x + curvePointScreen.x, cursorPos.y + curvePointScreen.y),
        5,
        ImGui.GetColorU32(new ImGui.ImVec4(0, 0, 0, 1)),
        0,
        1.5
      );
    }
    this.drawHint(worldPos.x, curveValue, cursorPos, relativeMousePos, drawList);
  }
  private drawHint(
    time: number,
    value: number,
    cursorPos: ImGui.Vec2,
    mousePos: ImGui.Vec2,
    drawList: ImGui.DrawList
  ) {
    if (!this._settings.drawHints) {
      return;
    }
    const hintText = `Time: ${time.toFixed(2)}\nValue: ${value.toFixed(2)}`;
    const textSize = ImGui.CalcTextSize(hintText);
    const padding = 5;
    const backgroundColor = ImGui.GetColorU32(new ImGui.ImVec4(0, 0, 0, 0.8));
    const textColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1));
    let hintX = cursorPos.x + mousePos.x + 10;
    let hintY = cursorPos.y + mousePos.y - textSize.y - padding * 2;
    if (hintX + textSize.x + padding * 2 > cursorPos.x + this._canvasSize.x) {
      hintX = cursorPos.x + mousePos.x - textSize.x - padding * 2 - 10;
    }
    if (hintY < cursorPos.y) {
      hintY = cursorPos.y + mousePos.y + padding;
    }
    drawList.AddRectFilled(
      new ImGui.ImVec2(hintX, hintY),
      new ImGui.ImVec2(hintX + textSize.x + padding * 2, hintY + textSize.y + padding * 2),
      backgroundColor,
      4
    );
    drawList.AddText(new ImGui.ImVec2(hintX + padding, hintY + padding), textColor, hintText);
  }
  private findNearestCurveValue(time: number): number | null {
    if (this._settings.interpolationType === 'cubicspline-natural' && this._cachedCurvePoints.length < 2) {
      return null;
    }

    if (time < this._points[0].x || time > this._points[this._points.length - 1].x) {
      return null;
    }

    const result = new Float32Array(1);
    this._interpolator.interpolate(time, result);
    return result[0];
  }
  private drawCurve(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    if (this._points.length < 2) {
      return;
    }
    const curveColor = this._curveActive ? this._settings.curveColorActive : this._settings.curveColor;
    if (this._settings.interpolationType === 'step') {
      for (let i = 0; i < this._points.length - 1; i++) {
        const p1 = this._points[i];
        const p2 = this._points[i + 1];
        const screen1 = this.worldToScreen(p1.x, p1.value);
        const screen2 = this.worldToScreen(p2.x, p2.value);
        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen1.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen1.y),
          curveColor,
          2.0
        );
        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen2.y),
          curveColor,
          2.0
        );
      }
    } else if (this._settings.interpolationType === 'linear') {
      for (let i = 0; i < this._points.length - 1; i++) {
        const p1 = this._points[i];
        const p2 = this._points[i + 1];

        const screen1 = this.worldToScreen(p1.x, p1.value);
        const screen2 = this.worldToScreen(p2.x, p2.value);

        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screen1.x, cursorPos.y + screen1.y),
          new ImGui.ImVec2(cursorPos.x + screen2.x, cursorPos.y + screen2.y),
          curveColor,
          2.0
        );
      }
    } else {
      this.updateCurvePoints();
      if (this._cachedCurvePoints.length < 2) {
        return;
      }
      for (let i = 0; i < this._cachedCurvePoints.length - 1; i++) {
        const p1 = this._cachedCurvePoints[i];
        const p2 = this._cachedCurvePoints[i + 1];
        const screenP1 = this.worldToScreen(p1.x, p1.y);
        const screenP2 = this.worldToScreen(p2.x, p2.y);
        drawList.AddLine(
          new ImGui.ImVec2(cursorPos.x + screenP1.x, cursorPos.y + screenP1.y),
          new ImGui.ImVec2(cursorPos.x + screenP2.x, cursorPos.y + screenP2.y),
          curveColor,
          2.0
        );
      }
    }
  }
  private updateCurvePoints(): void {
    if (!this._curveDirty && this._cachedCurvePoints.length > 0) {
      return;
    }
    if (this._points.length < 2 || !this._interpolator) {
      this._cachedCurvePoints = [];
      return;
    }
    if (this._settings.interpolationType !== 'cubicspline-natural') {
      this._cachedCurvePoints = [];
      return;
    }
    const interpolator = this._interpolator;
    const numSegments = Math.min(Math.ceil(this._canvasSize.x / 2), 100);
    const result = new Float32Array(1);
    this._cachedCurvePoints = [];
    const timeRange = this._points[this._points.length - 1].x - this._points[0].x;
    const step = timeRange / numSegments;
    for (let i = 0; i <= numSegments; i++) {
      const x = this._points[0].x + i * step;
      interpolator.interpolate(x, result);
      this._cachedCurvePoints.push({ x, y: result[0] });
    }
    this._curveDirty = false;
  }
  private drawPoints(drawList: ImGui.ImDrawList, cursorPos: ImGui.ImVec2): void {
    this._points.forEach((point, index) => {
      const screenPos = this.worldToScreen(point.x, point.value);
      const color =
        index === this._selectedPointIndex ? this._settings.selectedPointColor : this._settings.pointColor;

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
        this._selectedPointIndex = clickedPoint;
        this._isDragging = true;
      } else {
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        this.addPoint(worldPos.x, worldPos.y);
      }
    }
    if (ImGui.IsMouseClicked(1)) {
      const clickedPoint = this.findPointNear(relativeMousePos);
      if (clickedPoint !== -1 && clickedPoint !== 0 && clickedPoint !== this._points.length - 1) {
        this.removePoint(clickedPoint);
      }
    }
    if (this._isDragging && this._selectedPointIndex !== -1) {
      if (ImGui.IsMouseDown(0)) {
        const worldPos = this.screenToWorld(relativeMousePos.x, relativeMousePos.y);
        if (this._selectedPointIndex === 0 || this._selectedPointIndex === this._points.length - 1) {
          this.updatePointValue(this._selectedPointIndex, worldPos.y);
        } else {
          const minTime = this._points[0].x;
          const maxTime = this._points[this._points.length - 1].x;
          const clampedTime = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, worldPos.x));
          this.updatePointPosition(this._selectedPointIndex, clampedTime, worldPos.y);
        }
      } else {
        this._isDragging = false;
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
      ((time - this._settings.timeRange[0]) / (this._settings.timeRange[1] - this._settings.timeRange[0])) *
      this._canvasSize.x
    );
  }
  private valueToScreen(value: number): number {
    return (
      (1 -
        (value - this._settings.valueRange[0]) /
          (this._settings.valueRange[1] - this._settings.valueRange[0])) *
      this._canvasSize.y
    );
  }
  private screenToTime(x: number): number {
    return (
      this._settings.timeRange[0] +
      (x / this._canvasSize.x) * (this._settings.timeRange[1] - this._settings.timeRange[0])
    );
  }
  private screenToValue(y: number): number {
    return (
      this._settings.valueRange[0] +
      (1 - y / this._canvasSize.y) * (this._settings.valueRange[1] - this._settings.valueRange[0])
    );
  }
  private isPointInCanvas(point: ImGui.ImVec2): boolean {
    return point.x >= 0 && point.x <= this._canvasSize.x && point.y >= 0 && point.y <= this._canvasSize.y;
  }
  private findPointNear(screenPos: ImGui.ImVec2, threshold: number = 10): number {
    for (let i = 0; i < this._points.length; i++) {
      const pointScreen = this.worldToScreen(this._points[i].x, this._points[i].value);
      const dx = pointScreen.x - screenPos.x;
      const dy = pointScreen.y - screenPos.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        return i;
      }
    }
    return -1;
  }
  private addPoint(time: number, value: number): void {
    const minTime = this._points[0].x;
    const maxTime = this._points[this._points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));
    value = Math.max(this._settings.valueRange[0], Math.min(this._settings.valueRange[1], value));
    const newPoint: Point = {
      x: time,
      value: value
    };
    this._points.push(newPoint);
    this.sortPoints();
    this.updateInterpolator();
    this._selectedPointIndex = this._points.findIndex((p) => p === newPoint);
  }
  private removePoint(index: number): void {
    if (index < 0 || index >= this._points.length) {
      return;
    }
    if (this._points.length <= 2) {
      ImGui.OpenPopup('Cannot Remove Point');
      return;
    }
    this._points.splice(index, 1);
    if (this._selectedPointIndex === index) {
      this._selectedPointIndex = -1;
    } else if (this._selectedPointIndex > index) {
      this._selectedPointIndex--;
    }
    this.updateInterpolator();
  }
  private updatePointValue(index: number, newValue: number): void {
    if (index < 0 || index >= this._points.length) {
      return;
    }
    newValue = Math.max(this._settings.valueRange[0], Math.min(this._settings.valueRange[1], newValue));
    this._points[index].value = newValue;
    this.updateInterpolator();
  }
  private updatePointPosition(index: number, time: number, value: number): void {
    if (index <= 0 || index >= this._points.length - 1) {
      return; // 保护首尾点的位置
    }
    const minTime = this._points[0].x;
    const maxTime = this._points[this._points.length - 1].x;
    time = Math.max(minTime + 0.001, Math.min(maxTime - 0.001, time));
    value = Math.max(this._settings.valueRange[0], Math.min(this._settings.valueRange[1], value));
    this._points[index].x = time;
    this._points[index].value = value;
    this.sortPoints();
    if (this._selectedPointIndex === index) {
      this._selectedPointIndex = this._points.findIndex((p) => p.x === time);
    }
    this.updateInterpolator();
  }

  private updateInterpolator(): void {
    if (this._points.length < 2) {
      this._interpolator = null;
      return;
    }
    const inputs = new Float32Array(this._points.length);
    const outputs = new Float32Array(this._points.length);
    for (let i = 0; i < this._points.length; i++) {
      inputs[i] = this._points[i].x;
      outputs[i] = this._points[i].value;
    }
    this._interpolator = new Interpolator(this._settings.interpolationType, 'number', inputs, outputs);
    this._curveDirty = true;
  }
  getValue(time: number): number {
    if (!this._interpolator || this._points.length < 2) {
      return 0;
    }
    const result = new Float32Array(1);
    this._interpolator.interpolate(time, result);
    return result[0];
  }
}
