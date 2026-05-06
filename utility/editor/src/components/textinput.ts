import { getDevice } from '@zephyr3d/scene';
import { ImGui, imGuiCalcTextSize, imGuiWantCaptureKeyboard } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';

export enum CustomInputTextFlags {
  None = 0,
  CharsDecimal = 1, // Allow 0123456789.+-*/
  CharsHexadecimal = 2, // Allow 0123456789ABCDEFabcdef
  CharsUppercase = 4, // Turn a..z into A..Z
  CharsNoBlank = 8, // Filter out spaces, tabs
  AutoSelectAll = 16, // Select entire text when first taking mouse focus
  EnterReturnsTrue = 32, // Return 'true' when Enter is pressed (as opposed to when the value was modified)
  AllowTabInput = 1024, // Pressing TAB input a '\t' character into the text field
  CtrlEnterForNewLine = 2048, // In multi-line mode, unfocus with Enter, add new line with Ctrl+Enter (default is opposite: unfocus with Ctrl+Enter, add line with Enter).
  ReadOnly = 16384, // Read-only mode
  Password = 32768, // Password mode, display all characters as '*'
  Multiline = 1048576 // For internal use by InputTextMultiline()
}

type GraphemeInfo = {
  text: string;
  displayText: string;
  start: number;
  end: number;
  x0: number;
  x1: number;
};

type LineLayout = {
  text: string;
  displayText: string;
  start: number;
  end: number;
  width: number;
  graphemes: GraphemeInfo[];
};

type TextLayout = {
  lines: LineLayout[];
  lineHeight: number;
  maxWidth: number;
  totalHeight: number;
  boundaries: number[];
};

type ControlState = {
  id: number;
  lastFrame: number;
  flags: CustomInputTextFlags;
  scrollX: number;
  scrollY: number;
  dragging: boolean;
  dragAnchor: number;
  lastExternalValue: string;
  submitRequested: boolean;
  blinkStartTime: number;
  lastSelectionStart: number;
  lastSelectionEnd: number;
};

const controlStates = new Map<number, ControlState>();
const widthCache = new Map<string, number>();
const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

let hiddenTextarea: HTMLTextAreaElement | null = null;
let activeControlId: number | null = null;
let lastProcessedFrame = -1;

function normalizeText(text: string) {
  return (text ?? '').replace(/\r\n/g, '\n');
}

function getVisibleLabel(label: string) {
  const marker = label.indexOf('##');
  return marker >= 0 ? label.slice(0, marker) : label;
}

function hasFlag(flags: CustomInputTextFlags, flag: CustomInputTextFlags) {
  return (flags & flag) !== 0;
}

function normalizeFlags(flags: CustomInputTextFlags | undefined) {
  return (flags ?? CustomInputTextFlags.None) as CustomInputTextFlags;
}

function filterInputText(text: string, flags: CustomInputTextFlags, multiline: boolean) {
  const allowDecimal = hasFlag(flags, CustomInputTextFlags.CharsDecimal);
  const allowHex = hasFlag(flags, CustomInputTextFlags.CharsHexadecimal);
  const uppercase = hasFlag(flags, CustomInputTextFlags.CharsUppercase);
  const noBlank = hasFlag(flags, CustomInputTextFlags.CharsNoBlank);
  let result = '';
  for (const ch of Array.from(text)) {
    if (ch === '\r') {
      continue;
    }
    if (ch === '\n') {
      if (multiline) {
        result += ch;
      }
      continue;
    }
    if (noBlank && (ch === ' ' || ch === '\t')) {
      continue;
    }
    let accepted = true;
    if (allowDecimal || allowHex) {
      accepted = false;
      if (allowDecimal && /[0-9.+\-*/]/.test(ch)) {
        accepted = true;
      }
      if (allowHex && /[0-9a-fA-F]/.test(ch)) {
        accepted = true;
      }
    }
    if (!accepted) {
      continue;
    }
    result += uppercase ? ch.toUpperCase() : ch;
  }
  return result;
}

