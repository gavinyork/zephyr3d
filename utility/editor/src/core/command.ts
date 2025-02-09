export abstract class Command<T = void> {
  protected _desc: string;
  constructor(desc?: string) {
    this._desc = desc ?? '';
  }
  getDesc() {
    return this._desc;
  }
  setDesc(desc: string): this {
    this._desc = desc;
    return this;
  }
  abstract execute(): Promise<T>;
  abstract undo(): Promise<void>;
}

export class CommandManager {
  private _undoStack: Command<any>[];
  private _current: number;
  private _executing: boolean;
  constructor() {
    this._undoStack = [];
    this._current = 0;
    this._executing = false;
  }
  clear() {
    this._undoStack = [];
    this._current = 0;
  }
  async execute<T>(command: Command<T>): Promise<T> {
    if (!this._executing) {
      this._executing = true;
      const result = await command.execute();
      this._undoStack.splice(this._current);
      this._undoStack.push(command);
      this._current++;
      this._executing = false;
      return result;
    }
    return null;
  }
  getUndoCommand(): Command {
    return this._current > 0 ? this._undoStack[this._current - 1] : null;
  }
  getRedoCommand(): Command {
    return this._current < this._undoStack.length ? this._undoStack[this._current] : null;
  }
  async undo() {
    if (!this._executing && this._current > 0) {
      this._executing = true;
      await this._undoStack[--this._current].undo();
      this._executing = false;
    }
  }
  async redo() {
    if (!this._executing && this._current < this._undoStack.length) {
      this._executing = true;
      await this._undoStack[this._current++].execute();
      this._executing = false;
    }
  }
}
