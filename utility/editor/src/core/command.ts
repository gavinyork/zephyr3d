export interface Command {
  desc: string;
  execute(): void;
  undo(): void;
}

export class CommandManager {
  private _undoStack: Command[];
  private _current: number;
  constructor() {
    this._undoStack = [];
    this._current = 0;
  }
  execute(command: Command) {
    command.execute();
    this._undoStack.splice(this._current);
    this._undoStack.push(command);
    this._current++;
  }
  canUndo() {
    return this._current > 0;
  }
  canRedo() {
    return this._current < this._undoStack.length;
  }
  undo() {
    if (this._current > 0) {
      this._undoStack[--this._current].undo();
    }
  }
  redo() {
    if (this._current < this._undoStack.length) {
      this._undoStack[this._current++].execute();
    }
  }
}
