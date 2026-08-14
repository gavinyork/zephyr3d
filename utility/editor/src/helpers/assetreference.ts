export type PathRewriteRule = {
  oldPath: string;
  newPath: string;
  isDirectory: boolean;
};

export function rewritePathString(value: string, rules: PathRewriteRule[]): string {
  for (const rule of rules) {
    if (rule.isDirectory) {
      if (value === rule.oldPath) {
        return rule.newPath;
      }
      if (value.startsWith(`${rule.oldPath}/`)) {
        return `${rule.newPath}${value.slice(rule.oldPath.length)}`;
      }
    } else if (value === rule.oldPath) {
      return rule.newPath;
    }
  }
  return value;
}

export function mayContainPathRewriteTarget(text: string, rules: PathRewriteRule[]): boolean {
  return rules.some((rule) => text.includes(rule.oldPath));
}

function rewriteJsonString(value: string, rules: PathRewriteRule[]): string {
  const rewritten = rewritePathString(value, rules);
  if (rewritten !== value || !mayContainPathRewriteTarget(value, rules)) {
    return rewritten;
  }

  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }

  // Serializable properties such as MorphSource store structured data inside string values.
  try {
    const parsed = JSON.parse(value);
    return rewriteJsonPathValues(parsed, rules) ? JSON.stringify(parsed) : value;
  } catch {
    return value;
  }
}

export function rewriteJsonPathValues(node: unknown, rules: PathRewriteRule[]): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const value = node[i];
      if (typeof value === 'string') {
        const rewritten = rewriteJsonString(value, rules);
        if (rewritten !== value) {
          node[i] = rewritten;
          changed = true;
        }
      } else if (value && typeof value === 'object') {
        changed = rewriteJsonPathValues(value, rules) || changed;
      }
    }
    return changed;
  }
  if (!node || typeof node !== 'object') {
    return false;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const rewritten = rewriteJsonString(value, rules);
      if (rewritten !== value) {
        (node as Record<string, unknown>)[key] = rewritten;
        changed = true;
      }
    } else if (value && typeof value === 'object') {
      changed = rewriteJsonPathValues(value, rules) || changed;
    }
  }
  return changed;
}
