import { canvas_on_keydown, canvas_on_keypress, canvas_on_keyup } from './imgui_impl';
import { ImGui } from './index';

export class Input {
  public _dom_input: HTMLInputElement;
  constructor() {
    this._dom_input = document.createElement('input');
    this._dom_input.style.position = 'fixed';
    this._dom_input.style.top = -10000 + 'px';
    this._dom_input.style.left = -10000 + 'px';
    this._dom_input.addEventListener('keydown', (e) => {
      this.onKeydown(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('keyup', (e) => {
      this.onKeyup(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('keypress', (e) => {
      this.onKeypress(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('compositionend', (e) => {
      this.onCompositionEnd(e as CompositionEvent);
    });
    document.body.appendChild(this._dom_input);
  }
  onKeydown(e: KeyboardEvent) {
    canvas_on_keydown(e);
  }
  onKeyup(e: KeyboardEvent) {
    canvas_on_keyup(e);
  }
  onKeypress(e: KeyboardEvent) {
    e.preventDefault();
    console.log(`key pressed: `);
    console.log(e);
    canvas_on_keypress(e);
  }
  onCompositionEnd(e: CompositionEvent) {
    e.preventDefault();
    for (let i = 0; i < e.data.length; i++) {
      const io = ImGui.GetIO();
      io.AddInputCharacter(e.data.charCodeAt(i));
    }
  }
  blur() {
    this._dom_input.blur();
  }
  focus() {
    this._dom_input.focus();
  }
}
