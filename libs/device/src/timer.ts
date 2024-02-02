/**
 * Abstract timer interface
 * @public
 */
export interface ITimer {
  begin(): void;
  end(): void;
  ended(): boolean;
  elapsed(): number;
}

/**
 * CPU timer class
 * @public
 */
export class CPUTimer implements ITimer {
  /** @internal */
  private _cpuTimer: Performance | DateConstructor;
  /** @internal */
  private _cpuStart: number;
  /** @internal */
  private _cpuTime: number;
  /** @internal */
  private _ended: boolean;
  constructor() {
    this._cpuTimer = window.performance || window.Date;
    this._cpuTime = null;
    this._ended = false;
  }
  now(): number {
    return this._cpuTimer.now();
  }
  begin() {
    this._cpuStart = this.now();
    this._cpuTime = null;
    this._ended = false;
  }
  end() {
    this._cpuTime = this.now() - this._cpuStart;
    this._ended = true;
  }
  ended(): boolean {
    return this._ended;
  }
  elapsed(): number {
    return this._cpuTime;
  }
}
