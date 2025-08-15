import { rollup } from '@rollup/browser';
import { vfsAndUrlPlugin } from './plugins/vfsurl';
import { tsTranspilePlugin } from './plugins/tstranspile';
import type { VFS } from '@zephyr3d/base';

export async function buildForEndUser(
  vfs: VFS,
  options: {
    vfsRoot: string;
    input: string | string[] | Record<string, string>;
    distDir?: string;
    alias?: Record<string, string>;
    sourcemap?: boolean | 'inline' | 'hidden';
    format?: 'es' | 'iife' | 'umd' | 'cjs';
  }
) {
  const { vfsRoot, input, distDir = '/dist', alias = {}, sourcemap = false, format = 'es' } = options;

  const bundle = await rollup({
    input,
    plugins: [
      vfsAndUrlPlugin(vfs, { vfsRoot, distDir, alias }), // VFS 路径解析 + URL fetch + 写回 VFS
      tsTranspilePlugin({ compilerOptions: { sourceMap: sourcemap !== false } }) // typescript.js 转译
    ]
  });

  const { output } = await bundle.generate({
    format,
    sourcemap,
    entryFileNames: 'index.js',
    chunkFileNames: 'assets/chunk-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]'
  });
  console.log(output);

  await bundle.close();

  const htmlContent = (await vfs.readFile(vfs.join(vfsRoot, 'index.html'), { encoding: 'utf8' })) as string;
  const newContent = htmlContent.replace(
    '</body>',
    `  <script type="module" src="./index.js"></script>\n</body>`
  );
  await vfs.writeFile(vfs.join(vfsRoot, '/dist/index.html'), newContent, {
    encoding: 'utf8',
    create: true
  });
  await vfs.copyFileEx(vfs.join(vfsRoot, 'assets'), vfs.join(vfsRoot, 'dist'));
  return { distDir, output };
}