function ensureHiddenTextarea() {
  if (hiddenTextarea) {
    return hiddenTextarea;
  }
  hiddenTextarea = document.createElement('textarea');
  hiddenTextarea.spellcheck = false;
  hiddenTextarea.wrap = 'off';
  hiddenTextarea.autocapitalize = 'off';
  hiddenTextarea.autocomplete = 'off';
  hiddenTextarea.autocorrect = false;
  hiddenTextarea.tabIndex = -1;
  hiddenTextarea.setAttribute('aria-hidden', 'true');
  hiddenTextarea.style.position = 'fixed';
  hiddenTextarea.style.left = '-10000px';
  hiddenTextarea.style.top = '-10000px';
  hiddenTextarea.style.width = '1px';
  hiddenTextarea.style.height = '1px';
  hiddenTextarea.style.opacity = '0';
  hiddenTextarea.style.pointerEvents = 'none';
  hiddenTextarea.style.resize = 'none';
  hiddenTextarea.style.overflow = 'hidden';
  hiddenTextarea.style.whiteSpace = 'pre';
  hiddenTextarea.style.zIndex = '-1';
  hiddenTextarea.addEventListener('blur', () => {
    if (document.activeElement !== hiddenTextarea) {
      activeControlId = null;
      moveTextareaOffscreen();
    }
  });
  hiddenTextarea.addEventListener('keydown', (ev) => {
    const state = activeControlId !== null ? controlStates.get(activeControlId) : null;
    if (!state) {
      return;
    }
    const flags = state.flags;
    const multiline = hasFlag(flags, CustomInputTextFlags.Multiline);
    const readOnly = hasFlag(flags, CustomInputTextFlags.ReadOnly);
    const allowTabInput = hasFlag(flags, CustomInputTextFlags.AllowTabInput);
    const enterReturnsTrue = hasFlag(flags, CustomInputTextFlags.EnterReturnsTrue);
    const ctrlEnterForNewLine = hasFlag(flags, CustomInputTextFlags.CtrlEnterForNewLine);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      blurHiddenTextarea();
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (allowTabInput && !readOnly) {
        insertTextIntoTextarea('\t');
      } else {
        blurHiddenTextarea();
      }
      return;
    }
    if (ev.key === 'Enter') {
      if (!multiline) {
        if (enterReturnsTrue) {
          state.submitRequested = true;
          state.blinkStartTime = ImGui.GetTime();
          state.lastSelectionStart = hiddenTextarea.selectionStart ?? 0;
          state.lastSelectionEnd = hiddenTextarea.selectionEnd ?? state.lastSelectionStart;
          blurHiddenTextarea();
        }
        ev.preventDefault();
        return;
      }
      const submitByCtrl = !ctrlEnterForNewLine;
      const wantsSubmit = submitByCtrl ? ev.ctrlKey : !ev.ctrlKey;
      const wantsNewLine = ctrlEnterForNewLine ? ev.ctrlKey : !ev.ctrlKey;
      if (wantsSubmit) {
        if (enterReturnsTrue) {
          state.submitRequested = true;
          state.blinkStartTime = ImGui.GetTime();
          state.lastSelectionStart = hiddenTextarea.selectionStart ?? 0;
          state.lastSelectionEnd = hiddenTextarea.selectionEnd ?? state.lastSelectionStart;
        }
        ev.preventDefault();
        blurHiddenTextarea();
        return;
      }
      if (wantsNewLine && readOnly) {
        ev.preventDefault();
        return;
      }
    }
  });
  document.body.appendChild(hiddenTextarea);
  return hiddenTextarea;
}

function moveTextareaOffscreen() {
  const textarea = ensureHiddenTextarea();
  textarea.style.left = '-10000px';
  textarea.style.top = '-10000px';
}

function blurHiddenTextarea() {
  const textarea = ensureHiddenTextarea();
  textarea.blur();
  activeControlId = null;
  moveTextareaOffscreen();
  const canvas = getDevice()?.canvas as HTMLElement | undefined;
  canvas?.focus?.();
}

function focusHiddenTextarea(value: string, selectionStart: number, selectionEnd: number) {
  const textarea = ensureHiddenTextarea();
  if (textarea.value !== value) {
    textarea.value = value;
  }
  textarea.setSelectionRange(selectionStart, selectionEnd, 'none');
  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
}

function insertTextIntoTextarea(text: string) {
  const textarea = ensureHiddenTextarea();
  const value = textarea.value;
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const next = start + text.length;
  textarea.setSelectionRange(next, next, 'none');
}

