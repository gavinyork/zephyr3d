/**
 * The list iterator class
 * @public
 */
export class ListIterator<T = unknown> {
  /** @internal */
  private _node: ListNodeImpl;
  /** @internal */
  private readonly _reverse: boolean;
  /** @internal */
  private readonly _dl: List<T>;
  /** @internal */
  constructor(dl: List<T>, node: ListNodeImpl, reverse: boolean) {
    this._dl = dl;
    this._node = node;
    this._reverse = reverse;
  }
  /**
   * Check that the iterator points to a valid list node
   *
   * @returns true if the iterator points to a valid list node, otherwise false
   *
   * @public
   */
  valid() {
    return this._node !== this._dl.head;
  }
  /**
   * Let the iterator point to the next list node
   *
   * @returns self
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */
  next() {
    if (!this.valid()) {
      throw new Error('ListIterator.next(): iterator is invalid');
    }
    this._node = this._reverse ? this._node.prev : this._node.next;
    return this;
  }
  /**
   * Get a new iterator pointing to the next list node
   *
   * @returns the new iterator
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */
  getNext() {
    if (!this.valid()) {
      throw new Error('ListIterator.getNext(): iterator is invalid');
    }
    return new ListIterator<T>(this._dl, this._reverse ? this._node.prev : this._node.next, this._reverse);
  }
  /**
   * Let the iterator point to the previous list node
   *
   * @returns self
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */
  prev() {
    if (!this.valid()) {
      throw new Error('ListIterator.prev(): iterator is invalid');
    }
    this._node = this._reverse ? this._node.next : this._node.prev;
    return this;
  }
  /**
   * Get a new iterator pointing to the previous list node
   *
   * @returns the new iterator
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */
  getPrev() {
    if (!this.valid()) {
      throw new Error('ListIterator.getPrev(): iterator is invalid');
    }
    return new ListIterator<T>(this._dl, this._reverse ? this._node.next : this._node.prev, this._reverse);
  }
  /** @internal */
  get node() {
    return this._node;
  }
  /** @internal */
  set node(n) {
    this._node = n;
  }
  /**
   * Returns whether the iterator is reversed.
   *
   * @returns true if the iterator is reversed, otherwise false
   *
   * @public
   */
  get reversed() {
    return this._reverse;
  }
  /**
   * Returns the list object to which the iterator belongs.
   *
   * @returns The list object to which the iterator belongs.
   *
   * @public
   */
  get list() {
    return this._dl;
  }
  /**
   * Gets the data associated with the iterator
   *
   * The exception is thrown if the iterator is invalid
   *
   * @public
   */
  get data() {
    if (!this.valid()) {
      throw new Error('ListIterator.data: iterator is invalid');
    }
    return (this._node as ListNode<T>).data;
  }
  set data(val: T) {
    if (this.valid()) {
      (this._node as ListNode<T>).data = val;
    }
  }
}

/**
 * The double list class
 *
 * @typeParam T - The data type associated with the linked list class
 *
 * @public
 */
