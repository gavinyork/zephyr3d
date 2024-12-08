import { eventBus } from './eventbus';

export interface Command {
  desc: string;
  execute(): CommandResult;
  undo(): CommandResult;
}

export interface CommandResult {
  success: boolean;
  message?: string;
}

export class CommandManager {
  private _undoStack: Command[];
  constructor() {
    this._undoStack = [];
  }
  execute(command: Command) {
    const result = command.execute();
    if (!result?.success) {
      eventBus.dispatchEvent('error', `Executing command <${command.desc}> failed: ${result?.message}`);
    } else {
      this._undoStack.push(command);
    }
  }
  undo() {
    if (this._undoStack.length > 0) {
      const lastCommand = this._undoStack.pop();
      const result = lastCommand.undo();
      if (!result?.success) {
        this._undoStack = [];
        eventBus.dispatchEvent('error', `Undo command <${lastCommand.desc}> failed: ${result?.message}`);
      }
    }
  }
}