function measureTextWidth(text: string) {
  if (!text) {
    return 0;
  }
  const displayText = convertEmojiString(text);
  const cached = widthCache.get(displayText);
  if (cached !== undefined) {
    return cached;
  }
  const width = imGuiCalcTextSize(displayText).x;
  widthCache.set(displayText, width);
  return width;
}

function splitGraphemes(text: string) {
  if (!text) {
    return [] as { text: string; start: number; end: number }[];
  }
  if (graphemeSegmenter) {
    const result: { text: string; start: number; end: number }[] = [];
    for (const item of graphemeSegmenter.segment(text) as any as Iterable<{
      segment: string;
      index: number;
    }>) {
      result.push({
        text: item.segment,
        start: item.index,
        end: item.index + item.segment.length
      });
    }
    return result;
  }
  const result: { text: string; start: number; end: number }[] = [];
  let index = 0;
  for (const ch of Array.from(text)) {
    const end = index + ch.length;
    result.push({ text: ch, start: index, end });
    index = end;
  }
  return result;
}

function buildTextLayout(text: string, lineHeight: number, flags: CustomInputTextFlags): TextLayout {
  const lines: LineLayout[] = [];
  const boundaries = new Set<number>();
  boundaries.add(0);
  const password = hasFlag(flags, CustomInputTextFlags.Password);
  const rawLines = text.split('\n');
  let cursor = 0;
  let maxWidth = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const lineText = rawLines[i];
    const graphemes = splitGraphemes(lineText);
    const line: LineLayout = {
      text: lineText,
      displayText: '',
      start: cursor,
      end: cursor + lineText.length,
      width: 0,
      graphemes: []
    };
    let x = 0;
    let displayText = '';
    for (const grapheme of graphemes) {
      const displayChar = password ? '*' : grapheme.text;
      const width = measureTextWidth(displayChar);
      line.graphemes.push({
        text: grapheme.text,
        displayText: displayChar,
        start: line.start + grapheme.start,
        end: line.start + grapheme.end,
        x0: x,
        x1: x + width
      });
      displayText += displayChar;
      x += width;
      boundaries.add(line.start + grapheme.end);
    }
    line.displayText = displayText;
    line.width = x;
    maxWidth = Math.max(maxWidth, x);
    boundaries.add(line.start);
    boundaries.add(line.end);
    lines.push(line);
    cursor = line.end;
    if (i < rawLines.length - 1) {
      cursor += 1;
      boundaries.add(cursor);
    }
  }
  return {
    lines,
    lineHeight,
    maxWidth,
    totalHeight: Math.max(lineHeight, lines.length * lineHeight),
    boundaries: Array.from(boundaries).sort((a, b) => a - b)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveControlWidth(width?: number) {
  if (width === undefined) {
    return ImGui.CalcItemWidth();
  }
  if (width === -1) {
    return ImGui.GetContentRegionAvail().x;
  }
  if (width < 0) {
    return ImGui.GetContentRegionAvail().x + width;
  }
  return width;
}

function snapToBoundary(layout: TextLayout, index: number) {
  const maxIndex =
    layout.lines.length > 0 ? layout.lines[layout.lines.length - 1].end + layout.lines.length - 1 : 0;
  const clamped = clamp(index, 0, maxIndex);
  const boundaries = layout.boundaries;
  if (boundaries.length === 0) {
    return 0;
  }
  let prev = boundaries[0];
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    if (boundary === clamped) {
      return boundary;
    }
    if (boundary > clamped) {
      return clamped - prev <= boundary - clamped ? prev : boundary;
    }
    prev = boundary;
  }
  return boundaries[boundaries.length - 1];
}

function findLineIndex(layout: TextLayout, index: number) {
  for (let i = 0; i < layout.lines.length; i++) {
    if (index <= layout.lines[i].end) {
      return i;
    }
  }
  return Math.max(0, layout.lines.length - 1);
}

function getCaretX(line: LineLayout, index: number) {
  if (index <= line.start) {
    return 0;
  }
  for (const grapheme of line.graphemes) {
    if (index <= grapheme.start) {
      return grapheme.x0;
    }
    if (index < grapheme.end) {
      return grapheme.x0;
    }
    if (index === grapheme.end) {
      return grapheme.x1;
    }
  }
  return line.width;
}

