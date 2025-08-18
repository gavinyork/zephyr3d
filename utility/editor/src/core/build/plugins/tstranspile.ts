import type * as TS from 'typescript';

export function tsTranspilePlugin(options?: {
  compilerOptions?: TS.TranspileOptions['compilerOptions'];
  include?: (id: string) => boolean;
}) {
  const ts = (window as any).ts as typeof TS;
  const base: TS.TranspileOptions['compilerOptions'] = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    sourceMap: true,
    inlineSources: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    ...(options?.compilerOptions || {})
  };
  const include = options?.include ?? ((id) => /\.(ts|tsx)$/.test(id));

  return {
    name: 'ts-transpile',
    async transform(code: string, id: string) {
      if (!include(id)) {
        return null;
      }
      const res = ts.transpileModule(code, {
        compilerOptions: base,
        fileName: id,
        reportDiagnostics: false
      });
      return {
        code: res.outputText,
        map: res.sourceMapText ? JSON.parse(res.sourceMapText) : { mappings: '' }
      };
    }
  };
}
