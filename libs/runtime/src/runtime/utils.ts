export function toMapArrayPush<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function shallowPick<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: any = {};
  for (const k of keys) if (k in obj) out[k] = (obj as any)[k];
  return out;
}
