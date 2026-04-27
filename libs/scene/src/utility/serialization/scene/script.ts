import { defineProps, type SerializableClass } from '../types';
import { JSONArray, JSONData } from '../json';
import { ScriptAttachment, normalizeScriptAttachmentConfig } from '../../../scene/script_attachment';

export function getScriptAttachmentClass(): SerializableClass {
  return {
    ctor: ScriptAttachment,
    name: 'ScriptAttachment',
    noTitle: true,
    createFunc() {
      return { obj: new ScriptAttachment() };
    },
    getProps() {
      return defineProps([
        {
          name: 'Script',
          type: 'string',
          options: {
            mimeTypes: ['text/x-typescript'],
            label: ''
          },
          isNullable() {
            return true;
          },
          get(this: ScriptAttachment, value) {
            value.str[0] = this.script;
          },
          set(this: ScriptAttachment, value) {
            this.script = value?.str?.[0] ?? '';
          }
        },
        {
          name: 'Config',
          type: 'object',
          options: { objectTypes: [JSONData, JSONArray] },
          isHidden(this: ScriptAttachment) {
            return !this.script && this.config == null;
          },
          isNullable() {
            return true;
          },
          get(this: ScriptAttachment, value) {
            const config = normalizeScriptAttachmentConfig(this.config);
            value.object[0] =
              config == null
                ? null
                : Array.isArray(config)
                  ? new JSONArray(null, config)
                  : new JSONData(null, config);
          },
          set(this: ScriptAttachment, value) {
            const data = value?.object?.[0] as
              | JSONData
              | JSONArray
              | Record<string, unknown>
              | unknown[]
              | null
              | undefined;
            this.config =
              data instanceof JSONData || data instanceof JSONArray
                ? normalizeScriptAttachmentConfig(data.data)
                : normalizeScriptAttachmentConfig(data);
          }
        }
      ]);
    }
  };
}
