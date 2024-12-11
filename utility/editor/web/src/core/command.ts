export interface Command {
  desc: string;
  execute(): void;
  undo(): void;
}

export class CommandManager {
  private _undoStack: Command[];
  private _depth: number;
  constructor(depth = 1000) {
    this._depth = depth;
    this._undoStack = [];
  }
  execute(command: Command) {
    command.execute();
    this._undoStack.push(command);
    if (this._undoStack.length > this._depth) {
      this._undoStack.shift();
    }
  }
  undo() {
    if (this._undoStack.length > 0) {
      const lastCommand = this._undoStack.pop();
      lastCommand.undo();
    }
  }
}
