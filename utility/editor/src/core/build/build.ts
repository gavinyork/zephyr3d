import { rollup } from '@rollup/browser';
import { importMapResolvePlugin } from './plugins/importmap';
import type { ImportMap } from './plugins/importmap';
import { vfsAndUrlPlugin } from './plugins/vfsurl';
import { tsTranspilePlugin } from './plugins/tstranspile';
import type { VFS } from '@zephyr3d/base';

export async function buildInBrowser(
  vfs: VFS,
  options: {
    vfsRoot: string;
    input: string | string[] | Record<string, string>;
    distDir?: string;
    alias?: Record<string, string>;
    sourcemap?: boolean | 'inline' | 'hidden';
    format?: 'es' | 'iife' | 'umd' | 'cjs';
    importMap?: ImportMap | 'auto';
  }
) {
  const {
    vfsRoot,
    input,
    distDir = '/dist',
    alias = {},
    sourcemap = true,
    format = 'es',
    importMap = 'auto'
  } = options;

  const bundle = await rollup({
    input,
    plugins: [
      importMapResolvePlugin(importMap), // 先按 import map 解析裸模块 -> URL（支持 scopes）
      vfsAndUrlPlugin(vfs, { vfsRoot, distDir, alias }), // VFS 路径解析 + URL fetch + 写回 VFS
      tsTranspilePlugin({ compilerOptions: { sourceMap: sourcemap !== false } }) // typescript.js 转译
    ]
  });

  const { output } = await bundle.generate({
    format,
    sourcemap,
    entryFileNames: 'assets/entry-[hash].js',
    chunkFileNames: 'assets/chunk-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]'
  });

  /*
  // 如果 vfsAndUrlPlugin 的 generateBundle 已经写回，这里可以不再写；保留亦可双保险
  for (const item of output) {
    const outPath = vfs.join(distDir, item.fileName);
    if (item.type === 'asset') {
      const source = typeof item.source === 'string' ? item.source : new Uint8Array(item.source as any);
      await vfs.writeFile(outPath, source as any, {
        encoding: typeof source === 'string' ? 'utf8' : 'binary',
        create: true
      });
    } else {
      await vfs.writeFile(outPath, item.code, { encoding: 'utf8', create: true });
      if (item.map)
        await vfs.writeFile(outPath + '.map', item.map.toString(), { encoding: 'utf8', create: true });
    }
  }
  */

  await bundle.close();
  return { distDir, output };
}
