export type ModuleId = string;

export type ParamSchema =
  | { type: 'number'; name?: string; default?: number; min?: number; max?: number; step?: number }
  | { type: 'boolean'; name?: string; default?: boolean }
  | { type: 'string'; name?: string; default?: string; multiline?: boolean }
  | { type: 'color'; name?: string; default?: string }
  | {
      type: 'enum';
      name?: string;
      default?: string | number;
      options: Array<{ label: string; value: string | number }>;
    }
  | { type: 'vector3'; name?: string; default?: { x: number; y: number; z: number } };

export type ScriptSpec = {
  module: string; // ESM specifier or URL
  export?: string; // class export name; default export if omitted
};

export type ScriptBinding = {
  bindId: string;
  spec: ScriptSpec;
  params?: Record<string, any>;
  enabled?: boolean;
  order?: number;
};
