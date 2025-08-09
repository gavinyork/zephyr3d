export interface HotReloadAdapter {
  invalidate(moduleId: string): Promise<void>;
  // Re-import fresh module (with cache busting)
  reimport<T = any>(moduleId: string): Promise<T>;
}
