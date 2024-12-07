import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Frame } from './ui/frame';

export class Studio {
  private _frame: Frame;
  constructor() {
    this._frame = new Frame();
  }
  handleEvent(ev: Event, type?: string): boolean {
    return imGuiInjectEvent(ev, type);
  }
  resize(w: number, h: number) {}
  update(dt: number) {}
  render() {
    imGuiNewFrame();
    this._frame.render();
    imGuiEndFrame();
  }
}
