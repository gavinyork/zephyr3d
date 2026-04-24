export function matchesMimeRule(rule: string, mimeType: string) {
  if (!rule) {
    return false;
  }
  if (rule === '*/*') {
    return true;
  }
  if (rule === mimeType) {
    return true;
  }
  if (rule.endsWith('/*')) {
    const prefix = rule.slice(0, -1);
    return mimeType.startsWith(prefix);
  }
  return false;
}

export function matchesMimeType(rules: string[] | undefined, mimeType: string) {
  if (!rules?.length) {
    return true;
  }
  return rules.some((rule) => matchesMimeRule(rule, mimeType));
}
