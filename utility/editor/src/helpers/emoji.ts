import { imGuiSetCharCodeMap } from '@zephyr3d/imgui';

const EMOJI_TO_PRIVATE_MAP: Record<string, number> = {
  '📁': 0xe000, // Folder close
  '📂': 0xe001, // Folder open
  '📦': 0xe002, // archive
  '🌐': 0xe003, // 3D model (.obj, .fbx, .dae, .gltf)
  '📄': 0xe004, // file
  '🖼️': 0xe005, // image
  '🔊': 0xe006, // audio
  '🎬': 0xe007, // video
  '🎞️': 0xe008, // animation
  '📜': 0xe009, // script
  '🎨': 0xe00a, // material
  '🎥': 0xe00b, // camera
  '📝': 0xe00c, // text
  '🌍': 0xe00d // earth
};

export function initEmojiMapping() {
  const PRIVATE_TO_EMOJI_MAP: { [key: number]: number } = {};
  Object.entries(EMOJI_TO_PRIVATE_MAP).forEach(([emoji, code]) => {
    PRIVATE_TO_EMOJI_MAP[code] = emoji.codePointAt(0);
  });
  imGuiSetCharCodeMap(PRIVATE_TO_EMOJI_MAP);
}

export function convertEmojiString(text: string) {
  let result = '';
  for (const c of text) {
    if (c in EMOJI_TO_PRIVATE_MAP) {
      result += String.fromCodePoint(EMOJI_TO_PRIVATE_MAP[c]);
    } else {
      result += c;
    }
  }
  return result;
}
