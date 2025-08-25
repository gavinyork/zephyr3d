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
  '🌍': 0xe00d, // earth
  '⚠️': 0xe00e, // warning
  '♻️': 0xe00f // reinstall packages
};

export function initEmojiMapping() {
  const PRIVATE_TO_EMOJI_MAP: { [key: number]: string } = {};
  Object.entries(EMOJI_TO_PRIVATE_MAP).forEach(([emoji, code]) => {
    PRIVATE_TO_EMOJI_MAP[code] = emoji;
  });
  imGuiSetCharCodeMap(PRIVATE_TO_EMOJI_MAP);
}

function isModifier(codePoint: number) {
  return (
    codePoint === 0xfe0f || // 变体选择器-16
    codePoint === 0x200d || // ZWJ (零宽连接符)
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) || // 肤色修饰符
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) // 组合用双重符号
  );
}

function splitByGraphemes(text: string) {
  const result: string[] = [];
  let i = 0;

  while (i < text.length) {
    let grapheme = '';
    const codePoint = text.codePointAt(i);

    // 添加主要字符
    if (codePoint >= 0x10000) {
      grapheme += text.slice(i, i + 2);
      i += 2;
    } else {
      grapheme += text[i];
      i += 1;
    }

    // 添加修饰符
    while (i < text.length && isModifier(text.codePointAt(i))) {
      const modifierCodePoint = text.codePointAt(i);
      if (modifierCodePoint >= 0x10000) {
        grapheme += text.slice(i, i + 2);
        i += 2;
      } else {
        grapheme += text[i];
        i += 1;
      }
    }

    result.push(grapheme);
  }

  return result;
}

export function convertEmojiString(text: string) {
  let result = '';
  const chars = splitByGraphemes(text);
  for (const c of chars) {
    if (c in EMOJI_TO_PRIVATE_MAP) {
      result += String.fromCodePoint(EMOJI_TO_PRIVATE_MAP[c]);
    } else {
      result += c;
    }
  }
  return result;
}
