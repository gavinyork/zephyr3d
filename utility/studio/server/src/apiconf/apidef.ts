import path from 'path';
import { SCENE_API, SCENE_HANDLERS } from './scene';
import { HOME_API, HOME_HANDLERS } from './home';

export type ApiDefine = typeof API_DEFINE;
export const API_DEFINE = [
  {
    def: HOME_API,
    handlers: HOME_HANDLERS
  },
  {
    def: SCENE_API,
    handlers: SCENE_HANDLERS
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