function indexFromPoint(layout: TextLayout, x: number, y: number) {
  const lineIndex = clamp(Math.floor(y / layout.lineHeight), 0, layout.lines.length - 1);
  const line = layout.lines[lineIndex];
  if (!line || line.graphemes.length === 0) {
    return line?.start ?? 0;
  }
  if (x <= 0) {
    return line.start;
  }
  for (const grapheme of line.graphemes) {
    const mid = (grapheme.x0 + grapheme.x1) * 0.5;
    if (x < mid) {
      return grapheme.start;
    }
    if (x <= grapheme.x1) {
      return grapheme.end;
    }
  }
  return line.end;
}

function syncSelectionToLayout(textarea: HTMLTextAreaElement, layout: TextLayout) {
  const start = snapToBoundary(layout, textarea.selectionStart ?? 0);
  const end = snapToBoundary(layout, textarea.selectionEnd ?? start);
  if (start !== textarea.selectionStart || end !== textarea.selectionEnd) {
    textarea.setSelectionRange(start, end, 'none');
  }
  return { start, end };
}

function syncActiveValue(content: [string], state: ControlState) {
  const textarea = ensureHiddenTextarea();
  const multiline = hasFlag(state.flags, CustomInputTextFlags.Multiline);
  const normalized = filterInputText(normalizeText(content[0]), state.flags, multiline);
  if (state.lastExternalValue !== normalized && textarea.value !== normalized) {
    const selectionStart = clamp(textarea.selectionStart ?? 0, 0, normalized.length);
    const selectionEnd = clamp(textarea.selectionEnd ?? selectionStart, 0, normalized.length);
    textarea.value = normalized;
    textarea.setSelectionRange(selectionStart, selectionEnd, 'none');
  }
  state.lastExternalValue = normalized;
  let changed = false;
  const textareaValue = filterInputText(normalizeText(textarea.value), state.flags, multiline);
  if (textareaValue !== textarea.value) {
    const selectionStart = clamp(textarea.selectionStart ?? 0, 0, textareaValue.length);
    const selectionEnd = clamp(textarea.selectionEnd ?? selectionStart, 0, textareaValue.length);
    textarea.value = textareaValue;
    textarea.setSelectionRange(selectionStart, selectionEnd, 'none');
  }
  if (textareaValue !== normalized) {
    content[0] = textareaValue;
    state.lastExternalValue = textareaValue;
    changed = true;
  }
  return changed;
}

function updateScrollForCaret(
  state: ControlState,
  layout: TextLayout,
  caretIndex: number,
  innerWidth: number,
  innerHeight: number
) {
  const lineIndex = findLineIndex(layout, caretIndex);
  const line = layout.lines[lineIndex];
  const caretX = getCaretX(line, caretIndex);
  const caretY = lineIndex * layout.lineHeight;
  const rightMargin = Math.max(8, innerWidth * 0.15);
  const bottomMargin = layout.lineHeight;
  if (caretX < state.scrollX) {
    state.scrollX = caretX;
  } else if (caretX > state.scrollX + innerWidth - rightMargin) {
    state.scrollX = caretX - innerWidth + rightMargin;
  }
  if (hasFlag(state.flags, CustomInputTextFlags.Multiline)) {
    if (caretY < state.scrollY) {
      state.scrollY = caretY;
    } else if (caretY + layout.lineHeight > state.scrollY + innerHeight - bottomMargin) {
      state.scrollY = caretY + layout.lineHeight - innerHeight + bottomMargin;
    }
  } else {
    state.scrollY = 0;
  }
}

function updateTextareaPlacement(
  caretX: number,
  caretY: number,
  lineHeight: number,
  clipMin: Readonly<{ x: number; y: number }>
) {
  const textarea = ensureHiddenTextarea();
  const canvas = getDevice()?.canvas as HTMLCanvasElement | undefined;
  if (!canvas) {
    return;
  }
  const io = ImGui.GetIO();
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, io.DisplaySize.x);
  const scaleY = rect.height / Math.max(1, io.DisplaySize.y);
  textarea.style.left = `${rect.left + (clipMin.x + caretX) * scaleX}px`;
  textarea.style.top = `${rect.top + (clipMin.y + caretY) * scaleY}px`;
  textarea.style.width = '1px';
  textarea.style.height = `${Math.max(1, lineHeight * scaleY)}px`;
}

