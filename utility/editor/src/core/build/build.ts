import type * as TS from 'typescript';
import { rollup } from '@rollup/browser';
import { vfsAndUrlPlugin } from './plugins/vfsurl';
import { tsTranspilePlugin } from './plugins/tstranspile';
import { formatString, type VFS } from '@zephyr3d/base';
import { depsResolvePlugin } from './plugins/depresolve';
import { ProjectService } from '../services/project';
import { libDir, projectFileName, templateIndexHTML } from './templates';
import { isAssetMetaPath, TEXTURE_MANIFEST_FILE } from '@zephyr3d/scene';
import type { TextureManifest } from '@zephyr3d/scene';
import { DerivedTextureService } from '../services/derivedtextures';
import { isTextureSourcePath } from '../services/assetmeta';

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
      target: ts.ScriptTarget.ES2020,
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

// Decoders a bundled package fetches relative to its own module at runtime (KTX2
// transcoder, Draco); the editor's build places them beside its module copies
const RUNTIME_DECODERS: Record<string, { dir: string; files: string[] }> = {
  scene: { dir: 'basis', files: ['basis_transcoder.js', 'basis_transcoder.wasm', 'LICENSE'] },
  loaders: { dir: 'draco', files: ['draco_wasm_wrapper_gltf.js', 'draco_decoder_gltf.wasm', 'LICENSE'] }
};

async function copyRuntimeDecoders(vfs: VFS, name: string, packageDir: string) {
  const decoders = RUNTIME_DECODERS[name];
  if (!decoders) {
    return;
  }
  for (const file of decoders.files) {
    const response = await fetch(`./modules/${decoders.dir}/${file}`);
    if (!response.ok) {
      throw new Error(`Missing runtime decoder modules/${decoders.dir}/${file} (HTTP ${response.status})`);
    }
    await vfs.writeFile(vfs.join(packageDir, decoders.dir, file), await response.arrayBuffer(), {
      encoding: 'binary',
      create: true
    });
  }
}

export async function getImportMap(vfs: VFS, distDir: string, writeDependencies = true) {
  const importMap: Record<string, string> = {};
  const depsDir = vfs.join(distDir, `${libDir}/deps`);
  if (writeDependencies) {
    await vfs.makeDirectory(depsDir, true);
  }
  for (const name of [
    'base',
    'device',
    'scene',
    'runtime',
    'loaders',
    'imgui',
    'backend-webgl',
    'backend-webgpu'
  ]) {
    const path = vfs.join(depsDir, `@zephyr3d/${name}/index.js`);
    if (writeDependencies) {
      const content = await (await fetch(`./modules/zephyr3d_${name}.js`)).text();
      await vfs.writeFile(path, content, { encoding: 'utf8', create: true });
      await copyRuntimeDecoders(vfs, name, vfs.join(depsDir, `@zephyr3d/${name}`));
    }
    importMap[`@zephyr3d/${name}`] = `./${vfs.relative(path, distDir)}`;
  }
  if ((await vfs.exists(`/${libDir}/deps.lock.json`)) && (await vfs.exists(`/${libDir}/deps`))) {
    if (
      (await vfs.stat(`/${libDir}/deps.lock.json`)).isFile &&
      (await vfs.stat(`/${libDir}/deps`)).isDirectory
    ) {
      const content = (await vfs.readFile(`/${libDir}/deps.lock.json`, { encoding: 'utf8' })) as string;
      const packages = JSON.parse(content) as { dependencies: Record<string, { entry: string }> };
      for (const k of Object.keys(packages.dependencies)) {
        importMap[k] = packages.dependencies[k].entry;
      }
      if (writeDependencies) {
        await vfs.copyFile(`/${libDir}/deps.lock.json`, `/dist/${libDir}/deps.lock.json`);
        await vfs.copyFileEx(`/${libDir}/deps/**/*`, depsDir, { cwd: `/${libDir}/deps` });
      }
    }
  }
  return { imports: importMap };
}

/** Per-texture line of the build report */
export interface BuildTextureReport {
  path: string;
  shipped: string;
  sourceBytes: number;
  shippedBytes: number;
  width: number;
  height: number;
  /** Set when the texture had to ship uncompressed although settings asked for compression */
  error?: string;
}

function ktx2Dimensions(data: ArrayBuffer) {
  // KTX2 header: 12-byte identifier, vkFormat, typeSize, then pixelWidth/pixelHeight
  const view = new DataView(data);
  return data.byteLength >= 28 ? { width: view.getUint32(20, true), height: view.getUint32(24, true) } : null;
}

/**
 * Ships a texture: its derived KTX2 under a content-hashed name next to where
 * the source was, or the source itself when it is not compressed. Returns the
 * shipped path, which goes into the manifest when it differs from the source.
 */
async function shipTexture(vfs: VFS, distDir: string, path: string, report: BuildTextureReport[]) {
  const sourceBytes = (await vfs.stat(path)).size;
  let derived: string | null = null;
  let error: string | undefined;
  try {
    derived = await DerivedTextureService.getDerivedFile(path);
  } catch (err) {
    error = String(err);
    console.warn(`Shipping ${path} uncompressed: ${error}`);
  }
  if (!derived) {
    await vfs.copyFile(path, vfs.join(distDir, path), { overwrite: true });
    report.push({ path, shipped: path, sourceBytes, shippedBytes: sourceBytes, width: 0, height: 0, error });
    return path;
  }
  const data = (await vfs.readFile(derived, { encoding: 'binary' })) as ArrayBuffer;
  const hash = derived.slice(derived.lastIndexOf('/') + 1, derived.lastIndexOf('.')).slice(0, 8);
  const stem = path.slice(0, path.lastIndexOf('.'));
  const shipped = `${stem}.${hash}.ktx2`;
  await vfs.writeFile(vfs.join(distDir, shipped), data, { encoding: 'binary', create: true });
  const size = ktx2Dimensions(data);
  report.push({
    path,
    shipped,
    sourceBytes,
    shippedBytes: data.byteLength,
    width: size?.width ?? 0,
    height: size?.height ?? 0
  });
  return shipped;
}

export async function buildForEndUser(options: {
  input: string | string[] | Record<string, string>;
  distDir?: string;
  alias?: Record<string, string>;
  sourcemap?: boolean | 'inline' | 'hidden';
  format?: 'es' | 'iife' | 'umd' | 'cjs';
  onProgress?: (message: string, current: number, total: number) => void;
}) {
  const { input, distDir = '/dist', alias = {}, sourcemap = false, format = 'es', onProgress } = options;
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
  // .zmeta sidecars only steer the editor's asset pipeline and are not shipped
  const assetFiles = assetFileList.filter((path) => path.type === 'file' && !isAssetMetaPath(path.path));
  const manifest: TextureManifest = { version: 1, textures: {} };
  const textureReport: BuildTextureReport[] = [];
  for (let i = 0; i < assetFiles.length; i++) {
    const file = assetFiles[i];
    onProgress?.(`Packaging ${file.path}`, i, assetFiles.length);
    if (isTextureSourcePath(file.path) && !file.path.startsWith('/assets/@builtins/')) {
      const shipped = await shipTexture(vfs, distDir, file.path, textureReport);
      if (shipped !== file.path) {
        manifest.textures[file.path] = shipped;
      }
      continue;
    }
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

  onProgress?.('Writing runtime', assetFiles.length, assetFiles.length);
  if (Object.keys(manifest.textures).length > 0) {
    await vfs.writeFile(vfs.join(distDir, TEXTURE_MANIFEST_FILE), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      create: true
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

  return { distDir, output, textureReport };
}
