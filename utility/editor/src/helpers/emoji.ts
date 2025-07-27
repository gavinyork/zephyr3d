import { imGuiSetCharCodeMap } from '@zephyr3d/imgui';

const EMOJI_TO_PRIVATE_MAP: Record<string, number> = {
  '📁': 0xe000, // Folder close
  '📂': 0xe001, // Folder open
  '📦': 0xe003, // archive
  '🌐': 0xe010, // 3D model (.obj, .fbx, .dae, .gltf)
  '📄': 0xe011, // text
  '🖼️': 0xe012, // image
  '🔊': 0xe013, // audio
  '🎞️': 0xe014, // animation or video clip
  '📜': 0xe015, // script
  '🎨': 0xe016, // material
  '🎥': 0xe017 // camera
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
  for (let c of text) {
    if (c in EMOJI_TO_PRIVATE_MAP) {
      result += String.fromCodePoint(EMOJI_TO_PRIVATE_MAP[c]);
    } else {
      result += c;
    }
  }
  return result;
}