function cleanupStaleStates(frame: number) {
  if (frame === lastProcessedFrame) {
    return;
  }
  lastProcessedFrame = frame;
  for (const [id, state] of controlStates) {
    if (state.lastFrame < frame - 1 && activeControlId !== id) {
      controlStates.delete(id);
    }
  }
  if (activeControlId !== null && !controlStates.has(activeControlId)) {
    blurHiddenTextarea();
  }
}

function getControlState(id: number, flags: CustomInputTextFlags, initialValue: string) {
  let state = controlStates.get(id);
  if (!state) {
    state = {
      id,
      lastFrame: 0,
      flags,
      scrollX: 0,
      scrollY: 0,
      dragging: false,
      dragAnchor: 0,
      lastExternalValue: initialValue,
      submitRequested: false,
      blinkStartTime: 0,
      lastSelectionStart: 0,
      lastSelectionEnd: 0
    };
    controlStates.set(id, state);
  }
  state.flags = flags;
  return state;
}

function setSelectionFromMouse(
  state: ControlState,
  layout: TextLayout,
  clipMin: Readonly<{ x: number; y: number }>,
  scrollX: number,
  scrollY: number,
  extend: boolean
) {
  const mouse = ImGui.GetMousePos();
  const localX = mouse.x - clipMin.x + scrollX;
  const localY = mouse.y - clipMin.y + scrollY;
  const index = snapToBoundary(layout, indexFromPoint(layout, localX, localY));
  const textarea = ensureHiddenTextarea();
  const anchor = extend ? state.dragAnchor : index;
  state.dragAnchor = anchor;
  textarea.setSelectionRange(
    Math.min(anchor, index),
    Math.max(anchor, index),
    anchor > index ? 'backward' : 'forward'
  );
  return index;
}

/**
 * Custom text input based on browser-native editing and ImGui custom rendering.
 *
 * @param label
 * @param content
 * @param placeholder
 * @param flags
 * @param width
 * @param height
 */
