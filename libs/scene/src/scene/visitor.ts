/**
 * Visior
 * @public
 */
export interface Visitor<T> {
  visit(target: T): unknown;
}
