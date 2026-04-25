import type { Nullable } from '@zephyr3d/base';

export type ScriptAttachmentConfig = Nullable<Record<string, unknown> | unknown[]>;

function cloneScriptAttachmentValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneScriptAttachmentValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneScriptAttachmentValue(item);
    }
    return result as T;
  }
  return value;
}

export function normalizeScriptAttachmentConfig(value: unknown): ScriptAttachmentConfig {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return cloneScriptAttachmentValue(value);
  }
  if (typeof value === 'object') {
    return cloneScriptAttachmentValue(value as Record<string, unknown>);
  }
  return null;
}

export class ScriptAttachment {
  script: string;
  config: ScriptAttachmentConfig;
  constructor(script = '', config: ScriptAttachmentConfig = null) {
    this.script = script ?? '';
    this.config = normalizeScriptAttachmentConfig(config);
  }
}

export function normalizeScriptAttachments(value: unknown): ScriptAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ScriptAttachment[] = [];
  for (const item of value) {
    if (item instanceof ScriptAttachment) {
      if (item.script || item.config != null) {
        result.push(new ScriptAttachment(item.script, item.config));
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const attachment = item as { script?: unknown; config?: unknown };
      const script = typeof attachment.script === 'string' ? attachment.script : '';
      const config = normalizeScriptAttachmentConfig(attachment.config);
      if (script || config != null) {
        result.push(new ScriptAttachment(script, config));
      }
    }
  }
  return result;
}