export class List<T = unknown> {
  /** @internal */
  private readonly _head: ListNodeImpl;
  /** @internal */
  private _length: number;
  constructor() {
    this._head = new ListNodeImpl();
    this._length = 0;
  }
  /** @internal */
  get head() {
    return this._head;
  }
  /**
   * Get the number of elements in the linked list
   *
   * @returns The number of elements in the linked list
   */
  get length() {
    return this._length;
  }
  /**
   * Remove all elements in the linked list
   */
  clear() {
    while (this._length > 0) {
      this.remove(this.begin());
    }
  }
  /**
   * Append an element to the end of the linked list
   *
   * @param data - The data associated to the element
   * @returns An iterator pointing to the newly added element
   *
   * @public
   */
  append(data: T) {
    return this._insertAt(data, this._head);
  }
  /**
   * Add a new element to the linked list header
   *
   * @param data - The data associated to the element
   * @returns An iterator pointing to the newly added element
   *
   * @public
   */
  prepend(data: T) {
    return this._insertAt(data, this._head.next);
  }
  /**
   * Deletes an element from the linked list
   *
   * @param it - An iterator pointing to the element that needs to be removed
   *
   * @public
   */
  remove(it: ListIterator<T>) {
    if (it.valid() && it.list === this) {
      const node = it.node;
      it.next();
      this._remove(node);
    }
  }
  /**
   * Inserts an element into the linked list
   * @param data - The data to be inserted to the list
   * @param at - An iterator pointing to the element at the insert position
   * @returns An iterator pointing to the element that was inserted
   *
   * @public
   */
  insert(data: T, at: ListIterator<T>) {
    if (at.list === this) {
      if (at.valid()) {
        if (at.reversed) {
          return this._insertAt(data, at.node.next);
        } else {
          return this._insertAt(data, at.node);
        }
      } else {
        return this.append(data);
      }
    }
    return null;
  }
  /**
   * Execute the callback function sequentially for each element of the linked list
   * @param callback - The function to be executed
   *
   * @public
   */
  forEach(callback: (data: T) => void) {
    if (callback) {
      for (let it = this.begin(); it.valid(); it.next()) {
        callback(it.data);
      }
    }
  }
  /**
   * Execute the callback function sequentially for each element of the linked list in the reversed order
   * @param callback - The function to be executed
   *
   * @public
   */
  forEachReverse(callback: (data: T) => void) {
    if (callback) {
      for (let it = this.rbegin(); it.valid(); it.next()) {
        callback(it.data);
      }
    }
  }
  /**
   * Gets the data associated to the first element in the linked list
   * @returns The data associated to the first element in the linked list
   *
   * The exception is thrown if the list is empty
   *
   * @public
   */
  front() {
    if (this.length === 0) {
      throw new Error('List.front(): list is empty');
    }
    return this.begin().data;
  }
  /**
   * Gets the data associated to the last element in the linked list
   * @returns The data associated to the last element in the linked list
   *
   * The exception is thrown if the list is empty
   *
   * @public
   */
  back() {
    if (this.length === 0) {
      throw new Error('List.back(): list is empty');
    }
    return this.rbegin().data;
  }
  /**
   * Returns an iterator pointing to the first element in the list.
   * @returns An iterator to the beginning of the list.
   *
   * @public
   */
  begin() {
    return new ListIterator(this, this._length > 0 ? this._head.next : this._head, false);
  }
  /**
   * Returns an iterator referring to the past-the-end element in the list.
   * @returns An iterator to the element past the end of the list.
   *
   * @public
   */
  end() {
    return new ListIterator(this, this._head, false);
  }
  /**
   * Returns a reverse iterator pointing to the last element in the list (i.e., its reverse beginning).
   * @returns A reverse iterator to the reverse beginning of the list.
   *
   * @public
   */
  rbegin() {
    return new ListIterator(this, this._length > 0 ? this._head.prev : this._head, true);
  }
  /**
   * Returns a reverse iterator pointing to the theoretical element preceding the first element in the list (which is considered its reverse end).
   * @returns A reverse iterator to the reverse end of the list.
   *
   * @public
   */
  rend() {
    return new ListIterator(this, this._head, true);
  }
  /** @internal */
  private _remove(node: ListNodeImpl) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    this._length--;
  }
  /** @internal */
  private _insertAt(data: T, node: ListNodeImpl) {
    const newNode = new ListNode(data);
    newNode.next = node;
    newNode.prev = node.prev;
    node.prev.next = newNode;
    node.prev = newNode;
    this._length++;
    return new ListIterator(this, newNode, false);
  }
}

class ListNodeImpl {
  next: ListNodeImpl;
  prev: ListNodeImpl;
  constructor() {
    this.next = this;
    this.prev = this;
  }
}

class ListNode<T = unknown> extends ListNodeImpl {
  data: T;
  constructor(data: T) {
    super();
    this.data = data;
  }
}
