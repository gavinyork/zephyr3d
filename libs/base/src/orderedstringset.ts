/**
 * The OrderedStringSet class is used to create and manage an ordered set of strings.
 * It can be configured to allow or disallow duplicate strings based on a parameter passed to the constructor.
 *
 * @public
 */
export class OrderedStringSet {
  private readonly _items: string[];
  private readonly _allowDuplicates: boolean;

  /**
   * Creates a new instance of the OrderedStringSet class.
   *
   * @param allowDuplicates - A boolean value indicating whether the set should allow duplicate strings.
   */
  constructor(allowDuplicates = false) {
    this._items = [];
    this._allowDuplicates = allowDuplicates;
  }

  /**
   * An array of all strings in the set.
   */
  get items() {
    return [...this._items];
  }
  /**
   * Adds a new string to the set. If duplicates are not allowed and the string already exists, it is not added.
   *
   * @param str The string to add to the set.
   */
  add(str: string) {
    const position = this.findInsertPosition(str);

    if (position !== null) {
      this._items.splice(position, 0, str);
    }
  }

  /**
   * Removes the first occurrence of a specified string from the set using binary search.
   * If the string does not exist, no action is taken.
   *
   * @param str The string to remove from the set.
   */
  remove(str: string) {
    const position = this.findStringPosition(str);
    if (position !== -1) {
      // Only attempt to remove if the element exists.
      this._items.splice(position, 1);
    }
  }

  /**
   * Removes all elements that match a specified string from the collection.
   * This method first locates the first matching element, then continues to search
   * forward until it finds the first non-matching element, thereby determining the
   * range of all consecutive matching elements. Finally, it removes these elements
   * in a single operation.
   * If the collection does not contain any matching elements, no action is taken.
   *
   * @param str - The string to be removed from the collection.
   */
  removeAll(str: string) {
    const index = this.findStringPosition(str);

    // Return immediately if no matching element is found
    if (index === -1) {
      return;
    }

    // After finding the first matching element, continue to search for all
    // consecutive matching elements
    let endIndex = index + 1;
    while (endIndex < this._items.length && this._items[endIndex] === str) {
      endIndex++;
    }

    // Remove all matching elements in a single operation
    this._items.splice(index, endIndex - index);
  }

  /**
   * Checks if the specified string exists in the collection.
   *
   * @param str - The string to search for in the collection.
   * @returns true if the string is found in the collection; otherwise, false.
   */
  has(str: string) {
    return this.findStringPosition(str) >= 0;
  }

  /**
   * Uses binary search to find the index of a string in the set.
   * If the string exists, returns its index. Otherwise, returns -1.
   *
   * @param str The string to find in the set.
   * @returns The index of the string, or -1 if not found.
   */
  private findStringPosition(str: string) {
    let low = 0;
    let high = this._items.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this._items[mid] < str) {
        low = mid + 1;
      } else if (this._items[mid] > str) {
        high = mid - 1;
      } else {
        // Found the element, now make sure it's the first occurrence
        // by checking the preceding elements.
        let firstOccurrence = mid;
        while (firstOccurrence > 0 && this._items[firstOccurrence - 1] === str) {
          firstOccurrence--;
        }
        return firstOccurrence;
      }
    }
    return -1; // Element not found
  }
  /**
   * Uses binary search to find the correct insertion position for a string.
   * If duplicates are not allowed, it returns null for existing strings.
   *
   * @param str The string for which to find the insertion position.
   * @returns The position to insert the string, or null if the string exists and duplicates are not allowed.
   */
  private findInsertPosition(str: string) {
    let low = 0;
    let high = this._items.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this._items[mid] < str) {
        low = mid + 1;
      } else if (this._allowDuplicates || this._items[mid] > str) {
        high = mid - 1;
      } else {
        return this._allowDuplicates ? mid : null;
      }
    }

    return low; // The position where the element should be inserted.
  }
}
