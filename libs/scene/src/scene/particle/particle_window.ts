/**
 * The serials of the particles that may still be alive.
 *
 * Particles are numbered in birth order; serial s lives in slot s % capacity. Each frame's births
 * form a batch, which expires when the longest lifetime possible at its birth has passed: from
 * then on every particle in it is dead. The serials from the first unexpired batch on are the
 * window, never more than the capacity, which the simulation steps each frame. Nothing is read
 * back from the GPU: the window only depends on the births and the lifetime bounds.
 * @internal
 */
export class ParticleWindow {
  /** First serial that may be alive */
  private _start: number;
  /** Serial of the next particle born */
  private _end: number;
  /** End serial of each unexpired batch, oldest first, from _head on */
  private _batchEnd: number[];
  /** Simulation time each unexpired batch expires at */
  private _batchExpire: number[];
  private _head: number;
  constructor() {
    this._start = 0;
    this._end = 0;
    this._batchEnd = [];
    this._batchExpire = [];
    this._head = 0;
  }
  /** First serial that may be alive */
  get start() {
    return this._start;
  }
  /** Serial of the next particle born */
  get end() {
    return this._end;
  }
  /** Number of particles that may be alive */
  get size() {
    return this._end - this._start;
  }
  /** Drops every particle */
  clear() {
    this._start = this._end;
    this._batchEnd.length = 0;
    this._batchExpire.length = 0;
    this._head = 0;
  }
  /**
   * Drops the batches that have expired
   * @param now - Simulation time
   */
  expire(now: number) {
    const n = this._batchEnd.length;
    while (this._head < n && this._batchExpire[this._head] <= now) {
      this._start = this._batchEnd[this._head];
      this._head++;
    }
    if (this._head === n) {
      this._batchEnd.length = 0;
      this._batchExpire.length = 0;
      this._head = 0;
    } else if (this._head > 64 && this._head * 2 > n) {
      this._batchEnd.splice(0, this._head);
      this._batchExpire.splice(0, this._head);
      this._head = 0;
    }
  }
  /**
   * Adds a batch of births
   * @param count - Number of particles born
   * @param expire - Simulation time by which all of them have died
   */
  push(count: number, expire: number) {
    if (count <= 0) {
      return;
    }
    this._end += count;
    const last = this._batchEnd.length - 1;
    if (last >= this._head && this._batchExpire[last] >= expire) {
      // Dies no later than the batch before it: merge, the window can only end later
      this._batchEnd[last] = this._end;
    } else {
      this._batchEnd.push(this._end);
      this._batchExpire.push(expire);
    }
  }
}
