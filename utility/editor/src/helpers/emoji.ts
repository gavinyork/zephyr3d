import { splitStringByGraphemes } from '@zephyr3d/base';
import { imGuiSetCharCodeMap } from '@zephyr3d/imgui';

const EMOJI_TO_PRIVATE_MAP: Record<string, number> = {
  '📁': 0xe000, // Folder close
  '📂': 0xe001, // Folder open
  '📦': 0xe002, // archive
  '🧊': 0xe003, // 3D model (.obj, .fbx, .dae, .gltf)
  '📄': 0xe004, // file
  '🖼️': 0xe005, // image
  '🔊': 0xe006, // audio
  '🎬': 0xe007, // video
  '🎞️': 0xe008, // animation
  '📜': 0xe009, // script
  '🎨': 0xe00a, // material
  '🎥': 0xe00b, // camera
  '📝': 0xe00c, // text
  '🌍': 0xe00d, // earth
  '⚠️': 0xe00e, // warning
  '♻️': 0xe00f, // reinstall packages
  '🌊': 0xe010, // Water
  '⛰️': 0xe011, // Terrain
  '✨': 0xe012, // Particle
  '🟪': 0xe013, // Group,
  '💡': 0xe014, // light,
  '🦴': 0xe015, // Bone,
  '🧩': 0xe016, // Prefab
  '🔌': 0xe017, // Plugin
  '🚫': 0xe018, // Forbidden,
  '🦰': 0xe019 // hair
};

export function initEmojiMapping() {
  const PRIVATE_TO_EMOJI_MAP: { [key: number]: string } = {};
  Object.entries(EMOJI_TO_PRIVATE_MAP).forEach(([emoji, code]) => {
    PRIVATE_TO_EMOJI_MAP[code] = emoji;
  });
  imGuiSetCharCodeMap(PRIVATE_TO_EMOJI_MAP);
}

export function convertEmojiString(text: string) {
  let result = '';
  const chars = splitStringByGraphemes(text);
  for (const c of chars) {
    if (c in EMOJI_TO_PRIVATE_MAP) {
      result += String.fromCodePoint(EMOJI_TO_PRIVATE_MAP[c]);
    } else {
      result += c;
    }
  }
  return result;
}