export function customTextInput(
  label: string,
  content: [string],
  placeholder = '',
  flags: CustomInputTextFlags = CustomInputTextFlags.None,
  width?: number,
  height?: number
): boolean {
  const frame = ImGui.GetFrameCount();
  cleanupStaleStates(frame);
  flags = normalizeFlags(flags);
  const multiline = hasFlag(flags, CustomInputTextFlags.Multiline);
  const readOnly = hasFlag(flags, CustomInputTextFlags.ReadOnly);
  const enterReturnsTrue = hasFlag(flags, CustomInputTextFlags.EnterReturnsTrue);
  const autoSelectAll = hasFlag(flags, CustomInputTextFlags.AutoSelectAll);

  const normalizedContent = filterInputText(normalizeText(content[0]), flags, multiline);
  if (normalizedContent !== content[0]) {
    content[0] = normalizedContent;
  }

  const id = ImGui.GetID(label);
  const state = getControlState(id, flags, content[0]);
  state.lastFrame = frame;

  const style = ImGui.GetStyle();
  const innerPaddingX = style.FramePadding.x;
  const innerPaddingY = style.FramePadding.y;
  const lineHeight = ImGui.GetTextLineHeight();
  const controlWidth = resolveControlWidth(width);
  const controlHeight = multiline
    ? (height ?? Math.max(ImGui.GetFrameHeight() * 4, lineHeight * 6 + innerPaddingY * 2))
    : (height ?? ImGui.GetFrameHeight());
  const size = new ImGui.ImVec2(Math.max(1, controlWidth), Math.max(1, controlHeight));

  ImGui.InvisibleButton(`##custom_text_input_${id}`, size, 0);
  const hovered = ImGui.IsItemHovered();
  const itemActive = ImGui.IsItemActive();
  const clicked = ImGui.IsItemClicked(ImGui.MouseButton.Left);
  const rectMin = ImGui.GetItemRectMin();
  const rectMax = ImGui.GetItemRectMax();
  const clipMin = new ImGui.ImVec2(rectMin.x + innerPaddingX, rectMin.y + innerPaddingY);
  const clipMax = new ImGui.ImVec2(rectMax.x - innerPaddingX, rectMax.y - innerPaddingY);
  const innerWidth = Math.max(1, clipMax.x - clipMin.x);
  const innerHeight = Math.max(1, clipMax.y - clipMin.y);
  const textarea = ensureHiddenTextarea();
  const active = activeControlId === id && document.activeElement === textarea;
  textarea.readOnly = readOnly;

  let changed = false;
  const submitted = state.submitRequested;
  state.submitRequested = false;
  if (active) {
    changed = syncActiveValue(content, state) || changed;
  }

  const layout = buildTextLayout(content[0], lineHeight, flags);
  const maxScrollX = Math.max(0, layout.maxWidth - innerWidth);
  const maxScrollY = multiline ? Math.max(0, layout.totalHeight - innerHeight) : 0;

  if (active) {
    const selection = syncSelectionToLayout(textarea, layout);
    updateScrollForCaret(state, layout, selection.end, innerWidth, innerHeight);
  }

  state.scrollX = clamp(state.scrollX, 0, maxScrollX);
  state.scrollY = clamp(state.scrollY, 0, maxScrollY);

  if (clicked) {
    const initialIndex = snapToBoundary(
      layout,
      indexFromPoint(
        layout,
        ImGui.GetMousePos().x - clipMin.x + state.scrollX,
        ImGui.GetMousePos().y - clipMin.y + state.scrollY
      )
    );
    activeControlId = id;
    state.dragAnchor = initialIndex;
    state.dragging = true;
    state.blinkStartTime = ImGui.GetTime();
    if (autoSelectAll && content[0].length > 0) {
      state.lastSelectionStart = 0;
      state.lastSelectionEnd = content[0].length;
      focusHiddenTextarea(content[0], 0, content[0].length);
      updateScrollForCaret(state, layout, content[0].length, innerWidth, innerHeight);
    } else {
      state.lastSelectionStart = initialIndex;
      state.lastSelectionEnd = initialIndex;
      focusHiddenTextarea(content[0], initialIndex, initialIndex);
      updateScrollForCaret(state, layout, initialIndex, innerWidth, innerHeight);
    }
  }

  if (activeControlId === id && itemActive && ImGui.IsMouseDown(ImGui.MouseButton.Left)) {
    const selectionIndex = setSelectionFromMouse(
      state,
      layout,
      clipMin,
      state.scrollX,
      state.scrollY,
      state.dragging
    );
    if (multiline) {
      const mouse = ImGui.GetMousePos();
      const dt = ImGui.GetIO().DeltaTime || 1 / 60;
      if (mouse.y < rectMin.y + 18) {
        state.scrollY = clamp(state.scrollY - dt * 320, 0, maxScrollY);
      } else if (mouse.y > rectMax.y - 18) {
        state.scrollY = clamp(state.scrollY + dt * 320, 0, maxScrollY);
      }
      if (mouse.x < rectMin.x + 18) {
        state.scrollX = clamp(state.scrollX - dt * 320, 0, maxScrollX);
      } else if (mouse.x > rectMax.x - 18) {
        state.scrollX = clamp(state.scrollX + dt * 320, 0, maxScrollX);
      }
    }
    updateScrollForCaret(state, layout, selectionIndex, innerWidth, innerHeight);
  }

  if (!ImGui.IsMouseDown(ImGui.MouseButton.Left)) {
    state.dragging = false;
  }

  if (hovered && multiline) {
    const wheel = ImGui.GetIO().MouseWheel;
    if (wheel !== 0) {
      state.scrollY = clamp(state.scrollY - wheel * lineHeight * 3, 0, maxScrollY);
    }
  }

  const drawList = ImGui.GetWindowDrawList();
  const bgColor = ImGui.GetColorU32(hovered ? ImGui.Col.FrameBgHovered : ImGui.Col.FrameBg);
  const borderColor = ImGui.GetColorU32(ImGui.Col.Border);
  const textColor = ImGui.GetColorU32(ImGui.Col.Text);
  const placeholderColor = ImGui.GetColorU32(ImGui.Col.TextDisabled);
  const selectionColor = ImGui.GetColorU32(new ImGui.ImVec4(0.16, 0.45, 0.85, 0.9));
  const selectedTextColor = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 1));
  drawList.AddRectFilled(rectMin, rectMax, bgColor, style.FrameRounding);
  drawList.AddRect(rectMin, rectMax, borderColor, style.FrameRounding, ImGui.DrawCornerFlags.None, 1);
  drawList.PushClipRect(clipMin, clipMax, true);

  let selectionStart = 0;
  let selectionEnd = 0;
  if (active) {
    const selection = syncSelectionToLayout(textarea, layout);
    selectionStart = Math.min(selection.start, selection.end);
    selectionEnd = Math.max(selection.start, selection.end);
    if (selection.start !== state.lastSelectionStart || selection.end !== state.lastSelectionEnd) {
      state.blinkStartTime = ImGui.GetTime();
      state.lastSelectionStart = selection.start;
      state.lastSelectionEnd = selection.end;
    }
    if (selectionStart !== selectionEnd) {
      for (let i = 0; i < layout.lines.length; i++) {
        const line = layout.lines[i];
        const localStart = clamp(selectionStart, line.start, line.end);
        const localEnd = clamp(selectionEnd, line.start, line.end);
        if (localStart >= localEnd) {
          continue;
        }
        const x0 = getCaretX(line, localStart) - state.scrollX;
        const x1 = getCaretX(line, localEnd) - state.scrollX;
        const y0 = i * layout.lineHeight - state.scrollY;
        drawList.AddRectFilled(
          new ImGui.ImVec2(clipMin.x + x0, clipMin.y + y0),
          new ImGui.ImVec2(clipMin.x + x1, clipMin.y + y0 + layout.lineHeight),
          selectionColor
        );
      }
    }
  }

  if (!content[0]) {
    drawList.AddText(clipMin, placeholderColor, convertEmojiString(placeholder ?? ''));
  } else {
    for (let i = 0; i < layout.lines.length; i++) {
      const y = clipMin.y + i * layout.lineHeight - state.scrollY;
      if (y + layout.lineHeight < clipMin.y || y > clipMax.y) {
        continue;
      }
      const line = layout.lines[i];
      const basePos = new ImGui.ImVec2(clipMin.x - state.scrollX, y);
      drawList.AddText(basePos, textColor, convertEmojiString(line.displayText));
      if (active && selectionStart !== selectionEnd) {
        const localStart = clamp(selectionStart, line.start, line.end);
        const localEnd = clamp(selectionEnd, line.start, line.end);
        if (localStart < localEnd) {
          for (const grapheme of line.graphemes) {
            if (grapheme.end <= localStart || grapheme.start >= localEnd) {
              continue;
            }
            drawList.AddText(
              new ImGui.ImVec2(clipMin.x + grapheme.x0 - state.scrollX, y),
              selectedTextColor,
              convertEmojiString(grapheme.displayText)
            );
          }
        }
      }
    }
  }

  if (active) {
    const selection = syncSelectionToLayout(textarea, layout);
    const lineIndex = findLineIndex(layout, selection.end);
    const line = layout.lines[lineIndex];
    const caretX = getCaretX(line, selection.end) - state.scrollX;
    const caretY = lineIndex * layout.lineHeight - state.scrollY;
    updateTextareaPlacement(caretX, caretY, layout.lineHeight, clipMin);
    const blinkElapsed = Math.max(0, ImGui.GetTime() - state.blinkStartTime);
    const caretVisible = blinkElapsed < 0.7 || blinkElapsed % 1.0 < 0.55;
    if (selection.start === selection.end && caretVisible) {
      drawList.AddLine(
        new ImGui.ImVec2(clipMin.x + caretX, clipMin.y + caretY),
        new ImGui.ImVec2(clipMin.x + caretX, clipMin.y + caretY + layout.lineHeight),
        textColor,
        1
      );
    }
    imGuiWantCaptureKeyboard(true);
  }

  drawList.PopClipRect();

  const visibleLabel = getVisibleLabel(label);
  if (visibleLabel) {
    ImGui.SameLine(0, style.ItemInnerSpacing.x);
    ImGui.TextUnformatted(visibleLabel);
  }

  return enterReturnsTrue ? submitted : changed;
}
