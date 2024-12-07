import path from 'path';
import { STAT_API, STAT_HANDLERS } from './statistics';

export type ApiDefine = typeof API_DEFINE;
export const API_DEFINE = [
  {
    def: STAT_API,
    handlers: STAT_HANDLERS
  }
];

export function walkApiDefinition(callback: (url: string, apidef: any) => void) {
  const apiDef = API_DEFINE;
  for (const k of Object.keys(apiDef)) {
    const def = apiDef[k].def;
    const pathList = Array.isArray(def.path) ? def.path : [def.path];
    for (const pa of pathList) {
      for (const ki of Object.keys(def.interfaces)) {
        const i = def.interfaces[ki];
        const ipathList = Array.isArray(i.path) ? i.path : [i.path];
        for (const p of ipathList) {
          const u = path.posix.join(pa, p).toLowerCase();
          callback?.(u, i);
        }
      }
    }
  }
  return null;
}
