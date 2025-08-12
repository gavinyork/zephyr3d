export function simpleImportRewriter(resolveToUrl: (spec: string, fromId: string) => string | undefined) {
  const re = /\b(import|export)\s+(?:[^"']*?\s+from\s+)?(["'])([^"']+)\2/g;

  return (code: string, fromId: string) => {
    return code.replace(re, (m, kw, q, spec) => {
      const url = resolveToUrl(spec, fromId);
      if (!url) {
        return m;
      }
      return m.replace(spec, url);
    });
  };
}
