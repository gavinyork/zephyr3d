/**
 * A queue of items each queued at most once until the queue is taken, without hashing.
 *
 * @remarks
 * Each item keeps a stamp: the generation of the queue it is waiting in. Queuing an item whose
 * stamp equals the generation of this queue does nothing. Taking the items starts a new
 * generation, so items may queue themselves again while the taken ones are processed, for the
 * next round.
 *
 * Generations come from one counter shared by all queues, so an item moving from the queue of
 * one scene to that of another is never mistaken for already queued. Each kind of queue an item
 * may be in at the same time must keep its stamp in its own field.
 *
 * @internal
 */
export class UpdateQueue<T> {
  /** Starts at 1, since stamps of items never queued are 0 */
  private static _nextGeneration = 1;
  private _generation: number;
  private _items: T[];
  private readonly _getStamp: (item: T) => number | undefined;
  private readonly _setStamp: (item: T, stamp: number) => void;
  /**
   * @param getStamp - Reads the stamp of an item, undefined for an item never queued
   * @param setStamp - Writes the stamp of an item
   */
  constructor(getStamp: (item: T) => number | undefined, setStamp: (item: T, stamp: number) => void) {
    this._generation = UpdateQueue._nextGeneration++;
    this._items = [];
    this._getStamp = getStamp;
    this._setStamp = setStamp;
  }
  /** Number of items queued */
  get size() {
    return this._items.length;
  }
  /** Queue an item, unless it is queued already */
  add(item: T) {
    if (this._getStamp(item) !== this._generation) {
      this._setStamp(item, this._generation);
      this._items.push(item);
    }
  }
  /**
   * Take the queued items in the order they were queued, leaving the queue empty and ready to
   * queue any item again
   */
  take() {
    const items = this._items;
    this._items = [];
    this._generation = UpdateQueue._nextGeneration++;
    return items;
  }
  /** Drop all queued items */
  clear() {
    this.take();
  }
}
