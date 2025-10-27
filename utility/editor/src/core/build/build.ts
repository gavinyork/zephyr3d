import type * as TS from 'typescript';
import { rollup } from '@rollup/browser';
import { vfsAndUrlPlugin } from './plugins/vfsurl';
import { tsTranspilePlugin } from './plugins/tstranspile';
import { formatString, type VFS } from '@zephyr3d/base';
import { depsResolvePlugin } from './plugins/depresolve';
import { ProjectService } from '../services/project';
import { projectFileName, templateIndexHTML } from './templates';

function rewriteImports(code: string): string {
  const reStatic = /\b(?:import|export)\s+[^"']*?from\s+(['"])([^'"]+)\1/g;
  const reDynamic = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

  const replaceAsync = (input: string, re: RegExp) => {
    let out = '';
    let last = 0;
    for (;;) {
      const m = re.exec(input);
      if (!m) {
        break;
      }
      out += input.slice(last, m.index);

      const quote = m[1];
      const spec = m[2];
      let replacement = spec;

      if ((spec.startsWith('./') || spec.startsWith('../')) && !spec.endsWith('.js')) {
        if (spec.endsWith('.ts')) {
          replacement = `${spec.slice(0, -3)}.js`;
        } else {
          replacement = `${spec}.js`;
        }
      }

      const replaced = m[0].replace(`${quote}${spec}${quote}`, `${quote}${replacement}${quote}`);
      out += replaced;
      last = m.index + m[0].length;
    }
    out += input.slice(last);
    return out;
  };

  let out = replaceAsync(code, reStatic);
  out = replaceAsync(out, reDynamic);
  return out;
}

function transpileTS(fileName: string, code: string) {
  const ts = (window as any).ts as typeof TS;
  if (!ts) {
    throw new Error('TypeScript runtime (window.ts) not found. Load typescript.js first.');
  }

  const res = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
      experimentalDecorators: true,
      useDefineForClassFields: false
    },
    fileName
  });

  let out = res.outputText || '';
  if (res.sourceMapText) {
    const mapBase64 = btoa(unescape(encodeURIComponent(res.sourceMapText)));
    out += `\n//# sourceMappingURL=data:application/json;base64,${mapBase64}`;
  }
  out += `\n//# sourceURL=${fileName}`;
  return out;
}

export async function getImportMap(vfs: VFS, distDir: string, writeDependencies = true) {
  const importMap: Record<string, string> = {};
  const depsDir = vfs.join(distDir, 'deps');
  if (writeDependencies) {
    await vfs.makeDirectory(depsDir, true);
  }
  for (const name of ['base', 'device', 'scene', 'runtime', 'imgui', 'backend-webgl', 'backend-webgpu']) {
    const path = vfs.join(depsDir, `@zephyr3d/${name}/index.js`);
    if (writeDependencies) {
      const content = await (await fetch(`./modules/zephyr3d_${name}.js`)).text();
      await vfs.writeFile(path, content, { encoding: 'utf8', create: true });
    }
    importMap[`@zephyr3d/${name}`] = `./${vfs.relative(path, distDir)}`;
  }
  if ((await vfs.exists('/deps.lock.json')) && (await vfs.exists('/deps'))) {
    if ((await vfs.stat('/deps.lock.json')).isFile && (await vfs.stat('/deps')).isDirectory) {
      const content = (await vfs.readFile('/deps.lock.json', { encoding: 'utf8' })) as string;
      const packages = JSON.parse(content) as { dependencies: Record<string, { entry: string }> };
      for (const k of Object.keys(packages.dependencies)) {
        importMap[k] = packages.dependencies[k].entry;
      }
      if (writeDependencies) {
        await vfs.copyFile('/deps.lock.json', '/dist/deps.lock.json');
        await vfs.copyFileEx('/deps/**/*', depsDir, { cwd: '/deps' });
      }
    }
  }
  return { imports: importMap };
}

export async function buildForEndUser(options: {
  input: string | string[] | Record<string, string>;
  distDir?: string;
  alias?: Record<string, string>;
  sourcemap?: boolean | 'inline' | 'hidden';
  format?: 'es' | 'iife' | 'umd' | 'cjs';
}) {
  const { input, distDir = '/dist', alias = {}, sourcemap = false, format = 'es' } = options;
  const vfs = ProjectService.VFS;

  const bundle = await rollup({
    input,
    plugins: [
      vfsAndUrlPlugin(vfs, { vfsRoot: '/', distDir, alias }),
      depsResolvePlugin(vfs, '/'),
      tsTranspilePlugin({ compilerOptions: { sourceMap: sourcemap !== false } })
    ]
  });

  const { output } = await bundle.generate({
    format,
    sourcemap,
    entryFileNames: 'index.js',
    chunkFileNames: 'assets/chunk-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]'
  });

  await bundle.close();

  // copy asset files to dist
  const assetFileList = await vfs.glob('assets/**/*', {
    includeHidden: true,
    includeDirs: false,
    includeFiles: true,
    recursive: true
  });
  const assetFiles = assetFileList.filter((path) => path.type === 'file');
  for (const file of assetFiles) {
    const isTS = file.path.endsWith('.ts');
    let content = await vfs.readFile(file.path, { encoding: isTS ? 'utf8' : 'binary' });
    let path = file.path;
    if (isTS) {
      content = transpileTS(file.path, rewriteImports(content as string));
      path = `${path.slice(0, -3)}.js`;
    }
    await vfs.writeFile(vfs.join(distDir, path), content, {
      create: true,
      encoding: isTS ? 'utf8' : 'binary'
    });
  }

  const importMap = await getImportMap(vfs, distDir);

  const settings = await ProjectService.getCurrentProjectSettings();
  const info = await ProjectService.getCurrentProjectInfo();
  const favicon = settings.favicon
    ? `<link rel="icon" type="${vfs.guessMIMEType(settings.favicon)}" href=".${settings.favicon}" />`
    : '';
  let htmlContent = formatString(templateIndexHTML, settings.title ?? info.name, favicon);
  htmlContent = htmlContent.replace('</body>', `  <script type="module" src="./index.js"></script>\n</body>`);
  htmlContent = htmlContent.replace(
    '</head>',
    `<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n</head>`
  );
  await vfs.writeFile(vfs.join(distDir, 'index.html'), htmlContent, {
    encoding: 'utf8',
    create: true
  });

  await vfs.writeFile(vfs.join(distDir, projectFileName), JSON.stringify(settings, null, 2), {
    encoding: 'utf8',
    create: true
  });

  return { distDir, output };
}
